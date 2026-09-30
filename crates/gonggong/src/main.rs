use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use gonggong::bind::machine_info;
use gonggong::config::{self, Config};
use gonggong::configure;
use gonggong::daemon::{Daemon, Options};
use gonggong::diag::Status;
use gonggong::logs::LogLevel;
use gonggong::protocol::AgentKind;
use gonggong::protocol::RejectReason;
use gonggong::service::Fatal;
use gonggong::workspace::{Entry, EntryKind, human_size};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "gg", version, about = "Gonggong daemon: runs your team bots on this machine")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List agent CLIs and Node.js on this machine; install, upgrade or pick their download mirror.
    Agents {
        #[command(subcommand)]
        cmd: Option<gonggong::tools::AgentsCmd>,
    },
    /// Bind this machine to your account with a one-time code from the Web (头像菜单 → 绑定新机器): pass the 接入链接
    /// (gg login 'gonggong://bind?…') or --server and --code.
    Login {
        /// The 接入链接 copied from the Web.
        #[arg(conflicts_with_all = ["server", "code", "fingerprint"], required_unless_present_all = ["server", "code"])]
        link: Option<String>,
        #[arg(long, requires = "code")]
        server: Option<String>,
        #[arg(long, requires = "server")]
        code: Option<String>,
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
        #[arg(long, env = "GONGGONG_ADAPTER_CMD", hide = true)]
        adapter_cmd: Option<String>,
    },
    /// List the bots bound to this machine (they are managed on the Web).
    Bots,
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
    /// Local settings of this machine (a value of `default` restores the default).
    Config {
        #[command(subcommand)]
        cmd: ConfigCmd,
    },
    /// This machine's model providers (third-party endpoints and API keys); they never leave the machine.
    Provider {
        #[command(subcommand)]
        cmd: gonggong::provider_cli::ProviderCmd,
    },
}

#[derive(Subcommand)]
enum ConfigCmd {
    /// The agent CLI to use instead of the one found on PATH (models are chosen on the server).
    Agent {
        #[arg(value_parser = configure::parse_kind)]
        kind: AgentKind,
        #[arg(long)]
        path: String,
    },
}

fn config() -> anyhow::Result<Config> {
    Config::load()?.context("尚未绑定，请先执行 gg login")
}

fn workspaces(entries: &[Entry], backups: &[gonggong::workspace::Backup]) {
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
    let pairs = gonggong::workspace::fetch_pairs(config).await.unwrap_or_else(|e| {
        eprintln!("无法从服务器获取群与 Bot 信息（{e:#}），以下仅按本机目录列出");
        vec![]
    });
    gonggong::workspace::list(&config::home(), &pairs)
}

/// SIGTERM (service managers, `kill`) or Ctrl-C.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = term.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    // The daemon logs to <home>/logs as well; one-shot commands only to stderr.
    let _log_guard = match cli.cmd {
        Cmd::Run { .. } => Some(gonggong::logs::init(&config::home())?.1),
        _ => {
            tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_env("GONGGONG_LOG")).init();
            None
        }
    };
    match cli.cmd {
        Cmd::Agents { cmd } => gonggong::tools::cli(&config::home(), cmd).await?,
        Cmd::Login { link, server, code, fingerprint } => {
            let (server, code, fingerprint) = match (link, server, code) {
                (Some(link), _, _) => {
                    let link = gonggong::bind::parse_link(&link)?;
                    (link.server, link.code, link.fingerprint)
                }
                (None, Some(server), Some(code)) => (server, code, fingerprint),
                _ => unreachable!("clap requires a link or --server and --code"),
            };
            let machine = machine_info();
            let (config, restored) =
                gonggong::bind::login(&server, &code, machine.clone(), fingerprint.as_deref()).await?;
            config.save()?;
            if restored {
                println!("绑定成功：已恢复本机原有机器记录（{}），原有 Bot 绑定保持不变", machine.name);
            } else {
                println!("绑定成功：本机已归属 {}（{}）", config.owner_name, machine.name);
            }
            match (&config.cert_sha256, fingerprint) {
                (Some(fp), None) => println!(
                    "已固定服务器证书 sha256:{fp}\n请与管理员公布的指纹核对；不一致请立即执行 gg logout 并联系管理员"
                ),
                (Some(fp), Some(_)) => println!("已按指定指纹固定服务器证书 sha256:{fp}"),
                (None, _) => {}
            }
        }
        Cmd::Logout => {
            if let Some(config) = Config::load()?
                && let Err(e) = gonggong::bind::logout(&config).await
            {
                eprintln!("未能通知服务器（{e:#}），本机凭据仍会删除；如需停用该机器请在 Web 端移除");
            }
            Config::remove()?;
            println!("已退出登录；再次 gg login 会恢复这台机器及其 Bot");
        }
        Cmd::Status => match Config::load()? {
            Some(c) => println!("已绑定：{} · 归属 {} · 机器 {}", c.server, c.owner_name, c.machine_id),
            None => println!("未绑定"),
        },
        Cmd::Run { adapter_cmd } => {
            let options = Options { home: config::home(), config: config()?, adapter_cmd, self_upgrade: true };
            let daemon = Daemon::start(options)?;
            let services = daemon.services();
            let stopped = tokio::select! {
                stopped = daemon.wait() => stopped,
                _ = shutdown_signal() => {
                    // Hosted services (dev servers) never outlive the daemon.
                    services.stop_all().await;
                    std::process::exit(0)
                }
            };
            eprintln!("{}", stopped.fatal);
            if let Fatal::Rejected { reason: RejectReason::Revoked, .. } = stopped.fatal {
                eprintln!("本机已被吊销（账号停用或机器被吊销），清除托管工作区与本机凭据：");
                for path in stopped.wiped {
                    eprintln!("  已删除 {}", path.display());
                }
            }
            std::process::exit(1);
        }
        Cmd::Bots => gonggong::bots::list(&config()?).await?,
        Cmd::Net => {
            let r = gonggong::net::run(&config()?).await?;
            println!("延迟 {} ms · 带宽 {} Mbps（已上报服务器，仅管理员可见）", r.latency_ms, r.bandwidth_mbps);
        }
        Cmd::Doctor => {
            let checks = gonggong::diag::run(&config::home(), Config::load()?.as_ref()).await;
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
            workspaces(&list_workspaces(&config).await, &gonggong::workspace::backups(&config::home()));
        }
        Cmd::Workspaces { delete: Some(target), .. } => {
            let entries = list_workspaces(&config()?).await;
            let doomed: Vec<_> = entries.iter().filter(|e| e.matches(&target) && e.deletable()).collect();
            if doomed.is_empty() {
                bail!("「{target}」没有可删除的工作区（只能删除已移出或未使用的托管工作区）");
            }
            for e in doomed {
                gonggong::workspace::delete(&config::home(), e).map_err(anyhow::Error::msg)?;
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
            gonggong::workspace::reset_cd(&config, &e.group_id, &e.bot_id).await?;
            println!("已请求 {} 恢复托管工作区，结果见群消息", e.bot_label());
        }
        Cmd::Logs { level, lines, export: None } => {
            for l in gonggong::logs::read_recent(&config::home(), level, lines) {
                println!("{}", l.text);
            }
        }
        Cmd::Logs { export: Some(dest), .. } => {
            let dest = if dest.as_os_str().is_empty() { gonggong::diag::default_bundle_path() } else { dest };
            let config = Config::load()?;
            let checks = gonggong::diag::run(&config::home(), config.as_ref()).await;
            let names = gonggong::diag::bundle(&config::home(), config.as_ref(), &checks, &dest)?;
            println!("已导出诊断包 {}（{}）", dest.display(), names.join("、"));
        }
        Cmd::Config { cmd: ConfigCmd::Agent { kind, path } } => configure::agent(&config::home(), kind, path)?,
        Cmd::Provider { cmd } => gonggong::provider_cli::run(&config::home(), cmd).await?,
    }
    Ok(())
}
