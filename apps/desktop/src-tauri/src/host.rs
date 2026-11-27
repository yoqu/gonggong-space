//! The in-process daemon of the desktop app and what the UI sees of it.
use crate::i18n::tr;
use gonggong::config::Config;
use gonggong::daemon::{Daemon, Options};
use gonggong::lock::LockError;
use gonggong::status::Status;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Snapshot {
    /// Not running: no binding yet (or unbound).
    Unbound,
    /// Another daemon (`gg run`) holds this machine's lock.
    Blocked {
        message: String,
    },
    Running {
        status: Status,
    },
}

enum State {
    Idle,
    Blocked(String),
    Running(Daemon),
}

pub type Notify = Arc<dyn Fn(Snapshot) + Send + Sync>;

pub struct Host {
    pub home: PathBuf,
    state: Mutex<State>,
    notify: Notify,
    agent_login: gonggong::agent_login::AgentLoginManager,
}

impl Host {
    /// Upgrades a v1 `providers.json` before any page reads it (the daemon does the same; it is idempotent).
    pub fn new(home: PathBuf, notify: Notify) -> Self {
        if let Err(e) = gonggong::providers::Store::migrate_file(&home) {
            tracing::warn!("providers.json migration failed: {e:#}");
        }
        Host {
            home,
            state: Mutex::new(State::Idle),
            notify,
            agent_login: gonggong::agent_login::AgentLoginManager::new(),
        }
    }

    pub fn agent_login(&self) -> gonggong::agent_login::AgentLoginManager {
        self.agent_login.clone()
    }

    pub fn engine(&self) -> Option<gonggong::engine::Engine> {
        match &*self.state.lock().unwrap() {
            State::Running(daemon) => Some(daemon.engine()),
            _ => None,
        }
    }

    pub fn reprobe_agent(&self, kind: gonggong::protocol::AgentKind) {
        if let State::Running(daemon) = &*self.state.lock().unwrap() {
            daemon.reprobe(kind);
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        match &*self.state.lock().unwrap() {
            State::Idle => Snapshot::Unbound,
            State::Blocked(message) => Snapshot::Blocked { message: message.clone() },
            State::Running(d) => Snapshot::Running { status: d.status() },
        }
    }

    /// Starts the daemon for the saved binding. Must run inside the async runtime.
    pub fn start(&self) -> Result<(), String> {
        let config = Config::load().map_err(|e| e.to_string())?.ok_or(tr!("尚未绑定"))?;
        let mut state = self.state.lock().unwrap();
        if matches!(*state, State::Running(_)) {
            return Ok(());
        }
        let options = Options { home: self.home.clone(), config, adapter_cmd: None, self_upgrade: false };
        *state = match Daemon::start(options) {
            Ok(daemon) => {
                let (mut rx, notify) = (daemon.subscribe(), self.notify.clone());
                tauri::async_runtime::spawn(async move {
                    while rx.changed().await.is_ok() {
                        let status = rx.borrow_and_update().clone();
                        notify(Snapshot::Running { status });
                    }
                });
                State::Running(daemon)
            }
            Err(e) => match e.downcast::<LockError>() {
                Ok(held @ LockError::Held { .. }) => State::Blocked(held.to_string()),
                Ok(other) => return Err(other.to_string()),
                Err(other) => return Err(format!("{other:#}")),
            },
        };
        drop(state);
        (self.notify)(self.snapshot());
        Ok(())
    }

    pub fn process_since(
        &self,
        run_id: &str,
        after: Option<u64>,
        rev: Option<u64>,
    ) -> Option<gonggong::status::ProcessPatch> {
        match &*self.state.lock().unwrap() {
            State::Running(daemon) => daemon.process_since(run_id, after, rev),
            _ => None,
        }
    }

    pub fn context(&self, group_id: &str, bot_id: &str) -> Option<gonggong::protocol::ContextUsage> {
        match &*self.state.lock().unwrap() {
            State::Running(daemon) => daemon.context(group_id, bot_id),
            _ => None,
        }
    }

    /// Hands a fresh local detection to the running daemon, which reports it to the server if it changed.
    pub fn report_agents(&self, agents: Vec<gonggong::protocol::AgentState>) {
        if let State::Running(daemon) = &*self.state.lock().unwrap() {
            daemon.set_agents(agents);
        }
    }

    /// Stops the daemon and its hosted services (before an update relaunch); the binding stays.
    pub fn stop(&self) {
        if let State::Running(daemon) = std::mem::replace(&mut *self.state.lock().unwrap(), State::Idle) {
            daemon.stop();
        }
    }

    /// Stops the daemon and removes the binding, team secrets and managed workspaces like a revocation does;
    /// backups and /cd directories stay.
    pub fn unbind(&self) {
        self.stop();
        gonggong::revoke::wipe(&self.home);
        (self.notify)(Snapshot::Unbound);
    }
}
