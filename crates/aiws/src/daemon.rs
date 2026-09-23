//! The daemon as one handle, shared by `aiws run` and the desktop app: single-instance lock, `Service` + `Engine`,
//! the revocation wipe (spec §9) and live status.
use crate::bind::machine_info;
use crate::config::Config;
use crate::engine::{Engine, EngineConfig};
use crate::lock::Lock;
use crate::protocol::RejectReason;
use crate::service::{Fatal, Service};
use crate::status::{Monitor, Status};
use crate::upgrade::Upgrader;
use std::path::PathBuf;
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;

const IDLE_REAP: Duration = Duration::from_secs(10 * 60);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

pub struct Options {
    pub home: PathBuf,
    pub config: Config,
    /// Replaces the ACP adapter command for every agent (debugging / tests).
    pub adapter_cmd: Option<String>,
    /// Replace and re-exec the running executable when the server offers a newer build. Only the `aiws` CLI does
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
        let service = Service {
            config: opts.config.clone(),
            machine: machine_info(),
            agents: crate::agents::detect(),
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
        Ok(Daemon { monitor, task, _lock: lock })
    }

    pub fn status(&self) -> Status {
        self.monitor.snapshot()
    }

    pub fn subscribe(&self) -> watch::Receiver<Status> {
        self.monitor.subscribe()
    }

    /// Runs until the server rejects this machine for good.
    pub async fn wait(mut self) -> Stopped {
        match (&mut self.task).await {
            Ok(stopped) => stopped,
            Err(e) => std::panic::resume_unwind(e.into_panic()),
        }
    }

    /// Disconnects and releases the machine lock.
    pub fn stop(self) {
        self.task.abort();
    }
}
