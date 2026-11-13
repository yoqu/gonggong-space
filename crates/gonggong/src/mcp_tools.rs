//! What the run's MCP tools say about themselves (`tools/list`: title, description, annotations), shown on approval
//! cards as the tool declares it. Listed once per server config in the background when a run starts; a request asked
//! before the list arrives (or of a server that failed to list) goes without.
use crate::protocol::{McpServer, McpToolInfo};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};

type Tools = HashMap<String, McpToolInfo>;

const TIMEOUT: Duration = Duration::from_secs(30);
const PAGES_MAX: usize = 20;
const PROTOCOL_VERSION: &str = "2025-06-18";

/// By server config; `None` while being listed.
static CACHE: LazyLock<Mutex<HashMap<String, Option<Arc<Tools>>>>> = LazyLock::new(Default::default);

fn key(s: &McpServer) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

fn name(s: &McpServer) -> &str {
    match s {
        McpServer::Stdio { name, .. } | McpServer::Http { name, .. } => name,
    }
}

/// Lists the tools of each server not listed yet, in the background; a failure is retried on the next run. Stdio
/// servers start in `cwd`, like the agent starts them.
pub fn prefetch(servers: &[McpServer], cwd: &Path) {
    for s in servers {
        let k = key(s);
        {
            let mut cache = CACHE.lock().unwrap();
            if cache.contains_key(&k) {
                continue;
            }
            cache.insert(k.clone(), None);
        }
        let (s, cwd) = (s.clone(), cwd.to_path_buf());
        tokio::spawn(async move {
            let listed = tokio::time::timeout(TIMEOUT, list(&s, &cwd))
                .await
                .unwrap_or_else(|_| Err(anyhow::anyhow!("timed out")));
            let mut cache = CACHE.lock().unwrap();
            match listed {
                Ok(tools) => {
                    cache.insert(k, Some(Arc::new(tools)));
                }
                Err(e) => {
                    tracing::info!("listing the tools of MCP server {} failed: {e:#}", name(&s));
                    cache.remove(&k);
                }
            }
        });
    }
}

/// What `tool` of the run's server named `server` declares, once listed.
pub fn lookup(servers: &[McpServer], server: &str, tool: &str) -> Option<McpToolInfo> {
    let s = servers.iter().find(|s| name(s) == server)?;
    CACHE.lock().unwrap().get(&key(s))?.as_ref()?.get(tool).cloned()
}

pub async fn list(s: &McpServer, cwd: &Path) -> Result<Tools> {
    let mut conn = match s {
        McpServer::Stdio { command, args, env, .. } => Conn::stdio(command, args, env, cwd)?,
        McpServer::Http { url, headers, .. } => {
            Conn::Http { url: url.clone(), headers: headers.clone(), session: None }
        }
    };
    let init = json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": { "name": "gonggong", "version": env!("CARGO_PKG_VERSION") },
    });
    conn.call(0, "initialize", init).await?;
    conn.notify("notifications/initialized").await?;
    let mut tools = Tools::new();
    let mut cursor: Option<String> = None;
    for page in 1..=PAGES_MAX {
        let params = cursor.as_ref().map_or(json!({}), |c| json!({ "cursor": c }));
        let res = conn.call(page as u64, "tools/list", params).await?;
        for t in res["tools"].as_array().into_iter().flatten() {
            let Some(name) = t["name"].as_str() else { continue };
            let annotations = t.get("annotations").and_then(|a| serde_json::from_value(a.clone()).ok());
            let text = |v: &Value| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
            // The spec's display name is `title`; older servers put it in `annotations.title`.
            let title = text(&t["title"]).or_else(|| text(&t["annotations"]["title"]));
            tools.insert(name.into(), McpToolInfo { title, description: text(&t["description"]), annotations });
        }
        cursor = res["nextCursor"].as_str().map(String::from);
        if cursor.is_none() {
            break;
        }
    }
    Ok(tools)
}

// One short-lived value per listing: boxing would buy nothing.
#[allow(clippy::large_enum_variant)]
enum Conn {
    Stdio { _child: Child, stdin: ChildStdin, lines: Lines<BufReader<ChildStdout>> },
    Http { url: String, headers: BTreeMap<String, String>, session: Option<String> },
}

impl Conn {
    fn stdio(command: &str, args: &[String], env: &BTreeMap<String, String>, cwd: &Path) -> Result<Self> {
        use std::process::Stdio;
        let mut child = crate::proc::async_command(command)
            .args(args)
            .envs(env)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("spawning {command}"))?;
        let stdin = child.stdin.take().context("no stdin")?;
        let lines = BufReader::new(child.stdout.take().context("no stdout")?).lines();
        Ok(Conn::Stdio { _child: child, stdin, lines })
    }

    async fn notify(&mut self, method: &str) -> Result<()> {
        let msg = json!({ "jsonrpc": "2.0", "method": method });
        match self {
            Conn::Stdio { stdin, .. } => write_line(stdin, &msg).await,
            Conn::Http { .. } => self.post(&msg).await.map(drop),
        }
    }

    async fn call(&mut self, id: u64, method: &str, params: Value) -> Result<Value> {
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let reply = match self {
            Conn::Stdio { stdin, lines, .. } => {
                write_line(stdin, &msg).await?;
                loop {
                    let line = lines.next_line().await?.context("the server exited")?;
                    if let Ok(v) = serde_json::from_str::<Value>(&line)
                        && v["id"] == id
                    {
                        break v;
                    }
                }
            }
            Conn::Http { .. } => {
                let body = self.post(&msg).await?;
                sse_or_json(&body).into_iter().find(|v| v["id"] == id).context("no response")?
            }
        };
        if let Some(e) = reply.get("error") {
            bail!("{method}: {e}");
        }
        Ok(reply["result"].clone())
    }

    async fn post(&mut self, msg: &Value) -> Result<String> {
        let Conn::Http { url, headers, session } = self else { unreachable!() };
        let mut req = http()?
            .post(url.as_str())
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION)
            .json(msg);
        for (k, v) in headers.iter() {
            req = req.header(k, v);
        }
        if let Some(s) = session {
            req = req.header("Mcp-Session-Id", s.as_str());
        }
        let res = req.send().await?.error_for_status()?;
        if let Some(s) = res.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *session = Some(s.into());
        }
        Ok(res.text().await?)
    }
}

async fn write_line(stdin: &mut ChildStdin, msg: &Value) -> Result<()> {
    stdin.write_all(format!("{msg}\n").as_bytes()).await?;
    Ok(stdin.flush().await?)
}

/// The JSON-RPC messages of a Streamable HTTP response: a plain JSON body or an SSE stream's `data:` events.
fn sse_or_json(body: &str) -> Vec<Value> {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        return if let Value::Array(a) = v { a } else { vec![v] };
    }
    body.replace("\r\n", "\n")
        .split("\n\n")
        .filter_map(|event| {
            let data: Vec<&str> = event.lines().filter_map(|l| l.strip_prefix("data:")).map(str::trim_start).collect();
            serde_json::from_str(&data.join("\n")).ok()
        })
        .collect()
}

fn http() -> Result<reqwest::Client> {
    static HTTP: LazyLock<Result<reqwest::Client, String>> = LazyLock::new(|| {
        let builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(10));
        builder.read_timeout(Duration::from_secs(20)).build().map_err(|e| format!("{e:#}"))
    });
    HTTP.clone().map_err(anyhow::Error::msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::McpToolAnnotations;

    const TOOLS: &str = r#"[
        {"name":"get_item","description":"Read an item.","annotations":{"readOnlyHint":true}},
        {"name":"delete_item","title":"Delete item","description":"  ","annotations":{"readOnlyHint":false,"destructiveHint":true}},
        {"name":"plain","inputSchema":{}}
    ]"#;

    fn expect(tools: &Tools) {
        let get = &tools["get_item"];
        assert_eq!(get.description.as_deref(), Some("Read an item."));
        assert_eq!(get.annotations.as_ref().and_then(|a| a.read_only_hint), Some(true));
        let delete = &tools["delete_item"];
        assert_eq!((delete.title.as_deref(), delete.description.as_deref()), (Some("Delete item"), None));
        let declared =
            McpToolAnnotations { read_only_hint: Some(false), destructive_hint: Some(true), ..Default::default() };
        assert_eq!(delete.annotations.as_ref(), Some(&declared));
        assert_eq!(tools["plain"], McpToolInfo::default());
    }

    #[tokio::test]
    async fn lists_a_stdio_servers_tools_across_pages() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("server.js");
        // A log line and a server notification come before the answers; the second page holds the last tool.
        let js = format!(
            r#"const tools = {TOOLS};
            require('readline').createInterface({{ input: process.stdin }}).on('line', (line) => {{
              const m = JSON.parse(line)
              if (m.id === undefined) return
              const send = (result) => console.log(JSON.stringify({{ jsonrpc: '2.0', id: m.id, result }}))
              console.log('starting')
              console.log(JSON.stringify({{ jsonrpc: '2.0', method: 'notifications/message', params: {{}} }}))
              if (m.method === 'initialize') send({{ protocolVersion: m.params.protocolVersion, capabilities: {{}} }})
              else if (!m.params.cursor) send({{ tools: tools.slice(0, 2), nextCursor: 'p2' }})
              else send({{ tools: tools.slice(2) }})
            }})"#
        );
        std::fs::write(&script, js).unwrap();
        let server = McpServer::Stdio {
            name: "s".into(),
            command: "node".into(),
            args: vec!["server.js".into()],
            env: Default::default(),
        };
        expect(&list(&server, dir.path()).await.unwrap());
    }

    #[tokio::test]
    async fn lists_a_streamable_http_servers_tools_from_sse_and_keeps_its_session() {
        use http_body_util::Full;
        use hyper::body::Bytes;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                let svc = hyper::service::service_fn(|req: hyper::Request<hyper::body::Incoming>| async move {
                    use http_body_util::BodyExt;
                    let (head, body) = req.into_parts();
                    let m: Value = serde_json::from_slice(&body.collect().await.unwrap().to_bytes()).unwrap();
                    let session = head.headers.get("mcp-session-id").map(|v| v.to_str().unwrap().to_string());
                    let auth = head.headers.get("authorization").map(|v| v.to_str().unwrap().to_string());
                    let res = hyper::Response::builder();
                    let res = match m["method"].as_str().unwrap() {
                        "initialize" => res.header("Mcp-Session-Id", "abc").body(Full::new(Bytes::from(
                            json!({ "jsonrpc": "2.0", "id": m["id"], "result": {} }).to_string(),
                        ))),
                        "notifications/initialized" => res.status(202).body(Full::new(Bytes::new())),
                        _ if session.as_deref() != Some("abc") || auth.as_deref() != Some("Bearer k") => {
                            res.status(400).body(Full::new(Bytes::new()))
                        }
                        _ => {
                            let reply = json!({ "jsonrpc": "2.0", "id": m["id"], "result": { "tools": serde_json::from_str::<Value>(TOOLS).unwrap() } });
                            res.header("Content-Type", "text/event-stream")
                                .body(Full::new(Bytes::from(format!("event: message\r\ndata: {reply}\r\n\r\n"))))
                        }
                    };
                    Ok::<_, std::convert::Infallible>(res.unwrap())
                });
                let io = hyper_util::rt::TokioIo::new(stream);
                tokio::spawn(hyper::server::conn::http1::Builder::new().serve_connection(io, svc));
            }
        });
        let headers = [("Authorization".to_string(), "Bearer k".to_string())].into();
        let server = McpServer::Http { name: "h".into(), url, headers };
        expect(&list(&server, Path::new(".")).await.unwrap());
    }

    #[tokio::test]
    async fn looks_up_the_runs_server_by_name_once_listed() {
        let missing = McpServer::Stdio {
            name: "gone".into(),
            command: "gg-no-such-mcp-server".into(),
            args: vec![],
            env: Default::default(),
        };
        prefetch(std::slice::from_ref(&missing), Path::new("."));
        for _ in 0..100 {
            if !CACHE.lock().unwrap().contains_key(&key(&missing)) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(!CACHE.lock().unwrap().contains_key(&key(&missing)), "a failure is retried next time");
        let server =
            McpServer::Http { name: "h".into(), url: "http://127.0.0.1:1/x".into(), headers: Default::default() };
        let info = McpToolInfo { description: Some("d".into()), ..Default::default() };
        CACHE.lock().unwrap().insert(key(&server), Some(Arc::new([("t".into(), info.clone())].into())));
        let servers = [missing, server];
        assert_eq!(lookup(&servers, "h", "t"), Some(info));
        assert_eq!(lookup(&servers, "h", "other"), None);
        assert_eq!(lookup(&servers, "gone", "t"), None);
    }
}
