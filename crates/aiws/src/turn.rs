//! Pure per-turn logic: prompt composition, ACP update → RunEvent mapping, tier policies.
use crate::protocol::{AgentKind, ContextMessage, RunBot, RunEvent, RunPrompt, Tier, ToolStatus, Usage};
use agent_client_protocol::schema::v1::{
    ContentBlock, PermissionOption, PermissionOptionId, PermissionOptionKind, SessionUpdate, ToolCallLocation, ToolKind,
};
use std::collections::{BTreeSet, HashMap};

const DETAIL_MAX: usize = 200;

/// Context lines (`[time] author: body`) followed by `<trigger> 说：<text>`.
pub fn compose_prompt(prompt: &RunPrompt, history: &[ContextMessage]) -> String {
    let mut out = String::new();
    if !history.is_empty() {
        out.push_str("群聊上下文：\n");
        for m in history {
            out.push_str(&format!("[{}] {}: {}\n", short_time(&m.at), m.author, m.body));
        }
        out.push('\n');
    }
    out.push_str(&format!("{} 说：{}", prompt.triggered_by, prompt.text));
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

/// M1 has no approval flow: `full` allows, other tiers reject. `None` → answer `cancelled`.
pub fn permission_choice(tier: Tier, options: &[PermissionOption]) -> Option<PermissionOptionId> {
    let prefs = if tier == Tier::Full {
        [PermissionOptionKind::AllowOnce, PermissionOptionKind::AllowAlways]
    } else {
        [PermissionOptionKind::RejectOnce, PermissionOptionKind::RejectAlways]
    };
    prefs.iter().find_map(|k| options.iter().find(|o| o.kind == *k)).map(|o| o.option_id.clone())
}

#[derive(Default)]
struct ToolState {
    title: String,
    kind: Option<ToolKind>,
    status: Option<ToolStatus>,
}

/// Accumulates one prompt turn: final reply, changed files, usage, and tool call state across patches.
#[derive(Default)]
pub struct Turn {
    pub reply: String,
    pub files: BTreeSet<String>,
    pub usage: Option<Usage>,
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
            SessionUpdate::ToolCall(c) => Some(self.tool(
                c.tool_call_id.0.to_string(),
                Some(c.title),
                Some(c.kind),
                Some(c.status),
                &c.locations,
                c.raw_input.as_ref(),
            )),
            SessionUpdate::ToolCallUpdate(u) => Some(self.tool(
                u.tool_call_id.0.to_string(),
                u.fields.title,
                u.fields.kind,
                u.fields.status,
                u.fields.locations.as_deref().unwrap_or_default(),
                u.fields.raw_input.as_ref(),
            )),
            SessionUpdate::UsageUpdate(u) => {
                let usage = Usage {
                    total_tokens: Some(u.used),
                    cost_usd: u.cost.filter(|c| c.currency == "USD").map(|c| c.amount),
                    ..Default::default()
                };
                self.usage = Some(usage.clone());
                Some(RunEvent::Usage { usage })
            }
            _ => None,
        }
    }

    fn tool(
        &mut self,
        id: String,
        title: Option<String>,
        kind: Option<ToolKind>,
        status: Option<impl serde::Serialize>,
        locations: &[ToolCallLocation],
        raw_input: Option<&serde_json::Value>,
    ) -> RunEvent {
        let state = self.tools.entry(id.clone()).or_default();
        if let Some(t) = title {
            state.title = t;
        }
        state.kind = kind.or(state.kind.take());
        if let Some(s) = status.and_then(|s| serde_json::from_value(serde_json::to_value(s).ok()?).ok()) {
            state.status = Some(s);
        }
        if matches!(state.kind, Some(ToolKind::Edit | ToolKind::Delete | ToolKind::Move)) {
            self.files.extend(locations.iter().map(|l| l.path.to_string_lossy().into_owned()));
        }
        RunEvent::Tool {
            tool_call_id: id,
            title: state.title.clone(),
            tool_kind: state.kind.as_ref().and_then(|k| serde_json::to_value(k).ok()?.as_str().map(String::from)).unwrap_or_else(|| "other".into()),
            status: state.status.unwrap_or(ToolStatus::Pending),
            detail: detail(locations, raw_input),
        }
    }
}

fn text(block: ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(t) => Some(t.text),
        _ => None,
    }
}

/// First location, else the shell command, truncated.
fn detail(locations: &[ToolCallLocation], raw_input: Option<&serde_json::Value>) -> Option<String> {
    let s = match locations.first() {
        Some(l) => match l.line {
            Some(n) => format!("{}:{n}", l.path.display()),
            None => l.path.display().to_string(),
        },
        None => raw_input?.get("command")?.as_str()?.to_string(),
    };
    Some(s.chars().take(DETAIL_MAX).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        ContentChunk, Cost, TextContent, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, UsageUpdate,
    };

    fn ctx(author: &str, body: &str) -> ContextMessage {
        ContextMessage { seq: 1, author: author.into(), kind: "user".into(), body: body.into(), at: "2026-09-23T10:12:00.123Z".into() }
    }

    fn prompt() -> RunPrompt {
        RunPrompt { text: "@小王 写个脚本".into(), triggered_by: "王磊".into(), context: vec![], fallback_context: vec![] }
    }

    #[test]
    fn composes_context_then_trigger() {
        assert_eq!(
            compose_prompt(&prompt(), &[ctx("陈晨", "退款 v1 下线"), ctx("小李的 Codex", "接口已改好")]),
            "群聊上下文：\n[2026-09-23 10:12] 陈晨: 退款 v1 下线\n[2026-09-23 10:12] 小李的 Codex: 接口已改好\n\n王磊 说：@小王 写个脚本"
        );
        assert_eq!(compose_prompt(&prompt(), &[]), "王磊 说：@小王 写个脚本");
    }

    #[test]
    fn system_prompt_appends_bot_instructions() {
        let bot = RunBot { id: "b".into(), name: "小王".into(), agent_kind: AgentKind::Claude, system_prompt: "只改 server/".into(), tier: Tier::Workspace };
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
    fn full_tier_allows_others_reject() {
        let opts = vec![
            PermissionOption::new("a", "Allow", PermissionOptionKind::AllowOnce),
            PermissionOption::new("r", "Reject", PermissionOptionKind::RejectOnce),
        ];
        assert_eq!(permission_choice(Tier::Full, &opts).unwrap().0.as_ref(), "a");
        assert_eq!(permission_choice(Tier::Workspace, &opts).unwrap().0.as_ref(), "r");
        assert!(permission_choice(Tier::ReadOnly, &opts[..1]).is_none());
    }

    #[test]
    fn maps_updates_and_accumulates_reply_files_usage() {
        let mut t = Turn::default();
        let chunk = |s: &str| ContentChunk::new(ContentBlock::Text(TextContent::new(s)));
        assert_eq!(t.apply(SessionUpdate::AgentMessageChunk(chunk("好的，"))), Some(RunEvent::Text { delta: "好的，".into() }));
        assert_eq!(t.apply(SessionUpdate::AgentThoughtChunk(chunk("想"))), Some(RunEvent::Thought { delta: "想".into() }));
        t.apply(SessionUpdate::AgentMessageChunk(chunk("完成")));
        assert_eq!(t.reply, "好的，完成");

        let read = ToolCall::new("r1", "Read a").kind(ToolKind::Read).locations(vec![ToolCallLocation::new("/w/a.rs")]);
        t.apply(SessionUpdate::ToolCall(read));
        let edit = ToolCall::new("e1", "Edit b").kind(ToolKind::Edit).status(ToolCallStatus::InProgress).locations(vec![ToolCallLocation::new("/w/b.rs").line(3)]);
        assert_eq!(
            t.apply(SessionUpdate::ToolCall(edit)),
            Some(RunEvent::Tool { tool_call_id: "e1".into(), title: "Edit b".into(), tool_kind: "edit".into(), status: ToolStatus::InProgress, detail: Some("/w/b.rs:3".into()) })
        );
        let done = ToolCallUpdate::new("e1", ToolCallUpdateFields::new().status(ToolCallStatus::Completed).locations(vec![ToolCallLocation::new("/w/c.rs")]));
        assert_eq!(
            t.apply(SessionUpdate::ToolCallUpdate(done)),
            Some(RunEvent::Tool { tool_call_id: "e1".into(), title: "Edit b".into(), tool_kind: "edit".into(), status: ToolStatus::Completed, detail: Some("/w/c.rs".into()) })
        );
        assert_eq!(t.files.iter().cloned().collect::<Vec<_>>(), vec!["/w/b.rs", "/w/c.rs"]);

        t.apply(SessionUpdate::UsageUpdate(UsageUpdate::new(1200, 200000).cost(Cost::new(0.5, "USD"))));
        assert_eq!(t.usage, Some(Usage { total_tokens: Some(1200), cost_usd: Some(0.5), ..Default::default() }));
    }

    #[test]
    fn shell_command_is_the_detail_without_locations() {
        let mut t = Turn::default();
        let exec = ToolCall::new("x", "Run").kind(ToolKind::Execute).raw_input(serde_json::json!({ "command": "ls -la" }));
        let Some(RunEvent::Tool { detail, .. }) = t.apply(SessionUpdate::ToolCall(exec)) else { panic!() };
        assert_eq!(detail.as_deref(), Some("ls -la"));
    }
}
