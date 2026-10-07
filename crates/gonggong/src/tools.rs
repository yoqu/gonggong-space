//! Managed agent tools (design §4.1): Node.js under `<home>/runtime`, Claude Code and Codex installed by npm into
//! `<home>/tools`, all from the configured mirror. Never sudo, never the global npm prefix.
use crate::agents;
use crate::bots::agent_label;
use crate::config::{Mirror, Settings};
use crate::local::LocalSettings;
use crate::protocol::{AgentInfo, AgentKind};
use crate::t;
use crate::upgrade::is_newer;
use anyhow::{Context, Result, bail};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::ffi::OsString;
use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};

/// The ACP adapters need Node ≥ 22.
pub const MIN_NODE_MAJOR: u32 = 22;
const LATEST_TTL: Duration = Duration::from_secs(6 * 3600);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Node,
    Claude,
    Codex,
}

impl ToolKind {
    pub const ALL: [ToolKind; 3] = [ToolKind::Node, ToolKind::Claude, ToolKind::Codex];

    pub fn agent(self) -> Option<AgentKind> {
        match self {
            ToolKind::Node => None,
            ToolKind::Claude => Some(AgentKind::Claude),
            ToolKind::Codex => Some(AgentKind::Codex),
        }
    }

    pub fn label(self) -> &'static str {
        self.agent().map_or("Node.js", agent_label)
    }

    fn package(self) -> Option<&'static str> {
        match self {
            ToolKind::Node => None,
            ToolKind::Claude => Some("@anthropic-ai/claude-code"),
            ToolKind::Codex => Some("@openai/codex"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub kind: ToolKind,
    pub installed: bool,
    pub version: Option<String>,
    /// Latest version on the mirror; `None` when it could not be checked.
    pub latest: Option<String>,
    /// Installed by Gonggong under its home (and so upgradable by it).
    pub managed: bool,
    pub path: Option<String>,
}

impl ToolStatus {
    pub fn has_update(&self) -> bool {
        matches!((&self.latest, &self.version), (Some(l), Some(v)) if is_newer(l, v))
    }
}

/// Receives each progress line of an operation (steps, npm output), e.g. to stream it to the Web.
pub type Progress<'a> = &'a (dyn Fn(&str) + Sync);

pub fn tools_dir(home: &Path) -> PathBuf {
    home.join("tools")
}

/// Where npm puts the executables of `--prefix` global installs.
pub fn tools_bin(home: &Path) -> PathBuf {
    if cfg!(windows) { tools_dir(home) } else { tools_dir(home).join("bin") }
}

fn runtime_dir(home: &Path) -> PathBuf {
    home.join("runtime")
}

fn node_bin_dir(root: &Path) -> PathBuf {
    if cfg!(windows) { root.to_path_buf() } else { root.join("bin") }
}

fn node_exe(root: &Path) -> PathBuf {
    node_bin_dir(root).join(if cfg!(windows) { "node.exe" } else { "node" })
}

/// The active managed Node, resolved so a process started on it keeps its version across a switch. `current` is a
/// symlink on unix and a file naming the version dir on Windows.
fn current_runtime(home: &Path) -> Option<PathBuf> {
    let current = runtime_dir(home).join("current");
    let dir = if cfg!(windows) {
        runtime_dir(home).join(std::fs::read_to_string(&current).ok()?.trim())
    } else {
        current.canonicalize().ok()?
    };
    dir.is_dir().then_some(dir)
}

/// Bin dir of the active managed Node, if any.
pub fn runtime_bin(home: &Path) -> Option<PathBuf> {
    current_runtime(home).map(|r| node_bin_dir(&r))
}

fn switch_current(home: &Path, name: &str) -> Result<()> {
    let tmp = runtime_dir(home).join("current.tmp");
    let _ = std::fs::remove_file(&tmp);
    #[cfg(unix)]
    std::os::unix::fs::symlink(name, &tmp)?;
    #[cfg(not(unix))]
    std::fs::write(&tmp, name)?;
    std::fs::rename(&tmp, runtime_dir(home).join("current"))?;
    Ok(())
}

pub fn is_managed(home: &Path, path: &Path) -> bool {
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let path = canon(path);
    [tools_dir(home), runtime_dir(home)].iter().any(|d| path.starts_with(canon(d)))
}

/// PATH with `dir` first, so `#!/usr/bin/env node` scripts (npm, the agent CLIs' shims) run on that Node.
pub fn prepend_path(dir: &Path) -> OsString {
    let rest = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default();
    std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(rest))
        .unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

#[derive(Debug, Clone)]
pub struct Node {
    pub path: PathBuf,
    /// Without the leading `v`.
    pub version: String,
    pub managed: bool,
}

impl Node {
    fn major(&self) -> Option<u32> {
        self.version.split('.').next()?.parse().ok()
    }

    fn dir(&self) -> &Path {
        self.path.parent().expect("node lives in a dir")
    }

    pub fn path_env(&self) -> OsString {
        prepend_path(self.dir())
    }

    /// npm of this Node. A managed Node runs its bundled npm directly, so it works without any other Node on PATH.
    pub fn npm(&self) -> Result<tokio::process::Command> {
        let mut cmd = if self.managed {
            let root = if cfg!(windows) { self.dir() } else { self.dir().parent().context("node has no root")? };
            let lib = if cfg!(windows) { root.to_path_buf() } else { root.join("lib") };
            let mut cmd = crate::proc::async_command(&self.path);
            cmd.arg(lib.join("node_modules/npm/bin/npm-cli.js"));
            cmd
        } else {
            let npm = agents::file_names("npm")
                .into_iter()
                .map(|n| self.dir().join(n))
                .find(|p| p.is_file())
                .or_else(|| agents::find("npm"))
                .context(t!("未找到 npm"))?;
            crate::proc::async_command(npm)
        };
        cmd.env("PATH", self.path_env());
        Ok(cmd)
    }
}

fn node_version(path: &Path) -> Option<String> {
    let out = crate::proc::command(path).arg("--version").output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('v').to_string();
    v.starts_with(|c: char| c.is_ascii_digit()).then_some(v)
}

fn managed_node(home: &Path) -> Option<Node> {
    let path = node_exe(&current_runtime(home)?);
    Some(Node { version: node_version(&path)?, path, managed: true })
}

/// The Node found on PATH or in common dirs, whatever its version.
fn system_node(home: &Path) -> Option<Node> {
    let path = agents::find("node")?;
    Some(Node { version: node_version(&path)?, managed: is_managed(home, &path), path })
}

/// The Node to run adapters and npm on: the managed one, else a system Node ≥ 22.
pub fn node(home: &Path) -> Option<Node> {
    managed_node(home).or_else(|| system_node(home).filter(|n| n.major().is_some_and(|m| m >= MIN_NODE_MAJOR)))
}

/// `node`, installing the managed Node first when there is none.
pub async fn ensure_node(home: &Path, progress: Progress<'_>) -> Result<Node> {
    if let Some(node) = node(home) {
        return Ok(node);
    }
    let _busy = busy(home)?;
    ensure_node_locked(home, &Settings::load(home)?.mirror, progress).await
}

async fn ensure_node_locked(home: &Path, mirror: &Mirror, progress: Progress<'_>) -> Result<Node> {
    if let Some(node) = node(home) {
        return Ok(node);
    }
    progress(&t!("未找到 Node.js ≥ {v}，安装共工空间托管版", v = MIN_NODE_MAJOR));
    install_node(home, mirror, None, progress).await?;
    managed_node(home).context(t!("托管 Node.js 安装后无法运行"))
}

/// One install or upgrade at a time per machine, across the daemon and the CLI; held until dropped.
fn busy(home: &Path) -> Result<File> {
    std::fs::create_dir_all(home)?;
    let file = OpenOptions::new().create(true).write(true).truncate(false).open(home.join("tools.lock"))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => bail!(t!("本机已有工具安装或升级在进行中，请稍后再试")),
        Err(TryLockError::Error(e)) => Err(e.into()),
    }
}

/// A version to install: `latest` (→ `None`) or an exact semver, optionally `v`-prefixed. Anything else is refused
/// before it can reach npm or a URL.
fn requested(version: &str) -> Result<Option<String>> {
    static SEMVER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$").unwrap());
    if version == "latest" {
        return Ok(None);
    }
    let caps = SEMVER
        .captures(version)
        .with_context(|| t!("版本号格式不正确：{version}（应为 x.y.z 或 latest）", version = version))?;
    Ok(Some(caps[1].to_string()))
}

fn major(version: &str) -> Option<u32> {
    version.split('.').next()?.parse().ok()
}

/// Installs `kind` (`version` = `None` or `latest` for the latest) under the Gonggong home and returns its status.
pub async fn install(home: &Path, kind: ToolKind, version: Option<&str>, progress: Progress<'_>) -> Result<ToolStatus> {
    let version = version.map(requested).transpose()?.flatten();
    if kind == ToolKind::Node
        && let Some(v) = &version
        && major(v).is_none_or(|m| m < MIN_NODE_MAJOR)
    {
        bail!(t!("ACP 适配器需要 Node.js ≥ {min}，不能安装 {v}", min = MIN_NODE_MAJOR, v = v));
    }
    {
        let _busy = busy(home)?;
        let mirror = Settings::load(home)?.mirror;
        match kind.package() {
            None => install_node(home, &mirror, version, progress).await?,
            Some(pkg) => install_package(home, &mirror, pkg, version, progress).await?,
        }
    }
    Ok(with_latest(home, current(home, kind)?).await)
}

/// Upgrades a managed tool to the latest version; tools the user installed are left alone (their own updater may
/// need network access we do not have).
pub async fn upgrade(home: &Path, kind: ToolKind, progress: Progress<'_>) -> Result<ToolStatus> {
    let status = current(home, kind)?;
    if !status.installed {
        bail!(t!("{tool} 未安装", tool = kind.label()));
    }
    if !status.managed {
        bail!(t!(
            "{tool} 为自行安装（{path}），共工空间不代为升级，可改为安装共工空间托管版",
            tool = kind.label(),
            path = status.path.as_deref().unwrap_or("-")
        ));
    }
    let latest = latest(home, kind, true).await?;
    if status.version.as_deref().is_some_and(|v| !is_newer(&latest, v)) {
        progress(&t!("{tool} 已是最新版本 {v}", tool = kind.label(), v = latest));
        return Ok(ToolStatus { latest: Some(latest), ..status });
    }
    install(home, kind, Some(&latest), progress).await
}

async fn install_package(
    home: &Path,
    mirror: &Mirror,
    pkg: &str,
    version: Option<String>,
    progress: Progress<'_>,
) -> Result<()> {
    let node = ensure_node_locked(home, mirror, progress).await?;
    let spec = format!("{pkg}@{}", version.as_deref().unwrap_or("latest"));
    progress(&t!("安装 {spec}（{registry}）", spec = spec, registry = mirror.registry()));
    let prefix = tools_dir(home);
    std::fs::create_dir_all(&prefix)?;
    let mut npm = node.npm()?;
    npm.args(["i", "-g", "--prefix"]).arg(&prefix).args(["--registry", mirror.registry(), "--no-audit", "--no-fund"]);
    npm.arg(&spec);
    run(npm, progress).await
}

/// Runs `cmd`, reporting each output line; fails with the last lines when it exits non-zero.
pub async fn run(mut cmd: tokio::process::Command, progress: Progress<'_>) -> Result<()> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context(t!("无法启动 npm"))?;
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    forward(child.stdout.take().expect("piped"), tx.clone());
    forward(child.stderr.take().expect("piped"), tx);
    let mut tail = VecDeque::new();
    while let Some(line) = rx.recv().await {
        progress(&line);
        tail.push_back(line);
        if tail.len() > 5 {
            tail.pop_front();
        }
    }
    let status = child.wait().await?;
    if !status.success() {
        bail!(t!("npm 执行失败（{status}）：{output}", status = status, output = Vec::from(tail).join("\n")));
    }
    Ok(())
}

fn forward(pipe: impl AsyncRead + Unpin + Send + 'static, tx: tokio::sync::mpsc::UnboundedSender<String>) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = tx.send(line);
            }
        }
    });
}

fn http() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build()?)
}

async fn get_text(http: &reqwest::Client, url: &str) -> Result<String> {
    async { anyhow::Ok(http.get(url).timeout(Duration::from_secs(30)).send().await?.error_for_status()?.text().await?) }
        .await
        .with_context(|| t!("请求 {url} 失败", url = url))
}

/// Node's platform suffix for this build (`darwin-arm64`, `win-x64`…); `None` where Node publishes no binary.
pub fn node_platform() -> Option<&'static str> {
    if cfg!(target_env = "musl") {
        return None;
    }
    platform_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn platform_for(os: &str, arch: &str) -> Option<&'static str> {
    Some(match (os, arch) {
        ("macos", "aarch64") => "darwin-arm64",
        ("macos", "x86_64") => "darwin-x64",
        ("linux", "x86_64") => "linux-x64",
        ("linux", "aarch64") => "linux-arm64",
        ("windows", "x86_64") => "win-x64",
        ("windows", "aarch64") => "win-arm64",
        _ => return None,
    })
}

pub fn node_archive_name(version: &str, platform: &str) -> String {
    let ext = if platform.starts_with("win-") { "zip" } else { "tar.gz" };
    format!("node-v{version}-{platform}.{ext}")
}

/// The newest LTS release ≥ 22 in the dist `index.json`, without the leading `v`.
fn latest_lts(index: &str) -> Result<String> {
    #[derive(Deserialize)]
    struct Release {
        version: String,
        lts: serde_json::Value,
    }
    let releases: Vec<Release> = serde_json::from_str(index).context(t!("Node.js 版本索引格式错误"))?;
    releases
        .into_iter()
        .filter(|r| r.lts.is_string())
        .map(|r| r.version.trim_start_matches('v').to_string())
        .filter(|v| requested(v).is_ok() && major(v).is_some_and(|m| m >= MIN_NODE_MAJOR))
        .max_by_key(|v| v.split(['.', '-']).take(3).map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>())
        .with_context(|| t!("镜像上没有 ≥ {v} 的 Node.js LTS 版本", v = MIN_NODE_MAJOR))
}

/// The SHA-256 of `file` in a `SHASUMS256.txt`.
fn checksum<'a>(sums: &'a str, file: &str) -> Option<&'a str> {
    sums.lines().find_map(|l| {
        let (hash, name) = l.split_once(char::is_whitespace)?;
        (name.trim().trim_start_matches('*') == file).then_some(hash)
    })
}

async fn install_node(home: &Path, mirror: &Mirror, version: Option<String>, progress: Progress<'_>) -> Result<()> {
    let http = http()?;
    let dist = mirror.node_dist();
    let version = match version {
        Some(v) => v,
        None => {
            progress(t!("查询 Node.js 最新 LTS 版本"));
            latest_lts(&get_text(&http, &format!("{dist}/index.json")).await?)?
        }
    };
    let platform = node_platform().context(t!("当前平台没有 Node.js 官方构建"))?;
    let file = node_archive_name(&version, platform);
    let name = format!("node-v{version}");
    let runtime = runtime_dir(home);
    let target = runtime.join(&name);
    if !node_exe(&target).is_file() {
        let sums = get_text(&http, &format!("{dist}/v{version}/SHASUMS256.txt")).await?;
        let expected = checksum(&sums, &file).with_context(|| t!("镜像未提供 {file}", file = file))?.to_string();
        std::fs::create_dir_all(&runtime)?;
        let archive = runtime.join(&file);
        let res = async {
            download(&http, &format!("{dist}/v{version}/{file}"), &archive, &expected, progress).await?;
            progress(t!("解压"));
            let root = file.trim_end_matches(".tar.gz").trim_end_matches(".zip").to_string();
            let (archive, target) = (archive.clone(), target.clone());
            tokio::task::spawn_blocking(move || extract(&archive, &root, &target)).await?
        }
        .await;
        let _ = std::fs::remove_file(&archive);
        res?;
    }
    switch_current(home, &name)?;
    progress(&t!("已切换到 Node.js {version}", version = version));
    Ok(())
}

/// Streams `url` into `dest`, reporting every 10%, and verifies its SHA-256.
async fn download(http: &reqwest::Client, url: &str, dest: &Path, sha256: &str, progress: Progress<'_>) -> Result<()> {
    let mut res = http
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .with_context(|| t!("下载 {url} 失败", url = url))?;
    let total = res.content_length();
    let name = url.rsplit('/').next().unwrap_or(url);
    progress(&t!("下载 {name}", name = name));
    let mut out = tokio::fs::File::create(dest).await?;
    let mut hasher = Sha256::new();
    let (mut done, mut reported) = (0u64, 0u64);
    while let Some(chunk) = res.chunk().await.with_context(|| t!("下载 {url} 中断", url = url))? {
        hasher.update(&chunk);
        out.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if let Some(total) = total.filter(|t| *t > 0) {
            let pct = done * 100 / total / 10 * 10;
            if pct > reported {
                reported = pct;
                progress(&t!("下载 {name}（{pct}%）", name = name, pct = pct));
            }
        }
    }
    out.flush().await?;
    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !actual.eq_ignore_ascii_case(sha256) {
        bail!(t!(
            "{name} 的 SHA256 校验失败（应为 {sha256}，实为 {actual}）",
            name = name,
            sha256 = sha256,
            actual = actual
        ));
    }
    Ok(())
}

/// Unpacks the archive's single `root` dir as `target`, via a staging dir so `target` never exists half-written.
fn extract(archive: &Path, root: &str, target: &Path) -> Result<()> {
    let parent = target.parent().context("target has no parent")?;
    let staging = parent.join(format!(".staging-{root}"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    if archive.extension().is_some_and(|e| e == "zip") {
        zip::ZipArchive::new(File::open(archive)?)?.extract(&staging)?;
    } else {
        tar::Archive::new(flate2::read::GzDecoder::new(File::open(archive)?)).unpack(&staging)?;
    }
    if target.exists() {
        std::fs::remove_dir_all(target)?;
    }
    std::fs::rename(staging.join(root), target).with_context(|| t!("压缩包里没有 {root}", root = root))?;
    std::fs::remove_dir_all(&staging)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Checked {
    version: String,
    /// The URL it came from: another mirror is checked anew.
    source: String,
    /// Unix seconds.
    checked_at: u64,
}

fn latest_cache(home: &Path) -> PathBuf {
    home.join("tools-latest.json")
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The last checked latest version of `kind`, however old; no network.
pub fn cached_latest(home: &Path, kind: ToolKind) -> Option<String> {
    let cache: BTreeMap<ToolKind, Checked> = serde_json::from_slice(&std::fs::read(latest_cache(home)).ok()?).ok()?;
    cache.get(&kind).map(|c| c.version.clone())
}

/// Latest version of `kind` on the configured mirror, cached for 6 hours unless `force`.
pub async fn latest(home: &Path, kind: ToolKind, force: bool) -> Result<String> {
    let mirror = Settings::load(home)?.mirror;
    let source = match kind.package() {
        Some(pkg) => format!("{}/{pkg}/latest", mirror.registry()),
        None => format!("{}/index.json", mirror.node_dist()),
    };
    let path = latest_cache(home);
    let mut cache: BTreeMap<ToolKind, Checked> =
        std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let now = unix_now();
    if !force
        && let Some(c) = cache.get(&kind)
        && c.source == source
        && now.saturating_sub(c.checked_at) < LATEST_TTL.as_secs()
    {
        return Ok(c.version.clone());
    }
    let body = get_text(&http()?, &source).await?;
    let version = match kind.package() {
        Some(_) => {
            let v: serde_json::Value = serde_json::from_str(&body).context(t!("npm 版本信息格式错误"))?;
            let v = v["version"].as_str().context(t!("npm 版本信息缺少 version"))?;
            requested(v)?.context(t!("npm 版本信息格式错误"))?
        }
        None => latest_lts(&body)?,
    };
    cache.insert(kind, Checked { version: version.clone(), source, checked_at: now });
    std::fs::create_dir_all(home)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&cache)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(version)
}

/// Status of the Node in use (the managed one, else the system one even if too old), without `latest`.
pub fn node_status(home: &Path) -> ToolStatus {
    let node = managed_node(home).or_else(|| system_node(home));
    ToolStatus {
        kind: ToolKind::Node,
        installed: node.is_some(),
        managed: node.as_ref().is_some_and(|n| n.managed),
        version: node.as_ref().map(|n| n.version.clone()),
        latest: None,
        path: node.map(|n| n.path.to_string_lossy().into_owned()),
    }
}

/// Status of a detected agent CLI, without `latest`.
pub fn agent_status(home: &Path, info: &AgentInfo) -> ToolStatus {
    let kind = match info.kind {
        AgentKind::Claude => ToolKind::Claude,
        AgentKind::Codex => ToolKind::Codex,
    };
    let path = info.path.as_deref().filter(|_| info.available);
    ToolStatus {
        kind,
        installed: info.available,
        version: info.version.clone(),
        latest: None,
        managed: path.is_some_and(|p| is_managed(home, Path::new(p))),
        path: path.map(String::from),
    }
}

/// Adds the (cached) latest version; a failed check only loses the update hint.
pub async fn with_latest(home: &Path, status: ToolStatus) -> ToolStatus {
    let latest = latest(home, status.kind, false)
        .await
        .inspect_err(|e| tracing::warn!("{} latest version check failed: {e:#}", status.kind.label()))
        .ok();
    ToolStatus { latest, ..status }
}

fn current(home: &Path, kind: ToolKind) -> Result<ToolStatus> {
    Ok(match kind.agent() {
        None => node_status(home),
        Some(agent) => {
            let infos = agents::detect(home, &LocalSettings::load(home)?);
            agent_status(home, infos.iter().find(|a| a.kind == agent).expect("detect covers every agent"))
        }
    })
}

/// Node, Claude Code and Codex with their latest versions.
pub async fn status(home: &Path, local: &LocalSettings) -> Vec<ToolStatus> {
    let mut all = vec![with_latest(home, node_status(home)).await];
    for info in agents::detect(home, local) {
        all.push(with_latest(home, agent_status(home, &info)).await);
    }
    all
}

#[derive(clap::Subcommand)]
pub enum AgentsCmd {
    /// Install Node.js, Claude Code or Codex managed by Gonggong (under its home), from the configured mirror.
    Install {
        kind: ToolKind,
        /// Exact version (x.y.z); the latest by default.
        #[arg(long)]
        version: Option<String>,
    },
    /// Upgrade Gonggong-managed tools to their latest version.
    Upgrade {
        #[arg(required_unless_present = "all", conflicts_with = "all")]
        kind: Option<ToolKind>,
        #[arg(long)]
        all: bool,
    },
    /// Show or set the download mirror: npmmirror (default), official, or an npm registry URL with --node-mirror.
    Mirror {
        value: Option<String>,
        /// Node.js download base of a custom mirror (where index.json lives).
        #[arg(long, value_name = "URL")]
        node_mirror: Option<String>,
    },
}

/// `gg agents …`
pub async fn cli(home: &Path, cmd: Option<AgentsCmd>) -> Result<()> {
    let print = |l: &str| println!("  {l}");
    match cmd {
        None => crate::configure::print_agents(home).await,
        Some(AgentsCmd::Install { kind, version }) => {
            let s = install(home, kind, version.as_deref(), &print).await?;
            let version = s.version.as_deref().unwrap_or(t!("（版本未知）"));
            println!("{}", t!("已安装 {tool} {version}", tool = kind.label(), version = version));
            Ok(())
        }
        Some(AgentsCmd::Upgrade { kind, all }) => {
            let kinds = if all { ToolKind::ALL.to_vec() } else { kind.into_iter().collect() };
            for kind in kinds {
                match upgrade(home, kind, &print).await {
                    Ok(s) => println!("{} {}", kind.label(), s.version.as_deref().unwrap_or("-")),
                    Err(e) if all => println!("{}：{e:#}", kind.label()),
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
        Some(AgentsCmd::Mirror { value, node_mirror }) => set_mirror(home, value, node_mirror),
    }
}

fn set_mirror(home: &Path, value: Option<String>, node: Option<String>) -> Result<()> {
    let mut settings = Settings::load(home)?;
    if let Some(value) = value {
        settings.mirror = match (value.as_str(), node) {
            ("npmmirror", None) => Mirror::Npmmirror,
            ("official", None) => Mirror::Official,
            ("npmmirror" | "official", Some(_)) => bail!(t!("--node-mirror 只用于自定义镜像")),
            (registry, Some(node)) => Mirror::Custom { registry: http_url(registry)?, node: http_url(&node)? },
            (_, None) => bail!(t!("自定义镜像需同时用 --node-mirror 指定 Node.js 下载地址")),
        };
        settings.save(home)?;
    }
    let m = &settings.mirror;
    let name = match m {
        Mirror::Npmmirror => t!("淘宝镜像（npmmirror）"),
        Mirror::Official => t!("官方源"),
        Mirror::Custom { .. } => t!("自定义"),
    };
    println!("{}\nnpm\t{}\nNode.js\t{}", t!("镜像源：{name}", name = name), m.registry(), m.node_dist());
    Ok(())
}

pub(crate) fn http_url(s: &str) -> Result<String> {
    match reqwest::Url::parse(s) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => Ok(s.to_string()),
        _ => bail!(t!("不是有效的 http(s) 地址：{s}", s = s)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_node_archives_per_platform() {
        assert_eq!(platform_for("macos", "aarch64"), Some("darwin-arm64"));
        assert_eq!(platform_for("linux", "x86_64"), Some("linux-x64"));
        assert_eq!(platform_for("windows", "x86_64"), Some("win-x64"));
        assert_eq!(platform_for("freebsd", "x86_64"), None);
        assert_eq!(node_archive_name("24.2.0", "darwin-arm64"), "node-v24.2.0-darwin-arm64.tar.gz");
        assert_eq!(node_archive_name("24.2.0", "win-x64"), "node-v24.2.0-win-x64.zip");
    }

    #[test]
    fn picks_the_newest_lts_from_22() {
        let index = r#"[{"version":"v25.1.0","lts":false},{"version":"v22.20.0","lts":"Jod"},
            {"version":"v24.10.0","lts":"Krypton"},{"version":"v24.9.0","lts":"Krypton"},{"version":"v20.1.0","lts":"Iron"}]"#;
        assert_eq!(latest_lts(index).unwrap(), "24.10.0");
        assert!(latest_lts(r#"[{"version":"v20.1.0","lts":"Iron"},{"version":"v25.0.0","lts":false}]"#).is_err());
        assert!(latest_lts("<html>").is_err());
    }

    #[test]
    fn finds_the_archive_checksum() {
        let sums = "aaa  node-v24.2.0-darwin-arm64.tar.xz\nbbb  node-v24.2.0-darwin-arm64.tar.gz\nccc *node-v24.2.0-win-x64.zip\n";
        assert_eq!(checksum(sums, "node-v24.2.0-darwin-arm64.tar.gz"), Some("bbb"));
        assert_eq!(checksum(sums, "node-v24.2.0-win-x64.zip"), Some("ccc"));
        assert_eq!(checksum(sums, "node-v24.2.0-linux-x64.tar.gz"), None);
    }

    #[test]
    fn accepts_only_latest_or_exact_versions() {
        assert_eq!(requested("latest").unwrap(), None);
        assert_eq!(requested("2.1.285").unwrap().as_deref(), Some("2.1.285"));
        assert_eq!(requested("v24.2.0").unwrap().as_deref(), Some("24.2.0"));
        assert_eq!(requested("0.160.0-alpha.3").unwrap().as_deref(), Some("0.160.0-alpha.3"));
        for bad in ["", "2", "2.1", "^2.1.0", "2.1.0 --registry=x", "--foo", "1.0.0;rm", "next", "1.0.0-", "../1.0.0"] {
            assert!(requested(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn one_operation_at_a_time() {
        let home = tempfile::tempdir().unwrap();
        let held = busy(home.path()).unwrap();
        assert!(busy(home.path()).is_err());
        drop(held);
        // A child forked by a parallel test briefly shares the lock's file description until its exec closes it.
        let freed = (0..50).any(|_| {
            busy(home.path()).is_ok() || {
                std::thread::sleep(std::time::Duration::from_millis(20));
                false
            }
        });
        assert!(freed);
    }

    #[test]
    fn switches_the_current_runtime_atomically() {
        let home = tempfile::tempdir().unwrap();
        for v in ["node-v22.1.0", "node-v24.2.0"] {
            std::fs::create_dir_all(runtime_dir(home.path()).join(v)).unwrap();
        }
        assert_eq!(current_runtime(home.path()), None);
        switch_current(home.path(), "node-v22.1.0").unwrap();
        assert!(current_runtime(home.path()).unwrap().ends_with("node-v22.1.0"));
        switch_current(home.path(), "node-v24.2.0").unwrap();
        assert!(current_runtime(home.path()).unwrap().ends_with("node-v24.2.0"));
    }

    #[test]
    fn a_custom_mirror_needs_both_urls() {
        let home = tempfile::tempdir().unwrap();
        assert!(set_mirror(home.path(), Some("http://r.local".into()), None).is_err());
        assert!(set_mirror(home.path(), Some("official".into()), Some("http://n.local".into())).is_err());
        assert!(set_mirror(home.path(), Some("ftp://r.local".into()), Some("http://n.local".into())).is_err());
        set_mirror(home.path(), Some("http://r.local".into()), Some("http://n.local".into())).unwrap();
        assert_eq!(Settings::load(home.path()).unwrap().mirror.registry(), "http://r.local");
        set_mirror(home.path(), Some("official".into()), None).unwrap();
        assert_eq!(Settings::load(home.path()).unwrap().mirror, Mirror::Official);
    }
}
