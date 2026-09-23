//! Pure per-turn logic: prompt composition, ACP update → RunEvent mapping, tier policies.
use crate::attachments::rel_path;
use crate::protocol::{
    self, AgentKind, ContextMessage, GitStatus, RunBot, RunEvent, RunPrompt, Tier, ToolStatus, Usage,
};
use agent_client_protocol::schema::v1::{
    ContentBlock, PermissionOption, PermissionOptionId, PermissionOptionKind, SessionUpdate, ToolCallContent,
    ToolCallUpdate, ToolKind,
};
use std::collections::{BTreeSet, HashMap};

const DETAIL_MAX: usize = 200;
/// Tail of a shell command's output kept in the tool detail.
const OUTPUT_LINES: usize = 20;
const OUTPUT_MAX: usize = 1500;

/// Git default-action note, context lines (`[time] author: body（附件：…）`), the quote, then
/// `<trigger> 说：<text>` with one `附件：<path>` line per attachment.
pub fn compose_prompt(prompt: &RunPrompt, history: &[ContextMessage], git: Option<&str>) -> String {
    let mut out = git.map(|g| format!("{g}\n\n")).unwrap_or_default();
    if !history.is_empty() {
        out.push_str("群聊上下文：\n");
        for m in history {
            let files: Vec<String> = m.attachments.iter().map(rel_path).collect();
            let files = if files.is_empty() { String::new() } else { format!("（附件：{}）", files.join("、")) };
            out.push_str(&format!("[{}] {}: {}{files}\n", short_time(&m.at), m.author, m.body));
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

/// "2026-09-23T10:12:00.123Z" → "2026-09-23 10:12" (UTC, as sent by the server).
fn short_time(iso: &str) -> String {
    iso.get(..16).unwrap_or(iso).replacen('T', " ", 1)
}

pub fn system_prompt(bot: &RunBot) -> String {
    let base = format!(
        "你是团队群聊里的 bot「{}」。群成员 @ 你时，消息以「<名字> 说：」开头，之前可能附有群聊上下文。最终回复会作为你的群消息发出。",
        bot.name
    );
    if bot.system_prompt.trim().is_empty() { base } else { format!("{base}\n\n{}", bot.system_prompt) }
}

/// Plan D21: agent session mode for each permission tier.
pub fn mode_for(kind: AgentKind, tier: Tier) -> &'static str {
    match (kind, tier) {
        (AgentKind::Claude, Tier::Full) => "bypassPermissions",
        (AgentKind::Claude, Tier::Workspace) => "acceptEdits",
        (AgentKind::Claude, Tier::ReadOnly) => "default",
        (AgentKind::Codex, Tier::Full) => "agent-full-access",
        (AgentKind::Codex, Tier::Workspace) => "agent",
        (AgentKind::Codex, Tier::ReadOnly) => "read-only",
    }
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
pub fn client_meta() -> serde_json::Map<String, serde_json::Value> {
    let v = serde_json::json!({ "jetbrains": { "air": { "version": 1, "capabilities": ["sessionFailure"] } } });
    v.as_object().cloned().unwrap_or_default()
}

/// Error title from a typed session failure in `_meta` (session_info_update or the prompt response).
/// Provider errors arrive as raw JSON bodies; their inner `error.message` is what users can act on.
pub fn session_failure(meta: Option<&serde_json::Map<String, serde_json::Value>>) -> Option<String> {
    let f = meta?.get("jetbrains")?.get("air")?.get("sessionFailure")?;
    if f.get("severity")?.as_str()? != "error" {
        return None;
    }
    let title = f.get("title").and_then(|t| t.as_str()).unwrap_or("agent 错误");
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
}

impl ToolState {
    /// First location, else `$ <command>` plus the tail of its output.
    fn detail(&self) -> Option<String> {
        if let Some(l) = &self.location {
            return Some(l.clone());
        }
        let cmd = format!("$ {}", self.command.as_ref()?);
        Some(match (&self.kind, &self.output) {
            (Some(ToolKind::Execute), Some(out)) => format!("{cmd}\n{out}"),
            _ => cmd,
        })
    }
}

/// Accumulates one prompt turn: final reply, changed files, usage, and tool call state across patches.
#[derive(Default)]
pub struct Turn {
    pub reply: String,
    pub files: BTreeSet<String>,
    pub usage: Option<Usage>,
    /// Terminal agent error reported out of band (e.g. invalid model); the turn still ends with `end_turn`.
    pub failure: Option<String>,
    /// Repo workspaces only: git state after the turn and the number of paths the turn changed.
    pub git: Option<(GitStatus, usize)>,
    /// Repo workspaces only: unified diff of the turn's changes.
    pub patch: Option<String>,
    tools: HashMap<String, ToolState>,
}

impl Turn {
    pub fn apply(&mut self, update: SessionUpdate) -> Option<RunEvent> {
        match update {
            SessionUpdate::AgentMessageChunk(c) => text(c.content).map(|delta| {
                self.reply.push_str(&delta);
                RunEvent::Text { delta }
            }),
            SessionUpdate::AgentThoughtChunk(c) => text(c.content).map(|delta| RunEvent::Thought { delta }),
            SessionUpdate::ToolCall(c) => Some(self.tool(c.into())),
            SessionUpdate::ToolCallUpdate(u) => Some(self.tool(u)),
            SessionUpdate::UsageUpdate(u) => {
                let usage = Usage {
                    total_tokens: Some(u.used),
                    cost_usd: u.cost.filter(|c| c.currency == "USD").map(|c| c.amount),
                    ..Default::default()
                };
                self.usage = Some(usage.clone());
                Some(RunEvent::Usage { usage })
            }
            SessionUpdate::SessionInfoUpdate(u) => {
                if let Some(title) = session_failure(u.meta.as_ref()) {
                    self.failure = Some(title);
                }
                None
            }
            _ => None,
        }
    }

    fn tool(&mut self, update: ToolCallUpdate) -> RunEvent {
        let (id, f) = (update.tool_call_id.0.to_string(), update.fields);
        let locations = f.locations.as_deref().unwrap_or_default();
        let state = self.tools.entry(id.clone()).or_default();
        if let Some(t) = f.title {
            state.title = t;
        }
        state.kind = f.kind.or(state.kind.take());
        if let Some(s) = f.status.and_then(|s| serde_json::from_value(serde_json::to_value(s).ok()?).ok()) {
            state.status = Some(s);
        }
        if matches!(state.kind, Some(ToolKind::Edit | ToolKind::Delete | ToolKind::Move)) {
            self.files.extend(locations.iter().map(|l| l.path.to_string_lossy().into_owned()));
        }
        if let Some(l) = locations.first() {
            let path = l.path.display();
            state.location = Some(clip(&l.line.map_or_else(|| path.to_string(), |n| format!("{path}:{n}"))));
        }
        if let Some(cmd) = f.raw_input.as_ref().and_then(|v| v.get("command")?.as_str()) {
            state.command = Some(clip(cmd));
        }
        if let Some(out) = output_tail(f.content.as_deref().unwrap_or_default()) {
            state.output = Some(out);
        }
        RunEvent::Tool {
            tool_call_id: id,
            title: state.title.clone(),
            tool_kind: state
                .kind
                .as_ref()
                .and_then(|k| serde_json::to_value(k).ok()?.as_str().map(String::from))
                .unwrap_or_else(|| "other".into()),
            status: state.status.unwrap_or(ToolStatus::Pending),
            detail: state.detail(),
        }
    }
}

fn text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(t) => Some(t.text),
        _ => None,
    }
}

fn clip(s: &str) -> String {
    s.chars().take(DETAIL_MAX).collect()
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
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        ContentChunk, Cost, SessionInfoUpdate, TextContent, ToolCall, ToolCallLocation, ToolCallStatus,
        ToolCallUpdateFields, UsageUpdate,
    };

    fn ctx(author: &str, body: &str) -> ContextMessage {
        ContextMessage {
            seq: 1,
            author: author.into(),
            kind: "user".into(),
            body: body.into(),
            at: "2026-09-23T10:12:00.123Z".into(),
            attachments: vec![],
        }
    }

    fn prompt() -> RunPrompt {
        RunPrompt {
            text: "@小王 写个脚本".into(),
            triggered_by: "王磊".into(),
            context: vec![],
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        }
    }

    #[test]
    fn composes_context_then_trigger() {
        assert_eq!(
            compose_prompt(&prompt(), &[ctx("陈晨", "退款 v1 下线"), ctx("小李的 Codex", "接口已改好")], None),
            "群聊上下文：\n[2026-09-23 10:12] 陈晨: 退款 v1 下线\n[2026-09-23 10:12] 小李的 Codex: 接口已改好\n\n王磊 说：@小王 写个脚本"
        );
        assert_eq!(compose_prompt(&prompt(), &[], None), "王磊 说：@小王 写个脚本");
        assert_eq!(
            compose_prompt(&prompt(), &[ctx("陈晨", "hi")], Some("git 默认动作：fetch 完成。")),
            "git 默认动作：fetch 完成。\n\n群聊上下文：\n[2026-09-23 10:12] 陈晨: hi\n\n王磊 说：@小王 写个脚本"
        );
    }

    #[test]
    fn system_prompt_appends_bot_instructions() {
        let bot = RunBot {
            id: "b".into(),
            name: "小王".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: "只改 server/".into(),
            tier: Tier::Workspace,
        };
        let s = system_prompt(&bot);
        assert!(s.starts_with("你是团队群聊里的 bot「小王」"));
        assert!(s.ends_with("\n\n只改 server/"));
    }

    #[test]
    fn maps_tiers_to_modes() {
        assert_eq!(mode_for(AgentKind::Claude, Tier::Full), "bypassPermissions");
        assert_eq!(mode_for(AgentKind::Codex, Tier::ReadOnly), "read-only");
    }

    #[test]
    fn full_tier_allows_and_options_go_on_the_wire() {
        let opts = vec![
            PermissionOption::new("r", "Reject", PermissionOptionKind::RejectOnce),
            PermissionOption::new("aa", "Always", PermissionOptionKind::AllowAlways),
            PermissionOption::new("a", "Allow", PermissionOptionKind::AllowOnce),
        ];
        assert_eq!(auto_allow(&opts).unwrap().0.as_ref(), "a");
        assert!(auto_allow(&opts[..1]).is_none());
        assert_eq!(
            wire_options(&opts[..1]),
            vec![protocol::PermissionOption {
                option_id: "r".into(),
                name: "Reject".into(),
                kind: protocol::PermissionKind::RejectOnce
            }]
        );
    }

    #[test]
    fn maps_updates_and_accumulates_reply_files_usage() {
        let mut t = Turn::default();
        let chunk = |s: &str| ContentChunk::new(ContentBlock::Text(TextContent::new(s)));
        assert_eq!(
            t.apply(SessionUpdate::AgentMessageChunk(chunk("好的，"))),
            Some(RunEvent::Text { delta: "好的，".into() })
        );
        assert_eq!(
            t.apply(SessionUpdate::AgentThoughtChunk(chunk("想"))),
            Some(RunEvent::Thought { delta: "想".into() })
        );
        t.apply(SessionUpdate::AgentMessageChunk(chunk("完成")));
        assert_eq!(t.reply, "好的，完成");

        let read = ToolCall::new("r1", "Read a").kind(ToolKind::Read).locations(vec![ToolCallLocation::new("/w/a.rs")]);
        t.apply(SessionUpdate::ToolCall(read));
        let edit = ToolCall::new("e1", "Edit b")
            .kind(ToolKind::Edit)
            .status(ToolCallStatus::InProgress)
            .locations(vec![ToolCallLocation::new("/w/b.rs").line(3)]);
        assert_eq!(
            t.apply(SessionUpdate::ToolCall(edit)),
            Some(RunEvent::Tool {
                tool_call_id: "e1".into(),
                title: "Edit b".into(),
                tool_kind: "edit".into(),
                status: ToolStatus::InProgress,
                detail: Some("/w/b.rs:3".into())
            })
        );
        let done = ToolCallUpdate::new(
            "e1",
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .locations(vec![ToolCallLocation::new("/w/c.rs")]),
        );
        assert_eq!(
            t.apply(SessionUpdate::ToolCallUpdate(done)),
            Some(RunEvent::Tool {
                tool_call_id: "e1".into(),
                title: "Edit b".into(),
                tool_kind: "edit".into(),
                status: ToolStatus::Completed,
                detail: Some("/w/c.rs".into())
            })
        );
        assert_eq!(t.files.iter().cloned().collect::<Vec<_>>(), vec!["/w/b.rs", "/w/c.rs"]);

        t.apply(SessionUpdate::UsageUpdate(UsageUpdate::new(1200, 200000).cost(Cost::new(0.5, "USD"))));
        assert_eq!(t.usage, Some(Usage { total_tokens: Some(1200), cost_usd: Some(0.5), ..Default::default() }));
    }

    #[test]
    fn records_typed_session_failures_but_not_warnings() {
        let mut t = Turn::default();
        let info = |severity: &str| {
            let meta = serde_json::json!({ "jetbrains": { "air": { "version": 1, "sessionFailure": { "severity": severity, "title": "model not supported" } } } });
            SessionUpdate::SessionInfoUpdate(SessionInfoUpdate::new().meta(meta.as_object().cloned().unwrap()))
        };
        t.apply(info("warning"));
        assert_eq!(t.failure, None);
        t.apply(info("error"));
        assert_eq!(t.failure.as_deref(), Some("model not supported"));
    }

    #[test]
    fn unwraps_provider_json_error_titles() {
        let title =
            r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"model not supported"}}"#;
        let meta = serde_json::json!({ "jetbrains": { "air": { "sessionFailure": { "severity": "error", "title": title } } } });
        assert_eq!(session_failure(meta.as_object()).as_deref(), Some("model not supported"));
    }

    #[test]
    fn shell_command_and_its_output_tail_are_the_detail_without_locations() {
        let mut t = Turn::default();
        let exec =
            ToolCall::new("x", "Run").kind(ToolKind::Execute).raw_input(serde_json::json!({ "command": "ls -la" }));
        let Some(RunEvent::Tool { detail, .. }) = t.apply(SessionUpdate::ToolCall(exec)) else { panic!() };
        assert_eq!(detail.as_deref(), Some("$ ls -la"));

        let lines: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
        let output = format!("```console\n{}\n```", lines.join("\n"));
        let done = ToolCallUpdate::new(
            "x",
            ToolCallUpdateFields::new()
                .status(ToolCallStatus::Completed)
                .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new(output)))]),
        );
        let Some(RunEvent::Tool { detail, .. }) = t.apply(SessionUpdate::ToolCallUpdate(done)) else { panic!() };
        let expected = format!("$ ls -la\n{}", lines[30 - OUTPUT_LINES..].join("\n"));
        assert_eq!(detail.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn read_results_are_not_output() {
        let mut t = Turn::default();
        let read = ToolCall::new("r", "Read a")
            .kind(ToolKind::Read)
            .locations(vec![ToolCallLocation::new("/w/a.rs")])
            .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new("fn main() {}")))]);
        let Some(RunEvent::Tool { detail, .. }) = t.apply(SessionUpdate::ToolCall(read)) else { panic!() };
        assert_eq!(detail.as_deref(), Some("/w/a.rs"));
    }
}
