#![cfg(any(target_os = "macos", target_os = "linux"))]

use gonggong::protocol::{
    TerminalEndReason, TerminalHead, TerminalOpen, TerminalOpenAction, TerminalStatus, WorkspaceSpec,
};
use gonggong::terminal::{TerminalError, TerminalEvent, TerminalManager};
use hyper::body::Bytes;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

static MARKER: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    _home: TempDir,
    work: TempDir,
    manager: TerminalManager,
}

impl Fixture {
    fn new() -> Self {
        Self::with_idle_timeout(Duration::from_millis(60_000))
    }

    fn with_idle_timeout(idle: Duration) -> Self {
        let home = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        let manager = TerminalManager::with_idle_timeout(home.path().to_path_buf(), idle);
        Self { _home: home, work, manager }
    }

    fn open(&self, action: TerminalOpenAction, after: u64) -> TerminalOpen {
        TerminalOpen {
            action,
            session_id: uuid::Uuid::new_v4().to_string(),
            group_id: uuid::Uuid::new_v4().to_string(),
            bot_id: uuid::Uuid::new_v4().to_string(),
            workspace: WorkspaceSpec {
                repo: None,
                cd_path: Some(self.work.path().to_string_lossy().into_owned()),
                protect_base: false,
                extra_dirs: vec![],
            },
            cols: 80,
            rows: 24,
            after,
        }
    }

    async fn create(&self) -> (TerminalOpen, gonggong::terminal::TerminalAttachment) {
        let open = self.open(TerminalOpenAction::Create, 0);
        let attachment = self.manager.open(open.clone()).await.unwrap();
        assert_eq!(attachment.head.status, TerminalStatus::Running);
        (open, attachment)
    }

    async fn attach(&self, open: &TerminalOpen, after: u64) -> gonggong::terminal::TerminalAttachment {
        let mut open = open.clone();
        open.action = TerminalOpenAction::Attach;
        open.after = after;
        self.manager.open(open).await.unwrap()
    }
}

async fn input(manager: &TerminalManager, id: &str, bytes: impl Into<Bytes>) {
    manager.input(id, bytes).await.unwrap();
}

async fn live_until(attachment: &mut gonggong::terminal::TerminalAttachment, marker: &str) -> Vec<u8> {
    let mut output = vec![];
    let result = timeout(Duration::from_secs(12), async {
        loop {
            match attachment.events.recv().await {
                Some(TerminalEvent::Output(chunk)) => {
                    output.extend_from_slice(&chunk.data);
                    if String::from_utf8_lossy(&output).contains(marker) {
                        return output;
                    }
                }
                Some(TerminalEvent::Exit { exit_code, reason, .. }) => {
                    panic!("terminal exited before {marker}: {exit_code:?} {reason:?}");
                }
                None => panic!("terminal event stream closed before {marker}"),
            }
        }
    })
    .await;
    result.unwrap_or_else(|_| panic!("timed out waiting for {marker}"))
}

async fn command(
    manager: &TerminalManager,
    id: &str,
    attachment: &mut gonggong::terminal::TerminalAttachment,
    command: &str,
) -> Vec<u8> {
    let n = MARKER.fetch_add(1, Ordering::Relaxed);
    let marker = format!("GG_COMMAND_DONE_{n}");
    input(manager, id, format!("{command}; printf '\\nGG_%s\\n' 'COMMAND_DONE_{n}'\r")).await;
    live_until(attachment, &marker).await
}

async fn bash(manager: &TerminalManager, id: &str, attachment: &mut gonggong::terminal::TerminalAttachment) {
    input(manager, id, "exec /bin/bash --noprofile --norc -i\r").await;
    tokio::task::yield_now().await;
    command(manager, id, attachment, ":").await;
}

async fn wait_for_file(path: &Path) {
    timeout(Duration::from_secs(12), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

async fn wait_for_exit(attachment: &mut gonggong::terminal::TerminalAttachment) -> (Option<i32>, TerminalEndReason) {
    timeout(Duration::from_secs(12), async {
        loop {
            match attachment.events.recv().await {
                Some(TerminalEvent::Output(_)) => {}
                Some(TerminalEvent::Exit { exit_code, reason, .. }) => return (exit_code, reason),
                None => panic!("terminal event stream closed without an exit event"),
            }
        }
    })
    .await
    .unwrap()
}

async fn head(manager: &TerminalManager, id: &str) -> TerminalHead {
    manager.head(id).await.unwrap()
}

#[tokio::test]
async fn real_bash_uses_the_workspace_and_pty_size() {
    let fixture = Fixture::new();
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;

    let output = command(
        &fixture.manager,
        &open.session_id,
        &mut attachment,
        "printf 'cwd=%s bash=%s tty=%s\\n' \"$PWD\" \"$BASH_VERSION\" \"$(test -t 0 && printf yes)\"",
    )
    .await;
    let output = String::from_utf8_lossy(&output);
    let cwd = fixture.work.path().canonicalize().unwrap();
    assert!(output.contains(&format!("cwd={}", cwd.display())), "{output}");
    assert!(output.contains("tty=yes"), "{output}");
    assert!(!output.contains("bash= "), "{output}");

    fixture.manager.resize(&open.session_id, 132, 43).await.unwrap();
    let output = command(&fixture.manager, &open.session_id, &mut attachment, "stty size").await;
    assert!(String::from_utf8_lossy(&output).contains("43 132"));
    let head = head(&fixture.manager, &open.session_id).await;
    assert_eq!((head.cols, head.rows), (132, 43));

    fixture.manager.terminate(&open.session_id).await.unwrap();
}

#[tokio::test]
async fn managed_workspace_is_resolved_from_group_and_bot() {
    let home = tempfile::tempdir().unwrap();
    let manager = TerminalManager::new(home.path().to_path_buf());
    let mut open = TerminalOpen {
        action: TerminalOpenAction::Create,
        session_id: uuid::Uuid::new_v4().to_string(),
        group_id: uuid::Uuid::new_v4().to_string(),
        bot_id: uuid::Uuid::new_v4().to_string(),
        workspace: WorkspaceSpec { repo: None, cd_path: None, protect_base: false, extra_dirs: vec![] },
        cols: 80,
        rows: 24,
        after: 0,
    };
    let cwd = gonggong::workspace::workspace_dir(home.path(), &open.group_id, &open.bot_id, &open.workspace);
    std::fs::create_dir_all(&cwd).unwrap();
    let mut attachment = manager.open(open.clone()).await.unwrap();
    bash(&manager, &open.session_id, &mut attachment).await;
    let output = command(&manager, &open.session_id, &mut attachment, "pwd").await;
    assert!(String::from_utf8_lossy(&output).contains(&cwd.to_string_lossy().to_string()));
    manager.terminate(&open.session_id).await.unwrap();
    open.after = 0;
}

#[tokio::test]
async fn ctrl_c_and_ctrl_d_are_written_as_pty_bytes_and_exit_is_reported() {
    let fixture = Fixture::new();
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    input(&fixture.manager, &open.session_id, "printf 'SLEEP_READY\\n'; sleep 20\r").await;
    live_until(&mut attachment, "SLEEP_READY").await;
    input(&fixture.manager, &open.session_id, Bytes::from_static(b"\x03")).await;
    command(&fixture.manager, &open.session_id, &mut attachment, ":").await;
    input(&fixture.manager, &open.session_id, "exit 42\r").await;
    let (code, reason) = wait_for_exit(&mut attachment).await;
    assert_eq!(code, Some(42));
    assert_eq!(reason, TerminalEndReason::Exited);
    assert_eq!(head(&fixture.manager, &open.session_id).await.status, TerminalStatus::Exited);

    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    input(&fixture.manager, &open.session_id, Bytes::from_static(b"\x04")).await;
    let (code, reason) = wait_for_exit(&mut attachment).await;
    assert_eq!(code, Some(0));
    assert_eq!(reason, TerminalEndReason::Exited);
}

#[tokio::test]
async fn dropping_the_web_stream_keeps_the_shell_running_and_replays_output() {
    let fixture = Fixture::new();
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    input(&fixture.manager, &open.session_id, "sleep 1; printf survived > detached.txt\r").await;
    let cursor = head(&fixture.manager, &open.session_id).await.next;
    drop(attachment);
    wait_for_file(&fixture.work.path().join("detached.txt")).await;
    command_without_stream(&fixture.manager, &open.session_id, fixture.work.path(), "printf 'detached output\\n'")
        .await;

    let mut attachment = fixture.attach(&open, cursor).await;
    assert_eq!(attachment.head.status, TerminalStatus::Running);
    assert!(!attachment.replay.is_empty());
    assert!(attachment.replay.windows(2).all(|pair| pair[0].seq < pair[1].seq));
    let n = MARKER.fetch_add(1, Ordering::Relaxed);
    let marker = format!("GG_COMMAND_DONE_{n}");
    input(&fixture.manager, &open.session_id, format!(":; printf '\\nGG_%s\\n' 'COMMAND_DONE_{n}'\r")).await;
    let mut output = vec![];
    for chunk in &attachment.replay {
        output.extend_from_slice(&chunk.data);
    }
    while !String::from_utf8_lossy(&output).contains(&marker) {
        match timeout(Duration::from_secs(12), attachment.events.recv()).await.unwrap() {
            Some(TerminalEvent::Output(chunk)) => output.extend_from_slice(&chunk.data),
            Some(TerminalEvent::Exit { .. }) | None => panic!("terminal exited before {marker}"),
        }
    }
    fixture.manager.terminate(&open.session_id).await.unwrap();
}

async fn command_without_stream(manager: &TerminalManager, id: &str, cwd: &Path, command: &str) {
    let done = format!("done_{}", MARKER.fetch_add(1, Ordering::Relaxed));
    input(manager, id, format!("{command}; : > {done}\r")).await;
    wait_for_file(&cwd.join(done)).await;
}

#[tokio::test]
async fn old_replay_cursors_fail_explicitly_and_new_cursors_still_attach() {
    let fixture = Fixture::new();
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    drop(attachment);
    command_without_stream(&fixture.manager, &open.session_id, fixture.work.path(), "yes x | head -c 1126400").await;

    let mut attach = open.clone();
    attach.action = TerminalOpenAction::Attach;
    attach.after = 0;
    assert!(matches!(fixture.manager.open(attach).await, Err(TerminalError::ReplayExpired)));

    let cursor = head(&fixture.manager, &open.session_id).await.next;
    let attachment = fixture.attach(&open, cursor).await;
    assert!(attachment.replay.is_empty());
    drop(attachment);
    let attachment = fixture.attach(&open, cursor - 1).await;
    assert_eq!(attachment.replay.len(), 1);
    assert_eq!(attachment.replay[0].seq, cursor);
    assert!(attachment.replay.iter().map(|chunk| chunk.data.len()).sum::<usize>() <= 1024 * 1024);
    fixture.manager.terminate(&open.session_id).await.unwrap();
}

#[tokio::test]
async fn at_most_eight_live_sessions_can_exist_on_one_machine() {
    let fixture = Fixture::new();
    let mut sessions = vec![];
    for _ in 0..8 {
        sessions.push(fixture.create().await);
    }
    let ninth = fixture.open(TerminalOpenAction::Create, 0);
    assert!(matches!(fixture.manager.open(ninth).await, Err(TerminalError::SessionLimit)));

    fixture.manager.terminate(&sessions[0].0.session_id).await.unwrap();
    let replacement = fixture.create().await;
    fixture.manager.terminate(&replacement.0.session_id).await.unwrap();
    for (open, _) in sessions {
        fixture.manager.terminate(&open.session_id).await.unwrap();
    }
}

#[tokio::test]
async fn terminate_kills_background_children_in_other_job_control_groups() {
    let fixture = Fixture::new();
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    command(&fixture.manager, &open.session_id, &mut attachment, "sleep 30 & printf '%s' $! > child.pid").await;
    let pid_path = fixture.work.path().join("child.pid");
    wait_for_file(&pid_path).await;
    let pid: i32 = std::fs::read_to_string(pid_path).unwrap().parse().unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);

    fixture.manager.terminate(&open.session_id).await.unwrap();
    assert!(!process_is_running(pid));
    let head = head(&fixture.manager, &open.session_id).await;
    assert_eq!(head.status, TerminalStatus::Closed);
    assert_eq!(head.reason, Some(TerminalEndReason::User));
    fixture.manager.terminate(&open.session_id).await.unwrap();
}

fn process_is_running(pid: i32) -> bool {
    #[cfg(target_os = "linux")]
    if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        // A container's PID 1 need not reap orphaned test children. A zombie has already exited.
        return stat.rsplit(") ").next().and_then(|rest| rest.chars().next()) != Some('Z');
    }
    unsafe { libc::kill(pid, 0) == 0 }
}

#[tokio::test]
async fn attach_cannot_cross_group_or_bot_boundaries() {
    let fixture = Fixture::new();
    let (open, _) = fixture.create().await;
    let mut other = open.clone();
    other.action = TerminalOpenAction::Attach;
    other.group_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(fixture.manager.open(other.clone()).await, Err(TerminalError::NotFound)));
    other.group_id = open.group_id.clone();
    other.bot_id = uuid::Uuid::new_v4().to_string();
    assert!(matches!(fixture.manager.open(other).await, Err(TerminalError::NotFound)));
    fixture.manager.terminate(&open.session_id).await.unwrap();
}

#[tokio::test]
async fn idle_shells_and_their_process_trees_are_reaped() {
    let fixture = Fixture::with_idle_timeout(Duration::from_secs(5));
    let (open, mut attachment) = fixture.create().await;
    bash(&fixture.manager, &open.session_id, &mut attachment).await;
    command(&fixture.manager, &open.session_id, &mut attachment, "sleep 30 & printf '%s' $! > idle.pid").await;
    let pid_path = fixture.work.path().join("idle.pid");
    wait_for_file(&pid_path).await;
    let pid: i32 = std::fs::read_to_string(pid_path).unwrap().parse().unwrap();

    command(&fixture.manager, &open.session_id, &mut attachment, ":").await;
    let (exit_code, reason) = wait_for_exit(&mut attachment).await;
    assert_eq!(exit_code, None);
    assert_eq!(reason, TerminalEndReason::IdleTimeout);
    let head = head(&fixture.manager, &open.session_id).await;
    assert_eq!(head.status, TerminalStatus::Closed);
    assert_eq!(head.reason, Some(TerminalEndReason::IdleTimeout));
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
}

#[tokio::test]
async fn pty_master_fds_are_not_inherited_by_other_children() {
    let fixture = Fixture::new();
    let (open, _attachment) = fixture.create().await;
    let masters = (0..4096)
        .filter(|&fd| unsafe { libc::isatty(fd) == 1 && libc::unlockpt(fd) == 0 })
        .map(|fd| (fd, unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC != 0))
        .collect::<Vec<_>>();
    assert!(masters.len() >= 2, "expected the PTY master and its reader duplicate, got {masters:?}");
    assert!(masters.iter().all(|(_, cloexec)| *cloexec), "PTY master fds without FD_CLOEXEC: {masters:?}");
    fixture.manager.terminate(&open.session_id).await.unwrap();
}
