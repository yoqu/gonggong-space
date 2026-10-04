//! A force-group turn (S4) against the mock ACP agent and a stand-in server: catch up before the turn, submit after
//! it (merging conflicts), idle replicas catching up on sync.available, and the mode switch's sync.init (S8).
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use gonggong::sync::{Base, FileRef, Manifest, Pending, Replica, hash_bytes, manifest_root};
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
    RunSyncStart { head_version: head, last_version: last, changed: vec![], changed_total: 0, resolve: None }
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
    let sync = RunSyncStart {
        head_version: 2,
        last_version: Some(1),
        changed: vec!["b.txt".into()],
        changed_total: 1,
        resolve: None,
    };
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
        (done.outcome, done.sync),
        (RunOutcome::Failed, Some(RunSyncDone::Waiting { issue: SyncWaitIssue::Held }))
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
    assert_eq!(done.sync, Some(RunSyncDone::Waiting { issue: SyncWaitIssue::Drift }), "queued again, not failed");

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

// ── Settling a paused replica (F11, F12, S5, S6) ─────────────────────────────

fn action(action: SyncActionKind) -> ServerToDaemon {
    ServerToDaemon::SyncAction { group_id: "g1".into(), bot_id: "b1".into(), action }
}

fn state(state: SyncReplicaIssue, files: &[&str]) -> DaemonToServer {
    DaemonToServer::SyncState {
        group_id: "g1".into(),
        bot_id: "b1".into(),
        state,
        files: files.iter().map(|f| f.to_string()).collect(),
        total: files.len() as u32,
        reason: None,
    }
}

fn head(path: &str, body: Option<&str>) -> SyncEntry {
    SyncEntry { path: path.into(), hash: body.map(|b| hash_bytes(b.as_bytes())), exec: false }
}

impl Rig {
    /// Joined at v1 with `files`, then `edits` by hand: the next sync.available finds the drift.
    async fn drifted(&mut self, files: &[(&str, &str)], edits: &[(&str, &str)]) {
        self.join(files);
        for (p, b) in edits {
            self.write(p, b);
        }
        self.store.lock().unwrap().push(&[("other.txt", Some("o\n"))]);
        self.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
        let paths: Vec<_> = edits.iter().map(|(p, _)| *p).collect();
        assert_eq!(self.next().await, state(SyncReplicaIssue::Drift, &paths));
    }

    /// A turn's edits of `a.txt` and `b.txt` against v1 held after both conflicted with v2.
    async fn held(&mut self) {
        self.join(&[("a.txt", "1\n2\n"), ("b.txt", "b\n")]);
        self.run("r1", "mock:sh printf 'mine\\n2\\n' > a.txt && printf 'b mine\\n' > b.txt", at(1, Some(1)));
        let s = self.submit().await;
        self.store.lock().unwrap().push(&[("a.txt", Some("theirs\n2\n")), ("b.txt", Some("b theirs\n"))]);
        let conflicts = vec![head("a.txt", Some("theirs\n2\n")), head("b.txt", Some("b theirs\n"))];
        self.answer(&s, SyncSubmitResult::Conflict { head_version: 2, conflicts });
        assert_eq!(self.next().await, state(SyncReplicaIssue::Held, &["a.txt", "b.txt"]));
        assert_eq!(self.done().await.sync, Some(RunSyncDone::Held { files: 2 }));
    }
}

#[tokio::test]
async fn submitting_local_edits_makes_them_a_local_version_and_catches_up() {
    let mut r = rig().await;
    r.drifted(&[("a.txt", "one\n")], &[("a.txt", "hand\n")]).await;
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Submit }));

    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind), (None, 1, SyncSubmitKind::Local));
    assert_eq!(s.changes, vec![change("a.txt", Some("hand\n"), Some("one\n"))]);
    r.store.lock().unwrap().push(&[("a.txt", Some("hand\n"))]);
    r.answer(&s, SyncSubmitResult::Accepted { version: 3 });
    assert_eq!(r.next().await, applied(3, r.root(&[("a.txt", "hand\n"), ("other.txt", "o\n")])));
    assert_eq!(r.replica().issue().unwrap(), None);
}

#[tokio::test]
async fn submitted_local_edits_that_overlap_the_head_are_held() {
    let mut r = rig().await;
    r.drifted(&[("a.txt", "1\n2\n")], &[("a.txt", "hand\n2\n")]).await;
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Submit }));
    let s = r.submit().await;
    r.store.lock().unwrap().push(&[("a.txt", Some("theirs\n2\n"))]);
    r.answer(&s, SyncSubmitResult::Conflict { head_version: 3, conflicts: vec![head("a.txt", Some("theirs\n2\n"))] });
    assert_eq!(r.next().await, state(SyncReplicaIssue::Held, &["a.txt"]));
    assert_eq!(r.replica().issue().unwrap(), Some(SyncReplicaIssue::Held));
    assert_eq!(r.read("a.txt").as_deref(), Some("hand\n2\n"));
}

#[tokio::test]
async fn discarding_local_edits_backs_them_up_and_makes_the_tree_the_head() {
    let mut r = rig().await;
    r.drifted(&[("a.txt", "one\n")], &[("a.txt", "hand\n"), ("note.txt", "n\n")]).await;
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Discard }));

    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "one\n"), ("other.txt", "o\n")])));
    assert_eq!((r.read("a.txt").as_deref(), r.read("note.txt")), (Some("one\n"), None));
    let backups = r.backups();
    assert_eq!(backups.len(), 1);
    assert_eq!(std::fs::read_to_string(backups[0].join("a.txt")).unwrap(), "hand\n");
    assert_eq!(std::fs::read_to_string(backups[0].join("note.txt")).unwrap(), "n\n");
    assert_eq!(r.replica().issue().unwrap(), None);
}

#[tokio::test]
async fn keep_mine_and_take_theirs_are_resubmitted_at_once_on_top_of_the_head() {
    let mut r = rig().await;
    r.held().await;
    let decisions = vec![
        SyncDecision { path: "a.txt".into(), choice: SyncChoice::Mine },
        SyncDecision { path: "b.txt".into(), choice: SyncChoice::Theirs },
    ];
    r.send(action(SyncActionKind::Conflict { decisions }));

    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind), (None, 1, SyncSubmitKind::Merge));
    assert_eq!(
        s.changes,
        vec![
            change("a.txt", Some("mine\n2\n"), Some("theirs\n2\n")),
            change("b.txt", Some("b theirs\n"), Some("b theirs\n")),
        ]
    );
    assert_eq!(r.read("b.txt").as_deref(), Some("b theirs\n"));
    r.store.lock().unwrap().push(&[("a.txt", Some("mine\n2\n"))]);
    r.answer(&s, SyncSubmitResult::Accepted { version: 3 });
    assert_eq!(r.next().await, applied(3, r.root(&[("a.txt", "mine\n2\n"), ("b.txt", "b theirs\n")])));
    assert_eq!(r.replica().issue().unwrap(), None);
    assert_eq!(r.replica().held().unwrap(), None);
}

#[tokio::test]
async fn a_bot_merge_turn_gets_the_conflict_markers_and_submits_its_resolution_as_a_merge() {
    let mut r = rig().await;
    r.held().await;
    let mut sync = at(2, Some(1));
    sync.resolve = Some(vec![
        SyncDecision { path: "a.txt".into(), choice: SyncChoice::Bot },
        SyncDecision { path: "b.txt".into(), choice: SyncChoice::Mine },
    ]);
    r.run(
        "r2",
        "mock:sh grep -q '<<<<<<< mine' a.txt && grep -q '>>>>>>> theirs' a.txt && printf 'both\\n2\\n' > a.txt",
        sync,
    );

    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.kind), (Some("r2"), SyncSubmitKind::Merge));
    assert_eq!(
        s.changes,
        vec![
            change("a.txt", Some("both\n2\n"), Some("theirs\n2\n")),
            change("b.txt", Some("b mine\n"), Some("b theirs\n"))
        ]
    );
    r.store.lock().unwrap().push(&[("a.txt", Some("both\n2\n")), ("b.txt", Some("b mine\n"))]);
    r.answer(&s, SyncSubmitResult::Accepted { version: 3 });
    assert_eq!(r.next().await, applied(3, r.root(&[("a.txt", "both\n2\n"), ("b.txt", "b mine\n")])));
    assert_eq!(r.done().await.sync, Some(RunSyncDone::Accepted { version: 3, merged: false }));
    assert_eq!(r.replica().issue().unwrap(), None);
}

#[tokio::test]
async fn discarding_a_held_change_backs_it_up_and_makes_the_tree_the_head() {
    let mut r = rig().await;
    r.held().await;
    r.send(action(SyncActionKind::Discard));
    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "theirs\n2\n"), ("b.txt", "b theirs\n")])));
    let backups = r.backups();
    assert_eq!(std::fs::read_to_string(backups[0].join("a.txt")).unwrap(), "mine\n2\n");
    assert_eq!((r.replica().issue().unwrap(), r.replica().held().unwrap()), (None, None));
}

// ── Interrupts and disconnects (F21, S7) ─────────────────────────────────────

impl Rig {
    /// Waits for the running turn's first streamed event.
    async fn streaming(&mut self) {
        loop {
            if let DaemonToServer::RunEvent { .. } = self.rx.recv().await.unwrap() {
                return;
            }
        }
    }

    /// Joined at v1 with a.txt; a turn edits it to `two` and is stopped. v2 (other.txt) came out meanwhile.
    async fn stopped(&mut self) {
        self.join(&[("a.txt", "one\n")]);
        self.run("r1", "mock:slow", at(1, Some(1)));
        self.streaming().await;
        self.write("a.txt", "two\n");
        self.store.lock().unwrap().push(&[("other.txt", Some("o\n"))]);
        self.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
        let done = self.done().await;
        assert_eq!((done.outcome, done.sync), (RunOutcome::Interrupted, Some(RunSyncDone::Stopped { files: 1 })));
    }
}

#[tokio::test]
async fn a_stopped_turn_submits_nothing_and_its_replica_waits_for_keep_or_discard() {
    let mut r = rig().await;
    r.stopped().await;
    assert_eq!(r.read("a.txt").as_deref(), Some("two\n"));
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 2 });
    r.quiet(300).await;
    assert_eq!(r.read("other.txt"), None, "paused until decided");
    r.run("r2", "mock:echo", at(2, Some(1)));
    assert_eq!(r.done().await.sync, Some(RunSyncDone::Waiting { issue: SyncWaitIssue::Drift }));

    // 保留: the changes go in as the stopped run's, tagged interrupted.
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Submit }));
    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind), (Some("r1"), 1, SyncSubmitKind::Interrupted));
    assert_eq!(s.changes, vec![change("a.txt", Some("two\n"), Some("one\n"))]);
    r.store.lock().unwrap().push(&[("a.txt", Some("two\n"))]);
    r.answer(&s, SyncSubmitResult::Accepted { version: 3 });
    assert_eq!(r.next().await, applied(3, r.root(&[("a.txt", "two\n"), ("other.txt", "o\n")])));
    assert_eq!((r.replica().issue().unwrap(), r.replica().stopped().unwrap()), (None, None));
}

#[tokio::test]
async fn discarding_a_stopped_turn_backs_its_changes_up_and_rolls_back_to_the_head() {
    let mut r = rig().await;
    r.stopped().await;
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Discard }));
    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "one\n"), ("other.txt", "o\n")])));
    assert_eq!(r.read("a.txt").as_deref(), Some("one\n"));
    assert_eq!(std::fs::read_to_string(r.backups()[0].join("a.txt")).unwrap(), "two\n");
    assert_eq!((r.replica().issue().unwrap(), r.replica().stopped().unwrap()), (None, None));
}

#[tokio::test]
async fn after_discarding_a_stopped_turn_the_next_turn_submits_only_its_own_changes() {
    let mut r = rig().await;
    r.stopped().await;
    // From the run card or the sync panel alike: the same sync.action.
    r.send(action(SyncActionKind::Drift { choice: DriftChoice::Discard }));
    assert_eq!(r.next().await, applied(2, r.root(&[("a.txt", "one\n"), ("other.txt", "o\n")])));
    assert_eq!(r.replica().stopped().unwrap(), None);

    r.run("r2", "mock:sh printf 'n\\n' > new.txt", at(2, Some(2)));
    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.base_version, s.kind), (Some("r2"), 2, SyncSubmitKind::Run));
    assert_eq!(s.changes, vec![change("new.txt", Some("n\n"), None)]);
}

#[tokio::test]
async fn a_failed_turn_submits_nothing_and_reports_its_changes_as_local_edits() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.run("r1", "mock:sh printf 'two\\n' > a.txt && exit 1", at(1, Some(1)));
    assert_eq!(r.next().await, state(SyncReplicaIssue::Drift, &["a.txt"]));
    let done = r.done().await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert_eq!(done.sync, Some(RunSyncDone::Error { reason: "本轮异常结束，改动未提交，待 Bot 主人处理".into() }));
    assert_eq!(r.replica().issue().unwrap(), Some(SyncReplicaIssue::Drift));
    assert_eq!(r.read("a.txt").as_deref(), Some("two\n"));
}

#[tokio::test]
async fn a_pending_submit_is_resent_with_its_id_and_an_accepted_one_becomes_the_base() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    // The daemon went away after submitting; the server took it as v2 and its answer was lost.
    r.write("a.txt", "two\n");
    let submit = SyncSubmit {
        group_id: "g1".into(),
        bot_id: "b1".into(),
        submit_id: "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f".into(),
        run_id: Some("r1".into()),
        base_version: 1,
        kind: SyncSubmitKind::Run,
        merged: false,
        changes: vec![change("a.txt", Some("two\n"), Some("one\n"))],
    };
    let pending = Pending { submit: submit.clone(), files: manifest(&[("a.txt", "two\n")]) };
    r.replica().set_pending(Some(&pending)).unwrap();
    r.replica().set_issue(Some(SyncReplicaIssue::Error)).unwrap();
    r.store.lock().unwrap().push(&[("a.txt", Some("two\n"))]);
    r.store.lock().unwrap().push(&[("b.txt", Some("b\n"))]);

    // A reconnect brings sync.available.
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 3 });
    assert_eq!(r.submit().await, submit);
    r.answer(&submit, SyncSubmitResult::Accepted { version: 2 });
    let files = [("a.txt", "two\n"), ("b.txt", "b\n")];
    assert_eq!(r.next().await, applied(3, r.root(&files)));
    assert_eq!(r.replica().base().unwrap(), Base { version: 3, files: manifest(&files) });
    assert_eq!((r.replica().issue().unwrap(), r.replica().pending().unwrap()), (None, None));
}

#[tokio::test]
async fn a_stopped_merge_turn_leaves_the_conflict_held_without_markers() {
    let mut r = rig().await;
    r.held().await;
    let mut sync = at(2, Some(1));
    sync.resolve = Some(vec![
        SyncDecision { path: "a.txt".into(), choice: SyncChoice::Bot },
        SyncDecision { path: "b.txt".into(), choice: SyncChoice::Theirs },
    ]);
    r.run("r2", "mock:slow", sync);
    r.streaming().await;
    assert!(r.read("a.txt").unwrap().contains("<<<<<<< mine"));
    r.send(ServerToDaemon::RunCancel { run_id: "r2".into() });
    // Nothing is submitted or reported: the conflict stays as it was.
    let done = r.done().await;
    assert_eq!((done.outcome, done.sync), (RunOutcome::Interrupted, Some(RunSyncDone::Held { files: 2 })));
    assert_eq!((r.read("a.txt").as_deref(), r.read("b.txt").as_deref()), (Some("mine\n2\n"), Some("b mine\n")));
    assert_eq!(r.replica().issue().unwrap(), Some(SyncReplicaIssue::Held));
    assert!(!r.replica().held().unwrap().unwrap().merging);
}

#[tokio::test]
async fn a_stopped_merge_turn_also_restores_the_files_it_changed_outside_the_conflict() {
    let mut r = rig().await;
    r.join(&[("a.txt", "1\n2\n"), ("c.txt", "c\n")]);
    r.run("r1", "mock:sh printf 'mine\\n2\\n' > a.txt && printf 'c mine\\n' > c.txt", at(1, Some(1)));
    let s = r.submit().await;
    r.store.lock().unwrap().push(&[("a.txt", Some("theirs\n2\n"))]);
    r.answer(&s, SyncSubmitResult::Conflict { head_version: 2, conflicts: vec![head("a.txt", Some("theirs\n2\n"))] });
    assert_eq!(r.next().await, state(SyncReplicaIssue::Held, &["a.txt"]));
    assert_eq!(r.done().await.sync, Some(RunSyncDone::Held { files: 1 }));

    let mut sync = at(2, Some(1));
    sync.resolve = Some(vec![SyncDecision { path: "a.txt".into(), choice: SyncChoice::Bot }]);
    r.run("r2", "mock:slow", sync);
    r.streaming().await;
    // Besides the markers, the agent edits a file of the held change and adds one.
    r.write("c.txt", "agent\n");
    r.write("stray.txt", "stray\n");
    r.send(ServerToDaemon::RunCancel { run_id: "r2".into() });
    let done = r.done().await;
    assert_eq!((done.outcome, done.sync), (RunOutcome::Interrupted, Some(RunSyncDone::Held { files: 1 })));
    assert_eq!(r.read("a.txt").as_deref(), Some("mine\n2\n"));
    assert_eq!((r.read("c.txt").as_deref(), r.read("stray.txt")), (Some("c mine\n"), None));
    let backups = r.backups();
    assert_eq!(std::fs::read_to_string(backups[0].join("c.txt")).unwrap(), "agent\n");
    assert_eq!(std::fs::read_to_string(backups[0].join("stray.txt")).unwrap(), "stray\n");
}

#[tokio::test]
async fn letting_the_bot_merge_again_starts_from_the_held_side_not_leftover_markers() {
    let mut r = rig().await;
    r.held().await;
    let resolve = Some(vec![
        SyncDecision { path: "a.txt".into(), choice: SyncChoice::Bot },
        SyncDecision { path: "b.txt".into(), choice: SyncChoice::Mine },
    ]);
    let mut sync = at(2, Some(1));
    sync.resolve = resolve.clone();
    r.run("r2", "mock:sh printf '<<<<<<< half done\\n' > a.txt && exit 1", sync);
    let done = r.done().await;
    assert_eq!((done.outcome, done.sync), (RunOutcome::Failed, Some(RunSyncDone::Held { files: 2 })));
    assert_eq!(r.read("a.txt").as_deref(), Some("mine\n2\n"));

    // Markers left in the tree (an older daemon) are not merged again.
    r.write("a.txt", "<<<<<<< mine\nmine\n=======\ntheirs\n>>>>>>> theirs\n2\n");
    let mut sync = at(2, Some(1));
    sync.resolve = resolve;
    r.run(
        "r3",
        "mock:sh test $(grep -c '<<<<<<<' a.txt) -eq 1 && grep -qx mine a.txt && printf 'both\\n2\\n' > a.txt",
        sync,
    );
    let s = r.submit().await;
    assert_eq!((s.run_id.as_deref(), s.kind), (Some("r3"), SyncSubmitKind::Merge));
    assert_eq!(s.changes[0], change("a.txt", Some("both\n2\n"), Some("theirs\n2\n")));
}

#[tokio::test]
async fn after_a_reconnect_a_replica_at_the_head_says_where_it_is_once() {
    let mut r = rig().await;
    r.join(&[("a.txt", "one\n")]);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 1 });
    r.quiet(300).await;
    // The server may have missed a report (a catch-up that kept failing after a decision): its issue clears.
    r.engine.connected(false);
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 1 });
    assert_eq!(r.next().await, applied(1, r.root(&[("a.txt", "one\n")])));
    r.send(ServerToDaemon::SyncAvailable { group_id: "g1".into(), version: 1 });
    r.quiet(300).await;
}
