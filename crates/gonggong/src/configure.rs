//! `gg agents` and `gg config`: the owner's local agent and bot settings from the terminal.
use crate::bots::{self, Client};
use crate::config::Config;
use crate::local::{AgentModels, Approval, LocalSettings, load_models};
use crate::protocol::AgentKind;
use anyhow::{Result, bail};
use std::path::Path;

/// `default` on the command line clears a setting.
const DEFAULT: &str = "default";

fn setting(value: String) -> Option<String> {
    (value != DEFAULT).then_some(value)
}

fn update(target: &mut Option<String>, value: Option<String>) {
    if let Some(v) = value {
        *target = setting(v);
    }
}

pub fn parse_kind(s: &str) -> Result<AgentKind, String> {
    serde_json::from_value(serde_json::Value::String(s.to_lowercase())).map_err(|_| "应为 claude 或 codex".into())
}

/// `name`, else the catalog's name for it, else the adapter's default as last reported.
fn describe(value: Option<&str>, choices: Option<(&[crate::local::Choice], Option<&str>)>) -> String {
    let name =
        |v: &str| choices.and_then(|(c, _)| c.iter().find(|c| c.value == v)).map_or(v.to_string(), |c| c.name.clone());
    match (value, choices.and_then(|(_, current)| current)) {
        (Some(v), _) => name(v),
        (None, Some(current)) => format!("适配器默认（{}）", name(current)),
        (None, None) => "适配器默认".into(),
    }
}

fn model_line(models: Option<&AgentModels>, model: Option<&str>, effort: Option<&str>) -> String {
    let model = describe(model, models.map(|m| (&m.models[..], m.current.as_deref())));
    let effort = describe(effort, models.map(|m| (&m.efforts[..], m.current_effort.as_deref())));
    format!("模型 {model} · 推理强度 {effort}")
}

pub fn print_agents(home: &Path) -> Result<()> {
    let local = LocalSettings::load(home)?;
    let catalog = load_models(home);
    for a in crate::agents::detect(&local) {
        let s = local.agent(a.kind);
        let path = match (&a.path, a.available) {
            (Some(p), true) => p.clone(),
            (Some(p), false) => format!("{p}（不存在）"),
            (None, _) => "未安装".into(),
        };
        let models = catalog.get(&a.kind);
        println!(
            "{}\t{}\t{path}\t{}",
            bots::agent_label(a.kind),
            a.version.as_deref().unwrap_or("-"),
            model_line(models, s.default_model.as_deref(), s.effort.as_deref())
        );
        if let Some(m) = models.filter(|m| !m.models.is_empty()) {
            let values: Vec<_> = m.models.iter().map(|c| c.value.as_str()).collect();
            println!("\t可选模型：{}", values.join("、"));
        }
    }
    Ok(())
}

/// Warns about a model the adapter did not list last time (adapters may still accept aliases).
fn check_model(home: &Path, kind: AgentKind, model: Option<&str>) {
    let catalog = load_models(home);
    if let (Some(model), Some(known)) = (model, catalog.get(&kind))
        && !known.models.is_empty()
        && !known.models.iter().any(|c| c.value == model)
    {
        let values: Vec<_> = known.models.iter().map(|c| c.value.as_str()).collect();
        eprintln!(
            "提示：{} 上次报告的可选模型不含 {model}（{}），运行时会按适配器的判断处理",
            bots::agent_label(kind),
            values.join("、")
        );
    }
}

pub fn agent(
    home: &Path,
    kind: AgentKind,
    model: Option<String>,
    effort: Option<String>,
    path: Option<String>,
) -> Result<()> {
    let mut local = LocalSettings::load(home)?;
    let path = match path.map(setting) {
        Some(Some(p)) => {
            let p = std::path::absolute(&p)?;
            if !p.is_file() {
                bail!("找不到 {}", p.display());
            }
            Some(Some(p.to_string_lossy().into_owned()))
        }
        other => other,
    };
    let s = local.agents.entry(kind).or_default();
    update(&mut s.default_model, model);
    update(&mut s.effort, effort);
    if let Some(p) = path {
        s.path = p;
    }
    check_model(home, kind, s.default_model.as_deref());
    let s = s.clone();
    local.save(home)?;
    let models = load_models(home);
    println!(
        "{} · 路径 {} · {}",
        bots::agent_label(kind),
        s.path.as_deref().unwrap_or("自动检测"),
        model_line(models.get(&kind), s.default_model.as_deref(), s.effort.as_deref())
    );
    Ok(())
}

pub struct BotChange {
    pub model: Option<String>,
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
    update(&mut s.model, change.model);
    if let Some(a) = change.approval {
        s.approval = a;
    }
    s.allowlist.retain(|c| !change.disallow.contains(c));
    for c in change.allow {
        if !s.allowlist.contains(&c) {
            s.allowlist.push(c);
        }
    }
    check_model(home, bot.agent_kind, s.model.as_deref());
    local.save(home)?;
    let concurrency = match change.concurrency {
        Some(n) => client.set_concurrency(&bot.id, n).await?.concurrency,
        None => bot.concurrency,
    };
    let s = local.bot(&bot.id);
    let model = match &s.model {
        Some(m) => m.clone(),
        None => {
            let agent = local.agent(bot.agent_kind).default_model;
            let models = load_models(home);
            let m = models.get(&bot.agent_kind);
            format!(
                "跟随 agent 默认 · {}",
                describe(agent.as_deref(), m.map(|m| (&m.models[..], m.current.as_deref())))
            )
        }
    };
    let list = if s.allowlist.is_empty() { "无".into() } else { s.allowlist.join("、") };
    println!("{} · 模型 {model} · 命令审批 {} · 白名单 {list} · 并发上限 {concurrency}", bot.name, s.approval.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_settings_set_and_clear() {
        let home = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        agent(home.path(), AgentKind::Codex, Some("gpt-5.5".into()), Some("high".into()), Some(exe.clone())).unwrap();
        let s = LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex);
        assert_eq!(
            (s.default_model.as_deref(), s.effort.as_deref(), s.path),
            (Some("gpt-5.5"), Some("high"), Some(exe))
        );
        agent(home.path(), AgentKind::Codex, Some("default".into()), None, Some("default".into())).unwrap();
        let s = LocalSettings::load(home.path()).unwrap().agent(AgentKind::Codex);
        assert_eq!((s.default_model, s.effort.as_deref(), s.path), (None, Some("high"), None));
        assert!(agent(home.path(), AgentKind::Codex, None, None, Some("/nope/codex".into())).is_err());
        assert_eq!(parse_kind("Claude"), Ok(AgentKind::Claude));
        assert!(parse_kind("gemini").is_err());
    }

    #[test]
    fn describes_values_by_the_adapter_names() {
        let models = [crate::local::Choice { value: "haiku".into(), name: "Haiku".into(), description: None }];
        assert_eq!(describe(Some("haiku"), Some((&models, Some("haiku")))), "Haiku");
        assert_eq!(describe(None, Some((&models, Some("haiku")))), "适配器默认（Haiku）");
        assert_eq!(describe(Some("opus"), None), "opus");
        assert_eq!(describe(None, None), "适配器默认");
    }
}
