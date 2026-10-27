use super::protocol::{TERMINAL_IDLE_MS, TerminalEndReason, TerminalStatus};
use std::time::Duration;
use tokio::time::Instant;

pub const IDLE_TIMEOUT: Duration = Duration::from_millis(TERMINAL_IDLE_MS);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Attached,
    Detached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachDecision {
    Accepted { replay_from: u64 },
    ReplayExpired,
    CursorAhead,
    DaemonRestart,
}

/// Process and attachment state are independent: dropping a browser stream must not end the PTY.
pub struct Lifecycle {
    connection: ConnectionState,
    status: TerminalStatus,
    reason: Option<TerminalEndReason>,
    exit_code: Option<i32>,
    last_active: Instant,
}

impl Lifecycle {
    pub fn new(now: Instant) -> Self {
        Self {
            connection: ConnectionState::Attached,
            status: TerminalStatus::Running,
            reason: None,
            exit_code: None,
            last_active: now,
        }
    }

    pub fn connection(&self) -> ConnectionState {
        self.connection
    }

    pub fn status(&self) -> TerminalStatus {
        self.status
    }

    pub fn reason(&self) -> Option<TerminalEndReason> {
        self.reason
    }

    pub fn exit_code(&self) -> Option<i32> {
        self.exit_code
    }

    pub fn last_active(&self) -> Instant {
        self.last_active
    }

    pub fn idle_deadline(&self) -> Option<Instant> {
        (self.status == TerminalStatus::Running).then(|| self.last_active + IDLE_TIMEOUT)
    }

    pub fn detach(&mut self) {
        self.connection = ConnectionState::Detached;
    }

    /// `oldest` is the first retained sequence and `next` is the next sequence to be produced.
    pub fn attach(&mut self, after: u64, oldest: u64, next: u64) -> AttachDecision {
        if self.status == TerminalStatus::DaemonRestart {
            return AttachDecision::DaemonRestart;
        }
        if after >= next {
            return AttachDecision::CursorAhead;
        }
        if after != 0 && after.saturating_add(1) < oldest {
            return AttachDecision::ReplayExpired;
        }
        self.connection = ConnectionState::Attached;
        AttachDecision::Accepted { replay_from: after.saturating_add(1).max(oldest) }
    }

    pub fn record_input(&mut self, at: Instant) {
        self.record_activity(at);
    }

    pub fn record_output(&mut self, at: Instant) {
        self.record_activity(at);
    }

    pub fn exited(&mut self, code: i32) {
        if self.status != TerminalStatus::Running {
            return;
        }
        self.status = TerminalStatus::Exited;
        self.reason = Some(TerminalEndReason::Exited);
        self.exit_code = Some(code);
        self.detach();
    }

    /// Some(reason) tells the caller to apply the corresponding cleanup/termination effect once.
    pub fn terminate(&mut self) -> Option<TerminalEndReason> {
        self.close(TerminalEndReason::User)
    }

    pub fn revoke(&mut self) -> Option<TerminalEndReason> {
        self.close(TerminalEndReason::Revoked)
    }

    pub fn shutdown(&mut self) -> Option<TerminalEndReason> {
        self.close(TerminalEndReason::Shutdown)
    }

    pub fn fail(&mut self) -> Option<TerminalEndReason> {
        self.close(TerminalEndReason::Error)
    }

    pub fn reap_at(&mut self, now: Instant) -> Option<TerminalEndReason> {
        if self.idle_deadline().is_some_and(|deadline| now >= deadline) {
            self.close(TerminalEndReason::IdleTimeout)
        } else {
            None
        }
    }

    /// A fresh daemon has no old PTY handle; only live sessions acquire this terminal state.
    pub fn mark_daemon_restart(&mut self) {
        if self.status != TerminalStatus::Running {
            return;
        }
        self.status = TerminalStatus::DaemonRestart;
        self.reason = Some(TerminalEndReason::DaemonRestart);
        self.detach();
    }

    fn record_activity(&mut self, at: Instant) {
        if self.status == TerminalStatus::Running {
            self.last_active = self.last_active.max(at);
        }
    }

    fn close(&mut self, reason: TerminalEndReason) -> Option<TerminalEndReason> {
        if self.status != TerminalStatus::Running {
            return None;
        }
        self.status = TerminalStatus::Closed;
        self.reason = Some(reason);
        self.detach();
        Some(reason)
    }
}
