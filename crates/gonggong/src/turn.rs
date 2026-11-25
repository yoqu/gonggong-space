//! Pure per-turn logic: prompt composition, ACP update → RunEvent mapping, tier policies.
use crate::attachments::rel_path;
use crate::protocol::{
    self, AgentKind, CompactionStatus, CompactionTrigger, ContextMessage, ContextUsage, DiffRepo, GitStatus, McpCall,
    PlanItem, PlanStatus, RunBot, RunEvent, RunPrompt, RunSyncDone, RunSyncStart, SubagentState, TaskState, Tier,
    ToolStatus, Usage, WebCall,
};
use crate::{mcp_call, web_call};
use agent_client_protocol::schema::MaybeUndefined;
use agent_client_protocol::schema::v1::{
    ClientCapabilities, ClientSessionCapabilities, CompactionCapabilities, CompactionStatus as AcpCompactionStatus,
    CompactionUpdate, ContentBlock, PermissionOption, PermissionOptionId, PermissionOptionKind, PlanEntryStatus,
    SessionUpdate, ToolCallContent, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};

const DETAIL_MAX: usize = 200;
/// Tail of a shell command's output kept in the tool detail.
const OUTPUT_LINES: usize = 20;
const OUTPUT_MAX: usize = 1500;
/// A compaction's retained summary as sent to the server.
const SUMMARY_MAX: usize = 8000;
/// A plan as sent to the server: its first entries, each clipped.
const PLAN_ENTRIES: usize = 100;
const PLAN_ITEM_MAX: usize = 500;

/// Context lines (`[#seq time] author: body（附件：…）`) led by a pointer to the gonggong tools when `omitted` older
/// ones were left out, the quote, then `<trigger> 说：<text>` with one `附件：<path>` line per attachment.
pub fn compose_prompt(prompt: &RunPrompt, history: &[ContextMessage], omitted: u32) -> String {
    let mut out = String::new();
    if let Some(first) = history.first() {
        let more = if omitted == 0 {
            String::new()
        } else {
            format!(
                "（此前还有 {omitted} 条未展示，需要时用 gonggong 的 list_messages(before={}) 或 search_messages 查看）",
                first.seq
            )
        };
        out.push_str(&format!("群聊上下文{more}：\n"));
        for m in history {
            let files: Vec<String> = m.attachments.iter().map(rel_path).collect();
            let files = if files.is_empty() { String::new() } else { format!("（附件：{}）", files.join("、")) };
            out.push_str(&format!("[#{} {}] {}: {}{files}\n", m.seq, short_time(&m.at), m.author, m.body));
        }
        out.push('\n');
    }
    if let Some(q) = &prompt.quote {
        out.push_str(&format!("引用 {}：{}\n\n", q.author, q.body));
    }
    out.push_str(&format!("{} 说：{}", prompt.triggered_by, prompt.text));
    for a in &prompt.attachments {
        out.push_str(&format!("\n附件：{}", rel_path(a)));
    }
    out
}

/// Force group (F20): what others changed in the shared tree since this bot last worked; None when nothing did.
/// `behind`: the version the workspace is still at when catching up before the turn failed.
pub fn sync_hint(sync: &RunSyncStart, behind: Option<u64>) -> Option<String> {
    if let Some(at) = behind {
        let head = format!("强制同步：工作区未能更新，仍停在 v{at}（权威版本已到 v{}）", sync.head_version);
        if sync.changed_total == 0 {
            return Some(head);
        }
        let files = format!("以下改动不在工作区中：{}（共 {} 个）", sync.changed.join("、"), sync.changed_total);
        return Some(format!("{head}，{files}"));
    }
    let last = sync.last_version.filter(|_| sync.changed_total > 0)?;
    Some(format!(
        "强制同步：自你上次工作后权威版本 v{last}→v{}，改动文件：{}（共 {} 个）",
        sync.head_version,
        sync.changed.join("、"),
        sync.changed_total
    ))
}

/// "2026-09-23T10:12:00.123Z" → "2026-09-23 10:12 UTC" (as sent by the server, labeled so agents don't read it as local).
fn short_time(iso: &str) -> String {
    format!("{} UTC", iso.get(..16).unwrap_or(iso).replacen('T', " ", 1))
}

/// Agent-facing (not translated, like the tool descriptions); replies follow the members' language.
pub fn system_prompt(bot: &RunBot) -> String {
    let base = format!(
        "You are the bot \"{}\" in a team group chat. Each message starts with \"<name> 说：\", possibly after recent group \
        context; your final reply is posted as your group message, in the language of the message you answer. The tools \
        below belong to gonggong (in Claude: mcp__gonggong__<tool>).\n\
        - Older messages, members, other bots' runs: look them up with the tools; do not guess.\n\
        - A decision for the requester (a trade-off, scope, missing facts): ask_group_members and wait; do not just list \
        questions in your reply.\n\
        - Work for another bot: hand_off; writing \"@Bot\" in a reply only mentions it.\n\
        - A running web app or service: service_start + preview_expose; a static site: preview_static. Never start \
        background processes yourself or point people at localhost.",
        bot.name
    );
    if bot.system_prompt.trim().is_empty() { base } else { format!("{base}\n\n{}", bot.system_prompt) }
}

/// Plan D21: agent session mode for each permission tier (the manifest agents: `tiers`). `None`: the agent has no
/// permission modes (pi's are its thought levels, DeepSeek Harness sets its sandbox by env); the owner's rules answer
/// its permission requests.
pub fn mode_for(kind: AgentKind, tier: Tier) -> Option<&'static str> {
    Some(match (kind, tier) {
        (AgentKind::Claude, Tier::Full) => "bypassPermissions",
        (AgentKind::Claude, Tier::Workspace) => "acceptEdits",
        (AgentKind::Claude, Tier::ReadOnly) => "default",
        (AgentKind::Codex, Tier::Full) => "agent-full-access",
        // Not `agent`: it hands approvals to Codex's own reviewer model (fails on third-party providers) instead
        // of the owner. `workspace-write` keeps approvals with the owner and limits edits to the workspace.
        (AgentKind::Codex, Tier::Workspace) => "workspace-write",
        (AgentKind::Codex, Tier::ReadOnly) => "read-only",
        _ => crate::adapters::get(kind)?.tier(tier)?.mode.as_deref()?,
    })
}

/// 帮我审批 hands approvals to the agent's own reviewer on its maker's service (`official`, [`agents::official_service`]):
/// Claude's `auto` (the adapter falls back to `acceptEdits` by itself where the model lacks it, so the mode in effect
/// is checked after switching) and Codex's `agent`. None: our rules and AI pre-review in [`mode_for`]'s mode.
///
/// [`agents::official_service`]: crate::agents::official_service
pub fn builtin_mode(kind: AgentKind, tier: Tier, ai_review: bool, official: bool) -> Option<&'static str> {
    if !ai_review || tier != Tier::Workspace || !official {
        return None;
    }
    match kind {
        AgentKind::Claude => Some("auto"),
        AgentKind::Codex => Some("agent"),
        _ => None,
    }
}

/// Claude `auto` lets pushes to any branch of the working repo through: these ask rules send them back to us, so a
/// push to a protected base branch still asks the owner. Prefix rules miss `git -C dir push`, hence the inner `*`.
pub const PUSH_ASK_RULES: [&str; 4] = ["Bash(git push)", "Bash(git push *)", "Bash(git * push)", "Bash(git * push *)"];

/// A Codex auto review (codex-acp's `guardian_assessment:` tool call) that denied, aborted or timed out: its summary.
/// Codex treats a failed review as a denial, so the bot would otherwise stall without a word.
pub fn auto_review_failure(update: &SessionUpdate) -> Option<String> {
    let (id, status, content, title) = match update {
        SessionUpdate::ToolCall(c) => (&c.tool_call_id, Some(c.status), Some(c.content.as_slice()), Some(&c.title)),
        SessionUpdate::ToolCallUpdate(u) => {
            (&u.tool_call_id, u.fields.status, u.fields.content.as_deref(), u.fields.title.as_ref())
        }
        _ => return None,
    };
    if !id.0.starts_with("guardian_assessment:") || status != Some(ToolCallStatus::Failed) {
        return None;
    }
    content.and_then(output_tail).or_else(|| title.cloned())
}

/// Plan D15: `full` allows on its own; other tiers ask the bot owner. `None` → answer `cancelled`.
pub fn auto_allow(options: &[PermissionOption]) -> Option<PermissionOptionId> {
    [PermissionOptionKind::AllowOnce, PermissionOptionKind::AllowAlways]
        .iter()
        .find_map(|k| options.iter().find(|o| o.kind == *k))
        .map(|o| o.option_id.clone())
}

/// Options as offered to the owner; kinds this protocol version does not know are left out.
pub fn wire_options(options: &[PermissionOption]) -> Vec<protocol::PermissionOption> {
    options
        .iter()
        .filter_map(|o| {
            Some(protocol::PermissionOption {
                option_id: o.option_id.0.to_string(),
                name: o.name.clone(),
                kind: serde_json::from_value(serde_json::to_value(o.kind).ok()?).ok()?,
            })
        })
        .collect()
}

/// Client `_meta` opting into codex-acp's typed session failures (JetBrains AIR extension v1); without it the
/// adapter reports errors as ordinary reply text.
/// Also opts into native subagent sessions and async tasks, so both adapters report delegation and background work
/// as `ExtUpdate`s instead of flattening them into the main transcript.
fn client_meta() -> serde_json::Map<String, serde_json::Value> {
    let capabilities = ["sessionFailure", "nativeSubagentSessions", "asyncTasks"];
    let v = serde_json::json!({ "jetbrains": { "air": { "version": 1, "capabilities": capabilities } } });
    v.as_object().cloned().unwrap_or_default()
}

/// What gonggong supports as an ACP client: compaction updates (instead of Claude's synthetic "Compact" tool call)
/// and the JetBrains extensions in `_meta`.
pub fn client_capabilities() -> ClientCapabilities {
    ClientCapabilities::new()
        .session(ClientSessionCapabilities::new().compaction(CompactionCapabilities::new()))
        .meta(client_meta())
}

/// Error title from a typed session failure in `_meta` (session_info_update or the prompt response).
/// Provider errors arrive as raw JSON bodies; their inner `error.message` is what users can act on.
pub fn session_failure(meta: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<String> {
    let meta = meta?;
    // An agent may end a failed model request as a refusal carrying the JSON-RPC error (its manifest's `errors`).
    if let Some(raw) = crate::adapters::error_meta_keys().find_map(|k| meta.get(k)?.as_str()) {
        let e = serde_json::from_str::<serde_json::Value>(raw).ok();
        let details = e.as_ref().and_then(|e| e.pointer("/data/details")?.as_str()?.lines().next().map(String::from));
        let message = e.as_ref().and_then(|e| e["message"].as_str().map(String::from));
        return Some(details.or(message).unwrap_or_else(|| raw.to_string()));
    }
    let f = meta.get("jetbrains")?.get("air")?.get("sessionFailure")?;
    if f.get("severity")?.as_str()? != "error" {
        return None;
    }
    let title = f.get("title").and_then(|t| t.as_str()).unwrap_or(crate::t!("agent 错误"));
    let inner = serde_json::from_str::<serde_json::Value>(title).ok();
    let message = inner.as_ref().and_then(|v| v.pointer("/error/message")).and_then(|m| m.as_str());
    Some(message.unwrap_or(title).to_string())
}

#[derive(Default)]
struct ToolState {
    title: String,
    kind: Option<ToolKind>,
    status: Option<ToolStatus>,
    location: Option<String>,
    command: Option<String>,
    output: Option<String>,
    mcp: Option<McpCall>,
    web: Option<WebCall>,
}

impl ToolState {
    /// A command's `$ <command>` plus the tail of its output, else the first location.
    fn detail(&self) -> Option<String> {
        let command = matches!(self.kind, Some(ToolKind::Execute)) && self.command.is_some();
        if let Some(l) = self.location.as_ref().filter(|_| !command) {
            return Some(l.clone());
        }
        let cmd = format!("$ {}", self.command.as_ref()?);
        Some(match (&self.kind, &self.output) {
            (Some(ToolKind::Execute), Some(out)) => format!("{cmd}\n{out}"),
            _ => cmd,
        })
    }
}

/// Draft ACP session updates (agent-client-protocol#1992 / AIR async tasks) the schema crate cannot parse yet.
#[derive(Debug, Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum ExtUpdate {
    #[serde(rename_all = "camelCase")]
    SubagentSpawned {
        subagent_session_id: String,
        name: String,
        task: String,
    },
    #[serde(rename_all = "camelCase")]
    SubagentStateUpdate {
        subagent_session_id: String,
        state: SubagentState,
    },
    AsyncTaskSpawned(TaskPatch),
    AsyncTaskProgress(TaskPatch),
    AsyncTaskStateUpdate(TaskPatch),
}

impl ExtUpdate {
    /// Whether a `sessionUpdate` tag is one of these, so standard updates (every text chunk) skip a doomed parse.
    pub fn is_ext(tag: &str) -> bool {
        tag.starts_with("subagent_") || tag.starts_with("async_task_")
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub async_task_id: String,
    name: Option<String>,
    task_type: Option<String>,
    description: Option<String>,
    state: Option<TaskState>,
    summary: Option<String>,
    output_file_path: Option<String>,
    tool_call_id: Option<String>,
    can_stop: Option<bool>,
}

/// A background task merged across its spawn / progress / state updates.
#[derive(Debug)]
pub struct TaskSnap {
    agent_id: Option<String>,
    tool_call_id: Option<String>,
    name: String,
    task_type: String,
    state: TaskState,
    summary: Option<String>,
    output_path: Option<String>,
    can_stop: bool,
}

impl TaskSnap {
    pub fn new(agent_id: Option<String>) -> Self {
        Self {
            agent_id,
            tool_call_id: None,
            name: String::new(),
            task_type: "task".into(),
            state: TaskState::Running,
            summary: None,
            output_path: None,
            can_stop: false,
        }
    }

    pub fn patch(&mut self, p: TaskPatch) -> RunEvent {
        if let Some(n) = p.name.or(p.description).filter(|n| !n.trim().is_empty()) {
            self.name = n;
        }
        // The first report names the kind (shell…); later lifecycle edges may only say "task".
        if self.task_type == "task"
            && let Some(t) = p.task_type
        {
            self.task_type = t;
        }
        self.state = p.state.unwrap_or(self.state);
        self.summary = p.summary.map(|s| clip(&s)).or(self.summary.take());
        self.output_path = p.output_file_path.or(self.output_path.take());
        self.tool_call_id = p.tool_call_id.or(self.tool_call_id.take());
        self.can_stop = p.can_stop.unwrap_or(self.can_stop);
        RunEvent::Task {
            task_id: p.async_task_id,
            agent_id: self.agent_id.clone(),
            tool_call_id: self.tool_call_id.clone(),
            name: self.name.clone(),
            task_type: self.task_type.clone(),
            state: self.state,
            summary: self.summary.clone(),
            output_path: self.output_path.clone(),
            can_stop: self.can_stop && !self.ended(),
        }
    }

    pub fn ended(&self) -> bool {
        matches!(self.state, TaskState::Completed | TaskState::Failed | TaskState::Stopped)
    }
}

struct Subagent {
    parent_id: Option<String>,
    name: String,
    task: String,
}

impl Subagent {
    fn event(&self, agent_id: &str, state: SubagentState) -> RunEvent {
        let (parent_id, name, task) = (self.parent_id.clone(), self.name.clone(), self.task.clone());
        RunEvent::Subagent { agent_id: agent_id.to_string(), parent_id, name, task, state }
    }
}

/// Claude Code's compaction thresholds for a run, captured at launch (its `autoCompact` logic, 2.1.x).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CompactPolicy {
    /// `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
    pub window: Option<u64>,
    /// `CLAUDE_CODE_MAX_OUTPUT_TOKENS`.
    pub max_output: Option<u64>,
    /// `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, within (0, 100].
    pub pct: Option<f64>,
    pub enabled: bool,
}

impl CompactPolicy {
    /// `(compact_at, block_at)` for a context window of `size` tokens: where the agent compacts by itself, or, with
    /// auto-compaction off, where it refuses to go on.
    pub fn point(&self, size: u64) -> (Option<u64>, Option<u64>) {
        const OUTPUT_RESERVE: u64 = 20_000;
        const BUFFER: u64 = 13_000;
        const BLOCK_BUFFER: u64 = 3_000;
        const MIN_WINDOW: u64 = 100_000;
        if !self.enabled {
            return (None, Some(size.saturating_sub(BLOCK_BUFFER)));
        }
        let window = self.window.map_or(size, |w| w.max(MIN_WINDOW).min(size));
        let effective = window.saturating_sub(self.max_output.map_or(OUTPUT_RESERVE, |m| m.min(OUTPUT_RESERVE)));
        let threshold = effective.saturating_sub(BUFFER);
        let at = match self.pct {
            Some(p) => ((effective as f64 * p / 100.0).floor() as u64).min(threshold),
            None => threshold,
        };
        (Some(at), None)
    }
}

/// Accumulates one prompt turn: final reply, changed files, usage, and tool call state across patches.
#[derive(Default)]
pub struct Turn {
    /// The main agent's text of the whole turn; see `reply`.
    text: String,
    /// Where in `text` the main agent's last tool call came.
    after_tool: usize,
    pub files: BTreeSet<String>,
    pub usage: Option<Usage>,
    /// Terminal agent error reported out of band (e.g. invalid model); the turn still ends with `end_turn`.
    pub failure: Option<String>,
    /// run.append messages fed into this turn.
    pub appends_applied: u32,
    /// Repo workspaces only: git state after the turn and the number of paths the turn changed.
    pub git: Option<(GitStatus, usize)>,
    /// Repo workspaces only: unified diff of the turn's changes.
    pub patch: Option<String>,
    /// The repos `patch` spans.
    pub repos: Vec<DiffRepo>,
    /// Force group: how the turn's submit settled.
    pub sync: Option<RunSyncDone>,
    /// Claude: how the run's agent compacts; None for agents whose thresholds are unknown.
    pub compact: Option<CompactPolicy>,
    /// Summary chunks of compactions in progress, by compaction id.
    summaries: HashMap<String, String>,
    tools: HashMap<(Option<String>, String), ToolState>,
    /// Subagents spawned this turn, by their ACP session id.
    subagents: HashMap<String, Subagent>,
    /// The main agent's plan last sent: an unchanged one is not sent again.
    plan: Option<Vec<PlanItem>>,
    /// The run's MCP server names, ours included: where Antigravity CLI's and OpenCode's MCP call titles split.
    pub mcp_servers: Vec<String>,
    /// Events a tool call implies beyond its own (OpenCode's todos and subagents), see `take_extra`.
    extra: Vec<RunEvent>,
    /// OpenCode subagents running, by the id of their task tool call.
    delegated: HashMap<String, Subagent>,
}

impl Turn {
    pub fn with_mcp(mcp_servers: Vec<String>) -> Self {
        Turn { mcp_servers, ..Turn::default() }
    }

    /// What the tool calls applied since the last call implied besides their own events.
    pub fn take_extra(&mut self) -> Vec<RunEvent> {
        std::mem::take(&mut self.extra)
    }

    /// The final reply: what the main agent said after its last tool call, as text before it is narration of the
    /// work; the whole text when the turn ends on a tool call.
    pub fn reply(&self) -> String {
        let tail = &self.text[self.after_tool..];
        if tail.trim().is_empty() { self.text.clone() } else { tail.to_string() }
    }

    pub fn clear_reply(&mut self) {
        self.text.clear();
        self.after_tool = 0;
    }

    /// The subagent `session` belongs to; None for the main agent.
    pub fn agent_of(&self, session: &str) -> Option<String> {
        self.subagents.contains_key(session).then(|| session.to_string())
    }

    /// Maps an update of ACP session `session` (the main one or a subagent's).
    pub fn apply(&mut self, session: &str, update: SessionUpdate) -> Option<RunEvent> {
        let agent_id = self.agent_of(session);
        match update {
            SessionUpdate::AgentMessageChunk(c) => text(c.content).map(|delta| {
                if agent_id.is_none() {
                    self.text.push_str(&delta);
                }
                RunEvent::Text { delta, agent_id }
            }),
            SessionUpdate::AgentThoughtChunk(c) => text(c.content).map(|delta| RunEvent::Thought { delta, agent_id }),
            SessionUpdate::ToolCall(c) => {
                if agent_id.is_none() {
                    self.after_tool = self.text.len();
                }
                Some(self.tool(agent_id, c.into()))
            }
            SessionUpdate::ToolCallUpdate(u) => Some(self.tool(agent_id, u)),
            SessionUpdate::UsageUpdate(u) if agent_id.is_none() => {
                let usage =
                    Usage { cost_usd: u.cost.filter(|c| c.currency == "USD").map(|c| c.amount), ..Default::default() };
                self.usage = Some(usage.clone());
                let (compact_at, block_at) = self.compact.map_or((None, None), |p| p.point(u.size));
                let context = ContextUsage { used: u.used, size: u.size, compact_at, block_at };
                Some(RunEvent::Usage { usage, context: Some(context), breakdown: None })
            }
            SessionUpdate::CompactionSummaryChunk(c) if agent_id.is_none() => {
                if let Some(t) = text(c.content) {
                    self.summaries.entry(c.compaction_id.0.to_string()).or_default().push_str(&t);
                }
                None
            }
            SessionUpdate::CompactionUpdate(u) if agent_id.is_none() => self.compaction(u),
            SessionUpdate::Plan(p) if agent_id.is_none() => self.plan(p.entries.into_iter().map(|e| {
                let status = match e.status {
                    PlanEntryStatus::InProgress => PlanStatus::InProgress,
                    PlanEntryStatus::Completed => PlanStatus::Completed,
                    _ => PlanStatus::Pending,
                };
                (e.content, status)
            })),
            SessionUpdate::SessionInfoUpdate(u) => {
                if let Some(title) = session_failure(u.meta.as_ref()) {
                    self.failure = Some(title);
                }
                None
            }
            _ => None,
        }
    }

    /// A compaction starting or ending; the summary streamed in chunks goes out once, with the end.
    /// The main agent's plan, unless it is the one last sent.
    fn plan(&mut self, entries: impl Iterator<Item = (String, PlanStatus)>) -> Option<RunEvent> {
        let entries: Vec<PlanItem> = entries
            .take(PLAN_ENTRIES)
            .map(|(content, status)| PlanItem { content: content.chars().take(PLAN_ITEM_MAX).collect(), status })
            .collect();
        if self.plan.as_ref() == Some(&entries) {
            return None;
        }
        self.plan = Some(entries.clone());
        Some(RunEvent::Plan { entries })
    }

    /// OpenCode's todowrite (`todos` in) is its plan, its task tool (`subagent_type` in) a subagent.
    fn implied(&mut self, id: &str, f: &ToolCallUpdateFields) {
        let raw = f.raw_input.as_ref();
        if let Some(todos) = raw.and_then(|r| r.get("todos")?.as_array()) {
            let entries = todos.iter().filter_map(|t| {
                let status = match t.get("status")?.as_str()? {
                    "in_progress" => PlanStatus::InProgress,
                    "completed" | "cancelled" => PlanStatus::Completed,
                    _ => PlanStatus::Pending,
                };
                Some((t.get("content")?.as_str()?.to_string(), status))
            });
            if let Some(plan) = self.plan(entries) {
                self.extra.push(plan);
            }
        }
        if let Some(r) = raw
            && !self.delegated.contains_key(id)
            && let (Some(kind), Some(task)) = (r.get("subagent_type"), r.get("prompt").and_then(|p| p.as_str()))
        {
            let name = r.get("description").or(Some(kind)).and_then(|n| n.as_str()).unwrap_or_default();
            let sub = Subagent { parent_id: None, name: name.to_string(), task: clip(task) };
            self.extra.push(sub.event(id, SubagentState::Running));
            self.delegated.insert(id.to_string(), sub);
        }
        let state = match f.status {
            Some(ToolCallStatus::Completed) => SubagentState::Completed,
            Some(ToolCallStatus::Failed) => SubagentState::Failed,
            _ => return,
        };
        if let Some(sub) = self.delegated.remove(id) {
            self.extra.push(sub.event(id, state));
        }
    }

    fn compaction(&mut self, u: CompactionUpdate) -> Option<RunEvent> {
        let id = u.compaction_id.0.to_string();
        let status = match u.status {
            AcpCompactionStatus::InProgress => CompactionStatus::Running,
            AcpCompactionStatus::Completed => CompactionStatus::Completed,
            AcpCompactionStatus::Failed => CompactionStatus::Failed,
            AcpCompactionStatus::Cancelled => CompactionStatus::Cancelled,
            _ => return None,
        };
        let meta = match &u.meta {
            MaybeUndefined::Value(m) => m.get("contextCompaction"),
            _ => None,
        };
        let tokens = |key: &str| meta?.get(key)?.as_u64();
        let trigger = match meta.and_then(|m| m.get("trigger")?.as_str()) {
            Some("automatic") => Some(CompactionTrigger::Auto),
            Some("manual") => Some(CompactionTrigger::Manual),
            _ => None,
        };
        let streamed = match status {
            CompactionStatus::Running => None,
            _ => self.summaries.remove(&id),
        };
        let patched = match u.summary {
            MaybeUndefined::Value(blocks) => Some(blocks.into_iter().filter_map(text).collect::<String>()),
            _ => None,
        };
        let summary =
            patched.or(streamed).filter(|s| !s.trim().is_empty()).map(|s| s.chars().take(SUMMARY_MAX).collect());
        Some(RunEvent::Compaction {
            compaction_id: id,
            status,
            trigger,
            pre_tokens: tokens("preTokens"),
            post_tokens: tokens("postTokens"),
            summary,
            error: match u.error {
                MaybeUndefined::Value(e) => Some(e),
                _ => None,
            },
        })
    }

    /// Subagent lifecycle announced in `session` (its parent's); async tasks are session-level, see `TaskSnap`.
    pub fn subagent(&mut self, session: &str, update: ExtUpdate) -> Option<RunEvent> {
        let (id, state) = match update {
            ExtUpdate::SubagentSpawned { subagent_session_id, name, task } => {
                let parent_id = self.agent_of(session);
                self.subagents.insert(subagent_session_id.clone(), Subagent { parent_id, name, task: clip(&task) });
                (subagent_session_id, SubagentState::Running)
            }
            ExtUpdate::SubagentStateUpdate { subagent_session_id, state } => (subagent_session_id, state),
            _ => return None,
        };
        Some(self.subagents.get(&id)?.event(&id, state))
    }

    fn tool(&mut self, agent_id: Option<String>, update: ToolCallUpdate) -> RunEvent {
        let (id, f) = (update.tool_call_id.0.to_string(), update.fields);
        if agent_id.is_none() {
            self.implied(&id, &f);
        }
        // Codex's edits have no locations: their paths are in the diffs.
        let mut paths: Vec<String> = match f.locations.as_deref() {
            Some(l) if !l.is_empty() => l.iter().map(|l| l.path.to_string_lossy().into_owned()).collect(),
            _ => diff_paths(f.content.as_deref().unwrap_or_default()),
        };
        paths.dedup();
        let line = f.locations.as_deref().and_then(|l| l.first()?.line);
        let state = self.tools.entry((agent_id.clone(), id.clone())).or_default();
        if let Some(t) = f.title
            && (t != mcp_call::CODEBUDDY_DEFER || state.title.is_empty())
        {
            state.title = t;
        }
        if state.title == mcp_call::CODEBUDDY_DEFER
            && let Some(target) = f.raw_input.as_ref().and_then(|r| r.get("toolName")?.as_str())
        {
            state.title = target.to_string();
        }
        state.kind = f.kind.or(state.kind.take());
        if let Some(s) = f.status.and_then(|s| serde_json::from_value(serde_json::to_value(s).ok()?).ok()) {
            state.status = Some(s);
        }
        if matches!(state.kind, Some(ToolKind::Edit | ToolKind::Delete | ToolKind::Move)) {
            self.files.extend(paths.iter().cloned());
        }
        if let Some(path) = paths.first() {
            let at = line.map_or_else(|| path.clone(), |n| format!("{path}:{n}"));
            let more = match paths.len() - 1 {
                0 => String::new(),
                n => format!(" +{n}"),
            };
            state.location = Some(format!("{}{more}", clip_head(&at)));
        }
        if let Some(cmd) = f.raw_input.as_ref().and_then(|v| command_field(v)?.as_str()) {
            state.command = Some(clip(cmd));
        }
        if let Some(out) = output_tail(f.content.as_deref().unwrap_or_default()) {
            state.output = Some(out);
        }
        if web_call::is_web(state.kind.as_ref(), f.raw_input.as_ref()) {
            let web = state.web.get_or_insert_default();
            if let Some(raw) = f.raw_input.as_ref() {
                web.query = web_call::query(raw).or(web.query.take());
                web.url = web_call::url(raw).or(web.url.take());
            }
            let hits = web_call::hits(f.content.as_deref().unwrap_or_default());
            if !hits.is_empty() && web.url.is_none() {
                web.hits = hits;
            }
        }
        let underscored = mcp_call::underscored_name(&state.title, &self.mcp_servers);
        let raw_input = match (state.title.starts_with(mcp_call::ANTIGRAVITY_PREFIX), f.raw_input) {
            (true, Some(serde_json::Value::Object(mut args))) => {
                args.remove(mcp_call::ANTIGRAVITY_SUMMARY);
                Some(serde_json::Value::Object(args))
            }
            (_, raw) => raw,
        };
        if state.mcp.is_none()
            && let Some((server, tool)) = mcp_call::name(&state.title).or(underscored)
        {
            state.mcp = Some(McpCall { server, tool, input: None, output: None });
        }
        if let Some(m) = state.mcp.as_mut() {
            if let Some(input) = raw_input.as_ref().and_then(mcp_call::input) {
                m.input = Some(input);
            }
            if let Some(out) = mcp_call::output(f.content.as_deref().unwrap_or_default(), f.raw_output.as_ref()) {
                m.output = Some(out);
            }
        }
        RunEvent::Tool {
            agent_id,
            tool_call_id: id,
            title: state.title.clone(),
            tool_kind: state
                .kind
                .as_ref()
                .and_then(|k| serde_json::to_value(k).ok()?.as_str().map(String::from))
                .unwrap_or_else(|| "other".into()),
            status: state.status.unwrap_or(ToolStatus::Pending),
            detail: state.detail(),
            mcp: state.mcp.clone(),
            web: state.web.clone().filter(|w| w.query.is_some() || w.url.is_some()),
        }
    }
}

fn diff_paths(content: &[ToolCallContent]) -> Vec<String> {
    content
        .iter()
        .filter_map(|c| match c {
            ToolCallContent::Diff(d) => Some(d.path.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

fn text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(t) => Some(t.text),
        _ => None,
    }
}

/// The command of an execute call's raw input: `command`, or `CommandLine` (Antigravity CLI's run_command).
pub(crate) fn command_field(raw: &serde_json::Value) -> Option<&serde_json::Value> {
    raw.get("command").or_else(|| raw.get("CommandLine"))
}

fn clip(s: &str) -> String {
    s.chars().take(DETAIL_MAX).collect()
}

/// Paths keep their end: the file name matters, deep workspace roots easily pass the limit.
fn clip_head(s: &str) -> String {
    let skip = s.chars().count().saturating_sub(DETAIL_MAX);
    if skip == 0 { s.to_string() } else { format!("…{}", s.chars().skip(skip + 1).collect::<String>()) }
}

/// Last lines of a tool's text result, without the adapter's ```console fence.
fn output_tail(content: &[ToolCallContent]) -> Option<String> {
    let text: String = content
        .iter()
        .filter_map(|c| match c {
            ToolCallContent::Content(c) => match &c.content {
                ContentBlock::Text(t) => Some(t.text.as_str()),
                _ => None,
            },
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n");
    let body = match text.trim().strip_prefix("```") {
        Some(fenced) => fenced.split_once('\n').map_or("", |(_, rest)| rest).trim_end().trim_end_matches("```"),
        None => text.as_str(),
    };
    let lines: Vec<&str> = body.trim_end().lines().collect();
    let tail = lines[lines.len().saturating_sub(OUTPUT_LINES)..].join("\n");
    let skip = tail.chars().count().saturating_sub(OUTPUT_MAX);
    let tail: String = tail.chars().skip(skip).collect();
    (!tail.trim().is_empty()).then_some(tail)
}

#[cfg(test)]
mod tests;
