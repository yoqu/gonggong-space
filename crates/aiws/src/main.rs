use aiws::bind::machine_info;
use aiws::config::{self, Config};
use aiws::configure::{self, BotChange};
use aiws::engine::{Engine, EngineConfig};
use aiws::local::{Approval, LocalSettings};
use aiws::protocol::AgentKind;
use aiws::protocol::RejectReason;
use aiws::service::{Fatal, Service};
use aiws::upgrade::Upgrader;
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
        /// Expected server certificate SHA-256 (sha256:AB:CD:…) as published by the admin; without it the certificate
        /// presented now is trusted and printed for you to compare.
        #[arg(long)]
        fingerprint: Option<String>,
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
    /// Local settings of this machine (a value of `default` restores the default).
    Config {
        #[command(subcommand)]
        cmd: ConfigCmd,
    },
}

#[derive(Subcommand)]
enum ConfigCmd {
    /// Agent CLI path, default model and reasoning effort.
    Agent {
        #[arg(value_parser = configure::parse_kind)]
        kind: AgentKind,
        /// Model for bots without their own, as the adapter names it (see `aiws agents`).
        #[arg(long)]
        model: Option<String>,
        /// Reasoning effort (Claude effort / Codex reasoning_effort), e.g. low, medium, high.
        #[arg(long)]
        effort: Option<String>,
        /// The agent CLI to use instead of the one found on PATH.
        #[arg(long)]
        path: Option<String>,
    },
    /// A bot's model, command approval and concurrency.
    Bot {
        /// Bot name or id.
        target: String,
        #[arg(long)]
        model: Option<String>,
        /// ask = 每次询问, allowlist = 白名单自动, all = 全部自动.
        #[arg(long, value_enum)]
        approval: Option<Approval>,
        /// Add a command prefix to the allowlist, e.g. "go build" (repeatable).
        #[arg(long)]
        allow: Vec<String>,
        /// Remove a command prefix from the allowlist (repeatable).
        #[arg(long)]
        disallow: Vec<String>,
        #[arg(long, value_parser = clap::value_parser!(u32).range(1..=8))]
        concurrency: Option<u32>,
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
        Cmd::Agents => configure::print_agents(&config::home())?,
        Cmd::Login { server, code, fingerprint } => {
            let machine = machine_info();
            let config = aiws::bind::login(&server, &code, machine.clone(), fingerprint.as_deref()).await?;
            config.save()?;
            println!("绑定成功：本机已归属 {}（{}）", config.owner_name, machine.name);
            match (&config.cert_sha256, fingerprint) {
                (Some(fp), None) => println!(
                    "已固定服务器证书 sha256:{fp}\n请与管理员公布的指纹核对；不一致请立即执行 aiws logout 并联系管理员"
                ),
                (Some(fp), Some(_)) => println!("已按指定指纹固定服务器证书 sha256:{fp}"),
                (None, _) => {}
            }
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
                agents: aiws::agents::detect(&LocalSettings::load(&config::home())?),
                handler: Engine::new(EngineConfig {
                    home: config::home(),
                    adapter_cmd,
                    idle: IDLE_REAP,
                    api: Some(config.clone()),
                }),
                max_backoff: MAX_BACKOFF,
                upgrader: Upgrader::from_env(config::home(), &config)?,
            };
            let fatal = service.run().await;
            eprintln!("{fatal}");
            if let Fatal::Rejected { reason: RejectReason::Revoked, .. } = fatal {
                eprintln!("本机已被吊销（账号停用或机器被吊销），清除托管工作区与本机凭据：");
                for path in aiws::revoke::wipe(&config::home()) {
                    eprintln!("  已删除 {}", path.display());
                }
            }
            std::process::exit(1);
        }
        Cmd::Bots { cmd: None } => aiws::bots::list(&config()?).await?,
        Cmd::Bots { cmd: Some(BotsCmd::Confirm { target }) } => aiws::bots::confirm(&config()?, &target).await?,
        Cmd::Config { cmd: ConfigCmd::Agent { kind, model, effort, path } } => {
            configure::agent(&config::home(), kind, model, effort, path)?
        }
        Cmd::Config { cmd: ConfigCmd::Bot { target, model, approval, allow, disallow, concurrency } } => {
            let change = BotChange { model, approval, allow, disallow, concurrency };
            configure::bot(&config()?, &config::home(), &target, change).await?
        }
    }
    Ok(())
}
