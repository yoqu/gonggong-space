#![cfg(any(target_os = "macos", target_os = "linux"))]

use gonggong::protocol::{TerminalEndReason, TerminalOpen, TerminalOpenAction, TerminalStatus, WorkspaceSpec};
use gonggong::terminal::{TerminalAttachment, TerminalEvent, TerminalManager};
use hyper::body::Bytes;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

static COMMAND_ID: AtomicU64 = AtomicU64::new(0);

struct RealShell {
    _home: TempDir,
    workspace: TempDir,
    manager: TerminalManager,
    open: TerminalOpen,
    attachment: Option<TerminalAttachment>,
}

impl RealShell {
    async fn spawn() -> Self {
        let home = tempfile::tempdir().unwrap();
        let workspace = tempfile::tempdir().unwrap();
        let manager = TerminalManager::new(home.path().to_path_buf());
        let open = TerminalOpen {
            action: TerminalOpenAction::Create,
            session_id: uuid::Uuid::new_v4().to_string(),
            group_id: uuid::Uuid::new_v4().to_string(),
            bot_id: uuid::Uuid::new_v4().to_string(),
            workspace: WorkspaceSpec {
                repo: None,
                cd_path: Some(workspace.path().to_string_lossy().into_owned()),
                protect_base: false,
                extra_dirs: vec![],
            },
            cols: 80,
            rows: 24,
            after: 0,
        };
        let attachment = manager.open(open.clone()).await.unwrap();
        assert_eq!(attachment.head.status, TerminalStatus::Running);
        let mut shell = Self { _home: home, workspace, manager, open, attachment: Some(attachment) };
        shell.input("exec /bin/bash --noprofile --norc -i\r").await;
        shell.command(":").await;
        shell
    }

    async fn input(&self, data: impl Into<Bytes>) {
        self.manager.input(&self.open.session_id, data).await.unwrap();
    }

    async fn output(&mut self, marker: &str) -> String {
        let attachment = self.attachment.as_mut().unwrap();
        timeout(Duration::from_secs(10), async {
            let mut bytes = vec![];
            loop {
                match attachment.events.recv().await {
                    Some(TerminalEvent::Output(chunk)) => {
                        bytes.extend_from_slice(&chunk.data);
                        if String::from_utf8_lossy(&bytes).contains(marker) {
                            return String::from_utf8_lossy(&bytes).into_owned();
                        }
                    }
                    Some(TerminalEvent::Exit { exit_code, reason, .. }) => {
                        panic!("shell exited before {marker}: {exit_code:?} {reason:?}");
                    }
                    None => panic!("PTY output ended before {marker}"),
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {marker}"))
    }

    async fn command(&mut self, command: &str) -> String {
        let id = COMMAND_ID.fetch_add(1, Ordering::Relaxed);
        let marker = format!("GG_ACCEPTANCE_DONE_{id}");
        self.input(format!("{command}; printf '\\nGG_%s\\n' 'ACCEPTANCE_DONE_{id}'\r")).await;
        self.output(&marker).await
    }

    async fn detach(&mut self) {
        drop(self.attachment.take());
    }

    async fn reattach(&mut self, after: u64) {
        let mut open = self.open.clone();
        open.action = TerminalOpenAction::Attach;
        open.after = after;
        self.attachment = Some(self.manager.open(open).await.unwrap());
    }

    async fn wait_for_exit(&mut self) -> (Option<i32>, TerminalEndReason) {
        let attachment = self.attachment.as_mut().unwrap();
        timeout(Duration::from_secs(10), async {
            loop {
                match attachment.events.recv().await {
                    Some(TerminalEvent::Output(_)) => {}
                    Some(TerminalEvent::Exit { exit_code, reason, .. }) => return (exit_code, reason),
                    None => panic!("PTY closed without an exit event"),
                }
            }
        })
        .await
        .unwrap()
    }

    async fn terminate(&mut self) {
        if self.manager.head(&self.open.session_id).await.unwrap().status == TerminalStatus::Running {
            self.manager.terminate(&self.open.session_id).await.unwrap();
        }
    }
}

impl Drop for RealShell {
    fn drop(&mut self) {
        let manager = self.manager.clone();
        let session_id = self.open.session_id.clone();
        // A failed assertion must not leave its real shell and background children behind.
        let cleanup = std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            let _ = runtime.block_on(manager.terminate(&session_id));
        });
        let _ = cleanup.join();
    }
}

async fn wait_for_file(path: &Path) {
    timeout(Duration::from_secs(10), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

fn process_exists(pid: i32) -> bool {
    #[cfg(target_os = "linux")]
    if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        return stat.rsplit(") ").next().and_then(|rest| rest.chars().next()) != Some('Z');
    }
    unsafe { libc::kill(pid, 0) == 0 }
}

#[tokio::test]
async fn real_bash_round_trip_ctrl_c_and_ctrl_d() {
    let mut shell = RealShell::spawn().await;
    let output = shell.command("printf 'GG_REAL tty=%s cwd=%s\\n' \"$(test -t 0 && printf yes)\" \"$PWD\"").await;
    assert!(output.contains("GG_REAL tty=yes"), "{output}");
    let cwd = shell.workspace.path().canonicalize().unwrap();
    assert!(output.contains(&format!("cwd={}", cwd.display())), "{output}");

    shell.input("printf 'GG_%s\\n' 'INTERRUPT_READY'; sleep 30\r").await;
    shell.output("GG_INTERRUPT_READY").await;
    shell.input(Bytes::from_static(b"\x03")).await;
    let output = shell.command("printf 'GG_%s\\n' 'AFTER_CTRL_C'").await;
    assert!(output.contains("GG_AFTER_CTRL_C"), "{output}");
    shell.input(Bytes::from_static(b"\x04")).await;
    assert_eq!(shell.wait_for_exit().await, (Some(0), TerminalEndReason::Exited));
}

#[tokio::test]
async fn detach_and_reattach_replay_real_pty_output_without_stopping_the_shell() {
    let mut shell = RealShell::spawn().await;
    shell.input("(sleep 0.2; printf 'GG_%s\\n' 'WHILE_DETACHED') &\r").await;
    let cursor = shell.manager.head(&shell.open.session_id).await.unwrap().next;
    shell.detach().await;
    shell.input("printf 'GG_%s\\n' 'REPLAY_ME'; : > replay-complete\r").await;
    wait_for_file(&shell.workspace.path().join("replay-complete")).await;

    shell.reattach(cursor).await;
    let replay = shell
        .attachment
        .as_ref()
        .unwrap()
        .replay
        .iter()
        .flat_map(|chunk| chunk.data.iter().copied())
        .collect::<Vec<_>>();
    let replay = String::from_utf8_lossy(&replay);
    assert!(replay.contains("GG_WHILE_DETACHED") || replay.contains("GG_REPLAY_ME"), "{replay}");
    let output = shell.command("printf 'GG_%s\\n' 'REATTACHED'").await;
    assert!(output.contains("GG_REATTACHED"), "{output}");
    shell.terminate().await;
}

#[tokio::test]
async fn explicit_terminate_kills_the_shell_and_its_background_process_tree() {
    let mut shell = RealShell::spawn().await;
    shell.command("sleep 60 & printf '%s' $! > child.pid").await;
    let pid_path = shell.workspace.path().join("child.pid");
    wait_for_file(&pid_path).await;
    let pid: i32 = std::fs::read_to_string(pid_path).unwrap().parse().unwrap();
    assert!(process_exists(pid));

    shell.manager.terminate(&shell.open.session_id).await.unwrap();
    assert!(!process_exists(pid));
    let head = shell.manager.head(&shell.open.session_id).await.unwrap();
    assert_eq!(head.status, TerminalStatus::Closed);
    assert_eq!(head.reason, Some(TerminalEndReason::User));
}
