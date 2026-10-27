//! Attachments reach the workspace (git-excluded) and images the agent: mock HTTP server + mock ACP agent.
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOKEN: &str = "mt_secret";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfake-image";
#[derive(Clone)]
struct Seen {
    path: String,
    request: String,
}

/// Serves `GET /api/daemon/attachments/<id>` (or any request by its full path) for the machine token; records every
/// requested path.
async fn file_server(files: HashMap<String, Vec<u8>>) -> (String, Arc<Mutex<Vec<Seen>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let hits = Arc::new(Mutex::new(vec![]));
    let log = hits.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let (files, log) = (files.clone(), log.clone());
            tokio::spawn(async move {
                let mut buf = vec![0; 8192];
                let mut n = sock.read(&mut buf).await.unwrap();
                loop {
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let Some((head, body)) = req.split_once("\r\n\r\n") else { break };
                    let len = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(str::to_owned))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if body.len() >= len {
                        break;
                    }
                    let read = sock.read(&mut buf[n..]).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    n += read;
                }
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or_default().to_string();
                log.lock().unwrap().push(Seen { path: path.clone(), request: req.clone() });
                let id = path.trim_start_matches("/api/daemon/attachments/");
                let authed = req.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {TOKEN}")));
                let (status, body) = match files.get(id) {
                    Some(b) if authed => ("200 OK", b.clone()),
                    _ if !authed => ("401 Unauthorized", vec![]),
                    _ => ("404 Not Found", vec![]),
                };
                let head = format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
                sock.write_all(head.as_bytes()).await.unwrap();
                sock.write_all(&body).await.unwrap();
            });
        }
    });
    (url, hits)
}

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    _home: tempfile::TempDir,
}

fn rig(server: &str) -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Default::default(),
        api: Some(Config {
            server: server.into(),
            token: TOKEN.into(),
            machine_id: "mc1".into(),
            owner_name: "王磊".into(),
            tls_trust: None,
        }),
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, _home: home }
}

impl Rig {
    async fn done(&mut self, run_id: &str) -> RunDone {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv()).await.unwrap().unwrap();
            if let DaemonToServer::RunDone(d) = msg
                && d.run_id == run_id
            {
                return d;
            }
        }
    }
}

fn att(id: &str, message_id: &str, name: &str, mime: &str, size: usize) -> Attachment {
    Attachment { id: id.into(), name: name.into(), size: size as u64, mime: mime.into(), message_id: message_id.into() }
}

fn start(run_id: &str, cwd: &Path, attachments: Vec<Attachment>, context: Vec<Attachment>) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: String::new(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            git: None,
            agent_settings: Default::default(),
        },
        workspace: WorkspaceSpec {
            repo: None,
            cd_path: Some(cwd.to_string_lossy().into_owned()),
            protect_base: false,
            extra_dirs: vec![],
        },
        resume_session_id: None,
        new_session_reason: None,
        mcp_servers: vec![],
        skills: vec![],
        plugins: vec![],
        command: None,
        sync: None,
        env: Default::default(),
        prompt: RunPrompt {
            text: "mock:echo 看图".into(),
            triggered_by: "王磊".into(),
            context: vec![ContextMessage {
                seq: 1,
                author: "陈晨".into(),
                kind: "user".into(),
                body: "CI 挂了".into(),
                at: "2026-09-23T10:12:00Z".into(),
                attachments: context,
            }],
            omitted: 0,
            fallback_context: vec![],
            attachments,
            quote: Some(Quote { author: "老李的 Codex".into(), body: "已定位".into() }),
        },
    }
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let ok = std::process::Command::new("git").args(["init", "-q"]).current_dir(dir.path()).status().unwrap();
    assert!(ok.success());
    dir
}

fn git_status(dir: &Path) -> String {
    let out = std::process::Command::new("git").args(["status", "--porcelain"]).current_dir(dir).output().unwrap();
    String::from_utf8(out.stdout).unwrap()
}

#[tokio::test]
async fn writes_attachments_into_the_workspace_excluded_from_git_and_sends_images() {
    let log = b"ERROR boom\n".to_vec();
    let files = HashMap::from([("a1".to_string(), PNG.to_vec()), ("a2".to_string(), log.clone())]);
    let (url, hits) = file_server(files).await;
    let mut r = rig(&url);
    let ws = repo();
    let shot = att("a1", "m2", "shot.png", "image/png", PNG.len());
    let ci = att("a2", "m1", "ci.log", "text/plain", log.len());
    r.engine.handle(
        ServerToDaemon::RunStart(Box::new(start("r1", ws.path(), vec![shot.clone()], vec![ci.clone()]))),
        &r.out,
    );
    let done = r.done("r1").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);

    let root: PathBuf = ws.path().into();
    assert_eq!(std::fs::read(root.join(".gonggong/attachments/m2/shot.png")).unwrap(), PNG);
    assert_eq!(std::fs::read(root.join(".gonggong/attachments/m1/ci.log")).unwrap(), log);
    assert!(std::fs::read_to_string(root.join(".git/info/exclude")).unwrap().lines().any(|l| l == ".gonggong/"));
    assert_eq!(git_status(&root), "");

    let echo: serde_json::Value = serde_json::from_str(&done.reply).unwrap();
    let prompt = echo["prompt"].as_str().unwrap();
    assert!(
        prompt.contains("[#1 2026-09-23 10:12] 陈晨: CI 挂了（附件：.gonggong/attachments/m1/ci.log）\n"),
        "{prompt}"
    );
    assert!(
        prompt
            .contains("引用 老李的 Codex：已定位\n\n王磊 说：mock:echo 看图\n附件：.gonggong/attachments/m2/shot.png")
    );
    assert_eq!(
        echo["blocks"],
        serde_json::json!([{ "type": "text" }, { "type": "image", "mimeType": "image/png", "bytes": PNG.len() }])
    );

    // Present files are not fetched again; the exclude line is added once.
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r2", ws.path(), vec![shot], vec![ci]))), &r.out);
    assert_eq!(r.done("r2").await.outcome, RunOutcome::Completed);
    assert_eq!(hits.lock().unwrap().len(), 2);
    let exclude = std::fs::read_to_string(root.join(".git/info/exclude")).unwrap();
    assert_eq!(exclude.lines().filter(|l| *l == ".gonggong/").count(), 1);
}

#[tokio::test]
async fn the_fallback_contexts_attachments_are_fetched_only_when_the_fallback_is_used() {
    let (url, hits) = file_server(HashMap::from([("a3".to_string(), b"old\n".to_vec())])).await;
    let mut r = rig(&url);
    let ws = tempfile::tempdir().unwrap();
    let with_fallback = |run_id: &str, resume: Option<String>| {
        let mut s = start(run_id, ws.path(), vec![], vec![]);
        s.resume_session_id = resume;
        s.prompt.fallback_context = vec![ContextMessage {
            seq: 0,
            author: "王磊".into(),
            kind: "user".into(),
            body: "旧日志".into(),
            at: "2026-09-23T09:00:00Z".into(),
            attachments: vec![att("a3", "m0", "old.log", "text/plain", 4)],
        }];
        ServerToDaemon::RunStart(Box::new(s))
    };
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r1", ws.path(), vec![], vec![]))), &r.out);
    let first = r.done("r1").await;

    // The session resumes: its history is not replayed, so neither are its files fetched.
    r.engine.handle(with_fallback("r2", first.session_id.clone()), &r.out);
    let done = r.done("r2").await;
    assert_eq!((done.outcome, done.new_session_reason), (RunOutcome::Completed, None), "{:?}", done.error);
    assert!(hits.lock().unwrap().is_empty());
    let old = ws.path().join(".gonggong/attachments/m0/old.log");
    assert!(!old.exists());

    r.engine.handle(with_fallback("r3", Some("gone".into())), &r.out);
    let done = r.done("r3").await;
    assert_eq!(done.new_session_reason.as_deref(), Some("resume_failed"), "{:?}", done.error);
    assert_eq!(hits.lock().unwrap()[0].path, "/api/daemon/attachments/a3");
    assert_eq!(std::fs::read(&old).unwrap(), b"old\n");
    let echo: serde_json::Value = serde_json::from_str(&done.reply).unwrap();
    assert!(echo["prompt"].as_str().unwrap().contains("旧日志（附件：.gonggong/attachments/m0/old.log）"));
}

#[tokio::test]
async fn attachments_unused_for_a_week_are_removed_when_others_are_fetched() {
    let log = b"ERROR boom\n".to_vec();
    let (url, hits) = file_server(HashMap::from([("a2".to_string(), log.clone())])).await;
    let mut r = rig(&url);
    let ws = tempfile::tempdir().unwrap();
    let dir = ws.path().join(".gonggong/attachments");
    let put = |folder: &str, name: &str, body: &[u8], days_old: u64| {
        let path = dir.join(folder).join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, body).unwrap();
        let at = std::time::SystemTime::now() - Duration::from_secs(days_old * 24 * 3600);
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(at).unwrap();
    };
    put("stale", "a.txt", b"a", 8);
    put("mixed", "b.txt", b"b", 8);
    put("mixed", "c.txt", b"c", 1);
    // Old, but this run's context refers to it.
    put("m1", "ci.log", &log, 30);
    let ci = att("a2", "m1", "ci.log", "text/plain", log.len());
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r1", ws.path(), vec![], vec![ci]))), &r.out);
    assert_eq!(r.done("r1").await.outcome, RunOutcome::Completed);

    assert!(!dir.join("stale").exists());
    assert!(dir.join("mixed/b.txt").exists());
    assert_eq!(std::fs::read(dir.join("m1/ci.log")).unwrap(), log);
    assert!(hits.lock().unwrap().is_empty());
    // Used again, so kept for another week.
    let used = std::fs::metadata(dir.join("m1/ci.log")).unwrap().modified().unwrap();
    assert!(used.elapsed().unwrap() < Duration::from_secs(3600));
}

#[tokio::test]
async fn a_failed_download_fails_the_run() {
    let (url, _) = file_server(HashMap::new()).await;
    let mut r = rig(&url);
    let ws = tempfile::tempdir().unwrap();
    let gone = att("nope", "m2", "shot.png", "image/png", 10);
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r1", ws.path(), vec![gone], vec![]))), &r.out);
    let done = r.done("r1").await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert!(done.error.unwrap().starts_with("附件下载失败：shot.png"));
}

#[tokio::test]
async fn sends_workspace_images_and_video_to_the_chat_without_asking_the_owner() {
    let (url, hits) = file_server(HashMap::from([(
        "/api/daemon/runs/r1/attachments".to_string(),
        br#"{"id":"m9","kind":"bot"}"#.to_vec(),
    )]))
    .await;
    let mut r = rig(&url);
    let ws = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(ws.path().join("out")).unwrap();
    std::fs::write(ws.path().join("out/shot.png"), PNG).unwrap();
    std::fs::write(ws.path().join("out/demo.mp4"), b"movie").unwrap();
    let mut s = start("r1", ws.path(), vec![], vec![]);
    s.prompt.text = r#"mock:tool send_attachments {"paths":["out/shot.png","out/demo.mp4"],"text":"预览"}"#.into();
    r.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &r.out);
    let done = r.done("r1").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    assert_eq!(done.reply, "已发送 2 个附件到群聊");
    let hits = hits.lock().unwrap();
    let req = &hits[0].request;
    assert_eq!(hits[0].path, "/api/daemon/runs/r1/attachments");
    assert!(req.starts_with("POST /api/daemon/runs/r1/attachments HTTP/1.1"), "{req}");
    let lower = req.to_ascii_lowercase();
    assert!(lower.contains("content-type: image/png") && lower.contains("content-type: video/mp4"), "{req}");
    assert!(req.contains(r#"filename="shot.png""#) && req.contains(r#"filename="demo.mp4""#));
}

#[tokio::test]
async fn gonggong_tools_reach_the_server_for_the_live_run_without_asking_the_owner() {
    let tool = "/api/daemon/runs/r1/tools/fetch_attachments";
    let res = r##"{"text":"#1 的附件：","isError":false,"attachments":[{"id":"a2","name":"ci.log","size":4,"mime":"text/plain","messageId":"m1"}]}"##;
    let files = HashMap::from([("a2".to_string(), b"boom".to_vec()), (tool.to_string(), res.as_bytes().to_vec())]);
    let (url, hits) = file_server(files).await;
    let mut r = rig(&url);
    let ws = tempfile::tempdir().unwrap();
    let mut s = start("r1", ws.path(), vec![], vec![]);
    s.prompt.text = r#"mock:tool fetch_attachments {"message":1}"#.into();
    r.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &r.out);
    let done = r.done("r1").await;
    assert_eq!(
        done.reply, "#1 的附件：\n附件（已放入工作区）：\n- .gonggong/attachments/m1/ci.log",
        "{:?}",
        done.error
    );
    assert_eq!(std::fs::read(ws.path().join(".gonggong/attachments/m1/ci.log")).unwrap(), b"boom");
    assert_eq!(
        hits.lock().unwrap().iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
        [tool, "/api/daemon/attachments/a2"]
    );
}
