//! Child processes. On Windows each console program started from the desktop app (a GUI process without a console)
//! would open a console window of its own; these start it without one.

use std::ffi::OsStr;
use std::io::Read;
use std::time::{Duration, Instant};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn command(program: impl AsRef<OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, CREATE_NO_WINDOW);
    cmd
}

pub fn async_command(program: impl AsRef<OsStr>) -> tokio::process::Command {
    tokio::process::Command::from(command(program))
}

/// Stdout of a short-lived `cmd` (a `--version` probe), or None if it fails or outlives `limit`: then it is killed, so
/// a hung CLI cannot stall detection. Its output must fit the pipe buffer.
pub fn stdout_within(cmd: &mut std::process::Command, limit: Duration) -> Option<String> {
    run_within(cmd, limit, false)
}

/// Combined stdout + stderr of a short-lived `cmd` (e.g. `claude auth status` / `codex login status`), killed past
/// `limit`. Output must fit the pipe buffer.
pub fn output_within(cmd: &mut std::process::Command, limit: Duration) -> Option<String> {
    run_within(cmd, limit, true)
}

fn run_within(cmd: &mut std::process::Command, limit: Duration, with_stderr: bool) -> Option<String> {
    use std::process::Stdio;
    let stderr = if with_stderr { Stdio::piped() } else { Stdio::null() };
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(stderr).spawn().ok()?;
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = vec![];
    child.stdout.take()?.read_to_end(&mut out).ok()?;
    if with_stderr && let Some(mut err) = child.stderr.take() {
        let _ = err.read_to_end(&mut out);
    }
    Some(String::from_utf8_lossy(&out).into_owned())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn a_hung_program_is_killed_at_the_limit() {
        let mut echo = command("sh");
        echo.args(["-c", "echo 1.2.3"]);
        assert_eq!(stdout_within(&mut echo, Duration::from_secs(5)).as_deref(), Some("1.2.3\n"));
        let at = Instant::now();
        let mut hung = command("sleep");
        hung.arg("30");
        assert_eq!(stdout_within(&mut hung, Duration::from_millis(200)), None);
        assert!(at.elapsed() < Duration::from_secs(5));
    }
}
