//! A force-group turn (S4) against the mock ACP agent and a stand-in server: catch up before the turn, submit after
//! it (merging conflicts), idle replicas catching up on sync.available, and the mode switch's sync.init (S8).
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use gonggong::sync::{Base, FileRef, Manifest, Replica, hash_bytes, manifest_root};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

/// The server's versions of group g1 and its blobs.
#[derive(Default)]
struct Store {
    blobs: HashMap<String, Vec<u8>>,
    versions: Vec<Vec<SyncEntry>>,
}

impl Store {
    fn head(&self) -> u64 {
        self.versions.len() as u64
    }

    /// A new version writing (Some) or deleting (None) files.
    fn push(&mut self, files: &[(&str, Option<&str>)]) -> u64 {
        let entries = files
            .iter()
            .map(|(path, body)| {
                let hash = body.map(|b| {
                    self.blobs.insert(hash_bytes(b.as_bytes()), b.as_bytes().to_vec());
                    hash_bytes(b.as_bytes())
                });
                SyncEntry { path: path.to_string(), hash, exec: false }
            })
            .collect();
        self.versions.push(entries);
        self.head()
    }

    fn changes(&self, from: u64) -> Vec<SyncEntry> {
        let mut latest = BTreeMap::new();
        for e in self.versions.iter().skip(from as usize).flatten() {
            latest.insert(e.path.clone(), e.clone());
        }
        latest.into_values().collect()
    }
}

async fn handle(store: Arc<Mutex<Store>>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let (method, path, query) =
        (req.method().clone(), req.uri().path().to_string(), req.uri().query().unwrap_or_default().to_string());
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let reply = |status: StatusCode, body: Vec<u8>| {
        let mut res = Response::new(Full::new(Bytes::from(body)));
        *res.status_mut() = status;
        Ok(res)
    };
    let mut s = store.lock().unwrap();
    let rest = path.strip_prefix("/api/daemon/sync/g1/").unwrap();
    match (method.as_str(), rest) {
        ("POST", "blobs/missing") => {
            let req: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let missing: Vec<_> = req["hashes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|h| !s.blobs.contains_key(h.as_str().unwrap()))
                .collect();
            reply(StatusCode::OK, serde_json::to_vec(&serde_json::json!({ "missing": missing })).unwrap())
        }
        ("PUT", r) => {
            s.blobs.insert(r.strip_prefix("blobs/").unwrap().into(), body.to_vec());
            reply(StatusCode::NO_CONTENT, vec![])
        }
        ("GET", "changes") => {
            let from: u64 = query.strip_prefix("from=").unwrap().parse().unwrap();
            let res = serde_json::json!({ "headVersion": s.head(), "entries": s.changes(from) });
            reply(StatusCode::OK, serde_json::to_vec(&res).unwrap())
        }
        ("GET", r) => match s.blobs.get(r.strip_prefix("blobs/").unwrap()) {
            Some(b) => reply(StatusCode::OK, b.clone()),
            None => reply(StatusCode::NOT_FOUND, br#"{"message":"no blob"}"#.to_vec()),
        },
        _ => unreachable!("{method} {path}"),
    }
}

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    home: tempfile::TempDir,
    store: Arc<Mutex<Store>>,
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
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        api: Some(Config {
            server: format!("http://127.0.0.1:{port}"),
            token: "mt_1".into(),
            machine_id: "m1".into(),
            owner_name: "王磊".into(),
            cert_sha256: None,
        }),
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, home, store }
}

fn git(dir: &Path, args: &[&str]) {
    assert!(Command::new("git").args(args).current_dir(dir).status().unwrap().success());
}

fn manifest(files: &[(&str, &str)]) -> Manifest {
    files.iter().map(|(p, b)| (p.to_string(), FileRef { hash: hash_bytes(b.as_bytes()), exec: false })).collect()
}

impl Rig {
    fn work(&self) -> PathBuf {
        self.home.path().join("workspaces/g1/b1/_empty")
    }

    fn read(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(self.work().join(path)).ok()
    }

    fn write(&self, path: &str, body: &str) {
        std::fs::write(self.work().join(path), body).unwrap();
    }

    /// The replica joined at v1 holding `files`, which the server has as v1.
    fn join(&self, files: &[(&str, &str)]) {
        std::fs::create_dir_all(self.work()).unwrap();
        git(&self.work(), &["init", "-q"]);
        for (p, b) in files {
            self.write(p, b);
        }
        let v = self.store.lock().unwrap().push(&files.iter().map(|(p, b)| (*p, Some(*b))).collect::<Vec<_>>());
        let replica = Replica::new(self.home.path(), "g1", "b1", self.work());
        replica.set_base(&Base { version: v, files: manifest(files) }).unwrap();
    }

    fn run(&self, run_id: &str, text: &str, sync: RunSyncStart) {
        let start = RunStart {
            run_id: run_id.into(),
            group_id: "g1".into(),
            group_name: "支付服务".into(),
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
            },
            workspace: WorkspaceSpec { repo: None, cd_path: None },
            resume_session_id: None,
            new_session_reason: None,
            mcp_servers: vec![],
            command: None,
            sync: Some(sync),
            prompt: RunPrompt {
                text: text.into(),
                triggered_by: "王磊".into(),
                context: vec![],
                omitted: 0,
                fallback_context: vec![],
                attachments: vec![],
                quote: None,
            },
        };
        self.engine.handle(ServerToDaemon::RunStart(Box::new(start)), &self.out);
    }

    fn send(&self, msg: ServerToDaemon) {
        self.engine.handle(msg, &self.out);
    }

    /// The next message other than streamed run events and session config.
    async fn next(&mut self) -> DaemonToServer {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv())
                .await
                .expect("engine went quiet")
                .unwrap();
            if !matches!(msg, DaemonToServer::RunEvent { .. } | DaemonToServer::SessionConfig { .. }) {
                return msg;
            }
        }
    }

    /// Nothing but streamed events arrives within `ms`.
    async fn quiet(&mut self, ms: u64) {
        let until = tokio::time::Instant::now() + Duration::from_millis(ms);
        while let Ok(Some(msg)) = tokio::time::timeout_at(until, self.rx.recv()).await {
            assert!(matches!(msg, DaemonToServer::RunEvent { .. } | DaemonToServer::SessionConfig { .. }), "{msg:?}");
        }
    }

    async fn submit(&mut self) -> SyncSubmit {
        match self.next().await {
            DaemonToServer::SyncSubmit(s) => s,
            other => panic!("expected sync.submit, got {other:?}"),
        }
    }

    fn answer(&self, s: &SyncSubmit, result: SyncSubmitResult) {
        self.send(ServerToDaemon::SyncResult {
            group_id: "g1".into(),
            bot_id: "b1".into(),
            submit_id: s.submit_id.clone(),
            result,
        });
    }

    async fn done(&mut self) -> RunDone {
        match self.next().await {
            DaemonToServer::RunDone(d) => d,
            other => panic!("expected run.done, got {other:?}"),
        }
    }

    /// The root hash of the work tree as the files are now.
    fn root(&self, files: &[(&str, &str)]) -> String {
        manifest_root(&manifest(files))
    }
}

fn at(head: u64, last: Option<u64>) -> RunSyncStart {
    RunSyncStart { head_version: head, last_version: last, changed: vec![], changed_total: 0 }
}

fn change(path: &str, body: Option<&str>, base: Option<&str>) -> SyncChange {
    SyncChange {
        path: path.into(),
        hash: body.map(|b| hash_bytes(b.as_bytes())),
        exec: false,
        base_hash: base.map(|b| hash_bytes(b.as_bytes())),
    }
}

fn applied(version: u64, root_hash: String) -> DaemonToServer {
    DaemonToServer::SyncApplied { group_id: "g1".into(), bot_id: "b1".into(), version, root_hash }
}

#[tokio::test]
async fn a_turn_s_edits_are_submitted_against_its_base_before_run_done() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n"), ("gone.txt", "g\n")]);
    r.run("r1", "mock:sh printf 'two\\n' > a.txt && printf 'n\\n' > new.txt && rm gone.txt", at(1, Some(1)));

    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind, s.merged), (Some("r1"), 1, SyncSubmitKind::Run, false));
    assert_eq!(
        s.changes,
        vec![
            change("a.txt", Some("two\n"), Some("one\n")),
            change("gone.txt", None, Some("g\n")),
            change("new.txt", Some("n\n"), None),
        ]
    );
    assert!(r.store.lock().unwrap().blobs.contains_key(&hash_bytes(b"n\n")), "new content uploaded first");
    // Another replica's version lands meanwhile: the server merges it in as v3.
    r.store.lock().unwrap().push(&[("other.txt", Some("o\n"))]);
    r.store.lock().unwrap().push(&[("a.txt", Some("two\n")), ("gone.txt", None), ("new.txt", Some("n\n"))]);
    r.answer(&s, SyncSubmitResult::Accepted { version: 3 });

    let files = [("a.txt", "two\n"), ("new.txt", "n\n"), ("other.txt", "o\n")];
    assert_eq!(r.next().await, applied(3, r.root(&files)));
    assert_eq!(r.read("other.txt").as_deref(), Some("o\n"));
    let done = r.done().await;
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert_eq!(done.sync, Some(RunSyncDone::Accepted { version: 3, merged: false }));
}

#[tokio::test]
async fn catches_up_before_the_turn_and_tells_the_agent_what_changed() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.store.lock().unwrap().push(&[("b.txt", Some("b\n"))]);
    let sync = RunSyncStart { head_version: 2, last_version: Some(1), changed: vec!["b.txt".into()], changed_total: 1 };
    r.run("r1", "mock:echo", sync);

    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "one\n"), ("b.txt", "b\n")])));
    let done = r.done().await;
    let echo: serde_json::Value = serde_json::from_str(&done.reply).unwrap();
    assert!(
        echo["prompt"]
            .as_str()
            .unwrap()
            .starts_with("强制同步：自你上次工作后权威版本 v1→v2，改动文件：b.txt（共 1 个）\n\n王磊 说：mock:echo"),
        "{}",
        echo["prompt"]
    );
    assert_eq!(done.sync, Some(RunSyncDone::Unchanged { version: 2 }));
}

#[tokio::test]
async fn a_conflict_that_merges_cleanly_is_resubmitted_on_top_of_the_head() {
    let mut r = rig().await;
    let base = "1\n2\n3\n4\n5\n";
    r.join(&[("a.txt", base)]);
    r.run("r1", "mock:sh printf '1 mine\\n2\\n3\\n4\\n5\\n' > a.txt", at(1, Some(1)));

    let s = r.submit().await;
    let theirs = "1\n2\n3\n4\n5 theirs\n";
    r.store.lock().unwrap().push(&[("a.txt", Some(theirs))]);
    let head = SyncEntry { path: "a.txt".into(), hash: Some(hash_bytes(theirs.as_bytes())), exec: false };
    r.answer(&s, SyncSubmitResult::Conflict { head_version: 2, conflicts: vec![head] });

    let merged = "1 mine\n2\n3\n4\n5 theirs\n";
    let again = r.submit().await;
    assert_eq!((again.base_version, again.merged), (1, true));
    assert_eq!(again.changes, vec![change("a.txt", Some(merged), Some(theirs))]);
    assert!(r.store.lock().unwrap().blobs.contains_key(&hash_bytes(merged.as_bytes())));
    r.store.lock().unwrap().push(&[("a.txt", Some(merged))]);
    r.answer(&again, SyncSubmitResult::Accepted { version: 3 });

    assert_eq!(r.next().await, applied(3, r.root(&[("a.txt", merged)])));
    assert_eq!(r.done().await.sync, Some(RunSyncDone::Accepted { version: 3, merged: true }));
    assert_eq!(r.read("a.txt").as_deref(), Some(merged));
}

#[tokio::test]
async fn an_overlapping_conflict_is_held_for_a_person_and_pauses_the_replica() {
    let mut r = rig().await;
    r.join(&[("a.txt", "1\n2\n")]);
    r.run("r1", "mock:sh printf 'mine\\n2\\n' > a.txt", at(1, Some(1)));

    let s = r.submit().await;
    r.store.lock().unwrap().push(&[("a.txt", Some("theirs\n2\n"))]);
    let head = SyncEntry { path: "a.txt".into(), hash: Some(hash_bytes(b"theirs\n2\n")), exec: false };
    r.answer(&s, SyncSubmitResult::Conflict { head_version: 2, conflicts: vec![head] });

    assert_eq!(
        r.next().await,
        DaemonToServer::SyncState {
            group_id: "g1".into(),
            bot_id: "b1".into(),
            state: SyncReplicaIssue::Held,
            files: vec!["a.txt".into()],
            total: 1,
            reason: None,
        }
    );
    assert_eq!(r.done().await.sync, Some(RunSyncDone::Held { files: 1 }));
    assert_eq!(r.read("a.txt").as_deref(), Some("mine\n2\n"), "the turn's edit stays for the decision");

    // Held: new versions are not applied, and the bot's next turn does not start.
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
    r.quiet(300).await;
    r.run("r2", "mock:echo", at(2, Some(1)));
    let done = r.done().await;
    assert_eq!(
        (done.outcome, done.error.as_deref()),
        (RunOutcome::Failed, Some("强制同步有冲突待处理，处理后才能继续运行"))
    );
}

#[tokio::test]
async fn an_idle_replica_applies_a_new_version_and_reports_its_root_hash() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.store.lock().unwrap().push(&[("a.txt", None), ("b/c.txt", Some("c\n"))]);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });

    assert_eq!(r.next().await, applied(2, r.root(&[("b/c.txt", "c\n")])));
    assert_eq!((r.read("a.txt"), r.read("b/c.txt").as_deref()), (None, Some("c\n")));
    // Other groups' versions are not this replica's.
    r.send(ServerToDaemon::SyncAvailable { group_id: "g2".into(), version: 9 });
    r.quiet(200).await;
}

#[tokio::test]
async fn a_version_arriving_during_a_turn_is_applied_only_after_it() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.run("r1", "mock:slow", at(1, Some(1)));
    loop {
        if let DaemonToServer::RunEvent { .. } = r.rx.recv().await.unwrap() {
            break;
        }
    }
    r.store.lock().unwrap().push(&[("b.txt", Some("b\n"))]);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
    r.quiet(300).await;
    assert_eq!(r.read("b.txt"), None, "not written under the running agent");

    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "one\n"), ("b.txt", "b\n")])));
    let done = r.done().await;
    assert_eq!(done.sync, Some(RunSyncDone::Unchanged { version: 1 }));
    r.quiet(300).await;
}

#[tokio::test]
async fn local_edits_found_before_a_turn_are_reported_and_the_turn_does_not_run() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.write("a.txt", "hand edit\n");
    r.run("r1", "mock:echo", at(1, Some(1)));

    assert_eq!(
        r.next().await,
        DaemonToServer::SyncState {
            group_id: "g1".into(),
            bot_id: "b1".into(),
            state: SyncReplicaIssue::Drift,
            files: vec!["a.txt".into()],
            total: 1,
            reason: None,
        }
    );
    let done = r.done().await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert_eq!(done.error.as_deref(), Some("工作区有未处理的本地改动（强制同步），处理后才能继续运行"));

    // Paused: a new version does not overwrite the edit (F12).
    r.store.lock().unwrap().push(&[("a.txt", Some("two\n"))]);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
    r.quiet(300).await;
    assert_eq!(r.read("a.txt").as_deref(), Some("hand edit\n"));
}

#[tokio::test]
async fn a_replica_that_has_not_joined_runs_without_sync() {
    let mut r = rig().await;
    r.run("r1", "mock:echo", at(0, None));
    let done = r.done().await;
    assert_eq!((done.outcome, done.sync), (RunOutcome::Completed, None));
}

// ── Mode switch (§3.5, S8) ───────────────────────────────────────────────────

fn init(role: SyncRole, force: bool) -> ServerToDaemon {
    ServerToDaemon::SyncInit { group_id: "g1".into(), bot_id: "b1".into(), role, force, repo_id: None }
}

fn dirty(files: &[&str]) -> DaemonToServer {
    DaemonToServer::SyncState {
        group_id: "g1".into(),
        bot_id: "b1".into(),
        state: SyncReplicaIssue::Dirty,
        files: files.iter().map(|f| f.to_string()).collect(),
        total: files.len() as u32,
        reason: None,
    }
}

impl Rig {
    /// A clone with `files` committed, not joined.
    fn clone_with(&self, files: &[(&str, &str)]) {
        std::fs::create_dir_all(self.work()).unwrap();
        git(&self.work(), &["init", "-q"]);
        for (p, b) in files {
            let path = self.work().join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b).unwrap();
        }
        git(&self.work(), &["add", "-A"]);
        git(&self.work(), &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    }

    fn replica(&self) -> Replica {
        Replica::new(self.home.path(), "g1", "b1", self.work())
    }

    fn backups(&self) -> Vec<PathBuf> {
        gonggong::workspace::backups(self.home.path()).into_iter().map(|b| b.path).collect()
    }
}

#[tokio::test]
async fn the_base_submits_its_whole_tree_with_uncommitted_changes_and_joins() {
    let mut r = rig().await;
    r.clone_with(&[(".gitignore", "node_modules/\n"), ("a.txt", "a\n"), ("src/b.txt", "b\n")]);
    r.write("a.txt", "wip\n");
    r.write("c.txt", "untracked\n");
    std::fs::create_dir_all(r.work().join("node_modules")).unwrap();
    r.write("node_modules/x.js", "ignored");
    r.send(init(SyncRole::Base, false));

    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind, s.merged), (None, 0, SyncSubmitKind::Init, false));
    assert_eq!(
        s.changes,
        vec![
            change(".gitignore", Some("node_modules/\n"), None),
            change("a.txt", Some("wip\n"), None),
            change("c.txt", Some("untracked\n"), None),
            change("src/b.txt", Some("b\n"), None),
        ]
    );
    assert!(r.store.lock().unwrap().blobs.contains_key(&hash_bytes(b"wip\n")));
    r.answer(&s, SyncSubmitResult::Accepted { version: 4 });
    let files = [(".gitignore", "node_modules/\n"), ("a.txt", "wip\n"), ("c.txt", "untracked\n"), ("src/b.txt", "b\n")];
    assert_eq!(r.next().await, applied(4, r.root(&files)));
    assert_eq!(r.replica().base().unwrap(), Base { version: 4, files: manifest(&files) });
    let crlf = Command::new("git").args(["config", "--local", "core.autocrlf"]).current_dir(r.work()).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&crlf.stdout).trim(), "false");
}

#[tokio::test]
async fn a_clean_replica_aligns_to_exactly_the_head_backing_up_what_it_overwrites() {
    let mut r = rig().await;
    r.store.lock().unwrap().push(&[("a.txt", Some("head\n")), ("new/x.txt", Some("x\n")), ("same.txt", Some("s\n"))]);
    r.clone_with(&[("a.txt", "mine\n"), ("old/o.txt", "o\n"), ("same.txt", "s\n")]);
    r.send(init(SyncRole::Align, false));

    let head = [("a.txt", "head\n"), ("new/x.txt", "x\n"), ("same.txt", "s\n")];
    assert_eq!(r.next().await, applied(1, r.root(&head)));
    assert_eq!((r.read("a.txt").as_deref(), r.read("new/x.txt").as_deref()), (Some("head\n"), Some("x\n")));
    assert!(!r.work().join("old").exists(), "files the head lacks are deleted");
    assert_eq!(r.replica().base().unwrap(), Base { version: 1, files: manifest(&head) });
    let backups = r.backups();
    assert_eq!(backups.len(), 1);
    assert_eq!(std::fs::read_to_string(backups[0].join("a.txt")).unwrap(), "mine\n");
    assert_eq!(std::fs::read_to_string(backups[0].join("old/o.txt")).unwrap(), "o\n");
    assert!(!backups[0].join("same.txt").exists());

    // Sent again (a reconnect): nothing to lose, nothing backed up again.
    r.send(init(SyncRole::Align, false));
    assert_eq!(r.next().await, applied(1, r.root(&head)));
    assert_eq!(r.backups().len(), 1);
}

#[tokio::test]
async fn uncommitted_changes_leave_a_replica_out_unless_it_joins_discarding_them() {
    let mut r = rig().await;
    r.store.lock().unwrap().push(&[("a.txt", Some("head\n"))]);
    r.clone_with(&[("a.txt", "mine\n")]);
    r.write("a.txt", "wip\n");
    r.write("note.txt", "n\n");
    r.send(init(SyncRole::Align, false));

    assert_eq!(r.next().await, dirty(&["a.txt", "note.txt"]));
    assert!(!r.replica().joined());
    assert_eq!(r.read("a.txt").as_deref(), Some("wip\n"));
    assert!(r.backups().is_empty());

    r.send(init(SyncRole::Align, true));
    assert_eq!(r.next().await, applied(1, r.root(&[("a.txt", "head\n")])));
    assert_eq!((r.read("a.txt").as_deref(), r.read("note.txt")), (Some("head\n"), None));
    let backups = r.backups();
    assert_eq!(std::fs::read_to_string(backups[0].join("a.txt")).unwrap(), "wip\n");
    assert_eq!(std::fs::read_to_string(backups[0].join("note.txt")).unwrap(), "n\n");
}

#[tokio::test]
async fn leaving_forgets_the_sync_state_and_keeps_the_files() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.send(init(SyncRole::Leave, false));
    r.quiet(300).await;
    assert!(!r.home.path().join("sync/g1").exists());
    assert_eq!(r.read("a.txt").as_deref(), Some("one\n"));
    // No longer joined: a new version is not applied.
    r.store.lock().unwrap().push(&[("a.txt", Some("two\n"))]);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
    r.quiet(300).await;
    assert_eq!(r.read("a.txt").as_deref(), Some("one\n"));
}
