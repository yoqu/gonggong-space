//! One (group, bot) conversation: owns the adapter process, the ACP session and its turns (one at a time).
use crate::ask::{self, Asker};
use crate::attachments;
use crate::engine::Inner;
use crate::git;
use crate::hosted::Scope;
use crate::inject;
use crate::local::{self, Decision, LocalSettings, Rules};
use crate::protocol::{
    AgentCatalog, AgentCommand, AgentKind, Answer, ApprovalRequest, Attachment, Choice, DaemonToServer, McpServer,
    ModelChoice, Question, RunDone, RunEvent, RunOutcome, RunStart, RunStatus, Tier, Usage, WorkspaceKind,
};
use crate::providers::{OFFICIAL, RunPlan, Selection, Store};
use crate::replicas::SyncTurn;
use crate::service::Outbox;
use crate::t;
use crate::turn::{
    ExtUpdate, TaskSnap, Turn, auto_allow, client_meta, compose_prompt, mode_for, session_failure, sync_hint,
    system_prompt, wire_options,
};
use crate::workspace;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    self as acp, CancelNotification, ClientCapabilities, EnvVariable, HttpHeader, InitializeRequest,
    InitializeResponse, LoadSessionRequest, McpServerHttp, McpServerStdio, Meta, NewSessionRequest, PermissionOption,
    PermissionOptionId, PermissionOptionKind, PromptRequest, PromptResponse, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest, SelectedPermissionOutcome,
    SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOptions,
    SessionConfigValueId, SessionId, SessionModeState, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, SetSessionModeRequest, StopReason, Usage as AcpUsage,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo, Handled, UntypedMessage};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

const ERROR_MAX: usize = 800;
pub(crate) fn not_git() -> &'static str {
    t!("工作区不是 git 仓库")
}
const RESUME_FAILED: &str = "resume_failed";
/// The session to resume was pinned to a provider since deleted (§4.3).
const PROVIDER_REMOVED: &str = "provider_removed";

pub(crate) struct TurnReq {
    pub start: RunStart,
    pub cwd: PathBuf,
    pub out: Outbox,
    /// The owner's local settings as of this run.
    pub local: LocalSettings,
    /// Force group: the replica, caught up and held until the turn's changes are submitted.
    pub sync: Option<SyncTurn>,
    /// The version the replica is still at when catching up before the turn failed.
    pub behind: Option<u64>,
}

/// An active turn and the provider it runs with.
struct Planned {
    req: TurnReq,
    selection: Selection,
    /// Its session's pinned provider is gone: start a new session instead of resuming.
    removed: bool,
}

/// Makes `req` the active turn and decides its provider from the store as of now, so CLI / desktop edits apply from
/// the next turn on. None: it will not run (cancelled while queued, or no provider to run with).
fn plan(engine: &Inner, shared: &Shared, mut req: TurnReq) -> Option<Planned> {
    if !shared.begin(&mut req) {
        return None;
    }
    let home = &engine.config.home;
    let s = &req.start;
    let resolved = Store::load(home).and_then(|store| {
        inject::prune(home, &store);
        store.resolve_run(s.bot.agent_kind, &s.bot.id, s.resume_session_id.as_deref())
    });
    let (selection, removed) = match resolved {
        Ok(RunPlan::Resume(selection)) => (selection, false),
        Ok(RunPlan::New { selection, provider_removed }) => (selection, provider_removed),
        Err(e) => {
            shared.finish(Err(format!("{e:#}")), None, None);
            return None;
        }
    };
    Some(Planned { req, selection, removed })
}

struct Active {
    run_id: String,
    cwd: PathBuf,
    /// (group, bot) of the conversation, for commands.update.
    key: (String, String),
    tier: Tier,
    /// The bot's 命令审批 as sent with the run (plans D15, J8).
    rules: Rules,
    out: Outbox,
    turn: Turn,
    /// False while the session is being set up (session/load replays history we must not forward).
    streaming: bool,
    /// Set when the turn runs in a repo workspace.
    git: Option<GitTurn>,
    sync: Option<SyncTurn>,
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
    /// The adapter connection while its process lives; background tasks outlive the turn's `conn`.
    agent: Option<ConnectionTo<Agent>>,
    /// Permission requests of the active turn awaiting the bot owner, by request id.
    approvals: HashMap<String, Approval>,
    /// Commands the owner allowed always, trusted for the rest of the conversation.
    always: Vec<String>,
    requests: u64,
    /// The last finished turn's snapshot (run id), kept for run.discard until the next turn starts (plan D7).
    last: Option<(String, GitTurn)>,
    /// Ask-tool calls of the active turn awaiting the group, by request id.
    questions: HashMap<String, Asked>,
    /// 打断并追加 prompts (text, attachments) waiting for the cancelled prompt to end.
    appends: Vec<(String, Vec<Attachment>)>,
    /// Background tasks by id, reporting to the run that started them even after it ended.
    tasks: HashMap<String, Task>,
}

struct Task {
    run_id: String,
    out: Outbox,
    /// ACP session that owns it, for `_session/async_task/stop`.
    session: String,
    snap: TaskSnap,
}

/// Draft ACP extension method both adapters serve.
const ASYNC_TASK_STOP: &str = "_session/async_task/stop";

struct Asked {
    questions: Vec<Question>,
    reply: Reply,
}

enum Reply {
    /// The ask tool's text result for the agent.
    Agent(oneshot::Sender<String>),
    /// The shared-directory confirmation (workspace::occupy): true = run in parallel now.
    Dir(oneshot::Sender<bool>),
}

struct Approval {
    title: String,
    command: Option<String>,
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

    /// Runs handed to this conversation that have not ended (the active turn and those queued behind it).
    pub(crate) fn runs(&self) -> Vec<String> {
        self.0.lock().unwrap().pending.iter().cloned().collect()
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
        let event = RunEvent::Status { status: RunStatus::Running, step: t!("{from} 打断并追加", from = from) };
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

    /// Asks the adapter to stop a live background task of `run_id`; its end arrives as a task update.
    pub(crate) fn stop_task(&self, run_id: &str, task_id: &str) -> bool {
        let s = self.0.lock().unwrap();
        let (Some(t), Some(cx)) = (s.tasks.get(task_id), s.agent.as_ref()) else { return false };
        if t.run_id != run_id || t.snap.ended() {
            return false;
        }
        let params = serde_json::json!({ "sessionId": t.session, "asyncTaskId": task_id });
        let Ok(req) = UntypedMessage::new(ASYNC_TASK_STOP, params) else { return false };
        let cx = cx.clone();
        tokio::spawn(async move {
            if let Err(e) = cx.send_request(req).block_task().await {
                tracing::warn!("stopping a background task failed: {e}");
            }
        });
        true
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
        let who = answered_by.unwrap_or(t!("群成员"));
        let step = match (&q.reply, answers) {
            (Reply::Agent(_), Some(_)) => t!("{who} 已回答", who = who),
            (Reply::Agent(_), None) => t!("无人回答，agent 按推荐项继续").into(),
            (Reply::Dir(_), Some(a)) if workspace::parallel(a) => t!("{who} 确认并行运行", who = who),
            (Reply::Dir(_), Some(_)) => t!("{who} 选择排队，等待工作区空闲", who = who),
            (Reply::Dir(_), None) => t!("无人确认，等待工作区空闲").into(),
        };
        let event = RunEvent::Status { status: RunStatus::Running, step };
        out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
        match q.reply {
            Reply::Agent(tx) => {
                let _ = tx.send(ask::format_answers(&q.questions, answers, attachments, answered_by));
            }
            Reply::Dir(tx) => {
                let _ = tx.send(answers.is_some_and(workspace::parallel));
            }
        }
        true
    }

    /// Asks the group whether the active turn may start beside the other turns in its directory (spec §4.3).
    pub(crate) fn confirm_dir(&self, question: Question) -> Option<(String, oneshot::Receiver<bool>)> {
        let mut s = self.0.lock().unwrap();
        s.requests += 1;
        let n = s.requests;
        let (run_id, out) = s.active.as_ref().map(|a| (a.run_id.clone(), a.out.clone()))?;
        let step = t!("等待确认：同一工作区有其他会话在运行").to_string();
        out.send(DaemonToServer::RunEvent {
            run_id: run_id.clone(),
            event: RunEvent::Status { status: RunStatus::AwaitingAnswer, step },
        });
        let request_id = format!("{run_id}/dir{n}");
        let questions = vec![question];
        out.send(DaemonToServer::QuestionAsk { run_id, request_id: request_id.clone(), questions: questions.clone() });
        let (tx, rx) = oneshot::channel();
        s.questions.insert(request_id.clone(), Asked { questions, reply: Reply::Dir(tx) });
        Some((request_id, rx))
    }

    /// Takes back a question nobody answered, e.g. the directory freed up first.
    pub(crate) fn withdraw(&self, request_id: &str, step: &str) {
        let mut s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref() else { return };
        let (run_id, out) = (a.run_id.clone(), a.out.clone());
        if s.questions.remove(request_id).is_none() {
            return;
        }
        out.send(DaemonToServer::QuestionWithdraw { run_id: run_id.clone(), request_id: request_id.into() });
        let event = RunEvent::Status { status: RunStatus::Running, step: step.into() };
        out.send(DaemonToServer::RunEvent { run_id, event });
    }

    /// Applies the owner's decision to a pending request of `run_id`; false if there is none (e.g. already void).
    pub(crate) fn decide(&self, run_id: &str, request_id: &str, option_id: Option<String>) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(out) = s.active.as_ref().filter(|a| a.run_id == run_id).map(|a| a.out.clone()) else { return false };
        let Some(p) = s.approvals.remove(request_id) else { return false };
        let choice = option_id.and_then(|id| p.options.into_iter().find(|o| *o.option_id.0 == *id));
        if let Some(command) =
            p.command.filter(|_| choice.as_ref().is_some_and(|o| o.kind == PermissionOptionKind::AllowAlways))
        {
            s.always.extend(local::remembered(&command));
        }
        let allowed = choice
            .as_ref()
            .is_some_and(|o| matches!(o.kind, PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways));
        let step = if allowed {
            t!("已批准：{title}", title = p.title)
        } else {
            t!("请求被拒绝，agent 自行绕路").into()
        };
        let event = RunEvent::Status { status: RunStatus::Running, step };
        out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
        let _ = p.tx.send(choice.map(|o| o.option_id));
        true
    }

    /// The owner changed the bot's effective tier mid-run; raised to `full`, pending requests are allowed at once.
    pub(crate) fn set_tier(&self, run_id: &str, tier: Tier) -> bool {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        let Some(a) = s.active.as_mut().filter(|a| a.run_id == run_id) else { return false };
        a.tier = tier;
        if tier == Tier::Full {
            let prefix = format!("{run_id}/");
            let ids: Vec<_> = s.approvals.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
            for id in ids {
                let p = s.approvals.remove(&id).unwrap();
                let step = t!("档位已切换为「完全访问」，自动批准：{title}", title = p.title);
                let event = RunEvent::Status { status: RunStatus::Running, step };
                a.out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
                let _ = p.tx.send(auto_allow(&p.options));
            }
        }
        true
    }

    /// Makes `req` the active turn, or reports it interrupted if it was cancelled while queued.
    fn begin(&self, req: &mut TurnReq) -> bool {
        let mut s = self.0.lock().unwrap();
        let run_id = &req.start.run_id;
        if s.cancelled.remove(run_id) {
            s.pending.remove(run_id);
            req.out.send(done(run_id, RunOutcome::Interrupted, Turn::default(), None, None, None, None));
            return false;
        }
        s.last = None;
        // Ended tasks linger one turn: adapters may report a terminal edge twice (stopped, then completed).
        s.tasks.retain(|_, t| !t.snap.ended());
        s.active = Some(Active {
            run_id: run_id.clone(),
            cwd: req.cwd.clone(),
            key: (req.start.group_id.clone(), req.start.bot.id.clone()),
            tier: req.start.bot.tier,
            rules: Rules::from(&req.start.bot),
            out: req.out.clone(),
            turn: Turn::default(),
            streaming: false,
            git: None,
            sync: req.sync.take(),
            sealed: false,
        });
        true
    }

    /// Arms change tracking for a repo workspace; the tree is never fetched or moved before a turn.
    async fn pre_turn(&self, req: &TurnReq) {
        if !git::is_repo(&req.cwd) {
            return;
        }
        match git::snapshot(&req.cwd).await {
            Ok(snap) => {
                let kind =
                    if req.start.workspace.cd_path.is_none() { WorkspaceKind::Managed } else { WorkspaceKind::Cd };
                if let Some(a) = self.0.lock().unwrap().active.as_mut() {
                    a.git = Some(GitTurn { cwd: req.cwd.clone(), kind, snap });
                }
            }
            Err(e) => tracing::warn!("git snapshot failed: {e}"),
        }
    }

    /// How the active turn ends, as `finish` will report it; `result` is the prompt's (Err = it failed).
    fn ending(&self, result: Result<&PromptResponse, ()>) -> RunOutcome {
        let s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref() else { return RunOutcome::Failed };
        let cancelled = s.cancelled.contains(&a.run_id);
        match result {
            Ok(resp) if !cancelled && (a.turn.failure.is_some() || session_failure(resp.meta.as_ref()).is_some()) => {
                RunOutcome::Failed
            }
            Ok(resp) if cancelled || resp.stop_reason == StopReason::Cancelled => RunOutcome::Interrupted,
            Ok(_) => RunOutcome::Completed,
            Err(()) if cancelled => RunOutcome::Interrupted,
            Err(()) => RunOutcome::Failed,
        }
    }

    /// Records the workspace's git state, the paths changed since `pre_turn` and their patch on the active turn, then
    /// (force group) settles the turn's changes by how it ended, so run.done reports them settled.
    async fn post_turn(&self, outcome: RunOutcome) {
        let Some((run_id, git, sync)) =
            self.0.lock().unwrap().active.as_mut().map(|a| (a.run_id.clone(), a.git.take(), a.sync.take()))
        else {
            return;
        };
        // Before the submit: catching up afterwards writes the others' changes into the tree.
        if let Some(g) = git {
            let result = async {
                Ok::<_, String>((git::status(&g.cwd, g.kind).await?, git::changed_since(&g.cwd, &g.snap).await?))
            };
            let patch =
                git::patch_since(&g.cwd, &g.snap).await.inspect_err(|e| tracing::warn!("git patch failed: {e}"));
            let git = result.await.inspect_err(|e| tracing::warn!("git post-turn failed: {e}")).ok();
            let mut s = self.0.lock().unwrap();
            if let Some(a) = s.active.as_mut() {
                a.turn.patch = git.as_ref().and(patch.ok().flatten());
                a.turn.git = git;
            }
            s.last = Some((run_id, g));
        }
        if let Some(sync) = sync {
            let done = sync.finish(outcome).await;
            if let Some(a) = self.0.lock().unwrap().active.as_mut() {
                a.turn.sync = Some(done);
            }
        }
    }

    /// What the live turn `run_id` changed so far; None when it is not this conversation's active turn.
    pub(crate) async fn live_patch(&self, run_id: &str) -> Option<Result<Option<String>, String>> {
        let git = {
            let s = self.0.lock().unwrap();
            let a = s.active.as_ref().filter(|a| a.run_id == run_id)?;
            a.git.as_ref().map(|g| (g.cwd.clone(), g.snap.clone()))
        };
        let Some((cwd, snap)) = git else { return Some(Err(not_git().into())) };
        Some(git::patch_since(&cwd, &snap).await)
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
        s.agent = Some(cx.clone());
        let Some(a) = s.active.as_mut() else { return };
        a.streaming = true;
        let run_id = a.run_id.clone();
        if s.cancelled.contains(&run_id) {
            send_cancel(&s);
        }
    }

    /// `session/update` parsed by hand: the draft subagent / async-task updates are unknown to the schema crate.
    fn on_raw(&self, params: serde_json::Value) {
        let session = params.get("sessionId").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        if let Some(update) = params.get("update")
            && update.get("sessionUpdate").and_then(|t| t.as_str()).is_some_and(ExtUpdate::is_ext)
            && let Ok(ext) = ExtUpdate::deserialize(update)
        {
            return self.on_ext(&session, ext);
        }
        match serde_json::from_value::<SessionNotification>(params) {
            Ok(n) => self.on_update(n),
            Err(e) => tracing::debug!("ignored session/update: {e}"),
        }
    }

    fn on_ext(&self, session: &str, ext: ExtUpdate) {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        let active = s.active.as_mut().filter(|a| a.streaming);
        let patch = match ext {
            ExtUpdate::AsyncTaskSpawned(p) | ExtUpdate::AsyncTaskProgress(p) | ExtUpdate::AsyncTaskStateUpdate(p) => p,
            sub => {
                if let Some(a) = active
                    && let Some(event) = a.turn.subagent(session, sub)
                {
                    a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
                }
                return;
            }
        };
        let id = patch.async_task_id.clone();
        if !s.tasks.contains_key(&id) {
            let Some(a) = active else { return };
            let task = Task {
                run_id: a.run_id.clone(),
                out: a.out.clone(),
                session: session.to_string(),
                snap: TaskSnap::new(a.turn.agent_of(session)),
            };
            s.tasks.insert(id.clone(), task);
        }
        let t = s.tasks.get_mut(&id).unwrap();
        let event = t.snap.patch(patch);
        t.out.send(DaemonToServer::RunEvent { run_id: t.run_id.clone(), event });
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
            && let Some(event) = a.turn.apply(&n.session_id.0, n.update)
        {
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
    }

    /// Plan D15: `full` allows by itself, then the bot's rules (applied here); anything else goes to the bot owner.
    fn on_permission(&self, req: RequestPermissionRequest) -> Permission {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        s.requests += 1;
        let n = s.requests;
        let Some(a) = s.active.as_mut() else { return Permission::Now(permission_response(None)) };
        // The built-in gonggong tools only ask or read the group: never an owner decision (spec §8.8).
        if req.tool_call.fields.title.as_deref().is_some_and(ask::is_builtin) {
            return Permission::Now(permission_response(auto_allow(&req.options)));
        }
        let command = command_of(req.tool_call.fields.raw_input.as_ref());
        let Some(RunEvent::Tool { title, tool_kind, detail, .. }) =
            a.turn.apply(&req.session_id.0, SessionUpdate::ToolCallUpdate(req.tool_call))
        else {
            unreachable!("tool call updates always map to tool events")
        };
        let command = command.filter(|_| tool_kind == "execute");
        match a.rules.decide(a.tier, command.as_deref(), &a.cwd, &s.always) {
            Decision::Full => return Permission::Now(permission_response(auto_allow(&req.options))),
            Decision::Local if let Some(allow) = auto_allow(&req.options) => {
                let step = t!("已按命令审批规则自动批准：{command}", command = command.unwrap_or(title));
                let event = RunEvent::Status { status: RunStatus::Running, step };
                a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
                return Permission::Now(permission_response(Some(allow)));
            }
            _ => {}
        }
        let (run_id, out) = (a.run_id.clone(), a.out.clone());
        let event =
            RunEvent::Status { status: RunStatus::AwaitingApproval, step: t!("等待审批：{title}", title = title) };
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
        s.approvals.insert(request_id, Approval { title, command, options: req.options, tx });
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
        sync: turn.sync,
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

/// The shell command of a tool call's raw input: a string (Claude, Codex) or an argv array.
fn command_of(raw: Option<&serde_json::Value>) -> Option<String> {
    match raw?.get("command")? {
        serde_json::Value::String(c) => Some(c.clone()),
        serde_json::Value::Array(argv) => Some(argv.iter().filter_map(|a| a.as_str()).collect::<Vec<_>>().join(" ")),
        _ => None,
    }
}

/// The adapters' "use your own default" row, left out of catalogs: `None` means the same.
const ADAPTER_DEFAULT: &str = "default";

fn named(choices: Vec<Choice>) -> Vec<Choice> {
    choices.into_iter().filter(|c| c.value != ADAPTER_DEFAULT).collect()
}

/// Thought levels on offer and the current one.
fn efforts(options: &[SessionConfigOption]) -> (Vec<Choice>, Option<String>) {
    select(options, &SessionConfigOptionCategory::ThoughtLevel).map_or((vec![], None), |(_, current, choices)| {
        (named(choices), Some(current).filter(|v| v != ADAPTER_DEFAULT))
    })
}

/// What an adapter offers: a throwaway session in `cwd`, switched through every model to read its thought levels.
/// Nothing is prompted.
pub(crate) async fn probe(agent: AcpAgent, cwd: &std::path::Path) -> Result<AgentCatalog, String> {
    Client
        .builder()
        .connect_with(agent, async |cx: ConnectionTo<Agent>| {
            let init = InitializeRequest::new(ProtocolVersion::V1)
                .client_capabilities(ClientCapabilities::new().meta(client_meta()));
            cx.send_request(init).block_task().await?;
            let res = cx.send_request(NewSessionRequest::new(cwd)).block_task().await?;
            let options = res.config_options.unwrap_or_default();
            let (start_efforts, start_effort) = efforts(&options);
            let Some((id, current, models)) = select(&options, &SessionConfigOptionCategory::Model) else {
                return Ok(AgentCatalog { efforts: start_efforts, effort: start_effort, ..Default::default() });
            };
            let mut list = vec![];
            for choice in named(models) {
                let value = SessionConfigValueId::new(choice.value.clone());
                let set = SetSessionConfigOptionRequest::new(res.session_id.clone(), id.clone(), value);
                let (efforts, effort) = efforts(&cx.send_request(set).block_task().await?.config_options);
                list.push(ModelChoice { choice, efforts, effort });
            }
            Ok(AgentCatalog {
                models: list,
                current: Some(current).filter(|v| v != ADAPTER_DEFAULT),
                efforts: start_efforts,
                effort: start_effort,
            })
        })
        .await
        .map_err(|e| describe(&e))
}

/// A select option of the given category: (config id, current value, choices).
fn select(
    options: &[SessionConfigOption],
    category: &SessionConfigOptionCategory,
) -> Option<(String, String, Vec<Choice>)> {
    options.iter().filter(|o| o.category.as_ref() == Some(category)).find_map(|o| {
        let SessionConfigKind::Select(sel) = &o.kind else { return None };
        let choices = match &sel.options {
            SessionConfigSelectOptions::Ungrouped(list) => list.iter().collect::<Vec<_>>(),
            SessionConfigSelectOptions::Grouped(groups) => groups.iter().flat_map(|g| &g.options).collect(),
            _ => vec![],
        };
        let choices = choices
            .into_iter()
            .map(|c| Choice { value: c.value.0.to_string(), name: c.name.clone(), description: c.description.clone() })
            .collect();
        Some((o.id.0.to_string(), sel.current_value.0.to_string(), choices))
    })
}

impl Asker for Shared {
    fn ask(&self, questions: Vec<Question>) -> Result<(String, oneshot::Receiver<String>), String> {
        let mut s = self.0.lock().unwrap();
        s.requests += 1;
        let n = s.requests;
        let Some(a) = s.active.as_ref().filter(|a| a.streaming && !a.sealed) else {
            return Err("当前没有进行中的运行，无法提问".into());
        };
        let (run_id, out) = (a.run_id.clone(), a.out.clone());
        let step = t!("等待回答：{n} 个问题", n = questions.len());
        out.send(DaemonToServer::RunEvent {
            run_id: run_id.clone(),
            event: RunEvent::Status { status: RunStatus::AwaitingAnswer, step },
        });
        let request_id = format!("{run_id}/q{n}");
        out.send(DaemonToServer::QuestionAsk { run_id, request_id: request_id.clone(), questions: questions.clone() });
        let (tx, rx) = oneshot::channel();
        s.questions.insert(request_id.clone(), Asked { questions, reply: Reply::Agent(tx) });
        Ok((request_id, rx))
    }

    fn abandon(&self, request_id: &str) {
        self.withdraw(request_id, t!("agent 已不再等待回答，提问作废"));
    }

    fn active_run(&self) -> Option<(String, PathBuf)> {
        let s = self.0.lock().unwrap();
        s.active.as_ref().filter(|a| a.streaming && !a.sealed).map(|a| (a.run_id.clone(), a.cwd.clone()))
    }

    fn scope(&self) -> Option<Scope> {
        let s = self.0.lock().unwrap();
        s.active.as_ref().filter(|a| a.streaming && !a.sealed).map(|a| Scope {
            group_id: a.key.0.clone(),
            bot_id: a.key.1.clone(),
            run_id: Some(a.run_id.clone()),
            root: a.cwd.clone(),
            out: a.out.clone(),
        })
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
    let mut next: Option<Planned> = None;
    loop {
        let turn = match next.take() {
            Some(turn) => turn,
            None => match rx.recv().await {
                Some(req) => match plan(&engine, &shared, req) {
                    Some(turn) => turn,
                    None => continue,
                },
                None => break,
            },
        };
        let result = match engine.adapter(&turn.req.start.bot, &turn.req.local, &turn.selection).await {
            Ok(config) => connect(&engine, &shared, &ask, AcpAgent::new(config), turn, &mut rx, &mut resume).await,
            Err(e) => Err(format!("{e:#}")),
        };
        // Its background tasks went with the adapter process.
        {
            let mut s = shared.0.lock().unwrap();
            s.agent = None;
            s.tasks.clear();
        }
        // A turn still active here was cut short by the adapter exiting or failing to start.
        let error = match result {
            // The next turn runs on another provider (or revision): a new adapter process takes it (§4.4).
            Ok(Some(turn)) => {
                next = Some(turn);
                continue;
            }
            Ok(None) => t!("agent 进程意外退出").into(),
            Err(e) => e,
        };
        if shared.0.lock().unwrap().active.is_some() {
            tracing::warn!("adapter ended mid-turn: {error}");
            shared.post_turn(shared.ending(Err(()))).await;
            shared.finish(Err(error), resume.as_ref(), None);
        }
    }
}

/// Runs turns on one adapter process until it idles out or the next turn needs another provider (returned).
async fn connect(
    engine: &Inner,
    shared: &Arc<Shared>,
    ask: &acp::McpServer,
    agent: AcpAgent,
    first: Planned,
    rx: &mut mpsc::UnboundedReceiver<TurnReq>,
    resume: &mut Option<SessionId>,
) -> Result<Option<Planned>, String> {
    let (on_update, on_permission) = (shared.clone(), shared.clone());
    Client
        .builder()
        .on_receive_notification(
            async move |n: UntypedMessage, cx| {
                if n.method != "session/update" {
                    return Ok(Handled::No { message: (n, cx), retry: false });
                }
                on_update.on_raw(n.params);
                Ok(Handled::Yes)
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
                agent = %init.agent_info.as_ref().map_or_else(|| "unknown".into(), |i| format!("{} {}", i.name, i.version)),
                load = caps.load_session,
                resume = caps.session_capabilities.resume.is_some(),
                image = caps.prompt_capabilities.image,
                "adapter initialized"
            );
            let mut conv = Conversation {
                cx: &cx,
                init: &init,
                shared,
                ask,
                home: &engine.config.home,
                selection: first.selection.clone(),
                session: None,
                mode: None,
                options: vec![],
                initial: HashMap::new(),
                applied: HashMap::new(),
            };
            let mut turn = first;
            loop {
                {
                    let _dir = engine.workspaces.occupy(&turn.req, shared).await;
                    conv.turn(turn.req, turn.removed, resume).await?;
                }
                turn = loop {
                    match tokio::time::timeout(engine.config.idle, rx.recv()).await {
                        Ok(Some(next)) => match plan(engine, shared, next) {
                            Some(turn) => break turn,
                            None => continue,
                        },
                        Ok(None) | Err(_) => return Ok(None),
                    }
                };
                if turn.selection != conv.selection {
                    return Ok(Some(turn));
                }
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
    home: &'a Path,
    /// The provider this adapter process was started with.
    selection: Selection,
    session: Option<SessionId>,
    mode: Option<String>,
    /// The session's config options as last reported, their values when it was opened, and the values we set
    /// (by config id; adapters may report a set alias under its canonical id).
    options: Vec<SessionConfigOption>,
    initial: HashMap<String, String>,
    applied: HashMap<String, String>,
}

impl Conversation<'_> {
    /// Runs one prompt turn. Only transport-level failures are returned (they tear the adapter down).
    /// `removed`: the session to resume lost its provider, so a new one is started.
    async fn turn(
        &mut self,
        req: TurnReq,
        removed: bool,
        resume: &mut Option<SessionId>,
    ) -> Result<(), agent_client_protocol::Error> {
        let s = &req.start;
        // The server owns the session id: reuse the live one only if it asks for it (/new sends none).
        let wanted = s.resume_session_id.clone().filter(|_| !removed).map(SessionId::new);
        let context = (&s.prompt.context, s.prompt.omitted);
        let (session, reason, (history, omitted)) = match self.session.clone().filter(|id| wanted.as_ref() == Some(id))
        {
            Some(id) => (id, None, context),
            None => match self.open(&req, wanted).await {
                Ok((id, reason)) => {
                    let reason = if removed { Some(PROVIDER_REMOVED.into()) } else { reason };
                    // `context` only reaches back to the previous run: a new session needs the recent history.
                    let history = if matches!(reason.as_deref(), Some(RESUME_FAILED | PROVIDER_REMOVED)) {
                        (&s.prompt.fallback_context, 0)
                    } else {
                        context
                    };
                    // New sessions keep the provider they start with (§4.3): recorded before the agent is prompted.
                    if reason.is_some()
                        && let Err(e) = self.pin(&req, &id)
                    {
                        self.shared.finish(Err(e), None, None);
                        return Ok(());
                    }
                    (id, reason, history)
                }
                Err(e) => {
                    self.shared.finish(Err(t!("无法建立 agent 会话：{e}", e = describe(&e))), None, None);
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
        self.configure(&req, &session).await;
        // Before streaming, so a /stop during the fetch still cancels the prompt.
        self.shared.pre_turn(&req).await;
        self.shared.stream(self.cx, &session);
        let text = s.command.clone().unwrap_or_else(|| {
            let prompt = compose_prompt(&s.prompt, history, omitted);
            match s.sync.as_ref().and_then(|sync| sync_hint(sync, req.behind)) {
                Some(hint) => format!("{hint}\n\n{prompt}"),
                None => prompt,
            }
        });
        let image = self.init.agent_capabilities.prompt_capabilities.image;
        let mut blocks = attachments::prompt_blocks(&req.cwd, text, &s.prompt.attachments, image).await;
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
                    blocks = attachments::prompt_blocks(&req.cwd, text, &files, image).await;
                }
                _ => break result,
            }
        };
        match result {
            // The adapter died: leave the turn active so the caller reports the exit status and stderr instead.
            Err(e) if agent_client_protocol::is_incoming_transport_closed(&e) => Err(e),
            result => {
                let error = result.as_ref().err().cloned();
                self.shared.post_turn(self.shared.ending(result.as_ref().map_err(drop))).await;
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
                Ok((modes, options)) => {
                    self.set_modes(modes);
                    self.set_options(options.unwrap_or_default());
                    return Ok((id, None));
                }
                Err(e) => tracing::info!("resuming session {} failed: {e}", id.0),
            }
        }
        let servers = mcp_servers_for(&req.start, self.ask);
        let new = NewSessionRequest::new(&req.cwd).mcp_servers(servers).meta(meta);
        let res = self.cx.send_request(new).block_task().await?;
        self.set_modes(res.modes);
        self.set_options(res.config_options.unwrap_or_default());
        let reason =
            if tried { RESUME_FAILED.into() } else { req.start.new_session_reason.clone().unwrap_or("first".into()) };
        Ok((res.session_id, Some(reason)))
    }

    async fn restore(
        &self,
        id: &SessionId,
        req: &TurnReq,
        meta: Option<Meta>,
    ) -> Result<(Option<SessionModeState>, Option<Vec<SessionConfigOption>>), agent_client_protocol::Error> {
        let caps = &self.init.agent_capabilities;
        let servers = mcp_servers_for(&req.start, self.ask);
        if caps.session_capabilities.resume.is_some() {
            let req = ResumeSessionRequest::new(id.clone(), &req.cwd).mcp_servers(servers).meta(meta);
            let res = self.cx.send_request(req).block_task().await?;
            Ok((res.modes, res.config_options))
        } else if caps.load_session {
            let req = LoadSessionRequest::new(id.clone(), &req.cwd).mcp_servers(servers).meta(meta);
            let res = self.cx.send_request(req).block_task().await?;
            Ok((res.modes, res.config_options))
        } else {
            Err(agent_client_protocol::Error::method_not_found())
        }
    }

    /// Records the session's current mode so the first turn switches it to the tier's mode (D21) when offered.
    fn set_modes(&mut self, modes: Option<SessionModeState>) {
        self.mode = modes.map(|m| m.current_mode_id.0.to_string());
    }

    fn set_options(&mut self, options: Vec<SessionConfigOption>) {
        self.initial = [SessionConfigOptionCategory::Model, SessionConfigOptionCategory::ThoughtLevel]
            .iter()
            .filter_map(|c| select(&options, c))
            .map(|(id, current, _)| (id, current))
            .collect();
        self.applied.clear();
        self.options = options;
    }

    /// Switches the session to the requested model and effort (else the session's initial values) when they differ
    /// from the current ones, then reports what is in effect. Model first: switching it may change the effort levels
    /// on offer and reset the effort set before.
    async fn configure(&mut self, req: &TurnReq, session: &SessionId) {
        let bot = &req.start.bot;
        // A third-party provider only serves its own models; its default one is injected with the process, and the
        // adapter's catalog may not list it.
        let (model, injected) = match &self.selection {
            Selection::Official(_) => (bot.model.clone(), None),
            Selection::Provider(p) => {
                let model = inject::model(p, bot.model.as_deref());
                let injected = model.clone().filter(|m| p.model.as_ref() == Some(m));
                (model, injected)
            }
        };
        let unlisted = |options: &[SessionConfigOption]| {
            injected.clone().filter(|m| {
                select(options, &SessionConfigOptionCategory::Model)
                    .is_none_or(|(.., c)| c.iter().all(|c| c.value != *m))
            })
        };
        let wanted = [
            (SessionConfigOptionCategory::Model, t!("模型"), &model),
            (SessionConfigOptionCategory::ThoughtLevel, t!("推理强度"), &bot.effort),
        ];
        for (category, label, want) in wanted {
            let Some((id, current, choices)) = select(&self.options, &category) else {
                if let Some(want) = want {
                    tracing::warn!("the adapter offers no {category:?} option; ignoring {want}");
                }
                continue;
            };
            let Some(target) = want.clone().or_else(|| self.initial.get(&id).cloned()) else { continue };
            if current == target
                || self.applied.get(&id) == Some(&target)
                || (category == SessionConfigOptionCategory::Model && unlisted(&self.options).is_some())
            {
                continue;
            }
            let set = SetSessionConfigOptionRequest::new(
                session.clone(),
                id.clone(),
                SessionConfigValueId::new(target.clone()),
            );
            let step = match self.cx.send_request(set).block_task().await {
                Ok(res) => {
                    self.options = res.config_options;
                    let name = choices.iter().find(|c| c.value == target).map_or(target.as_str(), |c| &c.name);
                    let step = t!("已切换{label}：{name}", label = label, name = name);
                    if category == SessionConfigOptionCategory::Model {
                        self.applied.clear();
                    }
                    self.applied.insert(id, target);
                    step
                }
                Err(e) => t!("{label} {target} 不可用：{e}", label = label, target = target, e = describe(&e)),
            };
            let event = RunEvent::Status { status: RunStatus::Running, step };
            req.out.send(DaemonToServer::RunEvent { run_id: req.start.run_id.clone(), event });
        }
        let in_effect = |category| {
            let (id, current, _) = select(&self.options, &category)?;
            Some(self.applied.get(&id).cloned().unwrap_or(current)).filter(|v| v != ADAPTER_DEFAULT)
        };
        req.out.send(DaemonToServer::SessionConfig {
            run_id: req.start.run_id.clone(),
            model: unlisted(&self.options).or_else(|| in_effect(SessionConfigOptionCategory::Model)),
            effort: in_effect(SessionConfigOptionCategory::ThoughtLevel),
        });
    }

    /// Claude reads the per-session system prompt and the provider's settings file (written with the process) from
    /// `_meta`, on every new, resume and load: a resume without it falls back to the user's config. Codex gets both
    /// per process.
    fn meta(&self, start: &RunStart) -> Option<Meta> {
        if start.bot.agent_kind != AgentKind::Claude {
            return None;
        }
        let mut meta = Meta::new();
        meta.insert("systemPrompt".into(), serde_json::json!({ "append": system_prompt(&start.bot) }));
        let settings = match &self.selection {
            Selection::Provider(p) => Some(&p.id[..]),
            Selection::Official(o) => (!o.is_empty()).then_some(OFFICIAL),
        };
        if let Some(id) = settings {
            let settings = inject::claude_settings_path(self.home, id);
            meta.insert("claudeCode".into(), serde_json::json!({ "options": { "settings": settings } }));
        }
        Some(meta)
    }

    fn pin(&self, req: &TurnReq, session: &SessionId) -> Result<(), String> {
        let s = &req.start;
        Store::update(self.home, |store| {
            store.pin(&session.0, s.bot.agent_kind, &s.group_id, &s.bot.id, &self.selection);
            Ok(())
        })
        .map_err(|e| t!("无法记录会话使用的供应商：{e}", e = format!("{e:#}")))
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
