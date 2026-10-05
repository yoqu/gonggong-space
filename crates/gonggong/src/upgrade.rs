//! Self-upgrade (plan D17): the server offers a newer build for this OS/arch; the daemon downloads it, verifies its
//! sha256, swaps its own executable and re-execs itself once no run is active. When the server publishes no build for
//! this platform, the daemon looks for one in the latest GitHub release instead (same manifest, absolute URLs).
use crate::config::{Config, Settings};
use crate::protocol::UpgradeInfo;
use anyhow::Context;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::watch;

pub const CURRENT: &str = env!("CARGO_PKG_VERSION");
const GITHUB_API: &str = "https://api.github.com";
const GITHUB_REPO: &str = "yoqu/gonggong-space";
const GITHUB_CHECK: Duration = Duration::from_secs(6 * 3600);

/// This machine's key in a release manifest's `builds`, as the daemon reports it in hello.
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

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

/// Downloads a published build and verifies it. Server-relative URLs (`/downloads/...`) resolve against `server` and
/// go through its (pinned) client `http`; builds hosted elsewhere use the system trust store. Either way the sha256
/// decides.
pub async fn download(
    server: &str,
    http: &reqwest::Client,
    url: &str,
    sha256: &str,
) -> Result<hyper::body::Bytes, StageError> {
    let (url, http) = if url.starts_with('/') {
        (format!("{}{url}", server.trim_end_matches('/')), http.clone())
    } else {
        (url.to_string(), reqwest::Client::new())
    };
    let bytes = async {
        let res = http.get(&url).send().await?.error_for_status()?;
        anyhow::Ok(res.bytes().await?)
    }
    .await
    .with_context(|| format!("download {url}"))?;
    let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    if !actual.eq_ignore_ascii_case(sha256) {
        return Err(StageError::Mismatch { expected: sha256.to_string(), actual });
    }
    Ok(bytes)
}

/// Downloads `info` into `<home>/updates/` and verifies it; the file only appears there once verified.
pub async fn stage(
    home: &Path,
    server: &str,
    http: &reqwest::Client,
    info: &UpgradeInfo,
) -> Result<PathBuf, StageError> {
    let bytes = download(server, http, &info.url, &info.sha256).await?;
    let dir = home.join("updates");
    tokio::fs::create_dir_all(&dir).await.context("create updates dir")?;
    let path = dir.join(format!("gonggong-{}{}", info.version, std::env::consts::EXE_SUFFIX));
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

#[derive(Clone)]
pub struct Upgrader {
    home: PathBuf,
    server: String,
    http: reqwest::Client,
    exe: PathBuf,
    args: Vec<OsString>,
    state: Arc<Mutex<State>>,
    /// Whether the server publishes a build for this platform, from its last welcome; `None` before the first.
    server_release: Arc<watch::Sender<Option<bool>>>,
}

impl Upgrader {
    pub fn new(home: PathBuf, server: String, http: reqwest::Client, exe: PathBuf, args: Vec<OsString>) -> Self {
        let server_release = Arc::new(watch::Sender::new(None));
        Upgrader { home, server, http, exe, args, state: Arc::default(), server_release }
    }

    /// For the running daemon of `config`; `None` when `GONGGONG_NO_AUTO_UPGRADE=1` or auto upgrade is off in settings.
    pub fn from_env(home: PathBuf, config: &Config) -> anyhow::Result<Option<Self>> {
        if std::env::var("GONGGONG_NO_AUTO_UPGRADE").is_ok_and(|v| v == "1") || !Settings::load(&home)?.auto_upgrade {
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

    /// The server's welcome said whether it publishes a build for this platform.
    pub fn server_release(&self, release: bool) {
        self.server_release.send_replace(Some(release));
    }

    /// Every 6 hours, starting once the server has welcomed us: offers the latest GitHub release while the server
    /// publishes no build for this platform. Failures are logged once per check and retried at the next one.
    pub async fn watch_github(self, source: GithubSource) {
        let mut rx = self.server_release.subscribe();
        loop {
            if rx.wait_for(Option::is_some).await.is_err() {
                return;
            }
            if *rx.borrow() == Some(false) {
                match source.latest(CURRENT).await {
                    Ok(Some(info)) => {
                        self.offer(info);
                    }
                    Ok(None) => {}
                    Err(e) => tracing::info!("GitHub update check failed, next in 6h: {e:#}"),
                }
            }
            tokio::time::sleep(GITHUB_CHECK).await;
        }
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

#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    /// 403 / 429 from the GitHub API: wait for the next check.
    #[error("GitHub API rate limit")]
    RateLimited,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

/// The latest release of a GitHub repository (`/releases/latest` skips drafts and pre-releases).
pub struct GithubSource {
    api: String,
    repo: String,
    http: reqwest::Client,
}

#[derive(serde::Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(serde::Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

#[derive(serde::Deserialize)]
struct Manifest {
    version: String,
    builds: std::collections::HashMap<String, Build>,
}

#[derive(serde::Deserialize)]
struct Build {
    url: String,
    sha256: String,
}

impl GithubSource {
    /// A client of its own: GitHub is reached through the system proxy settings, not the server's pinned client.
    pub fn new(api: &str, repo: &str) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(format!("gonggong/{CURRENT}"))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(GithubSource { api: api.trim_end_matches('/').into(), repo: repo.into(), http })
    }

    /// `None` when `GONGGONG_UPDATE=off`; the repository is `GONGGONG_UPDATE_REPO` or yoqu/gonggong-space.
    pub fn from_env() -> Option<Self> {
        if std::env::var("GONGGONG_UPDATE").is_ok_and(|v| v == "off") {
            return None;
        }
        let repo = std::env::var("GONGGONG_UPDATE_REPO").ok().filter(|r| !r.trim().is_empty());
        GithubSource::new(GITHUB_API, repo.as_deref().unwrap_or(GITHUB_REPO).trim())
            .inspect_err(|e| tracing::warn!("GitHub update check disabled: {e:#}"))
            .ok()
    }

    pub fn repo(&self) -> &str {
        &self.repo
    }

    /// This platform's build from the latest release's `manifest.json` asset, when that release is newer than
    /// `current`. A repository without releases has none.
    pub async fn latest(&self, current: &str) -> Result<Option<UpgradeInfo>, CheckError> {
        let url = format!("{}/repos/{}/releases/latest", self.api, self.repo);
        let res = self
            .http
            .get(&url)
            .header("accept", "application/vnd.github+json")
            .send()
            .await
            .with_context(|| format!("GET {url}"))?;
        match res.status() {
            reqwest::StatusCode::FORBIDDEN | reqwest::StatusCode::TOO_MANY_REQUESTS => {
                return Err(CheckError::RateLimited);
            }
            reqwest::StatusCode::NOT_FOUND => return Ok(None),
            _ => {}
        }
        let release: Release =
            res.error_for_status().context("GitHub latest release")?.json().await.context("GitHub latest release")?;
        if !is_newer(release.tag_name.trim_start_matches('v'), current) {
            return Ok(None);
        }
        let Some(asset) = release.assets.iter().find(|a| a.name == "manifest.json") else {
            return Ok(None);
        };
        let manifest: Manifest = async {
            let res = self.http.get(&asset.browser_download_url).send().await?.error_for_status()?;
            anyhow::Ok(res.json().await?)
        }
        .await
        .with_context(|| format!("download {}", asset.browser_download_url))?;
        let Some(build) = manifest.builds.get(&platform()).filter(|_| is_newer(&manifest.version, current)) else {
            return Ok(None);
        };
        Ok(Some(UpgradeInfo { version: manifest.version, url: build.url.clone(), sha256: build.sha256.clone() }))
    }
}
