use aiws::conn::handshake;
use aiws::protocol::{DaemonToServer, MachineInfo, PROTOCOL_VERSION, ServerToDaemon};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "aiws", version, about = "AIWS daemon")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Handshake with the server once and print the result.
    Ping {
        #[arg(long, env = "AIWS_SERVER")]
        server: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Ping { server } => {
            let hello = DaemonToServer::Hello {
                protocol: PROTOCOL_VERSION,
                daemon_version: env!("CARGO_PKG_VERSION").into(),
                machine: MachineInfo { name: "ping".into(), os: std::env::consts::OS.into(), arch: std::env::consts::ARCH.into() },
                agents: vec![],
            };
            match handshake(&format!("{}/ws/daemon", server.trim_end_matches('/').replacen("http", "ws", 1)), &hello).await? {
                ServerToDaemon::Welcome { heartbeat_sec, .. } => println!("welcome heartbeat={heartbeat_sec}s"),
                ServerToDaemon::Reject { message, .. } => anyhow::bail!("rejected: {message}"),
            }
        }
    }
    Ok(())
}
