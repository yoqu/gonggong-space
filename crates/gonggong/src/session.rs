//! One (group, bot) conversation: owns the adapter process, the ACP session and its turns (one at a time).
use crate::agent_settings;
use crate::agents;
use crate::antigravity;
use crate::artifacts;
use crate::ask::{self, Asker};
use crate::attachments;
use crate::config::Config;
use crate::engine::{Continuation, Inner, Process};
use crate::git;
use crate::hosted::Scope;
use crate::inject;
use crate::ledger::Ledger;
use crate::local::{self, Decision, LocalSettings, Rules};
use crate::plugins;
use crate::protocol::{
    AgentCatalog, AgentCommand, AgentKind, Answer, ApprovalAiApproved, ApprovalMcp, ApprovalRequest, Attachment,
    AutoSource, Choice, DaemonToServer, McpCall, McpServer, ModelChoice, Question, RunDone, RunEvent, RunOutcome,
    RunStart, RunStatus, SecretEnv, Tier, Usage, WorkspaceKind,
};
use crate::providers::{RunPlan, Selection, Store};
use crate::replicas::SyncTurn;
use crate::service::Outbox;
use crate::skills;
use crate::t;
use crate::turn::{
    CompactPolicy, ExtUpdate, TaskSnap, Turn, auto_allow, auto_review_failure, builtin_mode, client_capabilities,
    compose_prompt, mode_for, session_failure, sync_hint, system_prompt, wire_options,
};
use crate::workspace;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    self as acp, CancelNotification, EnvVariable, ForkSessionRequest, HttpHeader, InitializeRequest,
    InitializeResponse, LoadSessionRequest, McpServerHttp, McpServerStdio, Meta, NewSessionRequest, PermissionOption,
    PermissionOptionId, PermissionOptionKind, PromptRequest, PromptResponse, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest, SelectedPermissionOutcome,
    SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOptions,
    SessionConfigValueId, SessionId, SessionModeState, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, SetSessionModeRequest, StopReason, Usage as AcpUsage,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo, Handled, JsonRpcRequest, UntypedMessage};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::{Notify, mpsc, oneshot};
use tokio::time::Instant;

const ERROR_MAX: usize = 800;
/// How long a continuation stays open after its agent is known to wait (`State::agent_idle`).
const SETTLE: std::time::Duration = std::time::Duration::from_secs(3);
const RESUME_FAILED: &str = "resume_failed";
/// The session to resume was pinned to a provider since deleted (§4.3).
const PROVIDER_REMOVED: &str = "provider_removed";

pub(crate) struct TurnReq {
    pub start: RunStart,
    pub cwd: PathBuf,
    /// The session's additional directories (ACP additionalDirectories), existing absolute paths.
    pub extras: Vec<PathBuf>,
    pub out: Outbox,
    /// The owner's local settings as of this run.
    pub local: LocalSettings,
    /// Force group: the replica, caught up and held until the turn's changes are submitted.
    pub sync: Option<SyncTurn>,
    /// The version the replica is still at when catching up before the turn failed.
    pub behind: Option<u64>,
    /// Artifacts left as they are because their local changes could not go up (told to the agent).
    pub artifact_hint: Option<String>,
}

/// An active turn and the provider it runs with.
struct Planned {
    req: TurnReq,
    selection: Selection,
    /// Its session's pinned provider is gone: start a new session instead of resuming.
    removed: bool,
    skills: skills::Installed,
    plugins: plugins::Installed,
    /// Claude only.
    launch: Option<inject::ClaudeLaunch>,
    /// The agent runs on its maker's service, where its built-in reviewer works (`agents::official_service`).
    official: bool,
}

/// Makes `req` the active turn and decides its provider from the store as of now, so CLI / desktop edits apply from
/// the next turn on. None: it will not run (cancelled while queued, or no provider to run with).
async fn plan(engine: &Inner, shared: &Shared, mut req: TurnReq) -> Option<Planned> {
    // A continuation still running ends (completed) before the turn starts.
    let begun = loop {
        shared.close_continuation().await;
        if let Some(begun) = shared.begin(&mut req) {
            break begun;
        }
    };
    if !begun {
        return None;
    }
    let (home, user_home) = (engine.config.home.clone(), engine.config.user_home.clone());
    let (mut bot, resume) = (req.start.bot.clone(), req.start.resume_session_id.clone());
    let protect_base = req.start.workspace.protect_base;
    let resolved = tokio::task::spawn_blocking(move || {
        let store = Store::load(&home)?;
        // A live adapter's file is rewritten (touched) each turn below, and adapters idle out after `idle`.
        inject::prune(&home, &store, Some(inject::STALE_SETTINGS));
        let (selection, removed) = match store.resolve_run(bot.agent_kind, &bot.id, resume.as_deref())? {
            RunPlan::Resume(selection) => (selection, false),
            RunPlan::New { selection, provider_removed } => (selection, provider_removed),
        };
        // The model the server sent (message, group, bot), else the machine default's for a bot inheriting it.
        bot.model = bot.model.or_else(|| store.inherited_model(bot.agent_kind, &bot.id, selection.key()));
        let mut official = agents::official_service_here(bot.agent_kind, &selection, &user_home, false);
        let launch = match bot.agent_kind {
            AgentKind::Claude => {
                let defaults = store.agent_settings(AgentKind::Claude);
                let cli = match selection.claude_profile() {
                    Some(dir) => agent_settings::read_claude_dir(dir, None),
                    None if defaults.inherit_cli => agent_settings::read_cli(&user_home, None),
                    None => None,
                };
                let mut launch = inject::ClaudeLaunch::new(&home, &selection, &defaults, &bot, cli.as_ref())?;
                official = agents::official_service_here(bot.agent_kind, &selection, &user_home, launch.inherit_cli);
                if protect_base && builtin_mode(bot.agent_kind, bot.tier, bot.ai_review, official).is_some() {
                    launch.ask_pushes(&home, selection.key());
                }
                launch.write()?;
                Some(launch)
            }
            _ => None,
        };
        anyhow::Ok((selection, removed, launch, official, bot.model))
    })
    .await
    .unwrap_or_else(|e| Err(e.into()));
    let (selection, removed, launch, official) = match resolved {
        Ok((selection, removed, launch, official, model)) => {
            req.start.bot.model = model;
            (selection, removed, launch, official)
        }
        Err(e) => {
            shared.finish(Err(format!("{e:#}")), None, None, None);
            return None;
        }
    };
    if let Some(l) = &launch {
        shared.set_compact(l.compact);
    }
    Some(Planned { req, selection, removed, skills: Default::default(), plugins: Default::default(), launch, official })
}

/// Installs the turn's team skills and plugins before its adapter is chosen. None: it fails (and is reported) instead.
async fn ready(engine: &Inner, shared: &Shared, mut turn: Planned) -> Option<Planned> {
    let Some(api) = &engine.config.api else { return Some(turn) };
    let s = &turn.req.start;
    let (home, kind, cwd) = (&engine.config.home, s.bot.agent_kind, &turn.req.cwd);
    let dir = skills::set_dir(home, &s.group_id, &s.bot.id);
    let installed = async {
        let skills = skills::install(api, &dir, kind, cwd, &s.skills, &s.hidden_tools).await?;
        let plugins = plugins::install(api, home, (&s.group_id, &s.bot.id), kind, cwd, &s.plugins).await?;
        Ok::<_, String>((skills, plugins))
    };
    match installed.await {
        Ok((skills, plugins)) => {
            if !skills.skipped.is_empty() {
                let step = t!("已跳过团队 skill {names}：仓库里已有同名 skill", names = skills.skipped.join("、"));
                let event = RunEvent::Status { status: RunStatus::Running, step };
                turn.req.out.send(DaemonToServer::RunEvent { run_id: s.run_id.clone(), event });
            }
            if !s.artifacts.is_empty() {
                let (prepared, hint) = artifacts::before_turn(api, home, s, cwd, &plugins.dirs, &turn.req.out).await;
                if let Some(a) = shared.0.lock().unwrap().active.as_mut() {
                    a.artifacts = prepared;
                }
                turn.req.artifact_hint = hint;
            }
            turn.req.start.mcp_servers.extend(plugins.mcp.iter().cloned());
            crate::mcp_tools::prefetch(&plugins.mcp, cwd);
            if let Some(a) = shared.0.lock().unwrap().active.as_mut() {
                a.mcp = turn.req.start.mcp_servers.clone();
                a.turn.mcp_servers = mcp_names(&a.mcp);
            }
            turn.skills = skills;
            turn.plugins = plugins;
            Some(turn)
        }
        Err(e) => {
            shared.finish(Err(e), None, None, None);
            None
        }
    }
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
    /// Set when the workspace or an additional directory is a repo.
    git: Option<GitTurn>,
    sync: Option<SyncTurn>,
    artifacts: Option<artifacts::Turn>,
    /// The last prompt has ended: no more appends (spec §8.9) are taken.
    sealed: bool,
    extras: Vec<PathBuf>,
    kind: WorkspaceKind,
    /// Set when this is the agent going on by itself between turns, not a prompt.
    continuation: Option<Cont>,
    hidden_tools: Vec<String>,
    /// The run's MCP servers (plugins' included), whose tools' own descriptions approval cards show.
    mcp: Vec<McpServer>,
    /// Set when the turn shares its directory and asks before its first change there.
    gate: Option<gate::Gate>,
}

/// A run the server opened for output between turns (a background task finished and the agent went on by itself).
struct Cont {
    session: SessionId,
    /// When it last reported anything.
    last: Instant,
    /// Being ended by whoever set this.
    concluding: bool,
}

/// The conversation's last run: output between turns continues it.
struct Prev {
    run_id: String,
    cwd: PathBuf,
    extras: Vec<PathBuf>,
    kind: WorkspaceKind,
    key: (String, String),
    tier: Tier,
    rules: Rules,
    out: Outbox,
    compact: Option<CompactPolicy>,
    session: Option<SessionId>,
    hidden_tools: Vec<String>,
    mcp: Vec<McpServer>,
}

impl Prev {
    fn of(a: &Active, session: Option<SessionId>) -> Self {
        Prev {
            run_id: a.run_id.clone(),
            cwd: a.cwd.clone(),
            extras: a.extras.clone(),
            kind: a.kind,
            key: a.key.clone(),
            tier: a.tier,
            rules: a.rules.clone(),
            out: a.out.clone(),
            compact: a.turn.compact,
            session,
            hidden_tools: a.hidden_tools.clone(),
            mcp: a.mcp.clone(),
        }
    }
}

/// Output between turns held while the server opens a run for it (`run.continue`).
struct Adopting {
    request_id: String,
    session: SessionId,
    held: Vec<Held>,
}

enum Held {
    Update(SessionNotification),
    Ext(String, ExtUpdate),
    Permission(RequestPermissionRequest, oneshot::Sender<Option<PermissionOptionId>>),
}

struct GitTurn {
    cwd: PathBuf,
    extras: Vec<PathBuf>,
    kind: WorkspaceKind,
    tracked: Vec<git::Tracked>,
}

/// State shared between the session task, ACP callbacks and the engine (for cancel).
/// The notify wakes a turn waiting for its directory, which must not outlive its own cancel.
#[derive(Default)]
pub(crate) struct Shared(Mutex<State>, Notify, Continuation);

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
    /// Rules the owner allowed always or for this session (本次会话不再问), trusted until a new session starts.
    always: Vec<String>,
    requests: u64,
    /// The last turn's snapshot (run id) if it did not complete, kept for run.discard until the next turn starts
    /// (plan D7).
    last: Option<(String, GitTurn)>,
    /// Ask-tool calls of the active turn awaiting the group, by request id.
    questions: HashMap<String, Asked>,
    /// 打断并追加 prompts (text, attachments) waiting for the cancelled prompt to end.
    appends: Vec<(String, Vec<Attachment>)>,
    /// Background tasks by id, reporting to the run that started them even after it ended.
    tasks: HashMap<String, Task>,
    /// Antigravity's subagents and background tasks (`antigravity`) by id, likewise.
    delegates: HashMap<String, Delegate>,
    /// Antigravity's main agent waits, as its transcript tells: a continuation it was in has ended.
    agent_idle: bool,
    prev: Option<Prev>,
    adopting: Option<Adopting>,
    /// The latest `current_mode_update`: an adapter reports the mode it fell back to (Claude `auto` → `acceptEdits`).
    mode_update: Option<String>,
    /// The latest `config_option_update` emitted by the adapter during a turn.
    config_options: Option<Vec<SessionConfigOption>>,
    /// A gate switching the session back to the bot's mode mid-turn (`gate`).
    restoring: Option<tokio::task::JoinHandle<Option<String>>>,
    /// What each ACP session's context is made of, as far as we saw it.
    ledgers: HashMap<String, Ledger>,
    /// A live snapshot of the active turn's context is due (`LIVE_EVERY`).
    live_due: bool,
}

struct Task {
    run_id: String,
    out: Outbox,
    /// ACP session that owns it, for `_session/async_task/stop`.
    session: String,
    snap: TaskSnap,
}

struct Delegate {
    run_id: String,
    out: Outbox,
    live: bool,
    /// Reported if the adapter process goes away while it is at work.
    orphan: Option<RunEvent>,
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
    /// What allow_always trusts from now on (`local::remember`).
    remember: Vec<String>,
    /// What 本次会话不再问 trusts until the session ends (`local::remember_session`).
    remember_session: Vec<String>,
    options: Vec<PermissionOption>,
    tx: oneshot::Sender<Option<PermissionOptionId>>,
}

/// How to answer an agent's permission request.
enum Permission {
    Now(Option<PermissionOptionId>),
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
    pub(crate) fn new(continuation: Continuation) -> Self {
        Shared(Mutex::default(), Notify::new(), continuation)
    }

    pub(crate) fn enqueue(&self, run_id: &str) {
        self.0.lock().unwrap().pending.insert(run_id.into());
    }

    /// Runs handed to this conversation that have not ended (the active turn and those queued behind it).
    pub(crate) fn runs(&self) -> Vec<String> {
        self.0.lock().unwrap().pending.iter().cloned().collect()
    }

    /// Nothing needs the conversation any more: no run, background task or open request, and no stopped turn whose
    /// changes may still be discarded.
    pub(crate) fn idle(&self) -> bool {
        let s = self.0.lock().unwrap();
        s.pending.is_empty()
            && s.active.is_none()
            && s.tasks.is_empty()
            && !s.delegates.values().any(|d| d.live)
            && s.approvals.is_empty()
            && s.questions.is_empty()
            && s.last.is_none()
            && s.adopting.is_none()
    }

    /// Something still comes from the adapter process between turns: a continuation, or a background task whose end
    /// the agent may go on from.
    pub(crate) fn holds_adapter(&self) -> bool {
        let s = self.0.lock().unwrap();
        s.active.is_some()
            || s.adopting.is_some()
            || s.tasks.values().any(|t| !t.snap.ended())
            || s.delegates.values().any(|d| d.live)
    }

    pub(crate) fn cancel(self: &Arc<Self>, run_id: &str) {
        let mut s = self.0.lock().unwrap();
        if !s.pending.contains(run_id) {
            return;
        }
        s.cancelled.insert(run_id.into());
        if s.active.as_ref().is_some_and(|a| a.run_id == run_id && a.streaming) {
            interrupt(&mut s);
            // No prompt answers a continuation's cancel: it ends now.
            if s.active.as_ref().is_some_and(|a| a.continuation.is_some()) {
                let (shared, run_id) = (self.clone(), run_id.to_string());
                tokio::spawn(async move { shared.conclude(&run_id, RunOutcome::Interrupted).await });
            }
        }
        // A permit is kept if nobody waits yet, so a turn checking `is_cancelled` right before waiting still wakes.
        self.1.notify_one();
    }

    pub(crate) fn is_cancelled(&self, run_id: &str) -> bool {
        self.0.lock().unwrap().cancelled.contains(run_id)
    }

    /// Wakes on any cancel, possibly of another run: re-check `is_cancelled` after it.
    pub(crate) async fn cancel_signal(&self) {
        self.1.notified().await
    }

    /// 打断并追加 (spec §8.9): cancels the current prompt; the turn then continues with `text` (see `take_append`).
    pub(crate) fn append(&self, run_id: &str, from: &str, text: &str, attachments: Vec<Attachment>) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref().filter(|a| a.run_id == run_id && !a.sealed && a.continuation.is_none()) else {
            return false;
        };
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

    fn take_mode_update(&self) -> Option<String> {
        self.0.lock().unwrap().mode_update.take()
    }

    fn take_config_options(&self) -> Option<Vec<SessionConfigOption>> {
        self.0.lock().unwrap().config_options.take()
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
        a.turn.clear_reply();
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
        confirm_in(&mut self.0.lock().unwrap(), question)
    }

    /// Reports what the active turn `run_id` is doing meanwhile, e.g. whom it waits for.
    pub(crate) fn status(&self, run_id: &str, step: String) {
        let s = self.0.lock().unwrap();
        let Some(a) = s.active.as_ref().filter(|a| a.run_id == run_id) else { return };
        let event = RunEvent::Status { status: RunStatus::Running, step };
        a.out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
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
    /// `session`: 本次会话不再问, the request's session rules are trusted until a new session starts.
    pub(crate) fn decide(&self, run_id: &str, request_id: &str, option_id: Option<String>, session: bool) -> bool {
        let mut s = self.0.lock().unwrap();
        let Some(out) = s.active.as_ref().filter(|a| a.run_id == run_id).map(|a| a.out.clone()) else { return false };
        let Some(p) = s.approvals.remove(request_id) else { return false };
        let choice = option_id.and_then(|id| p.options.into_iter().find(|o| *o.option_id.0 == *id));
        let allowed = choice
            .as_ref()
            .is_some_and(|o| matches!(o.kind, PermissionOptionKind::AllowOnce | PermissionOptionKind::AllowAlways));
        let trusted = match choice.as_ref().map(|o| o.kind) {
            Some(PermissionOptionKind::AllowAlways) => p.remember,
            _ if allowed && session => p.remember_session,
            _ => vec![],
        };
        for rule in trusted {
            if !s.always.contains(&rule) {
                s.always.push(rule);
            }
        }
        let step = if allowed {
            t!("已批准：{title}", title = p.title)
        } else {
            t!("请求被拒绝，Bot 会换个方式继续").into()
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
                let step = t!("审批方式已切换为「完全允许」，自动批准：{title}", title = p.title);
                let event = RunEvent::Status { status: RunStatus::Running, step };
                a.out.send(DaemonToServer::RunEvent { run_id: run_id.into(), event });
                let _ = p.tx.send(auto_allow(&p.options));
            }
        }
        true
    }

    /// A new agent session starts: what the owner allowed for the session ends with the old one.
    fn new_session(&self) {
        self.0.lock().unwrap().always.clear();
    }

    /// Makes `req` the active turn, or reports it interrupted if it was cancelled while queued. None: a continuation
    /// is active, to be closed first.
    fn begin(&self, req: &mut TurnReq) -> Option<bool> {
        let mut s = self.0.lock().unwrap();
        if s.active.as_ref().is_some_and(|a| a.continuation.is_some()) {
            return None;
        }
        // Output between turns from here on belongs to this turn.
        s.adopting = None;
        let run_id = &req.start.run_id;
        if s.cancelled.remove(run_id) {
            s.pending.remove(run_id);
            req.out.send(done(run_id, RunOutcome::Interrupted, Turn::default(), None, None, None, None, None));
            return Some(false);
        }
        s.last = None;
        // Ended tasks linger one turn: adapters may report a terminal edge twice (stopped, then completed).
        s.tasks.retain(|_, t| !t.snap.ended());
        s.active = Some(Active {
            run_id: run_id.clone(),
            cwd: req.cwd.clone(),
            key: (req.start.group_id.clone(), req.start.bot.id.clone()),
            tier: req.start.bot.tier,
            rules: Rules::from(&req.start),
            out: req.out.clone(),
            turn: Turn::with_mcp(mcp_names(&req.start.mcp_servers)),
            streaming: false,
            git: None,
            sync: req.sync.take(),
            artifacts: None,
            sealed: false,
            extras: req.extras.clone(),
            kind: if req.start.workspace.cd_path.is_none() { WorkspaceKind::Managed } else { WorkspaceKind::Cd },
            continuation: None,
            hidden_tools: req.start.hidden_tools.clone(),
            mcp: req.start.mcp_servers.clone(),
            gate: None,
        });
        crate::mcp_tools::prefetch(&req.start.mcp_servers, &req.cwd);
        Some(true)
    }

    /// Ends the active continuation, if any (completed), and drops output held for one.
    async fn close_continuation(&self) {
        loop {
            let open = {
                let mut s = self.0.lock().unwrap();
                s.adopting = None;
                s.active.as_ref().and_then(|a| Some((a.run_id.clone(), a.continuation.as_ref()?.concluding)))
            };
            match open {
                None => return,
                Some((run_id, false)) => self.conclude(&run_id, RunOutcome::Completed).await,
                // Being ended elsewhere.
                Some((_, true)) => tokio::time::sleep(std::time::Duration::from_millis(20)).await,
            }
        }
    }

    /// Ends the continuation `run_id` like a turn (its changes, reply and usage): `outcome` unless it was stopped or
    /// failed. Only the first caller ends it.
    async fn conclude(&self, run_id: &str, outcome: RunOutcome) {
        let failure = {
            let mut s = self.0.lock().unwrap();
            let Some(a) = s.active.as_mut().filter(|a| a.run_id == run_id) else { return };
            let Some(c) = a.continuation.as_mut().filter(|c| !c.concluding) else { return };
            c.concluding = true;
            a.turn.failure.clone()
        };
        let outcome = match (self.is_cancelled(run_id), &failure) {
            (true, _) => RunOutcome::Interrupted,
            (false, Some(_)) => RunOutcome::Failed,
            (false, None) => outcome,
        };
        self.post_turn(outcome).await;
        let mut s = self.0.lock().unwrap();
        s.conn = None;
        s.approvals.clear();
        s.questions.clear();
        let Some(a) = s.active.take() else { return };
        s.pending.remove(&a.run_id);
        s.cancelled.remove(&a.run_id);
        let session = a.continuation.as_ref().map(|c| c.session.clone());
        s.prev = Some(Prev::of(&a, session.clone()));
        let error = failure.filter(|_| outcome == RunOutcome::Failed).map(|e| truncate(&e));
        let session = session.map(|id| id.0.to_string());
        a.out.send(done(&a.run_id, outcome, a.turn, None, session, None, error, None));
    }

    /// Output between turns: asks the server for a run of the conversation to report it under (`run.continue`),
    /// holding it meanwhile. Needs `prev`.
    fn adopt(self: &Arc<Self>, s: &mut State, session: SessionId, first: Held) {
        let Some(prev) = s.prev.as_ref() else { return };
        s.requests += 1;
        let request_id = format!("{}/c{}", prev.run_id, s.requests);
        let after = prev.run_id.clone();
        prev.out.send(DaemonToServer::RunContinue { request_id: request_id.clone(), run_id: after.clone() });
        s.adopting = Some(Adopting { request_id: request_id.clone(), session, held: vec![first] });
        let (shared, wait) = (self.clone(), self.2.adopt_wait);
        tokio::spawn(async move {
            tokio::time::sleep(wait).await;
            let mut s = shared.0.lock().unwrap();
            if s.adopting.as_ref().is_some_and(|w| w.request_id == request_id) {
                tracing::warn!("the server opened no run for what the agent did after run {after}: dropped");
                s.adopting = None;
                // Until the next turn: an older server would be asked again and again.
                s.prev = None;
            }
        });
    }

    /// The server's answer to `run.continue` `request_id`: the held output goes to the run it opened. False: not
    /// asked here, or no longer waited for (the caller ends the run).
    pub(crate) fn adopted(self: &Arc<Self>, request_id: &str, run_id: Option<&str>) -> bool {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        if s.active.is_some() || !s.adopting.as_ref().is_some_and(|w| w.request_id == request_id) {
            return false;
        }
        let w = s.adopting.take().expect("checked above");
        let Some(run_id) = run_id else {
            tracing::warn!("the server opened no run for what the agent did between turns: dropped");
            s.prev = None;
            return true;
        };
        let (Some(prev), Some(agent)) = (s.prev.take(), s.agent.clone()) else { return false };
        let session = prev.session.clone().unwrap_or(w.session);
        s.pending.insert(run_id.into());
        s.conn = Some((agent, session.clone()));
        let mut turn = Turn::with_mcp(mcp_names(&prev.mcp));
        turn.compact = prev.compact;
        s.active = Some(Active {
            run_id: run_id.into(),
            cwd: prev.cwd.clone(),
            key: prev.key,
            tier: prev.tier,
            rules: prev.rules,
            out: prev.out,
            turn,
            streaming: true,
            git: None,
            sync: None,
            artifacts: None,
            sealed: false,
            extras: prev.extras.clone(),
            kind: prev.kind,
            continuation: Some(Cont { session, last: Instant::now(), concluding: false }),
            hidden_tools: prev.hidden_tools,
            mcp: prev.mcp,
            gate: None,
        });
        for held in w.held {
            match held {
                Held::Update(n) => self.update_in(s, n),
                Held::Ext(session, ext) => ext_in(s, &session, ext),
                Held::Permission(req, tx) => match permission_in(self, s, req) {
                    Permission::Now(choice) => {
                        let _ = tx.send(choice);
                    }
                    Permission::Ask(rx) => {
                        tokio::spawn(async move {
                            let _ = tx.send(rx.await.ok().flatten());
                        });
                    }
                },
            }
        }
        drop(guard);
        let (shared, id, cwd, extras, kind) = (self.clone(), run_id.to_string(), prev.cwd, prev.extras, prev.kind);
        tokio::spawn(async move {
            let tracked = git::track(&cwd, &extras).await;
            if tracked.is_empty() {
                return;
            }
            let mut s = shared.0.lock().unwrap();
            if let Some(a) = s.active.as_mut().filter(|a| a.run_id == id)
                && a.continuation.as_ref().is_some_and(|c| !c.concluding)
            {
                a.git = Some(GitTurn { cwd, extras, kind, tracked });
            }
        });
        let (shared, id, quiet) = (self.clone(), run_id.to_string(), self.2.quiet);
        tokio::spawn(async move {
            loop {
                let left = {
                    let mut guard = shared.0.lock().unwrap();
                    let s = &mut *guard;
                    let waiting = !s.approvals.is_empty() || !s.questions.is_empty();
                    let Some(c) = s.active.as_mut().filter(|a| a.run_id == id).and_then(|a| a.continuation.as_mut())
                    else {
                        return;
                    };
                    // Waiting on people is not silence.
                    if waiting {
                        c.last = Instant::now();
                    }
                    // An agent known to wait has ended the cycle once what it streamed has come.
                    let quiet = if s.agent_idle { SETTLE.min(quiet) } else { quiet };
                    quiet.saturating_sub(c.last.elapsed())
                };
                if left.is_zero() {
                    return shared.conclude(&id, RunOutcome::Completed).await;
                }
                tokio::time::sleep(left.min(SETTLE)).await;
            }
        });
        true
    }

    fn set_compact(&self, policy: CompactPolicy) {
        if let Some(a) = self.0.lock().unwrap().active.as_mut() {
            a.turn.compact = Some(policy);
        }
    }

    /// Arms change tracking for the repos among the workspace and its additional directories; the trees are never
    /// fetched or moved before a turn.
    async fn pre_turn(&self, req: &TurnReq) {
        let tracked = git::track(&req.cwd, &req.extras).await;
        if tracked.is_empty() {
            return;
        }
        let kind = if req.start.workspace.cd_path.is_none() { WorkspaceKind::Managed } else { WorkspaceKind::Cd };
        if let Some(a) = self.0.lock().unwrap().active.as_mut() {
            a.git = Some(GitTurn { cwd: req.cwd.clone(), extras: req.extras.clone(), kind, tracked });
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
        let Some((run_id, git, sync, artifacts, wrote)) = self.0.lock().unwrap().active.as_mut().map(|a| {
            let wrote = a.gate.as_ref().is_none_or(|g| g.open);
            (a.run_id.clone(), a.git.take(), a.sync.take(), a.artifacts.take(), wrote)
        }) else {
            return;
        };
        if let Some(artifacts) = artifacts {
            artifacts.finish().await;
        }
        // Before the submit: catching up afterwards writes the others' changes into the tree.
        if let Some(g) = git {
            let (status, changed, patch) = git::turn_end(&g.cwd, &g.extras, g.kind, &g.tracked).await;
            let patch = patch.inspect_err(|e| tracing::warn!("git patch failed: {e}"));
            // A turn that never changed files beside others claims none of their changes, nor lets them be discarded.
            let changed = if wrote { changed } else { Ok(0) };
            let git = status.and_then(|s| Ok((s, changed?)));
            let git = git.inspect_err(|e| tracing::warn!("git post-turn failed: {e}")).ok();
            let mut s = self.0.lock().unwrap();
            if let Some(a) = s.active.as_mut() {
                if let Some(d) = git.as_ref().and(patch.ok()).filter(|_| wrote) {
                    (a.turn.patch, a.turn.repos) = (d.patch, d.repos);
                }
                a.turn.git = git;
            }
            // The server offers to discard the changes of a turn that did not complete only.
            if outcome != RunOutcome::Completed && wrote {
                s.last = Some((run_id, g));
            }
        }
        if let Some(sync) = sync {
            let done = sync.finish(outcome).await;
            if let Some(a) = self.0.lock().unwrap().active.as_mut() {
                a.turn.sync = Some(done);
            }
        }
    }

    /// What the live turn `run_id` changed so far; None when it is not this conversation's active turn.
    pub(crate) async fn live_patch(&self, run_id: &str) -> Option<Result<git::Diff, String>> {
        let (git, open) = {
            let s = self.0.lock().unwrap();
            let a = s.active.as_ref().filter(|a| a.run_id == run_id)?;
            (a.git.as_ref().map(|g| g.tracked.clone()), a.gate.as_ref().is_none_or(|g| g.open))
        };
        let Some(tracked) = git else { return Some(Err(t!("本轮改动仅支持 git 工作区").into())) };
        // Only others changed files so far.
        if !open {
            return Some(Ok(git::Diff { patch: None, repos: vec![] }));
        }
        Some(git::turn_patch(&tracked).await)
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
        Some(git::turn_discard(&g.tracked).await)
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

    /// What Antigravity's transcripts tell of its subagents and background tasks: each reports to the run it started
    /// in (its parent subagent's), also after that run ended.
    fn delegated(&self, e: antigravity::Emit) {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        if !s.delegates.contains_key(&e.key) {
            let owner = match e.parent.as_ref() {
                Some(p) => s.delegates.get(p).map(|d| (d.run_id.clone(), d.out.clone())),
                None => s
                    .active
                    .as_ref()
                    .map(|a| (a.run_id.clone(), a.out.clone()))
                    .or_else(|| s.prev.as_ref().map(|p| (p.run_id.clone(), p.out.clone()))),
            };
            let Some((run_id, out)) = owner else { return };
            s.delegates.insert(e.key.clone(), Delegate { run_id, out, live: true, orphan: e.orphan });
        }
        let d = s.delegates.get_mut(&e.key).expect("inserted above");
        if let Some(live) = e.live {
            d.live = live;
        }
        d.out.send(DaemonToServer::RunEvent { run_id: d.run_id.clone(), event: e.event });
    }

    /// `session/update` parsed by hand: the draft subagent / async-task updates are unknown to the schema crate.
    fn on_raw(self: &Arc<Self>, params: serde_json::Value) {
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
        let known = match &ext {
            ExtUpdate::AsyncTaskSpawned(p) | ExtUpdate::AsyncTaskProgress(p) | ExtUpdate::AsyncTaskStateUpdate(p) => {
                s.tasks.contains_key(&p.async_task_id)
            }
            _ => false,
        };
        if s.active.is_none()
            && !known
            && let Some(w) = s.adopting.as_mut()
        {
            return w.held.push(Held::Ext(session.into(), ext));
        }
        ext_in(s, session, ext)
    }

    fn on_update(self: &Arc<Self>, n: SessionNotification) {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        if let SessionUpdate::CurrentModeUpdate(u) = &n.update {
            s.mode_update = Some(u.current_mode_id.0.to_string());
        }
        if let SessionUpdate::ConfigOptionUpdate(u) = &n.update {
            s.config_options = Some(u.config_options.clone());
        }
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
        if s.active.is_some() {
            return self.update_in(s, n);
        }
        // Between turns: the agent went on by itself (Claude Code after a background task finished).
        if let Some(w) = s.adopting.as_mut() {
            w.held.push(Held::Update(n));
        } else if continues(&n.update) {
            self.adopt(s, n.session_id.clone(), Held::Update(n));
        }
    }

    fn update_in(self: &Arc<Self>, s: &mut State, n: SessionNotification) {
        let Some(a) = s.active.as_mut().filter(|a| a.streaming) else { return };
        let review = auto_review_failure(&n.update);
        let ended = a.continuation.as_mut().is_some_and(|c| {
            c.last = Instant::now();
            cycle_end(&n.update)
        });
        if changes_steering(&n.update, &a.cwd) {
            a.rules.tampered = true;
        }
        let mut ledger = match a.turn.agent_of(&n.session_id.0) {
            None => Some(s.ledgers.entry(n.session_id.0.to_string()).or_insert_with(Ledger::resumed)),
            Some(_) => None,
        };
        if let Some(l) = ledger.as_deref_mut() {
            l.observe(&n.update);
        }
        let main = ledger.is_some();
        if let Some(event) = a.turn.apply(&n.session_id.0, n.update) {
            if let (Some(l), RunEvent::Usage { context: Some(c), .. }) = (ledger, &event) {
                l.context(*c);
            }
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
        for event in a.turn.take_extra() {
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
        if main && !s.live_due {
            s.live_due = true;
            self.schedule_live(a.run_id.clone(), n.session_id.0.to_string());
        }
        if let Some(review) = review {
            tracing::warn!("codex auto review failed in run {}: {review}", a.run_id);
            let step = t!("Codex 自动审查失败，操作被拒绝：{review}", review = review);
            let event = RunEvent::Status { status: RunStatus::Running, step };
            a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        }
        if ended {
            let (shared, run_id) = (self.clone(), a.run_id.clone());
            tokio::spawn(async move { shared.conclude(&run_id, RunOutcome::Completed).await });
        }
    }

    /// Plan D15: `full` allows by itself, then the bot's rules (applied here); anything else goes to the bot owner.
    fn on_permission(self: &Arc<Self>, req: RequestPermissionRequest) -> Permission {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        if s.active.is_some() {
            return permission_in(self, s, req);
        }
        if s.adopting.is_none() && s.prev.is_none() {
            return Permission::Now(None);
        }
        // Between turns: decided once the run for it is open.
        let (tx, rx) = oneshot::channel();
        let session = req.session_id.clone();
        match s.adopting.as_mut() {
            Some(w) => w.held.push(Held::Permission(req, tx)),
            None => self.adopt(s, session, Held::Permission(req, tx)),
        }
        Permission::Ask(rx)
    }

    fn set_error_kind(&self, kind: Option<crate::protocol::RunErrorKind>) {
        if let Some(a) = self.0.lock().unwrap().active.as_mut() {
            a.turn.error_kind = kind;
        }
    }

    /// Ends the active turn and reports it. `Err` = the agent failed.
    fn finish(
        &self,
        result: Result<PromptResponse, String>,
        session: Option<&SessionId>,
        reason: Option<&str>,
        model: Option<String>,
    ) {
        let mut s = self.0.lock().unwrap();
        s.conn = None;
        s.approvals.clear();
        s.questions.clear();
        s.appends.clear();
        let Some(a) = s.active.take() else { return };
        s.prev = Some(Prev::of(&a, session.cloned()));
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
                        model,
                    ));
                    return;
                }
                let outcome = if cancelled || resp.stop_reason == StopReason::Cancelled {
                    RunOutcome::Interrupted
                } else {
                    RunOutcome::Completed
                };
                let cost = a.turn.usage.as_ref().and_then(|u| u.cost_usd);
                let usage = model::usage_from_acp(resp.usage, cost);
                done(&a.run_id, outcome, a.turn, usage, session, reason, None, model)
            }
            Err(_) if cancelled => done(&a.run_id, RunOutcome::Interrupted, a.turn, None, session, reason, None, model),
            Err(e) => done(&a.run_id, RunOutcome::Failed, a.turn, None, session, reason, Some(truncate(&e)), model),
        };
        a.out.send(msg);
    }
}

/// Output that starts the agent's own work between turns; config, command and lone usage reports do not.
fn continues(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::AgentMessageChunk(_) | SessionUpdate::AgentThoughtChunk(_) | SessionUpdate::ToolCall(_)
    )
}

/// Claude Code reports the end of a cycle it ran by itself (background task done, ...) with a usage update naming
/// what started it.
fn cycle_end(update: &SessionUpdate) -> bool {
    matches!(update, SessionUpdate::UsageUpdate(u) if u.meta.as_ref().is_some_and(|m| m.contains_key("_claude/origin")))
}

fn ext_in(s: &mut State, session: &str, ext: ExtUpdate) {
    let active = s.active.as_mut().filter(|a| a.streaming);
    let patch = match ext {
        ExtUpdate::AsyncTaskSpawned(p) | ExtUpdate::AsyncTaskProgress(p) | ExtUpdate::AsyncTaskStateUpdate(p) => p,
        sub => {
            if let Some(a) = active
                && let Some(event) = a.turn.subagent(session, sub)
            {
                if let Some(c) = a.continuation.as_mut() {
                    c.last = Instant::now();
                }
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

/// An edit, move or delete the agent made (or is making) to a file that steers build and test commands.
fn changes_steering(update: &SessionUpdate, cwd: &std::path::Path) -> bool {
    let (kind, locations, raw) = match update {
        SessionUpdate::ToolCall(c) => (Some(c.kind), Some(c.locations.as_slice()), c.raw_input.as_ref()),
        SessionUpdate::ToolCallUpdate(u) => (u.fields.kind, u.fields.locations.as_deref(), u.fields.raw_input.as_ref()),
        _ => return false,
    };
    if !matches!(kind, Some(acp::ToolKind::Edit | acp::ToolKind::Delete | acp::ToolKind::Move)) {
        return false;
    }
    let raw_paths =
        ["file_path", "filePath", "path"].into_iter().filter_map(|k| raw?.get(k)?.as_str().map(PathBuf::from));
    let mut paths = locations.unwrap_or_default().iter().map(|l| l.path.clone()).chain(raw_paths.collect::<Vec<_>>());
    paths.any(|p| local::steering(p.strip_prefix(cwd).unwrap_or(&p)))
}

/// Forwards a request to the bot owner.
fn ask_owner(out: &Outbox, wire: ApprovalRequest) {
    let step = t!("等待审批：{title}", title = wire.title);
    let event = RunEvent::Status { status: RunStatus::AwaitingApproval, step };
    out.send(DaemonToServer::RunEvent { run_id: wire.run_id.clone(), event });
    out.send(DaemonToServer::ApprovalRequest(wire));
}

fn read_paths(req: &RequestPermissionRequest) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = req
        .tool_call
        .fields
        .locations
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|location| location.path.clone())
        .collect();
    if paths.is_empty()
        && let Some(raw) = &req.tool_call.fields.raw_input
    {
        for key in ["file_path", "filePath", "path"] {
            if let Some(path) = raw.get(key).and_then(serde_json::Value::as_str) {
                paths.push(PathBuf::from(path));
            }
        }
    }
    paths
}

/// Resolves `grace` after `run_id` is cancelled; never if it is not.
async fn cut_off(shared: &Shared, run_id: &str, grace: std::time::Duration) {
    while !shared.is_cancelled(run_id) {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    tokio::time::sleep(grace).await;
}

/// Cancels the prompt in flight. ACP: every pending permission request is then answered `cancelled`; pending
/// questions are withdrawn with it.
/// [`Shared::confirm_dir`] under the lock.
fn confirm_in(s: &mut State, question: Question) -> Option<(String, oneshot::Receiver<bool>)> {
    s.requests += 1;
    let n = s.requests;
    let (run_id, out) = s.active.as_ref().map(|a| (a.run_id.clone(), a.out.clone()))?;
    let step = t!("等待确认：同一工作区还有其他运行").to_string();
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

fn interrupt(s: &mut State) {
    send_cancel(s);
    s.approvals.clear();
    gate::interrupted(s);
    s.questions.clear();
}

fn send_cancel(s: &State) {
    if let Some((cx, session)) = &s.conn
        && let Err(e) = cx.send_notification(CancelNotification::new(session.clone()))
    {
        tracing::warn!("session/cancel failed: {e}");
    }
}

#[allow(clippy::too_many_arguments)]
fn done(
    run_id: &str,
    outcome: RunOutcome,
    turn: Turn,
    usage: Option<Usage>,
    session_id: Option<String>,
    new_session_reason: Option<String>,
    error: Option<String>,
    model: Option<String>,
) -> DaemonToServer {
    // Shell edits (Codex) carry no tool locations: git sees them.
    let reply = turn.reply();
    let (git, git_changed) = turn.git.map_or((None, 0), |(g, n)| (Some(g), n));
    DaemonToServer::RunDone(RunDone {
        run_id: run_id.into(),
        outcome,
        files_changed: turn.files.len().max(git_changed) as u32,
        usage: usage.or(turn.usage),
        reply,
        session_id,
        new_session_reason,
        error,
        error_kind: turn.error_kind,
        git,
        patch: turn.patch,
        repos: turn.repos,
        appends_applied: turn.appends_applied,
        sync: turn.sync,
        model,
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
    let sum = |x: Option<u64>, y: Option<u64>| x.zip(y).map(|(x, y)| x + y).or(x).or(y);
    match (a, b) {
        (Some(a), Some(b)) => Some(
            AcpUsage::new(
                a.total_tokens + b.total_tokens,
                a.input_tokens + b.input_tokens,
                a.output_tokens + b.output_tokens,
            )
            .cached_read_tokens(sum(a.cached_read_tokens, b.cached_read_tokens))
            .cached_write_tokens(sum(a.cached_write_tokens, b.cached_write_tokens)),
        ),
        (a, b) => a.or(b),
    }
}

/// The prompt cache of a turn, when the agent reports it (Claude: `inputTokens` leaves the cached ones out).
fn truncate(s: &str) -> String {
    s.chars().take(ERROR_MAX).collect()
}

/// The shell command of a tool call's raw input: a string (Claude, Codex) or an argv array.
fn command_of(raw: Option<&serde_json::Value>) -> Option<String> {
    match crate::turn::command_field(raw?)? {
        serde_json::Value::String(c) => Some(c.clone()),
        serde_json::Value::Array(argv) => Some(argv.iter().filter_map(|a| a.as_str()).collect::<Vec<_>>().join(" ")),
        _ => None,
    }
}

/// ACP's older way to pick a model (Gemini CLI): `models` beside the session's fields, set with this method.
const SET_MODEL: &str = "session/set_model";

/// Sends `req` and also returns its raw result, for what the typed response leaves out ([`Models`]).
async fn send_raw<R>(
    cx: &ConnectionTo<Agent>,
    req: R,
) -> Result<(R::Response, serde_json::Value), agent_client_protocol::Error>
where
    R: JsonRpcRequest,
    R::Response: serde::de::DeserializeOwned,
{
    let raw = cx.send_request(req.to_untyped_message()?).block_task().await?;
    Ok((serde_json::from_value(raw.clone())?, raw))
}

use model::ADAPTER_DEFAULT;
use models::Models;

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
/// Nothing is prompted. `launch`: a Claude profile's settings, named in `_meta` as on a real session.
pub(crate) async fn probe(
    agent: AcpAgent,
    cwd: &std::path::Path,
    launch: Option<&inject::ClaudeLaunch>,
) -> Result<AgentCatalog, String> {
    let options = claude_options(launch, &Default::default(), &Default::default());
    let mut new = NewSessionRequest::new(cwd);
    if !options.is_empty() {
        let mut meta = Meta::new();
        meta.insert("claudeCode".into(), serde_json::json!({ "options": options }));
        new = new.meta(meta);
    }
    Client
        .builder()
        .connect_with(agent, async |cx: ConnectionTo<Agent>| {
            let init = InitializeRequest::new(ProtocolVersion::V1).client_capabilities(client_capabilities());
            cx.send_request(init).block_task().await?;
            let (res, raw) = send_raw(&cx, new).await?;
            let options = res.config_options.unwrap_or_default();
            let (start_efforts, start_effort) = efforts(&options);
            let Some((id, current, models)) = select(&options, &SessionConfigOptionCategory::Model) else {
                if let Some(models) = Models::of(&raw) {
                    return Ok(models.catalog());
                }
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

/// Forks `session` in `cwd` (session/fork, unstable) and returns the new session's id. The adapter copies the whole
/// session, so the copy starts from the session's state as of its last turn.
pub(crate) async fn fork(agent: AcpAgent, cwd: &std::path::Path, session: &str) -> Result<String, String> {
    let forked = Client
        .builder()
        .connect_with(agent, async |cx: ConnectionTo<Agent>| {
            let init = InitializeRequest::new(ProtocolVersion::V1).client_capabilities(client_capabilities());
            let init = cx.send_request(init).block_task().await?;
            if init.agent_capabilities.session_capabilities.fork.is_none() {
                return Ok(None);
            }
            let req = ForkSessionRequest::new(SessionId::new(session), cwd);
            let res = cx.send_request(req).block_task().await?;
            Ok(Some(res.session_id.0.to_string()))
        })
        .await
        .map_err(|e| describe(&e))?;
    forked.ok_or_else(|| t!("适配器不支持分支会话").to_string())
}

/// A select option of the given category: (config id, current value, choices).
pub(crate) fn select(
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
        self.withdraw(request_id, t!("Agent 已不再等待回答，提问已失效"));
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

    /// Not limited to a streaming run: the agent lists tools while its session is being set up.
    fn hidden_tools(&self) -> Vec<String> {
        self.0.lock().unwrap().active.as_ref().map(|a| a.hidden_tools.clone()).unwrap_or_default()
    }
}

/// Session task: spawns an adapter on demand, runs queued turns in order, reaps the adapter when idle, then the
/// conversation (`Inner::reap`).
pub(crate) async fn run(
    engine: Arc<Inner>,
    key: crate::protocol::ConversationKey,
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
            None => match tokio::time::timeout(engine.config.reap, rx.recv()).await {
                Ok(Some(req)) => match plan(&engine, &shared, req).await {
                    Some(turn) => match ready(&engine, &shared, turn).await {
                        Some(turn) => turn,
                        None => continue,
                    },
                    None => continue,
                },
                Ok(None) => break,
                Err(_) if engine.reap(&key, &shared, &rx, &ask) => break,
                Err(_) => continue,
            },
        };
        let s = &turn.req.start;
        let _secrets = crate::logs::hold_secrets(s.env.0.values().cloned().collect());
        let dirs = plugin_dirs(&turn.skills, &turn.plugins);
        let pair = format!("{}-{}", s.group_id, s.bot.id);
        let process = Process {
            key: &pair,
            plugin_dirs: &dirs,
            cwd: Some(turn.req.cwd.as_path()),
            mcp_servers: &s.mcp_servers,
            ask: Some(&ask),
            cli_profiles: &s.cli_profiles,
        };
        let result = match engine.adapter(&s.bot, &turn.req.local, &turn.selection, &s.env, &process).await {
            Ok(config) => connect(&engine, &shared, &ask, AcpAgent::new(config), turn, &mut rx, &mut resume).await,
            Err(e) => Err(format!("{e:#}")),
        };
        // Its background tasks went with the adapter process.
        {
            let mut s = shared.0.lock().unwrap();
            s.agent = None;
            s.tasks.clear();
            s.adopting = None;
            for d in s.delegates.drain().map(|(_, d)| d).filter(|d| d.live) {
                if let Some(event) = d.orphan {
                    d.out.send(DaemonToServer::RunEvent { run_id: d.run_id, event });
                }
            }
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
            shared.finish(Err(error), resume.as_ref(), None, None);
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
                Permission::Now(choice) => responder.respond(permission_response(choice)),
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
                        .client_capabilities(client_capabilities()),
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
                api: engine.config.api.as_ref(),
                selection: first.selection.clone(),
                launch: first.launch.clone(),
                official: first.official,
                skills: first.skills.clone(),
                plugins: first.plugins.clone(),
                session: None,
                mode: None,
                modes: vec![],
                cancel_grace: engine.config.cancel_grace,
                options: vec![],
                initial: HashMap::new(),
                applied: HashMap::new(),
                models: None,
                user_home: &engine.config.user_home,
                watch: None,
            };
            let secrets = env_digest(&first.req.start.env);
            // The CLI shims are on the process PATH too.
            let hidden = (first.req.start.hidden_tools.clone(), first.req.start.cli_profiles.clone());
            let tier = first.req.start.bot.tier;
            let cwd = first.req.cwd.clone();
            let mut turn = first;
            loop {
                let bot = &turn.req.start.bot;
                let guardable =
                    mode_for(bot.agent_kind, Tier::ReadOnly).is_some() && mode_for(bot.agent_kind, bot.tier).is_some();
                match engine.workspaces.occupy(&turn.req, shared, guardable).await {
                    Some(dir) => {
                        conv.skills = turn.skills.clone();
                        conv.plugins = turn.plugins.clone();
                        conv.launch = turn.launch.clone();
                        conv.official = turn.official;
                        conv.turn(turn.req, turn.removed, resume, dir.guarded.then(|| dir.gate())).await?;
                    }
                    None => shared.finish(Err(String::new()), resume.as_ref(), None, None),
                }
                turn = loop {
                    match tokio::time::timeout(engine.config.idle, rx.recv()).await {
                        Ok(Some(next)) => match plan(engine, shared, next).await {
                            Some(turn) => match ready(engine, shared, turn).await {
                                Some(turn) => break turn,
                                None => continue,
                            },
                            None => continue,
                        },
                        // Kept while the agent may still go on by itself.
                        Err(_) if shared.holds_adapter() => continue,
                        Ok(None) | Err(_) => return Ok(None),
                    }
                };
                // Claude only sees the plugins' skill lists and its settings as they were when the process started;
                // secrets are its process env, and agents list the gonggong tools once per process. A live session
                // stays in the directory it was opened in, which may have been moved meanwhile (`layout`).
                if turn.selection != conv.selection
                    || turn.req.cwd != cwd
                    || turn.launch != conv.launch
                    || turn.skills.names != conv.skills.names
                    || turn.plugins != conv.plugins
                    || env_digest(&turn.req.start.env) != secrets
                    || (&turn.req.start.hidden_tools, &turn.req.start.cli_profiles) != (&hidden.0, &hidden.1)
                    // An agent may take its sandbox with the process (`tiers.restartOnChange`).
                    || (crate::adapters::get(turn.req.start.bot.agent_kind).is_some_and(|a| a.restarts_on_tier())
                        && turn.req.start.bot.tier != tier)
                {
                    return Ok(Some(turn));
                }
            }
        })
        .await
        .map_err(|e| describe(&e))
}

/// Tells the env an adapter process was started with apart without keeping its values.
fn env_digest(env: &SecretEnv) -> [u8; 32] {
    Sha256::digest(serde_json::to_vec(&env.0).expect("a string map serializes")).into()
}

/// The ACP session on one adapter connection.
struct Conversation<'a> {
    cx: &'a ConnectionTo<Agent>,
    init: &'a InitializeResponse,
    shared: &'a Arc<Shared>,
    ask: &'a acp::McpServer,
    home: &'a Path,
    api: Option<&'a Config>,
    /// The provider this adapter process was started with.
    selection: Selection,
    /// The Claude settings of the current turn; equal (file, CLI flag) to those the process started with.
    launch: Option<inject::ClaudeLaunch>,
    /// Whether the current turn runs on the agent maker's service.
    official: bool,
    /// The team skills of the current turn; their names are those the process started with.
    skills: skills::Installed,
    /// The plugins the process started with.
    plugins: plugins::Installed,
    session: Option<SessionId>,
    mode: Option<String>,
    /// The session's modes on offer.
    modes: Vec<String>,
    /// A cancelled prompt still unanswered after this long is abandoned with its adapter.
    cancel_grace: std::time::Duration,
    /// The session's config options as last reported, their values when it was opened, and the values we set
    /// (by config id; adapters may report a set alias under its canonical id).
    options: Vec<SessionConfigOption>,
    initial: HashMap<String, String>,
    applied: HashMap<String, String>,
    /// The session's models when offered the older way instead of a config option (Gemini CLI).
    models: Option<Models>,
    user_home: &'a Path,
    /// Antigravity: the session whose transcripts are followed.
    watch: Option<(SessionId, antigravity::Watch)>,
}

impl Conversation<'_> {
    /// Antigravity tells of its subagents and background tasks only in its transcripts (`antigravity`).
    fn follow(&mut self, session: &SessionId) {
        if self.watch.as_ref().is_some_and(|(id, _)| id == session) {
            return;
        }
        let Some(adapter) = crate::adapters::get(AgentKind::Antigravity) else { return };
        let brain = adapter.config_home(self.user_home, &|n| std::env::var(n).ok()).join("brain");
        let shared = self.shared.clone();
        let idle = self.shared.clone();
        let watch = antigravity::watch(
            brain,
            &session.0,
            move |e| shared.delegated(e),
            move |i| idle.0.lock().unwrap().agent_idle = i,
        );
        self.watch = Some((session.clone(), watch));
    }

    /// Runs one prompt turn. Only transport-level failures are returned (they tear the adapter down).
    /// `removed`: the session to resume lost its provider, so a new one is started.
    async fn turn(
        &mut self,
        req: TurnReq,
        removed: bool,
        resume: &mut Option<SessionId>,
        gate: Option<workspace::WriteGate>,
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
                        if let Some(api) = self.api {
                            let files: Vec<_> = s.prompt.fallback_context.iter().flat_map(|m| &m.attachments).collect();
                            if let Err(e) = attachments::fetch(api, &req.cwd, files).await {
                                self.shared.finish(Err(e), None, None, None);
                                return Ok(());
                            }
                        }
                        (&s.prompt.fallback_context, 0)
                    } else {
                        context
                    };
                    if reason.is_some() {
                        self.shared.new_session();
                    }
                    // New sessions keep the provider they start with (§4.3): recorded before the agent is prompted.
                    if reason.is_some()
                        && let Err(e) = self.pin(&req, &id).await
                    {
                        self.shared.finish(Err(e), None, None, None);
                        return Ok(());
                    }
                    (id, reason, history)
                }
                Err(e) => {
                    let (msg, kind) = crate::agent_login::session_open_error(s.bot.agent_kind, &e, &describe(&e));
                    self.shared.set_error_kind(kind);
                    self.shared.finish(Err(msg), None, None, None);
                    return Ok(());
                }
            },
        };
        *resume = Some(session.clone());
        self.session = Some(session.clone());
        if s.bot.agent_kind == AgentKind::Antigravity {
            self.follow(&session);
        }
        let builtin = builtin_mode(s.bot.agent_kind, s.bot.tier, s.bot.ai_review, self.official)
            .filter(|m| self.modes.iter().any(|o| o == m));
        let fallback = mode_for(s.bot.agent_kind, s.bot.tier);
        if let Some(mode) = builtin.or(fallback) {
            self.switch(&session, mode).await;
        }
        let pre_model = self.configure(&req, &session).await;
        // A model switch may have taken `auto` away too.
        if let Some(mode) = self.shared.take_mode_update() {
            self.mode = Some(mode);
        }
        let on = builtin.is_some_and(|b| self.mode.as_deref() == Some(b));
        if !on && let Some(fallback) = fallback {
            self.switch(&session, fallback).await;
        }
        if builtin_mode(s.bot.agent_kind, s.bot.tier, s.bot.ai_review, true).is_some() {
            let step = match (on, s.bot.agent_kind) {
                (true, AgentKind::Claude) => t!("审批由 Claude 内置审核（auto 模式）把关").to_string(),
                (true, _) => t!("审批由 Codex 内置审核（agent 模式）把关").to_string(),
                (false, _) if !self.official => t!("第三方供应商用不了内置审核，审批由共工规则把关").to_string(),
                (false, _) => t!(
                    "内置审核不可用（模式 {mode}），审批由共工规则把关",
                    mode = self.mode.as_deref().or(fallback).unwrap_or_default()
                ),
            };
            let event = RunEvent::Status { status: RunStatus::Running, step };
            req.out.send(DaemonToServer::RunEvent { run_id: s.run_id.clone(), event });
        }
        if let Some(gate) = gate
            && !self.guard(&req, &session, gate).await
        {
            self.shared.finish(Err(String::new()), Some(&session), None, pre_model);
            return Ok(());
        }
        // Before streaming, so a /stop during the fetch still cancels the prompt.
        self.shared.take_config_options();
        self.shared.pre_turn(&req).await;
        self.shared.stream(self.cx, &session);
        let text = s.command.clone().unwrap_or_else(|| {
            let mut prompt = compose_prompt(&s.prompt, history, omitted);
            if let Some(hint) = &req.artifact_hint {
                prompt = format!("{hint}\n\n{prompt}");
            }
            match s.sync.as_ref().and_then(|sync| sync_hint(sync, req.behind)) {
                Some(hint) => format!("{hint}\n\n{prompt}"),
                None => prompt,
            }
        });
        let image = self.init.agent_capabilities.prompt_capabilities.image;
        self.shared.record_prompt(&session, &text, true, reason.is_some());
        let mut blocks = attachments::prompt_blocks(&req.cwd, text, &s.prompt.attachments, image).await;
        let mut spent: Option<AcpUsage> = None;
        // 打断并追加 cancels a prompt and continues the same turn with the appended text (spec §8.9).
        let result = loop {
            let prompt = PromptRequest::new(session.clone(), blocks);
            // An agent ignoring session/cancel would hold the turn (and the bot's queue) forever.
            let result = tokio::select! {
                result = self.cx.send_request(prompt).block_task() => result,
                () = cut_off(self.shared, &s.run_id, self.cancel_grace) => Err(
                    agent_client_protocol::Error::internal_error()
                        .data(serde_json::Value::from(t!("agent 停止后没有响应，已结束其进程").to_string())),
                ),
            }
            .map(|mut resp| {
                spent = add_usage(spent.take(), resp.usage.take());
                resp.usage = spent.clone();
                resp
            });
            match self.shared.take_append() {
                Some((text, files)) if result.is_ok() => {
                    self.shared.record_prompt(&session, &text, false, false);
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
                let outcome = self.shared.ending(result.as_ref().map_err(drop));
                let updated_model = self.shared.take_config_options().and_then(|opts| {
                    self.options = opts;
                    model::model_from_config_options(
                        s.bot.agent_kind,
                        &self.selection,
                        self.launch.as_ref(),
                        self.user_home,
                        &self.options,
                    )
                });
                let ran_inference = outcome == RunOutcome::Completed
                    || (outcome == RunOutcome::Interrupted
                        && result.as_ref().ok().and_then(|r| r.usage.as_ref()).is_some_and(|u| u.total_tokens > 0));
                let served_model = if ran_inference {
                    let probe = model::PostTurnProbe::new(
                        s.bot.agent_kind,
                        req.cwd.clone(),
                        session.0.to_string(),
                        &self.selection,
                        self.user_home,
                    );
                    model::discover_served_model(probe).await
                } else {
                    None
                };
                let done_model = model::combine_done_model(pre_model, updated_model, served_model);
                self.shared.report_context(&session, result.as_ref().ok().and_then(|r| r.usage.as_ref()));
                self.shared.post_turn(outcome).await;
                let res = result.map_err(|e| {
                    let (msg, kind) = crate::agent_login::prompt_error(s.bot.agent_kind, &e, &describe(&e));
                    self.shared.set_error_kind(kind);
                    msg
                });
                self.shared.finish(res, Some(&session), reason.as_deref(), done_model);
                // Before the next turn switches modes itself; failed, the mode is unknown and the next switch is sent.
                if let Some(restoring) = self.shared.take_restoring() {
                    let Ok(mode) = tokio::time::timeout(self.cancel_grace, restoring).await else {
                        // A late answer could switch the next turn's mode: the adapter goes, and with it the directory.
                        return Err(agent_client_protocol::Error::internal_error().data("session/set_mode unanswered"));
                    };
                    self.mode = Some(mode.ok().flatten().unwrap_or_default());
                }
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
                Ok((modes, options, models)) => {
                    self.set_modes(modes);
                    self.set_options(options.unwrap_or_default(), models);
                    return Ok((id, None));
                }
                Err(e) => tracing::info!("resuming session {} failed: {e}", id.0),
            }
        }
        let servers = mcp_servers_for(&req.start, self.ask);
        let new =
            NewSessionRequest::new(&req.cwd).additional_directories(req.extras.clone()).mcp_servers(servers).meta(meta);
        let (res, raw) = send_raw(self.cx, new).await?;
        self.set_modes(res.modes);
        self.set_options(res.config_options.unwrap_or_default(), Models::of(&raw));
        let reason =
            if tried { RESUME_FAILED.into() } else { req.start.new_session_reason.clone().unwrap_or("first".into()) };
        Ok((res.session_id, Some(reason)))
    }

    async fn restore(
        &self,
        id: &SessionId,
        req: &TurnReq,
        meta: Option<Meta>,
    ) -> Result<
        (Option<SessionModeState>, Option<Vec<SessionConfigOption>>, Option<Models>),
        agent_client_protocol::Error,
    > {
        let caps = &self.init.agent_capabilities;
        let servers = mcp_servers_for(&req.start, self.ask);
        if caps.session_capabilities.resume.is_some() {
            let req = ResumeSessionRequest::new(id.clone(), &req.cwd)
                .additional_directories(req.extras.clone())
                .mcp_servers(servers)
                .meta(meta);
            let (res, raw) = send_raw(self.cx, req).await?;
            Ok((res.modes, res.config_options, Models::of(&raw)))
        } else if caps.load_session {
            let req = LoadSessionRequest::new(id.clone(), &req.cwd)
                .additional_directories(req.extras.clone())
                .mcp_servers(servers)
                .meta(meta);
            let (res, raw) = send_raw(self.cx, req).await?;
            Ok((res.modes, res.config_options, Models::of(&raw)))
        } else {
            Err(agent_client_protocol::Error::method_not_found())
        }
    }

    /// Records the session's current mode so the first turn switches it to the tier's mode (D21) when offered.
    fn set_modes(&mut self, modes: Option<SessionModeState>) {
        self.modes = modes.iter().flat_map(|m| &m.available_modes).map(|m| m.id.0.to_string()).collect();
        self.mode = modes.map(|m| m.current_mode_id.0.to_string());
    }

    /// Switches the session to `mode` when modes are offered; the adapter may report another one it fell back to.
    async fn switch(&mut self, session: &SessionId, mode: &'static str) {
        if self.mode.as_deref().is_none_or(|m| m == mode) {
            return;
        }
        self.shared.take_mode_update();
        match self.cx.send_request(SetSessionModeRequest::new(session.clone(), mode)).block_task().await {
            Ok(_) => self.mode = Some(self.shared.take_mode_update().unwrap_or_else(|| mode.into())),
            Err(e) => tracing::warn!("session/set_mode {mode} failed: {e}"),
        }
    }

    fn set_options(&mut self, options: Vec<SessionConfigOption>, models: Option<Models>) {
        self.initial = [SessionConfigOptionCategory::Model, SessionConfigOptionCategory::ThoughtLevel]
            .iter()
            .filter_map(|c| select(&options, c))
            .map(|(id, current, _)| (id, current))
            .collect();
        self.applied.clear();
        self.models = models.filter(|_| select(&options, &SessionConfigOptionCategory::Model).is_none());
        self.options = options;
    }

    /// Switches the session to the requested model and effort (else the session's initial values) when they differ
    /// from the current ones, then reports what is in effect. Model first: switching it may change the effort levels
    /// on offer and reset the effort set before.
    async fn configure(&mut self, req: &TurnReq, session: &SessionId) -> Option<String> {
        let bot = &req.start.bot;
        // A third-party provider only serves its own models; its default one is injected with the process, and the
        // adapter's catalog may not list it.
        let (model, injected) = match self.selection.provider().filter(|(_, e)| e.claude_profile().is_none()) {
            None => (bot.model.clone(), None),
            Some((p, e)) => {
                let model = inject::model(p, e, bot.model.as_deref());
                (model.clone(), model.filter(|m| e.model.as_ref() == Some(m)))
            }
        };
        let unlisted = |options: &[SessionConfigOption]| {
            injected.clone().filter(|m| {
                select(options, &SessionConfigOptionCategory::Model)
                    .is_none_or(|(.., c)| c.iter().all(|c| c.value != *m))
            })
        };
        if let Some(models) = self.models.as_mut()
            && let Some(target) =
                model.clone().or_else(|| Some(models.initial.clone())).filter(|t| *t != models.current)
        {
            let params = serde_json::json!({ "sessionId": session.0, "modelId": target });
            let set = match UntypedMessage::new(SET_MODEL, params) {
                Ok(set) => self.cx.send_request(set).block_task().await,
                Err(e) => Err(e),
            };
            let label = t!("模型");
            let step = match set {
                Ok(_) => {
                    let name =
                        models.choices.iter().find(|c| c.value == target).map_or(target.clone(), |c| c.name.clone());
                    models.current = target;
                    t!("已切换{label}：{name}", label = label, name = name)
                }
                Err(e) => t!("{label} {target} 不可用：{e}", label = label, target = target, e = describe(&e)),
            };
            let event = RunEvent::Status { status: RunStatus::Running, step };
            req.out.send(DaemonToServer::RunEvent { run_id: req.start.run_id.clone(), event });
        }
        let wanted = [
            (SessionConfigOptionCategory::Model, t!("模型"), &model),
            (SessionConfigOptionCategory::ThoughtLevel, t!("推理强度"), &bot.effort),
        ];
        for (category, label, want) in wanted {
            if category == SessionConfigOptionCategory::Model && self.models.is_some() {
                continue;
            }
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
        let resolved_model = model::resolve_pre_turn_model(
            bot.agent_kind,
            &self.selection,
            self.launch.as_ref(),
            self.user_home,
            bot.model.as_deref(),
            unlisted(&self.options),
            &self.options,
            &self.applied,
            self.models.as_ref().map(|m| m.current.as_str()),
        );
        req.out.send(DaemonToServer::SessionConfig {
            run_id: req.start.run_id.clone(),
            model: resolved_model.clone(),
            effort: in_effect(SessionConfigOptionCategory::ThoughtLevel),
            settings: self.launch.as_ref().map(|l| l.snapshot.clone()),
        });
        resolved_model
    }

    /// Claude reads the per-session system prompt and the provider's settings file (written with the process) from
    /// `_meta`, on every new, resume and load: a resume without it falls back to the user's config. Codex gets both
    /// per process.
    fn meta(&self, start: &RunStart) -> Option<Meta> {
        if start.bot.agent_kind != AgentKind::Claude {
            return manifest_meta(start);
        }
        let mut meta = Meta::new();
        meta.insert("systemPrompt".into(), serde_json::json!({ "append": system_prompt(&start.bot) }));
        let options = claude_options(self.launch.as_ref(), &self.skills, &self.plugins);
        if !options.is_empty() {
            meta.insert("claudeCode".into(), serde_json::json!({ "options": options }));
        }
        Some(meta)
    }

    async fn pin(&self, req: &TurnReq, session: &SessionId) -> Result<(), String> {
        let s = &req.start;
        let (home, selection, session) = (self.home.to_path_buf(), self.selection.clone(), session.0.to_string());
        let (agent, group, bot) = (s.bot.agent_kind, s.group_id.clone(), s.bot.id.clone());
        tokio::task::spawn_blocking(move || {
            Store::update(&home, |store| {
                store.pin(&session, agent, &group, &bot, &selection);
                Ok(())
            })
        })
        .await
        .unwrap_or_else(|e| Err(e.into()))
        .map_err(|e| t!("无法记录会话使用的供应商：{e}", e = format!("{e:#}")))
    }
}

/// A manifest agent taking the bot's prompt in session/new: `_meta.<key>.systemPrompt.append` (`systemPrompt.via: meta`).
fn manifest_meta(start: &RunStart) -> Option<Meta> {
    let a = crate::adapters::get(start.bot.agent_kind)?;
    let crate::adapters::SystemPrompt::Meta { key } = &a.spec.system_prompt else { return None };
    let mut meta = Meta::new();
    meta.insert(key.clone(), serde_json::json!({ "systemPrompt": { "append": system_prompt(&start.bot) } }));
    Some(meta)
}

/// The plugin folders a turn loads: the team skills plugin, then the group's plugins.
fn plugin_dirs(skills: &skills::Installed, plugins: &plugins::Installed) -> Vec<PathBuf> {
    let team = (!skills.names.is_empty()).then(|| skills.dir.clone());
    team.into_iter().chain(plugins.dirs.iter().cloned()).collect()
}

/// `_meta.claudeCode.options`: the settings file, the setting sources when the CLI's user-level config is left out
/// (the adapter's default loads user, project and local; ours are spread over it), the team skills plugin and the
/// group's plugins.
fn claude_options(
    launch: Option<&inject::ClaudeLaunch>,
    skills: &skills::Installed,
    plugins: &plugins::Installed,
) -> serde_json::Map<String, serde_json::Value> {
    let mut options = serde_json::Map::new();
    if let Some(path) = launch.and_then(inject::ClaudeLaunch::settings_path) {
        options.insert("settings".into(), serde_json::json!(path));
    }
    if launch.is_some_and(|l| !l.inherit_cli) {
        options.insert("settingSources".into(), serde_json::json!(["project", "local"]));
    }
    if let Some(args) = launch.map(|l| &l.args).filter(|a| !a.is_empty()) {
        options.insert("extraArgs".into(), serde_json::Value::Object(args.clone()));
    }
    let local: Vec<_> =
        plugin_dirs(skills, plugins).iter().map(|p| serde_json::json!({ "type": "local", "path": p })).collect();
    if !local.is_empty() {
        options.insert("plugins".into(), local.into());
    }
    options
}

/// MCP servers attached when a session is created or restored: the server's global layer plus the built-in ask
/// tool, which every session gets (spec §7.2). An agent whose launch script takes the latter (`mcp.gonggong:
/// script`, Gemini's settings, where it gets a timeout) does without it here: a server of the same name would replace
/// it.
/// The names of a run's MCP servers: its own and ours.
fn mcp_names(servers: &[McpServer]) -> Vec<String> {
    let name = |s: &McpServer| match s {
        McpServer::Stdio { name, .. } | McpServer::Http { name, .. } => name.clone(),
    };
    servers.iter().map(name).chain([crate::ask::SERVER_NAME.to_string()]).collect()
}

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
        .chain(
            crate::adapters::get(start.bot.agent_kind)
                .is_none_or(|a| a.spec.mcp.gonggong != crate::adapters::Via::Script)
                .then(|| ask.clone()),
        )
        .collect()
}

mod context;
mod gate;
mod model;
mod models;
mod permission;
#[cfg(test)]
use permission::name_mcp_call;
use permission::permission_in;
#[cfg(test)]
mod tests;
