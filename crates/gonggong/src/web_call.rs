//! Web searches and page fetches in ACP updates. Claude reports WebSearch / WebFetch as kind `fetch` with
//! `{ query }` / `{ url, prompt }` in and a search's hits as `Title (url)` lines out; Codex reports its web search
//! items as kind `search` with `rawInput.type` `webSearch` and `{ query, action }`, and no hits.
use agent_client_protocol::schema::v1::{ContentBlock, ToolCallContent, ToolKind};
use serde_json::Value;

use crate::protocol::WebHit;

const QUERY_MAX: usize = 300;
const TITLE_MAX: usize = 200;
const URL_MAX: usize = 2000;
const HITS_MAX: usize = 20;

pub fn is_web(kind: Option<&ToolKind>, raw: Option<&Value>) -> bool {
    matches!(kind, Some(ToolKind::Fetch)) || raw.and_then(|r| r.get("type")?.as_str()) == Some("webSearch")
}

/// Codex keeps the query of a search action in the action itself.
pub fn query(raw: &Value) -> Option<String> {
    let action = raw.get("action");
    let joined = action
        .and_then(|a| a.get("queries")?.as_array())
        .map(|qs| qs.iter().filter_map(Value::as_str).filter(|q| !q.is_empty()).collect::<Vec<_>>().join(", "));
    [action.and_then(|a| a.get("query")?.as_str()).map(String::from), joined, str_of(raw, "query")]
        .into_iter()
        .flatten()
        .find(|q| !q.trim().is_empty())
        .map(|q| q.trim().chars().take(QUERY_MAX).collect())
}

pub fn url(raw: &Value) -> Option<String> {
    str_of(raw, "url").or_else(|| raw.get("action").and_then(|a| str_of(a, "url"))).filter(|u| is_url(u))
}

/// A search's hits, one `Title (url)` per line or content block; duplicates and other text left out.
pub fn hits(content: &[ToolCallContent]) -> Vec<WebHit> {
    let mut out: Vec<WebHit> = Vec::new();
    let lines = content.iter().filter_map(|c| match c {
        ToolCallContent::Content(c) => match &c.content {
            ContentBlock::Text(t) => Some(t.text.as_str()),
            _ => None,
        },
        _ => None,
    });
    for line in lines.flat_map(str::lines) {
        let Some((title, url)) = line.trim().strip_suffix(')').and_then(|l| l.rsplit_once(" (")) else { continue };
        let title = title.trim();
        if !is_url(url) || title.is_empty() || out.iter().any(|h| h.url == url) {
            continue;
        }
        out.push(WebHit { title: title.chars().take(TITLE_MAX).collect(), url: url.to_string() });
        if out.len() == HITS_MAX {
            break;
        }
    }
    out
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn is_url(s: &str) -> bool {
    (s.starts_with("https://") || s.starts_with("http://")) && s.len() <= URL_MAX && !s.contains(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::TextContent;
    use serde_json::json;

    fn text(s: &str) -> ToolCallContent {
        ToolCallContent::from(ContentBlock::Text(TextContent::new(s)))
    }

    #[test]
    fn claude_fetches_and_codex_web_search_items_are_web_calls() {
        assert!(is_web(Some(&ToolKind::Fetch), None));
        assert!(is_web(Some(&ToolKind::Search), Some(&json!({ "type": "webSearch", "query": "x" }))));
        assert!(!is_web(Some(&ToolKind::Search), Some(&json!({ "pattern": "x" }))));
        assert!(!is_web(None, None));
    }

    #[test]
    fn query_and_url_of_claude_and_codex_inputs() {
        assert_eq!(query(&json!({ "query": " fastify 5 " })).as_deref(), Some("fastify 5"));
        let codex =
            json!({ "type": "webSearch", "query": "", "action": { "type": "search", "queries": ["a", "", "b"] } });
        assert_eq!(query(&codex).as_deref(), Some("a, b"));
        let codex = json!({ "type": "webSearch", "query": "q", "action": { "type": "search", "query": "q2" } });
        assert_eq!(query(&codex).as_deref(), Some("q2"));
        assert_eq!(query(&json!({ "url": "https://a.dev" })), None);

        assert_eq!(url(&json!({ "url": "https://a.dev/x", "prompt": "p" })).as_deref(), Some("https://a.dev/x"));
        let open = json!({ "type": "webSearch", "action": { "type": "openPage", "url": "https://b.dev" } });
        assert_eq!(url(&open).as_deref(), Some("https://b.dev"));
        assert_eq!(url(&json!({ "url": "file:///etc/passwd" })), None);
    }

    #[test]
    fn hits_are_title_url_lines_deduplicated() {
        let content = vec![
            text("Migration Guide V5 | Fastify (https://fastify.dev/v5)\nRelease (v5) (https://github.com/f/r)"),
            text("Migration Guide V5 | Fastify (https://fastify.dev/v5)"),
            text("Some summary (not a link)\n (https://no-title.dev)"),
        ];
        assert_eq!(
            hits(&content),
            vec![
                WebHit { title: "Migration Guide V5 | Fastify".into(), url: "https://fastify.dev/v5".into() },
                WebHit { title: "Release (v5)".into(), url: "https://github.com/f/r".into() },
            ]
        );
        let many: String = (0..30).map(|i| format!("t{i} (https://x.dev/{i})\n")).collect();
        assert_eq!(hits(&[text(&many)]).len(), HITS_MAX);
    }
}
