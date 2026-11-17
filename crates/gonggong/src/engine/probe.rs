//! Model catalogs and forks from throwaway adapter sessions no bot runs in.
use super::{Engine, PROBE_TIMEOUT};
use crate::agents;
use crate::engine::Process;
use crate::local::LocalSettings;
use crate::protocol::{AgentCatalog, AgentKind, Approval, RunBot, SecretEnv, Tier};
use crate::providers::{RunPlan, Selection, Store};
use crate::session;
use crate::t;
use agent_client_protocol::AcpAgent;
use anyhow::bail;
use std::path::Path;

impl Engine {
    /// `agents.reprobe`: probes the agent again now, whatever is cached, and publishes the new catalog before
    /// answering. A failed probe keeps the cached one.
    pub(super) async fn reprobe(&self, kind: AgentKind) -> anyhow::Result<()> {
        let home = self.0.config.home.clone();
        let detected = {
            let home = home.clone();
            tokio::task::spawn_blocking(move || {
                Ok::<_, anyhow::Error>(agents::detect(&home, &LocalSettings::load(&home)?))
            })
            .await??
        };
        let Some(info) = detected.into_iter().find(|a| a.kind == kind && a.available) else {
            bail!(t!("这台电脑上没有可用的 {kind}", kind = crate::bots::agent_label(kind)));
        };
        let official = self.probe(kind).await;
        if let Ok(catalog) = &official {
            let key = agents::catalog_key(kind, info.version.as_deref());
            crate::local::save_catalog(&home, kind, crate::local::CachedCatalog { key, catalog: catalog.clone() })?;
        }
        let mut any_profile = false;
        if kind == AgentKind::Claude {
            let profiles = {
                let (home, version) = (home.clone(), info.version.clone());
                tokio::task::spawn_blocking(move || agents::claude_profiles(&home, version.as_deref())).await??
            };
            for (selection, key) in profiles {
                let Some(dir) = selection.claude_profile().map(|d| d.to_string_lossy().into_owned()) else { continue };
                if let Ok(catalog) = self.probe_with(AgentKind::Claude, &selection).await {
                    let cached = crate::local::CachedCatalog { key, catalog };
                    crate::local::save_profile_catalog(&home, &dir, cached)?;
                    any_profile = true;
                }
            }
        }
        if !any_profile {
            official?;
        }
        self.0.manage.refresh_agents().await;
        Ok(())
    }

    /// What the agent's adapter offers (models and their thought levels), from a throwaway session.
    pub async fn probe(&self, kind: AgentKind) -> anyhow::Result<AgentCatalog> {
        let official = Selection::Official(Store::load(&self.0.config.home)?.official(kind));
        self.probe_with(kind, &official).await
    }

    /// [`Engine::probe`] on `selection` (a local Claude profile: its own login and settings).
    pub async fn probe_with(&self, kind: AgentKind, selection: &Selection) -> anyhow::Result<AgentCatalog> {
        let agent = self.throwaway_agent(kind, selection).await?;
        let dir = self.0.config.home.join("probe");
        tokio::fs::create_dir_all(&dir).await?;
        let probe = session::probe(agent, &dir);
        match tokio::time::timeout(PROBE_TIMEOUT, probe).await {
            Ok(result) => result.map_err(anyhow::Error::msg).and_then(|c| agents::offered(kind, c)),
            Err(_) => bail!(t!("探测 {kind} 可选模型超时", kind = crate::bots::agent_label(kind))),
        }
    }

    /// Forks `session` in its workspace `dir` (session/fork): the copy is a new session of the same adapter.
    pub async fn fork_session(&self, kind: AgentKind, dir: &Path, session: &str) -> Result<String, String> {
        let store = Store::load(&self.0.config.home).map_err(|e| e.to_string())?;
        let selection = match store.resolve_run(kind, "", Some(session)) {
            Ok(RunPlan::Resume(s)) => s,
            _ => Selection::Official(store.official(kind)),
        };
        let agent = self.throwaway_agent(kind, &selection).await.map_err(|e| e.to_string())?;
        session::fork(agent, dir, session).await
    }

    /// The adapter of `kind` for a session no bot runs in (probe, fork): no bot settings.
    async fn throwaway_agent(&self, kind: AgentKind, selection: &Selection) -> anyhow::Result<AcpAgent> {
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
            always_allow: vec![],
            ai_review: false,
            review_model: None,
            git: None,
            agent_settings: Default::default(),
        };
        let process = Process { key: crate::adapters::PROBE, ..Default::default() };
        let config = self.0.adapter(&bot, &local, selection, &SecretEnv::default(), &process).await?;
        let extra = (kind == AgentKind::Claude
            && (selection.provider().is_none() || selection.claude_profile().is_some()))
        .then(|| selection.process_env());
        Ok(AcpAgent::new(config.envs(extra.into_iter().flatten())))
    }
}
