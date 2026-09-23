use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "aiws", version, about = "AIWS daemon: runs your team bots on this machine")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List agent CLIs detected on this machine.
    Agents,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_env("AIWS_LOG")).init();
    match Cli::parse().cmd {
        Cmd::Agents => {
            for a in aiws::agents::detect() {
                println!("{:?}\t{}\t{}", a.kind, a.version.as_deref().unwrap_or("-"), a.path.as_deref().unwrap_or("未安装"));
            }
        }
    }
    Ok(())
}
