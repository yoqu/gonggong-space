use crate::config::Config;
use crate::protocol::{AgentInfo, DaemonToServer, MachineInfo, PROTOCOL_VERSION, RejectReason, ServerToDaemon};
use futures_util::{SinkExt, StreamExt};
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

pub struct Service<H: Handler> {
    pub config: Config,
    pub machine: MachineInfo,
    pub agents: Vec<AgentInfo>,
    pub handler: H,
    pub max_backoff: Duration,
}

impl<H: Handler> Service<H> {
    /// Runs until the server rejects us for good (protocol / revoked / unauthorized).
    pub async fn run(self) -> Fatal {
        let (outbox, mut rx) = Outbox::channel();
        let mut backoff = Duration::from_secs(1);
        loop {
            match self.session(&outbox, &mut rx).await {
                Ok(Some(fatal)) => return fatal,
                Ok(None) => backoff = Duration::from_secs(1),
                Err(e) => tracing::warn!("connection failed: {e:#}"),
            }
            tracing::info!("reconnecting in {backoff:?}");
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(self.max_backoff);
        }
    }

    /// One connection lifetime. `Ok(None)` = was connected then dropped; `Ok(Some)` = fatal reject.
    async fn session(
        &self,
        outbox: &Outbox,
        rx: &mut mpsc::UnboundedReceiver<DaemonToServer>,
    ) -> anyhow::Result<Option<Fatal>> {
        let (mut ws, _) = tokio_tungstenite::connect_async(self.config.ws_url()).await?;
        let hello = DaemonToServer::Hello {
            protocol: PROTOCOL_VERSION,
            token: self.config.token.clone(),
            daemon_version: env!("CARGO_PKG_VERSION").into(),
            machine: self.machine.clone(),
            agents: self.agents.clone(),
            active_runs: self.handler.active_runs(),
        };
        ws.send(Message::text(serde_json::to_string(&hello)?)).await?;
        let heartbeat_sec = match next_msg(&mut ws).await? {
            ServerToDaemon::Welcome { heartbeat_sec, machine_id, .. } => {
                tracing::info!(machine_id, "connected");
                heartbeat_sec
            }
            ServerToDaemon::Reject { reason, message, .. } => return Ok(Some(Fatal::Rejected { reason, message })),
            other => anyhow::bail!("unexpected first message {other:?}"),
        };
        let mut beat = tokio::time::interval(Duration::from_secs(heartbeat_sec.max(1)));
        beat.tick().await;
        loop {
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
                Some(out) = rx.recv() => ws.send(Message::text(serde_json::to_string(&out)?)).await?,
                _ = beat.tick() => ws.send(Message::text(serde_json::to_string(&DaemonToServer::Heartbeat)?)).await?,
            }
        }
    }
}

async fn next_msg<S>(ws: &mut S) -> anyhow::Result<ServerToDaemon>
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    while let Some(msg) = ws.next().await {
        if let Message::Text(t) = msg? {
            return Ok(serde_json::from_str(&t)?);
        }
    }
    anyhow::bail!("server closed during handshake")
}
