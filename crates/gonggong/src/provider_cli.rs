//! `gg provider …` (design §4.7): this machine's providers from the terminal. Reads and writes
//! `<home>/providers.json` directly; nothing goes through the server except looking up bot and group names.
use crate::agent_settings::{self, Layer};
use crate::bots::agent_label;
use crate::ccswitch;
use crate::config::{self, Config};
use crate::configure::parse_kind;
use crate::protocol::{AgentKind, ApiProtocol};
use crate::providers::{self, Endpoint, INHERIT, OFFICIAL, OFFICIAL_NAME, PresetGroup, Provider, Store};
use crate::t;
use anyhow::{Context, Result, bail};
use clap::Subcommand;
use std::path::Path;

#[derive(Subcommand)]
pub enum ProviderCmd {
    /// List the built-in vendors (adapted from CC Switch's presets).
    Presets {
        #[arg(value_parser = parse_kind)]
        agent: Option<AgentKind>,
    },
    /// List this machine's providers, defaults and bot overrides (keys masked).
    List {
        #[arg(value_parser = parse_kind)]
        agent: Option<AgentKind>,
    },
    /// Add a provider from a preset (--preset, every protocol it serves) or by hand (--name + --base-url, the agent's
    /// protocol unless --protocol); the API key is read from stdin.
    Add {
        #[arg(value_parser = parse_kind)]
        agent: AgentKind,
        #[arg(long, required_unless_present = "base_url", conflicts_with = "base_url")]
        preset: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, requires = "name")]
        base_url: Option<String>,
        /// anthropic, openai, gemini or codebuddy.
        #[arg(long, value_parser = parse_protocol)]
        protocol: Option<ApiProtocol>,
        #[arg(long)]
        model: Option<String>,
        /// Read the API key from stdin (keeps it out of the shell history).
        #[arg(long)]
        key_stdin: bool,
        /// Also make it this machine's default for the agent.
        #[arg(long)]
        default: bool,
    },
    /// Change a provider; sessions using it restart their adapter and resume with the change. --base-url and --model
    /// change the endpoint of --protocol (needed when it has several; a new one with --base-url).
    Edit {
        id: String,
        #[arg(long, value_parser = parse_protocol)]
        protocol: Option<ApiProtocol>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        base_url: Option<String>,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        key_stdin: bool,
    },
    /// Delete a provider; sessions using it start a new session on their next turn.
    Rm { id: String },
    /// Machine default: `use <claude|codex|gemini|codebuddy|deepseek|qwen|kimi|goose|copilot> <id|official>`; bot override: `use --bot <bot> <id|official|inherit>`.
    Use {
        /// Bot id or name.
        #[arg(long)]
        bot: Option<String>,
        #[arg(num_args = 1..=2, required = true)]
        args: Vec<String>,
    },
    /// Import from this machine's CC Switch (`cc-switch`: previews unless --all / --ids) or a `ccswitch://` link.
    Import {
        source: String,
        #[arg(long, conflicts_with = "ids")]
        all: bool,
        /// Keys from the preview, comma separated.
        #[arg(long, value_delimiter = ',')]
        ids: Vec<String>,
        /// Also make the imported current provider (CC Switch's, or the link's) this machine's default.
        #[arg(long)]
        set_default: bool,
    },
}

pub async fn run(home: &Path, cmd: ProviderCmd) -> Result<()> {
    providers::load_overlay(home);
    if let Some(backup) = Store::migrate_file(home)?.and_then(|r| r.backup) {
        println!("{}", t!("providers.json 已升级为新格式，原文件备份为 {path}", path = backup.display()));
    }
    match cmd {
        ProviderCmd::Presets { agent } => print_presets(agent),
        ProviderCmd::List { agent } => print_list(&Store::load(home)?, agent)?,
        ProviderCmd::Add { agent, preset, name, base_url, protocol, model, key_stdin, default } => {
            let key = read_key(key_stdin)?.context(t!("新增供应商需要 --key-stdin 传入 API Key"))?;
            let mut p = match (preset, base_url) {
                (Some(id), _) => Provider::from_preset(
                    &providers::preset(&id)
                        .filter(|p| p.endpoints.iter().any(|e| agent.takes(e.protocol)))
                        .with_context(|| {
                            t!(
                                "没有 {agent} 预设 {id}，可用 gg provider presets 查看",
                                agent = agent_label(agent),
                                id = id
                            )
                        })?,
                    key,
                ),
                (None, Some(url)) => {
                    let protocol = protocol
                        .or(agent.protocols().first().copied())
                        .with_context(|| t!("{agent} 使用自己的登录，不用供应商", agent = agent_label(agent)))?;
                    Provider::custom(protocol, name.clone().unwrap_or_default(), url, key)
                }
                (None, None) => unreachable!("clap requires --preset or --base-url"),
            };
            p.name = name.unwrap_or(p.name);
            if let Some(model) = model {
                let protocol = p.endpoint_for(agent).map(|e| e.protocol);
                if let Some(e) = protocol.and_then(|pr| p.endpoint_mut(pr)) {
                    e.model = Some(model);
                }
            }
            let label = p.name.clone();
            let id = Store::update(home, |s| {
                let id = s.add(p)?;
                if default {
                    s.use_machine(agent, &id, None)?;
                }
                Ok(id)
            })?;
            match default {
                true => println!("{}", t!("已新增 {label}（{id}），并设为本机默认", label = label, id = id)),
                false => println!("{}", t!("已新增 {label}（{id}）", label = label, id = id)),
            }
            if default {
                print_stale(home, agent).await?;
            }
        }
        ProviderCmd::Edit { id, protocol, name, base_url, model, key_stdin } => {
            let key = read_key(key_stdin)?;
            if name.is_none() && base_url.is_none() && model.is_none() && key.is_none() {
                bail!(t!("没有要修改的内容（--name / --base-url / --model / --key-stdin）"));
            }
            Store::update(home, |s| {
                let p = s.get(&id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
                let protocol = match (protocol, p.endpoints.as_slice()) {
                    (Some(protocol), _) => Some(protocol),
                    (None, _) if base_url.is_none() && model.is_none() => None,
                    (None, [only]) => Some(only.protocol),
                    (None, _) => bail!(t!("{id} 有多个协议端点，请用 --protocol 指定要改哪一个", id = id)),
                };
                let new = protocol.filter(|pr| p.endpoint(*pr).is_none());
                if new.is_some() && base_url.is_none() {
                    bail!(t!("新增协议端点需要 --base-url"));
                }
                s.edit(&id, |p| {
                    if let Some(protocol) = new {
                        p.endpoints.push(Endpoint::new(protocol, String::new()));
                    }
                    if let Some(e) = protocol.and_then(|pr| p.endpoint_mut(pr)) {
                        e.base_url = base_url.unwrap_or(e.base_url.clone());
                        e.model = model.or(e.model.clone());
                    }
                    p.name = name.unwrap_or(p.name.clone());
                    p.api_key = key.unwrap_or(p.api_key.clone());
                })
            })?;
            println!("{}", t!("已修改 {id}；使用它的会话会重启 adapter 后继续", id = id));
        }
        ProviderCmd::Rm { id } => {
            let p = Store::update(home, |s| s.remove(&id))?;
            crate::inject::prune(home, &Store::load(home)?, None);
            println!("{}", t!("已删除 {name}；使用它的会话下一轮会自动开启新会话", name = p.name));
        }
        ProviderCmd::Use { bot: None, args } => {
            let [agent, choice] = args.as_slice() else {
                bail!(t!("用法：gg provider use <claude|codex|gemini|codebuddy|deepseek|qwen|kimi|goose|copilot> <id|official>"))
            };
            let agent = parse_kind(agent).map_err(anyhow::Error::msg)?;
            let name = Store::update(home, |s| {
                s.use_machine(agent, choice, None)?;
                Ok(s.machine_default(agent)?.name().to_string())
            })?;
            println!("{}", t!("{agent} 本机默认供应商：{name}", agent = agent_label(agent), name = name));
            print_stale(home, agent).await?;
        }
        ProviderCmd::Use { bot: Some(bot), args } => {
            let [choice] = args.as_slice() else {
                bail!(t!("用法：gg provider use --bot <bot> <id|official|inherit>"))
            };
            let config = Config::load()?.context(t!("设置 Bot 的供应商需要先 gg login（要查询 Bot 的 agent）"))?;
            let bots = crate::bots::Client::new(&config)?.list().await?;
            let bot = bots
                .iter()
                .find(|b| b.id == bot || b.name == bot)
                .with_context(|| t!("本机没有 Bot「{bot}」", bot = bot))?;
            let name = Store::update(home, |s| {
                s.use_bot(&bot.id, bot.agent_kind, choice)?;
                Ok(s.effective(bot.agent_kind, &bot.id)?.name().to_string())
            })?;
            let how = if choice == INHERIT { t!("继承本机默认") } else { t!("单独设置") };
            println!("{}", t!("{bot} 的供应商：{name}（{how}）", bot = bot.name, name = name, how = how));
            print_stale(home, bot.agent_kind).await?;
        }
        ProviderCmd::Import { source, all, ids, set_default } if source == "cc-switch" => {
            let candidates = ccswitch::read(&config::user_home().join(".cc-switch"))?;
            if candidates.is_empty() {
                println!("{}", t!("CC Switch 里没有可直接使用的 claude / codex 供应商"));
                return Ok(());
            }
            if !all && ids.is_empty() {
                for v in ccswitch::preview(&candidates, &Store::load(home)?) {
                    let action = v.existing.map_or(t!("新增").into(), |id| t!("更新 {id}", id = id));
                    let current = if v.current { t!("CC Switch 当前") } else { "" };
                    println!(
                        "{}\t{}\t{}\t{}\t{}\t{}\t{current}\t{action}",
                        v.key,
                        protocol_name(v.protocol),
                        v.name,
                        v.base_url,
                        v.model.as_deref().unwrap_or("-"),
                        v.api_key
                    );
                }
                println!(
                    "\n{}",
                    t!(
                        "用 --all 导入全部，或 --ids <key,…> 选择；加 --set-default 同时把 CC Switch 当前使用的设为本机默认"
                    )
                );
                return Ok(());
            }
            let keys = if all { candidates.iter().map(|c| c.key.clone()).collect() } else { ids };
            let imported = Store::update(home, |s| ccswitch::apply(&candidates, &keys, set_default, s))?;
            println!("{}", t!("已从 CC Switch 导入 {n} 个供应商", n = imported.len()));
        }
        ProviderCmd::Import { source, set_default, .. } if source.starts_with("ccswitch://") => {
            let (agent, p) = ccswitch::parse_link(&source)?;
            let label = p.name.clone();
            let id = Store::update(home, |s| {
                let id = s.upsert(p)?;
                if set_default {
                    s.use_machine(agent, &id, None)?;
                }
                Ok(id)
            })?;
            println!(
                "{}",
                t!("已导入 {agent} 供应商 {label}（{id}）", agent = agent_label(agent), label = label, id = id)
            );
            if set_default {
                print_stale(home, agent).await?;
            }
        }
        ProviderCmd::Import { .. } => bail!(t!("导入来源应为 cc-switch 或 ccswitch:// 链接")),
    }
    Ok(())
}

/// `gg agents settings`: applies the changes (all or none), then prints every field with its value and the CLI's own.
pub fn agent_settings(
    home: &Path,
    user_home: &Path,
    agent: AgentKind,
    set: Vec<String>,
    unset: Vec<String>,
    inherit_cli: Option<bool>,
) -> Result<()> {
    let settings = Store::update(home, |s| {
        let mut settings = s.agent_settings(agent);
        for pair in &set {
            let (id, value) = pair.split_once('=').with_context(|| t!("--set 应为 字段=值：{pair}", pair = pair))?;
            settings.values.insert(id.trim().into(), value.trim().into());
        }
        for id in &unset {
            settings.values.remove(id.trim());
        }
        settings.inherit_cli = inherit_cli.unwrap_or(settings.inherit_cli);
        s.set_agent_settings(agent, settings.clone())?;
        Ok(settings)
    })?;
    let cli = agent_settings::read_cli(user_home, agent_settings::claude_version(home))
        .filter(|_| agent == AgentKind::Claude);
    println!("{}", t!("{agent} · 本机 Agent 设置", agent = agent_label(agent)));
    for f in agent_settings::fields(agent, Some(Layer::Agent)) {
        let value = settings.values.get(f.id).map_or("-", String::as_str);
        let from_cli = cli.as_ref().and_then(|c| c.values.get(f.id)).filter(|_| settings.inherit_cli);
        match from_cli {
            Some(v) => println!("  {}\t{}\t{value}\t{}", f.id, f.key, t!("CLI 配置：{v}", v = v)),
            None => println!("  {}\t{}\t{value}", f.id, f.key),
        }
    }
    let inherit = if settings.inherit_cli { t!("是") } else { t!("否") };
    println!("{}", t!("加载 CLI 自身配置（~/.claude）：{inherit}", inherit = inherit));
    if let Some(c) = cli.filter(|c| settings.inherit_cli && !c.conflicts.is_empty()) {
        println!("{}", t!("CLI 配置里这些变量会覆盖共工的设置：{names}", names = c.conflicts.join(", ")));
    }
    if !set.is_empty() || !unset.is_empty() || inherit_cli.is_some() {
        println!("{}", t!("已保存；进行中的会话下一轮生效"));
    }
    Ok(())
}

fn read_key(key_stdin: bool) -> Result<Option<String>> {
    if !key_stdin {
        return Ok(None);
    }
    let mut key = String::new();
    std::io::stdin().read_line(&mut key)?;
    let key = key.trim().to_string();
    if key.is_empty() {
        bail!(t!("标准输入里没有 API Key"));
    }
    Ok(Some(key))
}

fn group_label(group: PresetGroup) -> &'static str {
    match group {
        PresetGroup::Cn => t!("国内厂商"),
        PresetGroup::Aggregator => t!("聚合平台"),
        PresetGroup::Global => t!("海外"),
    }
}

fn parse_protocol(s: &str) -> Result<ApiProtocol, String> {
    serde_json::from_value(serde_json::Value::String(s.to_ascii_lowercase()))
        .map_err(|_| t!("协议应为 anthropic、openai、gemini 或 codebuddy").to_string())
}

fn protocol_name(p: ApiProtocol) -> &'static str {
    match p {
        ApiProtocol::Anthropic => "anthropic",
        ApiProtocol::Openai => "openai",
        ApiProtocol::Gemini => "gemini",
        ApiProtocol::Codebuddy => "codebuddy",
    }
}

fn print_presets(agent: Option<AgentKind>) {
    for agent in agent.map_or(AgentKind::ALL.to_vec(), |a| vec![a]) {
        let presets = providers::presets(Some(agent));
        if presets.is_empty() {
            continue;
        }
        println!("{}", agent_label(agent));
        for p in presets {
            let e = p.endpoints.iter().find(|e| agent.takes(e.protocol)).expect("presets(agent) serve it");
            let model = e.model.as_deref().unwrap_or("-");
            println!("  {}\t{}\t{}\t{}\t{model}", p.id, p.name, group_label(p.group), e.base_url);
        }
    }
    println!("\n{}", t!("预设来自 {source}", source = providers::presets_source()));
}

fn print_list(store: &Store, agent: Option<AgentKind>) -> Result<()> {
    for agent in agent.map_or(AgentKind::ALL.to_vec(), |a| vec![a]) {
        let default = store.machine_default(agent)?;
        println!("{}", t!("{agent} · 本机默认：{name}", agent = agent_label(agent), name = default.name()));
        for p in &store.providers {
            let Some(e) = p.endpoint_for(agent) else { continue };
            let mark = if p.id == default.key() { "*" } else { " " };
            let model = e.model.as_deref().unwrap_or("-");
            let url = e.config_dir.as_deref().unwrap_or(&e.base_url);
            let others: Vec<_> =
                p.endpoints.iter().filter(|o| o.protocol != e.protocol).map(|o| protocol_name(o.protocol)).collect();
            let others = if others.is_empty() { String::new() } else { format!("\t+{}", others.join(",")) };
            let key = providers::mask_key(&p.api_key);
            println!("{mark} {}\t{}\t{}\t{url}\t{model}\t{key}{others}", p.id, p.name, protocol_name(e.protocol));
        }
    }
    if !store.bots.is_empty() {
        println!("\n{}", t!("Bot 单独设置："));
        for (bot, choice) in &store.bots {
            let name = if choice == OFFICIAL {
                crate::i18n::tr(OFFICIAL_NAME)
            } else {
                store.get(choice).map_or(choice.as_str(), |p| &p.name)
            };
            println!("  {bot}\t{name}");
        }
    }
    Ok(())
}

/// §4.3: switching never touches running sessions; say which groups keep the old provider until a new session.
async fn print_stale(home: &Path, agent: AgentKind) -> Result<()> {
    let store = Store::load(home)?;
    let stale: Vec<_> = store
        .stale()?
        .into_iter()
        .filter(|s| store.sessions.get(&s.session_id).is_some_and(|p| p.agent == agent))
        .collect();
    if stale.is_empty() {
        return Ok(());
    }
    let pairs = match Config::load()? {
        Some(config) => crate::workspace::fetch_pairs(&config).await.unwrap_or_default(),
        None => vec![],
    };
    let mut by_change: std::collections::BTreeMap<(&str, &str), Vec<String>> = Default::default();
    for s in &stale {
        let label = pairs
            .iter()
            .find(|p| p.group_id == s.group_id && p.bot_id == s.bot_id)
            .map_or(format!("{} × {}", s.group_id, s.bot_id), |p| format!("{} × {}", p.group_name, p.bot_name));
        by_change.entry((&s.session, &s.effective)).or_default().push(label);
    }
    for ((from, to), groups) in by_change {
        println!(
            "{}",
            t!("{n} 个群的会话仍在使用 {from}，开启新会话后才会切换到 {to}：", n = groups.len(), from = from, to = to)
        );
        for g in groups {
            println!("  {g}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_settings_change_all_or_nothing() {
        let home = tempfile::tempdir().unwrap();
        let run = |set: &[&str], unset: &[&str], inherit: Option<bool>| {
            let list = |l: &[&str]| l.iter().map(|s| s.to_string()).collect();
            agent_settings(home.path(), home.path(), AgentKind::Claude, list(set), list(unset), inherit)
        };
        run(&["language=chinese", "bashTimeout=300000"], &[], Some(false)).unwrap();
        let stored = Store::load(home.path()).unwrap().agent_settings(AgentKind::Claude);
        assert_eq!((stored.values.len(), stored.inherit_cli), (2, false));
        assert!(run(&["language=english", "thinking=maybe"], &[], None).is_err());
        assert!(run(&["language"], &[], None).is_err());
        assert_eq!(Store::load(home.path()).unwrap().agent_settings(AgentKind::Claude), stored, "unchanged");
        run(&[], &["language", "bashTimeout"], Some(true)).unwrap();
        assert!(Store::load(home.path()).unwrap().agent_settings.is_empty());
    }
}
