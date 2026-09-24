//! Per-(group, bot) workspaces (spec §4.2, §4.3): managed clones made with the owner's own git credentials, and /cd
//! bindings to the owner's existing directories. Also the directory picker and the desktop 工作区 page.
use crate::config::{Config, user_home};
use crate::git::{self, git};
use crate::protocol::{
    DaemonToServer, DirEntry, DirGit, DirResult, GitStatus, RepoSpec, RunEvent, RunStart, RunStatus, WorkspaceCd,
    WorkspaceEnsure, WorkspaceKind, WorkspaceSpec, WorkspaceState, WorkspaceStateKind,
};
use crate::service::Outbox;
use crate::session::TurnReq;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

/// `<home>/workspaces/<groupId>/<botId>/<repoId | _empty>/` — isolated per group, bot and repo (a new repo = new dir).
pub fn managed_path(home: &Path, group: &str, bot: &str, repo_id: Option<&str>) -> PathBuf {
    home.join("workspaces").join(group).join(bot).join(repo_id.unwrap_or("_empty"))
}

/// Serializes clones, /cd checks and run cwd resolution of one (group, bot).
type Locks = Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>;

pub struct Workspaces {
    home: PathBuf,
    locks: Locks,
    /// One turn at a time per real directory, across groups and bots sharing it (plan W10).
    dirs: Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
}

type Outcome = Result<(PathBuf, Option<GitStatus>), String>;

impl Workspaces {
    pub fn new(home: PathBuf) -> Self {
        Workspaces { home, locks: Mutex::default(), dirs: Mutex::default() }
    }

    /// Holds the turn's directory for its duration, telling the run when it has to wait for another one.
    pub(crate) async fn occupy(&self, req: &TurnReq) -> tokio::sync::OwnedMutexGuard<()> {
        let key = req.cwd.canonicalize().unwrap_or_else(|_| req.cwd.clone());
        let lock = self.dirs.lock().unwrap().entry(key).or_default().clone();
        if let Ok(guard) = lock.clone().try_lock_owned() {
            return guard;
        }
        let event = RunEvent::Status {
            status: RunStatus::Running,
            step: "等待工作区空闲（同目录有其他会话在运行）".into(),
        };
        req.out.send(DaemonToServer::RunEvent { run_id: req.start.run_id.clone(), event });
        lock.lock_owned().await
    }

    fn lock(&self, group: &str, bot: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry((group.into(), bot.into())).or_default().clone()
    }

    /// workspace.ensure: reports `cloning` only when a clone is actually needed, then `ready` / `failed`.
    pub async fn ensure(&self, req: WorkspaceEnsure, out: &Outbox) {
        let lock = self.lock(&req.group_id, &req.bot_id);
        let _guard = lock.lock().await;
        let reply = |outcome| report(out, &req.group_id, &req.bot_id, &req.request_id, outcome);
        let outcome = self.managed(&req.group_id, &req.bot_id, req.repo.as_ref(), || reply(None)).await;
        reply(Some(outcome));
    }

    /// workspace.cd: bind to a validated local directory, or go back to the managed workspace (`path: None`).
    pub async fn cd(&self, req: WorkspaceCd, out: &Outbox) {
        let lock = self.lock(&req.group_id, &req.bot_id);
        let _guard = lock.lock().await;
        let reply = |outcome| report(out, &req.group_id, &req.bot_id, &req.request_id, outcome);
        let outcome = match &req.path {
            None => self.managed(&req.group_id, &req.bot_id, req.repo.as_ref(), || reply(None)).await,
            Some(path) => {
                let dir = PathBuf::from(path);
                match check_cd(&dir, req.repo.as_ref()).await {
                    Ok(()) => {
                        let git = match git::is_repo(&dir) {
                            true => git::status(&dir, WorkspaceKind::Cd).await.ok(),
                            false => None,
                        };
                        Ok((dir, git))
                    }
                    Err(e) => Err(e),
                }
            }
        };
        reply(Some(outcome));
    }

    /// The directory a (group, bot) works in: the /cd directory, else the managed path.
    pub fn dir(&self, group: &str, bot: &str, spec: &WorkspaceSpec) -> PathBuf {
        match &spec.cd_path {
            Some(path) => PathBuf::from(path),
            None => managed_path(&self.home, group, bot, spec.repo.as_ref().map(|r| &*r.id)),
        }
    }

    /// A run's cwd: the /cd directory, else the managed clone (re-cloned if it went missing), else `_empty`.
    pub async fn resolve(&self, start: &RunStart) -> Result<PathBuf, String> {
        if let Some(path) = &start.workspace.cd_path {
            let dir = PathBuf::from(path);
            return if dir.is_dir() { Ok(dir) } else { Err(format!("/cd 目录不存在：{path}")) };
        }
        let lock = self.lock(&start.group_id, &start.bot.id);
        let _guard = lock.lock().await;
        let dir =
            managed_path(&self.home, &start.group_id, &start.bot.id, start.workspace.repo.as_ref().map(|r| &*r.id));
        prepare(&dir, start.workspace.repo.as_ref(), || {}).await?;
        Ok(dir)
    }

    async fn managed(&self, group: &str, bot: &str, repo: Option<&RepoSpec>, on_clone: impl FnOnce()) -> Outcome {
        let dir = managed_path(&self.home, group, bot, repo.map(|r| &*r.id));
        prepare(&dir, repo, on_clone).await?;
        let git = match repo {
            Some(_) => git::status(&dir, WorkspaceKind::Managed).await.ok(),
            None => None,
        };
        Ok((dir, git))
    }
}

/// `None` = still cloning.
fn report(out: &Outbox, group: &str, bot: &str, request_id: &str, outcome: Option<Outcome>) {
    let (state, path, git, error) = match outcome {
        Some(Ok((dir, git))) => (WorkspaceStateKind::Ready, Some(dir.to_string_lossy().into_owned()), git, None),
        Some(Err(e)) => (WorkspaceStateKind::Failed, None, None, Some(e)),
        None => (WorkspaceStateKind::Cloning, None, None, None),
    };
    out.send(DaemonToServer::WorkspaceState(WorkspaceState {
        group_id: group.into(),
        bot_id: bot.into(),
        request_id: Some(request_id.into()),
        state,
        path,
        git,
        error,
    }));
}

/// Makes `dir` a usable workspace: an existing clone is kept as is; anything else there is replaced by a fresh clone.
async fn prepare(dir: &Path, repo: Option<&RepoSpec>, on_clone: impl FnOnce()) -> Result<(), String> {
    let Some(repo) = repo else {
        return tokio::fs::create_dir_all(dir).await.map_err(|e| format!("无法创建工作区 {}: {e}", dir.display()));
    };
    if is_clone_root(dir).await {
        // Clones made before autocrlf was enforced get it too (spec §12 risk 1).
        return git(dir, &["config", "core.autocrlf", "false"]).await.map(drop);
    }
    on_clone();
    clone(dir, repo).await
}

async fn is_clone_root(dir: &Path) -> bool {
    let Ok(top) = git(dir, &["rev-parse", "--show-toplevel"]).await else { return false };
    matches!((Path::new(top.trim()).canonicalize(), dir.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

/// Clones next to the target and renames, so an interrupted clone never looks like a valid workspace.
async fn clone(dir: &Path, repo: &RepoSpec) -> Result<(), String> {
    let parent = dir.parent().expect("managed paths have a parent");
    let partial = dir.with_extension("partial");
    let io = |e: std::io::Error| format!("无法创建工作区 {}: {e}", dir.display());
    tokio::fs::create_dir_all(parent).await.map_err(io)?;
    for stale in [&partial, &dir.to_path_buf()] {
        if stale.exists() {
            tokio::fs::remove_dir_all(stale).await.map_err(io)?;
        }
    }
    let target = partial.to_string_lossy();
    let args = ["clone", "-q", "-c", "core.autocrlf=false", "--branch", &repo.branch, "--", &repo.url, &target];
    if let Err(e) = git(parent, &args).await {
        let _ = tokio::fs::remove_dir_all(&partial).await;
        return Err(format!("clone 失败：{e}"));
    }
    tokio::fs::rename(&partial, dir).await.map_err(io)
}

/// /cd target must be an absolute, existing, usable directory; with a group repo also a work tree of that repo.
async fn check_cd(dir: &Path, repo: Option<&RepoSpec>) -> Result<(), String> {
    existing_dir(dir)?;
    if let Some(why) = unusable(dir) {
        return Err(why);
    }
    let Some(repo) = repo else { return Ok(()) };
    if !git(dir, &["rev-parse", "--is-inside-work-tree"]).await.is_ok_and(|s| s.trim() == "true") {
        return Err("不是 git 仓库".into());
    }
    let urls = remotes(dir).await;
    let want = normalize_remote(&repo.url);
    if urls.iter().any(|u| normalize_remote(u) == want) {
        return Ok(());
    }
    Err(format!("remote 与群仓库不一致（{}）", if urls.is_empty() { "无 remote".into() } else { urls.join("、") }))
}

fn existing_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err("需要本机绝对路径".into());
    }
    if !dir.is_dir() {
        return Err("目录不存在".into());
    }
    Ok(())
}

const SYSTEM_DIRS: &[&str] =
    &["/System", "/usr", "/bin", "/sbin", "/etc", "/boot", "/proc", "/sys", "/dev", "C:\\Windows", "C:\\Program Files"];

/// Why `dir` must not be handed to an agent as its workspace (plan W8); None = fine.
pub fn unusable(dir: &Path) -> Option<String> {
    let real = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let home = user_home();
    if real.parent().is_none() || real == home.canonicalize().unwrap_or(home) {
        return Some("目录范围过大，请选择具体的项目目录".into());
    }
    SYSTEM_DIRS.iter().any(|d| real.starts_with(d)).then(|| "不能使用系统目录".into())
}

/// Remote URLs configured in the repo containing `dir`.
async fn remotes(dir: &Path) -> Vec<String> {
    // Exits 1 when there is no remote at all.
    let listed = git(dir, &["config", "--get-regexp", r"^remote\..*\.url$"]).await.unwrap_or_default();
    listed.lines().filter_map(|l| l.split_once(' ').map(|(_, url)| url.to_string())).collect()
}

const DIR_LIST_MAX: usize = 500;

/// dir.list for the workspace picker: subdirectories of `path` (home when None) and the repo containing it.
pub async fn browse(request_id: String, path: Option<String>) -> DirResult {
    let dir = path.map(PathBuf::from).unwrap_or_else(user_home);
    let mut result = DirResult {
        request_id,
        path: dir.to_string_lossy().into_owned(),
        entries: vec![],
        git: None,
        unusable: None,
        error: None,
    };
    if let Err(e) = existing_dir(&dir) {
        result.error = Some(e);
        return result;
    }
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_dir())
                .filter_map(|e| e.file_name().into_string().ok().map(|name| (name, e.path())))
                .filter(|(name, _)| !name.starts_with('.'))
                .map(|(name, path)| DirEntry { name, git: git::is_repo(&path) })
                .collect()
        })
        .unwrap_or_default();
    entries.sort_by_key(|e| e.name.to_lowercase());
    entries.truncate(DIR_LIST_MAX);
    result.entries = entries;
    if let Ok(root) = git(&dir, &["rev-parse", "--show-toplevel"]).await {
        let branch = git(&dir, &["symbolic-ref", "--short", "-q", "HEAD"]).await.ok().map(|b| b.trim().to_string());
        result.git = Some(DirGit { root: root.trim().into(), remotes: remotes(&dir).await, branch });
    }
    result.unusable = unusable(&dir);
    result
}

/// Canonical identity of a remote: `git@host:a/b.git` ≡ `ssh://git@host/a/b` ≡ `https://host/a/b/` → `host/a/b`;
/// local paths and `file://` URLs resolve symlinks (e.g. macOS `/var` → `/private/var`).
pub fn normalize_remote(url: &str) -> String {
    let url = url.trim();
    let trim = |s: &str| {
        let s = s.trim_end_matches('/');
        s.strip_suffix(".git").unwrap_or(s).trim_end_matches('/').to_string()
    };
    let local = url.strip_prefix("file://").or_else(|| Path::new(url).is_absolute().then_some(url));
    if let Some(path) = local {
        let real = std::fs::canonicalize(path).map(|p| p.to_string_lossy().into_owned());
        return format!("file://{}", trim(&real.unwrap_or_else(|_| path.into())));
    }
    let (authority, path) = match url.split_once("://") {
        Some((_, rest)) => rest.split_once('/').unwrap_or((rest, "")),
        None => url.split_once(':').unwrap_or((url, "")),
    };
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host).to_lowercase();
    format!("{host}/{}", trim(path.trim_start_matches('/')))
}

/// A (group, bot) pair of this machine as the server knows it (`GET /api/daemon/workspaces`, DaemonWorkspaceDto).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub group_id: String,
    pub group_name: String,
    pub group_kind: String,
    pub bot_id: String,
    pub bot_name: String,
    pub kind: WorkspaceKind,
    pub cd_path: Option<String>,
    pub repo_id: Option<String>,
    pub removed: bool,
    pub running: bool,
}

pub async fn fetch_pairs(config: &Config) -> anyhow::Result<Vec<Pair>> {
    let url = format!("{}/api/daemon/workspaces", config.server.trim_end_matches('/'));
    let res = crate::tls::client(config)?.get(url).bearer_auth(&config.token).send().await?;
    Ok(crate::bots::ok(res).await?.json().await?)
}

/// 改回托管: the server treats it as `/cd @bot --reset` from the bot owner.
pub async fn reset_cd(config: &Config, group: &str, bot: &str) -> anyhow::Result<()> {
    let url = format!("{}/api/daemon/workspaces/{group}/{bot}/reset-cd", config.server.trim_end_matches('/'));
    let res = crate::tls::client(config)?.post(url).bearer_auth(&config.token).send().await?;
    crate::bots::ok(res).await.map(drop)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Managed,
    /// Managed dir of a group without a repo (`_empty`).
    Empty,
    Cd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryState {
    Running,
    Idle,
    /// The bot left the group (or the group / bot is gone): the dir only takes space.
    Removed,
    /// The pair is active but works elsewhere now (/cd bound, or the group switched repos).
    Unused,
}

/// One row of the 工作区 page. Names are `None` for dirs the server no longer knows about.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub group_id: String,
    pub group_name: Option<String>,
    pub dm: bool,
    pub bot_id: String,
    pub bot_name: Option<String>,
    pub kind: EntryKind,
    pub path: PathBuf,
    /// Bytes on disk; `None` for /cd dirs, which are the owner's own checkout.
    pub size: Option<u64>,
    pub state: EntryState,
}

impl Entry {
    pub fn deletable(&self) -> bool {
        self.kind != EntryKind::Cd && matches!(self.state, EntryState::Removed | EntryState::Unused)
    }

    /// `私聊` for DMs; the id when the server no longer knows the group.
    pub fn group_label(&self) -> String {
        match (&self.group_name, self.dm) {
            (_, true) => "私聊".into(),
            (Some(name), false) => name.clone(),
            (None, false) => self.group_id.clone(),
        }
    }

    pub fn bot_label(&self) -> &str {
        self.bot_name.as_deref().unwrap_or(&self.bot_id)
    }

    /// `<group>/<bot>` given as ids or names.
    pub fn matches(&self, target: &str) -> bool {
        let Some((g, b)) = target.split_once('/') else { return false };
        (g == self.group_id || self.group_name.as_deref() == Some(g))
            && (b == self.bot_id || self.bot_name.as_deref() == Some(b))
    }

    pub fn kind_label(&self) -> &'static str {
        match self.kind {
            EntryKind::Managed => "托管",
            EntryKind::Empty => "托管 · 无仓库",
            EntryKind::Cd => "/cd 绑定",
        }
    }

    pub fn state_label(&self) -> String {
        let size = self.size.map(|s| format!(" · {}", human_size(s))).unwrap_or_default();
        match self.state {
            EntryState::Running => "运行中".into(),
            EntryState::Idle => "空闲".into(),
            EntryState::Removed => format!("已移出{size}"),
            EntryState::Unused => format!("未使用{size}"),
        }
    }
}

/// Stops a size walk on huge trees; the result is then a lower bound.
const SIZE_MAX_ENTRIES: usize = 500_000;

/// Every workspace of this machine: the server's active pairs plus whatever managed dirs are left on disk.
pub fn list(home: &Path, pairs: &[Pair]) -> Vec<Entry> {
    let by_pair: HashMap<(&str, &str), &Pair> = pairs.iter().map(|p| ((&*p.group_id, &*p.bot_id), p)).collect();
    let mut claimed = HashSet::new();
    let mut entries = vec![];
    for p in pairs.iter().filter(|p| !p.removed) {
        let (kind, path) = match (p.kind, &p.cd_path) {
            (WorkspaceKind::Cd, Some(cd)) => (EntryKind::Cd, PathBuf::from(cd)),
            _ => (
                if p.repo_id.is_some() { EntryKind::Managed } else { EntryKind::Empty },
                managed_path(home, &p.group_id, &p.bot_id, p.repo_id.as_deref()),
            ),
        };
        claimed.insert(real(&path));
        let size = (kind != EntryKind::Cd).then(|| dir_size(&path, SIZE_MAX_ENTRIES));
        let state = if p.running { EntryState::Running } else { EntryState::Idle };
        entries.push(entry(&p.group_id, &p.bot_id, Some(p), kind, path, size, state));
    }
    for (group, bot, path) in managed_dirs(&home.join("workspaces")) {
        if claimed.contains(&real(&path)) {
            continue;
        }
        let pair = by_pair.get(&(&*group, &*bot)).copied();
        let state = if pair.is_some_and(|p| !p.removed) { EntryState::Unused } else { EntryState::Removed };
        let kind = if path.ends_with("_empty") { EntryKind::Empty } else { EntryKind::Managed };
        let size = Some(dir_size(&path, SIZE_MAX_ENTRIES));
        entries.push(entry(&group, &bot, pair, kind, path, size, state));
    }
    entries
}

fn entry(
    group: &str,
    bot: &str,
    pair: Option<&Pair>,
    kind: EntryKind,
    path: PathBuf,
    size: Option<u64>,
    state: EntryState,
) -> Entry {
    Entry {
        group_id: group.into(),
        group_name: pair.map(|p| p.group_name.clone()),
        dm: pair.is_some_and(|p| p.group_kind == "dm"),
        bot_id: bot.into(),
        bot_name: pair.map(|p| p.bot_name.clone()),
        kind,
        path,
        size,
        state,
    }
}

fn real(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn subdirs(dir: &Path) -> impl Iterator<Item = (String, PathBuf)> {
    std::fs::read_dir(dir).into_iter().flatten().flatten().filter_map(|e| {
        let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
        is_dir.then(|| (e.file_name().to_string_lossy().into_owned(), e.path()))
    })
}

/// `<root>/<group>/<bot>/<repo | _empty>` dirs; symlinks and interrupted clones (`*.partial`) are not workspaces.
fn managed_dirs(root: &Path) -> Vec<(String, String, PathBuf)> {
    let mut out = vec![];
    for (group, g) in subdirs(root) {
        for (bot, b) in subdirs(&g) {
            let leaves = subdirs(&b).filter(|(name, _)| !name.ends_with(".partial"));
            out.extend(leaves.map(|(_, path)| (group.clone(), bot.clone(), path)));
        }
    }
    out.sort_by(|a, b| a.2.cmp(&b.2));
    out
}

/// Apparent size of a tree without following symlinks, stopping after `max_entries`.
pub fn dir_size(path: &Path, max_entries: usize) -> u64 {
    let (mut total, mut seen, mut stack) = (0, 0, vec![path.to_path_buf()]);
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            seen += 1;
            if seen > max_entries {
                return total;
            }
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

/// Deletes a removed / unused managed workspace: never a /cd dir, an active one, or anything but a real dir at
/// `<home>/workspaces/<group>/<bot>/<leaf>`. Emptied bot and group dirs go too.
pub fn delete(home: &Path, entry: &Entry) -> Result<(), String> {
    if !entry.deletable() {
        return Err("只能删除已移出或未使用的托管工作区".into());
    }
    let inside = entry
        .path
        .strip_prefix(home.join("workspaces"))
        .is_ok_and(|rel| rel.components().count() == 3 && rel.components().all(|c| matches!(c, Component::Normal(_))));
    let is_dir = std::fs::symlink_metadata(&entry.path).is_ok_and(|m| m.is_dir());
    if !inside || !is_dir {
        return Err(format!("不是托管工作区目录：{}", entry.path.display()));
    }
    std::fs::remove_dir_all(&entry.path).map_err(|e| format!("删除失败：{e}"))?;
    for dir in entry.path.ancestors().skip(1).take(2) {
        if std::fs::remove_dir(dir).is_err() {
            break;
        }
    }
    Ok(())
}

/// A local backup under `<home>/backups` (overwritten local edits, interrupted leftovers); never uploaded.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    /// Relative to `<home>/backups`, e.g. `web-site/0923-1002`.
    pub name: String,
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

/// `<home>/backups/<scope>/<item>` plus loose files directly in `backups`, newest first.
pub fn backups(home: &Path) -> Vec<Backup> {
    let root = home.join("backups");
    let mut items = vec![];
    for e in std::fs::read_dir(&root).into_iter().flatten().flatten() {
        match e.file_type() {
            Ok(t) if t.is_dir() => {
                items.extend(std::fs::read_dir(e.path()).into_iter().flatten().flatten().map(|i| i.path()))
            }
            Ok(t) if t.is_file() => items.push(e.path()),
            _ => {}
        }
    }
    let mut out: Vec<Backup> = items
        .into_iter()
        .map(|path| {
            let meta = std::fs::symlink_metadata(&path).ok();
            let size = match &meta {
                Some(m) if m.is_dir() => dir_size(&path, SIZE_MAX_ENTRIES),
                Some(m) => m.len(),
                None => 0,
            };
            let name = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            Backup { name, size, modified: meta.and_then(|m| m.modified().ok()), path }
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    out
}

/// `412 MB`, `1.8 GB`: decimal units, like Finder.
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let (mut v, mut unit) = (bytes as f64, 0);
    while v >= 1000.0 && unit < UNITS.len() - 1 {
        v /= 1000.0;
        unit += 1;
    }
    if unit == 0 || v >= 100.0 { format!("{v:.0} {}", UNITS[unit]) } else { format!("{v:.1} {}", UNITS[unit]) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_forms_of_one_repo_normalize_equal() {
        let want = normalize_remote("git@github.com:team/repo.git");
        for url in [
            "ssh://git@github.com/team/repo",
            "ssh://git@github.com:22/team/repo.git",
            "https://github.com/team/repo/",
            "https://user@GitHub.com/team/repo.git",
            " git@github.com:team/repo ",
        ] {
            assert_eq!(normalize_remote(url), want, "{url}");
        }
        assert_ne!(normalize_remote("git@github.com:team/other.git"), want);
        assert_ne!(normalize_remote("git@gitlab.com:team/repo.git"), want);
    }

    #[test]
    fn local_remotes_compare_by_real_path() {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        std::fs::create_dir(&bare).unwrap();
        let plain = bare.to_string_lossy().into_owned();
        assert_eq!(normalize_remote(&format!("file://{plain}")), normalize_remote(&plain));
        assert_eq!(normalize_remote(&format!("file://{plain}/")), normalize_remote(&plain));
        assert_ne!(normalize_remote(&plain), normalize_remote(&dir.path().to_string_lossy()));
    }

    fn pair(group: &str, kind: WorkspaceKind, repo: Option<&str>) -> Pair {
        Pair {
            group_id: group.into(),
            group_name: format!("群 {group}"),
            group_kind: "group".into(),
            bot_id: "bw".into(),
            bot_name: "小王的 Claude".into(),
            kind,
            cd_path: None,
            repo_id: repo.map(Into::into),
            removed: false,
            running: false,
        }
    }

    fn file(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    /// pay: managed + running; data: /cd bound with its old managed clone left; old: removed; dm: repo-less, never
    /// run; gx: a dir the server no longer knows.
    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, Vec<Pair>) {
        let home = tempfile::tempdir().unwrap();
        let cd = tempfile::tempdir().unwrap();
        let ws = home.path().join("workspaces");
        file(&ws.join("pay/bw/r1/src/main.go"), 1000);
        file(&ws.join("pay/bw/r1.partial/x"), 5);
        file(&ws.join("data/bw/r2/a"), 300);
        file(&ws.join("old/bw/r3/a"), 2000);
        file(&ws.join("old/bw/r3/b/c"), 500);
        file(&ws.join("gx/by/_empty/notes.md"), 7);
        file(&cd.path().join("mine.go"), 10);
        let mut pay = pair("pay", WorkspaceKind::Managed, Some("r1"));
        pay.running = true;
        let mut data = pair("data", WorkspaceKind::Cd, Some("r2"));
        data.cd_path = Some(cd.path().to_string_lossy().into_owned());
        let mut old = pair("old", WorkspaceKind::Managed, None);
        old.removed = true;
        let mut dm = pair("dm", WorkspaceKind::Managed, None);
        dm.group_kind = "dm".into();
        (home, cd, vec![pay, data, old, dm])
    }

    #[test]
    fn lists_active_pairs_and_leftover_dirs_with_sizes() {
        let (home, cd, pairs) = fixture();
        let ws = home.path().join("workspaces");
        let rows: Vec<_> = list(home.path(), &pairs)
            .into_iter()
            .map(|e| (e.group_id.clone(), e.kind, e.path.clone(), e.size, e.state, e.deletable()))
            .collect();
        use EntryKind::*;
        use EntryState::*;
        assert_eq!(
            rows,
            vec![
                ("pay".into(), Managed, ws.join("pay/bw/r1"), Some(1000), Running, false),
                ("data".into(), Cd, cd.path().to_path_buf(), None, Idle, false),
                ("dm".into(), Empty, ws.join("dm/bw/_empty"), Some(0), Idle, false),
                ("data".into(), Managed, ws.join("data/bw/r2"), Some(300), Unused, true),
                ("gx".into(), Empty, ws.join("gx/by/_empty"), Some(7), Removed, true),
                ("old".into(), Managed, ws.join("old/bw/r3"), Some(2500), Removed, true),
            ]
        );
        let entries = list(home.path(), &pairs);
        let old = entries.iter().find(|e| e.group_id == "old").unwrap();
        assert_eq!((old.group_name.as_deref(), old.state_label()), (Some("群 old"), "已移出 · 2.5 KB".into()));
        assert_eq!(entries.iter().find(|e| e.group_id == "gx").unwrap().bot_name, None);
        assert!(entries.iter().find(|e| e.group_id == "dm").unwrap().dm);
        assert_eq!(entries[1].kind_label(), "/cd 绑定");
        assert!(old.matches("old/bw") && old.matches("群 old/小王的 Claude") && !old.matches("old"));
        let gx = entries.iter().find(|e| e.group_id == "gx").unwrap();
        assert_eq!((gx.group_label(), gx.bot_label()), ("gx".into(), "by"));
        assert_eq!(entries[2].group_label(), "私聊");
    }

    #[test]
    fn deletes_only_removed_or_unused_managed_dirs_and_never_cd_dirs() {
        let (home, cd, pairs) = fixture();
        let h = home.path();
        let entries = list(h, &pairs);
        let get = |g: &str, kind| entries.iter().find(|e| e.group_id == g && e.kind == kind).unwrap().clone();

        delete(h, &get("old", EntryKind::Managed)).unwrap();
        assert!(!h.join("workspaces/old").exists(), "emptied group/bot dirs are removed too");
        delete(h, &get("data", EntryKind::Managed)).unwrap();
        assert!(!h.join("workspaces/data").exists());

        assert!(delete(h, &get("pay", EntryKind::Managed)).is_err());
        let cd_entry = get("data", EntryKind::Cd);
        assert!(delete(h, &cd_entry).is_err());
        let forged = Entry { state: EntryState::Removed, kind: EntryKind::Managed, ..cd_entry };
        assert!(delete(h, &forged).unwrap_err().starts_with("不是托管工作区目录"));
        let escape = Entry { path: h.join("workspaces/pay/bw/../../../backups"), ..forged.clone() };
        assert!(delete(h, &escape).is_err());
        assert!(cd.path().join("mine.go").exists());
        assert!(h.join("workspaces/pay/bw/r1/src/main.go").exists());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(cd.path(), h.join("workspaces/gx/by/link")).unwrap();
            let link = Entry { path: h.join("workspaces/gx/by/link"), ..forged };
            assert!(delete(h, &link).is_err());
            assert!(cd.path().join("mine.go").exists());
        }
    }

    #[test]
    fn sizes_do_not_follow_symlinks_and_stop_at_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let big = tempfile::tempdir().unwrap();
        file(&big.path().join("huge"), 50_000);
        for i in 0..5 {
            file(&dir.path().join(format!("f{i}")), 10);
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(big.path(), dir.path().join("link")).unwrap();
        assert!(dir_size(dir.path(), 1000) < 1000);
        assert!(dir_size(dir.path(), 2) <= 20);
        assert_eq!(dir_size(&dir.path().join("missing"), 10), 0);
    }

    #[test]
    fn lists_local_backups_newest_first() {
        let home = tempfile::tempdir().unwrap();
        assert!(backups(home.path()).is_empty());
        file(&home.path().join("backups/web-site/0921-1540/a.tsx"), 40);
        file(&home.path().join("backups/g1/old.patch"), 12);
        let names: Vec<_> = backups(home.path()).into_iter().map(|b| (b.name, b.size)).collect();
        assert_eq!(names, vec![("g1/old.patch".into(), 12), ("web-site/0921-1540".into(), 40)]);
    }

    #[test]
    fn human_sizes() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(2500), "2.5 KB");
        assert_eq!(human_size(412_000_000), "412 MB");
        assert_eq!(human_size(1_800_000_000), "1.8 GB");
    }
}
