//! `html_render` over the built-in MCP server: the checked page and its fields reach the server as one multipart upload.
use agent_client_protocol::schema::v1::McpServer;
use gonggong::ask::{AskServer, Asker};
use gonggong::config::Config;
use gonggong::hosted::{Scope, Services};
use gonggong::protocol::Question;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

struct Live(PathBuf);

impl Asker for Live {
    fn ask(&self, _: Vec<Question>) -> Result<(String, oneshot::Receiver<String>), String> {
        Err("unused".into())
    }
    fn abandon(&self, _: &str) {}
    fn active_run(&self) -> Option<(String, PathBuf)> {
        Some(("r1".into(), self.0.clone()))
    }
    fn scope(&self) -> Option<Scope> {
        None
    }
    fn hidden_tools(&self) -> Vec<String> {
        vec![]
    }
}

/// Answers every request with a stored render and records it whole.
async fn server() -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(vec![]));
    let log = seen.clone();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![];
            loop {
                let mut chunk = [0; 65536];
                let n = s.read(&mut chunk).await.unwrap();
                buf.extend_from_slice(&chunk[..n]);
                let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else { continue };
                let head = String::from_utf8_lossy(&buf[..end]).to_ascii_lowercase();
                let length = head
                    .lines()
                    .find_map(|l| l.strip_prefix("content-length:"))
                    .map(|v| v.trim().parse::<usize>().unwrap());
                let body = &buf[end + 4..];
                if n == 0 || length.map_or(body.ends_with(b"0\r\n\r\n"), |len| body.len() >= len) {
                    break;
                }
            }
            log.lock().unwrap().push(String::from_utf8_lossy(&buf).to_string());
            let body = r#"{"attachmentId":"p1","title":"营收看板","height":2000}"#;
            let res = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(res.as_bytes()).await.unwrap();
        }
    });
    (url, seen)
}

async fn call(url: &str, args: Value) -> Value {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "html_render", "arguments": args } });
    let res = reqwest::Client::new().post(url).json(&body).send().await.unwrap();
    res.json::<Value>().await.unwrap()["result"].clone()
}

/// The multipart field `name` of `req`: its part headers and value.
fn field<'a>(req: &'a str, name: &str) -> Option<&'a str> {
    let at = req.find(&format!("name=\"{name}\""))?;
    let value = &req[at..];
    let (head, rest) = value.split_once("\r\n\r\n")?;
    let end = rest.find("\r\n--")?;
    Some(if head.contains("filename=") { &value[..head.len() + 4 + end] } else { &rest[..end] })
}

#[tokio::test(flavor = "multi_thread")]
async fn uploads_the_checked_page_with_its_title_height_and_heights() {
    let (base, seen) = server().await;
    let dir = tempfile::tempdir().unwrap();
    let png = dir.path().join("chart.png");
    std::fs::write(&png, b"\x89PNG\r\n\x1a\nchart").unwrap();
    let config = Config {
        server: base,
        token: "mt_1".into(),
        machine_id: "m".into(),
        owner_name: "王磊".into(),
        tls_trust: None,
    };
    let ask = AskServer::start(Some(config), Services::new(dir.path())).await.unwrap();
    let live: Arc<dyn Asker> = Arc::new(Live(dir.path().to_path_buf()));
    let McpServer::Http(http) = ask.register(Arc::downgrade(&live)) else { panic!() };
    let html = format!(r#"<div style="height:300px"><img src="{}"></div>"#, png.display());

    let result = call(&http.url, json!({ "html": html, "title": "  营收看板 ", "height": 5000 })).await;
    assert_eq!(result["isError"], false, "{result}");
    assert_eq!(
        result["content"][0]["text"],
        "Published \"营收看板\". It shows in your final reply where you put this block, else after your text; do not restate it.\n```html-page\n{\"id\":\"p1\"}\n```"
    );
    let req = seen.lock().unwrap()[0].clone();
    assert!(req.starts_with("POST /api/daemon/runs/r1/html-renders HTTP/1.1"), "{req}");
    assert!(req.to_ascii_lowercase().contains("authorization: bearer mt_1"));
    assert_eq!(field(&req, "title"), Some("营收看板"));
    assert_eq!(field(&req, "height"), Some("2000"));
    let page = field(&req, "html").unwrap();
    assert!(page.contains(r#"filename="page.html""#) && page.to_ascii_lowercase().contains("content-type: text/html"));
    // The images are inlined; the theme bootstrap is the server's.
    assert!(
        page.ends_with(r#"<div style="height:300px"><img src="data:image/png;base64,iVBORw0KGgpjaGFydA=="></div>"#)
    );
    // Measured only where the machine has a Chrome-family browser.
    if let Some(heights) = field(&req, "heights") {
        let heights: Vec<(u32, u32)> = serde_json::from_str(heights).unwrap();
        assert_eq!(heights.len(), 9);
        assert!(heights.iter().all(|&(_, h)| h == 300), "{heights:?}");
    }

    let gone = format!(r#"<img src="{}">"#, dir.path().join("gone.png").display());
    for (html, error) in
        [(gone.as_str(), "could not be read"), ("<style>main{min-height:100dvh}</style>", "viewport height unit")]
    {
        let result = call(&http.url, json!({ "html": html, "title": "x", "height": 300 })).await;
        assert_eq!(result["isError"], true);
        assert!(result["content"][0]["text"].as_str().unwrap().contains(error), "{result}");
    }
    assert_eq!(seen.lock().unwrap().len(), 1);
}
