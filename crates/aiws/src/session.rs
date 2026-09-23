//! One (group, bot) conversation: owns the adapter process, the ACP session and its turns (one at a time).
use crate::engine::Inner;
use crate::git;
use crate::protocol::{DaemonToServer, RunDone, RunEvent, RunOutcome, RunStart, RunStatus, Tier, Usage, WorkspaceKind};
use crate::service::Outbox;
use crate::turn::{Turn, client_meta, compose_prompt, mode_for, permission_choice, session_failure, system_prompt};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    CancelNotification, ClientCapabilities, ContentBlock, InitializeRequest, InitializeResponse, LoadSessionRequest,
    Meta, NewSessionRequest, PromptRequest, PromptResponse, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, ResumeSessionRequest, SelectedPermissionOutcome, SessionId, SessionModeState,
    SessionNotification, SetSessionModeRequest, StopReason, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

const ERROR_MAX: usize = 800;
const PERMISSION_REJECTED: &str = "权限请求已拒绝（审批流程将在 M3 提供）";

pub(crate) struct TurnReq {
    pub start: RunStart,
    pub cwd: PathBuf,
    pub out: Outbox,
}

struct Active {
    run_id: String,
    tier: Tier,
    out: Outbox,
    turn: Turn,
    /// False while the session is being set up (session/load replays history we must not forward).
    streaming: bool,
    /// Set when the turn runs in a repo workspace.
    git: Option<GitTurn>,
}

struct GitTurn {
    cwd: PathBuf,
    kind: WorkspaceKind,
    snap: git::Snapshot,
}

/// State shared between the session task, ACP callbacks and the engine (for cancel).
#[derive(Default)]
pub(crate) struct Shared(Mutex<State>);

#[derive(Default)]
struct State {
    pending: HashSet<String>,
    cancelled: HashSet<String>,
    active: Option<Active>,
    conn: Option<(ConnectionTo<Agent>, SessionId)>,
}

impl Shared {
    pub(crate) fn enqueue(&self, run_id: &str) {
        self.0.lock().unwrap().pending.insert(run_id.into());
    }

    pub(crate) fn cancel(&self, run_id: &str) {
        let mut s = self.0.lock().unwrap();
        if !s.pending.contains(run_id) {
            return;
        }
        s.cancelled.insert(run_id.into());
        if s.active.as_ref().is_some_and(|a| a.run_id == run_id && a.streaming) {
            send_cancel(&s);
        }
    }

    /// Makes `req` the active turn, or reports it interrupted if it was cancelled while queued.
    fn begin(&self, req: &TurnReq) -> bool {
        let mut s = self.0.lock().unwrap();
        let run_id = &req.start.run_id;
        if s.cancelled.remove(run_id) {
            s.pending.remove(run_id);
            req.out.send(done(run_id, RunOutcome::Interrupted, Turn::default(), None, None, None, None));
            return false;
        }
        s.active = Some(Active {
            run_id: run_id.clone(),
            tier: req.start.bot.tier,
            out: req.out.clone(),
            turn: Turn::default(),
            streaming: false,
            git: None,
        });
        true
    }

    /// Spec §5.2 before the prompt in a repo workspace: fetch / fast-forward, report it, and arm change tracking.
    /// Returns the note for the agent's context (§4.5).
    async fn pre_turn(&self, req: &TurnReq) -> Option<String> {
        if !git::is_repo(&req.cwd) {
            return None;
        }
        let pre = git::pre_turn(&req.cwd).await.inspect_err(|e| tracing::warn!("git pre-turn failed: {e}")).ok()?;
        let event = RunEvent::Status { status: RunStatus::Running, step: pre.step() };
        req.out.send(DaemonToServer::RunEvent { run_id: req.start.run_id.clone(), event });
        match git::snapshot(&req.cwd).await {
            Ok(snap) => {
                let kind =
                    if req.start.workspace.cd_path.is_some() { WorkspaceKind::Cd } else { WorkspaceKind::Managed };
                if let Some(a) = self.0.lock().unwrap().active.as_mut() {
                    a.git = Some(GitTurn { cwd: req.cwd.clone(), kind, snap });
                }
            }
            Err(e) => tracing::warn!("git snapshot failed: {e}"),
        }
        Some(pre.note())
    }

    /// Records the workspace's git state, the paths changed since `pre_turn` and their patch on the active turn.
    async fn post_turn(&self) {
        let Some(g) = self.0.lock().unwrap().active.as_mut().and_then(|a| a.git.take()) else { return };
        let result =
            async { Ok::<_, String>((git::status(&g.cwd, g.kind).await?, git::changed_since(&g.cwd, &g.snap).await?)) };
        let patch = git::patch_since(&g.cwd, &g.snap).await.inspect_err(|e| tracing::warn!("git patch failed: {e}"));
        match result.await {
            Ok(git) => {
                if let Some(a) = self.0.lock().unwrap().active.as_mut() {
                    a.turn.git = Some(git);
                    a.turn.patch = patch.ok().flatten();
                }
            }
            Err(e) => tracing::warn!("git post-turn failed: {e}"),
        }
    }

    fn stream(&self, cx: &ConnectionTo<Agent>, session: &SessionId) {
        let mut s = self.0.lock().unwrap();
        s.conn = Some((cx.clone(), session.clone()));
        let Some(a) = s.active.as_mut() else { return };
        a.streaming = true;
        let run_id = a.run_id.clone();
        if s.cancelled.contains(&run_id) {
            send_cancel(&s);
        }
    }

    fn on_update(&self, n: SessionNotification) {
        let mut s = self.0.lock().unwrap();
        if let Some(a) = s.active.as_mut().filter(|a| a.streaming)
            && let Some(event) = a.turn.apply(n.update)
        {
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
    }

    fn on_permission(&self, req: RequestPermissionRequest) -> RequestPermissionResponse {
        let s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref() else {
            return RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled);
        };
        if a.tier != Tier::Full {
            let event = RunEvent::Status { status: RunStatus::Running, step: PERMISSION_REJECTED.into() };
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
        RequestPermissionResponse::new(match permission_choice(a.tier, &req.options) {
            Some(id) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)),
            None => RequestPermissionOutcome::Cancelled,
        })
    }

    /// Ends the active turn and reports it. `Err` = the agent failed.
    fn finish(&self, result: Result<PromptResponse, String>, session: Option<&SessionId>, reason: Option<&str>) {
        let mut s = self.0.lock().unwrap();
        s.conn = None;
        let Some(a) = s.active.take() else { return };
        s.pending.remove(&a.run_id);
        let cancelled = s.cancelled.remove(&a.run_id);
        let session = session.map(|id| id.0.to_string());
        let reason = reason.map(String::from);
        let msg = match result {
            Ok(resp) => {
                if !cancelled
                    && let Some(error) = a.turn.failure.clone().or_else(|| session_failure(resp.meta.as_ref()))
                {
                    a.out.send(done(
                        &a.run_id,
                        RunOutcome::Failed,
                        a.turn,
                        None,
                        session,
                        reason,
                        Some(truncate(&error)),
                    ));
                    return;
                }
                let outcome = if cancelled || resp.stop_reason == StopReason::Cancelled {
                    RunOutcome::Interrupted
                } else {
                    RunOutcome::Completed
                };
                let cost = a.turn.usage.as_ref().and_then(|u| u.cost_usd);
                // Claude reports all-zero usage for cancelled turns; treat that as unreported.
                let usage = resp.usage.filter(|u| u.total_tokens > 0).map(|u| Usage {
                    input_tokens: Some(u.input_tokens),
                    output_tokens: Some(u.output_tokens),
                    total_tokens: Some(u.total_tokens),
                    cost_usd: cost,
                });
                done(&a.run_id, outcome, a.turn, usage, session, reason, None)
            }
            Err(_) if cancelled => done(&a.run_id, RunOutcome::Interrupted, a.turn, None, session, reason, None),
            Err(e) => done(&a.run_id, RunOutcome::Failed, a.turn, None, session, reason, Some(truncate(&e))),
        };
        a.out.send(msg);
    }
}

fn send_cancel(s: &State) {
    if let Some((cx, session)) = &s.conn
        && let Err(e) = cx.send_notification(CancelNotification::new(session.clone()))
    {
        tracing::warn!("session/cancel failed: {e}");
    }
}

fn done(
    run_id: &str,
    outcome: RunOutcome,
    turn: Turn,
    usage: Option<Usage>,
    session_id: Option<String>,
    new_session_reason: Option<String>,
    error: Option<String>,
) -> DaemonToServer {
    // Shell edits (Codex) carry no tool locations: git sees them.
    let (git, git_changed) = turn.git.map_or((None, 0), |(g, n)| (Some(g), n));
    DaemonToServer::RunDone(RunDone {
        run_id: run_id.into(),
        outcome,
        files_changed: turn.files.len().max(git_changed) as u32,
        usage: usage.or(turn.usage),
        reply: turn.reply,
        session_id,
        new_session_reason,
        error,
        git,
        patch: turn.patch,
    })
}

/// Message plus the innermost `data` detail (e.g. the adapter's exit status / stderr tail).
fn describe(e: &agent_client_protocol::Error) -> String {
    let detail = e.data.as_ref().map(|d| d.get("data").unwrap_or(d));
    match detail {
        Some(serde_json::Value::String(d)) => format!("{}: {d}", e.message),
        Some(d) => format!("{}: {d}", e.message),
        None => e.message.clone(),
    }
}

fn truncate(s: &str) -> String {
    s.chars().take(ERROR_MAX).collect()
}

/// Session task: spawns an adapter on demand, runs queued turns in order, reaps the adapter when idle.
pub(crate) async fn run(engine: Arc<Inner>, shared: Arc<Shared>, mut rx: mpsc::UnboundedReceiver<TurnReq>) {
    // Survives adapter restarts so the next process resumes the same conversation.
    let mut resume: Option<SessionId> = None;
    while let Some(req) = rx.recv().await {
        if !shared.begin(&req) {
            continue;
        }
        let result = match engine.adapter(&req.start.bot).await {
            Ok(config) => connect(&engine, &shared, AcpAgent::new(config), req, &mut rx, &mut resume).await,
            Err(e) => Err(format!("{e:#}")),
        };
        // A turn still active here was cut short by the adapter exiting or failing to start.
        let error = result.err().unwrap_or_else(|| "agent 进程意外退出".into());
        if shared.0.lock().unwrap().active.is_some() {
            tracing::warn!("adapter ended mid-turn: {error}");
            shared.post_turn().await;
            shared.finish(Err(error), resume.as_ref(), None);
        }
    }
}

async fn connect(
    engine: &Inner,
    shared: &Arc<Shared>,
    agent: AcpAgent,
    first: TurnReq,
    rx: &mut mpsc::UnboundedReceiver<TurnReq>,
    resume: &mut Option<SessionId>,
) -> Result<(), String> {
    let (on_update, on_permission) = (shared.clone(), shared.clone());
    Client
        .builder()
        .on_receive_notification(
            async move |n: SessionNotification, _cx| {
                on_update.on_update(n);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |req: RequestPermissionRequest, responder, _cx| {
                responder.respond(on_permission.on_permission(req))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async |cx: ConnectionTo<Agent>| {
            let init = cx
                .send_request(
                    InitializeRequest::new(ProtocolVersion::V1)
                        .client_capabilities(ClientCapabilities::new().meta(client_meta())),
                )
                .block_task()
                .await?;
            let caps = &init.agent_capabilities;
            tracing::info!(
                agent = ?init.agent_info.as_ref().map(|i| format!("{} {}", i.name, i.version)),
                load = caps.load_session,
                resume = caps.session_capabilities.resume.is_some(),
                image = caps.prompt_capabilities.image,
                "adapter initialized"
            );
            let mut conv = Conversation { cx: &cx, init: &init, shared, session: None, mode: None };
            let mut req = first;
            loop {
                conv.turn(req, resume).await?;
                req = loop {
                    match tokio::time::timeout(engine.config.idle, rx.recv()).await {
                        Ok(Some(next)) if shared.begin(&next) => break next,
                        Ok(Some(_)) => continue,
                        Ok(None) | Err(_) => return Ok(()),
                    }
                };
            }
        })
        .await
        .map_err(|e| describe(&e))
}

/// The ACP session on one adapter connection.
struct Conversation<'a> {
    cx: &'a ConnectionTo<Agent>,
    init: &'a InitializeResponse,
    shared: &'a Shared,
    session: Option<SessionId>,
    mode: Option<String>,
}

impl Conversation<'_> {
    /// Runs one prompt turn. Only transport-level failures are returned (they tear the adapter down).
    async fn turn(&mut self, req: TurnReq, resume: &mut Option<SessionId>) -> Result<(), agent_client_protocol::Error> {
        let s = &req.start;
        // The server owns the session id: reuse the live one only if it asks for it (/new sends none).
        let wanted = s.resume_session_id.clone().map(SessionId::new);
        let (session, reason, history) = match self.session.clone().filter(|id| wanted.as_ref() == Some(id)) {
            Some(id) => (id, None, &s.prompt.context),
            None => match self.open(&req, wanted).await {
                Ok((id, reason)) => {
                    let history = if reason.as_deref() == Some("resume_failed") {
                        &s.prompt.fallback_context
                    } else {
                        &s.prompt.context
                    };
                    (id, reason, history)
                }
                Err(e) => {
                    self.shared.finish(Err(format!("无法建立 agent 会话：{}", describe(&e))), None, None);
                    return Ok(());
                }
            },
        };
        *resume = Some(session.clone());
        self.session = Some(session.clone());
        let mode = mode_for(s.bot.agent_kind, s.bot.tier);
        if self.mode.as_deref().is_some_and(|m| m != mode) {
            match self.cx.send_request(SetSessionModeRequest::new(session.clone(), mode)).block_task().await {
                Ok(_) => self.mode = Some(mode.into()),
                Err(e) => tracing::warn!("session/set_mode {mode} failed: {e}"),
            }
        }
        // Before streaming, so a /stop during the fetch still cancels the prompt.
        let git_note = self.shared.pre_turn(&req).await;
        self.shared.stream(self.cx, &session);
        let text = compose_prompt(&s.prompt, history, git_note.as_deref());
        let prompt = PromptRequest::new(session.clone(), vec![ContentBlock::Text(TextContent::new(text))]);
        match self.cx.send_request(prompt).block_task().await {
            // The adapter died: leave the turn active so the caller reports the exit status and stderr instead.
            Err(e) if agent_client_protocol::is_incoming_transport_closed(&e) => Err(e),
            result => {
                let error = result.as_ref().err().cloned();
                self.shared.post_turn().await;
                self.shared.finish(result.map_err(|e| describe(&e)), Some(&session), reason.as_deref());
                // A failed prompt may mean a broken adapter: restart it for the next turn.
                error.map_or(Ok(()), Err)
            }
        }
    }

    /// Resumes `resume` if possible, else opens a new session. Returns the id and the new-session reason.
    async fn open(
        &mut self,
        req: &TurnReq,
        resume: Option<SessionId>,
    ) -> Result<(SessionId, Option<String>), agent_client_protocol::Error> {
        let meta = self.meta(&req.start);
        let tried = resume.is_some();
        if let Some(id) = resume {
            match self.restore(&id, req, meta.clone()).await {
                Ok(modes) => {
                    self.set_modes(modes);
                    return Ok((id, None));
                }
                Err(e) => tracing::info!("resuming session {} failed: {e}", id.0),
            }
        }
        let res = self.cx.send_request(NewSessionRequest::new(&req.cwd).meta(meta)).block_task().await?;
        self.set_modes(res.modes);
        let reason =
            if tried { "resume_failed".into() } else { req.start.new_session_reason.clone().unwrap_or("first".into()) };
        Ok((res.session_id, Some(reason)))
    }

    async fn restore(
        &self,
        id: &SessionId,
        req: &TurnReq,
        meta: Option<Meta>,
    ) -> Result<Option<SessionModeState>, agent_client_protocol::Error> {
        let caps = &self.init.agent_capabilities;
        if caps.session_capabilities.resume.is_some() {
            let req = ResumeSessionRequest::new(id.clone(), &req.cwd).meta(meta);
            Ok(self.cx.send_request(req).block_task().await?.modes)
        } else if caps.load_session {
            let req = LoadSessionRequest::new(id.clone(), &req.cwd).meta(meta);
            Ok(self.cx.send_request(req).block_task().await?.modes)
        } else {
            Err(agent_client_protocol::Error::method_not_found())
        }
    }

    /// Records the session's current mode so the first turn switches it to the tier's mode (D21) when offered.
    fn set_modes(&mut self, modes: Option<SessionModeState>) {
        self.mode = modes.map(|m| m.current_mode_id.0.to_string());
    }

    /// Claude reads the per-session system prompt from `_meta`; Codex gets it per process (CODEX_CONFIG).
    fn meta(&self, start: &RunStart) -> Option<Meta> {
        let json = serde_json::json!({ "systemPrompt": { "append": system_prompt(&start.bot) } });
        (start.bot.agent_kind == crate::protocol::AgentKind::Claude)
            .then(|| json.as_object().cloned().unwrap_or_default())
    }
}
