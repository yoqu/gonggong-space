//! Hosted artifacts on the daemon side (docs/plan/产物托管与编辑-开发计划.md §3.2, slice D): the server holds each
//! `design/<slug>/` folder as versions. Before a turn, changes made here since the version last known (offline, a failed
//! upload, a hand edit) go up first, and only then is the head checked out: a folder whose changes could not go up is
//! left as it is. After the turn the folder goes up as a new version, with a first-screen thumbnail and one PNG per
//! screen of its gg-artifact.json (the canvas copies those as images).
//! Each (artifact, folder) keeps its state in `<home>/artifacts/<id>/<folder key>/state.json`, never in the workspace:
//! the version it last matched with that version's files, the stat cache, the submit on its way (resent with the same
//! key until answered) and the version being written (a checkout a crash cut off is finished, not taken for edits).
use crate::config::Config;
use crate::protocol::{
    ArtifactFile, ArtifactManifestRes, ArtifactSubmitReq, ArtifactSubmitRes, ArtifactSubmitSource, DaemonArtifactRef,
    DaemonToServer, RunEvent, RunStart, RunStatus, SYNC_MISSING_MAX,
};
use crate::service::Outbox;
use crate::static_site::{self, Body};
use crate::sync::{FileRef, Manifest, TRANSFERS, hash_file, manifest_root, safe_path};
use crate::{snapshot, t, tls};
use futures_util::{StreamExt, TryStreamExt, stream};
use hyper::{Request, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

pub const FILE_MAX_BYTES: u64 = 10 * 1024 * 1024;
pub const VERSION_MAX_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_FILES: usize = 500;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const META_TIMEOUT: Duration = Duration::from_secs(30);
const PER_MB: Duration = Duration::from_secs(1);
/// Prefix of the staging folder a checkout downloads into, inside the artifact folder (same file system, skipped by
/// scans as a dot folder).
const STAGING: &str = ".gg-checkout-";

/// A request that failed; `rejected`: the server refused it for good (a 4xx), resending the same is pointless.
#[derive(Debug)]
struct Failure {
    rejected: bool,
    message: String,
}

impl From<anyhow::Error> for Failure {
    fn from(e: anyhow::Error) -> Self {
        Failure { rejected: false, message: format!("{e:#}") }
    }
}

impl From<reqwest::Error> for Failure {
    fn from(e: reqwest::Error) -> Self {
        Failure { rejected: false, message: e.to_string() }
    }
}

impl From<std::io::Error> for Failure {
    fn from(e: std::io::Error) -> Self {
        Failure { rejected: false, message: e.to_string() }
    }
}

/// `/api/daemon/…` artifact routes over the machine token.
struct Client {
    http: reqwest::Client,
    server: String,
    token: String,
}

impl Client {
    fn new(config: &Config) -> anyhow::Result<Self> {
        let http = tls::builder(config)?.connect_timeout(CONNECT_TIMEOUT).build()?;
        Ok(Client { http, server: config.server.trim_end_matches('/').into(), token: config.token.clone() })
    }

    fn run_url(&self, run: &str, id: &str, rest: &str) -> String {
        format!("{}/api/daemon/runs/{run}/artifacts/{id}/{rest}", self.server)
    }

    async fn send(&self, req: reqwest::RequestBuilder, timeout: Duration) -> Result<reqwest::Response, Failure> {
        let res = req.bearer_auth(&self.token).timeout(timeout).send().await?;
        let status = res.status();
        if status.is_success() {
            return Ok(res);
        }
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let message = body["message"].as_str().unwrap_or(t!("未知错误"));
        Err(Failure {
            rejected: status.is_client_error() && status.as_u16() != 408 && status.as_u16() != 429,
            message: t!("服务器返回 {status}: {message}", status = status, message = message),
        })
    }

    async fn manifest(&self, id: &str, version: &str) -> Result<ArtifactManifestRes, Failure> {
        let url = format!("{}/api/daemon/artifacts/{id}/versions/{version}", self.server);
        Ok(self.send(self.http.get(url), META_TIMEOUT).await?.json().await?)
    }

    async fn missing(&self, run: &str, id: &str, hashes: &[String]) -> Result<Vec<String>, Failure> {
        let mut out = vec![];
        for chunk in hashes.chunks(SYNC_MISSING_MAX) {
            let req =
                self.http.post(self.run_url(run, id, "blobs/missing")).json(&serde_json::json!({ "hashes": chunk }));
            let res: serde_json::Value = self.send(req, META_TIMEOUT).await?.json().await?;
            out.extend(res["missing"].as_array().into_iter().flatten().filter_map(|h| h.as_str().map(String::from)));
        }
        Ok(out)
    }

    async fn upload(&self, run: &str, id: &str, hash: &str, path: &Path) -> Result<(), Failure> {
        let file = tokio::fs::File::open(path).await?;
        let len = file.metadata().await?.len();
        let req = self
            .http
            .put(self.run_url(run, id, &format!("blobs/{hash}")))
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .header(reqwest::header::CONTENT_LENGTH, len)
            .body(file);
        self.send(req, transfer(len)).await.map(drop)
    }

    async fn download_to(&self, run: &str, id: &str, hash: &str, size: u64, to: &Path) -> Result<(), Failure> {
        let req = self.http.get(self.run_url(run, id, &format!("blobs/{hash}")));
        let mut body = self.send(req, transfer(size)).await?.bytes_stream();
        let mut file = tokio::fs::File::create(to).await?;
        while let Some(chunk) = body.next().await {
            file.write_all(&chunk?).await?;
        }
        Ok(file.flush().await?)
    }

    async fn submit(&self, run: &str, id: &str, req: &ArtifactSubmitReq) -> Result<ArtifactSubmitRes, Failure> {
        let req = self.http.post(self.run_url(run, id, "versions")).json(req);
        Ok(self.send(req, META_TIMEOUT).await?.json().await?)
    }

    async fn thumbnail(&self, run: &str, id: &str, version: &str, png: Vec<u8>) -> Result<(), Failure> {
        let req = self
            .http
            .put(self.run_url(run, id, &format!("versions/{version}/thumbnail")))
            .header(reqwest::header::CONTENT_TYPE, "image/png")
            .body(png);
        self.send(req, META_TIMEOUT).await.map(drop)
    }

    async fn screen_thumbnail(&self, run: &str, id: &str, version: &str, screen: &str, png: Vec<u8>) -> Result<(), Failure> {
        let req = self
            .http
            .put(self.run_url(run, id, &format!("versions/{version}/screens/{screen}/thumbnail")))
            .header(reqwest::header::CONTENT_TYPE, "image/png")
            .body(png);
        self.send(req, META_TIMEOUT).await.map(drop)
    }
}

fn transfer(bytes: u64) -> Duration {
    META_TIMEOUT + PER_MB * bytes.div_ceil(1024 * 1024) as u32
}

/// A file as last scanned; `mtime` in nanoseconds since the epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Stat {
    size: u64,
    mtime: u64,
    hash: String,
}

/// Path → hash.
type Files = BTreeMap<String, String>;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct State {
    /// The version the folder last matched (checked out or submitted from here).
    version: Option<String>,
    files: Files,
    cache: BTreeMap<String, Stat>,
    pending: Option<ArtifactSubmitReq>,
    /// A checkout under way: the folder is half old, half this version.
    applying: Option<String>,
}

/// One artifact's folder in one workspace.
struct Folder {
    id: String,
    rel: String,
    dir: PathBuf,
    state: PathBuf,
}

impl Folder {
    fn new(home: &Path, cwd: &Path, r: &DaemonArtifactRef) -> Result<Folder, String> {
        let id_ok = !r.id.is_empty() && r.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        let slug = r.dir.strip_prefix("design/").unwrap_or_default();
        let dir_ok = (1..=64).contains(&slug.len())
            && slug.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && !slug.starts_with('-');
        if !id_ok || !dir_ok {
            return Err(t!("产物目录不合法：{dir}", dir = r.dir));
        }
        safe_path(cwd, &r.dir)?;
        let dir = cwd.join(&r.dir);
        let key = hex(&Sha256::digest(dir.to_string_lossy().as_bytes()))[..16].to_string();
        Ok(Folder { id: r.id.clone(), rel: r.dir.clone(), dir, state: home.join("artifacts").join(&r.id).join(key) })
    }

    fn load(&self) -> Result<State, String> {
        match std::fs::read(self.state.join("state.json")) {
            Ok(raw) => serde_json::from_slice(&raw).map_err(|e| t!("产物状态文件损坏：{e}", e = e)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::default()),
            Err(e) => Err(t!("无法读取产物状态：{e}", e = e)),
        }
    }

    fn save(&self, state: &State) -> Result<(), String> {
        let err = |e: std::io::Error| -> String { t!("无法保存产物状态：{e}", e = e) };
        std::fs::create_dir_all(&self.state).map_err(err)?;
        let (tmp, file) = (self.state.join("state.json.tmp"), self.state.join("state.json"));
        let mut f = std::fs::File::create(&tmp).map_err(err)?;
        f.write_all(&serde_json::to_vec(state).expect("serializable")).and_then(|_| f.sync_all()).map_err(err)?;
        std::fs::rename(&tmp, &file).map_err(err)
    }

    /// The folder now, rehashing only files whose size or mtime changed; the cache in `state` is updated.
    async fn scan(&self, state: &mut State) -> Result<Files, String> {
        let (dir, cache) = (self.dir.clone(), std::mem::take(&mut state.cache));
        let scanned = tokio::task::spawn_blocking(move || {
            let mut out = BTreeMap::new();
            walk(&dir, "", &cache, &mut out).map(|_| out)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| t!("无法扫描产物目录 {dir}：{e}", dir = self.rel, e = e))?;
        let files = scanned.iter().map(|(p, s)| (p.clone(), s.hash.clone())).collect();
        state.cache = scanned;
        Ok(files)
    }
}

/// Files under `dir` (as `prefix…`), skipping dot entries, `node_modules` and symlinks.
fn walk(
    dir: &Path,
    prefix: &str,
    cache: &BTreeMap<String, Stat>,
    out: &mut BTreeMap<String, Stat>,
) -> std::io::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && prefix.is_empty() => return Ok(()),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else { continue };
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let (kind, path) = (entry.file_type()?, format!("{prefix}{name}"));
        if kind.is_dir() {
            walk(&entry.path(), &format!("{path}/"), cache, out)?;
        } else if kind.is_file() {
            let meta = entry.metadata()?;
            let mtime = meta.modified()?.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()) as u64;
            let hash = match cache.get(&path) {
                Some(c) if c.size == meta.len() && c.mtime == mtime => c.hash.clone(),
                _ => hash_file(&entry.path())?,
            };
            out.insert(path, Stat { size: meta.len(), mtime, hash });
        }
    }
    Ok(())
}

/// The digest the server gives a version of these files (`artifactDigestText`).
fn digest(files: &Files) -> String {
    let m: Manifest = files.iter().map(|(p, h)| (p.clone(), FileRef { hash: h.clone(), exec: false })).collect();
    manifest_root(&m)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Within the limits every version keeps (`ARTIFACT_*` in the protocol).
fn within_limits(files: &[ArtifactFile]) -> Result<(), String> {
    let total: u64 = files.iter().map(|f| f.size).sum();
    if let Some(f) = files.iter().find(|f| f.size > FILE_MAX_BYTES) {
        return Err(t!("产物文件超过 10MB：{path}", path = f.path));
    }
    if files.len() > MAX_FILES || total > VERSION_MAX_BYTES {
        return Err(t!("产物超出单版上限（500 个文件、50MB）").into());
    }
    Ok(())
}

/// One lock per folder state: a checkout and an upload of the same folder never interleave.
fn lock_of(state: &Path) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: Mutex<Option<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> = Mutex::new(None);
    LOCKS.lock().unwrap().get_or_insert_default().entry(state.to_path_buf()).or_default().clone()
}

/// Artifact hosting for runs on this machine.
pub struct Artifacts {
    client: Client,
    home: PathBuf,
}

impl Artifacts {
    pub fn new(api: &Config, home: &Path) -> anyhow::Result<Self> {
        Ok(Artifacts { client: Client::new(api)?, home: home.to_path_buf() })
    }

    /// Before a turn: uploads the folder's local changes (resending a pending submit first), then checks out the head.
    /// Err: the changes could not go up, and the folder was left as it is.
    pub async fn prepare(&self, run: &str, cwd: &Path, r: &DaemonArtifactRef) -> Result<(), String> {
        let f = Folder::new(&self.home, cwd, r)?;
        let lock = lock_of(&f.state);
        let _held = lock.lock().await;
        let mut state = f.load()?;
        let mut head = r.head_version_id.clone();
        if state.pending.is_some() {
            self.resend(run, &f, &mut state).await?;
        }
        let local = f.scan(&mut state).await?;
        let matches_head = r.digest.as_deref() == Some(digest(&local).as_str()) && head.is_some();
        let resuming = state.applying.is_some();
        if !matches_head && !resuming && !local.is_empty() && local != state.files {
            let res = self.submit(run, &f, &mut state, &local, ArtifactSubmitSource::Local).await?;
            if res.head {
                head = Some(res.version_id);
            }
        }
        let Some(head) = head else { return f.save(&state) };
        if matches_head || (state.version.as_deref() == Some(&head) && local == state.files && !resuming) {
            (state.version, state.files, state.applying) = (Some(head), local, None);
            return f.save(&state);
        }
        self.checkout(run, &f, &mut state, &head, &local).await
    }

    /// After a turn: the folder as a new version when it changed since the version it matched. Err: it did not go up
    /// (kept for the next turn's `prepare` to retry).
    pub async fn publish(
        &self,
        run: &str,
        cwd: &Path,
        r: &DaemonArtifactRef,
    ) -> Result<Option<ArtifactSubmitRes>, String> {
        let f = Folder::new(&self.home, cwd, r)?;
        let lock = lock_of(&f.state);
        let _held = lock.lock().await;
        let mut state = f.load()?;
        if state.pending.is_some() {
            self.resend(run, &f, &mut state).await?;
        }
        let local = f.scan(&mut state).await?;
        if local.is_empty() || local == state.files {
            return f.save(&state).map(|_| None);
        }
        self.submit(run, &f, &mut state, &local, ArtifactSubmitSource::Run).await.map(Some)
    }

    /// Screenshots the folder's shell (the canvas view) and uploads it as `version`'s thumbnail, then each screen of
    /// its manifest in the device's window; false when the machine has no browser to take them with.
    pub async fn thumbnail(
        &self,
        run: &str,
        cwd: &Path,
        r: &DaemonArtifactRef,
        version: &str,
        kit: Option<&Path>,
    ) -> Result<bool, String> {
        let f = Folder::new(&self.home, cwd, r)?;
        let (port, server) = serve_shell(&f.dir, kit).await.map_err(|e| e.to_string())?;
        let result = self.shoot(run, &f, port, version).await;
        server.abort();
        result
    }

    async fn shoot(&self, run: &str, f: &Folder, port: u16, version: &str) -> Result<bool, String> {
        let shot = snapshot::capture(port, "/").await;
        let Some(png) = shot.map_err(|e| format!("{e:#}"))? else { return Ok(false) };
        self.client.thumbnail(run, &f.id, version, png).await.map_err(|e| e.message)?;
        for s in screen_shots(&f.dir) {
            let shot = snapshot::capture_sized(port, &format!("/{}", s.file), s.window).await;
            let Some(png) = shot.map_err(|e| format!("{e:#}"))? else { return Ok(false) };
            self.client.screen_thumbnail(run, &f.id, version, &s.id, png).await.map_err(|e| e.message)?;
        }
        Ok(true)
    }

    /// Uploads the missing blobs of `local`, then submits it as a version on top of the one the folder matched.
    async fn submit(
        &self,
        run: &str,
        f: &Folder,
        state: &mut State,
        local: &Files,
        source: ArtifactSubmitSource,
    ) -> Result<ArtifactSubmitRes, String> {
        let files: Vec<ArtifactFile> = local
            .iter()
            .map(|(p, h)| ArtifactFile { path: p.clone(), hash: h.clone(), size: state.cache[p].size })
            .collect();
        within_limits(&files)?;
        let mut by_hash: BTreeMap<&str, &str> = BTreeMap::new();
        for file in &files {
            by_hash.entry(file.hash.as_str()).or_insert(file.path.as_str());
        }
        let hashes: Vec<String> = by_hash.keys().map(|h| h.to_string()).collect();
        let missing = self.client.missing(run, &f.id, &hashes).await.map_err(|e| e.message)?;
        stream::iter(missing.iter().filter_map(|h| Some((h, by_hash.get(h.as_str())?))).map(Ok))
            .try_for_each_concurrent(TRANSFERS, |(hash, path)| {
                let path = f.dir.join(path);
                async move { self.client.upload(run, &f.id, hash, &path).await }
            })
            .await
            .map_err(|e| e.message)?;
        let submit_key = uuid::Uuid::new_v4().to_string();
        state.pending = Some(ArtifactSubmitReq { parent_version_id: state.version.clone(), source, submit_key, files });
        // Persisted before it is sent: an answer lost on the way is asked for again with the same key.
        f.save(state)?;
        self.resend(run, f, state).await
    }

    /// Sends the pending submit; settled (answered, or refused for good) it is cleared.
    async fn resend(&self, run: &str, f: &Folder, state: &mut State) -> Result<ArtifactSubmitRes, String> {
        let req = state.pending.clone().expect("a pending submit");
        match self.client.submit(run, &f.id, &req).await {
            Ok(res) => {
                state.version = Some(res.version_id.clone());
                state.files = req.files.into_iter().map(|f| (f.path, f.hash)).collect();
                state.pending = None;
                f.save(state)?;
                Ok(res)
            }
            Err(e) => {
                if e.rejected {
                    state.pending = None;
                    f.save(state)?;
                }
                Err(e.message)
            }
        }
    }

    /// Writes `version` into the folder, which holds `local` (all of it uploaded): every blob is fetched and verified
    /// first, then files are replaced by rename and the ones the version lacks are deleted.
    async fn checkout(
        &self,
        run: &str,
        f: &Folder,
        state: &mut State,
        version: &str,
        local: &Files,
    ) -> Result<(), String> {
        let m = self.client.manifest(&f.id, version).await.map_err(|e| e.message)?;
        if m.version_id != version {
            return Err(t!("产物版本清单不匹配：{version}", version = version));
        }
        within_limits(&m.files)?;
        for file in &m.files {
            let hidden = file.path.split('/').any(|s| s.starts_with('.') || s == "node_modules");
            if hidden || file.hash.len() != 64 || !file.hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(t!("产物版本含有不安全的路径，已拒绝：{path}", path = file.path));
            }
            safe_path(&f.dir, &file.path)?;
        }
        let head: Files = m.files.iter().map(|f| (f.path.clone(), f.hash.clone())).collect();
        let writes: Vec<(usize, &ArtifactFile)> =
            m.files.iter().filter(|w| local.get(&w.path) != Some(&w.hash)).enumerate().collect();
        let err = |e: std::io::Error| -> String { t!("无法检出产物 {dir}：{e}", dir = f.rel, e = e) };
        std::fs::create_dir_all(&f.dir).map_err(err)?;
        let staging = f.dir.join(format!("{STAGING}{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&staging).map_err(err)?;
        let result = async {
            stream::iter(writes.iter().map(Ok))
                .try_for_each_concurrent(TRANSFERS, |(i, w)| {
                    let to = staging.join(i.to_string());
                    async move {
                        self.client.download_to(run, &f.id, &w.hash, w.size, &to).await.map_err(|e| e.message)?;
                        if hash_file(&to).map_err(err)? != w.hash {
                            return Err(t!("下载内容校验失败：{hash}", hash = w.hash));
                        }
                        Ok::<_, String>(())
                    }
                })
                .await?;
            state.applying = Some(version.into());
            f.save(state)?;
            for gone in local.keys().filter(|p| !head.contains_key(*p)) {
                match std::fs::remove_file(f.dir.join(gone)) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(err(e)),
                    _ => prune(&f.dir, gone),
                }
            }
            for (i, w) in &writes {
                let to = f.dir.join(&w.path);
                std::fs::create_dir_all(to.parent().expect("has a parent")).map_err(err)?;
                std::fs::rename(staging.join(i.to_string()), &to).map_err(err)?;
            }
            Ok(())
        }
        .await;
        let _ = std::fs::remove_dir_all(&staging);
        result?;
        f.scan(state).await?;
        (state.version, state.files, state.applying) = (Some(version.into()), head, None);
        f.save(state)
    }
}

/// Removes the directories above `path` under `root` left empty.
fn prune(root: &Path, path: &str) {
    let mut at = Path::new(path).parent();
    while let Some(dir) = at.filter(|d| !d.as_os_str().is_empty()) {
        if std::fs::remove_dir(root.join(dir)).is_err() {
            return;
        }
        at = dir.parent();
    }
}

/// The platform shell of a plugin: `skills/<skill>/kit/` holding `index.html` (served as `/`) and the runtime files
/// (served as `/_gg/*`). Looked up in the turn's plugins, else in the installed web-prototype plugins (the latest).
pub fn kit(plugins: &[PathBuf], home: &Path) -> Option<PathBuf> {
    let in_plugin = |p: &Path| {
        let preferred = p.join("skills/web-prototype/kit");
        if preferred.join("index.html").is_file() {
            return Some(preferred);
        }
        let skills = std::fs::read_dir(p.join("skills")).ok()?;
        let mut kits: Vec<_> =
            skills.flatten().map(|s| s.path().join("kit")).filter(|k| k.join("index.html").is_file()).collect();
        kits.sort();
        kits.into_iter().next()
    };
    plugins.iter().find_map(|p| in_plugin(p)).or_else(|| {
        let sets = std::fs::read_dir(home.join("plugin-sets")).ok()?;
        let mut sets: Vec<_> = sets
            .flatten()
            .filter(|s| s.file_name().to_string_lossy().starts_with("web-prototype-"))
            .filter_map(|s| Some((s.metadata().ok()?.modified().ok()?, s.path())))
            .collect();
        sets.sort();
        sets.into_iter().rev().find_map(|(_, p)| in_plugin(&p))
    })
}

/// A screen of a folder's gg-artifact.json to screenshot, and the window its device shows it in.
#[derive(Debug, PartialEq)]
pub struct ScreenShot {
    pub id: String,
    pub file: String,
    pub window: (u32, u32),
}

/// The screens of `dir`'s gg-artifact.json whose id is valid and whose file exists (none for L0 or an unreadable one).
pub fn screen_shots(dir: &Path) -> Vec<ScreenShot> {
    #[derive(Deserialize)]
    struct Screen {
        id: String,
        file: String,
    }
    #[derive(Deserialize)]
    struct Manifest {
        device: String,
        screens: Vec<Screen>,
    }
    let Ok(text) = std::fs::read(dir.join("gg-artifact.json")) else { return vec![] };
    let Ok(m) = serde_json::from_slice::<Manifest>(&text) else { return vec![] };
    let window = match m.device.as_str() {
        "miniprogram" => (375, 812),
        "mobile" => (390, 844),
        _ => (1440, 900),
    };
    let kebab = |id: &str| {
        (1..=40).contains(&id.len())
            && id.split('-').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()))
    };
    m.screens
        .into_iter()
        .filter(|s| kebab(&s.id) && s.file == format!("screens/{}.html", s.id) && dir.join(&s.file).is_file())
        .map(|s| ScreenShot { id: s.id, file: s.file, window })
        .collect()
}

/// Serves `dir` on a loopback port, with `/` and `/_gg/*` from `kit` when given (else the folder's own copies), the
/// way the server renders it. Returns the port and the task to abort.
pub async fn serve_shell(dir: &Path, kit: Option<&Path>) -> std::io::Result<(u16, tokio::task::JoinHandle<()>)> {
    let dir = Arc::new(dir.canonicalize()?);
    let kit = Arc::new(kit.map(Path::canonicalize).transpose()?);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else { continue };
            let (dir, kit) = (dir.clone(), kit.clone());
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |req| {
                    let (dir, kit) = (dir.clone(), kit.clone());
                    async move { Ok::<_, Infallible>(shell(&dir, kit.as_deref(), req).await) }
                });
                let io = hyper_util::rt::TokioIo::new(stream);
                let _ = hyper::server::conn::http1::Builder::new().serve_connection(io, service).await;
            });
        }
    });
    Ok((port, task))
}

async fn shell<B>(dir: &Path, kit: Option<&Path>, req: Request<B>) -> Response<Body> {
    let path = req.uri().path();
    let from_kit = match path {
        "/" | "/index.html" => Some("/index.html"),
        _ => path.strip_prefix("/_gg").filter(|p| p.starts_with('/')),
    };
    if let (Some(kit), Some(rest)) = (kit, from_kit) {
        let mapped = Request::builder().method(req.method()).uri(rest).body(()).expect("a valid path");
        return static_site::answer(kit, &mapped, false).await;
    }
    static_site::answer(dir, &req, true).await
}

/// A run's artifacts: prepared before the agent starts, published when the turn ends.
pub(crate) struct Turn {
    artifacts: Arc<Artifacts>,
    run_id: String,
    cwd: PathBuf,
    refs: Vec<DaemonArtifactRef>,
    kit: Option<PathBuf>,
    out: Outbox,
}

/// Prepares every artifact of `start`; also returns the note for the agent about those left as they are.
pub(crate) async fn before_turn(
    api: &Config,
    home: &Path,
    start: &RunStart,
    cwd: &Path,
    plugins: &[PathBuf],
    out: &Outbox,
) -> (Option<Turn>, Option<String>) {
    let artifacts = match Artifacts::new(api, home) {
        Ok(a) => Arc::new(a),
        Err(e) => {
            tracing::warn!("artifacts: {e:#}");
            return (None, None);
        }
    };
    let mut kept = vec![];
    for r in &start.artifacts {
        if let Err(e) = artifacts.prepare(&start.run_id, cwd, r).await {
            tracing::warn!("run {}: artifact {} not checked out: {e}", start.run_id, r.dir);
            status(
                out,
                &start.run_id,
                t!("产物 {dir} 的本地改动未能上传，本轮未检出最新版本：{e}", dir = r.dir, e = e),
            );
            kept.push(format!("{}（{e}）", r.dir));
        }
    }
    let hint = (!kept.is_empty()).then(|| {
        format!(
            "产物托管：以下产物目录的本地改动未能上传，本轮没有检出服务端最新版本，目录保持原样：{}",
            kept.join("、")
        )
    });
    let turn = Turn {
        artifacts,
        run_id: start.run_id.clone(),
        cwd: cwd.to_path_buf(),
        refs: start.artifacts.clone(),
        kit: kit(plugins, home),
        out: out.clone(),
    };
    (Some(turn), hint)
}

impl Turn {
    /// Uploads what the turn changed; thumbnails follow in the background. A failed upload waits for the next turn.
    pub(crate) async fn finish(self) {
        for r in &self.refs {
            match self.artifacts.publish(&self.run_id, &self.cwd, r).await {
                Ok(None) => {}
                Ok(Some(res)) => {
                    let (a, run, cwd, r, kit) =
                        (self.artifacts.clone(), self.run_id.clone(), self.cwd.clone(), r.clone(), self.kit.clone());
                    tokio::spawn(async move {
                        if let Err(e) = a.thumbnail(&run, &cwd, &r, &res.version_id, kit.as_deref()).await {
                            tracing::warn!("run {run}: thumbnail of artifact {} failed: {e}", r.dir);
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!("run {}: artifact {} not uploaded: {e}", self.run_id, r.dir);
                    let step = t!("产物 {dir} 上传失败，下一轮开跑前重试：{e}", dir = r.dir, e = e);
                    status(&self.out, &self.run_id, step);
                }
            }
        }
    }
}

fn status(out: &Outbox, run_id: &str, step: String) {
    out.send(DaemonToServer::RunEvent {
        run_id: run_id.into(),
        event: RunEvent::Status { status: RunStatus::Running, step },
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_shots_lists_valid_existing_screens_in_their_device_window() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(screen_shots(dir.path()), vec![]);
        std::fs::create_dir_all(dir.path().join("screens")).unwrap();
        for f in ["home", "Bad", "gone-file", "detail"] {
            if f != "gone-file" {
                std::fs::write(dir.path().join(format!("screens/{f}.html")), "<p>").unwrap();
            }
        }
        let manifest = |device: &str| {
            serde_json::json!({
                "title": "t", "device": device, "entry": "home",
                "screens": [
                    { "id": "home", "title": "首页", "file": "screens/home.html" },
                    { "id": "Bad", "title": "x", "file": "screens/Bad.html" },
                    { "id": "gone-file", "title": "x", "file": "screens/gone-file.html" },
                    { "id": "detail", "title": "x", "file": "screens/home.html" },
                    { "id": "detail", "title": "详情", "file": "screens/detail.html" },
                ],
            })
            .to_string()
        };
        std::fs::write(dir.path().join("gg-artifact.json"), manifest("miniprogram")).unwrap();
        let shot = |id: &str, window| ScreenShot { id: id.into(), file: format!("screens/{id}.html"), window };
        assert_eq!(screen_shots(dir.path()), vec![shot("home", (375, 812)), shot("detail", (375, 812))]);
        std::fs::write(dir.path().join("gg-artifact.json"), manifest("desktop")).unwrap();
        assert_eq!(screen_shots(dir.path())[0].window, (1440, 900));
        std::fs::write(dir.path().join("gg-artifact.json"), "{").unwrap();
        assert_eq!(screen_shots(dir.path()), vec![]);
    }

    async fn get(port: u16, path: &str) -> (u16, String) {
        let res = reqwest::Client::builder().no_proxy().build().unwrap().get(format!("http://127.0.0.1:{port}{path}"));
        let res = res.send().await.unwrap();
        (res.status().as_u16(), res.text().await.unwrap())
    }

    #[tokio::test]
    async fn the_shell_serves_the_kit_at_the_root_and_under_gg_and_the_folder_elsewhere() {
        let root = tempfile::tempdir().unwrap();
        let (dir, kit) = (root.path().join("design/app"), root.path().join("kit"));
        for (p, body) in [
            ("design/app/index.html", "copy"),
            ("design/app/_gg/gg-kit.js", "old js"),
            ("design/app/screens/home.html", "home"),
            ("kit/index.html", "shell"),
            ("kit/gg-kit.js", "js"),
        ] {
            let p = root.path().join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let (port, task) = serve_shell(&dir, Some(&kit)).await.unwrap();
        assert_eq!(get(port, "/").await, (200, "shell".into()));
        assert_eq!(get(port, "/index.html").await, (200, "shell".into()));
        assert_eq!(get(port, "/_gg/gg-kit.js").await, (200, "js".into()));
        assert_eq!(get(port, "/screens/home.html").await.1, "home");
        assert_eq!(get(port, "/_gg/../../kit/index.html").await.0, 404);
        task.abort();
        let (port, task) = serve_shell(&dir, None).await.unwrap();
        assert_eq!(get(port, "/").await.1, "copy");
        assert_eq!(get(port, "/_gg/gg-kit.js").await.1, "old js");
        task.abort();
    }

    #[test]
    fn the_kit_comes_from_the_turn_s_plugins_else_an_installed_web_prototype() {
        let home = tempfile::tempdir().unwrap();
        let set = |name: &str, skill: &str| {
            let k = home.path().join("plugin-sets").join(name).join("skills").join(skill).join("kit");
            std::fs::create_dir_all(&k).unwrap();
            std::fs::write(k.join("index.html"), "").unwrap();
            home.path().join("plugin-sets").join(name)
        };
        assert_eq!(kit(&[], home.path()), None);
        let installed = set("web-prototype-d1", "web-prototype");
        assert_eq!(kit(&[], home.path()), Some(installed.join("skills/web-prototype/kit")));
        let other = set("slides-d2", "slides");
        assert_eq!(kit(std::slice::from_ref(&other), home.path()), Some(other.join("skills/slides/kit")));
    }

    #[test]
    fn folders_must_be_design_slugs_and_ids_plain() {
        let cwd = tempfile::tempdir().unwrap();
        let r = |id: &str, dir: &str| DaemonArtifactRef {
            id: id.into(),
            dir: dir.into(),
            head_version_id: None,
            digest: None,
        };
        assert!(Folder::new(cwd.path(), cwd.path(), &r("a1", "design/app-1a2b")).is_ok());
        for (id, dir) in
            [("a1", "design/../x"), ("a1", "src/app"), ("a1", "design/"), ("a1", "design/A"), ("../a", "design/x")]
        {
            assert!(Folder::new(cwd.path(), cwd.path(), &r(id, dir)).is_err(), "{id} {dir}");
        }
    }

    #[test]
    fn the_digest_is_the_sync_root_of_the_files_without_exec() {
        let files = Files::from([("b".into(), "h2".into()), ("a".into(), "h1".into())]);
        assert_eq!(digest(&files), crate::sync::hash_bytes(b"a\0-\0h1\nb\0-\0h2\n"));
    }
}
