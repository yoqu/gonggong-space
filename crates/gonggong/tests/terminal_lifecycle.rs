use gonggong::protocol::{TerminalEndReason, TerminalStatus};
use std::time::Duration;
use terminal_lifecycle::{AttachDecision, ConnectionState, IDLE_TIMEOUT, Lifecycle};
use tokio::time::Instant;

#[path = "../src/terminal_lifecycle.rs"]
mod terminal_lifecycle;

mod protocol {
    pub use gonggong::protocol::{TERMINAL_IDLE_MS, TerminalEndReason, TerminalStatus};
}

#[test]
fn detach_preserves_the_process_and_only_terminate_closes_it_as_user() {
    let now = Instant::now();
    let mut lifecycle = Lifecycle::new(now);
    assert_eq!(lifecycle.connection(), ConnectionState::Attached);

    lifecycle.detach();
    lifecycle.detach();

    assert_eq!(lifecycle.connection(), ConnectionState::Detached);
    assert_eq!(lifecycle.status(), TerminalStatus::Running);
    assert_eq!(lifecycle.reason(), None);
    assert_eq!(lifecycle.last_active(), now);
    assert_eq!(lifecycle.reap_at(now), None);
    assert_eq!(lifecycle.terminate(), Some(TerminalEndReason::User));
    assert_eq!(lifecycle.status(), TerminalStatus::Closed);
    assert_eq!(lifecycle.reason(), Some(TerminalEndReason::User));
    assert_eq!(lifecycle.terminate(), None);
    assert_eq!(lifecycle.revoke(), None);
    assert_eq!(lifecycle.shutdown(), None);
    assert_eq!(lifecycle.fail(), None);
    lifecycle.exited(0);
    assert_eq!(lifecycle.status(), TerminalStatus::Closed);
    assert_eq!(lifecycle.reason(), Some(TerminalEndReason::User));
    assert_eq!(lifecycle.exit_code(), None);
}

#[test]
fn shell_exit_is_final_and_distinct_from_explicit_termination() {
    let mut lifecycle = Lifecycle::new(Instant::now());
    lifecycle.exited(7);

    assert_eq!(lifecycle.status(), TerminalStatus::Exited);
    assert_eq!(lifecycle.reason(), Some(TerminalEndReason::Exited));
    assert_eq!(lifecycle.exit_code(), Some(7));
    assert_eq!(lifecycle.terminate(), None);
    assert_eq!(lifecycle.reap_at(Instant::now() + IDLE_TIMEOUT), None);
}

#[test]
fn revocation_shutdown_and_error_have_their_own_closed_reasons() {
    for (close, reason) in [
        (Lifecycle::revoke as fn(&mut Lifecycle) -> _, TerminalEndReason::Revoked),
        (Lifecycle::shutdown, TerminalEndReason::Shutdown),
        (Lifecycle::fail, TerminalEndReason::Error),
    ] {
        let mut lifecycle = Lifecycle::new(Instant::now());
        assert_eq!(close(&mut lifecycle), Some(reason));
        assert_eq!(lifecycle.status(), TerminalStatus::Closed);
        assert_eq!(lifecycle.reason(), Some(reason));
        assert_eq!(close(&mut lifecycle), None);
    }
}

#[test]
fn daemon_restart_is_not_resumable_and_does_not_rewrite_finished_sessions() {
    let mut running = Lifecycle::new(Instant::now());
    running.mark_daemon_restart();
    assert_eq!(running.status(), TerminalStatus::DaemonRestart);
    assert_eq!(running.reason(), Some(TerminalEndReason::DaemonRestart));
    assert_eq!(running.connection(), ConnectionState::Detached);
    assert_eq!(running.attach(0, 1, 1), AttachDecision::DaemonRestart);
    assert_eq!(running.terminate(), None);

    let mut exited = Lifecycle::new(Instant::now());
    exited.exited(0);
    exited.mark_daemon_restart();
    assert_eq!(exited.status(), TerminalStatus::Exited);
    assert_eq!(exited.reason(), Some(TerminalEndReason::Exited));
}

#[test]
fn attach_resumes_from_the_next_retained_sequence_without_counting_as_activity() {
    let started = Instant::now();
    let mut lifecycle = Lifecycle::new(started);
    lifecycle.detach();
    let later = started + Duration::from_secs(60);

    assert_eq!(lifecycle.attach(5, 1, 13), AttachDecision::Accepted { replay_from: 6 });
    assert_eq!(lifecycle.connection(), ConnectionState::Attached);
    assert_eq!(lifecycle.last_active(), started);

    lifecycle.detach();
    assert_eq!(lifecycle.attach(4, 7, 13), AttachDecision::ReplayExpired);
    assert_eq!(lifecycle.connection(), ConnectionState::Detached);
    assert_eq!(lifecycle.attach(6, 7, 13), AttachDecision::Accepted { replay_from: 7 });
    assert_eq!(lifecycle.attach(12, 7, 13), AttachDecision::Accepted { replay_from: 13 });
    assert_eq!(lifecycle.attach(13, 7, 13), AttachDecision::CursorAhead);
    assert_eq!(lifecycle.last_active(), started);
    assert_eq!(lifecycle.reap_at(later), None);
}

#[test]
fn a_blank_screen_can_attach_to_the_retained_window_after_replay_expiry() {
    let mut lifecycle = Lifecycle::new(Instant::now());
    lifecycle.detach();

    assert_eq!(lifecycle.attach(0, 7, 13), AttachDecision::Accepted { replay_from: 7 });
    assert_eq!(lifecycle.attach(0, 1, 1), AttachDecision::Accepted { replay_from: 1 });
}

#[test]
fn ended_output_can_be_replayed_without_changing_its_final_state() {
    let mut lifecycle = Lifecycle::new(Instant::now());
    lifecycle.exited(0);
    lifecycle.detach();

    assert_eq!(lifecycle.attach(3, 1, 5), AttachDecision::Accepted { replay_from: 4 });
    assert_eq!(lifecycle.status(), TerminalStatus::Exited);
    assert_eq!(lifecycle.reason(), Some(TerminalEndReason::Exited));
    assert_eq!(lifecycle.exit_code(), Some(0));
}

#[tokio::test(start_paused = true)]
async fn only_input_and_output_delay_the_virtual_idle_deadline() {
    let started = Instant::now();
    let mut lifecycle = Lifecycle::new(started);
    assert_eq!(lifecycle.idle_deadline(), Some(started + IDLE_TIMEOUT));

    tokio::time::advance(Duration::from_secs(12 * 60 * 60)).await;
    let input_at = Instant::now();
    lifecycle.record_input(input_at);
    assert_eq!(lifecycle.last_active(), input_at);
    assert_eq!(lifecycle.idle_deadline(), Some(input_at + IDLE_TIMEOUT));

    tokio::time::advance(Duration::from_secs(12 * 60 * 60)).await;
    lifecycle.detach();
    assert_eq!(lifecycle.attach(0, 1, 1), AttachDecision::Accepted { replay_from: 1 });
    assert_eq!(lifecycle.last_active(), input_at);
    assert_eq!(lifecycle.reap_at(Instant::now()), None);

    tokio::time::advance(IDLE_TIMEOUT - Duration::from_secs(1)).await;
    let output_at = Instant::now();
    lifecycle.record_output(output_at);
    assert_eq!(lifecycle.last_active(), output_at);
    assert_eq!(lifecycle.reap_at(output_at + IDLE_TIMEOUT - Duration::from_nanos(1)), None);
    assert_eq!(lifecycle.reap_at(output_at + IDLE_TIMEOUT), Some(TerminalEndReason::IdleTimeout));
    assert_eq!(lifecycle.status(), TerminalStatus::Closed);
    assert_eq!(lifecycle.reason(), Some(TerminalEndReason::IdleTimeout));
    assert_eq!(lifecycle.idle_deadline(), None);
    assert_eq!(lifecycle.reap_at(output_at + IDLE_TIMEOUT), None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_real_shell_survives_stream_detach_until_the_terminate_effect_is_applied() {
    let mut child = tokio::process::Command::new("/bin/sh");
    child.args(["-c", "read waiting"]).stdin(std::process::Stdio::piped()).kill_on_drop(true);
    let mut child = child.spawn().unwrap();
    let mut lifecycle = Lifecycle::new(Instant::now());

    lifecycle.detach();
    assert!(child.try_wait().unwrap().is_none());
    assert_eq!(lifecycle.status(), TerminalStatus::Running);

    if lifecycle.terminate() == Some(TerminalEndReason::User) {
        child.kill().await.unwrap();
    }
    assert!(!child.wait().await.unwrap().success());
}
