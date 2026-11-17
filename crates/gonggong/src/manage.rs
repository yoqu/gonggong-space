//! The server side of this machine's agent tools and providers (design §4.6): `tools.cmd`, `providers.cmd` and
//! `ccswitch.*`, answered through the outbox. Keys only ever arrive (in `save` / `importLink`); what leaves is masked.
use crate::ccswitch;
use crate::config::{Config, Mirror, Settings};
use crate::local::LocalSettings;
use crate::protocol::{
    AgentCatalog, AgentState, Choice, DaemonToServer, DiagCheck, EndpointInput, FEATURE_AGENT_SETTINGS,
    FEATURE_AGENT_STATE, FEATURE_ANTIGRAVITY, FEATURE_APPROVAL_GATES, FEATURE_ARTIFACT_SNAPSHOT, FEATURE_ARTIFACTS,
    FEATURE_BUILTIN_REVIEW, FEATURE_CC_SWITCH, FEATURE_CLAUDE_ARGS, FEATURE_CLAUDE_PROFILE, FEATURE_CODEBUDDY,
    FEATURE_CONTAINER, FEATURE_COPILOT, FEATURE_DEEPSEEK, FEATURE_DIAG, FEATURE_GEMINI, FEATURE_GIT_ACCESS,
    FEATURE_GIT_OPS, FEATURE_GIT_OPS2, FEATURE_GIT_OPS3, FEATURE_GIT_OPS4, FEATURE_GIT_REPOS, FEATURE_GOOSE,
    FEATURE_KIMI, FEATURE_MACHINE_ADMIN, FEATURE_NO_AUTO_UPGRADE, FEATURE_OPENCODE, FEATURE_PI, FEATURE_PLUGIN_MCP,
    FEATURE_PLUGINS, FEATURE_PRESET_SYNC, FEATURE_PROTOCOL_PROVIDERS, FEATURE_PROVIDER_ARGS, FEATURE_PROVIDERS,
    FEATURE_QWEN, FEATURE_REPROBE, FEATURE_SESSION_FORK, FEATURE_STORAGE_ADMIN, FEATURE_SYNC, FEATURE_TOOLS,
    GitAccessCmd, ModelChoice, ModelMap, ProviderInput, ProviderStateItem, ProvidersAction, ProvidersCmd,
    ProvidersResult, ToolsAction, ToolsCmd, ToolsSettings,
};
use crate::providers::{self, API_KEY, AUTH_TOKEN, Endpoint, INHERIT, Provider, Store};
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
    /// Where `~/.cc-switch` and `~/.claude` are, both read only.
    user_home: PathBuf,
    /// Local agent detection, republished after a tool changed.
    agents: OnceLock<watch::Sender<Vec<AgentState>>>,
    /// The provider state the server holds for this machine (none after connecting).
    reported: Mutex<Vec<ProviderStateItem>>,
    /// Wakes the catalog prober: a local Claude profile may have been added, changed or asked for.
    profiles: Arc<tokio::sync::Notify>,
}

impl Manage {
    pub fn new(home: PathBuf, user_home: PathBuf) -> Self {
        Manage(Arc::new(Inner {
            home,
            user_home,
            agents: OnceLock::new(),
            reported: Mutex::default(),
            profiles: Arc::default(),
        }))
    }

    pub fn watch_agents(&self, tx: watch::Sender<Vec<AgentState>>) {
        let _ = self.0.agents.set(tx);
    }

    /// Notified when local Claude profiles may need probing.
    pub fn profile_probes(&self) -> Arc<tokio::sync::Notify> {
        self.0.profiles.clone()
    }

    pub fn features(&self) -> Vec<String> {
        let mut features = vec![
            FEATURE_TOOLS.to_string(),
            FEATURE_PROVIDERS.to_string(),
            FEATURE_SYNC.to_string(),
            FEATURE_SESSION_FORK.to_string(),
            FEATURE_AGENT_SETTINGS.to_string(),
            FEATURE_REPROBE.to_string(),
            FEATURE_PLUGINS.to_string(),
            FEATURE_PLUGIN_MCP.to_string(),
            FEATURE_PRESET_SYNC.to_string(),
            FEATURE_ARTIFACTS.to_string(),
            FEATURE_ARTIFACT_SNAPSHOT.to_string(),
            FEATURE_GIT_OPS.to_string(),
            FEATURE_GIT_OPS2.to_string(),
            FEATURE_GIT_REPOS.to_string(),
            FEATURE_GIT_OPS3.to_string(),
            FEATURE_GIT_OPS4.to_string(),
            FEATURE_MACHINE_ADMIN.to_string(),
            FEATURE_STORAGE_ADMIN.to_string(),
            FEATURE_CLAUDE_ARGS.to_string(),
            FEATURE_CLAUDE_PROFILE.to_string(),
            FEATURE_PROVIDER_ARGS.to_string(),
            FEATURE_GIT_ACCESS.to_string(),
            FEATURE_DIAG.to_string(),
            FEATURE_GEMINI.to_string(),
            FEATURE_CODEBUDDY.to_string(),
            FEATURE_APPROVAL_GATES.to_string(),
            FEATURE_BUILTIN_REVIEW.to_string(),
            FEATURE_PI.to_string(),
            FEATURE_DEEPSEEK.to_string(),
            FEATURE_ANTIGRAVITY.to_string(),
            FEATURE_OPENCODE.to_string(),
            FEATURE_QWEN.to_string(),
            FEATURE_KIMI.to_string(),
            FEATURE_GOOSE.to_string(),
            FEATURE_COPILOT.to_string(),
            FEATURE_AGENT_STATE.to_string(),
            FEATURE_PROTOCOL_PROVIDERS.to_string(),
        ];
        if self.0.cc_switch().is_dir() {
            features.push(FEATURE_CC_SWITCH.into());
        }
        if std::env::var("GONGGONG_CONTAINER").is_ok_and(|v| v == "1") {
            features.push(FEATURE_CONTAINER.into());
        }
        if !crate::upgrade::auto_upgrade(&self.0.home) {
            features.push(FEATURE_NO_AUTO_UPGRADE.into());
        }
        features
    }

    /// A new connection: the server dropped this machine's provider state when it went offline.
    pub fn connected(&self) {
        self.0.reported.lock().unwrap().clear();
    }

    /// [`Manage::report_now`] on a blocking thread: the connection loop calls it after every run.
    pub fn report(&self, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || this.report_now(&out));
    }

    /// `bots.providerState`, when it changed: sessions whose provider differs from what a new one would use (the
    /// server keeps it in memory only, replacing this machine's list).
    fn report_now(&self, out: &Outbox) {
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
            let (node, agents) = match LocalSettings::load(home) {
                Ok(local) => tools::state(home, &local).await,
                Err(_) => (None, vec![]),
            };
            let settings = ToolsSettings { mirror: Settings::load(home).map(|s| s.mirror).unwrap_or_default() };
            this.refresh_agents().await;
            out.send(DaemonToServer::ToolsResult {
                request_id: cmd.request_id,
                ok: error.is_none(),
                error,
                tools: vec![],
                node,
                agents,
                settings,
            });
        });
    }

    pub fn git_access(&self, cmd: GitAccessCmd, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::spawn(async move {
            let access = crate::git_access::GitAccess::new(this.0.home.clone(), this.0.user_home.clone());
            let request_id = cmd.request_id.clone();
            let msg = match access.run(cmd).await {
                Ok(o) => DaemonToServer::GitAccessResult {
                    request_id,
                    ok: true,
                    error: None,
                    view: Some(o.view),
                    test: o.test,
                },
                Err(e) => DaemonToServer::GitAccessResult {
                    request_id,
                    ok: false,
                    error: Some(format!("{e:#}")),
                    view: Some(access.view().await),
                    test: None,
                },
            };
            out.send(msg);
        });
    }

    /// `gg doctor`'s checks; `api` is the machine's server access.
    pub fn diag(&self, request_id: String, api: Option<Config>, out: &Outbox) {
        let (home, out) = (self.0.home.clone(), out.clone());
        tokio::spawn(async move {
            let checks = crate::diag::run(&home, api.as_ref()).await;
            let checks =
                checks.into_iter().map(|c| DiagCheck { kind: c.kind, status: c.status, detail: c.detail }).collect();
            out.send(DaemonToServer::DiagResult { request_id, checks });
        });
    }

    pub fn providers(&self, cmd: ProvidersCmd, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || {
            let changes = matches!(
                cmd.action,
                ProvidersAction::Save | ProvidersAction::Remove | ProvidersAction::Use | ProvidersAction::ImportLink
            );
            let (request_id, action) = (cmd.request_id.clone(), cmd.action);
            let agents = this.0.agents.get().map(|tx| tx.borrow().clone()).unwrap_or_default();
            let result = providers_op(&this.0.home, &this.0.user_home, cmd, &agents)
                .unwrap_or_else(|e| ProvidersResult { ok: false, error: Some(format!("{e:#}")), ..answer(request_id) });
            let ok = result.ok;
            out.send(DaemonToServer::ProvidersResult(result));
            if ok && (changes || matches!(action, ProvidersAction::Catalog | ProvidersAction::BotCatalog)) {
                this.0.profiles.notify_one();
            }
            if ok && changes {
                this.report_now(&out);
            }
        });
    }

    pub fn ccswitch_read(&self, request_id: String, out: &Outbox) {
        let (this, out) = (self.clone(), out.clone());
        tokio::task::spawn_blocking(move || {
            let read = || -> Result<_> {
                let candidates = ccswitch::read(&this.0.cc_switch())?;
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
                let candidates = ccswitch::read(&this.0.cc_switch())?;
                let (home, user_home) = (&this.0.home, &this.0.user_home);
                Store::update(home, |s| {
                    Ok((ccswitch::apply(&candidates, &keys, set_default, s)?, s.view_with_cli(home, user_home)))
                })
            };
            match apply() {
                Ok((imported, view)) => {
                    out.send(ccswitch_result(request_id, None, vec![], imported, Some(view)));
                    this.report_now(&out);
                }
                Err(e) => out.send(ccswitch_result(request_id, Some(format!("{e:#}")), vec![], vec![], None)),
            }
        });
    }

    pub async fn refresh_agents(&self) {
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

impl Inner {
    fn cc_switch(&self) -> PathBuf {
        self.user_home.join(".cc-switch")
    }
}

/// `agents`: this machine's detection, whose catalogs are what official logins offer. Every view carries the CLI's
/// own config read from `user_home`.
fn providers_op(home: &Path, user_home: &Path, cmd: ProvidersCmd, agents: &[AgentState]) -> Result<ProvidersResult> {
    let mut r = providers_change(home, cmd, agents)?;
    if let Some(view) = r.view.as_mut() {
        view.cli = crate::agent_settings::cli_snapshots(home, user_home);
    }
    Ok(r)
}

fn providers_change(home: &Path, cmd: ProvidersCmd, agents: &[AgentState]) -> Result<ProvidersResult> {
    let mut r = answer(cmd.request_id.clone());
    match cmd.action {
        ProvidersAction::Presets => r.presets = Some(providers::presets(cmd.agent)),
        ProvidersAction::List => r.view = Some(Store::load(home)?.view()),
        ProvidersAction::Catalog => {
            let id = cmd.id.context(t!("缺少供应商"))?;
            let store = Store::load(home)?;
            let p = store.get(&id).with_context(|| t!("供应商 {id} 不存在", id = id))?;
            let e = match cmd.agent {
                Some(agent) => p.endpoint_for(agent).with_context(|| {
                    t!(
                        "供应商 {name} 没有 {agent} 能用的协议端点",
                        name = p.name,
                        agent = crate::bots::agent_label(agent)
                    )
                })?,
                None => &p.endpoints[0],
            };
            r.catalog = endpoint_catalog(home, p, e, agents);
        }
        ProvidersAction::BotCatalog => {
            let agent = cmd.agent.context(t!("缺少 agent"))?;
            let store = Store::load(home)?;
            let selection = match &cmd.bot_id {
                Some(bot) => store.effective(agent, bot)?,
                None => store.machine_default(agent)?,
            };
            r.catalog = match selection.provider() {
                None => agents.iter().find(|a| a.kind == agent && a.available).and_then(|a| a.catalog.clone()),
                Some((p, e)) => endpoint_catalog(home, p, e, agents),
            };
        }
        ProvidersAction::Save => {
            let input = cmd.provider.context(t!("缺少供应商内容"))?;
            let default = match cmd.set_default {
                Some(true) => Some(cmd.agent.context(t!("缺少 agent"))?),
                _ => None,
            };
            let (id, view) = Store::update(home, |s| {
                let id = save(s, input)?;
                if let Some(agent) = default {
                    s.use_machine(agent, &id, None)?;
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
            crate::inject::prune(home, &store, None);
            r.view = Some(store.view());
        }
        ProvidersAction::Use => {
            let (agent, choice) = cmd.agent.zip(cmd.choice).context(t!("缺少 agent 或要使用的供应商"))?;
            r.view = Some(Store::update(home, |s| {
                match &cmd.bot_id {
                    Some(bot) => s.use_bot(bot, agent, &choice)?,
                    None if choice == INHERIT => bail!(t!("本机默认不能选择「继承」")),
                    None => s.use_machine(agent, &choice, cmd.model)?,
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
                    o.env = providers::unmask_env(env, &o.env);
                }
                if let Some(proxy) = input.proxy {
                    set_proxy(&mut o.proxy, proxy);
                }
                if let Some(args) = input.args {
                    o.args = arg_lines(args);
                }
                s.set_official(agent, o)?;
                Ok(s.view())
            })?);
        }
        ProvidersAction::AgentSettings => {
            let agent = cmd.agent.context(t!("缺少 agent"))?;
            let settings = cmd.agent_settings.context(t!("缺少 Agent 设置"))?;
            r.view = Some(Store::update(home, |s| {
                s.set_agent_settings(agent, settings)?;
                Ok(s.view())
            })?);
        }
        ProvidersAction::ImportLink => {
            let (agent, p) = ccswitch::parse_link(cmd.link.as_deref().context(t!("缺少导入链接"))?)?;
            let set_default = cmd.set_default.unwrap_or(false);
            let (id, view) = Store::update(home, |s| {
                let id = s.upsert(p)?;
                if set_default {
                    s.use_machine(agent, &id, None)?;
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
        store.edit(&id, |p| apply(p, input))?;
        return Ok(id);
    }
    let profile = input.endpoints.iter().flatten().any(|e| e.config_dir.is_some());
    let key =
        if profile { String::new() } else { input.api_key.clone().context(t!("新增供应商需要填写 API Key"))? };
    let mut p = match &input.preset_id {
        Some(preset) => Provider::from_preset(
            &providers::preset(preset).with_context(|| t!("没有预设 {preset}", preset = preset))?,
            key,
        ),
        None => Provider::new(input.name.clone().unwrap_or_default(), key, vec![]),
    };
    // A new endpoint needs a URL unless the preset has one (or it is a local profile).
    let missing_url =
        |e: &EndpointInput| p.endpoint(e.protocol).is_none() && e.base_url.is_none() && e.config_dir.is_none();
    if input.endpoints.iter().flatten().any(missing_url) || (p.endpoints.is_empty() && input.endpoints.is_none()) {
        bail!(t!("自定义供应商需要填写 Base URL"));
    }
    apply(&mut p, input);
    store.add(p)
}

fn apply(p: &mut Provider, input: ProviderInput) {
    if let Some(name) = input.name {
        p.name = name.trim().into();
    }
    if let Some(key) = input.api_key {
        p.api_key = key.trim().into();
    }
    if let Some(proxy) = input.proxy {
        set_proxy(&mut p.proxy, proxy);
    }
    for e in input.endpoints.into_iter().flatten() {
        let preset = p.preset_endpoint(e.protocol);
        let endpoint = match p.endpoint_mut(e.protocol) {
            Some(endpoint) => endpoint,
            None => {
                let new = match &preset {
                    Some(preset) => Endpoint::from_preset(preset),
                    None => Endpoint::new(e.protocol, String::new()),
                };
                p.endpoints.push(new);
                p.endpoints.last_mut().expect("just pushed")
            }
        };
        apply_endpoint(endpoint, e);
    }
    for protocol in input.remove_protocols.into_iter().flatten() {
        p.endpoints.retain(|e| e.protocol != protocol);
    }
}

fn apply_endpoint(e: &mut Endpoint, input: EndpointInput) {
    let text = |s: String| Some(s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(dir) = input.config_dir {
        e.config_dir = text(dir);
    }
    if let Some(exe) = input.executable_path {
        e.executable_path = text(exe);
    }
    if let Some(url) = input.base_url {
        e.base_url = url.trim().into();
    }
    if e.config_dir.is_some() {
        e.api_key_field = None;
    }
    if let Some(field) = input.api_key_field.filter(|f| [AUTH_TOKEN, API_KEY].contains(&f.as_str())) {
        e.api_key_field = Some(field);
    }
    if let Some(model) = input.model {
        e.model = text(model);
    }
    if let Some(models) = input.models {
        e.models = (models != ModelMap::default()).then_some(models);
    }
    if let Some(env) = input.env {
        e.env = providers::unmask_env(env, &e.env);
    }
    if let Some(args) = input.args {
        e.args = arg_lines(args);
    }
    if let Some(effort) = input.effort {
        e.effort = text(effort);
    }
}

fn arg_lines(args: Vec<String>) -> Vec<String> {
    args.into_iter().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

/// '' = direct; the masked one from the view = unchanged.
fn set_proxy(stored: &mut Option<String>, input: String) {
    let input = input.trim();
    if Some(input.to_string()) != stored.as_deref().map(providers::mask_proxy) {
        *stored = Some(input.to_string()).filter(|s| !s.is_empty());
    }
}

/// What a new session on the endpoint may pick: a local Claude profile's probed catalog (until probed, the official
/// login's: the same CLI), else what the endpoint declares.
fn endpoint_catalog(home: &Path, p: &Provider, e: &Endpoint, agents: &[AgentState]) -> Option<AgentCatalog> {
    if e.claude_profile().is_none() {
        return Some(catalog(p, e));
    }
    let claude = agents.iter().find(|a| a.kind == crate::protocol::AgentKind::Claude && a.available);
    crate::agents::profile_catalog(home, e, claude).or_else(|| claude?.catalog.clone())
}

/// The models a third-party endpoint declares (its model, the haiku/sonnet/opus mapping, its preset's options).
fn catalog(p: &Provider, e: &Endpoint) -> AgentCatalog {
    let models = e.models.clone().unwrap_or_default();
    let preset = p.preset_endpoint(e.protocol);
    let mut names: Vec<String> = vec![];
    let declared = [e.model.clone(), models.haiku, models.sonnet, models.opus].into_iter().flatten();
    for name in declared.chain(preset.into_iter().flat_map(|pr| pr.model_options)) {
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
        current: e.model.clone(),
        efforts: vec![],
        effort: e.effort.clone(),
    }
}

#[cfg(test)]
mod tests;
