//! Hosted artifacts (docs/plan/产物托管与编辑-开发计划.md §3.2, slice D) against a stand-in server: local changes go up
//! before the head is checked out (and a folder whose changes could not go up is left alone), a turn's changes go up
//! after it with a key that makes retries idempotent, and nothing outside the folder is ever written.
use gonggong::artifacts::Artifacts;
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox};
use gonggong::sync::{FileRef, Manifest, hash_bytes, manifest_root};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

const TOKEN: &str = "mt_art";

struct Version {
    id: String,
    key: Option<String>,
    files: Vec<ArtifactFile>,
}

/// Artifact a1's versions and blobs.
#[derive(Default)]
struct Store {
    blobs: HashMap<String, Vec<u8>>,
    versions: Vec<Version>,
    head: Option<String>,
    submits: Vec<ArtifactSubmitReq>,
    /// Every request as `METHOD path`.
    hits: Vec<String>,
    fail_uploads: bool,
    /// Submits stored but answered with a 502, as if the answer was lost.
    lose_answers: usize,
    thumbnails: Vec<String>,
}

impl Store {
    /// A version made elsewhere (the panel, another bot) that becomes the head.
    fn push(&mut self, files: &[(&str, &str)]) -> String {
        let files = files
            .iter()
            .map(|(p, b)| {
                self.blobs.insert(hash_bytes(b.as_bytes()), b.as_bytes().to_vec());
                ArtifactFile { path: p.to_string(), hash: hash_bytes(b.as_bytes()), size: b.len() as u64 }
            })
            .collect();
        let id = format!("v{}", self.versions.len() + 1);
        self.versions.push(Version { id: id.clone(), key: None, files });
        self.head = Some(id.clone());
        id
    }

    fn reference(&self) -> DaemonArtifactRef {
        let digest = self.head.as_ref().map(|h| {
            let v = self.versions.iter().find(|v| &v.id == h).unwrap();
            let m: Manifest =
                v.files.iter().map(|f| (f.path.clone(), FileRef { hash: f.hash.clone(), exec: false })).collect();
            manifest_root(&m)
        });
        DaemonArtifactRef { id: "a1".into(), dir: "design/app".into(), head_version_id: self.head.clone(), digest }
    }

    fn manifest_hits(&self) -> usize {
        self.hits.iter().filter(|h| h.starts_with("GET /api/daemon/artifacts/")).count()
    }
}

fn json(status: StatusCode, v: serde_json::Value) -> Response<Full<Bytes>> {
    let mut res = Response::new(Full::new(Bytes::from(v.to_string())));
    *res.status_mut() = status;
    res
}

async fn handle(store: Arc<Mutex<Store>>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let (method, path) = (req.method().to_string(), req.uri().path().to_string());
    let authed = req.headers().get("authorization").and_then(|v| v.to_str().ok()) == Some(&format!("Bearer {TOKEN}"));
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let mut s = store.lock().unwrap();
    s.hits.push(format!("{method} {path}"));
    if !authed {
        return Ok(json(StatusCode::UNAUTHORIZED, serde_json::json!({ "message": "token" })));
    }
    let segs: Vec<&str> = path.trim_start_matches("/api/daemon/").split('/').collect();
    let res = match (method.as_str(), segs.as_slice()) {
        ("GET", ["artifacts", "a1", "versions", vid]) => match s.versions.iter().find(|v| v.id == *vid) {
            Some(v) => json(StatusCode::OK, serde_json::json!({ "versionId": v.id, "files": v.files })),
            None => json(StatusCode::NOT_FOUND, serde_json::json!({ "message": "no version" })),
        },
        ("POST", ["runs", _, "artifacts", "a1", "blobs", "missing"]) => {
            let req: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let missing: Vec<_> = req["hashes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|h| !s.blobs.contains_key(h.as_str().unwrap()))
                .collect();
            json(StatusCode::OK, serde_json::json!({ "missing": missing }))
        }
        ("PUT", ["runs", _, "artifacts", "a1", "blobs", _]) if s.fail_uploads => {
            json(StatusCode::SERVICE_UNAVAILABLE, serde_json::json!({ "message": "down" }))
        }
        ("PUT", ["runs", _, "artifacts", "a1", "blobs", hash]) => {
            assert_eq!(hash_bytes(&body), *hash);
            s.blobs.insert(hash.to_string(), body.to_vec());
            json(StatusCode::NO_CONTENT, serde_json::json!({}))
        }
        ("GET", ["runs", _, "artifacts", "a1", "blobs", hash]) => match s.blobs.get(*hash) {
            Some(b) => Response::new(Full::new(Bytes::from(b.clone()))),
            None => json(StatusCode::NOT_FOUND, serde_json::json!({ "message": "no blob" })),
        },
        ("POST", ["runs", _, "artifacts", "a1", "versions"]) => {
            let req: ArtifactSubmitReq = serde_json::from_slice(&body).unwrap();
            s.submits.push(req.clone());
            for f in &req.files {
                assert!(s.blobs.contains_key(&f.hash), "blob of {} not uploaded", f.path);
            }
            let (id, n, head) = match s.versions.iter().position(|v| v.key.as_ref() == Some(&req.submit_key)) {
                Some(i) => (s.versions[i].id.clone(), i + 1, s.head.as_ref() == Some(&s.versions[i].id)),
                None => {
                    let id = format!("v{}", s.versions.len() + 1);
                    let head = req.parent_version_id == s.head;
                    s.versions.push(Version { id: id.clone(), key: Some(req.submit_key.clone()), files: req.files });
                    if head {
                        s.head = Some(id.clone());
                    }
                    (id, s.versions.len(), head)
                }
            };
            if s.lose_answers > 0 {
                s.lose_answers -= 1;
                json(StatusCode::BAD_GATEWAY, serde_json::json!({ "message": "lost" }))
            } else {
                json(StatusCode::OK, serde_json::json!({ "versionId": id, "n": n, "head": head, "stale": !head }))
            }
        }
        ("PUT", ["runs", _, "artifacts", "a1", "versions", vid, "thumbnail"]) => {
            s.thumbnails.push(vid.to_string());
            json(StatusCode::NO_CONTENT, serde_json::json!({}))
        }
        _ => panic!("unexpected {method} {path}"),
    };
    Ok(res)
}

struct Rig {
    store: Arc<Mutex<Store>>,
    api: Config,
    home: tempfile::TempDir,
    cwd: tempfile::TempDir,
    artifacts: Artifacts,
}

async fn rig() -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let store = Arc::new(Mutex::new(Store::default()));
    let shared = store.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let store = shared.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(store.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    let api = Config {
        server: format!("http://127.0.0.1:{port}"),
        token: TOKEN.into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        tls_trust: None,
    };
    let home = tempfile::tempdir().unwrap();
    let artifacts = Artifacts::new(&api, home.path()).unwrap();
    Rig { store, api, home, cwd: tempfile::tempdir().unwrap(), artifacts }
}

impl Rig {
    fn dir(&self) -> PathBuf {
        self.cwd.path().join("design/app")
    }

    fn write(&self, path: &str, body: &str) {
        let p = self.dir().join(path);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn read(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(self.dir().join(path)).ok()
    }

    fn reference(&self) -> DaemonArtifactRef {
        self.store.lock().unwrap().reference()
    }

    async fn prepare(&self) -> Result<(), String> {
        self.artifacts.prepare("r1", self.cwd.path(), &self.reference()).await
    }

    async fn publish(&self) -> Result<Option<ArtifactSubmitRes>, String> {
        self.artifacts.publish("r1", self.cwd.path(), &self.reference()).await
    }

    /// Checked out at a head holding `files`.
    async fn at(&self, files: &[(&str, &str)]) -> String {
        let v = self.store.lock().unwrap().push(files);
        self.prepare().await.unwrap();
        v
    }

    fn submits(&self) -> Vec<ArtifactSubmitReq> {
        self.store.lock().unwrap().submits.clone()
    }
}

fn paths(req: &ArtifactSubmitReq) -> Vec<&str> {
    req.files.iter().map(|f| f.path.as_str()).collect()
}

#[tokio::test]
async fn the_first_version_goes_up_with_every_file_but_hidden_ones() {
    let r = rig().await;
    r.prepare().await.unwrap();
    assert!(!r.dir().exists(), "nothing to check out before the first version");
    r.write("gg-artifact.json", "{}");
    r.write("screens/home.html", "<p>home</p>");
    r.write("_gg/gg-kit.js", "kit");
    r.write("index.html", "shell");
    r.write(".DS_Store", "x");
    r.write("node_modules/x/index.js", "x");
    let res = r.publish().await.unwrap().unwrap();
    assert_eq!((res.version_id.as_str(), res.n, res.head, res.stale), ("v1", 1, true, false));
    let s = r.submits();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].parent_version_id, None);
    assert_eq!(paths(&s[0]), ["_gg/gg-kit.js", "gg-artifact.json", "index.html", "screens/home.html"]);
    assert_eq!(s[0].files[3].size, 11);
    let hits = r.store.lock().unwrap().hits.clone();
    assert!(hits.iter().all(|h| h.contains("/runs/r1/artifacts/a1/")), "{hits:?}");
    assert!(!r.cwd.path().join(".gonggong").exists() && !r.dir().join("state.json").exists());
}

#[tokio::test]
async fn an_unchanged_folder_is_not_submitted_again() {
    let r = rig().await;
    r.at(&[("index.html", "a")]).await;
    assert_eq!(r.publish().await.unwrap(), None);
    r.write("index.html", "b");
    let res = r.publish().await.unwrap().unwrap();
    assert_eq!(r.submits()[0].parent_version_id.as_deref(), Some("v1"));
    assert!(res.head);
    assert_eq!(r.publish().await.unwrap(), None);
    r.prepare().await.unwrap();
    assert_eq!(r.submits().len(), 1);
    assert_eq!(r.store.lock().unwrap().manifest_hits(), 1, "the head is already here");
}

#[tokio::test]
async fn hand_edits_go_up_before_the_moved_head_is_checked_out() {
    let r = rig().await;
    r.at(&[("index.html", "v1"), ("screens/a.html", "a1")]).await;
    r.store.lock().unwrap().push(&[("index.html", "v2"), ("screens/a.html", "a1")]);
    r.write("screens/a.html", "edited by hand");
    r.prepare().await.unwrap();
    let s = r.submits();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].parent_version_id.as_deref(), Some("v1"));
    assert_eq!(s[0].files[1].hash, hash_bytes(b"edited by hand"));
    let hits = r.store.lock().unwrap().hits.clone();
    let submit = hits.iter().position(|h| h.ends_with("/versions") && h.starts_with("POST")).unwrap();
    let checkout = hits.iter().rposition(|h| h.starts_with("GET /api/daemon/artifacts/a1/versions/v2")).unwrap();
    assert!(submit < checkout, "{hits:?}");
    assert_eq!(r.read("index.html").as_deref(), Some("v2"));
    assert_eq!(r.read("screens/a.html").as_deref(), Some("a1"));
    assert_eq!(r.publish().await.unwrap(), None, "the checked out head is the folder's version now");
}

#[tokio::test]
async fn a_folder_whose_changes_cannot_go_up_is_not_overwritten() {
    let r = rig().await;
    r.at(&[("index.html", "v1")]).await;
    r.store.lock().unwrap().push(&[("index.html", "v2"), ("new.html", "n")]);
    r.store.lock().unwrap().fail_uploads = true;
    r.write("index.html", "mine");
    let err = r.prepare().await.unwrap_err();
    assert!(err.contains("503"), "{err}");
    assert_eq!(r.read("index.html").as_deref(), Some("mine"));
    assert_eq!(r.read("new.html"), None);
    assert!(r.submits().is_empty());

    r.store.lock().unwrap().fail_uploads = false;
    r.prepare().await.unwrap();
    assert_eq!(r.submits().len(), 1);
    assert_eq!(r.read("index.html").as_deref(), Some("v2"));
}

#[tokio::test]
async fn a_new_head_is_checked_out_deleting_files_it_lacks_but_not_hidden_ones() {
    let r = rig().await;
    r.at(&[("index.html", "1"), ("old.html", "o"), ("screens/gone.html", "g"), ("assets/a.png", "png")]).await;
    r.write(".keep", "mine");
    r.write("node_modules/x.js", "dep");
    r.store.lock().unwrap().push(&[("index.html", "2"), ("assets/a.png", "png"), ("screens/new.html", "n")]);
    r.prepare().await.unwrap();
    assert_eq!(r.read("index.html").as_deref(), Some("2"));
    assert_eq!(r.read("screens/new.html").as_deref(), Some("n"));
    assert_eq!((r.read("old.html"), r.read("screens/gone.html")), (None, None));
    assert_eq!(r.read(".keep").as_deref(), Some("mine"));
    assert_eq!(r.read("node_modules/x.js").as_deref(), Some("dep"));
    let left: Vec<_> = std::fs::read_dir(r.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert!(left.iter().all(|n| !n.to_string_lossy().starts_with(".gg-checkout")), "{left:?}");
    assert!(r.submits().is_empty());
    let gets = r.store.lock().unwrap().hits.iter().filter(|h| h.contains("/blobs/") && h.starts_with("GET")).count();
    assert_eq!(gets, 4 + 2, "only changed and new files are downloaded the second time");
}

#[tokio::test]
async fn a_lost_answer_is_resent_with_the_same_key_without_a_second_version() {
    let r = rig().await;
    r.at(&[("index.html", "1")]).await;
    r.write("index.html", "2");
    r.store.lock().unwrap().lose_answers = 1;
    assert!(r.publish().await.is_err());
    assert_eq!(r.store.lock().unwrap().versions.len(), 2);
    r.write("index.html", "3 (after the run)");
    r.prepare().await.unwrap();
    let s = r.submits();
    assert_eq!(s[0].submit_key, s[1].submit_key);
    assert_eq!(s[1].files, s[0].files);
    // The hand edit after the run goes up on top of the version the resend settled.
    assert_eq!(s.len(), 3);
    assert_eq!(s[2].parent_version_id.as_deref(), Some("v2"));
    assert_ne!(s[2].submit_key, s[0].submit_key);
    assert_eq!(r.store.lock().unwrap().versions.len(), 3);
    assert_eq!(r.read("index.html").as_deref(), Some("3 (after the run)"));
}

#[tokio::test]
async fn a_stale_submit_stays_a_candidate_and_the_head_is_checked_out_next() {
    let r = rig().await;
    r.at(&[("index.html", "1")]).await;
    r.store.lock().unwrap().push(&[("index.html", "edited in the panel")]);
    r.write("index.html", "by the agent");
    let res = r.publish().await.unwrap().unwrap();
    assert_eq!((res.version_id.as_str(), res.head, res.stale), ("v3", false, true));
    assert_eq!(r.store.lock().unwrap().head.as_deref(), Some("v2"));
    r.prepare().await.unwrap();
    assert_eq!(r.submits().len(), 1);
    assert_eq!(r.read("index.html").as_deref(), Some("edited in the panel"));
}

#[tokio::test]
async fn a_version_with_a_path_outside_the_folder_is_refused_whole() {
    let r = rig().await;
    for bad in ["../escape.txt", "screens/../../escape.txt", ".git/config", "/etc/x"] {
        {
            let mut s = r.store.lock().unwrap();
            s.blobs.insert(hash_bytes(b"x"), b"x".to_vec());
            let files = vec![
                ArtifactFile { path: "index.html".into(), hash: hash_bytes(b"x"), size: 1 },
                ArtifactFile { path: bad.into(), hash: hash_bytes(b"x"), size: 1 },
            ];
            let id = format!("bad{}", s.versions.len());
            s.versions.push(Version { id: id.clone(), key: None, files });
            s.head = Some(id);
        }
        assert!(r.prepare().await.is_err(), "{bad}");
        assert!(!r.cwd.path().join("design/escape.txt").exists() && !r.cwd.path().join("escape.txt").exists());
        assert_eq!(r.read("index.html"), None, "{bad}: nothing written");
    }
}

#[tokio::test]
async fn an_oversized_folder_is_not_uploaded() {
    let r = rig().await;
    r.write("big.bin", &"x".repeat(10 * 1024 * 1024 + 1));
    let err = r.publish().await.unwrap_err();
    assert!(err.contains("10MB"), "{err}");
    assert!(r.submits().is_empty());
}

#[tokio::test]
async fn a_folder_already_holding_the_head_is_adopted_without_downloads() {
    let r = rig().await;
    r.store.lock().unwrap().push(&[("index.html", "same")]);
    r.write("index.html", "same");
    r.prepare().await.unwrap();
    assert_eq!(r.store.lock().unwrap().manifest_hits(), 0);
    assert!(r.submits().is_empty());
    assert_eq!(r.publish().await.unwrap(), None);
}

fn run_start(run_id: &str, cwd: &Path, text: &str, artifacts: Vec<DaemonArtifactRef>) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "设计".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: String::new(),
            tier: Tier::Full,
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
        hidden_tools: vec![],
        artifacts,
        artifact_exclude: vec![],
        command: None,
        sync: None,
        env: Default::default(),
        prompt: RunPrompt {
            text: text.into(),
            triggered_by: "王磊".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
    }
}

/// Runs a turn on the mock agent; returns run.done and the status steps reported.
async fn turn(r: &Rig, run_id: &str, text: &str) -> (RunDone, Vec<String>) {
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: r.home.path().to_path_buf(),
        user_home: r.home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Default::default(),
        api: Some(r.api.clone()),
    });
    let (out, mut rx) = Outbox::channel();
    let start = run_start(run_id, r.cwd.path(), text, vec![r.reference()]);
    engine.handle(ServerToDaemon::RunStart(Box::new(start)), &out);
    let mut steps = vec![];
    loop {
        match tokio::time::timeout(Duration::from_secs(20), rx.recv()).await.unwrap().unwrap() {
            DaemonToServer::RunDone(d) => return (d, steps),
            DaemonToServer::RunEvent { event: RunEvent::Status { step, .. }, .. } => steps.push(step),
            _ => {}
        }
    }
}

#[tokio::test]
async fn a_run_works_on_the_checked_out_head_and_its_changes_go_up_before_run_done() {
    let r = rig().await;
    r.store.lock().unwrap().push(&[("index.html", "head"), ("old.html", "o")]);
    let (done, _) = turn(&r, "run9", "mock:sh cat design/app/index.html && printf 'new' > design/app/index.html").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    assert_eq!(done.reply, "head");
    let s = r.submits();
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].parent_version_id.as_deref(), Some("v1"));
    assert_eq!(
        s[0].files.iter().map(|f| (f.path.as_str(), f.hash.clone())).collect::<Vec<_>>(),
        [("index.html", hash_bytes(b"new")), ("old.html", hash_bytes(b"o"))]
    );
    let hits = r.store.lock().unwrap().hits.clone();
    assert!(hits.iter().any(|h| h == "POST /api/daemon/runs/run9/artifacts/a1/versions"), "{hits:?}");
}

#[tokio::test]
async fn the_agent_and_the_run_are_told_when_a_folder_was_left_as_it_is() {
    let r = rig().await;
    r.at(&[("index.html", "v1")]).await;
    r.store.lock().unwrap().push(&[("index.html", "v2")]);
    r.store.lock().unwrap().fail_uploads = true;
    r.write("index.html", "mine");
    let (done, steps) = turn(&r, "run2", "mock:echo").await;
    let prompt =
        serde_json::from_str::<serde_json::Value>(&done.reply).unwrap()["prompt"].as_str().unwrap().to_string();
    assert!(prompt.starts_with("产物托管：以下产物目录的本地改动未能上传"), "{prompt}");
    assert!(prompt.contains("design/app"), "{prompt}");
    assert!(steps.iter().any(|s| s.starts_with("产物 design/app 的本地改动未能上传")), "{steps:?}");
    assert!(steps.iter().any(|s| s.starts_with("产物 design/app 上传失败，下一轮开跑前重试")), "{steps:?}");
    assert_eq!(r.read("index.html").as_deref(), Some("mine"));
}
