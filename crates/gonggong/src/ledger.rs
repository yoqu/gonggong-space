//! Estimated make-up of an ACP session's context, from the prompts we send and the updates we see. Agents report
//! only the total (usage_update); the share of the system prompt and tool definitions is what is left of it.
use crate::mcp_call;
use crate::protocol::{CacheUsage, ContextBreakdown, ContextUsage, ToolTokens};
use agent_client_protocol::schema::v1::{ContentBlock, SessionUpdate, ToolCallContent, ToolCallUpdate};
use std::collections::HashMap;

#[derive(Default)]
pub struct Ledger {
    turns: Vec<u64>,
    /// By tool call id, in the order first seen.
    tools: Vec<(String, ToolCost)>,
    partial: bool,
    context: Option<ContextUsage>,
}

#[derive(Default)]
struct ToolCost {
    name: Option<String>,
    kind: Option<String>,
    input: u64,
    output: u64,
}

impl Ledger {
    /// A session we did not see from its start (resumed after a daemon restart).
    pub fn resumed() -> Self {
        Ledger { partial: true, ..Default::default() }
    }

    /// A prompt sent to the agent: `new_turn` starts a turn, else it continues the last (打断并追加).
    pub fn prompt(&mut self, text: &str, new_turn: bool) {
        if new_turn || self.turns.is_empty() {
            self.turns.push(0);
        }
        *self.turns.last_mut().expect("a turn") += tokens(text);
    }

    /// An update of the main agent (subagents' work stays out of its context).
    pub fn observe(&mut self, update: &SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(c) => {
                if let ContentBlock::Text(t) = &c.content {
                    if self.turns.is_empty() {
                        self.turns.push(0);
                    }
                    *self.turns.last_mut().expect("a turn") += tokens(&t.text);
                }
            }
            SessionUpdate::ToolCall(c) => self.tool(c.clone().into()),
            SessionUpdate::ToolCallUpdate(u) => self.tool(u.clone()),
            SessionUpdate::UsageUpdate(u) => {
                // Shrinking means the agent compacted or cleared old tool results: what we counted is gone.
                if self.context.is_some_and(|c| u.used < c.used) {
                    self.turns.clear();
                    self.tools.clear();
                    self.partial = true;
                }
            }
            _ => {}
        }
    }

    /// The occupancy last reported (with the agent's compaction thresholds).
    pub fn context(&mut self, context: ContextUsage) {
        self.context = Some(context);
    }

    pub fn snapshot(&self, cache: Option<CacheUsage>) -> Option<(ContextUsage, ContextBreakdown)> {
        let context = self.context?;
        let mut tools: Vec<ToolTokens> = Vec::new();
        let mut at: HashMap<(Option<String>, String), usize> = HashMap::new();
        for (_, c) in &self.tools {
            let key = (c.name.clone(), c.kind.clone().unwrap_or_else(|| "other".into()));
            let i = *at.entry(key.clone()).or_insert_with(|| {
                tools.push(ToolTokens { name: key.0, kind: key.1, count: 0, tokens: 0 });
                tools.len() - 1
            });
            tools[i].count += 1;
            tools[i].tokens += c.input + c.output;
        }
        tools.sort_by(|a, b| b.tokens.cmp(&a.tokens));
        Some((context, ContextBreakdown { tools, turns: self.turns.clone(), partial: self.partial, cache }))
    }

    fn tool(&mut self, update: ToolCallUpdate) {
        let id = update.tool_call_id.0.to_string();
        let i = match self.tools.iter().position(|(k, _)| *k == id) {
            Some(i) => i,
            None => {
                self.tools.push((id, ToolCost::default()));
                self.tools.len() - 1
            }
        };
        let cost = &mut self.tools[i].1;
        let f = &update.fields;
        if cost.name.is_none() {
            cost.name = tool_name(update.meta.as_ref(), f.title.as_deref());
        }
        if let Some(k) = f.kind.as_ref().and_then(|k| serde_json::to_value(k).ok()?.as_str().map(String::from)) {
            cost.kind = Some(k);
        }
        if let Some(raw) = &f.raw_input {
            cost.input = tokens(&raw.to_string());
        }
        // `content` replaces the call's content; Codex reports some results only as `rawOutput`.
        let content = f.content.as_deref().map(content_tokens).unwrap_or_default();
        if content > 0 {
            cost.output = content;
        } else if let Some(raw) = &f.raw_output {
            cost.output = cost.output.max(tokens(&raw.to_string()));
        }
    }
}

/// Claude's own tool name (`_meta.claudeCode.toolName`), else an MCP tool's from the title.
fn tool_name(meta: Option<&serde_json::Map<String, serde_json::Value>>, title: Option<&str>) -> Option<String> {
    let claude = meta.and_then(|m| m.get("claudeCode")?.get("toolName")?.as_str()).map(String::from);
    let mcp = |t: &str| mcp_call::name(t).map(|(_, tool)| tool);
    match claude {
        Some(n) => Some(mcp(&n).unwrap_or(n)),
        None => title.and_then(mcp),
    }
}

fn content_tokens(content: &[ToolCallContent]) -> u64 {
    content
        .iter()
        .map(|c| match c {
            ToolCallContent::Content(c) => match &c.content {
                ContentBlock::Text(t) => tokens(&t.text),
                _ => 0,
            },
            ToolCallContent::Diff(d) => tokens(&d.new_text) + d.old_text.as_deref().map_or(0, tokens),
            _ => 0,
        })
        .sum()
}

/// About 4 characters of ASCII per token, about one token per CJK (non-ASCII) character.
pub fn tokens(s: &str) -> u64 {
    let ascii = s.bytes().filter(u8::is_ascii).count() as u64;
    let other = s.chars().filter(|c| !c.is_ascii()).count() as u64;
    ascii.div_ceil(4) + other
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        Content, ContentChunk, TextContent, ToolCall, ToolCallId, ToolCallUpdateFields, ToolKind, UsageUpdate,
    };

    fn ctx(used: u64) -> ContextUsage {
        ContextUsage { used, size: 200_000, compact_at: None, block_at: None }
    }

    fn reply(text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(text))))
    }

    fn result(id: &str, text: &str) -> SessionUpdate {
        let fields = ToolCallUpdateFields::new()
            .content(vec![ToolCallContent::Content(Content::new(ContentBlock::Text(TextContent::new(text))))]);
        SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(ToolCallId::new(id), fields))
    }

    #[test]
    fn estimates_tokens_by_script() {
        assert_eq!(tokens("abcdefgh"), 2);
        assert_eq!(tokens("abcde"), 2);
        assert_eq!(tokens("上下文"), 3);
    }

    #[test]
    fn counts_turns_and_tools_by_name_and_kind() {
        let mut l = Ledger::default();
        assert!(l.snapshot(None).is_none(), "nothing without an occupancy");
        l.prompt(&"a".repeat(400), true);
        l.observe(&reply(&"b".repeat(40)));
        let mut meta = serde_json::Map::new();
        meta.insert("claudeCode".into(), serde_json::json!({ "toolName": "Bash" }));
        let call = ToolCall::new(ToolCallId::new("t1"), "`ls`")
            .kind(ToolKind::Execute)
            .raw_input(serde_json::json!({ "command": "ls" }))
            .meta(meta);
        l.observe(&SessionUpdate::ToolCall(call));
        l.observe(&result("t1", &"x".repeat(4000)));
        l.observe(&result("t1", &"x".repeat(800)));
        let mcp = ToolCall::new(ToolCallId::new("t2"), "mcp__gonggong__list_messages").kind(ToolKind::Other);
        l.observe(&SessionUpdate::ToolCall(mcp));
        l.observe(&result("t2", &"y".repeat(400)));
        l.observe(&SessionUpdate::ToolCall(ToolCall::new(ToolCallId::new("t3"), "Read a.rs").kind(ToolKind::Read)));
        l.observe(&result("t3", &"z".repeat(40)));
        l.prompt("继续", true);
        l.prompt("追加", false);
        l.context(ctx(50_000));

        let (c, b) = l.snapshot(Some(CacheUsage { read: 9, total: 10 })).unwrap();
        assert_eq!(c.used, 50_000);
        assert_eq!(b.turns, vec![110, 4]);
        assert!(!b.partial);
        assert_eq!(b.cache, Some(CacheUsage { read: 9, total: 10 }));
        let input = tokens(r#"{"command":"ls"}"#);
        assert_eq!(
            b.tools,
            vec![
                ToolTokens { name: Some("Bash".into()), kind: "execute".into(), count: 1, tokens: 200 + input },
                ToolTokens { name: Some("list_messages".into()), kind: "other".into(), count: 1, tokens: 100 },
                ToolTokens { name: None, kind: "read".into(), count: 1, tokens: 10 },
            ]
        );
    }

    #[test]
    fn forgets_what_a_shrinking_context_dropped() {
        let mut l = Ledger::default();
        l.prompt("hello", true);
        l.observe(&SessionUpdate::UsageUpdate(UsageUpdate::new(30_000, 200_000)));
        l.context(ctx(30_000));
        l.observe(&SessionUpdate::UsageUpdate(UsageUpdate::new(40_000, 200_000)));
        l.context(ctx(40_000));
        assert!(!l.snapshot(None).unwrap().1.partial);
        l.observe(&SessionUpdate::UsageUpdate(UsageUpdate::new(3_000, 200_000)));
        l.context(ctx(3_000));
        let (_, b) = l.snapshot(None).unwrap();
        assert!(b.partial && b.turns.is_empty() && b.tools.is_empty());
        assert!(Ledger::resumed().partial);
    }
}
