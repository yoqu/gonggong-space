//! The server side of this machine's agent tools and providers (design §4.6): `tools.cmd`, `providers.cmd` and
//! `ccswitch.*`, answered through the outbox. Keys only ever arrive (in `save` / `importLink`); what leaves is masked.
use crate::ccswitch;
use crate::config::{Mirror, Settings};
use crate::local::LocalSettings;
use crate::protocol::{
    AgentCatalog, AgentInfo, Choice, DaemonToServer, FEATURE_CC_SWITCH, FEATURE_PROVIDERS, FEATURE_SYNC, FEATURE_TOOLS,
    ModelChoice, ModelMap, ProviderInput, ProviderStateItem, ProvidersAction, ProvidersCmd, ProvidersResult,
    ToolsAction, ToolsCmd, ToolsSettings,
};
use crate::providers::{self, API_KEY, AUTH_TOKEN, INHERIT, Provider, Selection, Store};
use crate::service::Outbox;
use crate::t;
use crate::tools;
use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::watch;

/// Output of one install / upgrade relayed to the Web; the rest is dropped (the result still arrives).
const PROGRESS_MAX_BYTES: usize = 256 << 10;
const LINE_MAX_BYTES: usize = 2 << 10;

#[derive(Clone)]
pub struct Manage(Arc<Inner>);

struct Inner {
    home: PathBuf,
    /// `~/.cc-switch`, read only.
    cc_switch: PathBuf,
    /// Local agent detection, republished after a tool changed.
    agents: OnceLock<watch::Sender<Vec<AgentInfo>>>,
    /// The provider state the server holds for this machine (none after connecting).
    reported: Mutex<Vec<ProviderStateItem>>,
}

impl Manage {
    pub fn new(home: PathBuf, cc_switch: PathBuf) -> Self {
        Manage(Arc::new(Inner { home, cc_switch, agents: OnceLock::new(), reported: Mutex::default() }))
    }

    pub fn watch_agents(&self, tx: watch::Sender<Vec<AgentInfo>>) {
        let _ = self.0.agents.set(tx);
    }

    pub fn features(&self) -> Vec<String> {
        let mut features = vec![FEATURE_TOOLS.to_string(), FEATURE_PROVIDERS.to_string(), FEATURE_SYNC.to_string()];
        if self.0.cc_switch.is_dir() {
            features.push(FEATURE_CC_SWITCH.into());
        }
        features
    }

    /// A new connection: the server dropped this machine's provider state when it went offline.
    pub fn connected(&self) {
        self.0.reported.lock().unwrap().clear();
    }

    /// `bots.providerState`, when it changed: sessions whose provider differs from what a new one would use (the
    /// server keeps it in memory only, replacing this machine's list).
    pub fn report(&self, out: &Outbox) {
        let mut reported = self.0.reported.lock().unwrap();
        let items: Vec<_> = match Store::load(&self.0.home).and_then(|s| s.stale()) {
            Ok(stale) => stale
                .into_iter()
                .map(|s| ProviderStateItem {
                    group_id: s.group_id,
                    bot_id: s.bot_id,
                    session: s.session,
                    effective: s.effective,
                })
                .collect(),
            Err(e) => return tracing::warn!("provider state skipped: {e:#}"),
        };
        if *reported != items {
            *reported = items.clone();
            out.send(DaemonToServer::BotsProviderState { items });
        }
    }

    pub fn tools(&self, cmd: ToolsCmd, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::spawn(async move {
            let home = &this.0.home;
            let sent = AtomicUsize::new(0);
            let progress = |line: &str| {
                let line = clip(line, LINE_MAX_BYTES);
                let before = sent.fetch_add(line.len(), Ordering::Relaxed);
                let line = if before + line.len() <= PROGRESS_MAX_BYTES {
                    line.to_string()
                } else if before <= PROGRESS_MAX_BYTES {
                    t!("……输出过多，其余省略").to_string()
                } else {
                    return;
                };
                out.send(DaemonToServer::ToolsProgress { request_id: cmd.request_id.clone(), line });
            };
            let error = tools_op(home, &cmd, &progress).await.err().map(|e| format!("{e:#}"));
            let tools = match LocalSettings::load(home) {
                Ok(local) => tools::status(home, &local).await,
                Err(_) => vec![],
            };
            let settings = ToolsSettings { mirror: Settings::load(home).map(|s| s.mirror).unwrap_or_default() };
            this.refresh_agents().await;
            out.send(DaemonToServer::ToolsResult {
                request_id: cmd.request_id,
                ok: error.is_none(),
                error,
                tools,
                settings,
            });
        });
    }

    pub fn providers(&self, cmd: ProvidersCmd, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || {
            let changes = matches!(
                cmd.action,
                ProvidersAction::Save | ProvidersAction::Remove | ProvidersAction::Use | ProvidersAction::ImportLink
            );
            let request_id = cmd.request_id.clone();
            let agents = this.0.agents.get().map(|tx| tx.borrow().clone()).unwrap_or_default();
            let result = providers_op(&this.0.home, cmd, &agents).unwrap_or_else(|e| ProvidersResult {
                ok: false,
                error: Some(format!("{e:#}")),
                ..answer(request_id)
            });
            let ok = result.ok;
            out.send(DaemonToServer::ProvidersResult(result));
            if ok && changes {
                this.report(&out);
            }
        });
    }

    pub fn ccswitch_read(&self, request_id: String, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || {
            let read = || -> Result<_> {
                let candidates = ccswitch::read(&this.0.cc_switch)?;
                Ok(ccswitch::preview(&candidates, &Store::load(&this.0.home)?))
            };
            out.send(match read() {
                Ok(candidates) => ccswitch_result(request_id, None, candidates, vec![], None),
                Err(e) => ccswitch_result(request_id, Some(format!("{e:#}")), vec![], vec![], None),
            });
        });
    }

    pub fn ccswitch_apply(&self, request_id: String, keys: Vec<String>, set_default: bool, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || {
            let apply = || -> Result<_> {
                let candidates = ccswitch::read(&this.0.cc_switch)?;
                Store::update(&this.0.home, |s| Ok((ccswitch::apply(&candidates, &keys, set_default, s)?, s.view())))
            };
            match apply() {
                Ok((imported, view)) => {
                    out.send(ccswitch_result(request_id, None, vec![], imported, Some(view)));
                    this.report(&out);
                }
                Err(e) => out.send(ccswitch_result(request_id, Some(format!("{e:#}")), vec![], vec![], None)),
            }
        });
    }

    async fn refresh_agents(&self) {
        let Some(tx) = self.0.agents.get().cloned() else { return };
        let home = self.0.home.clone();
        let detected = tokio::task::spawn_blocking(move || {
            Ok::<_, anyhow::Error>(crate::agents::detect(&home, &LocalSettings::load(&home)?))
        })
        .await;
        match detected {
            Ok(Ok(agents)) => {
                crate::daemon::publish_agents(&tx, agents);
            }
            Ok(Err(e)) => tracing::warn!("agent detection skipped: {e:#}"),
            Err(e) => tracing::warn!("agent detection failed: {e}"),
        }
    }
}

/// At most `max` bytes, cut on a char boundary.
fn clip(s: &str, max: usize) -> &str {
    let mut end = s.len().min(max);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

async fn tools_op(home: &Path, cmd: &ToolsCmd, progress: tools::Progress<'_>) -> Result<()> {
    let kind = || cmd.kind.context(t!("缺少要操作的工具"));
    match cmd.action {
        ToolsAction::Status => {}
        ToolsAction::Install => {
            tools::install(home, kind()?, cmd.version.as_deref(), progress).await?;
        }
        ToolsAction::Upgrade => {
            tools::upgrade(home, kind()?, progress).await?;
        }
        ToolsAction::Settings => {
            let mirror = cmd.mirror.clone().context(t!("缺少镜像源设置"))?;
            if let Mirror::Custom { registry, node } = &mirror {
                tools::http_url(registry)?;
                tools::http_url(node)?;
            }
            let mut settings = Settings::load(home)?;
            settings.mirror = mirror;
            settings.save(home)?;
        }
    }
    Ok(())
}

fn answer(request_id: String) -> ProvidersResult {
    ProvidersResult { request_id, ok: true, error: None, view: None, presets: None, catalog: None, id: None }
}

fn ccswitch_result(
    request_id: String,
    error: Option<String>,
    candidates: Vec<ccswitch::CandidateView>,
    imported: Vec<String>,
    view: Option<providers::StoreView>,
) -> DaemonToServer {
    DaemonToServer::CcSwitchResult { request_id, ok: error.is_none(), error, candidates, imported, view }
}

/// `agents`: this machine's detection, whose catalogs are what official logins offer.
fn providers_op(home: &Path, cmd: ProvidersCmd, agents: &[AgentInfo]) -> Result<ProvidersResult> {
    let mut r = answer(cmd.request_id.clone());
    match cmd.action {
        ProvidersAction::Presets => r.presets = Some(providers::presets(cmd.agent).cloned().collect()),
        ProvidersAction::List => r.view = Some(Store::load(home)?.view()),
        ProvidersAction::Catalog => {
            let id = cmd.id.context(t!("缺少供应商"))?;
            let store = Store::load(home)?;
            r.catalog = Some(catalog(store.get(&id).with_context(|| t!("供应商 {id} 不存在", id = id))?));
        }
        ProvidersAction::BotCatalog => {
            let agent = cmd.agent.context(t!("缺少 agent"))?;
            let store = Store::load(home)?;
            let selection = match &cmd.bot_id {
                Some(bot) => store.effective(agent, bot)?,
                None => store.machine_default(agent)?,
            };
            r.catalog = match selection {
                Selection::Official(_) => {
                    agents.iter().find(|a| a.kind == agent && a.available).and_then(|a| a.catalog.clone())
                }
                Selection::Provider(p) => Some(catalog(&p)),
            };
        }
        ProvidersAction::Save => {
            let input = cmd.provider.context(t!("缺少供应商内容"))?;
            let set_default = cmd.set_default.unwrap_or(false);
            let (id, view) = Store::update(home, |s| {
                let agent = input.agent;
                let id = save(s, input)?;
                if set_default {
                    s.use_machine(agent, &id)?;
                }
                Ok((id, s.view()))
            })?;
            (r.id, r.view) = (Some(id), Some(view));
        }
        ProvidersAction::Remove => {
            let id = cmd.id.context(t!("缺少供应商"))?;
            let store = Store::update(home, |s| {
                s.remove(&id)?;
                Ok(s.clone())
            })?;
            crate::inject::prune(home, &store);
            r.view = Some(store.view());
        }
        ProvidersAction::Use => {
            let (agent, choice) = cmd.agent.zip(cmd.choice).context(t!("缺少 agent 或要使用的供应商"))?;
            r.view = Some(Store::update(home, |s| {
                match &cmd.bot_id {
                    Some(bot) => s.use_bot(bot, agent, &choice)?,
                    None if choice == INHERIT => bail!(t!("本机默认不能选择「继承」")),
                    None => s.use_machine(agent, &choice)?,
                }
                Ok(s.view())
            })?);
        }
        ProvidersAction::Official => {
            let agent = cmd.agent.context(t!("缺少 agent"))?;
            let input = cmd.official.context(t!("缺少官方登录设置"))?;
            r.view = Some(Store::update(home, |s| {
                let mut o = s.official(agent);
                if let Some(env) = input.env {
                    o.env = env;
                }
                if let Some(proxy) = input.proxy {
                    set_proxy(&mut o.proxy, proxy);
                }
                s.set_official(agent, o)?;
                Ok(s.view())
            })?);
        }
        ProvidersAction::ImportLink => {
            let p = ccswitch::parse_link(cmd.link.as_deref().context(t!("缺少导入链接"))?)?;
            let set_default = cmd.set_default.unwrap_or(false);
            let (id, view) = Store::update(home, |s| {
                let agent = p.agent;
                let id = s.upsert(p)?;
                if set_default {
                    s.use_machine(agent, &id)?;
                }
                Ok((id, s.view()))
            })?;
            (r.id, r.view) = (Some(id), Some(view));
        }
    }
    Ok(r)
}

/// Adds (no id: from the preset, or by hand) or edits a provider; returns its id.
fn save(store: &mut Store, input: ProviderInput) -> Result<String> {
    if let Some(id) = input.id.clone() {
        let existing = store.get(&id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
        if existing.agent != input.agent {
            bail!(t!("不能修改供应商所属的 agent"));
        }
        store.edit(&id, |p| apply(p, input))?;
        return Ok(id);
    }
    let key = input.api_key.clone().context(t!("新增供应商需要填写 API Key"))?;
    let mut p = match &input.preset_id {
        Some(preset) => Provider::from_preset(
            providers::preset(input.agent, preset).with_context(|| t!("没有预设 {preset}", preset = preset))?,
            key,
        ),
        None => Provider::custom(
            input.agent,
            input.name.clone().unwrap_or_default(),
            input.base_url.clone().context(t!("自定义供应商需要填写 Base URL"))?,
            key,
        ),
    };
    apply(&mut p, input);
    store.add(p)
}

fn apply(p: &mut Provider, input: ProviderInput) {
    let text = |s: String| Some(s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(name) = input.name {
        p.name = name.trim().into();
    }
    if let Some(url) = input.base_url {
        p.base_url = url.trim().into();
    }
    if let Some(key) = input.api_key {
        p.api_key = key.trim().into();
    }
    if let Some(field) = input.api_key_field.filter(|f| [AUTH_TOKEN, API_KEY].contains(&f.as_str())) {
        p.api_key_field = Some(field);
    }
    if let Some(model) = input.model {
        p.model = text(model);
    }
    if let Some(models) = input.models {
        p.models = (models != ModelMap::default()).then_some(models);
    }
    if let Some(env) = input.env {
        p.env = env;
    }
    if let Some(proxy) = input.proxy {
        set_proxy(&mut p.proxy, proxy);
    }
    if let Some(effort) = input.effort {
        p.effort = text(effort);
    }
}

/// '' = direct; the masked one from the view = unchanged.
fn set_proxy(stored: &mut Option<String>, input: String) {
    let input = input.trim();
    if Some(input.to_string()) != stored.as_deref().map(providers::mask_proxy) {
        *stored = Some(input.to_string()).filter(|s| !s.is_empty());
    }
}

/// The models a third-party provider declares (its model, the haiku/sonnet/opus mapping, its preset's options).
fn catalog(p: &Provider) -> AgentCatalog {
    let models = p.models.clone().unwrap_or_default();
    let preset = p.preset_id.as_deref().and_then(|id| providers::preset(p.agent, id));
    let mut names: Vec<String> = vec![];
    let declared = [p.model.clone(), models.haiku, models.sonnet, models.opus].into_iter().flatten();
    for name in declared.chain(preset.into_iter().flat_map(|pr| pr.model_options.clone())) {
        if !names.contains(&name) {
            names.push(name);
        }
    }
    AgentCatalog {
        models: names
            .into_iter()
            .map(|value| ModelChoice {
                choice: Choice { name: value.clone(), value, description: None },
                efforts: vec![],
                effort: None,
            })
            .collect(),
        current: p.model.clone(),
        efforts: vec![],
        effort: p.effort.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AgentKind, OfficialInput};

    const KEY: &str = "sk-test-0123456789abcd";

    fn cmd(action: ProvidersAction) -> ProvidersCmd {
        ProvidersCmd {
            request_id: "r".into(),
            action,
            agent: None,
            bot_id: None,
            id: None,
            choice: None,
            provider: None,
            official: None,
            link: None,
            set_default: None,
        }
    }

    fn input(agent: AgentKind) -> ProviderInput {
        ProviderInput {
            id: None,
            agent,
            preset_id: None,
            name: None,
            base_url: None,
            api_key: None,
            api_key_field: None,
            model: None,
            models: None,
            env: None,
            proxy: None,
            effort: None,
        }
    }

    #[test]
    fn saves_the_proxy_keeping_it_when_the_masked_one_comes_back() {
        let home = tempfile::tempdir().unwrap();
        let save = |provider: ProviderInput| {
            let mut c = cmd(ProvidersAction::Save);
            c.provider = Some(provider);
            providers_op(home.path(), c, &[])
        };
        let new = ProviderInput {
            name: Some("K".into()),
            base_url: Some("https://k.example".into()),
            api_key: Some(KEY.into()),
            ..input(AgentKind::Codex)
        };
        assert!(save(ProviderInput { proxy: Some("127.0.0.1:7890".into()), ..new.clone() }).is_err());
        let r = save(ProviderInput { proxy: Some(" http://bob:pw@10.0.0.2:3128 ".into()), ..new }).unwrap();
        let id = r.id.unwrap();
        assert_eq!(r.view.unwrap().providers[0].proxy.as_deref(), Some("http://bob:****@10.0.0.2:3128"));
        let proxy = |home: &Path| Store::load(home).unwrap().get(&id).unwrap().proxy.clone();

        let edit =
            |proxy: &str| ProviderInput { id: Some(id.clone()), proxy: Some(proxy.into()), ..input(AgentKind::Codex) };
        save(edit("http://bob:****@10.0.0.2:3128")).unwrap();
        assert_eq!(proxy(home.path()).as_deref(), Some("http://bob:pw@10.0.0.2:3128"), "masked = unchanged");
        save(edit(" ")).unwrap();
        assert_eq!(proxy(home.path()), None, "empty = direct");
    }

    #[test]
    fn sets_the_official_logins_env_and_proxy_per_agent() {
        let home = tempfile::tempdir().unwrap();
        let set = |env: Option<&[(&str, &str)]>, proxy: Option<&str>| {
            let mut c = cmd(ProvidersAction::Official);
            c.agent = Some(AgentKind::Claude);
            c.official = Some(OfficialInput {
                env: env.map(|e| e.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
                proxy: proxy.map(String::from),
            });
            providers_op(home.path(), c, &[])
        };
        assert!(set(Some(&[("BAD-NAME", "1")]), None).is_err());
        assert!(set(None, Some("127.0.0.1:7890")).is_err());
        let view = set(Some(&[("DISABLE_TELEMETRY", "1")]), Some("http://bob:pw@10.0.0.2:3128")).unwrap().view.unwrap();
        let o = &view.official[&AgentKind::Claude];
        assert_eq!(o.proxy.as_deref(), Some("http://bob:****@10.0.0.2:3128"));
        assert_eq!(o.env["DISABLE_TELEMETRY"], "1");
        assert!(!view.official.contains_key(&AgentKind::Codex));

        set(None, Some("http://bob:****@10.0.0.2:3128")).unwrap();
        let stored = Store::load(home.path()).unwrap().official(AgentKind::Claude);
        assert_eq!(stored.proxy.as_deref(), Some("http://bob:pw@10.0.0.2:3128"), "masked = unchanged");
        assert_eq!(stored.env.len(), 1, "absent env = unchanged");

        let view = set(Some(&[]), Some("")).unwrap().view.unwrap();
        assert!(view.official.is_empty(), "cleared");
    }

    #[test]
    fn saves_from_a_preset_and_only_masked_keys_come_back() {
        let home = tempfile::tempdir().unwrap();
        let mut save = cmd(ProvidersAction::Save);
        save.set_default = Some(true);
        let env = [("HTTP_TIMEOUT", "30"), ("ENABLE_TOOL_SEARCH", "1")];
        save.provider = Some(ProviderInput {
            preset_id: Some("kimi-coding".into()),
            api_key: Some(KEY.into()),
            env: Some(env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
            ..input(AgentKind::Claude)
        });
        let r = providers_op(home.path(), save, &[]).unwrap();
        let id = r.id.clone().unwrap();
        let view = r.view.clone().unwrap();
        assert_eq!(view.machine.get(&AgentKind::Claude), Some(&id));
        let p = &view.providers[0];
        assert_eq!((p.api_key.as_str(), p.preset_id.as_deref()), ("****abcd", Some("kimi-coding")));
        assert_eq!(p.env.keys().collect::<Vec<_>>(), vec!["ENABLE_TOOL_SEARCH", "HTTP_TIMEOUT"]);
        let json = serde_json::to_string(&DaemonToServer::ProvidersResult(r)).unwrap();
        assert!(!json.contains(KEY));

        let mut edit = cmd(ProvidersAction::Save);
        edit.provider =
            Some(ProviderInput { id: Some(id.clone()), model: Some("k2".into()), ..input(AgentKind::Claude) });
        providers_op(home.path(), edit, &[]).unwrap();
        let stored = Store::load(home.path()).unwrap();
        let p = stored.get(&id).unwrap();
        assert_eq!((p.api_key.as_str(), p.model.as_deref(), p.revision), (KEY, Some("k2"), 2), "key kept when absent");

        let mut bad_env = cmd(ProvidersAction::Save);
        bad_env.provider = Some(ProviderInput {
            id: Some(id.clone()),
            env: Some([("A-B".to_string(), "1".to_string())].into()),
            ..input(AgentKind::Claude)
        });
        assert!(providers_op(home.path(), bad_env, &[]).is_err());

        let mut wrong = cmd(ProvidersAction::Save);
        wrong.provider = Some(ProviderInput { id: Some(id.clone()), ..input(AgentKind::Codex) });
        assert!(providers_op(home.path(), wrong, &[]).is_err());
    }

    #[test]
    fn uses_machine_and_bot_choices_and_reports_stale_sessions() {
        let home = tempfile::tempdir().unwrap();
        let id = Store::update(home.path(), |s| {
            let id =
                s.add(Provider::custom(AgentKind::Claude, "Kimi".into(), "https://k.example".into(), KEY.into()))?;
            s.pin("sess-1", AgentKind::Claude, "g1", "b1", &providers::Selection::Official(Default::default()));
            Ok(id)
        })
        .unwrap();

        let mut bot = cmd(ProvidersAction::Use);
        (bot.agent, bot.bot_id, bot.choice) = (Some(AgentKind::Claude), Some("b1".into()), Some(id.clone()));
        let view = providers_op(home.path(), bot, &[]).unwrap().view.unwrap();
        assert_eq!(view.bots.get("b1"), Some(&id));
        assert_eq!(view.sessions[0].provider, providers::OFFICIAL);

        let (out, mut rx) = Outbox::channel();
        let manage = Manage::new(home.path().into(), home.path().join("none"));
        manage.report(&out);
        let DaemonToServer::BotsProviderState { items } = rx.try_recv().unwrap() else { panic!() };
        assert_eq!(
            items,
            vec![ProviderStateItem {
                group_id: "g1".into(),
                bot_id: "b1".into(),
                session: providers::OFFICIAL_NAME.into(),
                effective: "Kimi".into()
            }]
        );
        manage.report(&out);
        assert!(rx.try_recv().is_err(), "unchanged state is not sent again");
        manage.connected();
        manage.report(&out);
        assert!(rx.try_recv().is_ok(), "a new connection gets it again");

        let mut inherit = cmd(ProvidersAction::Use);
        (inherit.agent, inherit.choice) = (Some(AgentKind::Claude), Some(INHERIT.into()));
        assert!(providers_op(home.path(), inherit, &[]).is_err(), "the machine default cannot inherit");
        let mut codex = cmd(ProvidersAction::Use);
        (codex.agent, codex.choice) = (Some(AgentKind::Codex), Some(id));
        assert!(providers_op(home.path(), codex, &[]).is_err(), "a claude provider cannot serve codex");
    }

    #[test]
    fn catalog_lists_declared_models_once() {
        let mut p = Provider::custom(AgentKind::Claude, "K".into(), "https://k.example".into(), KEY.into());
        p.model = Some("a".into());
        p.models = Some(ModelMap { haiku: Some("b".into()), sonnet: Some("a".into()), opus: None });
        let c = catalog(&p);
        assert_eq!(c.models.iter().map(|m| m.choice.value.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(c.current.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn bot_catalog_follows_what_a_new_session_would_use() {
        let home = tempfile::tempdir().unwrap();
        let official = AgentCatalog { current: Some("opus".into()), ..Default::default() };
        let claude = AgentInfo {
            kind: AgentKind::Claude,
            available: true,
            version: Some("2.1.0".into()),
            path: None,
            min_version: None,
            catalog: Some(official.clone()),
            latest: None,
            managed: false,
        };
        let manage = Manage::new(home.path().into(), home.path().join(".cc-switch"));
        manage.watch_agents(watch::channel(vec![claude]).0);
        let (out, mut rx) = Outbox::channel();
        let mut ask = async |bot: Option<&str>| {
            let mut c = cmd(ProvidersAction::BotCatalog);
            (c.agent, c.bot_id) = (Some(AgentKind::Claude), bot.map(Into::into));
            manage.providers(c, &out);
            let DaemonToServer::ProvidersResult(r) = rx.recv().await.unwrap() else { panic!() };
            assert!(r.ok, "{:?}", r.error);
            r.catalog
        };
        assert_eq!(ask(Some("b1")).await, Some(official.clone()), "official: the adapter's catalog");

        Store::update(home.path(), |s| {
            let mut p = Provider::custom(AgentKind::Claude, "Kimi".into(), "https://k.example".into(), KEY.into());
            p.model = Some("kimi-for-coding".into());
            let id = s.add(p)?;
            s.use_machine(AgentKind::Claude, &id)?;
            s.use_bot("b2", AgentKind::Claude, providers::OFFICIAL)
        })
        .unwrap();
        let third = ask(Some("b1")).await.unwrap();
        assert_eq!(third.models.iter().map(|m| m.choice.value.as_str()).collect::<Vec<_>>(), vec!["kimi-for-coding"]);
        assert_eq!(ask(None).await, Some(third), "a new bot gets the machine default");
        assert_eq!(ask(Some("b2")).await, Some(official), "the bot's override wins");
    }

    #[test]
    fn features_include_cc_switch_only_when_present() {
        let home = tempfile::tempdir().unwrap();
        let without = Manage::new(home.path().into(), home.path().join(".cc-switch"));
        assert_eq!(without.features(), vec!["tools", "providers", "sync"]);
        std::fs::create_dir(home.path().join(".cc-switch")).unwrap();
        assert_eq!(without.features(), vec!["tools", "providers", "sync", "ccSwitch"]);
    }

    #[tokio::test]
    async fn tools_settings_change_the_mirror_and_answer_with_the_status() {
        let home = tempfile::tempdir().unwrap();
        let manage = Manage::new(home.path().into(), home.path().join(".cc-switch"));
        let (out, mut rx) = Outbox::channel();
        // Unreachable mirror: the status is answered without update hints, and fast.
        let mirror =
            Mirror::Custom { registry: "http://127.0.0.1:9/npm".into(), node: "http://127.0.0.1:9/node".into() };
        let settings = ToolsCmd {
            request_id: "t1".into(),
            action: ToolsAction::Settings,
            kind: None,
            version: None,
            mirror: Some(mirror.clone()),
        };
        manage.tools(settings, &out);
        let DaemonToServer::ToolsResult { request_id, ok, tools, settings, .. } = rx.recv().await.unwrap() else {
            panic!()
        };
        assert_eq!((request_id.as_str(), ok, settings.mirror), ("t1", true, mirror));
        assert_eq!(tools.len(), 3);
        assert!(tools.iter().all(|t| t.latest.is_none()));

        let bad = ToolsCmd {
            request_id: "t2".into(),
            action: ToolsAction::Install,
            kind: Some(tools::ToolKind::Claude),
            version: Some("1.0; rm -rf /".into()),
            mirror: None,
        };
        manage.tools(bad, &out);
        let DaemonToServer::ToolsResult { ok, error, .. } = rx.recv().await.unwrap() else { panic!() };
        assert!(!ok && error.unwrap().contains("版本号格式不正确"));
    }

    #[test]
    fn clips_on_char_boundaries() {
        assert_eq!(clip("安装完成", 4), "安");
        assert_eq!(clip("ok", 10), "ok");
    }
}
