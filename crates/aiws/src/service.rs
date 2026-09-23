use crate::config::Config;
use crate::protocol::{
    AgentInfo, DaemonToServer, MachineInfo, PROTOCOL_VERSION, RejectReason, RunEvent, ServerToDaemon,
};
use crate::tls::Ws;
use crate::upgrade::{self, Upgrader};
use futures_util::{SinkExt, StreamExt};
use std::collections::VecDeque;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

/// Sender for daemon → server messages. Survives reconnects: messages queued while offline are flushed after the next welcome.
#[derive(Clone)]
pub struct Outbox(mpsc::UnboundedSender<DaemonToServer>);

impl Outbox {
    pub fn channel() -> (Outbox, mpsc::UnboundedReceiver<DaemonToServer>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Outbox(tx), rx)
    }

    pub fn send(&self, msg: DaemonToServer) {
        let _ = self.0.send(msg);
    }
}

pub trait Handler: Send + Sync + 'static {
    /// Called for every server message after the handshake. Must not block; spawn long work.
    fn handle(&self, msg: ServerToDaemon, out: &Outbox);

    /// Runs still executing locally, reported in hello so the server can reconcile lost ones (M5).
    fn active_runs(&self) -> Vec<String> {
        Vec::new()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Fatal {
    #[error("server rejected this daemon ({reason:?}): {message}")]
    Rejected { reason: RejectReason, message: String },
}

/// Unsent daemon → server messages, kept across reconnects and flushed in order after the next welcome (spec §14).
/// Only `run.event`s may be dropped, once the backlog is full; streamed deltas are merged while they wait.
#[derive(Default)]
struct Backlog(VecDeque<DaemonToServer>);

const MAX_BACKLOG: usize = 10_000;

impl Backlog {
    fn push(&mut self, msg: DaemonToServer) {
        if let DaemonToServer::RunEvent { run_id, event } = &msg {
            if let Some(DaemonToServer::RunEvent { run_id: last_run, event: last }) = self.0.back_mut()
                && last_run == run_id
            {
                match (last, event) {
                    (RunEvent::Text { delta: a }, RunEvent::Text { delta: b })
                    | (RunEvent::Thought { delta: a }, RunEvent::Thought { delta: b }) => return a.push_str(b),
                    _ => {}
                }
            }
            if self.0.len() >= MAX_BACKLOG {
                return tracing::warn!(run_id, "backlog full, dropping a run event");
            }
        }
        self.0.push_back(msg);
    }

    /// Runs whose run.done is still waiting here: they ended locally and must not be reconciled as lost.
    fn finished_runs(&self) -> impl Iterator<Item = String> + '_ {
        self.0.iter().filter_map(|m| match m {
            DaemonToServer::RunDone(d) => Some(d.run_id.clone()),
            _ => None,
        })
    }
}

pub struct Service<H: Handler> {
    pub config: Config,
    pub machine: MachineInfo,
    pub agents: Vec<AgentInfo>,
    pub handler: H,
    pub max_backoff: Duration,
    /// Self-upgrade when the server offers a newer build; `None` disables it.
    pub upgrader: Option<Upgrader>,
}

impl<H: Handler> Service<H> {
    /// Runs until the server rejects us for good (protocol / revoked / unauthorized).
    pub async fn run(self) -> Fatal {
        let (outbox, mut rx) = Outbox::channel();
        let mut backlog = Backlog::default();
        let mut backoff = Duration::from_secs(1);
        loop {
            match self.session(&outbox, &mut rx, &mut backlog).await {
                Ok(Some(fatal)) => return fatal,
                Ok(None) => backoff = Duration::from_secs(1),
                Err(e) => tracing::warn!("connection failed: {e:#}"),
            }
            tracing::info!("reconnecting in {backoff:?}");
            let wait = tokio::time::sleep(backoff);
            tokio::pin!(wait);
            loop {
                tokio::select! {
                    _ = &mut wait => break,
                    Some(msg) = rx.recv() => backlog.push(msg),
                }
            }
            backoff = (backoff * 2).min(self.max_backoff);
        }
    }

    /// One connection lifetime. `Ok(None)` = was connected then dropped; `Ok(Some)` = fatal reject.
    async fn session(
        &self,
        outbox: &Outbox,
        rx: &mut mpsc::UnboundedReceiver<DaemonToServer>,
        backlog: &mut Backlog,
    ) -> anyhow::Result<Option<Fatal>> {
        let mut ws = crate::tls::connect_ws(&self.config).await?;
        while let Ok(msg) = rx.try_recv() {
            backlog.push(msg);
        }
        let mut active_runs = self.handler.active_runs();
        active_runs.extend(backlog.finished_runs());
        let hello = DaemonToServer::Hello {
            protocol: PROTOCOL_VERSION,
            token: self.config.token.clone(),
            daemon_version: upgrade::CURRENT.into(),
            machine: self.machine.clone(),
            agents: self.agents.clone(),
            active_runs,
        };
        send(&mut ws, &hello).await?;
        let heartbeat_sec = match next_msg(&mut ws).await? {
            ServerToDaemon::Welcome { heartbeat_sec, machine_id, upgrade } => {
                tracing::info!(machine_id, "connected");
                if let (Some(up), Some(info)) = (&self.upgrader, upgrade) {
                    up.offer(info);
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
        loop {
            // A message leaves the backlog only once written: a failed send keeps it for the next connection.
            while let Some(msg) = backlog.0.front() {
                send(&mut ws, msg).await?;
                backlog.0.pop_front();
            }
            tokio::select! {
                incoming = ws.next() => match incoming {
                    Some(Ok(Message::Text(t))) => match serde_json::from_str::<ServerToDaemon>(&t) {
                        Ok(msg) => self.handler.handle(msg, outbox),
                        Err(e) => tracing::warn!("ignoring unknown server message: {e}"),
                    },
                    Some(Ok(Message::Close(_))) | None => return Ok(None),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(e.into()),
                },
                Some(out) = rx.recv() => backlog.push(out),
                _ = beat.tick() => send(&mut ws, &DaemonToServer::Heartbeat).await?,
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

    fn event(run_id: &str, event: RunEvent) -> DaemonToServer {
        DaemonToServer::RunEvent { run_id: run_id.into(), event }
    }

    #[test]
    fn merges_deltas_and_drops_only_run_events_when_full() {
        let mut b = Backlog::default();
        b.push(event("r1", RunEvent::Text { delta: "a".into() }));
        b.push(event("r1", RunEvent::Text { delta: "b".into() }));
        b.push(event("r2", RunEvent::Text { delta: "c".into() }));
        assert_eq!(b.0.len(), 2);
        assert_eq!(b.0[0], event("r1", RunEvent::Text { delta: "ab".into() }));

        let tool = |i: usize| RunEvent::Status { status: crate::protocol::RunStatus::Running, step: i.to_string() };
        for i in 0..MAX_BACKLOG {
            b.push(event("r1", tool(i)));
        }
        assert_eq!(b.0.len(), MAX_BACKLOG);
        b.push(failed("r1", "x".into()));
        assert_eq!(b.0.len(), MAX_BACKLOG + 1, "run.done is never dropped");
        assert_eq!(b.finished_runs().collect::<Vec<_>>(), vec!["r1".to_string()]);
    }
}
