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
use gonggong::t;
use gonggong::workspace::{Entry, EntryKind, human_size};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "gg", version, about = "Gonggong daemon: runs your team bots on this machine")]
struct Cli {
    /// Output language: zh or en (default: GG_LANG, then LC_ALL / LC_MESSAGES / LANG; Chinese unless another language).
    #[arg(long, global = true, env = "GG_LANG", value_name = "zh|en")]
    lang: Option<String>,
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
        #[arg(conflicts_with_all = ["server", "code"], required_unless_present_all = ["server", "code"])]
        link: Option<String>,
        #[arg(long, requires = "code")]
        server: Option<String>,
        #[arg(long, requires = "server")]
        code: Option<String>,
        /// Ignored: certificates are no longer pinned (accepted for commands copied from older servers).
        #[arg(long, hide = true)]
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
    Config::load()?.context(t!("尚未绑定，请先执行 gg login"))
}

fn workspaces(entries: &[Entry], backups: &[gonggong::workspace::Backup]) {
    if entries.is_empty() {
        println!("{}", t!("本机还没有工作区"));
    }
    for e in entries {
        let who = format!("{} × {}", e.group_label(), e.bot_label());
        println!("{who}\t{}\t{}\t{}", e.kind_label(), e.path.display(), e.state_label());
    }
    println!("\n{}", t!("本机备份 · 不上传"));
    if backups.is_empty() {
        println!("{}", t!("（无）"));
    }
    for b in backups {
        println!("{}\t{}\t{}", b.name, human_size(b.size), b.path.display());
    }
}

async fn list_workspaces(config: &Config) -> Vec<Entry> {
    let pairs = gonggong::workspace::fetch_pairs(config).await.unwrap_or_else(|e| {
        eprintln!("{}", t!("无法从服务器获取群与 Bot 信息（{e}），以下仅按本机目录列出", e = format!("{e:#}")));
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

/// Double-clicked in Explorer: the console is gg's own and closes the moment it exits, so the usage would only flash
/// by. Explain how to run it instead and keep the window until Enter.
#[cfg(windows)]
fn explain_double_click() {
    let mut pids = [0u32; 2];
    // SAFETY: the buffer outlives the call, which writes at most its length.
    let alone = unsafe { windows::Win32::System::Console::GetConsoleProcessList(&mut pids) } == 1;
    if !alone || std::env::args_os().len() > 1 {
        return;
    }
    let _ = <Cli as clap::CommandFactory>::command().print_help();
    let exe = std::env::current_exe().ok();
    let exe = exe.as_ref().and_then(|p| p.file_name()).map_or("gg.exe".into(), |n| n.to_string_lossy());
    println!(
        "\n{}",
        t!(
            "{exe} 是命令行程序，双击不会启动。请在 PowerShell 或命令提示符中运行：先 {exe} login '<接入链接>' 绑定本机，再 {exe} run。\n按回车键关闭窗口",
            exe = exe
        )
    );
    let _ = std::io::stdin().read_line(&mut String::new());
    std::process::exit(0);
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    #[cfg(windows)]
    explain_double_click();
    let cli = Cli::parse();
    if let Some(lang) = &cli.lang {
        gonggong::i18n::set_locale(gonggong::i18n::resolve(lang));
    }
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
        Cmd::Login { link, server, code, fingerprint: _ } => {
            let (server, code) = match (link, server, code) {
                (Some(link), _, _) => {
                    let link = gonggong::bind::parse_link(&link)?;
                    (link.server, link.code)
                }
                (None, Some(server), Some(code)) => (server, code),
                _ => unreachable!("clap requires a link or --server and --code"),
            };
            let machine = machine_info();
            let (config, restored) = gonggong::bind::login(&server, &code, machine.clone()).await?;
            config.save()?;
            if restored {
                println!(
                    "{}",
                    t!("绑定成功：已恢复本机原有机器记录（{name}），原有 Bot 绑定保持不变", name = machine.name)
                );
            } else {
                println!(
                    "{}",
                    t!("绑定成功：本机已归属 {owner}（{name}）", owner = config.owner_name, name = machine.name)
                );
            }
        }
        Cmd::Logout => {
            if let Some(config) = Config::load()?
                && let Err(e) = gonggong::bind::logout(&config).await
            {
                eprintln!(
                    "{}",
                    t!("未能通知服务器（{e}），本机凭据仍会删除；如需停用该机器请在 Web 端移除", e = format!("{e:#}"))
                );
            }
            Config::remove()?;
            println!("{}", t!("已退出登录；再次 gg login 会恢复这台机器及其 Bot"));
        }
        Cmd::Status => match Config::load()? {
            Some(c) => println!(
                "{}",
                t!(
                    "已绑定：{server} · 归属 {owner} · 机器 {machine}",
                    server = c.server,
                    owner = c.owner_name,
                    machine = c.machine_id
                )
            ),
            None => println!("{}", t!("未绑定")),
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
                eprintln!("{}", t!("本机已被吊销（账号停用或机器被吊销），清除托管工作区与本机凭据："));
                for path in stopped.wiped {
                    eprintln!("  {}", t!("已删除 {path}", path = path.display()));
                }
            }
            std::process::exit(1);
        }
        Cmd::Bots => gonggong::bots::list(&config()?).await?,
        Cmd::Net => {
            let r = gonggong::net::run(&config()?).await?;
            println!(
                "{}",
                t!(
                    "延迟 {ms} ms · 带宽 {mbps} Mbps（已上报服务器，仅管理员可见）",
                    ms = r.latency_ms,
                    mbps = r.bandwidth_mbps
                )
            );
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
                bail!(t!("「{target}」没有可删除的工作区（只能删除已移出或未使用的托管工作区）", target = target));
            }
            for e in doomed {
                gonggong::workspace::delete(&config::home(), e).map_err(anyhow::Error::msg)?;
                println!(
                    "{}",
                    t!(
                        "已删除 {path}（{size}）",
                        path = e.path.display(),
                        size = e.size.map(human_size).unwrap_or_default()
                    )
                );
            }
        }
        Cmd::Workspaces { reset_cd: Some(target), .. } => {
            let config = config()?;
            let entries = list_workspaces(&config).await;
            let e = entries
                .iter()
                .find(|e| e.matches(&target) && e.kind == EntryKind::Cd)
                .with_context(|| t!("「{target}」不是 /cd 绑定的工作区", target = target))?;
            gonggong::workspace::reset_cd(&config, &e.group_id, &e.bot_id).await?;
            println!("{}", t!("已请求 {bot} 恢复托管工作区，结果见群消息", bot = e.bot_label()));
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
            println!("{}", t!("已导出诊断包 {path}（{files}）", path = dest.display(), files = names.join(t!("、"))));
        }
        Cmd::Config { cmd: ConfigCmd::Agent { kind, path } } => configure::agent(&config::home(), kind, path)?,
        Cmd::Provider { cmd } => gonggong::provider_cli::run(&config::home(), cmd).await?,
    }
    Ok(())
}
