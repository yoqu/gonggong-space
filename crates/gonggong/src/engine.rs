//! Executes server-dispatched runs: one adapter process per (group, bot) session (plan D20).
use crate::agents;
use crate::ask::{AskServer, Asker};
use crate::attachments;
use crate::cast::Casts;
use crate::coalesce::Coalesce;
use crate::config::{Config, Settings};
use crate::explorer;
use crate::files;
use crate::git;
use crate::hosted::Services;
use crate::i18n::Reason;
use crate::inject;
use crate::local::LocalSettings;
use crate::manage::Manage;
use crate::protocol::{
    AgentCatalog, AgentKind, Approval, Attachment, DaemonToServer, DiffScope, RunBot, RunDone, RunOutcome, RunStart,
    RunSyncDone, ServerToDaemon, ServiceInfo, SyncWaitIssue, Tier,
};
use crate::providers::Selection;
use crate::replicas::{Init, Refusal, Replicas, sync_error};
use crate::repo;
use crate::service::{Handler, Outbox};
use crate::session::{self, Shared, TurnReq};
use crate::t;
use crate::tools;
use crate::tunnel;
use crate::turn::system_prompt;
use crate::workspace::{self, Workspaces};
use agent_client_protocol::{AcpAgent, AcpAgentConfig};
use anyhow::{Context, bail};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::sync::mpsc;

/// Pinned ACP adapters (plan D19), installed under `<home>/adapters/`. Both declare `bin: dist/index.js`.
pub const ADAPTERS: [(AgentKind, &str, &str); 2] = [
    (AgentKind::Claude, "@agentclientprotocol/claude-agent-acp", "0.81.0"),
    (AgentKind::Codex, "@agentclientprotocol/codex-acp", "1.13.0"),
];
const PROBE_TIMEOUT: Duration = Duration::from_secs(90);
/// Claude Code aborts an HTTP MCP call after a minute, or five silent minutes, while 「向群成员提问」 waits for a person
/// up to the group's timeout (at most a day): the call must outlast it.
const ASK_TIMEOUT_MS: &str = "90000000";

pub struct EngineConfig {
    pub home: PathBuf,
    /// Replaces the adapter command for every agent (tests / debugging), e.g. `node tools/mock-agent/agent.js`.
    pub adapter_cmd: Option<String>,
    /// Adapter processes idle this long are reaped; the next turn resumes the session in a new one.
    pub idle: Duration,
    /// Server REST access for downloading attachments; `None` (tests) skips them.
    pub api: Option<Config>,
}

#[derive(Clone)]
pub struct Engine(Arc<Inner>);

pub(crate) struct Inner {
    pub(crate) config: EngineConfig,
    pub(crate) workspaces: Workspaces,
    actors: Mutex<HashMap<(String, String), Actor>>,
    install: tokio::sync::Mutex<()>,
    /// Started with the first run.
    ask: tokio::sync::OnceCell<AskServer>,
    /// Runs received but still preparing (workspace, attachments): already active for hello reconciliation.
    preparing: Mutex<HashSet<String>>,
    pub(crate) services: Services,
    casts: Casts,
    previews: tunnel::Allow,
    /// The server offered the preview tunnel (welcome).
    tunnel: tokio::sync::watch::Sender<bool>,
    /// Every viewer of a live turn refetches its diff as the run moves, and each diff stages the whole work tree.
    diffs: Coalesce<String, DiffResult>,
    diff_slots: Arc<tokio::sync::Semaphore>,
    /// Agent tools and providers driven from the Web.
    manage: Manage,
    replicas: Arc<Replicas>,
}

type DiffResult = Result<(Option<String>, Option<String>), String>;
/// Workspace diffs computed at once; more wait for a slot.
const DIFF_SLOTS: usize = 2;

/// Drops a run from `Inner::preparing` however `start` exits.
struct Preparing<'a>(&'a Inner, String);
impl Drop for Preparing<'_> {
    fn drop(&mut self) {
        self.0.preparing.lock().unwrap().remove(&self.1);
    }
}

struct Actor {
    tx: mpsc::UnboundedSender<TurnReq>,
    shared: Arc<Shared>,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        let workspaces = Workspaces::new(config.home.clone());
        let services = Services::new(&config.home);
        let bin = crate::cast::local_bin();
        let casts =
            Casts::new(config.api.clone(), config.home.clone(), services.clone(), bin, crate::wechatide::devtools());
        let home = config.home.clone();
        let replicas = Replicas::new(home.clone(), config.api.as_ref());
        Engine(Arc::new(Inner {
            config,
            workspaces,
            actors: Mutex::default(),
            install: tokio::sync::Mutex::default(),
            ask: tokio::sync::OnceCell::new(),
            preparing: Mutex::default(),
            services,
            casts,
            previews: tunnel::Allow::default(),
            tunnel: tokio::sync::watch::Sender::new(false),
            diffs: Coalesce::default(),
            diff_slots: Arc::new(tokio::sync::Semaphore::new(DIFF_SLOTS)),
            manage: Manage::new(home, crate::config::user_home().join(".cc-switch")),
            replicas,
        }))
    }

    /// Local agent detection, republished after a tool is installed or upgraded from the Web.
    pub fn watch_agents(&self, tx: tokio::sync::watch::Sender<Vec<crate::protocol::AgentInfo>>) {
        self.0.manage.watch_agents(tx);
    }

    pub fn services(&self) -> Services {
        self.0.services.clone()
    }

    /// True once a server that serves previews welcomed this daemon.
    pub fn tunnel_offered(&self) -> tokio::sync::watch::Receiver<bool> {
        self.0.tunnel.subscribe()
    }

    /// Ports the preview tunnel may forward to, kept current by `previews.sync`.
    pub fn previews(&self) -> tunnel::Allow {
        self.0.previews.clone()
    }

    /// What the agent's adapter offers (models and their thought levels), from a throwaway session.
    pub async fn probe(&self, kind: AgentKind) -> anyhow::Result<AgentCatalog> {
        let local = LocalSettings::load(&self.0.config.home)?;
        let bot = RunBot {
            id: String::new(),
            name: String::new(),
            agent_kind: kind,
            system_prompt: String::new(),
            tier: Tier::ReadOnly,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
        };
        let agent = AcpAgent::new(self.0.adapter(&bot, &local, &Selection::Official).await?);
        let dir = self.0.config.home.join("probe");
        tokio::fs::create_dir_all(&dir).await?;
        let probe = session::probe(agent, &dir);
        match tokio::time::timeout(PROBE_TIMEOUT, probe).await {
            Ok(result) => result.map_err(anyhow::Error::msg),
            Err(_) => bail!(t!("探测 {kind} 可选模型超时", kind = format!("{kind:?}"))),
        }
    }
}

/// (patch, main branch compared against) of one workspace diff request.
/// How long the server waits for a workspace diff (DIFF_TIMEOUT_MS).
const DIFF_TIMEOUT: Duration = Duration::from_secs(10);

async fn workspace_diff(dir: &Path, scope: DiffScope, run_id: Option<&str>, shared: Option<Arc<Shared>>) -> DiffResult {
    let ended = t!("该轮已结束或不在本机运行");
    if scope == DiffScope::Turn {
        let (Some(run_id), Some(shared)) = (run_id, shared) else { return Err(ended.into()) };
        return Ok((shared.live_patch(run_id).await.ok_or(ended)??, None));
    }
    if !git::is_repo(dir) {
        return Err(session::not_git().into());
    }
    if scope == DiffScope::Uncommitted {
        return Ok((git::uncommitted_patch(dir).await?, None));
    }
    let b = git::base_patch(dir).await?;
    Ok((b.patch, b.base))
}

impl Handler for Engine {
    fn handle(&self, msg: ServerToDaemon, out: &Outbox) {
        match msg {
            ServerToDaemon::RunStart(start) => {
                // A start the server sent again (it never gets an ack) must not run the turn twice.
                if self.active_runs().contains(&start.run_id) {
                    tracing::warn!("run.start for {} ignored: it is already running here", start.run_id);
                    return;
                }
                self.0.preparing.lock().unwrap().insert(start.run_id.clone());
                tokio::spawn(self.0.clone().start(*start, out.clone()));
            }
            ServerToDaemon::RunCancel { run_id } => {
                for actor in self.0.actors.lock().unwrap().values() {
                    actor.shared.cancel(&run_id);
                }
            }
            ServerToDaemon::TaskStop { run_id, task_id } => {
                self.0.actors.lock().unwrap().values().any(|a| a.shared.stop_task(&run_id, &task_id));
            }
            ServerToDaemon::RunTier { run_id, tier } => {
                self.0.actors.lock().unwrap().values().any(|a| a.shared.set_tier(&run_id, tier));
            }
            // Never block the handler; per-(group, bot) ordering is kept by Workspaces' locks.
            ServerToDaemon::WorkspaceEnsure(req) => {
                let (inner, out) = (self.0.clone(), out.clone());
                tokio::spawn(async move { inner.workspaces.ensure(req, &out).await });
            }
            ServerToDaemon::WorkspaceCd(req) => {
                let (inner, out) = (self.0.clone(), out.clone());
                tokio::spawn(async move { inner.workspaces.cd(req, &out).await });
            }
            ServerToDaemon::RunDiscard { run_id } => {
                let sessions: Vec<_> = self.0.actors.lock().unwrap().values().map(|a| a.shared.clone()).collect();
                let out = out.clone();
                tokio::spawn(async move {
                    let mut result =
                        Err(t!("找不到这一轮的改动快照（daemon 已重启、已丢弃过或该 Bot 已开始新一轮）").to_string());
                    for shared in sessions {
                        if let Some(r) = shared.discard(&run_id).await {
                            result = r;
                            break;
                        }
                    }
                    let (ok, files, error) = match result {
                        Ok(n) => (true, n as u32, None),
                        Err(e) => (false, 0, Some(e)),
                    };
                    out.send(DaemonToServer::RunDiscarded { run_id, ok, files, error });
                });
            }
            ServerToDaemon::ApprovalDecision { run_id, request_id, option_id } => {
                let actors = self.0.actors.lock().unwrap();
                actors.values().any(|a| a.shared.decide(&run_id, &request_id, option_id.clone()));
            }
            ServerToDaemon::QuestionAnswer { run_id, request_id, answers, attachments, answered_by } => {
                self.0.clone().deliver(run_id.clone(), attachments.clone(), move |shared| {
                    shared.answer(&run_id, &request_id, answers.as_deref(), &attachments, answered_by.as_deref())
                });
            }
            ServerToDaemon::RunAppend { run_id, text, from, attachments } => {
                self.0.clone().deliver(run_id.clone(), attachments.clone(), move |shared| {
                    shared.append(&run_id, &from, &text, attachments.clone())
                });
            }
            ServerToDaemon::DirList { request_id, path } => {
                let out = out.clone();
                tokio::spawn(
                    async move { out.send(DaemonToServer::DirResult(workspace::browse(request_id, path).await)) },
                );
            }
            ServerToDaemon::FilesList(req) => {
                let dir = self.0.workspaces.dir(&req.group_id, &req.bot_id, &req.workspace);
                let out = out.clone();
                tokio::spawn(async move {
                    let (entries, error) = match files::list(&dir, &req.query, req.limit as usize).await {
                        Ok(entries) => (entries, None),
                        Err(e) => (vec![], Some(e)),
                    };
                    out.send(DaemonToServer::FilesResult { request_id: req.request_id, entries, error });
                });
            }
            ServerToDaemon::FilesTree(req) => {
                let dir = self.0.workspaces.dir(&req.group_id, &req.bot_id, &req.workspace);
                let out = out.clone();
                tokio::spawn(async move {
                    let (entries, truncated, error) = match explorer::tree(&dir, &req.path, req.show_ignored).await {
                        Ok((entries, truncated)) => (entries, truncated, None),
                        Err(e) => (vec![], false, Some(e)),
                    };
                    out.send(DaemonToServer::FilesTreeResult { request_id: req.request_id, entries, truncated, error });
                });
            }
            ServerToDaemon::FilesRead(req) => {
                let dir = self.0.workspaces.dir(&req.group_id, &req.bot_id, &req.workspace);
                let out = out.clone();
                tokio::spawn(async move {
                    let request_id = req.request_id;
                    out.send(match explorer::read(&dir, &req.path, req.max_bytes).await {
                        Ok(r) => DaemonToServer::FilesReadResult {
                            request_id,
                            size: r.size,
                            binary: r.binary,
                            mime: r.mime,
                            text: r.text,
                            error: None,
                        },
                        Err(e) => DaemonToServer::FilesReadResult {
                            request_id,
                            size: 0,
                            binary: false,
                            mime: String::new(),
                            text: None,
                            error: Some(e),
                        },
                    });
                });
            }
            ServerToDaemon::WorkspaceDiff(req) => {
                let dir = self.0.workspaces.dir(&req.group_id, &req.bot_id, &req.workspace);
                let key = (req.group_id.clone(), req.bot_id.clone());
                let shared = self.0.actors.lock().unwrap().get(&key).map(|a| a.shared.clone());
                let (inner, out) = (self.0.clone(), out.clone());
                tokio::spawn(async move {
                    let key = format!("{}|{:?}|{:?}", dir.display(), req.scope, req.run_id);
                    let (slots, d, run_id) = (inner.diff_slots.clone(), dir.clone(), req.run_id.clone());
                    // The server stops waiting by then; dropping the work kills its git processes and frees the slot.
                    let compute = async move {
                        let work = async {
                            let _slot = slots.acquire_owned().await.expect("never closed");
                            workspace_diff(&d, req.scope, run_id.as_deref(), shared).await
                        };
                        tokio::time::timeout(DIFF_TIMEOUT, work)
                            .await
                            .unwrap_or_else(|_| Err(t!("读取工作区改动超时").into()))
                    };
                    let result = inner.diffs.run(key, compute).await;
                    let (patch, base, error) = match result {
                        Ok((patch, base)) => (patch, base, None),
                        Err(e) => (None, None, Some(e)),
                    };
                    let branch = if git::is_repo(&dir) { git::branch(&dir).await } else { None };
                    out.send(DaemonToServer::WorkspaceDiffResult {
                        request_id: req.request_id,
                        patch,
                        base,
                        branch,
                        error,
                    });
                });
            }
            ServerToDaemon::RepoProbe(req) => {
                let out = out.clone();
                tokio::spawn(async move { out.send(DaemonToServer::RepoProbeResult(repo::probe(req).await)) });
            }
            ServerToDaemon::Welcome { .. } | ServerToDaemon::Reject { .. } => {}
            ServerToDaemon::SyncResult { submit_id, result, .. } => self.0.replicas.on_result(&submit_id, result),
            ServerToDaemon::SyncAvailable { group_id, .. } => self.0.replicas.on_available(&group_id, out),
            ServerToDaemon::SyncInit { group_id, bot_id, role, force, repo_id } => {
                let init = Init { group: group_id, bot: bot_id, role, force, repo_id };
                self.0.replicas.on_init(init, out)
            }
            ServerToDaemon::SyncAction { group_id, bot_id, action } => {
                self.0.replicas.on_action(group_id, bot_id, action, out)
            }
            ServerToDaemon::ServiceStop { service_id } => {
                let services = self.0.services.clone();
                tokio::spawn(async move { services.stop_id(&service_id).await });
            }
            ServerToDaemon::ServiceRestart { request_id, service_id } => {
                let (services, out) = (self.0.services.clone(), out.clone());
                tokio::spawn(async move {
                    let error = services.restart_id(&service_id, &out).await.err();
                    out.send(DaemonToServer::ServiceRestartResult { request_id, error });
                });
            }
            ServerToDaemon::PreviewsSync { previews } => {
                tunnel::set_allowed(&self.0.previews, previews.into_iter().map(|p| (p.id, p.port)).collect());
            }
            ServerToDaemon::CastSync { casts } => self.0.casts.sync(casts, out),
            ServerToDaemon::CastRetry { preview_id } => self.0.casts.retry(&preview_id),
            ServerToDaemon::ToolsCmd(cmd) => self.0.manage.tools(cmd, out),
            ServerToDaemon::ProvidersCmd(cmd) => self.0.manage.providers(*cmd, out),
            ServerToDaemon::CcSwitchRead { request_id } => self.0.manage.ccswitch_read(request_id, out),
            ServerToDaemon::CcSwitchApply { request_id, keys, set_default } => {
                self.0.manage.ccswitch_apply(request_id, keys, set_default, out)
            }
        }
    }

    fn features(&self) -> Vec<String> {
        self.0.manage.features()
    }

    fn report(&self, out: &Outbox) {
        self.0.manage.report(out);
    }

    fn services(&self) -> Vec<ServiceInfo> {
        self.0.services.live()
    }

    fn connected(&self, tunnel: bool) {
        self.0.tunnel.send_replace(tunnel);
        self.0.manage.connected();
        self.0.replicas.connected();
    }

    fn active_runs(&self) -> Vec<String> {
        let preparing = self.0.preparing.lock().unwrap().clone();
        let running = self.0.actors.lock().unwrap().values().flat_map(|a| a.shared.runs()).collect::<Vec<_>>();
        preparing.into_iter().chain(running).collect::<HashSet<_>>().into_iter().collect()
    }
}

impl Inner {
    async fn start(self: Arc<Self>, start: RunStart, out: Outbox) {
        let _preparing = Preparing(&self, start.run_id.clone());
        // Read per run, so edits from the CLI or the desktop app apply from the next turn on.
        let local = match LocalSettings::load(&self.config.home) {
            Ok(local) => local,
            Err(e) => return out.send(failed(&start.run_id, format!("{e:#}"))),
        };
        let cwd = match self.workspaces.resolve(&start).await {
            Ok(dir) => dir,
            Err(e) => return out.send(failed(&start.run_id, e)),
        };
        let sync = match self.replicas.before_turn(&start, &cwd, &out).await {
            Ok(sync) => sync,
            Err(Refusal::Wait(issue)) => return out.send(waiting(&start.run_id, issue)),
            Err(Refusal::Lost(reason)) => return out.send(lost(&start.run_id, reason)),
            Err(Refusal::Failed(e)) => return out.send(failed(&start.run_id, e.text)),
        };
        let ask =
            match self.ask.get_or_try_init(|| AskServer::start(self.config.api.clone(), self.services.clone())).await {
                Ok(ask) => ask,
                Err(e) => return out.send(failed(&start.run_id, t!("无法启动内置 gonggong 工具：{e}", e = e))),
            };
        if let Some(api) = &self.config.api {
            let p = &start.prompt;
            let context = p.context.iter().chain(&p.fallback_context).flat_map(|m| &m.attachments);
            let all: Vec<_> = p.attachments.iter().chain(context).collect();
            if let Err(e) = attachments::fetch(api, &cwd, all).await {
                return out.send(failed(&start.run_id, e));
            }
        }
        let mut actors = self.actors.lock().unwrap();
        let actor = actors.entry((start.group_id.clone(), start.bot.id.clone())).or_insert_with(|| {
            let (tx, rx) = mpsc::unbounded_channel();
            let shared = Arc::new(Shared::default());
            let entry = ask.register(Arc::downgrade(&shared) as Weak<dyn Asker>);
            tokio::spawn(session::run(self.clone(), shared.clone(), entry, rx));
            Actor { tx, shared }
        });
        actor.shared.enqueue(&start.run_id);
        let behind = sync.as_ref().and_then(|s| s.behind());
        let _ = actor.tx.send(TurnReq { start, cwd, out, local, sync, behind });
    }

    /// Hands an answer / append to the conversation running `run_id`, once its attachments are in that workspace.
    fn deliver(
        self: Arc<Self>,
        run_id: String,
        list: Vec<Attachment>,
        apply: impl Fn(&Shared) -> bool + Send + 'static,
    ) {
        let apply_all = move |inner: &Inner, run_id: &str| {
            let actors = inner.actors.lock().unwrap();
            if !actors.values().any(|a| apply(&a.shared)) {
                tracing::warn!("message for {run_id} dropped: the run is no longer running here");
            }
        };
        let Some(api) = self.config.api.clone().filter(|_| !list.is_empty()) else {
            return apply_all(&self, &run_id);
        };
        tokio::spawn(async move {
            let cwd = self.actors.lock().unwrap().values().find_map(|a| a.shared.cwd(&run_id));
            if let Some(cwd) = cwd
                && let Err(e) = attachments::fetch(&api, &cwd, &list).await
            {
                tracing::warn!("{e}");
            }
            apply_all(&self, &run_id);
        });
    }

    /// Launch config of the adapter for this bot, with the local agent CLI, per-process system prompt and the
    /// provider (§4.4; Claude's settings file is named per session).
    pub(crate) async fn adapter(
        &self,
        bot: &RunBot,
        local: &LocalSettings,
        selection: &Selection,
    ) -> anyhow::Result<AcpAgentConfig> {
        let base = match &self.config.adapter_cmd {
            Some(cmd) => AcpAgent::from_str(cmd)?.into_config(),
            None => {
                let (node, script) = self.ensure_adapter(bot.agent_kind).await?;
                // The agent CLIs npm installs are node scripts: they must find this Node too.
                AcpAgentConfig::new(&node.path)
                    .arg(script.to_string_lossy())
                    .env("PATH", node.path_env().to_string_lossy())
            }
        };
        let cli = agents::locate(&self.config.home, bot.agent_kind, local).map(|p| p.to_string_lossy().into_owned());
        let provider = match selection {
            Selection::Official => None,
            Selection::Provider(p) => Some(p.as_ref()),
        };
        Ok(match bot.agent_kind {
            AgentKind::Claude => {
                if let Some(p) = provider {
                    inject::write_claude_settings(&self.config.home, p)?;
                }
                base.env("MCP_TOOL_TIMEOUT", ASK_TIMEOUT_MS)
                    .env("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", ASK_TIMEOUT_MS)
                    .envs(cli.map(|p| ("CLAUDE_CODE_EXECUTABLE", p)))
            }
            AgentKind::Codex => {
                let mut config = serde_json::Map::new();
                config.insert("developer_instructions".into(), system_prompt(bot).into());
                if let Some(p) = provider {
                    inject::codex_config(&mut config, p);
                }
                base.env("CODEX_CONFIG", serde_json::Value::Object(config).to_string())
                    .envs(provider.map(inject::codex_env).into_iter().flatten())
                    .envs(cli.map(|p| ("CODEX_PATH", p)))
            }
        })
    }

    /// Installs the pinned adapters once (and the managed Node when no Node ≥ 22 is found), from the configured
    /// mirror; returns (node, adapter script).
    async fn ensure_adapter(&self, kind: AgentKind) -> anyhow::Result<(tools::Node, PathBuf)> {
        let _guard = self.install.lock().await;
        let home = &self.config.home;
        let log = |line: &str| tracing::info!("{line}");
        let node = tools::ensure_node(home, &log)
            .await
            .context(t!("ACP 适配器需要 Node.js ≥ {v}", v = tools::MIN_NODE_MAJOR))?;
        let dir = home.join("adapters");
        let modules = dir.join("node_modules");
        if !ADAPTERS.iter().all(|(_, name, ver)| installed_version(&modules.join(name)).as_deref() == Some(*ver)) {
            let registry = Settings::load(home)?.mirror.registry().to_string();
            tokio::fs::create_dir_all(&dir).await?;
            tracing::info!("installing ACP adapters into {} from {registry}", dir.display());
            let mut npm = node.npm().context(t!("无法安装 ACP 适配器"))?;
            npm.args(["install", "--no-audit", "--no-fund", "--registry", &registry, "--prefix"])
                .arg(&dir)
                .args(ADAPTERS.iter().map(|(_, name, ver)| format!("{name}@{ver}")));
            tools::run(npm, &log).await.context(t!("安装 ACP 适配器失败"))?;
        }
        let (_, name, _) = ADAPTERS.iter().find(|(k, ..)| *k == kind).expect("every agent kind has an adapter");
        Ok((node, modules.join(name).join("dist/index.js")))
    }
}

fn installed_version(pkg: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(pkg.join("package.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()?["version"].as_str().map(String::from)
}

/// The turn did not start: the server queues it again until the replica is settled (F11, F12).
fn waiting(run_id: &str, issue: SyncWaitIssue) -> DaemonToServer {
    let error = match issue {
        SyncWaitIssue::Drift => t!("工作区有未处理的本地改动（强制同步），处理后才能继续运行"),
        SyncWaitIssue::Held => t!("强制同步有冲突待处理，处理后才能继续运行"),
    };
    DaemonToServer::RunDone(RunDone { sync: Some(RunSyncDone::Waiting { issue }), ..failed_done(run_id, error.into()) })
}

/// The turn did not start: the server realigns the replica whose sync state this machine lost.
fn lost(run_id: &str, reason: Reason) -> DaemonToServer {
    let error = reason.text.clone();
    DaemonToServer::RunDone(RunDone { sync: Some(sync_error(reason)), ..failed_done(run_id, error) })
}

pub(crate) fn failed(run_id: &str, error: String) -> DaemonToServer {
    DaemonToServer::RunDone(failed_done(run_id, error))
}

fn failed_done(run_id: &str, error: String) -> RunDone {
    RunDone {
        run_id: run_id.into(),
        outcome: RunOutcome::Failed,
        reply: String::new(),
        files_changed: 0,
        usage: None,
        session_id: None,
        new_session_reason: None,
        error: Some(error),
        git: None,
        patch: None,
        appends_applied: 0,
        sync: None,
    }
}
