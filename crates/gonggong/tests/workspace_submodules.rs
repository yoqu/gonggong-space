//! Managed clones check out submodules. Its own process: local (file://) submodules need an environment override.
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox};
use gonggong::workspace::managed_path;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@gonggong", "-c", "init.defaultBranch=main"])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

#[tokio::test]
async fn managed_clones_check_out_submodules() {
    // SAFETY: set before this single-test process starts any other thread.
    unsafe {
        std::env::set_var("GIT_CONFIG_COUNT", "1");
        std::env::set_var("GIT_CONFIG_KEY_0", "protocol.file.allow");
        std::env::set_var("GIT_CONFIG_VALUE_0", "always");
    }
    let root = tempfile::tempdir().unwrap();
    let r = root.path();
    for name in ["lib", "app"] {
        git(r, &["init", "-q", name]);
        std::fs::write(r.join(name).join("a.txt"), name).unwrap();
        git(&r.join(name), &["add", "-A"]);
        git(&r.join(name), &["commit", "-qm", "a"]);
    }
    git(&r.join("app"), &["submodule", "add", "-q", &r.join("lib").to_string_lossy(), "vendor/lib"]);
    git(&r.join("app"), &["commit", "-qm", "sub"]);

    let home = tempfile::tempdir().unwrap();
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: home.path().to_path_buf(),
        adapter_cmd: None,
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Default::default(),
        api: None,
    });
    let (out, mut rx) = Outbox::channel();
    let repo = RepoSpec {
        id: "rp".into(),
        url: format!("file://{}", r.join("app").display()),
        branch: "main".into(),
        protocol: GitProtocol::Auto,
    };
    let dir = managed_path(home.path(), "g1", "b1", Some(&repo));
    let (request_id, group_id, bot_id) = ("e1".into(), "g1".into(), "b1".into());
    let msg = WorkspaceEnsure { request_id, group_id, bot_id, repo: Some(repo), extra_repos: vec![] };
    engine.handle(ServerToDaemon::WorkspaceEnsure(msg), &out);
    let state = loop {
        match tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.expect("quiet").unwrap() {
            DaemonToServer::WorkspaceState(s) if s.state == WorkspaceStateKind::Cloning => continue,
            DaemonToServer::WorkspaceState(s) => break s,
            other => panic!("unexpected {other:?}"),
        }
    };
    assert_eq!(state.state, WorkspaceStateKind::Ready, "{:?}", state.error);
    assert_eq!(std::fs::read_to_string(dir.join("vendor/lib/a.txt")).unwrap(), "lib");
    assert_eq!(state.git.map(|g| g.dirty), Some(false));
}
