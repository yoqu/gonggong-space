use crate::protocol::{DaemonToServer, ServerToDaemon};
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

/// Performs the hello handshake and returns the server's first reply.
pub async fn handshake(url: &str, hello: &DaemonToServer) -> Result<ServerToDaemon> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.with_context(|| format!("connect {url}"))?;
    ws.send(Message::text(serde_json::to_string(hello)?)).await?;
    while let Some(msg) = ws.next().await {
        if let Message::Text(t) = msg? {
            return Ok(serde_json::from_str(&t)?);
        }
    }
    bail!("server closed before replying")
}
