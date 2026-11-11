//! pi runs through the pinned pi-acp adapter, which starts `pi --mode rpc` itself (`PI_ACP_PI_COMMAND`): a wrapper
//! adds gonggong's extension (`pi_extension.ts`) and trusts the project, as the other agents do, so the team skills
//! linked into `.agents/skills` load. The extension takes the run's MCP servers and the bot's instructions from the
//! env and turns each tool call into a permission request ([`own_request`]).
use crate::protocol::McpServer;
use agent_client_protocol::schema::v1 as acp;
use anyhow::Result;
use serde_json::{Map, Value, json};
use std::path::{Path, PathBuf};

const EXTENSION: &str = include_str!("pi_extension.ts");
/// pi gives an MCP call a minute by default; 「向群成员提问」 waits for a person up to the group's timeout (a day).
const MCP_TIMEOUT_SECS: u64 = 90_000;

#[cfg(unix)]
const WRAPPER: (&str, &str) = (
    "pi-gonggong",
    "#!/bin/sh\nif [ -n \"$GG_PI_SCRIPT\" ]; then\n  exec \"$GG_PI_EXE\" \"$GG_PI_SCRIPT\" --approve -e \"$GG_PI_EXTENSION\" \"$@\"\nfi\nexec \"$GG_PI_EXE\" --approve -e \"$GG_PI_EXTENSION\" \"$@\"\n",
);
#[cfg(windows)]
const WRAPPER: (&str, &str) = (
    "pi-gonggong.cmd",
    "@echo off\r\nif defined GG_PI_SCRIPT (\r\n  \"%GG_PI_EXE%\" \"%GG_PI_SCRIPT%\" --approve -e \"%GG_PI_EXTENSION%\" %*\r\n) else (\r\n  \"%GG_PI_EXE%\" --approve -e \"%GG_PI_EXTENSION%\" %*\r\n)\r\n",
);

/// The extension and the wrapper pi-acp runs as `pi`, (re)written under `home` when they differ from this build's.
pub struct Files {
    pub extension: PathBuf,
    pub wrapper: PathBuf,
}

pub fn files(home: &Path) -> Result<Files> {
    let dir = home.join("pi");
    let extension = dir.join("gonggong.ts");
    let wrapper = dir.join(WRAPPER.0);
    write_if_changed(&extension, EXTENSION)?;
    write_if_changed(&wrapper, WRAPPER.1)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(Files { extension, wrapper })
}

fn write_if_changed(path: &Path, content: &str) -> Result<()> {
    if std::fs::read_to_string(path).ok().as_deref() != Some(content) {
        std::fs::create_dir_all(path.parent().expect("has a parent"))?;
        std::fs::write(path, content)?;
    }
    Ok(())
}

/// `GG_PI_MCP`: the run's MCP servers and the built-in gonggong one as `pi.registerMcpServer` configs, by name.
pub fn mcp_env(servers: &[McpServer], ask: &acp::McpServer) -> String {
    let mut out = Map::new();
    for s in servers {
        let (name, config) = match s {
            McpServer::Stdio { name, command, args, env } => {
                (name, json!({ "command": command, "args": args, "env": env }))
            }
            McpServer::Http { name, url, headers } => (name, json!({ "url": url, "headers": headers })),
        };
        out.insert(name.clone(), config);
    }
    if let acp::McpServer::Http(http) = ask {
        let headers: Map<String, Value> =
            http.headers.iter().map(|h| (h.name.clone(), h.value.clone().into())).collect();
        out.insert(http.name.clone(), json!({ "url": http.url, "headers": headers }));
    }
    for config in out.values_mut() {
        let config = config.as_object_mut().expect("built as objects");
        // Declared to the model as they are, not behind tool search or code mode.
        config.insert("exposure".into(), "direct".into());
        config.insert("timeout".into(), MCP_TIMEOUT_SECS.into());
    }
    Value::Object(out).to_string()
}

/// A permission request the extension made through pi-acp (an extension `confirm`, kind `other`), made over into
/// one for the tool call it is about: its id, so the run card's tool is the one asked about, and its input, which
/// the owner's rules read (a command, the paths written). Other requests are left as they are.
pub fn own_request(call: &mut acp::ToolCallUpdate) {
    let raw = call.fields.raw_input.as_ref();
    if raw.and_then(|r| r["method"].as_str()) != Some("confirm") {
        return;
    }
    let Some(request) = raw
        .and_then(|r| r["message"].as_str())
        .and_then(|m| serde_json::from_str::<Value>(m).ok())
        .and_then(|mut v| v.get_mut("gonggong").map(Value::take))
    else {
        return;
    };
    let Some(id) = request["toolCallId"].as_str() else { return };
    call.tool_call_id = acp::ToolCallId::new(id);
    call.fields.title = request["title"].as_str().map(String::from);
    call.fields.kind = None;
    call.fields.raw_input = Some(request["input"].clone());
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp, ToolCallUpdateFields, ToolKind};
    use std::collections::BTreeMap;

    fn confirm(message: &str) -> acp::ToolCallUpdate {
        let raw = json!({ "method": "confirm", "title": "bash", "message": message });
        acp::ToolCallUpdate::new(
            "pi-ui-7",
            ToolCallUpdateFields::new().title("bash").kind(ToolKind::Other).raw_input(raw),
        )
    }

    #[test]
    fn makes_the_extensions_confirm_a_request_for_its_tool_call() {
        let message = json!({ "gonggong": { "toolCallId": "call_1", "input": { "command": "rm -rf build" } } });
        let mut call = confirm(&message.to_string());
        own_request(&mut call);
        assert_eq!(call.tool_call_id.0.as_ref(), "call_1");
        assert_eq!(call.fields.title, None, "the tool keeps the title pi-acp gave it");
        assert_eq!(call.fields.kind, None);
        assert_eq!(call.fields.raw_input, Some(json!({ "command": "rm -rf build" })));

        let message =
            json!({ "gonggong": { "toolCallId": "c2", "title": "mcp__gonggong__list_messages", "input": {} } });
        let mut call = confirm(&message.to_string());
        own_request(&mut call);
        assert_eq!(call.fields.title.as_deref(), Some("mcp__gonggong__list_messages"));
    }

    #[test]
    fn leaves_other_requests_alone() {
        let mut call = confirm("Allow rm -rf?");
        own_request(&mut call);
        assert_eq!(call.tool_call_id.0.as_ref(), "pi-ui-7");
        assert_eq!(call.fields.title.as_deref(), Some("bash"));
    }

    #[test]
    fn hands_the_runs_mcp_servers_and_gonggongs_to_the_extension() {
        let servers = vec![
            McpServer::Stdio {
                name: "fs".into(),
                command: "npx".into(),
                args: vec!["-y".into(), "fs-mcp".into()],
                env: BTreeMap::from([("K".into(), "v".into())]),
            },
            McpServer::Http {
                name: "docs".into(),
                url: "https://docs.example.com/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), "Bearer t".into())]),
            },
        ];
        let ask = acp::McpServer::Http(
            McpServerHttp::new("gonggong", "http://127.0.0.1:1/s").headers(vec![HttpHeader::new("x-k", "v")]),
        );
        let env: Value = serde_json::from_str(&mcp_env(&servers, &ask)).unwrap();
        assert_eq!(env["fs"]["command"], "npx");
        assert_eq!(env["fs"]["env"]["K"], "v");
        assert_eq!(env["docs"]["headers"]["Authorization"], "Bearer t");
        assert_eq!(env["gonggong"]["url"], "http://127.0.0.1:1/s");
        assert_eq!(env["gonggong"]["headers"]["x-k"], "v");
        assert_eq!(env["gonggong"]["exposure"], "direct");
        assert_eq!(env["gonggong"]["timeout"], MCP_TIMEOUT_SECS);
    }

    #[cfg(unix)]
    #[test]
    fn the_wrapper_runs_pi_with_the_extension_and_the_adapters_arguments() {
        let home = tempfile::tempdir().unwrap();
        let f = files(home.path()).unwrap();
        let out = std::process::Command::new(&f.wrapper)
            .args(["--mode", "rpc"])
            .env("GG_PI_EXE", "/bin/echo")
            .env("GG_PI_SCRIPT", "cli.js")
            .env("GG_PI_EXTENSION", &f.extension)
            .output()
            .unwrap();
        let expected = format!("cli.js --approve -e {} --mode rpc\n", f.extension.display());
        assert_eq!(String::from_utf8_lossy(&out.stdout), expected);
        let out = std::process::Command::new(&f.wrapper)
            .arg("--version")
            .env("GG_PI_EXE", "/bin/echo")
            .env_remove("GG_PI_SCRIPT")
            .env("GG_PI_EXTENSION", "x.ts")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout), "--approve -e x.ts --version\n");
    }
}
