//! The in-process daemon of the desktop app and what the UI sees of it.
use aiws::config::Config;
use aiws::daemon::{Daemon, Options};
use aiws::lock::LockError;
use aiws::status::Status;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Snapshot {
    /// Not running: no binding yet (or unbound).
    Unbound,
    /// Another daemon (`aiws run`) holds this machine's lock.
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
}

impl Host {
    pub fn new(home: PathBuf, notify: Notify) -> Self {
        Host { home, state: Mutex::new(State::Idle), notify }
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
        let config = Config::load().map_err(|e| e.to_string())?.ok_or("尚未绑定")?;
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

    /// Stops the daemon and removes the binding, team secrets and managed workspaces like a revocation does;
    /// backups and /cd directories stay.
    pub fn unbind(&self) {
        if let State::Running(daemon) = std::mem::replace(&mut *self.state.lock().unwrap(), State::Idle) {
            daemon.stop();
        }
        aiws::revoke::wipe(&self.home);
        (self.notify)(Snapshot::Unbound);
    }
}
