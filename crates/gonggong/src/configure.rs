//! `gg agents` and `gg config`: the owner's local agent and bot settings from the terminal. Models and thought levels
//! are chosen on the server; this only lists what the adapters offer.
use crate::bots::{self, Client};
use crate::config::Config;
use crate::local::{Approval, LocalSettings};
use crate::protocol::{AgentCatalog, AgentKind};
use anyhow::{Result, bail};
use std::path::Path;

/// `default` on the command line clears a setting.
const DEFAULT: &str = "default";

pub fn parse_kind(s: &str) -> Result<AgentKind, String> {
    serde_json::from_value(serde_json::Value::String(s.to_lowercase())).map_err(|_| "应为 claude 或 codex".into())
}

fn catalog_line(catalog: Option<&AgentCatalog>) -> String {
    match catalog {
        Some(c) if !c.models.is_empty() => {
            let names: Vec<_> = c.models.iter().map(|m| m.choice.value.as_str()).collect();
            format!("可选模型：{}", names.join("、"))
        }
        Some(_) => "适配器未提供可选模型".into(),
        None => "可选模型待探测（daemon 运行时自动探测）".into(),
    }
}

pub fn print_agents(home: &Path) -> Result<()> {
    let local = LocalSettings::load(home)?;
    for a in crate::agents::detect(home, &local) {
        let path = match (&a.path, a.available) {
            (Some(p), true) => p.clone(),
            (Some(p), false) => format!("{p}（不存在）"),
            (None, _) => "未安装".into(),
        };
        println!(
            "{}\t{}\t{path}\t{}",
            bots::agent_label(a.kind),
            a.version.as_deref().unwrap_or("-"),
            catalog_line(a.catalog.as_ref())
        );
    }
    Ok(())
}

pub fn agent(home: &Path, kind: AgentKind, path: String) -> Result<()> {
    let mut local = LocalSettings::load(home)?;
    let path = match path.as_str() {
        DEFAULT => None,
        p => {
            let p = std::path::absolute(p)?;
            if !p.is_file() {
                bail!("找不到 {}", p.display());
            }
            Some(p.to_string_lossy().into_owned())
        }
    };
    local.agents.entry(kind).or_default().path = path.clone();
    local.save(home)?;
    println!("{} · 路径 {}", bots::agent_label(kind), path.as_deref().unwrap_or("自动检测"));
    Ok(())
}

pub struct BotChange {
    pub approval: Option<Approval>,
    pub allow: Vec<String>,
    pub disallow: Vec<String>,
    pub concurrency: Option<u32>,
}

pub async fn bot(config: &Config, home: &Path, target: &str, change: BotChange) -> Result<()> {
    let client = Client::new(config)?;
    let bots = client.list().await?;
    let bot = bots::find(&bots, target)?;
    let mut local = LocalSettings::load(home)?;
    let s = local.bots.entry(bot.id.clone()).or_default();
    if let Some(a) = change.approval {
        s.approval = a;
    }
    s.allowlist.retain(|c| !change.disallow.contains(c));
    for c in change.allow {
        if !s.allowlist.contains(&c) {
            s.allowlist.push(c);
        }
    }
    local.save(home)?;
    let concurrency = match change.concurrency {
        Some(n) => client.set_concurrency(&bot.id, n).await?.concurrency,
        None => bot.concurrency,
    };
    let s = local.bot(&bot.id);
    let list = if s.allowlist.is_empty() { "无".into() } else { s.allowlist.join("、") };
    println!("{} · 命令审批 {} · 白名单 {list} · 并发上限 {concurrency}", bot.name, s.approval.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_path_set_and_clear() {
        let home = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        agent(home.path(), AgentKind::Codex, exe.clone()).unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex).path, Some(exe));
        agent(home.path(), AgentKind::Codex, "default".into()).unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex).path, None);
        assert!(agent(home.path(), AgentKind::Codex, "/nope/codex".into()).is_err());
        assert_eq!(parse_kind("Claude"), Ok(AgentKind::Claude));
        assert!(parse_kind("gemini").is_err());
    }
}
