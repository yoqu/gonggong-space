//! Managed clones and /cd validation against local bare repos, driven through the Engine like the server does.
use gonggong::engine::{Engine, EngineConfig};
use gonggong::git;
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use gonggong::workspace::managed_path;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@gonggong", "-c", "init.defaultBranch=main"])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A bare repo with one commit on main plus a seed clone to push more commits from.
struct Remote {
    root: tempfile::TempDir,
}

impl Remote {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        git(root.path(), &["init", "-q", "--bare", "-b", "main", "remote.git"]);
        git(root.path(), &["clone", "-q", "remote.git", "seed"]);
        let r = Remote { root };
        r.commit("README.md", "# demo\n");
        r
    }
    fn bare(&self) -> PathBuf {
        self.root.path().join("remote.git")
    }
    fn url(&self) -> String {
        format!("file://{}", self.bare().display())
    }
    fn spec(&self, id: &str) -> RepoSpec {
        RepoSpec { id: id.into(), url: self.url(), branch: "main".into(), protocol: GitProtocol::Auto }
    }
    fn commit(&self, file: &str, content: &str) {
        let seed = self.root.path().join("seed");
        std::fs::write(seed.join(file), content).unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "-qm", file]);
        git(&seed, &["push", "-q", "origin", "main"]);
    }
    /// A plain-path clone, as a developer would have it locally.
    fn clone_to(&self, name: &str) -> PathBuf {
        git(self.root.path(), &["clone", "-q", &self.bare().to_string_lossy(), name]);
        self.root.path().join(name)
    }
}

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    home: tempfile::TempDir,
}

fn rig() -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        api: None,
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, home }
}

impl Rig {
    fn ensure(&self, id: &str, repo: Option<RepoSpec>) {
        let msg = WorkspaceEnsure { request_id: id.into(), group_id: "g1".into(), bot_id: "b1".into(), repo };
        self.engine.handle(ServerToDaemon::WorkspaceEnsure(msg), &self.out);
    }

    fn cd(&self, id: &str, repo: Option<RepoSpec>, path: Option<&Path>) {
        self.cd_with(id, repo, path, false);
    }

    fn cd_with(&self, id: &str, repo: Option<RepoSpec>, path: Option<&Path>, force: bool) {
        let msg = WorkspaceCd {
            request_id: id.into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            repo,
            path: path.map(|p| p.to_string_lossy().into_owned()),
            force,
        };
        self.engine.handle(ServerToDaemon::WorkspaceCd(msg), &self.out);
    }

    async fn state(&mut self) -> WorkspaceState {
        match tokio::time::timeout(Duration::from_secs(30), self.rx.recv()).await.expect("quiet").unwrap() {
            DaemonToServer::WorkspaceState(s) => s,
            other => panic!("unexpected {other:?}"),
        }
    }

    /// Final (non-cloning) state of request `id`, and whether a cloning state came first.
    async fn settled(&mut self, id: &str) -> (WorkspaceState, bool) {
        let mut cloned = false;
        loop {
            let s = self.state().await;
            assert_eq!(s.request_id.as_deref(), Some(id));
            if s.state == WorkspaceStateKind::Cloning {
                cloned = true;
                continue;
            }
            return (s, cloned);
        }
    }

    fn managed(&self, repo_id: Option<&str>) -> PathBuf {
        managed_path(self.home.path(), "g1", "b1", repo_id)
    }
}

fn clean(branch: &str, workspace: WorkspaceKind) -> GitStatus {
    GitStatus { branch: Some(branch.into()), ahead: Some(0), behind: Some(0), dirty: false, workspace }
}

#[test]
fn managed_paths_are_isolated_per_group_bot_and_repo() {
    let h = Path::new("/h");
    assert_eq!(managed_path(h, "g", "b", Some("r")), Path::new("/h/workspaces/g/b/r"));
    assert_eq!(managed_path(h, "g", "b", None), Path::new("/h/workspaces/g/b/_empty"));
    assert_ne!(managed_path(h, "g2", "b", Some("r")), managed_path(h, "g", "b", Some("r")));
}

#[tokio::test]
async fn ensure_clones_once_with_autocrlf_off_and_reports_git_status() {
    let remote = Remote::new();
    let mut r = rig();
    r.ensure("e1", Some(remote.spec("rp")));
    let (s, cloned) = r.settled("e1").await;
    assert!(cloned);
    assert_eq!(s.state, WorkspaceStateKind::Ready, "{:?}", s.error);
    let dir = r.managed(Some("rp"));
    assert_eq!(s.path.as_deref(), Some(&*dir.to_string_lossy()));
    assert_eq!(s.git, Some(clean("main", WorkspaceKind::Managed)));
    assert!(dir.join("README.md").is_file());
    assert_eq!(git(&dir, &["config", "--local", "core.autocrlf"]), "false");

    std::fs::write(dir.join("keep.txt"), "x").unwrap();
    r.ensure("e2", Some(remote.spec("rp")));
    let (s, cloned) = r.settled("e2").await;
    assert!(!cloned, "an existing clone is reused");
    assert_eq!(s.state, WorkspaceStateKind::Ready);
    assert!(s.git.unwrap().dirty);
    assert!(dir.join("keep.txt").is_file());
}

#[tokio::test]
async fn ensure_replaces_a_broken_leftover_and_reports_clone_failures() {
    let remote = Remote::new();
    let mut r = rig();
    let dir = r.managed(Some("rp"));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("junk"), "x").unwrap();
    r.ensure("e1", Some(remote.spec("rp")));
    let (s, _) = r.settled("e1").await;
    assert_eq!(s.state, WorkspaceStateKind::Ready, "{:?}", s.error);
    assert!(dir.join("README.md").is_file() && !dir.join("junk").exists());

    let missing = RepoSpec {
        id: "bad".into(),
        url: "file:///nonexistent/gonggong.git".into(),
        branch: "main".into(),
        protocol: GitProtocol::Auto,
    };
    r.ensure("e2", Some(missing));
    let (s, cloned) = r.settled("e2").await;
    assert!(cloned);
    assert_eq!(s.state, WorkspaceStateKind::Failed);
    assert!(s.error.unwrap().starts_with("clone 失败："));
    assert_eq!(s.reason, Some(RepoAccessReason::Denied));
    assert!(!r.managed(Some("bad")).exists());

    let mut wrong = remote.spec("rp2");
    wrong.branch = "nope".into();
    r.ensure("e3", Some(wrong));
    let (s, _) = r.settled("e3").await;
    assert_eq!((s.state, s.reason), (WorkspaceStateKind::Failed, Some(RepoAccessReason::BranchMissing)));
}

#[tokio::test]
async fn ensure_without_repo_creates_the_empty_workspace() {
    let mut r = rig();
    r.ensure("e1", None);
    let (s, cloned) = r.settled("e1").await;
    assert!(!cloned);
    assert_eq!(s.state, WorkspaceStateKind::Ready);
    assert_eq!(s.git, None);
    assert!(r.managed(None).is_dir());
}

#[tokio::test]
async fn cd_validates_directory_repo_and_remote() {
    let remote = Remote::new();
    let foreign = Remote::new();
    let mut r = rig();
    let plain = tempfile::tempdir().unwrap();
    let cases: [(PathBuf, String); 4] = [
        (plain.path().join("missing"), "目录不存在".into()),
        (PathBuf::from("relative/dir"), "需要本机绝对路径".into()),
        (plain.path().to_path_buf(), "不是 git 仓库".into()),
        (foreign.clone_to("other"), format!("remote 与群仓库不一致（{}）", foreign.bare().display())),
    ];
    for (i, (path, error)) in cases.iter().enumerate() {
        let id = format!("c{i}");
        r.cd(&id, Some(remote.spec("rp")), Some(path));
        let (s, _) = r.settled(&id).await;
        assert_eq!((s.state, s.error.as_deref()), (WorkspaceStateKind::Failed, Some(error.as_str())), "{path:?}");
    }

    let local = remote.clone_to("local");
    r.cd("ok", Some(remote.spec("rp")), Some(&local));
    let (s, _) = r.settled("ok").await;
    assert_eq!(s.state, WorkspaceStateKind::Ready, "{:?}", s.error);
    assert_eq!(s.path.as_deref(), Some(&*local.to_string_lossy()));
    assert_eq!(s.git, Some(clean("main", WorkspaceKind::Cd)));
    assert_eq!(s.remotes, [remote.bare().to_string_lossy()]);

    r.cd("back", Some(remote.spec("rp")), None);
    let (s, _) = r.settled("back").await;
    assert_eq!(s.state, WorkspaceStateKind::Ready);
    assert_eq!(s.path.as_deref(), Some(&*r.managed(Some("rp")).to_string_lossy()));
    assert_eq!(s.git.unwrap().workspace, WorkspaceKind::Managed);
    assert!(s.remotes.is_empty());
}

#[tokio::test]
async fn forced_cd_skips_only_the_group_repo_check() {
    let remote = Remote::new();
    let foreign = Remote::new();
    let mut r = rig();
    let other = foreign.clone_to("other");
    r.cd_with("f1", Some(remote.spec("rp")), Some(&other), true);
    let (s, _) = r.settled("f1").await;
    assert_eq!(s.state, WorkspaceStateKind::Ready, "{:?}", s.error);
    assert_eq!(s.git, Some(clean("main", WorkspaceKind::Cd)));

    let plain = tempfile::tempdir().unwrap();
    r.cd_with("f2", Some(remote.spec("rp")), Some(plain.path()), true);
    let (s, _) = r.settled("f2").await;
    assert_eq!((s.state, s.git), (WorkspaceStateKind::Ready, None), "{:?}", s.error);

    r.cd_with("f3", Some(remote.spec("rp")), Some(&plain.path().join("missing")), true);
    let (s, _) = r.settled("f3").await;
    assert_eq!((s.state, s.error.as_deref()), (WorkspaceStateKind::Failed, Some("目录不存在")));
}

#[tokio::test]
async fn cd_without_group_repo_accepts_any_usable_directory() {
    let remote = Remote::new();
    let mut r = rig();
    let plain = tempfile::tempdir().unwrap();
    r.cd("plain", None, Some(plain.path()));
    let (s, _) = r.settled("plain").await;
    assert_eq!((s.state, s.git), (WorkspaceStateKind::Ready, None), "{:?}", s.error);

    let foreign = remote.clone_to("any");
    r.cd("repo", None, Some(&foreign));
    let (s, _) = r.settled("repo").await;
    assert_eq!(s.git, Some(clean("main", WorkspaceKind::Cd)));

    let home = gonggong::config::user_home();
    for (i, path) in [PathBuf::from("/"), home].iter().enumerate() {
        let id = format!("bad{i}");
        r.cd(&id, None, Some(path));
        let (s, _) = r.settled(&id).await;
        assert_eq!(s.state, WorkspaceStateKind::Failed, "{path:?}");
        assert!(s.error.unwrap().contains("范围过大"), "{path:?}");
    }
}

#[tokio::test]
async fn dir_list_shows_subdirectories_with_git_info() {
    let remote = Remote::new();
    let mut r = rig();
    let root = remote.root.path();
    std::fs::create_dir(root.join(".hidden")).unwrap();
    std::fs::write(root.join("file.txt"), "x").unwrap();
    let list = |r: &Rig, id: &str, path: Option<&Path>| {
        let msg = ServerToDaemon::DirList { request_id: id.into(), path: path.map(|p| p.to_string_lossy().into()) };
        r.engine.handle(msg, &r.out);
    };
    list(&r, "d1", Some(root));
    let d = dir_result(&mut r.rx).await;
    assert_eq!(d.request_id, "d1");
    let names: Vec<_> = d.entries.iter().map(|e| (e.name.as_str(), e.git)).collect();
    assert_eq!(names, [("remote.git", false), ("seed", true)]);
    assert_eq!((d.git, d.unusable, d.error), (None, None, None));

    let seed = root.join("seed");
    list(&r, "d2", Some(&seed));
    let d = dir_result(&mut r.rx).await;
    let g = d.git.unwrap();
    assert_eq!((g.branch.as_deref(), g.remotes.len()), (Some("main"), 1));
    assert_eq!(Path::new(&g.root).canonicalize().unwrap(), seed.canonicalize().unwrap());

    list(&r, "d3", None);
    let d = dir_result(&mut r.rx).await;
    assert_eq!(PathBuf::from(&d.path), gonggong::config::user_home());
    assert!(d.unusable.is_some());

    list(&r, "d4", Some(&root.join("missing")));
    assert_eq!(dir_result(&mut r.rx).await.error.as_deref(), Some("目录不存在"));
}

#[tokio::test]
async fn git_status_tracks_ahead_behind_dirty_and_missing_upstream() {
    let remote = Remote::new();
    let dir = remote.clone_to("work");
    git(&dir, &["commit", "-q", "--allow-empty", "-m", "local", "--author", "t <t@gonggong>"]);
    remote.commit("b.txt", "b");
    remote.commit("c.txt", "c");
    git(&dir, &["fetch", "-q"]);
    std::fs::write(dir.join("new.txt"), "x").unwrap();
    let s = git::status(&dir, WorkspaceKind::Managed).await.unwrap();
    assert_eq!(
        s,
        GitStatus {
            branch: Some("main".into()),
            ahead: Some(1),
            behind: Some(2),
            dirty: true,
            workspace: WorkspaceKind::Managed
        }
    );

    git(&dir, &["checkout", "-q", "-b", "feat/x"]);
    let s = git::status(&dir, WorkspaceKind::Cd).await.unwrap();
    assert_eq!((s.branch.as_deref(), s.ahead, s.behind), (Some("feat/x"), None, None));
}

#[tokio::test]
async fn runs_use_the_managed_clone_recreating_it_if_deleted_or_the_cd_directory() {
    let remote = Remote::new();
    let mut r = rig();
    let start = |run_id: &str, cd: Option<&Path>| RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "bot".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: String::new(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
        },
        workspace: WorkspaceSpec {
            repo: Some(remote.spec("rp")),
            cd_path: cd.map(|p| p.to_string_lossy().into_owned()),
        },
        resume_session_id: None,
        new_session_reason: Some("requested".into()),
        prompt: RunPrompt {
            text: "mock:echo".into(),
            triggered_by: "t".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
        mcp_servers: vec![],
        command: None,
        sync: None,
    };
    let cwd = |d: &RunDone| -> PathBuf {
        let v: serde_json::Value = serde_json::from_str(&d.reply).unwrap_or_else(|_| panic!("{d:?}"));
        PathBuf::from(v["cwd"].as_str().unwrap()).canonicalize().unwrap()
    };

    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r1", None))), &r.out);
    let d = done(&mut r.rx).await;
    let managed = r.managed(Some("rp"));
    assert_eq!(cwd(&d), managed.canonicalize().unwrap());
    assert!(managed.join("README.md").is_file());

    let local = remote.clone_to("local");
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r2", Some(&local)))), &r.out);
    assert_eq!(cwd(&done(&mut r.rx).await), local.canonicalize().unwrap());

    let gone = local.join("nope");
    r.engine.handle(ServerToDaemon::RunStart(Box::new(start("r3", Some(&gone)))), &r.out);
    let d = done(&mut r.rx).await;
    assert_eq!(d.outcome, RunOutcome::Failed);
    assert!(d.error.unwrap().contains("目录不存在"));
}

#[tokio::test]
async fn runs_of_different_groups_in_one_directory_take_turns() {
    let mut r = rig();
    let dir = tempfile::tempdir().unwrap();
    let cmd = "mock:sh echo start >> log; sleep 1; echo end >> log";
    for (run, group) in [("r1", "g1"), ("r2", "g2")] {
        let mut s = run_start(run, group, dir.path());
        s.prompt.text = cmd.into();
        r.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &r.out);
    }
    done(&mut r.rx).await;
    done(&mut r.rx).await;
    let log = std::fs::read_to_string(dir.path().join("log")).unwrap();
    assert_eq!(log, "start\nend\nstart\nend\n");
}

fn run_start(run_id: &str, group: &str, cd: &Path) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: group.into(),
        group_name: String::new(),
        bot: RunBot {
            id: "b1".into(),
            name: "bot".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: String::new(),
            tier: Tier::Full,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
        },
        workspace: WorkspaceSpec { repo: None, cd_path: Some(cd.to_string_lossy().into_owned()) },
        resume_session_id: None,
        new_session_reason: None,
        prompt: RunPrompt {
            text: "mock:echo".into(),
            triggered_by: "t".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
        mcp_servers: vec![],
        command: None,
        sync: None,
    }
}

async fn dir_result(rx: &mut OutboxRx) -> DirResult {
    match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.unwrap().unwrap() {
        DaemonToServer::DirResult(d) => d,
        other => panic!("unexpected {other:?}"),
    }
}

async fn done(rx: &mut OutboxRx) -> RunDone {
    loop {
        if let DaemonToServer::RunDone(d) =
            tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.unwrap().unwrap()
        {
            return d;
        }
    }
}
