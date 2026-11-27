//! The daemon as one handle, shared by `gg run` and the desktop app: single-instance lock, `Service` + `Engine`,
//! the revocation wipe (spec §9) and live status.
use crate::bind::machine_info;
use crate::config::Config;
use crate::engine::{Engine, EngineConfig};
use crate::hosted::Services;
use crate::local::{CachedCatalog, LocalSettings, save_catalog};
use crate::lock::Lock;
use crate::protocol::{AgentCatalog, AgentKind, AgentState, RejectReason};
use crate::service::{Fatal, Service};
use crate::status::{Monitor, ProcessPatch, Status};
use crate::tools::ToolKind;
use crate::upgrade::{GithubSource, Upgrader};
use futures_util::StreamExt;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;

const IDLE_REAP: Duration = Duration::from_secs(10 * 60);
const CONVERSATION_REAP: Duration = Duration::from_secs(30 * 60);
/// A stopped turn whose agent ignores the cancel this long has its adapter killed, so the run ends.
const CANCEL_GRACE: Duration = Duration::from_secs(5);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// Picks up agents installed or paths changed by the CLI while running.
const REDETECT: Duration = Duration::from_secs(60);
const LATEST_CHECK: Duration = Duration::from_secs(6 * 3600);

pub struct Options {
    pub home: PathBuf,
    pub config: Config,
    /// Replaces the ACP adapter command for every agent (debugging / tests).
    pub adapter_cmd: Option<String>,
    /// Replace and re-exec the running executable when the server (or, without a server build, GitHub) offers a newer
    /// build. Only the `gonggong` CLI does this; the desktop app is upgraded as an app bundle.
    pub self_upgrade: bool,
}

pub struct Stopped {
    pub fatal: Fatal,
    /// What a revocation removed from this machine.
    pub wiped: Vec<PathBuf>,
}

pub struct Daemon {
    monitor: Monitor,
    agents: watch::Sender<Vec<AgentState>>,
    engine: Engine,
    /// Re-detection, catalog probing, the preview tunnel and the GitHub update check.
    background: Vec<JoinHandle<()>>,
    task: JoinHandle<Stopped>,
    services: Services,
    _lock: Lock,
}

impl Daemon {
    /// Takes the machine lock and starts connecting in the background. Must be called inside a tokio runtime.
    pub fn start(opts: Options) -> anyhow::Result<Daemon> {
        let lock = Lock::acquire(&opts.home)?;
        if let Err(e) = crate::providers::Store::migrate_file(&opts.home) {
            tracing::warn!("providers.json migration failed: {e:#}");
        }
        let upgrader = match opts.self_upgrade {
            true => Upgrader::from_env(opts.home.clone(), &opts.config)?,
            false => None,
        };
        let monitor = Monitor::default();
        let (agents, rx) = watch::channel(detect(&opts.home)?);
        let engine = Engine::new(EngineConfig {
            home: opts.home.clone(),
            user_home: crate::config::user_home(),
            adapter_cmd: opts.adapter_cmd,
            idle: IDLE_REAP,
            reap: CONVERSATION_REAP,
            cancel_grace: CANCEL_GRACE,
            continuation: Default::default(),
            api: Some(opts.config.clone()),
        });
        engine.watch_agents(agents.clone());
        let services = engine.services();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let tunnel = crate::tunnel::run(
            opts.config.clone(),
            engine.previews(),
            opts.home.clone(),
            engine.tunnel_offered(),
            engine.terminals(),
        );
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let tunnel =
            crate::tunnel::run(opts.config.clone(), engine.previews(), opts.home.clone(), engine.tunnel_offered());
        let mut background = vec![
            tokio::spawn(redetect(opts.home.clone(), agents.clone())),
            tokio::spawn(probe_catalogs(opts.home.clone(), engine.clone(), agents.clone())),
            tokio::spawn(probe_profiles(opts.home.clone(), engine.clone(), agents.clone())),
            tokio::spawn(tunnel),
            tokio::spawn(crate::janitor::run(opts.home.clone(), opts.config.clone())),
        ];
        if let Some(up) = &upgrader
            && let Some(source) = GithubSource::from_env()
        {
            background.push(tokio::spawn(up.clone().watch_github(source)));
        }
        let service = Service {
            config: opts.config,
            machine: machine_info(),
            agents: rx,
            handler: engine.clone(),
            max_backoff: MAX_BACKOFF,
            upgrader,
            monitor: monitor.clone(),
        };
        let (home, m) = (opts.home, monitor.clone());
        let task = tokio::spawn(async move {
            let fatal = service.run().await;
            let Fatal::Rejected { reason, message } = &fatal;
            let wiped = if *reason == RejectReason::Revoked { crate::revoke::wipe(&home) } else { vec![] };
            m.rejected(*reason, message.clone(), &wiped);
            Stopped { fatal, wiped }
        });
        Ok(Daemon { monitor, agents, engine, background, task, services, _lock: lock })
    }

    pub fn status(&self) -> Status {
        self.monitor.snapshot()
    }

    pub fn process_since(&self, run_id: &str, after: Option<u64>, rev: Option<u64>) -> Option<ProcessPatch> {
        self.monitor.process_since(run_id, after, rev)
    }

    pub fn subscribe(&self) -> watch::Receiver<Status> {
        self.monitor.subscribe()
    }

    pub fn context(&self, group_id: &str, bot_id: &str) -> Option<crate::protocol::ContextUsage> {
        self.monitor.context(group_id, bot_id)
    }

    /// A fresh local detection (the desktop's 重新检测, a changed path); reported to the server if it differs.
    pub fn set_agents(&self, agents: Vec<AgentState>) {
        publish_agents(&self.agents, agents);
    }

    pub fn engine(&self) -> Engine {
        self.engine.clone()
    }

    /// Re-probes `kind`'s model catalog in the background (e.g. after desktop interactive login succeeds).
    pub fn reprobe(&self, kind: AgentKind) {
        let engine = self.engine.clone();
        tokio::spawn(async move {
            if let Err(e) = engine.reprobe(kind).await {
                tracing::warn!("reprobe of {kind:?} failed: {e:#}");
            }
        });
    }

    /// Runs until the server rejects this machine for good.
    pub async fn wait(mut self) -> Stopped {
        let stopped = (&mut self.task).await;
        self.background.iter().for_each(JoinHandle::abort);
        match stopped {
            Ok(stopped) => stopped,
            Err(e) => std::panic::resume_unwind(e.into_panic()),
        }
    }

    /// Hosted services, for stopping them before the process exits.
    pub fn services(&self) -> Services {
        self.services.clone()
    }

    /// Disconnects, ends hosted services and releases the machine lock.
    pub fn stop(self) {
        self.services.kill_now();
        self.background.iter().for_each(JoinHandle::abort);
        self.task.abort();
    }
}

/// Publishes `agents` when they differ from the last detection; true if they did.
pub fn publish_agents(tx: &watch::Sender<Vec<AgentState>>, agents: Vec<AgentState>) -> bool {
    tx.send_if_modified(|current| {
        let changed = *current != agents;
        if changed {
            *current = agents;
        }
        changed
    })
}

async fn redetect(home: PathBuf, tx: watch::Sender<Vec<AgentState>>) {
    let mut tick = tokio::time::interval(REDETECT);
    tick.tick().await;
    // The latest versions reported as `AgentState.latest`, refreshed from the mirror now and then.
    let mut checked: Option<std::time::Instant> = None;
    loop {
        tick.tick().await;
        if checked.is_none_or(|at| at.elapsed() >= LATEST_CHECK) {
            checked = Some(std::time::Instant::now());
            for kind in [ToolKind::Claude, ToolKind::Codex] {
                if let Err(e) = crate::tools::latest(&home, kind, false).await {
                    tracing::warn!("{} latest version check failed: {e:#}", kind.label());
                }
            }
        }
        republish(&home, &tx).await;
    }
}

fn detect(home: &Path) -> anyhow::Result<Vec<AgentState>> {
    Ok(crate::agents::detect(home, &LocalSettings::load(home)?))
}

async fn republish(home: &Path, tx: &watch::Sender<Vec<AgentState>>) {
    let home = home.to_path_buf();
    match tokio::task::spawn_blocking(move || detect(&home)).await {
        Ok(Ok(agents)) => {
            publish_agents(tx, agents);
        }
        Ok(Err(e)) => tracing::warn!("agent detection skipped: {e:#}"),
        Err(e) => tracing::warn!("agent detection failed: {e}"),
    }
}

/// Probes each detected agent without a catalog for its builds (once per build and daemon process once it succeeds,
/// again every PROBE_RETRY while it fails, e.g. until the agent is logged in), then publishes the detection again so
/// the server gets the catalog.
async fn probe_catalogs(home: PathBuf, engine: Engine, tx: watch::Sender<Vec<AgentState>>) {
    let mut rx = tx.subscribe();
    let mut done = HashSet::new();
    loop {
        let missing: Vec<_> = rx
            .borrow_and_update()
            .iter()
            .filter(|a| a.available && a.catalog.is_none())
            .map(|a| (a.kind, crate::agents::catalog_key(a.kind, a.version.as_deref())))
            .filter(|k| !done.contains(k))
            .collect();
        // Checked again on each retry: probing resumes once the agent is logged in.
        let (out, missing): (Vec<_>, Vec<_>) = missing.into_iter().partition(|(kind, _)| {
            crate::agents::logged_out(*kind, &crate::config::user_home(), &|n| std::env::var(n).ok())
        });
        let mut failed = !out.is_empty();
        let mut probed = std::pin::pin!(probe_each(missing, |kind| engine.probe(kind)));
        while let Some((kind, key, result)) = probed.next().await {
            match result {
                Ok(catalog) => {
                    done.insert((kind, key.clone()));
                    if let Err(e) = save_catalog(&home, kind, CachedCatalog { key, catalog }) {
                        tracing::warn!("saving the {kind:?} catalog failed: {e:#}");
                    }
                    republish(&home, &tx).await;
                }
                Err(e) => {
                    failed = true;
                    tracing::warn!("probing {kind:?} failed: {e:#}");
                }
            }
        }
        let retry = async {
            match failed {
                true => tokio::time::sleep(PROBE_RETRY).await,
                false => std::future::pending().await,
            }
        };
        tokio::select! {
            changed = rx.changed() => if changed.is_err() { return },
            () = retry => {}
        }
    }
}

/// Agents probed at once: each probe starts an adapter process.
const PROBE_PARALLEL: usize = 4;

/// Probes `missing` a few at a time, each yielded as it finishes: one agent that hangs until the probe timeout must
/// not hold back the others' catalogs.
fn probe_each<F, Fut>(
    missing: Vec<(AgentKind, String)>,
    probe: F,
) -> impl futures_util::Stream<Item = (AgentKind, String, anyhow::Result<AgentCatalog>)>
where
    F: Fn(AgentKind) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<AgentCatalog>>,
{
    futures_util::stream::iter(missing)
        .map(move |(kind, key)| {
            let probe = probe(kind);
            async move { (kind, key, probe.await) }
        })
        .buffer_unordered(PROBE_PARALLEL)
}

/// Probes each local Claude profile (a provider's own `CLAUDE_CONFIG_DIR`) without a catalog for the detected Claude
/// build and its settings: its login may offer other models than the official one. Woken when Claude is detected again
/// and when providers change or a catalog is asked for; a failed probe is retried after PROBE_RETRY.
async fn probe_profiles(home: PathBuf, engine: Engine, tx: watch::Sender<Vec<AgentState>>) {
    let (mut rx, wanted) = (tx.subscribe(), engine.profile_probes());
    // Failed probes wait for the retry instead of running again on every catalog asked for.
    let (mut failed, mut retry_at) = (HashSet::new(), None::<tokio::time::Instant>);
    loop {
        let claude = rx.borrow_and_update().iter().find(|a| a.kind == AgentKind::Claude && a.available).cloned();
        let pending = match &claude {
            Some(c) => {
                let (home, version) = (home.clone(), c.version.clone());
                tokio::task::spawn_blocking(move || crate::agents::unprobed_profiles(&home, version.as_deref()))
                    .await
                    .map_err(anyhow::Error::from)
                    .and_then(|r| r)
                    .unwrap_or_else(|e| {
                        tracing::warn!("listing Claude profiles failed: {e:#}");
                        vec![]
                    })
            }
            None => vec![],
        };
        let pending = pending.into_iter().filter_map(|(s, key)| Some((s.provider()?.0.id.clone(), key, s)));
        let pending: Vec<_> = pending.filter(|(id, k, _)| !failed.contains(&(id.clone(), k.clone()))).collect();
        for (id, key, selection) in pending {
            match engine.probe_with(AgentKind::Claude, &selection).await {
                Ok(catalog) => {
                    if let Err(e) = crate::local::save_profile_catalog(&home, &id, CachedCatalog { key, catalog }) {
                        tracing::warn!("saving the catalog of Claude profile {id} failed: {e:#}");
                    }
                    republish(&home, &tx).await;
                }
                Err(e) => {
                    failed.insert((id.clone(), key));
                    retry_at.get_or_insert_with(|| tokio::time::Instant::now() + PROBE_RETRY);
                    tracing::warn!("probing Claude profile {id} failed: {e:#}");
                }
            }
        }
        let retry = async {
            match retry_at {
                Some(at) => tokio::time::sleep_until(at).await,
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            changed = rx.changed() => if changed.is_err() { return },
            () = wanted.notified() => {}
            () = retry => (failed, retry_at) = (HashSet::new(), None),
        }
    }
}

const PROBE_RETRY: Duration = Duration::from_secs(5 * 60);

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_slow_probe_does_not_hold_back_the_others() {
        let missing = vec![(AgentKind::Codebuddy, "c".to_string()), (AgentKind::Antigravity, "a".to_string())];
        let start = tokio::time::Instant::now();
        let probe = |kind| async move {
            let wait = if kind == AgentKind::Codebuddy { 90 } else { 2 };
            tokio::time::sleep(Duration::from_secs(wait)).await;
            Ok::<_, anyhow::Error>(AgentCatalog::default())
        };
        let mut done = probe_each(missing, probe);
        let (kind, key, _) = done.next().await.unwrap();
        assert_eq!((kind, key.as_str()), (AgentKind::Antigravity, "a"));
        assert_eq!(start.elapsed(), Duration::from_secs(2));
        assert_eq!(done.next().await.unwrap().0, AgentKind::Codebuddy);
        assert!(done.next().await.is_none());
    }
}
