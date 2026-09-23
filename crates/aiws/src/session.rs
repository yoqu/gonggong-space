//! One (group, bot) conversation: owns the adapter process, the ACP session and its turns (one at a time).
use crate::ask::{self, Asker};
use crate::attachments;
use crate::engine::Inner;
use crate::git;
use crate::protocol::{
    AgentCommand, Answer, ApprovalRequest, Attachment, DaemonToServer, McpServer, Question, RunDone, RunEvent,
    RunOutcome, RunStart, RunStatus, Tier, Usage, WorkspaceKind,
};
use crate::service::Outbox;
use crate::turn::{
    Turn, auto_allow, client_meta, compose_prompt, mode_for, session_failure, system_prompt, wire_options,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    self as acp, CancelNotification, ClientCapabilities, EnvVariable, HttpHeader, InitializeRequest,
    InitializeResponse, LoadSessionRequest, McpServerHttp, McpServerStdio, Meta, NewSessionRequest, PermissionOption,
    PermissionOptionId, PermissionOptionKind, PromptRequest, PromptResponse, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest, SelectedPermissionOutcome, SessionId,
    SessionModeState, SessionNotification, SessionUpdate, SetSessionModeRequest, StopReason, Usage as AcpUsage,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

const ERROR_MAX: usize = 800;
const REJECTED: &str = "请求被拒绝，agent 自行绕路";

pub(crate) struct TurnReq {
    pub start: RunStart,
    pub cwd: PathBuf,
    pub out: Outbox,
}

struct Active {
    run_id: String,
    cwd: PathBuf,
    /// (group, bot) of the conversation, for commands.update.
    key: (String, String),
    tier: Tier,
    out: Outbox,
    turn: Turn,
    /// False while the session is being set up (session/load replays history we must not forward).
    streaming: bool,
    /// Set when the turn runs in a repo workspace.
    git: Option<GitTurn>,
    /// The last prompt has ended: no more appends (spec §8.9) are taken.
    sealed: bool,
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
    /// Permission requests of the active turn awaiting the bot owner, by request id.
    approvals: HashMap<String, Approval>,
    requests: u64,
    /// The last finished turn's snapshot (run id), kept for run.discard until the next turn starts (plan D7).
    last: Option<(String, GitTurn)>,
    /// Ask-tool calls of the active turn awaiting the group, by request id.
    questions: HashMap<String, Asked>,
    /// 打断并追加 prompts (text, attachments) waiting for the cancelled prompt to end.
    appends: Vec<(String, Vec<Attachment>)>,
}

struct Asked {
    questions: Vec<Question>,
    tx: oneshot::Sender<String>,
}

struct Approval {
    title: String,
    options: Vec<PermissionOption>,
    tx: oneshot::Sender<Option<PermissionOptionId>>,
}

/// How to answer an agent's permission request.
enum Permission {
    Now(RequestPermissionResponse),
    /// Resolves with the owner's choice; `None` (or a dropped sender) answers `cancelled`.
    Ask(oneshot::Receiver<Option<PermissionOptionId>>),
}

fn permission_response(choice: Option<PermissionOptionId>) -> RequestPermissionResponse {
    RequestPermissionResponse::new(match choice {
        Some(id) => RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(id)),
        None => RequestPermissionOutcome::Cancelled,
    })
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
            interrupt(&mut s);
        }
    }

    /// 打断并追加 (spec §8.9): cancels the current prompt; the turn then continues with `text` (see `take_append`).
    pub(crate) fn append(&self, run_id: &str, from: &str, text: &str, attachments: Vec<Attachment>) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref().filter(|a| a.run_id == run_id && !a.sealed) else { return false };
        if s.cancelled.contains(run_id) {
            return false;
        }
        let event = RunEvent::Status { status: RunStatus::Running, step: format!("{from} 打断并追加") };
        a.out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
        let streaming = a.streaming;
        let note = ask::attachment_note(&attachments);
        let text = if note.is_empty() {
            format!("{from} 追加：{text}")
        } else {
            format!("{from} 追加：{text}\n\n{note}")
        };
        s.appends.push((text, attachments));
        if streaming {
            interrupt(&mut s);
        }
        true
    }

    /// Next prompt of the active turn after the current one ended: the queued appends, unless it was stopped.
    /// Otherwise seals the turn, so it ends with the reply of its last prompt.
    fn take_append(&self) -> Option<(String, Vec<Attachment>)> {
        let mut s = self.0.lock().unwrap();
        let s = &mut *s;
        let a = s.active.as_mut()?;
        if s.cancelled.contains(&a.run_id) || s.appends.is_empty() {
            a.sealed = true;
            return None;
        }
        a.turn.reply.clear();
        a.turn.appends_applied += s.appends.len() as u32;
        let (texts, files): (Vec<_>, Vec<_>) = std::mem::take(&mut s.appends).into_iter().unzip();
        Some((texts.join("\n\n"), files.concat()))
    }

    /// Workspace of the active turn if it is `run_id`.
    pub(crate) fn cwd(&self, run_id: &str) -> Option<PathBuf> {
        self.0.lock().unwrap().active.as_ref().filter(|a| a.run_id == run_id).map(|a| a.cwd.clone())
    }

    /// The group's answer to an ask-tool call of `run_id`; `answers: None` = nobody answered in time.
    pub(crate) fn answer(
        &self,
        run_id: &str,
        request_id: &str,
        answers: Option<&[Answer]>,
        attachments: &[Attachment],
        answered_by: Option<&str>,
    ) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(out) = s.active.as_ref().filter(|a| a.run_id == run_id).map(|a| a.out.clone()) else { return false };
        let Some(q) = s.questions.remove(request_id) else { return false };
        let step = match answers {
            Some(_) => format!("{} 已回答", answered_by.unwrap_or("群成员")),
            None => "无人回答，agent 按推荐项继续".into(),
        };
        let event = RunEvent::Status { status: RunStatus::Running, step };
        out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
        let _ = q.tx.send(ask::format_answers(&q.questions, answers, attachments, answered_by));
        true
    }

    /// Applies the owner's decision to a pending request of `run_id`; false if there is none (e.g. already void).
    pub(crate) fn decide(&self, run_id: &str, request_id: &str, option_id: Option<String>) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(out) = s.active.as_ref().filter(|a| a.run_id == run_id).map(|a| a.out.clone()) else { return false };
        let Some(p) = s.approvals.remove(request_id) else { return false };
        let choice = option_id.and_then(|id| p.options.into_iter().find(|o| *o.option_id.0 == *id));
        let allowed = choice
            .as_ref()
            .is_some_and(|o| matches!(o.kind, PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways));
        let step = if allowed { format!("已批准：{}", p.title) } else { REJECTED.into() };
        let event = RunEvent::Status { status: RunStatus::Running, step };
        out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
        let _ = p.tx.send(choice.map(|o| o.option_id));
        true
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
        s.last = None;
        s.active = Some(Active {
            run_id: run_id.clone(),
            cwd: req.cwd.clone(),
            key: (req.start.group_id.clone(), req.start.bot.id.clone()),
            tier: req.start.bot.tier,
            out: req.out.clone(),
            turn: Turn::default(),
            streaming: false,
            git: None,
            sealed: false,
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
        let Some((run_id, g)) =
            self.0.lock().unwrap().active.as_mut().and_then(|a| Some((a.run_id.clone(), a.git.take()?)))
        else {
            return;
        };
        let result =
            async { Ok::<_, String>((git::status(&g.cwd, g.kind).await?, git::changed_since(&g.cwd, &g.snap).await?)) };
        let patch = git::patch_since(&g.cwd, &g.snap).await.inspect_err(|e| tracing::warn!("git patch failed: {e}"));
        let git = result.await.inspect_err(|e| tracing::warn!("git post-turn failed: {e}")).ok();
        let mut s = self.0.lock().unwrap();
        if let Some(a) = s.active.as_mut() {
            a.turn.patch = git.as_ref().and(patch.ok().flatten());
            a.turn.git = git;
        }
        s.last = Some((run_id, g));
    }

    /// Restores the files `run_id` touched, if it is this conversation's last finished turn. None → not ours.
    pub(crate) async fn discard(&self, run_id: &str) -> Option<Result<usize, String>> {
        let g = {
            let mut s = self.0.lock().unwrap();
            if s.last.as_ref().is_none_or(|(id, _)| id != run_id) {
                return None;
            }
            s.last.take()?.1
        };
        Some(git::discard(&g.cwd, &g.snap).await)
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
        // Sent right after session creation (before streaming); feeds the / candidates.
        if let (SessionUpdate::AvailableCommandsUpdate(u), Some(a)) = (&n.update, s.active.as_ref()) {
            let commands = u
                .available_commands
                .iter()
                .map(|c| AgentCommand { name: c.name.clone(), description: c.description.clone() })
                .collect();
            let (group_id, bot_id) = a.key.clone();
            return a.out.send(DaemonToServer::CommandsUpdate { group_id, bot_id, commands });
        }
        if let Some(a) = s.active.as_mut().filter(|a| a.streaming)
            && let Some(event) = a.turn.apply(n.update)
        {
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
    }

    /// Plan D15: `full` allows by itself; anything the agent asks beyond other tiers goes to the bot owner.
    fn on_permission(&self, req: RequestPermissionRequest) -> Permission {
        let mut s = self.0.lock().unwrap();
        s.requests += 1;
        let n = s.requests;
        let Some(a) = s.active.as_mut() else { return Permission::Now(permission_response(None)) };
        // The built-in ask tool only reaches group members: never an owner decision (spec §8.8).
        let ask_tool = req.tool_call.fields.title.as_deref().is_some_and(|t| t.contains(ask::TOOL));
        if a.tier == Tier::Full || ask_tool {
            return Permission::Now(permission_response(auto_allow(&req.options)));
        }
        let Some(RunEvent::Tool { title, tool_kind, detail, .. }) =
            a.turn.apply(SessionUpdate::ToolCallUpdate(req.tool_call))
        else {
            unreachable!("tool call updates always map to tool events")
        };
        let (run_id, out) = (a.run_id.clone(), a.out.clone());
        let event = RunEvent::Status { status: RunStatus::AwaitingApproval, step: format!("等待审批：{title}") };
        out.send(DaemonToServer::RunEvent { run_id: run_id.clone(), event });
        let request_id = format!("{run_id}/{n}");
        out.send(DaemonToServer::ApprovalRequest(ApprovalRequest {
            run_id,
            request_id: request_id.clone(),
            detail: detail.unwrap_or_else(|| title.clone()),
            title: title.clone(),
            tool_kind,
            options: wire_options(&req.options),
        }));
        let (tx, rx) = oneshot::channel();
        s.approvals.insert(request_id, Approval { title, options: req.options, tx });
        Permission::Ask(rx)
    }

    /// Ends the active turn and reports it. `Err` = the agent failed.
    fn finish(&self, result: Result<PromptResponse, String>, session: Option<&SessionId>, reason: Option<&str>) {
        let mut s = self.0.lock().unwrap();
        s.conn = None;
        s.approvals.clear();
        s.questions.clear();
        s.appends.clear();
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

/// Cancels the prompt in flight. ACP: every pending permission request is then answered `cancelled`; pending
/// questions are withdrawn with it.
fn interrupt(s: &mut State) {
    send_cancel(s);
    s.approvals.clear();
    s.questions.clear();
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
        appends_applied: turn.appends_applied,
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

/// Token usage of a turn spanning several prompts (打断并追加).
fn add_usage(a: Option<AcpUsage>, b: Option<AcpUsage>) -> Option<AcpUsage> {
    match (a, b) {
        (Some(a), Some(b)) => Some(AcpUsage::new(
            a.total_tokens + b.total_tokens,
            a.input_tokens + b.input_tokens,
            a.output_tokens + b.output_tokens,
        )),
        (a, b) => a.or(b),
    }
}

fn truncate(s: &str) -> String {
    s.chars().take(ERROR_MAX).collect()
}

impl Asker for Shared {
    fn ask(&self, questions: Vec<Question>) -> Result<oneshot::Receiver<String>, String> {
        let mut s = self.0.lock().unwrap();
        s.requests += 1;
        let n = s.requests;
        let Some(a) = s.active.as_ref().filter(|a| a.streaming && !a.sealed) else {
            return Err("当前没有进行中的运行，无法提问".into());
        };
        let (run_id, out) = (a.run_id.clone(), a.out.clone());
        let step = format!("等待回答：{} 个问题", questions.len());
        out.send(DaemonToServer::RunEvent {
            run_id: run_id.clone(),
            event: RunEvent::Status { status: RunStatus::AwaitingAnswer, step },
        });
        let request_id = format!("{run_id}/q{n}");
        out.send(DaemonToServer::QuestionAsk { run_id, request_id: request_id.clone(), questions: questions.clone() });
        let (tx, rx) = oneshot::channel();
        s.questions.insert(request_id, Asked { questions, tx });
        Ok(rx)
    }
}

/// Session task: spawns an adapter on demand, runs queued turns in order, reaps the adapter when idle.
pub(crate) async fn run(
    engine: Arc<Inner>,
    shared: Arc<Shared>,
    ask: acp::McpServer,
    mut rx: mpsc::UnboundedReceiver<TurnReq>,
) {
    // Survives adapter restarts so the next process resumes the same conversation.
    let mut resume: Option<SessionId> = None;
    while let Some(req) = rx.recv().await {
        if !shared.begin(&req) {
            continue;
        }
        let result = match engine.adapter(&req.start.bot).await {
            Ok(config) => connect(&engine, &shared, &ask, AcpAgent::new(config), req, &mut rx, &mut resume).await,
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
    ask: &acp::McpServer,
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
            async move |req: RequestPermissionRequest, responder, cx: ConnectionTo<Agent>| match on_permission
                .on_permission(req)
            {
                Permission::Now(res) => responder.respond(res),
                // Waiting for the owner must not block the dispatch loop (updates, cancel, the prompt reply).
                Permission::Ask(rx) => {
                    cx.spawn(async move { responder.respond(permission_response(rx.await.ok().flatten())) })
                }
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
            let mut conv = Conversation { cx: &cx, init: &init, shared, ask, session: None, mode: None };
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
    ask: &'a acp::McpServer,
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
        let image = self.init.agent_capabilities.prompt_capabilities.image;
        let mut blocks = attachments::prompt_blocks(&req.cwd, text, &s.prompt.attachments, image);
        let mut spent: Option<AcpUsage> = None;
        // 打断并追加 cancels a prompt and continues the same turn with the appended text (spec §8.9).
        let result = loop {
            let prompt = PromptRequest::new(session.clone(), blocks);
            let result = self.cx.send_request(prompt).block_task().await.map(|mut resp| {
                spent = add_usage(spent.take(), resp.usage.take());
                resp.usage = spent.clone();
                resp
            });
            match self.shared.take_append() {
                Some((text, files)) if result.is_ok() => {
                    blocks = attachments::prompt_blocks(&req.cwd, text, &files, image);
                }
                _ => break result,
            }
        };
        match result {
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
        let servers = mcp_servers_for(&req.start, self.ask);
        let new = NewSessionRequest::new(&req.cwd).mcp_servers(servers).meta(meta);
        let res = self.cx.send_request(new).block_task().await?;
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
        let servers = mcp_servers_for(&req.start, self.ask);
        if caps.session_capabilities.resume.is_some() {
            let req = ResumeSessionRequest::new(id.clone(), &req.cwd).mcp_servers(servers).meta(meta);
            Ok(self.cx.send_request(req).block_task().await?.modes)
        } else if caps.load_session {
            let req = LoadSessionRequest::new(id.clone(), &req.cwd).mcp_servers(servers).meta(meta);
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

/// MCP servers attached when a session is created or restored: the server's global layer plus the built-in ask
/// tool, which every session gets (spec §7.2).
fn mcp_servers_for(start: &RunStart, ask: &acp::McpServer) -> Vec<acp::McpServer> {
    start
        .mcp_servers
        .iter()
        .map(|s| match s {
            McpServer::Stdio { name, command, args, env } => acp::McpServer::Stdio(
                McpServerStdio::new(name, command)
                    .args(args.clone())
                    .env(env.iter().map(|(k, v)| EnvVariable::new(k, v)).collect()),
            ),
            McpServer::Http { name, url, headers } => acp::McpServer::Http(
                McpServerHttp::new(name, url).headers(headers.iter().map(|(k, v)| HttpHeader::new(k, v)).collect()),
            ),
        })
        .chain([ask.clone()])
        .collect()
}
