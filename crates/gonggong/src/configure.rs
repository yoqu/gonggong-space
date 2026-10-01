//! `gg agents` and `gg config`: the owner's local agent settings from the terminal (installs: `tools`). Models, thought levels and the
//! bots' settings are chosen on the Web (plan J12); this only lists what the adapters offer.
use crate::bots;
use crate::local::LocalSettings;
use crate::protocol::{AgentCatalog, AgentKind};
use crate::t;
use crate::tools::{self, ToolStatus};
use anyhow::{Result, bail};
use std::path::Path;

/// `default` on the command line clears a setting.
const DEFAULT: &str = "default";

pub fn parse_kind(s: &str) -> Result<AgentKind, String> {
    serde_json::from_value(serde_json::Value::String(s.to_lowercase())).map_err(|_| t!("应为 claude 或 codex").into())
}

fn catalog_line(catalog: Option<&AgentCatalog>) -> String {
    match catalog {
        Some(c) if !c.models.is_empty() => {
            let names: Vec<_> = c.models.iter().map(|m| m.choice.value.as_str()).collect();
            t!("可选模型：{models}", models = names.join(t!("、")))
        }
        Some(_) => t!("适配器未提供可选模型").into(),
        None => t!("可选模型待探测（daemon 运行时自动探测）").into(),
    }
}

/// The latest version and who installed it, e.g. 「最新 2.1.285（可升级）\t共工空间托管」.
fn tool_columns(s: &ToolStatus) -> String {
    let latest = match &s.latest {
        Some(l) if s.has_update() => t!("最新 {v}（可升级）", v = l),
        Some(_) if s.installed => t!("已是最新").into(),
        Some(l) => t!("最新 {v}", v = l),
        None => t!("最新版本未知").into(),
    };
    let source = match (s.installed, s.managed) {
        (false, _) => "-",
        (true, true) => t!("共工空间托管"),
        (true, false) => t!("自行安装"),
    };
    format!("{latest}\t{source}")
}

pub async fn print_agents(home: &Path) -> Result<()> {
    let local = LocalSettings::load(home)?;
    let node = tools::with_latest(home, tools::node_status(home)).await;
    let too_old = node
        .version
        .as_deref()
        .and_then(|v| v.split('.').next()?.parse::<u32>().ok())
        .is_some_and(|m| m < tools::MIN_NODE_MAJOR);
    println!(
        "Node.js\t{}\t{}\t{}\t{}",
        node.version.as_deref().unwrap_or("-"),
        tool_columns(&node),
        node.path.as_deref().unwrap_or(t!("未安装")),
        if too_old { t!("ACP 适配器需要 Node.js ≥ {v}", v = tools::MIN_NODE_MAJOR) } else { String::new() }
    );
    for a in crate::agents::detect(home, &local) {
        let status = tools::with_latest(home, tools::agent_status(home, &a)).await;
        let path = match (&a.path, a.available) {
            (Some(p), true) => p.clone(),
            (Some(p), false) => t!("{path}（不存在）", path = p),
            (None, _) => t!("未安装").into(),
        };
        println!(
            "{}\t{}\t{}\t{path}\t{}",
            bots::agent_label(a.kind),
            a.version.as_deref().unwrap_or("-"),
            tool_columns(&status),
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
                bail!(t!("找不到 {path}", path = p.display()));
            }
            Some(p.to_string_lossy().into_owned())
        }
    };
    local.agents.entry(kind).or_default().path = path.clone();
    local.save(home)?;
    let shown = path.as_deref().unwrap_or(t!("自动检测"));
    println!("{}", t!("{agent} · 路径 {path}", agent = bots::agent_label(kind), path = shown));
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
