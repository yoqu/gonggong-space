//! Gemini CLI runs (docs/plan/Gemini-CLI接入-开发计划.md). Its ACP mode is built in (`gemini --acp`, no adapter) and
//! takes no per-session instructions, so each (group, bot) runs with a `GEMINI_CLI_HOME` of its own: the user's
//! settings with the login the run's provider needs and the built-in gonggong server, the bot's instructions as the
//! global `GEMINI.md` before the user's own, and links to the user's logins, extensions and skills. Its sessions are
//! stored there too, so a later process of the same (group, bot) resumes them.
use crate::ask;
use crate::providers::Selection;
use agent_client_protocol::schema::v1 as acp;
use anyhow::{Context, Result};
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

/// The home throwaway sessions (model probe, fork) run in.
pub const PROBE: &str = "probe";
/// What the user's `~/.gemini` shares with every bot: logins, MCP OAuth tokens, extensions, skills, commands, policies.
const SHARED: [&str; 10] = [
    ".env",
    "oauth_creds.json",
    "google_accounts.json",
    "installation_id",
    "mcp-oauth-tokens-v2.json",
    "mcp-oauth-tokens.json",
    "extensions",
    "skills",
    "commands",
    "policies",
];
/// Gemini CLI's default `context.fileName`.
const MEMORY: &str = "GEMINI.md";
/// Gemini CLI gives an MCP call ten minutes; 「向群成员提问」 waits for a person up to the group's timeout (a day).
const ASK_TIMEOUT_MS: u64 = 90_000_000;

/// `GEMINI_CLI_HOME` of the (group, bot) conversation `key`, or [`PROBE`].
pub fn home_dir(home: &Path, key: &str) -> PathBuf {
    home.join("gemini").join(key)
}

/// Brings `dir` (a `GEMINI_CLI_HOME`) in line with the run: read by Gemini CLI on every new or loaded session.
/// `ask`: the conversation's built-in gonggong server, which the ACP session then leaves out.
pub fn prepare(
    dir: &Path,
    user_home: &Path,
    selection: &Selection,
    instructions: &str,
    ask: Option<&acp::McpServer>,
) -> Result<()> {
    let own = user_home.join(".gemini");
    let ours = dir.join(".gemini");
    std::fs::create_dir_all(&ours).with_context(|| format!("create {}", ours.display()))?;
    let mut settings = user_settings(&own.join("settings.json"));
    if let Selection::Provider(_) = selection {
        // The key and endpoint come with the process env (`GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`).
        entry(entry(&mut settings, "security"), "auth").insert("selectedType".into(), "gemini-api-key".into());
    }
    if let Some(acp::McpServer::Http(server)) = ask {
        let headers: Map<String, Value> =
            server.headers.iter().map(|h| (h.name.clone(), h.value.clone().into())).collect();
        let gonggong = json!({ "httpUrl": server.url, "headers": headers, "timeout": ASK_TIMEOUT_MS });
        entry(&mut settings, "mcpServers").insert(ask::SERVER_NAME.into(), gonggong);
    }
    let names = memory_names(&settings);
    write_private(&ours.join("settings.json"), &serde_json::to_vec_pretty(&settings)?)?;
    // Everything in one file: the bot's instructions first, then the user's global ones under whatever names.
    let user: Vec<String> = names
        .iter()
        .filter_map(|n| std::fs::read_to_string(own.join(n)).ok())
        .filter(|t| !t.trim().is_empty())
        .collect();
    let memory = [instructions.to_string()].into_iter().chain(user).collect::<Vec<_>>().join("\n\n");
    std::fs::write(ours.join(&names[0]), memory)?;
    for name in &names[1..] {
        let _ = std::fs::remove_file(ours.join(name));
    }
    for name in SHARED {
        share(&own.join(name), &ours.join(name));
    }
    // User-level agent skills (`~/.agents/skills`).
    share(&user_home.join(".agents"), &dir.join(".agents"));
    Ok(())
}

/// The user's `settings.json` (JSON with comments), or an empty object.
fn user_settings(path: &Path) -> Map<String, Value> {
    let Ok(text) = std::fs::read_to_string(path) else { return Map::new() };
    match serde_json::from_str::<Value>(&strip_comments(&text)) {
        Ok(Value::Object(map)) => map,
        _ => {
            tracing::warn!("{} is not a JSON object: Gemini runs without the user's settings", path.display());
            Map::new()
        }
    }
}

/// The object at `key`, made one if it is anything else.
fn entry<'a>(map: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let slot = map.entry(key).or_insert_with(|| json!({}));
    if !slot.is_object() {
        *slot = json!({});
    }
    slot.as_object_mut().expect("just made an object")
}

/// `context.fileName`: a name or a list of them.
fn memory_names(settings: &Map<String, Value>) -> Vec<String> {
    let names: Vec<String> = match settings.get("context").map(|c| &c["fileName"]) {
        Some(Value::String(n)) => vec![n.clone()],
        Some(Value::Array(list)) => list.iter().filter_map(|n| n.as_str().map(String::from)).collect(),
        _ => vec![],
    };
    let names: Vec<String> = names.into_iter().filter(|n| !n.trim().is_empty() && !n.contains(['/', '\\'])).collect();
    if names.is_empty() { vec![MEMORY.into()] } else { names }
}

/// Holds the gonggong server's secret URL.
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Links `at` to the user's `target` (a copy of a file on Windows). Once the user's is gone the link goes too, while
/// what Gemini made there itself (its installation id, a login made through it) stays.
fn share(target: &Path, at: &Path) {
    let current = at.symlink_metadata().ok();
    if !target.exists() {
        if current.is_some_and(|m| m.file_type().is_symlink()) {
            let _ = std::fs::remove_file(at);
        }
        return;
    }
    #[cfg(unix)]
    if std::fs::read_link(at).is_ok_and(|t| t == target) {
        return;
    }
    let removed = match current {
        Some(m) if m.is_dir() => std::fs::remove_dir_all(at),
        Some(_) => std::fs::remove_file(at),
        None => Ok(()),
    };
    if let Err(e) = removed {
        return tracing::warn!("removing {} failed: {e}", at.display());
    }
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(target, at);
    #[cfg(windows)]
    let linked = if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, at)
    } else {
        std::fs::copy(target, at).map(drop)
    };
    if let Err(e) = linked {
        tracing::warn!("sharing {} with Gemini failed: {e}", target.display());
    }
}

/// JSON with `//` and `/* */` comments (as Gemini CLI reads its settings) made plain JSON.
pub(crate) fn strip_comments(text: &str) -> String {
    let (mut out, mut chars) = (String::with_capacity(text.len()), text.chars().peekable());
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => out.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => while chars.next_if(|&n| n != '\n').is_some() {},
            ('/', Some('*')) => {
                chars.next();
                let mut last = ' ';
                for n in chars.by_ref() {
                    if last == '*' && n == '/' {
                        break;
                    }
                    last = n;
                }
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AgentKind;
    use crate::providers::{Official, Provider};
    use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp};

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn provider() -> Selection {
        let p = Provider::custom(AgentKind::Gemini, "OR".into(), "https://openrouter.ai/api".into(), "k".into());
        Selection::Provider(Box::new(p))
    }

    #[test]
    fn keeps_the_users_settings_and_adds_the_providers_login_and_the_gonggong_server() {
        let (user, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let own = user.path().join(".gemini");
        std::fs::create_dir_all(&own).unwrap();
        let settings = r#"{
          // the user's own
          "security": { "auth": { "selectedType": "oauth-personal" } },
          "mcpServers": { "magpie": { "command": "magpie", "args": ["--url=http://x/*y*/"] } }
        }"#;
        std::fs::write(own.join("settings.json"), settings).unwrap();
        let ask = acp::McpServer::Http(
            McpServerHttp::new(ask::SERVER_NAME, "http://127.0.0.1:1/s").headers(vec![HttpHeader::new("x-k", "v")]),
        );

        prepare(dir.path(), user.path(), &provider(), "be bot X", Some(&ask)).unwrap();
        let written = read(&dir.path().join(".gemini/settings.json"));
        assert_eq!(written["security"]["auth"]["selectedType"], "gemini-api-key");
        assert_eq!(
            written["mcpServers"]["magpie"]["args"][0], "--url=http://x/*y*/",
            "strings keep what looks like comments"
        );
        let gonggong = &written["mcpServers"][ask::SERVER_NAME];
        assert_eq!(
            (gonggong["httpUrl"].as_str(), gonggong["headers"]["x-k"].as_str()),
            (Some("http://127.0.0.1:1/s"), Some("v"))
        );
        assert_eq!(gonggong["timeout"], ASK_TIMEOUT_MS);

        prepare(dir.path(), user.path(), &Selection::Official(Official::default()), "be bot X", None).unwrap();
        let official = read(&dir.path().join(".gemini/settings.json"));
        assert_eq!(official["security"]["auth"]["selectedType"], "oauth-personal", "the user's own login");
        assert!(official["mcpServers"].get(ask::SERVER_NAME).is_none());
    }

    #[test]
    fn puts_the_instructions_before_the_users_global_memory_under_its_file_name() {
        let (user, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let own = user.path().join(".gemini");
        std::fs::create_dir_all(&own).unwrap();
        prepare(dir.path(), user.path(), &provider(), "be bot X", None).unwrap();
        assert_eq!(std::fs::read_to_string(dir.path().join(".gemini/GEMINI.md")).unwrap(), "be bot X");

        std::fs::write(own.join("settings.json"), r#"{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}"#).unwrap();
        std::fs::write(own.join("AGENTS.md"), "user agents").unwrap();
        std::fs::write(own.join("GEMINI.md"), "user gemini").unwrap();
        prepare(dir.path(), user.path(), &provider(), "be bot X", None).unwrap();
        let ours = dir.path().join(".gemini");
        assert_eq!(std::fs::read_to_string(ours.join("AGENTS.md")).unwrap(), "be bot X\n\nuser agents\n\nuser gemini");
        assert!(!ours.join("GEMINI.md").exists(), "read once, not twice");
    }

    #[cfg(unix)]
    #[test]
    fn shares_the_users_logins_and_skills_and_drops_them_once_gone() {
        let (user, dir) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let own = user.path().join(".gemini");
        std::fs::create_dir_all(own.join("skills/s")).unwrap();
        std::fs::write(own.join(".env"), "GEMINI_API_KEY=k").unwrap();
        std::fs::create_dir_all(user.path().join(".agents/skills")).unwrap();
        prepare(dir.path(), user.path(), &provider(), "", None).unwrap();
        let ours = dir.path().join(".gemini");
        assert_eq!(std::fs::read_link(ours.join(".env")).unwrap(), own.join(".env"));
        assert!(ours.join("skills/s").is_dir());
        assert!(dir.path().join(".agents/skills").is_dir());

        std::fs::remove_file(own.join(".env")).unwrap();
        std::fs::write(ours.join("installation_id"), "gemini's own").unwrap();
        prepare(dir.path(), user.path(), &provider(), "", None).unwrap();
        assert!(ours.join(".env").symlink_metadata().is_err());
        assert!(ours.join("installation_id").is_file(), "what Gemini made itself stays");
    }

    #[test]
    fn strips_comments_outside_strings() {
        let text = "{\"a\": \"//x\", // c\n \"b\": /* d */ 1, \"e\": \"q\\\"//\"}";
        let v: Value = serde_json::from_str(&strip_comments(text)).unwrap();
        assert_eq!(v, json!({ "a": "//x", "b": 1, "e": "q\"//" }));
    }
}
