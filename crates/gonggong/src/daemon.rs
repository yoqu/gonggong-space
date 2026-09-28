//! The daemon as one handle, shared by `gg run` and the desktop app: single-instance lock, `Service` + `Engine`,
//! the revocation wipe (spec §9) and live status.
use crate::bind::machine_info;
use crate::config::Config;
use crate::engine::{Engine, EngineConfig};
use crate::hosted::Services;
use crate::local::{CachedCatalog, LocalSettings, save_catalog};
use crate::lock::Lock;
use crate::protocol::{AgentInfo, RejectReason};
use crate::service::{Fatal, Service};
use crate::status::{Monitor, Status};
use crate::upgrade::Upgrader;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;

const IDLE_REAP: Duration = Duration::from_secs(10 * 60);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// Picks up agents installed or paths changed by the CLI while running.
const REDETECT: Duration = Duration::from_secs(60);

pub struct Options {
    pub home: PathBuf,
    pub config: Config,
    /// Replaces the ACP adapter command for every agent (debugging / tests).
    pub adapter_cmd: Option<String>,
    /// Replace and re-exec the running executable when the server offers a newer build. Only the `gonggong` CLI does
    /// this; the desktop app is upgraded as an app bundle.
    pub self_upgrade: bool,
}

pub struct Stopped {
    pub fatal: Fatal,
    /// What a revocation removed from this machine.
    pub wiped: Vec<PathBuf>,
}

pub struct Daemon {
    monitor: Monitor,
    agents: watch::Sender<Vec<AgentInfo>>,
    /// Re-detection, catalog probing and the preview tunnel.
    background: [JoinHandle<()>; 3],
    task: JoinHandle<Stopped>,
    services: Services,
    _lock: Lock,
}

impl Daemon {
    /// Takes the machine lock and starts connecting in the background. Must be called inside a tokio runtime.
    pub fn start(opts: Options) -> anyhow::Result<Daemon> {
        let lock = Lock::acquire(&opts.home)?;
        let upgrader = match opts.self_upgrade {
            true => Upgrader::from_env(opts.home.clone(), &opts.config)?,
            false => None,
        };
        let monitor = Monitor::default();
        let (agents, rx) = watch::channel(detect(&opts.home)?);
        let engine = Engine::new(EngineConfig {
            home: opts.home.clone(),
            adapter_cmd: opts.adapter_cmd,
            idle: IDLE_REAP,
            api: Some(opts.config.clone()),
        });
        let services = engine.services();
        let background = [
            tokio::spawn(redetect(opts.home.clone(), agents.clone())),
            tokio::spawn(probe_catalogs(opts.home.clone(), engine.clone(), agents.clone())),
            tokio::spawn(crate::tunnel::run(opts.config.clone(), engine.previews(), engine.tunnel_offered())),
        ];
        let service = Service {
            config: opts.config,
            machine: machine_info(),
            agents: rx,
            handler: engine,
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
        Ok(Daemon { monitor, agents, background, task, services, _lock: lock })
    }

    pub fn status(&self) -> Status {
        self.monitor.snapshot()
    }

    pub fn process(&self, run_id: &str) -> Option<crate::status::Process> {
        self.monitor.process(run_id)
    }

    pub fn subscribe(&self) -> watch::Receiver<Status> {
        self.monitor.subscribe()
    }

    /// A fresh local detection (the desktop's 重新检测, a changed path); reported to the server if it differs.
    pub fn set_agents(&self, agents: Vec<AgentInfo>) {
        publish_agents(&self.agents, agents);
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
pub fn publish_agents(tx: &watch::Sender<Vec<AgentInfo>>, agents: Vec<AgentInfo>) -> bool {
    tx.send_if_modified(|current| {
        let changed = *current != agents;
        if changed {
            *current = agents;
        }
        changed
    })
}

async fn redetect(home: PathBuf, tx: watch::Sender<Vec<AgentInfo>>) {
    let mut tick = tokio::time::interval(REDETECT);
    tick.tick().await;
    loop {
        tick.tick().await;
        republish(&home, &tx).await;
    }
}

fn detect(home: &Path) -> anyhow::Result<Vec<AgentInfo>> {
    Ok(crate::agents::detect(home, &LocalSettings::load(home)?))
}

async fn republish(home: &Path, tx: &watch::Sender<Vec<AgentInfo>>) {
    let home = home.to_path_buf();
    match tokio::task::spawn_blocking(move || detect(&home)).await {
        Ok(Ok(agents)) => {
            publish_agents(tx, agents);
        }
        Ok(Err(e)) => tracing::warn!("agent detection skipped: {e:#}"),
        Err(e) => tracing::warn!("agent detection failed: {e}"),
    }
}

/// Probes each detected agent without a catalog for its builds (once per build and daemon process), then publishes
/// the detection again so the server gets the catalog.
async fn probe_catalogs(home: PathBuf, engine: Engine, tx: watch::Sender<Vec<AgentInfo>>) {
    let mut rx = tx.subscribe();
    let mut tried = HashSet::new();
    loop {
        let missing: Vec<_> = rx
            .borrow_and_update()
            .iter()
            .filter(|a| a.available && a.catalog.is_none())
            .map(|a| (a.kind, crate::agents::catalog_key(a.kind, a.version.as_deref())))
            .filter(|k| !tried.contains(k))
            .collect();
        for (kind, key) in missing {
            tried.insert((kind, key.clone()));
            match engine.probe(kind).await {
                Ok(catalog) => {
                    if let Err(e) = save_catalog(&home, kind, CachedCatalog { key, catalog }) {
                        tracing::warn!("saving the {kind:?} catalog failed: {e:#}");
                    }
                    republish(&home, &tx).await;
                }
                Err(e) => tracing::warn!("probing {kind:?} failed: {e:#}"),
            }
        }
        if rx.changed().await.is_err() {
            return;
        }
    }
}
