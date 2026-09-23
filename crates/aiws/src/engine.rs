//! Executes server-dispatched runs: one adapter process per (group, bot) session (plan D20).
use crate::agents;
use crate::protocol::{AgentKind, DaemonToServer, RunBot, RunDone, RunOutcome, RunStart, ServerToDaemon};
use crate::service::{Handler, Outbox};
use crate::session::{self, Shared, TurnReq};
use crate::turn::system_prompt;
use agent_client_protocol::{AcpAgent, AcpAgentConfig};
use anyhow::{Context, bail};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

/// Pinned ACP adapters (plan D19), installed under `<home>/adapters/`. Both declare `bin: dist/index.js`.
const ADAPTERS: [(AgentKind, &str, &str); 2] = [
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
}

pub struct Engine(Arc<Inner>);

pub(crate) struct Inner {
    pub(crate) config: EngineConfig,
    actors: Mutex<HashMap<(String, String), Actor>>,
    install: tokio::sync::Mutex<()>,
}

struct Actor {
    tx: mpsc::UnboundedSender<TurnReq>,
    shared: Arc<Shared>,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Self {
        Engine(Arc::new(Inner { config, actors: Mutex::default(), install: tokio::sync::Mutex::default() }))
    }
}

impl Handler for Engine {
    fn handle(&self, msg: ServerToDaemon, out: &Outbox) {
        match msg {
            ServerToDaemon::RunStart(start) => {
                tokio::spawn(self.0.clone().start(*start, out.clone()));
            }
            ServerToDaemon::RunCancel { run_id } => {
                for actor in self.0.actors.lock().unwrap().values() {
                    actor.shared.cancel(&run_id);
                }
            }
            ServerToDaemon::Welcome { .. } | ServerToDaemon::Reject { .. } => {}
        }
    }
}

impl Inner {
    async fn start(self: Arc<Self>, start: RunStart, out: Outbox) {
        let cwd = match workspace_dir(&self.config.home, &start) {
            Ok(dir) => dir,
            Err(e) => return out.send(failed(&start.run_id, e)),
        };
        if let Err(e) = tokio::fs::create_dir_all(&cwd).await {
            return out.send(failed(&start.run_id, format!("无法创建工作区 {}: {e}", cwd.display())));
        }
        let mut actors = self.actors.lock().unwrap();
        let actor = actors.entry((start.group_id.clone(), start.bot.id.clone())).or_insert_with(|| {
            let (tx, rx) = mpsc::unbounded_channel();
            let shared = Arc::new(Shared::default());
            tokio::spawn(session::run(self.clone(), shared.clone(), rx));
            Actor { tx, shared }
        });
        actor.shared.enqueue(&start.run_id);
        let _ = actor.tx.send(TurnReq { start, cwd, out });
    }

    /// Launch config of the adapter for this bot, with the local agent CLI and per-process system prompt.
    pub(crate) async fn adapter(&self, bot: &RunBot) -> anyhow::Result<AcpAgentConfig> {
        let base = match &self.config.adapter_cmd {
            Some(cmd) => AcpAgent::from_str(cmd)?.into_config(),
            None => {
                let (node, script) = self.ensure_adapter(bot.agent_kind).await?;
                AcpAgentConfig::new(node).arg(script.to_string_lossy())
            }
        };
        let cli = agents::find(agents::binary(bot.agent_kind)).map(|p| p.to_string_lossy().into_owned());
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

/// Managed workspace `<home>/workspaces/<groupId>/<botId>/_empty/`. Repo clones and /cd arrive in M2.
pub fn workspace_dir(home: &Path, start: &RunStart) -> Result<PathBuf, String> {
    if start.workspace.repo.is_some() || start.workspace.cd_path.is_some() {
        return Err("绑定仓库的群与 /cd 工作区将在 M2 支持，当前只能在未绑定仓库的群里运行".into());
    }
    Ok(home.join("workspaces").join(&start.group_id).join(&start.bot.id).join("_empty"))
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{RepoSpec, RunPrompt, Tier, WorkspaceSpec};

    fn start(repo: Option<RepoSpec>) -> RunStart {
        RunStart {
            run_id: "r".into(),
            group_id: "g1".into(),
            bot: RunBot {
                id: "b1".into(),
                name: "x".into(),
                agent_kind: AgentKind::Claude,
                system_prompt: String::new(),
                tier: Tier::Workspace,
            },
            workspace: WorkspaceSpec { repo, cd_path: None },
            resume_session_id: None,
            prompt: RunPrompt {
                text: String::new(),
                triggered_by: String::new(),
                context: vec![],
                fallback_context: vec![],
            },
        }
    }

    #[test]
    fn managed_empty_workspace_path() {
        assert_eq!(workspace_dir(Path::new("/h"), &start(None)).unwrap(), Path::new("/h/workspaces/g1/b1/_empty"));
        let repo = RepoSpec { id: "rp".into(), url: "u".into(), branch: "main".into() };
        assert!(workspace_dir(Path::new("/h"), &start(Some(repo))).is_err());
    }

    #[test]
    fn parses_node_major() {
        assert_eq!(node_major("v24.15.0"), Some(24));
        assert_eq!(node_major("garbage"), None);
    }
}
