//! Process-wide PATH is isolated in this single-test binary so only its managed clone uses the blocked git.
#![cfg(unix)]

use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use gonggong::workspace::managed_path;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

struct Cleanup {
    path: Option<std::ffi::OsString>,
    git_pid: PathBuf,
    child_pid: PathBuf,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        for file in [&self.git_pid, &self.child_pid] {
            let Ok(pid) = std::fs::read_to_string(file) else { continue };
            let pid = pid.trim();
            for signal in [format!("-{pid}"), pid.into()] {
                let _ = Command::new("kill")
                    .args(["-KILL", "--", &signal])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        if let Some(path) = self.path.take() {
            unsafe { std::env::set_var("PATH", path) };
        }
        unsafe {
            std::env::remove_var("GONGGONG_TEST_GIT_PID");
            std::env::remove_var("GONGGONG_TEST_CHILD_PID");
        }
    }
}

fn quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
}

async fn state(rx: &mut OutboxRx) -> WorkspaceState {
    match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.expect("workspace reply").unwrap() {
        DaemonToServer::WorkspaceState(s) => s,
        other => panic!("unexpected {other:?}"),
    }
}

async fn wait_for(check: impl Fn() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !check() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("condition");
}

fn alive(file: &Path) -> bool {
    let Ok(pid) = std::fs::read_to_string(file) else { return false };
    Command::new("kill")
        .args(["-0", "--", pid.trim()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

#[tokio::test]
async fn cd_cancels_a_blocked_clone_and_ignores_its_late_result() {
    let root = tempfile::tempdir().unwrap();
    let home = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    std::fs::write(local.path().join("keep.txt"), "keep").unwrap();
    let real_git = Command::new("which").arg("git").output().unwrap();
    assert!(real_git.status.success());
    let real_git = PathBuf::from(String::from_utf8(real_git.stdout).unwrap().trim());
    let bin = root.path().join("bin");
    std::fs::create_dir(&bin).unwrap();
    let git_pid = root.path().join("git.pid");
    let child_pid = root.path().join("child.pid");
    let script = format!(
        "#!/bin/sh\n\
         echo \"$@\" >> {}\n\
         is_clone=false\n\
         for arg do [ \"$arg\" = clone ] && is_clone=true; done\n\
         if [ \"$is_clone\" = true ]; then\n\
           for target do :; done\n\
           mkdir -p \"$target\"\n\
           echo started > \"$target/marker\"\n\
           echo $$ > \"$GONGGONG_TEST_GIT_PID\"\n\
           sleep 300 &\n\
           echo $! > \"$GONGGONG_TEST_CHILD_PID\"\n\
           wait\n\
         fi\n\
         exec {} \"$@\"\n",
        quote(&root.path().join("calls")),
        quote(&real_git)
    );
    let fake_git = bin.join("git");
    std::fs::write(&fake_git, script).unwrap();
    let mut permissions = std::fs::metadata(&fake_git).unwrap().permissions();
    use std::os::unix::fs::PermissionsExt;
    permissions.set_mode(0o755);
    std::fs::set_permissions(&fake_git, permissions).unwrap();
    let _cleanup = Cleanup { path: std::env::var_os("PATH"), git_pid: git_pid.clone(), child_pid: child_pid.clone() };
    let mut paths = vec![bin.clone()];
    paths.extend(std::env::split_paths(_cleanup.path.as_deref().unwrap_or_default()));
    unsafe {
        std::env::set_var("GONGGONG_TEST_GIT_PID", &git_pid);
        std::env::set_var("GONGGONG_TEST_CHILD_PID", &child_pid);
        std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    }

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
        id: "repo".into(),
        url: "https://example.invalid/org/repo.git".into(),
        branch: "main".into(),
        protocol: GitProtocol::Auto,
    };
    engine.handle(
        ServerToDaemon::WorkspaceEnsure(WorkspaceEnsure {
            request_id: "ensure".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            repo: Some(repo.clone()),
            extra_repos: vec![],
        }),
        &out,
    );
    assert_eq!(state(&mut rx).await.state, WorkspaceStateKind::Cloning);
    let managed = managed_path(home.path(), "g1", "b1", Some(&repo));
    let partial = PathBuf::from(format!("{}.partial", managed.display()));
    wait_for(|| git_pid.exists() && child_pid.exists() && partial.join("marker").exists()).await;

    engine.handle(
        ServerToDaemon::WorkspaceCd(WorkspaceCd {
            request_id: "cd".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            repo: Some(repo),
            path: Some(local.path().to_string_lossy().into_owned()),
            force: true,
        }),
        &out,
    );
    let switched = state(&mut rx).await;
    assert_eq!((switched.request_id.as_deref(), switched.state), (Some("cd"), WorkspaceStateKind::Ready));
    assert_eq!(switched.path.as_deref(), Some(&*local.path().to_string_lossy()));
    wait_for(|| !partial.exists() && !alive(&git_pid) && !alive(&child_pid)).await;
    assert!(local.path().join("keep.txt").exists());
    assert!(tokio::time::timeout(Duration::from_millis(200), rx.recv()).await.is_err());
}
