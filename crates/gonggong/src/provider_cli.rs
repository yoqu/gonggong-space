//! `gg provider …` (design §4.7): this machine's providers from the terminal. Reads and writes
//! `<home>/providers.json` directly; nothing goes through the server except looking up bot and group names.
use crate::bots::agent_label;
use crate::ccswitch;
use crate::config::{self, Config};
use crate::configure::parse_kind;
use crate::protocol::AgentKind;
use crate::providers::{self, INHERIT, OFFICIAL, OFFICIAL_NAME, PresetGroup, Provider, Store};
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
    /// Add a provider from a preset (--preset) or by hand (--name + --base-url); the API key is read from stdin.
    Add {
        #[arg(value_parser = parse_kind)]
        agent: AgentKind,
        #[arg(long, required_unless_present = "base_url", conflicts_with = "base_url")]
        preset: Option<String>,
        #[arg(long)]
        name: Option<String>,
        #[arg(long, requires = "name")]
        base_url: Option<String>,
        #[arg(long)]
        model: Option<String>,
        /// Read the API key from stdin (keeps it out of the shell history).
        #[arg(long)]
        key_stdin: bool,
        /// Also make it this machine's default for the agent.
        #[arg(long)]
        default: bool,
    },
    /// Change a provider; sessions using it restart their adapter and resume with the change.
    Edit {
        id: String,
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
    /// Machine default: `use <claude|codex> <id|official>`; bot override: `use --bot <bot> <id|official|inherit>`.
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
    match cmd {
        ProviderCmd::Presets { agent } => print_presets(agent),
        ProviderCmd::List { agent } => print_list(&Store::load(home)?, agent)?,
        ProviderCmd::Add { agent, preset, name, base_url, model, key_stdin, default } => {
            let key = read_key(key_stdin)?.context("新增供应商需要 --key-stdin 传入 API Key")?;
            let mut p = match (preset, base_url) {
                (Some(id), _) => Provider::from_preset(
                    providers::preset(agent, &id).with_context(|| {
                        format!("没有 {} 预设 {id}，可用 gg provider presets 查看", agent_label(agent))
                    })?,
                    key,
                ),
                (None, Some(url)) => Provider::custom(agent, name.clone().unwrap_or_default(), url, key),
                (None, None) => unreachable!("clap requires --preset or --base-url"),
            };
            p.name = name.unwrap_or(p.name);
            p.model = model.or(p.model);
            let label = p.name.clone();
            let id = Store::update(home, |s| {
                let id = s.add(p)?;
                if default {
                    s.use_machine(agent, &id)?;
                }
                Ok(id)
            })?;
            println!("已新增 {label}（{id}）{}", if default { "，并设为本机默认" } else { "" });
            if default {
                print_stale(home, agent).await?;
            }
        }
        ProviderCmd::Edit { id, name, base_url, model, key_stdin } => {
            let key = read_key(key_stdin)?;
            if name.is_none() && base_url.is_none() && model.is_none() && key.is_none() {
                bail!("没有要修改的内容（--name / --base-url / --model / --key-stdin）");
            }
            Store::update(home, |s| {
                s.edit(&id, |p| {
                    p.name = name.unwrap_or(p.name.clone());
                    p.base_url = base_url.unwrap_or(p.base_url.clone());
                    p.model = model.or(p.model.clone());
                    p.api_key = key.unwrap_or(p.api_key.clone());
                })
            })?;
            println!("已修改 {id}；使用它的会话会重启 adapter 后继续");
        }
        ProviderCmd::Rm { id } => {
            let p = Store::update(home, |s| s.remove(&id))?;
            crate::inject::prune(home, &Store::load(home)?);
            println!("已删除 {}；使用它的会话下一轮会自动开启新会话", p.name);
        }
        ProviderCmd::Use { bot: None, args } => {
            let [agent, choice] = args.as_slice() else {
                bail!("用法：gg provider use <claude|codex> <id|official>")
            };
            let agent = parse_kind(agent).map_err(anyhow::Error::msg)?;
            let name = Store::update(home, |s| {
                s.use_machine(agent, choice)?;
                Ok(s.machine_default(agent)?.name().to_string())
            })?;
            println!("{} 本机默认供应商：{name}", agent_label(agent));
            print_stale(home, agent).await?;
        }
        ProviderCmd::Use { bot: Some(bot), args } => {
            let [choice] = args.as_slice() else { bail!("用法：gg provider use --bot <bot> <id|official|inherit>") };
            let config = Config::load()?.context("设置 Bot 的供应商需要先 gg login（要查询 Bot 的 agent）")?;
            let bots = crate::bots::Client::new(&config)?.list().await?;
            let bot =
                bots.iter().find(|b| b.id == bot || b.name == bot).with_context(|| format!("本机没有 Bot「{bot}」"))?;
            let name = Store::update(home, |s| {
                s.use_bot(&bot.id, bot.agent_kind, choice)?;
                Ok(s.effective(bot.agent_kind, &bot.id)?.name().to_string())
            })?;
            let how = if choice == INHERIT { "继承本机默认" } else { "单独设置" };
            println!("{} 的供应商：{name}（{how}）", bot.name);
            print_stale(home, bot.agent_kind).await?;
        }
        ProviderCmd::Import { source, all, ids, set_default } if source == "cc-switch" => {
            let candidates = ccswitch::read(&config::user_home().join(".cc-switch"))?;
            if candidates.is_empty() {
                println!("CC Switch 里没有可直接使用的 claude / codex 供应商");
                return Ok(());
            }
            if !all && ids.is_empty() {
                for v in ccswitch::preview(&candidates, &Store::load(home)?) {
                    let action = v.existing.map_or("新增".into(), |id| format!("更新 {id}"));
                    let current = if v.current { "CC Switch 当前" } else { "" };
                    println!(
                        "{}\t{}\t{}\t{}\t{}\t{}\t{current}\t{action}",
                        v.key,
                        agent_label(v.agent),
                        v.name,
                        v.base_url,
                        v.model.as_deref().unwrap_or("-"),
                        v.api_key
                    );
                }
                println!(
                    "\n用 --all 导入全部，或 --ids <key,…> 选择；加 --set-default 同时把 CC Switch 当前使用的设为本机默认"
                );
                return Ok(());
            }
            let keys = if all { candidates.iter().map(|c| c.key.clone()).collect() } else { ids };
            let imported = Store::update(home, |s| ccswitch::apply(&candidates, &keys, set_default, s))?;
            println!("已从 CC Switch 导入 {} 个供应商", imported.len());
        }
        ProviderCmd::Import { source, set_default, .. } if source.starts_with("ccswitch://") => {
            let p = ccswitch::parse_link(&source)?;
            let (agent, label) = (p.agent, p.name.clone());
            let id = Store::update(home, |s| {
                let id = s.upsert(p)?;
                if set_default {
                    s.use_machine(agent, &id)?;
                }
                Ok(id)
            })?;
            println!("已导入 {} 供应商 {label}（{id}）", agent_label(agent));
            if set_default {
                print_stale(home, agent).await?;
            }
        }
        ProviderCmd::Import { .. } => bail!("导入来源应为 cc-switch 或 ccswitch:// 链接"),
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
        bail!("标准输入里没有 API Key");
    }
    Ok(Some(key))
}

fn group_label(group: PresetGroup) -> &'static str {
    match group {
        PresetGroup::Cn => "国内厂商",
        PresetGroup::Aggregator => "聚合平台",
        PresetGroup::Global => "海外",
    }
}

fn print_presets(agent: Option<AgentKind>) {
    for agent in agent.map_or(vec![AgentKind::Claude, AgentKind::Codex], |a| vec![a]) {
        println!("{}", agent_label(agent));
        for p in providers::presets(Some(agent)) {
            let model = p.model.as_deref().unwrap_or("-");
            println!("  {}\t{}\t{}\t{}\t{model}", p.id, p.name, group_label(p.group), p.base_url);
        }
    }
    println!("\n预设来自 {}", providers::presets_source());
}

fn print_list(store: &Store, agent: Option<AgentKind>) -> Result<()> {
    for agent in agent.map_or(vec![AgentKind::Claude, AgentKind::Codex], |a| vec![a]) {
        let default = store.machine_default(agent)?;
        println!("{} · 本机默认：{}", agent_label(agent), default.name());
        for p in store.providers.iter().filter(|p| p.agent == agent).map(Provider::view) {
            let mark = if p.id == default.key() { "*" } else { " " };
            let model = p.model.as_deref().unwrap_or("-");
            println!("{mark} {}\t{}\t{}\t{model}\t{}", p.id, p.name, p.base_url, p.api_key);
        }
    }
    if !store.bots.is_empty() {
        println!("\nBot 单独设置：");
        for (bot, choice) in &store.bots {
            let name =
                if choice == OFFICIAL { OFFICIAL_NAME } else { store.get(choice).map_or(choice.as_str(), |p| &p.name) };
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
        println!("{} 个群的会话仍在使用 {from}，开启新会话后才会切换到 {to}：", groups.len());
        for g in groups {
            println!("  {g}");
        }
    }
    Ok(())
}
