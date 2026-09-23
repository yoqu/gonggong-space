use aiws::bind::machine_info;
use aiws::config::{self, Config};
use aiws::diag::Status;
use aiws::engine::{Engine, EngineConfig};
use aiws::logs::LogLevel;
use aiws::protocol::RejectReason;
use aiws::service::{Fatal, Service};
use aiws::upgrade::Upgrader;
use aiws::workspace::{Entry, EntryKind, human_size};
use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
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
    /// Measure latency and bandwidth to the server and report them (shown to admins only).
    Net,
    /// Check the server connection, agents, git credentials, disk and line endings.
    Doctor,
    /// List this machine's workspaces and local backups.
    Workspaces {
        /// Delete the removed / unused managed workspaces of <group>/<bot> (ids or names). /cd dirs are never deleted.
        #[arg(long, value_name = "GROUP/BOT")]
        delete: Option<String>,
        /// Point a /cd-bound <group>/<bot> back at its managed clone (same as `/cd @bot --reset`).
        #[arg(long, value_name = "GROUP/BOT", conflicts_with = "delete")]
        reset_cd: Option<String>,
    },
    /// Show recent daemon log lines, or export a redacted diagnostics bundle.
    Logs {
        #[arg(long, value_enum, default_value = "info")]
        level: LogLevel,
        #[arg(long, default_value_t = 200)]
        lines: usize,
        /// Write a diagnostics .zip (redacted logs, checks, versions, config without the token).
        #[arg(long, value_name = "PATH.zip", num_args = 0..=1, default_missing_value = "")]
        export: Option<PathBuf>,
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

fn workspaces(entries: &[Entry], backups: &[aiws::workspace::Backup]) {
    if entries.is_empty() {
        println!("本机还没有工作区");
    }
    for e in entries {
        let who = format!("{} × {}", e.group_label(), e.bot_label());
        println!("{who}\t{}\t{}\t{}", e.kind_label(), e.path.display(), e.state_label());
    }
    println!("\n本机备份 · 不上传");
    if backups.is_empty() {
        println!("（无）");
    }
    for b in backups {
        println!("{}\t{}\t{}", b.name, human_size(b.size), b.path.display());
    }
}

async fn list_workspaces(config: &Config) -> Vec<Entry> {
    let pairs = aiws::workspace::fetch_pairs(config).await.unwrap_or_else(|e| {
        eprintln!("无法从服务器获取群与 bot 信息（{e:#}），以下仅按本机目录列出");
        vec![]
    });
    aiws::workspace::list(&config::home(), &pairs)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    // The daemon logs to <home>/logs as well; one-shot commands only to stderr.
    let _log_guard = match cli.cmd {
        Cmd::Run { .. } => Some(aiws::logs::init(&config::home())?.1),
        _ => {
            tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_env("AIWS_LOG")).init();
            None
        }
    };
    match cli.cmd {
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
                agents: aiws::agents::detect(),
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
        Cmd::Net => {
            let r = aiws::net::run(&config()?).await?;
            println!("延迟 {} ms · 带宽 {} Mbps（已上报服务器，仅管理员可见）", r.latency_ms, r.bandwidth_mbps);
        }
        Cmd::Doctor => {
            let checks = aiws::diag::run(&config::home(), Config::load()?.as_ref()).await;
            for c in &checks {
                let mark = match c.status {
                    Status::Ok => "✓",
                    Status::Warn => "!",
                    Status::Error => "✗",
                    Status::Skipped => "-",
                };
                println!("{mark} {}\t{}", c.label, c.detail);
            }
            if checks.iter().any(|c| c.status == Status::Error) {
                std::process::exit(1);
            }
        }
        Cmd::Workspaces { delete: None, reset_cd: None } => {
            let config = config()?;
            workspaces(&list_workspaces(&config).await, &aiws::workspace::backups(&config::home()));
        }
        Cmd::Workspaces { delete: Some(target), .. } => {
            let entries = list_workspaces(&config()?).await;
            let doomed: Vec<_> = entries.iter().filter(|e| e.matches(&target) && e.deletable()).collect();
            if doomed.is_empty() {
                bail!("「{target}」没有可删除的工作区（只能删除已移出或未使用的托管工作区）");
            }
            for e in doomed {
                aiws::workspace::delete(&config::home(), e).map_err(anyhow::Error::msg)?;
                println!("已删除 {}（{}）", e.path.display(), e.size.map(human_size).unwrap_or_default());
            }
        }
        Cmd::Workspaces { reset_cd: Some(target), .. } => {
            let config = config()?;
            let entries = list_workspaces(&config).await;
            let e = entries
                .iter()
                .find(|e| e.matches(&target) && e.kind == EntryKind::Cd)
                .with_context(|| format!("「{target}」不是 /cd 绑定的工作区"))?;
            aiws::workspace::reset_cd(&config, &e.group_id, &e.bot_id).await?;
            println!("已请求 {} 恢复托管工作区，结果见群消息", e.bot_label());
        }
        Cmd::Logs { level, lines, export: None } => {
            for l in aiws::logs::read_recent(&config::home(), level, lines) {
                println!("{}", l.text);
            }
        }
        Cmd::Logs { export: Some(dest), .. } => {
            let dest = if dest.as_os_str().is_empty() { aiws::diag::default_bundle_path() } else { dest };
            let config = Config::load()?;
            let checks = aiws::diag::run(&config::home(), config.as_ref()).await;
            let names = aiws::diag::bundle(&config::home(), config.as_ref(), &checks, &dest)?;
            println!("已导出诊断包 {}（{}）", dest.display(), names.join("、"));
        }
    }
    Ok(())
}
