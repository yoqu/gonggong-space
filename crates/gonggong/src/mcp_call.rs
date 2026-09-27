//! MCP tool calls in ACP updates: Claude titles them `mcp__<server>__<tool>` and reports the result as content;
//! Codex titles them `mcp.<server>.<tool>` with `{ server, tool, arguments }` in and `{ result, error }` out.
use agent_client_protocol::schema::v1::{ContentBlock, ToolCallContent};
use serde_json::Value;

const INPUT_MAX: usize = 600;
const OUTPUT_MAX: usize = 2000;

/// Server and tool of an MCP call's title.
pub fn name(title: &str) -> Option<(String, String)> {
    let (server, tool) = if let Some(rest) = title.strip_prefix("mcp__") {
        rest.split_once("__")?
    } else {
        title.strip_prefix("mcp.")?.split_once('.')?
    };
    (!server.is_empty() && !tool.is_empty()).then(|| (server.to_string(), tool.to_string()))
}

/// The call's arguments as compact JSON; Codex wraps them with the server and tool names.
pub fn input(raw: &Value) -> Option<String> {
    let args = match raw.get("arguments") {
        Some(a) if raw.get("server").is_some() && raw.get("tool").is_some() => a,
        _ => raw,
    };
    let empty = args.is_null() || args.as_object().is_some_and(|o| o.is_empty());
    (!empty).then(|| head(&args.to_string(), INPUT_MAX))
}

/// Head of the result text: the call's content (Claude), else Codex's `rawOutput`.
pub fn output(content: &[ToolCallContent], raw: Option<&Value>) -> Option<String> {
    let mut text: Vec<String> = content
        .iter()
        .filter_map(|c| match c {
            ToolCallContent::Content(c) => match &c.content {
                ContentBlock::Text(t) => Some(t.text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect();
    if text.is_empty()
        && let Some(raw) = raw
    {
        text = codex_output(raw);
    }
    let text = text.join("\n");
    let text = text.trim();
    (!text.is_empty()).then(|| head(text, OUTPUT_MAX))
}

fn codex_output(raw: &Value) -> Vec<String> {
    if let Some(e) = raw.get("error").filter(|e| !e.is_null()) {
        return vec![e.get("message").and_then(Value::as_str).map_or_else(|| e.to_string(), String::from)];
    }
    let blocks = raw.pointer("/result/content").and_then(Value::as_array);
    blocks.into_iter().flatten().filter_map(|b| b.get("text")?.as_str().map(String::from)).collect()
}

fn head(s: &str, max: usize) -> String {
    if s.chars().count() <= max { s.to_string() } else { format!("{}…", s.chars().take(max - 1).collect::<String>()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::TextContent;
    use serde_json::json;

    #[test]
    fn names_claude_and_codex_titles() {
        assert_eq!(name("mcp__gonggong__list_messages"), Some(("gonggong".into(), "list_messages".into())));
        assert_eq!(name("mcp__claude_ai_Figma__get_metadata"), Some(("claude_ai_Figma".into(), "get_metadata".into())));
        assert_eq!(name("mcp.gonggong.search_messages"), Some(("gonggong".into(), "search_messages".into())));
        assert_eq!(name("Read a.rs"), None);
        assert_eq!(name("mcp__gonggong"), None);
    }

    #[test]
    fn input_is_compact_json_without_codex_wrapping() {
        assert_eq!(input(&json!({ "limit": 20 })).as_deref(), Some(r#"{"limit":20}"#));
        let codex = json!({ "server": "gonggong", "tool": "search_messages", "arguments": { "query": "登录" } });
        assert_eq!(input(&codex).as_deref(), Some(r#"{"query":"登录"}"#));
        assert_eq!(input(&json!({})), None);
        assert_eq!(input(&Value::Null), None);
        let long = input(&json!({ "q": "x".repeat(1000) })).unwrap();
        assert_eq!((long.chars().count(), long.ends_with('…')), (INPUT_MAX, true));
    }

    #[test]
    fn output_is_the_content_text_else_codex_raw_output() {
        let content = vec![ToolCallContent::from(ContentBlock::Text(TextContent::new("#1 王磊: hi\n")))];
        assert_eq!(output(&content, None).as_deref(), Some("#1 王磊: hi"));
        let ok = json!({ "result": { "content": [{ "type": "text", "text": "无结果" }] }, "error": null });
        assert_eq!(output(&[], Some(&ok)).as_deref(), Some("无结果"));
        let err = json!({ "result": null, "error": { "message": "unknown tool" } });
        assert_eq!(output(&[], Some(&err)).as_deref(), Some("unknown tool"));
        assert_eq!(output(&[], None), None);
    }
}
