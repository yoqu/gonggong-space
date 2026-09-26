//! The daemon as one handle, shared by `gg run` and the desktop app: single-instance lock, `Service` + `Engine`,
//! the revocation wipe (spec §9) and live status.
use crate::bind::machine_info;
use crate::config::Config;
use crate::engine::{Engine, EngineConfig};
use crate::local::LocalSettings;
use crate::lock::Lock;
use crate::protocol::{AgentInfo, RejectReason};
use crate::service::{Fatal, Service};
use crate::status::{Monitor, Status};
use crate::upgrade::Upgrader;
use std::path::PathBuf;
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
    redetect: JoinHandle<()>,
    task: JoinHandle<Stopped>,
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
        let (agents, rx) = watch::channel(crate::agents::detect(&LocalSettings::load(&opts.home)?));
        let redetect = tokio::spawn(redetect(opts.home.clone(), agents.clone()));
        let service = Service {
            config: opts.config.clone(),
            machine: machine_info(),
            agents: rx,
            handler: Engine::new(EngineConfig {
                home: opts.home.clone(),
                adapter_cmd: opts.adapter_cmd,
                idle: IDLE_REAP,
                api: Some(opts.config),
            }),
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
        Ok(Daemon { monitor, agents, redetect, task, _lock: lock })
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
        self.redetect.abort();
        match stopped {
            Ok(stopped) => stopped,
            Err(e) => std::panic::resume_unwind(e.into_panic()),
        }
    }

    /// Disconnects and releases the machine lock.
    pub fn stop(self) {
        self.redetect.abort();
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
        let home = home.clone();
        let detected =
            tokio::task::spawn_blocking(move || LocalSettings::load(&home).map(|l| crate::agents::detect(&l))).await;
        match detected {
            Ok(Ok(agents)) => {
                publish_agents(&tx, agents);
            }
            Ok(Err(e)) => tracing::warn!("agent detection skipped: {e:#}"),
            Err(e) => tracing::warn!("agent detection failed: {e}"),
        }
    }
}
