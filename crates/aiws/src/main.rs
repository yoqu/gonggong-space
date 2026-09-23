use aiws::bind::machine_info;
use aiws::config::{self, Config};
use aiws::engine::{Engine, EngineConfig};
use aiws::service::Service;
use anyhow::Context;
use clap::{Parser, Subcommand};
use std::time::Duration;

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
    /// Bind this machine to your account with a one-time code from the Web (头像菜单 → 绑定新机器).
    Login {
        #[arg(long)]
        server: String,
        #[arg(long)]
        code: String,
    },
    /// Unbind this machine locally (removes the saved token).
    Logout,
    /// Show which server and owner this machine is bound to.
    Status,
    /// Connect to the server and run bots dispatched to this machine.
    Run {
        /// Replace the ACP adapter command for every agent (debugging / tests).
        #[arg(long, env = "AIWS_ADAPTER_CMD", hide = true)]
        adapter_cmd: Option<String>,
    },
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

fn config() -> anyhow::Result<Config> {
    Config::load()?.context("尚未绑定，请先执行 aiws login")
}

const IDLE_REAP: Duration = Duration::from_secs(10 * 60);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_env("AIWS_LOG")).init();
    match Cli::parse().cmd {
        Cmd::Agents => {
            for a in aiws::agents::detect() {
                println!(
                    "{:?}\t{}\t{}",
                    a.kind,
                    a.version.as_deref().unwrap_or("-"),
                    a.path.as_deref().unwrap_or("未安装")
                );
            }
        }
        Cmd::Login { server, code } => {
            let machine = machine_info();
            let config = aiws::bind::login(&server, &code, machine.clone()).await?;
            config.save()?;
            println!("绑定成功：本机已归属 {}（{}）", config.owner_name, machine.name);
        }
        Cmd::Logout => {
            Config::remove()?;
            println!("已解除本机绑定");
        }
        Cmd::Status => match Config::load()? {
            Some(c) => println!("已绑定：{} · 归属 {} · 机器 {}", c.server, c.owner_name, c.machine_id),
            None => println!("未绑定"),
        },
        Cmd::Run { adapter_cmd } => {
            let config = config()?;
            let service = Service {
                config: config.clone(),
                machine: machine_info(),
                agents: aiws::agents::detect(),
                handler: Engine::new(EngineConfig {
                    home: config::home(),
                    adapter_cmd,
                    idle: IDLE_REAP,
                    api: Some(config),
                }),
                max_backoff: MAX_BACKOFF,
            };
            let fatal = service.run().await;
            eprintln!("{fatal}");
            std::process::exit(1);
        }
        Cmd::Bots { cmd: None } => aiws::bots::list(&config()?).await?,
        Cmd::Bots { cmd: Some(BotsCmd::Confirm { target }) } => aiws::bots::confirm(&config()?, &target).await?,
    }
    Ok(())
}
