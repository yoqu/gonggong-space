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
    /// List the bots bound to this machine.
    Bots {
        #[command(subcommand)]
        cmd: Option<BotsCmd>,
    },
}

#[derive(Subcommand)]
enum BotsCmd {
    /// Confirm a bot someone else created for you on this machine.
    Confirm {
        /// Bot name or id.
        target: String,
    },
}

fn config() -> anyhow::Result<aiws::config::Config> {
    aiws::config::Config::load()?.ok_or_else(|| anyhow::anyhow!("本机尚未绑定，请先运行 aiws login"))
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
        Cmd::Bots { cmd: None } => aiws::bots::list(&config()?).await?,
        Cmd::Bots { cmd: Some(BotsCmd::Confirm { target }) } => aiws::bots::confirm(&config()?, &target).await?,
    }
    Ok(())
}
