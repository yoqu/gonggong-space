use aiws::config::Config;
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
        Cmd::Login { server, code } => {
            let machine = aiws::bind::machine_info();
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
    }
    Ok(())
}
