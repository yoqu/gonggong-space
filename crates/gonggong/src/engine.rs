//! Executes server-dispatched runs: one adapter process per (group, bot) session (plan D20).
use crate::agents;
use crate::ask::{AskServer, Asker};
use crate::attachments;
use crate::config::Config;
use crate::files;
use crate::local::LocalSettings;
use crate::protocol::{AgentKind, Attachment, DaemonToServer, RunBot, RunDone, RunOutcome, RunStart, ServerToDaemon};
use crate::service::{Handler, Outbox};
use crate::session::{self, Shared, TurnReq};
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
const MIN_NODE_MAJOR: u32 = 22;

pub struct EngineConfig {
    pub home: PathBuf,
    /// Replaces the adapter command for every agent (tests / debugging), e.g. `node tools/mock-agent/agent.js`.
    pub adapter_cmd: Option<String>,
    /// Adapter processes idle this long are reaped; the next turn resumes the session in a new one.
    pub idle: Duration,
    /// Server REST access for downloading attachments; `None` (tests) skips them.
    pub api: Option<Config>,
}

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
}

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
        Engine(Arc::new(Inner {
            config,
            workspaces,
            actors: Mutex::default(),
            install: tokio::sync::Mutex::default(),
            ask: tokio::sync::OnceCell::new(),
            preparing: Mutex::default(),
        }))
    }
}

impl Handler for Engine {
    fn handle(&self, msg: ServerToDaemon, out: &Outbox) {
        match msg {
            ServerToDaemon::RunStart(start) => {
                self.0.preparing.lock().unwrap().insert(start.run_id.clone());
                tokio::spawn(self.0.clone().start(*start, out.clone()));
            }
            ServerToDaemon::RunCancel { run_id } => {
                for actor in self.0.actors.lock().unwrap().values() {
                    actor.shared.cancel(&run_id);
                }
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
                        Err("找不到这一轮的改动快照（daemon 已重启、已丢弃过或该 Bot 已开始新一轮）".to_string());
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
            ServerToDaemon::Welcome { .. } | ServerToDaemon::Reject { .. } => {}
        }
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
        let ask = match self.ask.get_or_try_init(|| AskServer::start(self.config.api.clone())).await {
            Ok(ask) => ask,
            Err(e) => return out.send(failed(&start.run_id, format!("无法启动内置 gonggong 工具：{e}"))),
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
        let _ = actor.tx.send(TurnReq { start, cwd, out, local });
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

    /// Launch config of the adapter for this bot, with the local agent CLI and per-process system prompt.
    pub(crate) async fn adapter(&self, bot: &RunBot, local: &LocalSettings) -> anyhow::Result<AcpAgentConfig> {
        let base = match &self.config.adapter_cmd {
            Some(cmd) => AcpAgent::from_str(cmd)?.into_config(),
            None => {
                let (node, script) = self.ensure_adapter(bot.agent_kind).await?;
                AcpAgentConfig::new(node).arg(script.to_string_lossy())
            }
        };
        let cli = agents::locate(bot.agent_kind, local).map(|p| p.to_string_lossy().into_owned());
        Ok(match bot.agent_kind {
            AgentKind::Claude => base.envs(cli.map(|p| ("CLAUDE_CODE_EXECUTABLE", p))),
            AgentKind::Codex => base
                .env("CODEX_CONFIG", serde_json::json!({ "developer_instructions": system_prompt(bot) }).to_string())
                .envs(cli.map(|p| ("CODEX_PATH", p))),
        })
    }

    /// Installs the pinned adapters once; returns (node, adapter script).
    async fn ensure_adapter(&self, kind: AgentKind) -> anyhow::Result<(PathBuf, PathBuf)> {
        let _guard = self.install.lock().await;
        let node = agents::find("node").context("未找到 Node.js（ACP 适配器需要 Node ≥ 22）")?;
        let version = tokio::process::Command::new(&node).arg("--version").output().await?;
        let version = String::from_utf8_lossy(&version.stdout).trim().to_string();
        if node_major(&version).is_none_or(|m| m < MIN_NODE_MAJOR) {
            bail!("Node.js 版本过低（{version}），ACP 适配器需要 Node ≥ {MIN_NODE_MAJOR}");
        }
        let dir = self.config.home.join("adapters");
        let modules = dir.join("node_modules");
        if !ADAPTERS.iter().all(|(_, name, ver)| installed_version(&modules.join(name)).as_deref() == Some(*ver)) {
            let npm = agents::find("npm").context("未找到 npm，无法安装 ACP 适配器")?;
            tokio::fs::create_dir_all(&dir).await?;
            tracing::info!("installing ACP adapters into {}", dir.display());
            let out = tokio::process::Command::new(npm)
                .args(["install", "--no-audit", "--no-fund", "--prefix"])
                .arg(&dir)
                .args(ADAPTERS.iter().map(|(_, name, ver)| format!("{name}@{ver}")))
                .output()
                .await?;
            if !out.status.success() {
                bail!("安装 ACP 适配器失败：{}", String::from_utf8_lossy(&out.stderr).trim());
            }
        }
        let (_, name, _) = ADAPTERS.iter().find(|(k, ..)| *k == kind).expect("every agent kind has an adapter");
        Ok((node, modules.join(name).join("dist/index.js")))
    }
}

fn installed_version(pkg: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(pkg.join("package.json")).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()?["version"].as_str().map(String::from)
}

fn node_major(version: &str) -> Option<u32> {
    version.trim_start_matches('v').split('.').next()?.parse().ok()
}

pub(crate) fn failed(run_id: &str, error: String) -> DaemonToServer {
    DaemonToServer::RunDone(RunDone {
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_node_major() {
        assert_eq!(node_major("v24.15.0"), Some(24));
        assert_eq!(node_major("garbage"), None);
    }
}
