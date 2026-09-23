//! Self-upgrade (plan D17): the server offers a newer build for this OS/arch; the daemon downloads it, verifies its
//! sha256, swaps its own executable and re-execs itself once no run is active.
use crate::config::Config;
use crate::protocol::UpgradeInfo;
use anyhow::Context;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

/// `candidate` is a strictly newer dotted numeric version than `current` (pre-release suffixes ignored).
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        let core = v.split(['-', '+']).next().unwrap_or_default();
        let mut p: Vec<u64> = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
        p.resize(p.len().max(3), 0);
        p
    };
    parts(candidate) > parts(current)
}

#[derive(Debug, thiserror::Error)]
pub enum StageError {
    #[error("sha256 mismatch: expected {expected}, got {actual}")]
    Mismatch { expected: String, actual: String },
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// Downloads `info` into `<home>/updates/` and verifies it; the file only appears there once verified.
/// Server-relative URLs (`/downloads/...`) resolve against `server` and go through its (pinned) client `http`;
/// builds hosted elsewhere use the system trust store. Either way the sha256 decides.
pub async fn stage(
    home: &Path,
    server: &str,
    http: &reqwest::Client,
    info: &UpgradeInfo,
) -> Result<PathBuf, StageError> {
    let (url, http) = if info.url.starts_with('/') {
        (format!("{}{}", server.trim_end_matches('/'), info.url), http.clone())
    } else {
        (info.url.clone(), reqwest::Client::new())
    };
    let bytes = async {
        let res = http.get(&url).send().await?.error_for_status()?;
        anyhow::Ok(res.bytes().await?)
    }
    .await
    .with_context(|| format!("download {url}"))?;
    let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if !actual.eq_ignore_ascii_case(&info.sha256) {
        return Err(StageError::Mismatch { expected: info.sha256.clone(), actual });
    }
    let dir = home.join("updates");
    tokio::fs::create_dir_all(&dir).await.context("create updates dir")?;
    let path = dir.join(format!("aiws-{}{}", info.version, std::env::consts::EXE_SUFFIX));
    let part = path.with_extension("part");
    tokio::fs::write(&part, &bytes).await.context("write update")?;
    tokio::fs::rename(&part, &path).await.context("finish update")?;
    Ok(path)
}

/// Atomically replaces `exe` with `staged` (same-directory rename; on Windows the running file is moved aside first).
pub fn install(staged: &Path, exe: &Path) -> anyhow::Result<()> {
    let name = exe.file_name().context("executable has no file name")?.to_string_lossy();
    let tmp = exe.with_file_name(format!(".{name}.new"));
    std::fs::copy(staged, &tmp).context("copy update next to the executable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }
    #[cfg(windows)]
    {
        let old = exe.with_file_name(format!(".{name}.old"));
        let _ = std::fs::remove_file(&old);
        std::fs::rename(exe, &old).context("move the running executable aside")?;
    }
    std::fs::rename(&tmp, exe).context("replace the executable")?;
    Ok(())
}

/// The command that restarts this daemon: the (replaced) executable with the same arguments.
pub fn restart_command(exe: &Path, args: &[OsString]) -> Command {
    let mut cmd = Command::new(exe);
    cmd.args(args);
    cmd
}

/// Replaces the current process with `cmd` (Unix exec); on Windows spawns it and exits. Returns only on failure.
fn exec(mut cmd: Command) -> anyhow::Error {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.exec().into()
    }
    #[cfg(not(unix))]
    {
        match cmd.spawn() {
            Ok(_) => std::process::exit(0),
            Err(e) => e.into(),
        }
    }
}

#[derive(Default)]
struct State {
    /// Version currently being downloaded.
    busy: Option<String>,
    staged: Option<(String, PathBuf)>,
    /// Versions that failed verification or installation; never retried by this process.
    refused: HashSet<String>,
}

pub struct Upgrader {
    home: PathBuf,
    server: String,
    http: reqwest::Client,
    exe: PathBuf,
    args: Vec<OsString>,
    state: Arc<Mutex<State>>,
}

impl Upgrader {
    pub fn new(home: PathBuf, server: String, http: reqwest::Client, exe: PathBuf, args: Vec<OsString>) -> Self {
        Upgrader { home, server, http, exe, args, state: Arc::default() }
    }

    /// For the running daemon of `config`; `None` when `AIWS_NO_AUTO_UPGRADE=1`.
    pub fn from_env(home: PathBuf, config: &Config) -> anyhow::Result<Option<Self>> {
        if std::env::var("AIWS_NO_AUTO_UPGRADE").is_ok_and(|v| v == "1") {
            return Ok(None);
        }
        let exe = std::env::current_exe()?;
        let http = crate::tls::client(config)?;
        Ok(Some(Upgrader::new(home, config.server.clone(), http, exe, std::env::args_os().skip(1).collect())))
    }

    /// Starts downloading `info` in the background unless it is not newer than this build, already staged, in
    /// flight or refused. Returns whether a download started.
    pub fn offer(&self, info: UpgradeInfo) -> bool {
        if !is_newer(&info.version, CURRENT) {
            return false;
        }
        {
            let mut s = self.state.lock().unwrap();
            let v = Some(&info.version);
            if s.refused.contains(&info.version) || s.busy.as_ref() == v || s.staged.as_ref().map(|(v, _)| v) == v {
                return false;
            }
            s.busy = Some(info.version.clone());
        }
        let (home, server, http, state) =
            (self.home.clone(), self.server.clone(), self.http.clone(), self.state.clone());
        tokio::spawn(async move {
            let res = stage(&home, &server, &http, &info).await;
            let mut s = state.lock().unwrap();
            s.busy = None;
            match res {
                Ok(path) => {
                    tracing::info!(version = info.version, "daemon update downloaded and verified");
                    s.staged = Some((info.version, path));
                }
                Err(e @ StageError::Mismatch { .. }) => {
                    tracing::error!(version = info.version, "refusing daemon update: {e}");
                    s.refused.insert(info.version);
                }
                Err(e) => tracing::warn!(version = info.version, "daemon update download failed: {e:#}"),
            }
        });
        true
    }

    pub fn staged(&self) -> Option<PathBuf> {
        self.state.lock().unwrap().staged.as_ref().map(|(_, p)| p.clone())
    }

    /// Installs the staged build and re-execs; returns only on failure (that version is then refused).
    pub fn apply_staged(&self) {
        let Some((version, path)) = self.state.lock().unwrap().staged.take() else { return };
        tracing::info!(version, "upgrading daemon {CURRENT} → {version} and restarting");
        let err = match install(&path, &self.exe) {
            Ok(()) => {
                let _ = std::fs::remove_file(&path);
                exec(restart_command(&self.exe, &self.args))
            }
            Err(e) => e,
        };
        tracing::error!(version, "daemon upgrade failed: {err:#}");
        self.state.lock().unwrap().refused.insert(version);
    }

    /// Protocol reject: nothing can run on this build any more, so upgrade right away.
    pub async fn apply_now(&self, info: UpgradeInfo) {
        if !is_newer(&info.version, CURRENT) {
            return;
        }
        match stage(&self.home, &self.server, &self.http, &info).await {
            Ok(path) => {
                self.state.lock().unwrap().staged = Some((info.version, path));
                self.apply_staged();
            }
            Err(e) => tracing::error!(version = info.version, "daemon upgrade failed: {e}"),
        }
    }
}
