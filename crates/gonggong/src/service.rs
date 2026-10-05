use crate::config::Config;
use crate::protocol::{
    AgentInfo, DaemonToServer, MachineInfo, PROTOCOL_VERSION, RejectReason, RunEvent, ServerToDaemon, ServiceInfo,
};
use crate::status::Monitor;
use crate::tls::Ws;
use crate::upgrade::{self, Upgrader};
use futures_util::{SinkExt, StreamExt};
use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::Message;

/// Byte budget of each of the two places a message waits before it is written: the outbox channel and the backlog.
/// Past it `run.event`s are shed (see [`over_budget`]); every other message is kept.
const MAX_QUEUED_BYTES: usize = 16 << 20;
/// A merged text/thought delta stops growing here; the next delta starts a new one.
const MAX_MERGED_DELTA: usize = 64 << 10;
/// Fixed weight of any message, so a flood of tiny events is bounded as well.
const MESSAGE_OVERHEAD: usize = 256;

/// Approximate memory a waiting message holds. Only streamed payloads are measured; the rest is small.
fn weight(msg: &DaemonToServer) -> usize {
    MESSAGE_OVERHEAD
        + match msg {
            DaemonToServer::RunEvent {
                event: RunEvent::Text { delta, .. } | RunEvent::Thought { delta, .. }, ..
            } => delta.len(),
            DaemonToServer::RunEvent { event: RunEvent::Tool { detail, mcp, .. }, .. } => {
                let mcp = mcp
                    .as_ref()
                    .map_or(0, |m| m.input.as_deref().map_or(0, str::len) + m.output.as_deref().map_or(0, str::len));
                detail.as_deref().map_or(0, str::len) + mcp
            }
            _ => 0,
        }
}

/// What of a run event still goes out once the budget is spent: streamed text and status/usage reports (superseded
/// by later ones) are dropped; a tool call keeps its state without its payloads; delegation changes are kept whole,
/// since nothing later repeats them.
fn over_budget(mut msg: DaemonToServer) -> Option<DaemonToServer> {
    match &mut msg {
        DaemonToServer::RunEvent {
            event: RunEvent::Text { .. } | RunEvent::Thought { .. } | RunEvent::Status { .. } | RunEvent::Usage { .. },
            ..
        } => return None,
        DaemonToServer::RunEvent { event: RunEvent::Tool { detail, mcp, .. }, .. } => {
            *detail = None;
            if let Some(m) = mcp {
                m.input = None;
                m.output = None;
            }
        }
        _ => {}
    }
    Some(msg)
}

#[derive(Default)]
struct Queued {
    bytes: AtomicUsize,
    dropping: AtomicBool,
}

/// Sender for daemon → server messages. Survives reconnects: messages queued while offline are flushed after the next welcome.
#[derive(Clone)]
pub struct Outbox {
    tx: mpsc::UnboundedSender<(DaemonToServer, usize)>,
    queued: Arc<Queued>,
}

/// Receiving end of an [`Outbox`]; taking a message out releases its bytes from the channel budget.
pub struct OutboxRx {
    rx: mpsc::UnboundedReceiver<(DaemonToServer, usize)>,
    queued: Arc<Queued>,
}

impl Outbox {
    pub fn channel() -> (Outbox, OutboxRx) {
        let (tx, rx) = mpsc::unbounded_channel();
        let queued = Arc::new(Queued::default());
        (Outbox { tx, queued: queued.clone() }, OutboxRx { rx, queued })
    }

    pub fn send(&self, mut msg: DaemonToServer) {
        if let DaemonToServer::RunEvent { run_id, .. } = &msg {
            if self.queued.bytes.load(Ordering::Relaxed) < MAX_QUEUED_BYTES {
                self.queued.dropping.store(false, Ordering::Relaxed);
            } else {
                if !self.queued.dropping.swap(true, Ordering::Relaxed) {
                    tracing::warn!(run_id, "outbox full, shedding run events");
                }
                let Some(kept) = over_budget(msg) else { return };
                msg = kept;
            }
        }
        let bytes = weight(&msg);
        self.queued.bytes.fetch_add(bytes, Ordering::Relaxed);
        let _ = self.tx.send((msg, bytes));
    }
}

impl OutboxRx {
    pub async fn recv(&mut self) -> Option<DaemonToServer> {
        let (msg, bytes) = self.rx.recv().await?;
        self.queued.bytes.fetch_sub(bytes, Ordering::Relaxed);
        Some(msg)
    }

    pub fn try_recv(&mut self) -> Result<DaemonToServer, mpsc::error::TryRecvError> {
        let (msg, bytes) = self.rx.try_recv()?;
        self.queued.bytes.fetch_sub(bytes, Ordering::Relaxed);
        Ok(msg)
    }

    pub fn is_empty(&self) -> bool {
        self.rx.is_empty()
    }
}

pub trait Handler: Send + Sync + 'static {
    /// Called for every server message after the handshake. Must not block; spawn long work.
    fn handle(&self, msg: ServerToDaemon, out: &Outbox);

    /// Runs still executing locally, reported in hello so the server can reconcile lost ones (M5).
    fn active_runs(&self) -> Vec<String> {
        Vec::new()
    }

    /// Welcomed by the server; `tunnel`: it serves previews over `/ws/daemon/tunnel` (older servers do not).
    fn connected(&self, _tunnel: bool) {}

    /// Hosted services still running, reported in hello so the server can mark the lost ones exited.
    fn services(&self) -> Vec<ServiceInfo> {
        Vec::new()
    }

    /// Optional capabilities announced in hello (`protocol::FEATURE_*`).
    fn features(&self) -> Vec<String> {
        Vec::new()
    }

    /// Sends state the server keeps in memory only; called after each welcome and each run.done.
    fn report(&self, _out: &Outbox) {}
}

#[derive(Debug, thiserror::Error)]
pub enum Fatal {
    #[error("server rejected this daemon ({reason:?}): {message}")]
    Rejected { reason: RejectReason, message: String },
}

/// Unsent daemon → server messages, kept across reconnects and flushed in order after the next welcome (spec §14).
/// Only `run.event`s are shed, once the byte budget is spent; streamed deltas are merged while they wait.
#[derive(Default)]
struct Backlog {
    msgs: VecDeque<DaemonToServer>,
    bytes: usize,
    dropping: bool,
}

impl Backlog {
    fn push(&mut self, mut msg: DaemonToServer) {
        if let DaemonToServer::RunEvent { run_id, .. } = &msg
            && self.bytes >= MAX_QUEUED_BYTES
        {
            if !std::mem::replace(&mut self.dropping, true) {
                tracing::warn!(run_id, "backlog full, shedding run events");
            }
            let Some(kept) = over_budget(msg) else { return };
            msg = kept;
        } else if let DaemonToServer::RunEvent { run_id, event } = &msg {
            self.dropping = false;
            if let Some(DaemonToServer::RunEvent { run_id: last_run, event: last }) = self.msgs.back_mut()
                && last_run == run_id
            {
                match (last, event) {
                    (RunEvent::Text { delta: a, agent_id: x }, RunEvent::Text { delta: b, agent_id: y })
                    | (RunEvent::Thought { delta: a, agent_id: x }, RunEvent::Thought { delta: b, agent_id: y })
                        if x == y && a.len() + b.len() <= MAX_MERGED_DELTA =>
                    {
                        self.bytes += b.len();
                        return a.push_str(b);
                    }
                    _ => {}
                }
            }
        }
        self.bytes += weight(&msg);
        self.msgs.push_back(msg);
    }

    fn front(&self) -> Option<&DaemonToServer> {
        self.msgs.front()
    }

    fn pop_front(&mut self) -> Option<DaemonToServer> {
        let msg = self.msgs.pop_front()?;
        self.bytes -= weight(&msg);
        Some(msg)
    }

    /// Runs whose run.done is still waiting here: they ended locally and must not be reconciled as lost.
    fn finished_runs(&self) -> impl Iterator<Item = String> + '_ {
        self.msgs.iter().filter_map(|m| match m {
            DaemonToServer::RunDone(d) => Some(d.run_id.clone()),
            _ => None,
        })
    }
}

pub struct Service<H: Handler> {
    pub config: Config,
    pub machine: MachineInfo,
    /// Local agent detection; changes after hello are reported as agents.update.
    pub agents: watch::Receiver<Vec<AgentInfo>>,
    pub handler: H,
    pub max_backoff: Duration,
    /// Self-upgrade when the server offers a newer build; `None` disables it.
    pub upgrader: Option<Upgrader>,
    pub monitor: Monitor,
}

impl<H: Handler> Service<H> {
    /// Runs until the server rejects us for good (protocol / revoked / unauthorized).
    pub async fn run(self) -> Fatal {
        let (outbox, mut rx) = Outbox::channel();
        let mut backlog = Backlog::default();
        let mut backoff = Duration::from_secs(1);
        self.monitor.agents(self.agents.borrow().clone());
        loop {
            let error = match self.session(&outbox, &mut rx, &mut backlog).await {
                Ok(Some(fatal)) => return fatal,
                Ok(None) => {
                    backoff = Duration::from_secs(1);
                    crate::t!("连接已断开").to_string()
                }
                Err(e) => {
                    tracing::warn!("connection failed: {e:#}");
                    format!("{e:#}")
                }
            };
            tracing::info!("reconnecting in {backoff:?}");
            self.monitor.offline(backoff, error);
            let wait = tokio::time::sleep(backoff);
            tokio::pin!(wait);
            loop {
                tokio::select! {
                    _ = &mut wait => break,
                    Some(msg) = rx.recv() => self.queue(&mut backlog, msg),
                }
            }
            backoff = (backoff * 2).min(self.max_backoff);
        }
    }

    fn queue(&self, backlog: &mut Backlog, msg: DaemonToServer) {
        self.monitor.outbound(&msg);
        backlog.push(msg);
    }

    /// One connection lifetime. `Ok(None)` = was connected then dropped; `Ok(Some)` = fatal reject.
    async fn session(
        &self,
        outbox: &Outbox,
        rx: &mut OutboxRx,
        backlog: &mut Backlog,
    ) -> anyhow::Result<Option<Fatal>> {
        let mut ws = crate::tls::connect_ws(&self.config).await?;
        while let Ok(msg) = rx.try_recv() {
            self.queue(backlog, msg);
        }
        // Each connection reports what it saw at hello, then only later changes.
        let mut agents = self.agents.clone();
        let mut active_runs = self.handler.active_runs();
        active_runs.extend(backlog.finished_runs());
        let hello = DaemonToServer::Hello {
            protocol: PROTOCOL_VERSION,
            token: self.config.token.clone(),
            daemon_version: upgrade::CURRENT.into(),
            machine: self.machine.clone(),
            agents: agents.borrow_and_update().clone(),
            active_runs,
            services: self.handler.services(),
            features: self.handler.features(),
        };
        send(&mut ws, &hello).await?;
        let heartbeat_sec = match next_msg(&mut ws).await? {
            ServerToDaemon::Welcome { heartbeat_sec, machine_id, upgrade, tunnel, release } => {
                tracing::info!(machine_id, "connected");
                self.monitor.online(heartbeat_sec);
                self.handler.connected(tunnel);
                self.handler.report(outbox);
                if let Some(up) = &self.upgrader {
                    up.server_release(release);
                    if let Some(info) = upgrade {
                        up.offer(info);
                    }
                }
                heartbeat_sec
            }
            ServerToDaemon::Reject { reason, message, upgrade, .. } => {
                if let (Some(up), Some(info), RejectReason::Protocol) = (&self.upgrader, upgrade, reason) {
                    up.apply_now(info).await;
                }
                return Ok(Some(Fatal::Rejected { reason, message }));
            }
            other => anyhow::bail!("unexpected first message {other:?}"),
        };
        let mut beat = tokio::time::interval(Duration::from_secs(heartbeat_sec.max(1)));
        beat.tick().await;
        let mut idle = tokio::time::interval(Duration::from_secs(1));
        // Latency = round trip of a WebSocket ping sent with each heartbeat (and right after welcome).
        let mut ping_at = Some(Instant::now());
        ws.send(Message::Ping(Default::default())).await?;
        loop {
            // A message leaves the backlog only once written: a failed send keeps it for the next connection.
            while let Some(msg) = backlog.front() {
                send(&mut ws, msg).await?;
                backlog.pop_front();
            }
            tokio::select! {
                incoming = ws.next() => match incoming {
                    Some(Ok(Message::Text(t))) => match serde_json::from_str::<ServerToDaemon>(&t) {
                        Ok(msg) => {
                            self.monitor.inbound(&msg);
                            self.handler.handle(msg, outbox);
                        }
                        Err(e) => tracing::warn!("ignoring unknown server message: {e}"),
                    },
                    Some(Ok(Message::Pong(_))) => {
                        if let Some(at) = ping_at.take() {
                            self.monitor.latency(at.elapsed());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return Ok(None),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(e.into()),
                },
                Some(out) = rx.recv() => {
                    let done = matches!(out, DaemonToServer::RunDone(_));
                    self.queue(backlog, out);
                    if done {
                        self.handler.report(outbox);
                    }
                }
                Ok(()) = agents.changed() => {
                    let list = agents.borrow_and_update().clone();
                    self.monitor.agents(list.clone());
                    send(&mut ws, &DaemonToServer::AgentsUpdate { agents: list }).await?;
                }
                _ = beat.tick() => {
                    send(&mut ws, &DaemonToServer::Heartbeat).await?;
                    self.monitor.heartbeat();
                    ping_at = Some(Instant::now());
                    ws.send(Message::Ping(Default::default())).await?;
                }
                _ = idle.tick() => {
                    // Restart into a staged build only when nothing runs or waits to be reported.
                    if let Some(up) = &self.upgrader
                        && up.staged().is_some()
                        && rx.is_empty()
                        && self.handler.active_runs().is_empty()
                    {
                        up.apply_staged();
                    }
                }
            }
        }
    }
}

async fn send(ws: &mut Ws, msg: &DaemonToServer) -> anyhow::Result<()> {
    ws.send(Message::text(serde_json::to_string(msg)?)).await?;
    Ok(())
}

async fn next_msg(ws: &mut Ws) -> anyhow::Result<ServerToDaemon> {
    while let Some(msg) = ws.next().await {
        if let Message::Text(t) = msg? {
            return Ok(serde_json::from_str(&t)?);
        }
    }
    anyhow::bail!("server closed during handshake")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::failed;
    use crate::protocol::{RunStatus, ToolStatus};

    fn event(run_id: &str, event: RunEvent) -> DaemonToServer {
        DaemonToServer::RunEvent { run_id: run_id.into(), event }
    }

    fn text(run_id: &str, delta: &str) -> DaemonToServer {
        event(run_id, RunEvent::Text { delta: delta.into(), agent_id: None })
    }

    /// A run.event that alone weighs about `bytes`.
    fn heavy(run_id: &str, bytes: usize) -> DaemonToServer {
        event(
            run_id,
            RunEvent::Tool {
                agent_id: None,
                tool_call_id: "t".into(),
                title: "t".into(),
                tool_kind: "execute".into(),
                status: ToolStatus::Completed,
                detail: Some("x".repeat(bytes)),
                mcp: None,
            },
        )
    }

    fn critical() -> Vec<DaemonToServer> {
        vec![
            failed("r1", "x".into()),
            DaemonToServer::ApprovalRequest(crate::protocol::ApprovalRequest {
                run_id: "r1".into(),
                request_id: "a1".into(),
                title: "t".into(),
                tool_kind: "execute".into(),
                detail: String::new(),
                options: Vec::new(),
            }),
            DaemonToServer::QuestionWithdraw { run_id: "r1".into(), request_id: "q1".into() },
        ]
    }

    #[test]
    fn merges_same_stream_deltas_only() {
        let mut b = Backlog::default();
        b.push(text("r1", "a"));
        b.push(text("r1", "b"));
        b.push(text("r2", "c"));
        assert_eq!(b.msgs.len(), 2);
        assert_eq!(b.msgs[0], text("r1", "ab"));
        b.push(event("r2", RunEvent::Text { delta: "d".into(), agent_id: Some("sub".into()) }));
        assert_eq!(b.msgs.len(), 3, "a subagent's text never merges into the main agent's");
    }

    #[test]
    fn a_merged_delta_stops_growing_at_its_cap() {
        let mut b = Backlog::default();
        let piece = "y".repeat(1000);
        let pieces = 3 * MAX_MERGED_DELTA / piece.len();
        for _ in 0..pieces {
            b.push(text("r1", &piece));
        }
        let deltas: Vec<_> = b
            .msgs
            .iter()
            .map(|m| match m {
                DaemonToServer::RunEvent { event: RunEvent::Text { delta, .. }, .. } => delta.len(),
                other => panic!("unexpected {other:?}"),
            })
            .collect();
        assert!(deltas.len() >= 3, "{deltas:?}");
        assert!(deltas.iter().all(|n| *n <= MAX_MERGED_DELTA), "{deltas:?}");
        assert_eq!(deltas.iter().sum::<usize>(), pieces * piece.len(), "nothing lost, order kept");
    }

    fn delegation(run_id: &str) -> DaemonToServer {
        event(
            run_id,
            RunEvent::Subagent {
                agent_id: "a1".into(),
                parent_id: None,
                name: "n".into(),
                task: "t".into(),
                state: crate::protocol::SubagentState::Completed,
            },
        )
    }

    fn detail(msg: &DaemonToServer) -> Option<&str> {
        match msg {
            DaemonToServer::RunEvent { event: RunEvent::Tool { detail, .. }, .. } => detail.as_deref(),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn over_budget_sheds_only_streamed_and_superseded_events_and_keeps_order() {
        let mut b = Backlog::default();
        let mut pushed = 0;
        while b.bytes < MAX_QUEUED_BYTES {
            b.push(heavy("r1", 1 << 20));
            pushed += 1;
        }
        let before = b.msgs.len();
        b.push(text("r1", "late"));
        b.push(event("r1", RunEvent::Status { status: RunStatus::Running, step: "s".into() }));
        assert_eq!(b.msgs.len(), before, "streamed text and status reports are dropped once the budget is spent");
        b.push(heavy("r1", 10));
        b.push(delegation("r1"));
        assert_eq!(b.msgs.len(), before + 2, "state changes are kept");
        assert_eq!(detail(&b.msgs[before]), None, "a tool call keeps its state without its detail");
        for msg in critical() {
            b.push(msg);
        }
        assert_eq!(b.msgs.len(), pushed + 5, "critical messages are never dropped");
        assert!(matches!(b.msgs[pushed + 2], DaemonToServer::RunDone(_)));
        assert!(matches!(b.msgs[pushed + 3], DaemonToServer::ApprovalRequest(_)));
        assert!(matches!(b.msgs[pushed + 4], DaemonToServer::QuestionWithdraw { .. }));
        assert_eq!(b.finished_runs().collect::<Vec<_>>(), vec!["r1".to_string()]);

        while b.pop_front().is_some() {}
        assert_eq!(b.bytes, 0, "bytes are released as messages are sent");
        b.push(text("r1", "again"));
        assert_eq!(b.msgs.len(), 1, "run events are accepted again once there is room");
    }

    #[test]
    fn many_tiny_events_are_bounded_too() {
        let mut b = Backlog::default();
        let step = |i: usize| RunEvent::Status { status: RunStatus::Running, step: i.to_string() };
        for i in 0..2 * MAX_QUEUED_BYTES / MESSAGE_OVERHEAD {
            b.push(event("r1", step(i)));
        }
        assert!(b.msgs.len() <= MAX_QUEUED_BYTES / MESSAGE_OVERHEAD + 1, "each message weighs at least its overhead");
    }

    #[tokio::test]
    async fn the_channel_is_bounded_by_the_same_budget() {
        let (out, mut rx) = Outbox::channel();
        let mut sent = 0;
        while sent < 2 * MAX_QUEUED_BYTES / (1 << 20) {
            out.send(heavy("r1", 1 << 20));
            out.send(text("r1", "x"));
            sent += 1;
        }
        for msg in critical() {
            out.send(msg);
        }
        let mut got = Vec::new();
        while let Ok(msg) = rx.try_recv() {
            got.push(msg);
        }
        let tools: Vec<_> =
            got.iter().filter(|m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Tool { .. }, .. })).collect();
        assert_eq!(tools.len(), sent, "every tool call's state arrives");
        let full = tools.iter().filter(|m| detail(m).is_some()).count();
        assert!(full <= MAX_QUEUED_BYTES / (1 << 20) + 1, "kept {full} details of {sent}");
        let texts =
            got.iter().filter(|m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).count();
        assert!(texts < sent, "streamed text is dropped past the budget");
        let events = tools.len() + texts;
        assert!(matches!(got[events], DaemonToServer::RunDone(_)));
        assert_eq!(got.len(), events + 3, "critical messages follow in order");

        out.send(text("r1", "after"));
        assert!(rx.try_recv().is_ok(), "receiving released the budget");
    }
}
