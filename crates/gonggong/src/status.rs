//! Live daemon status for UIs (the desktop app): connection, heartbeat, latency and the runs executing here.
//! `Service` feeds it from the messages it relays; readers take snapshots or watch for changes.
use crate::protocol::{AgentInfo, DaemonToServer, RejectReason, RunEvent, RunOutcome, RunStatus, ServerToDaemon};
use serde::Serialize;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Conn {
    Connecting,
    Online {
        since_ms: u64,
    },
    /// Disconnected; the next attempt is due at `retry_at_ms` (exponential backoff).
    Offline {
        retry_at_ms: u64,
        error: String,
    },
    /// Stopped for good. `wiped` lists what a revocation removed from this machine.
    Rejected {
        reason: RejectReason,
        message: String,
        wiped: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInfo {
    pub run_id: String,
    pub group_id: String,
    pub group_name: String,
    pub bot_id: String,
    pub bot_name: String,
    pub triggered_by: String,
    /// `None` until the run reports progress (workspace / attachments still being prepared).
    pub status: Option<RunStatus>,
    pub step: String,
    /// Waiting behind an earlier run of the same (group, bot) conversation.
    pub queued: bool,
    pub started_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub conn: Conn,
    pub heartbeat_sec: Option<u64>,
    pub last_heartbeat_ms: Option<u64>,
    pub latency_ms: Option<u64>,
    pub agents: Vec<AgentInfo>,
    pub runs: Vec<RunInfo>,
}

impl Default for Status {
    fn default() -> Self {
        Status {
            conn: Conn::Connecting,
            heartbeat_sec: None,
            last_heartbeat_ms: None,
            latency_ms: None,
            agents: vec![],
            runs: vec![],
        }
    }
}

/// Finished runs whose process stays viewable; background tasks may still report into them.
const KEEP_ENDED: usize = 20;
const MAX_EVENTS: usize = 5000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedEvent {
    pub id: u64,
    pub at_ms: u64,
    pub event: RunEvent,
}

/// One run's process as executed here: its events in order, streamed deltas merged.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub run: RunInfo,
    pub events: Vec<TimedEvent>,
    pub ended_ms: Option<u64>,
    pub outcome: Option<RunOutcome>,
}

#[derive(Default)]
struct Journal {
    runs: VecDeque<Process>,
    next_id: u64,
}

impl Journal {
    fn record(&mut self, run_id: &str, event: &RunEvent) {
        let Some(p) = self.runs.iter_mut().find(|p| p.run.run_id == run_id) else { return };
        progress(&mut p.run, event);
        if let Some(last) = p.events.last_mut() {
            match (&mut last.event, event) {
                (RunEvent::Text { delta: a, agent_id: x }, RunEvent::Text { delta: b, agent_id: y })
                | (RunEvent::Thought { delta: a, agent_id: x }, RunEvent::Thought { delta: b, agent_id: y })
                    if x == y =>
                {
                    return a.push_str(b);
                }
                _ => {}
            }
        }
        if p.events.len() >= MAX_EVENTS {
            p.events.remove(0);
        }
        self.next_id += 1;
        p.events.push(TimedEvent { id: self.next_id, at_ms: now_ms(), event: event.clone() });
    }

    fn end(&mut self, run_id: &str, outcome: RunOutcome) {
        if let Some(p) = self.runs.iter_mut().find(|p| p.run.run_id == run_id) {
            p.ended_ms = Some(now_ms());
            p.outcome = Some(outcome);
        }
        let ended = self.runs.iter().filter(|p| p.ended_ms.is_some()).count();
        if ended > KEEP_ENDED
            && let Some(i) = self.runs.iter().position(|p| p.ended_ms.is_some())
        {
            self.runs.remove(i);
        }
    }
}

fn progress(run: &mut RunInfo, event: &RunEvent) {
    match event {
        RunEvent::Status { status, step } => {
            run.status = Some(*status);
            run.step = step.clone();
        }
        RunEvent::Tool { title, .. } => {
            run.status = Some(RunStatus::Running);
            run.step = title.clone();
        }
        _ => {
            run.status.get_or_insert(RunStatus::Running);
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[derive(Clone)]
pub struct Monitor {
    status: Arc<watch::Sender<Status>>,
    journal: Arc<Mutex<Journal>>,
}

impl Default for Monitor {
    fn default() -> Self {
        Monitor { status: Arc::new(watch::channel(Status::default()).0), journal: Default::default() }
    }
}

impl Monitor {
    pub fn snapshot(&self) -> Status {
        self.status.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<Status> {
        self.status.subscribe()
    }

    /// The process of a run started here, while running and for the last few finished ones.
    pub fn process(&self, run_id: &str) -> Option<Process> {
        self.journal.lock().unwrap().runs.iter().find(|p| p.run.run_id == run_id).cloned()
    }

    /// Notifies watchers only on a real change: streamed text deltas must not flood the UI.
    fn update(&self, f: impl FnOnce(&mut Status)) {
        self.status.send_if_modified(|s| {
            let before = s.clone();
            f(s);
            *s != before
        });
    }

    pub(crate) fn agents(&self, agents: Vec<AgentInfo>) {
        self.update(|s| s.agents = agents);
    }

    pub(crate) fn online(&self, heartbeat_sec: u64) {
        self.update(|s| {
            s.conn = Conn::Online { since_ms: now_ms() };
            s.heartbeat_sec = Some(heartbeat_sec);
        });
    }

    pub(crate) fn offline(&self, retry_in: Duration, error: String) {
        let retry_at_ms = now_ms() + retry_in.as_millis() as u64;
        self.update(|s| s.conn = Conn::Offline { retry_at_ms, error });
    }

    pub(crate) fn rejected(&self, reason: RejectReason, message: String, wiped: &[PathBuf]) {
        let wiped = wiped.iter().map(|p| p.display().to_string()).collect();
        self.update(|s| s.conn = Conn::Rejected { reason, message, wiped });
    }

    pub(crate) fn heartbeat(&self) {
        self.update(|s| s.last_heartbeat_ms = Some(now_ms()));
    }

    pub(crate) fn latency(&self, rtt: Duration) {
        self.update(|s| s.latency_ms = Some(rtt.as_millis() as u64));
    }

    pub(crate) fn inbound(&self, msg: &ServerToDaemon) {
        let ServerToDaemon::RunStart(start) = msg else { return };
        let run = RunInfo {
            run_id: start.run_id.clone(),
            group_id: start.group_id.clone(),
            group_name: start.group_name.clone(),
            bot_id: start.bot.id.clone(),
            bot_name: start.bot.name.clone(),
            triggered_by: start.prompt.triggered_by.clone(),
            status: None,
            step: crate::t!("准备工作区").into(),
            queued: false,
            started_ms: now_ms(),
        };
        self.journal.lock().unwrap().runs.push_back(Process {
            run: run.clone(),
            events: vec![],
            ended_ms: None,
            outcome: None,
        });
        self.update(|s| {
            s.runs.push(run);
            mark_queued(&mut s.runs);
        });
    }

    pub(crate) fn outbound(&self, msg: &DaemonToServer) {
        match msg {
            DaemonToServer::RunEvent { run_id, event } => {
                self.journal.lock().unwrap().record(run_id, event);
                self.update(|s| {
                    if let Some(run) = s.runs.iter_mut().find(|r| &r.run_id == run_id) {
                        progress(run, event);
                    }
                })
            }
            DaemonToServer::RunDone(done) => {
                self.journal.lock().unwrap().end(&done.run_id, done.outcome);
                self.update(|s| {
                    s.runs.retain(|r| r.run_id != done.run_id);
                    mark_queued(&mut s.runs);
                })
            }
            _ => {}
        }
    }
}

fn mark_queued(runs: &mut [RunInfo]) {
    for i in 0..runs.len() {
        let (earlier, rest) = runs.split_at_mut(i);
        let run = &mut rest[0];
        run.queued = earlier.iter().any(|e| e.group_id == run.group_id && e.bot_id == run.bot_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::failed;

    fn start(run_id: &str, group: &str) -> ServerToDaemon {
        let mut raw: serde_json::Value =
            serde_json::from_str(include_str!("../../../packages/protocol/fixtures/s2d.run.start.json")).unwrap();
        raw["runId"] = run_id.into();
        raw["groupId"] = group.into();
        serde_json::from_value(raw).unwrap()
    }

    fn event(run_id: &str, event: RunEvent) -> DaemonToServer {
        DaemonToServer::RunEvent { run_id: run_id.into(), event }
    }

    #[test]
    fn tracks_runs_from_start_through_progress_to_done() {
        let m = Monitor::default();
        m.inbound(&start("r1", "g1"));
        m.inbound(&start("r2", "g1"));
        m.inbound(&start("r3", "g2"));
        let s = m.snapshot();
        let r1 = &s.runs[0];
        assert_eq!(
            (r1.bot_name.as_str(), r1.group_name.as_str(), r1.triggered_by.as_str()),
            ("小王的 Claude", "支付服务重构", "王磊")
        );
        assert_eq!((r1.status, r1.step.as_str()), (None, "准备工作区"));
        assert_eq!(s.runs.iter().map(|r| r.queued).collect::<Vec<_>>(), [false, true, false]);

        m.outbound(&event("r1", RunEvent::Text { delta: "x".into(), agent_id: None }));
        assert_eq!(m.snapshot().runs[0].status, Some(RunStatus::Running));
        m.outbound(&event(
            "r1",
            RunEvent::Status { status: RunStatus::AwaitingApproval, step: "等待审批：go build".into() },
        ));
        assert_eq!(m.snapshot().runs[0].step, "等待审批：go build");
        m.outbound(&event("r9", RunEvent::Text { delta: "unknown run".into(), agent_id: None }));

        m.outbound(&failed("r1", "x".into()));
        let s = m.snapshot();
        assert_eq!(
            s.runs.iter().map(|r| (r.run_id.as_str(), r.queued)).collect::<Vec<_>>(),
            [("r2", false), ("r3", false)]
        );
    }

    #[test]
    fn journals_each_run_process_and_keeps_it_after_the_run_ends() {
        let m = Monitor::default();
        m.inbound(&start("r1", "g1"));
        let text = |d: &str, agent: Option<&str>| RunEvent::Text { delta: d.into(), agent_id: agent.map(Into::into) };
        m.outbound(&event("r1", text("好", None)));
        m.outbound(&event("r1", text("的", None)));
        m.outbound(&event("r1", text("子", Some("a1"))));
        m.outbound(&event("r1", RunEvent::Thought { delta: "想".into(), agent_id: None }));
        m.outbound(&failed("r1", "x".into()));
        let task = RunEvent::Task {
            task_id: "bg1".into(),
            agent_id: None,
            tool_call_id: None,
            name: "pnpm dev".into(),
            task_type: "shell".into(),
            state: crate::protocol::TaskState::Completed,
            summary: None,
            output_path: None,
            can_stop: false,
        };
        m.outbound(&event("r1", task.clone()));

        let p = m.process("r1").unwrap();
        assert_eq!(p.outcome, Some(RunOutcome::Failed));
        assert!(p.ended_ms.is_some());
        let events: Vec<_> = p.events.iter().map(|e| e.event.clone()).collect();
        assert_eq!(
            events,
            [
                text("好的", None),
                text("子", Some("a1")),
                RunEvent::Thought { delta: "想".into(), agent_id: None },
                task
            ]
        );
        assert!(m.process("r9").is_none());

        for i in 0..KEEP_ENDED {
            let id = format!("x{i}");
            m.inbound(&start(&id, "g9"));
            m.outbound(&failed(&id, "x".into()));
        }
        assert!(m.process("r1").is_none(), "only the last {KEEP_ENDED} finished runs are kept");
        assert!(m.process("x0").is_some());
    }
}
