//! Per-(group, bot) workspaces (spec §4.2, §4.3): managed clones made with the owner's own git credentials, and /cd
//! bindings to the owner's existing directories. Also the directory picker and the desktop 工作区 page.
use crate::config::{Config, user_home};
use crate::git::{self, git};
use crate::protocol::{
    Answer, DaemonToServer, DirEntry, DirGit, DirResult, GitStatus, Question, QuestionType, RepoAccessReason, RepoSpec,
    RunStart, WorkspaceCd, WorkspaceEnsure, WorkspaceKind, WorkspaceSpec, WorkspaceState, WorkspaceStateKind,
};
use crate::repo::{self, normalize_remote};
use crate::service::Outbox;
use crate::session::{Shared, TurnReq};
use crate::t;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tokio::sync::{oneshot, watch};

/// `<home>/workspaces/<groupId>/<botId>/<repoId | _empty>/` — isolated per group, bot and repo (a new repo = new dir).
pub fn managed_path(home: &Path, group: &str, bot: &str, repo_id: Option<&str>) -> PathBuf {
    home.join("workspaces").join(group).join(bot).join(repo_id.unwrap_or("_empty"))
}

/// The directory a (group, bot) works in: the /cd directory, else the managed path.
pub fn workspace_dir(home: &Path, group: &str, bot: &str, spec: &WorkspaceSpec) -> PathBuf {
    match &spec.cd_path {
        Some(path) => PathBuf::from(path),
        None => managed_path(home, group, bot, spec.repo.as_ref().map(|r| &*r.id)),
    }
}

/// Serializes clones, /cd checks and run cwd resolution of one (group, bot).
type Locks = Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>;

pub struct Workspaces {
    home: PathBuf,
    locks: Locks,
    /// Turns in each real directory, across groups and bots sharing it (plan W10): one at a time unless the group
    /// confirmed running beside the others.
    dirs: Mutex<HashMap<PathBuf, watch::Sender<Vec<Holder>>>>,
}

#[derive(Clone)]
struct Holder {
    run_id: String,
    label: String,
}

/// Whether the answer to the shared-directory confirmation chose to run in parallel.
pub(crate) fn parallel(answers: &[Answer]) -> bool {
    answers.first().is_some_and(|a| a.choices == [0])
}

fn dir_question(dir: &Path, others: &[Holder]) -> Question {
    let names: Vec<_> = others.iter().map(|h| h.label.as_str()).collect();
    Question {
        id: "q1".into(),
        kind: QuestionType::Single,
        title: t!(
            "工作区 {dir} 正在被 {holders} 使用。改动范围不重叠时可以并行；改到同一文件会互相覆盖。现在就开始吗？",
            dir = dir.display(),
            holders = names.join(t!("、"))
        ),
        options: vec![t!("并行开始").into(), t!("排队等待").into()],
        recommended: Some(1),
    }
}

/// The shared-directory confirmation of a waiting turn.
enum Ask {
    Unasked,
    Pending(String, oneshot::Receiver<bool>),
    /// Answered, or nobody to ask: wait without asking again.
    Answered,
}

/// A turn's place in its directory, given up when dropped.
pub(crate) struct DirGuard {
    dir: watch::Sender<Vec<Holder>>,
    run_id: String,
}

impl Drop for DirGuard {
    fn drop(&mut self) {
        self.dir.send_modify(|h| h.retain(|x| x.run_id != self.run_id));
    }
}

/// A workspace that could not be set up; `reason` is set when the clone failed on repo access.
#[derive(Debug)]
struct Failed {
    reason: Option<RepoAccessReason>,
    message: String,
}

impl From<String> for Failed {
    fn from(message: String) -> Self {
        Failed { reason: None, message }
    }
}

/// Ready: the directory, its git status and (for /cd directories) its remote URLs.
type Outcome = Result<(PathBuf, Option<GitStatus>, Vec<String>), Failed>;

impl Workspaces {
    pub fn new(home: PathBuf) -> Self {
        Workspaces { home, locks: Mutex::default(), dirs: Mutex::default() }
    }

    /// Holds the turn's directory for its duration. A busy directory asks the group first: start beside the other
    /// turns now, or wait until it is free (also when nobody answers).
    pub(crate) async fn occupy(&self, req: &TurnReq, shared: &Shared) -> DirGuard {
        let key = req.cwd.canonicalize().unwrap_or_else(|_| req.cwd.clone());
        let dir = self.dirs.lock().unwrap().entry(key.clone()).or_insert_with(|| watch::Sender::new(vec![])).clone();
        let me = Holder {
            run_id: req.start.run_id.clone(),
            label: t!("{bot}（群「{group}」）", bot = req.start.bot.name, group = req.start.group_name),
        };
        let mut changed = dir.subscribe();
        let (mut ask, mut go) = (Ask::Unasked, false);
        loop {
            let mut others = vec![];
            let taken = dir.send_if_modified(|h| {
                if !go && !h.is_empty() {
                    others = h.clone();
                    return false;
                }
                h.push(me.clone());
                true
            });
            if taken {
                if let Ask::Pending(request_id, _) = &ask {
                    shared.withdraw(request_id, t!("工作区已空闲，开始运行"));
                }
                return DirGuard { dir, run_id: me.run_id };
            }
            if let Ask::Unasked = ask {
                ask = shared
                    .confirm_dir(dir_question(&key, &others))
                    .map_or(Ask::Answered, |(id, rx)| Ask::Pending(id, rx));
            }
            let decided = match &mut ask {
                Ask::Pending(_, rx) => tokio::select! {
                    _ = changed.changed() => None,
                    choice = rx => Some(choice.unwrap_or(false)),
                },
                _ => {
                    let _ = changed.changed().await;
                    None
                }
            };
            if let Some(choice) = decided {
                (ask, go) = (Ask::Answered, choice);
            }
        }
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
                match check_cd(&dir, req.repo.as_ref().filter(|_| !req.force)).await {
                    Ok(()) => match git::is_repo(&dir) {
                        true => Ok((dir.clone(), git::status(&dir, WorkspaceKind::Cd).await.ok(), remotes(&dir).await)),
                        false => Ok((dir, None, vec![])),
                    },
                    Err(e) => Err(e.into()),
                }
            }
        };
        reply(Some(outcome));
    }

    /// The directory a (group, bot) works in: the /cd directory, else the managed path.
    pub fn dir(&self, group: &str, bot: &str, spec: &WorkspaceSpec) -> PathBuf {
        workspace_dir(&self.home, group, bot, spec)
    }

    /// A run's cwd: the /cd directory, else the managed clone (re-cloned if it went missing), else `_empty`.
    pub async fn resolve(&self, start: &RunStart) -> Result<PathBuf, String> {
        if let Some(path) = &start.workspace.cd_path {
            let dir = PathBuf::from(path);
            return if dir.is_dir() { Ok(dir) } else { Err(t!("/cd 目录不存在：{path}", path = path)) };
        }
        let lock = self.lock(&start.group_id, &start.bot.id);
        let _guard = lock.lock().await;
        let dir =
            managed_path(&self.home, &start.group_id, &start.bot.id, start.workspace.repo.as_ref().map(|r| &*r.id));
        prepare(&dir, start.workspace.repo.as_ref(), || {}).await.map_err(|f| f.message)?;
        Ok(dir)
    }

    async fn managed(&self, group: &str, bot: &str, repo: Option<&RepoSpec>, on_clone: impl FnOnce()) -> Outcome {
        let dir = managed_path(&self.home, group, bot, repo.map(|r| &*r.id));
        prepare(&dir, repo, on_clone).await?;
        let git = match repo {
            Some(_) => git::status(&dir, WorkspaceKind::Managed).await.ok(),
            None => None,
        };
        Ok((dir, git, vec![]))
    }
}

/// `None` = still cloning.
fn report(out: &Outbox, group: &str, bot: &str, request_id: &str, outcome: Option<Outcome>) {
    let (state, path, git, error, reason, remotes) = match outcome {
        Some(Ok((dir, git, remotes))) => {
            (WorkspaceStateKind::Ready, Some(dir.to_string_lossy().into_owned()), git, None, None, remotes)
        }
        Some(Err(f)) => (WorkspaceStateKind::Failed, None, None, Some(f.message), f.reason, vec![]),
        None => (WorkspaceStateKind::Cloning, None, None, None, None, vec![]),
    };
    out.send(DaemonToServer::WorkspaceState(WorkspaceState {
        group_id: group.into(),
        bot_id: bot.into(),
        request_id: Some(request_id.into()),
        state,
        path,
        git,
        error,
        reason,
        remotes,
    }));
}

/// Makes `dir` a usable workspace: an existing clone is kept as is; anything else there is replaced by a fresh clone.
async fn prepare(dir: &Path, repo: Option<&RepoSpec>, on_clone: impl FnOnce()) -> Result<(), Failed> {
    let Some(repo) = repo else {
        let io = |e: std::io::Error| t!("无法创建工作区 {path}: {e}", path = dir.display(), e = e);
        return Ok(tokio::fs::create_dir_all(dir).await.map_err(io)?);
    };
    if is_clone_root(dir).await {
        // Clones made before autocrlf was enforced get it too (spec §12 risk 1).
        git(dir, &["config", "core.autocrlf", "false"]).await?;
    } else {
        on_clone();
        clone(dir, repo).await?;
    }
    init_submodules(dir).await;
    Ok(())
}

/// Checks out the submodules this clone never initialized (fresh clones, clones from before submodules were
/// supported), one at a time so a broken one doesn't hold back the rest. A failed one stays initialized, so later
/// runs don't retry it; the workspace works without it.
async fn init_submodules(dir: &Path) {
    for (name, path) in git::gitmodules(dir).await {
        if git(dir, &["config", "--get", &format!("submodule.{name}.url")]).await.is_ok() {
            continue;
        }
        let args = ["submodule", "update", "--init", "--recursive", "--", &path];
        if let Err(f) = repo::remote_git(dir, &args, None).await {
            tracing::warn!("submodule {path} of {} not checked out: {}", dir.display(), f.detail);
        }
    }
}

async fn is_clone_root(dir: &Path) -> bool {
    let Ok(top) = git(dir, &["rev-parse", "--show-toplevel"]).await else { return false };
    matches!((Path::new(top.trim()).canonicalize(), dir.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

/// Clones next to the target and renames, so an interrupted clone never looks like a valid workspace. Tries the
/// owner's preferred protocol first, then the other one; the URL that worked becomes `origin`.
async fn clone(dir: &Path, repo: &RepoSpec) -> Result<(), Failed> {
    let parent = dir.parent().expect("managed paths have a parent");
    let partial = dir.with_extension("partial");
    let io = |e: std::io::Error| t!("无法创建工作区 {path}: {e}", path = dir.display(), e = e);
    tokio::fs::create_dir_all(parent).await.map_err(io)?;
    if dir.exists() {
        tokio::fs::remove_dir_all(dir).await.map_err(io)?;
    }
    let target = partial.to_string_lossy();
    let mut first = None;
    for url in repo::candidates(&repo.url, repo.protocol) {
        if partial.exists() {
            tokio::fs::remove_dir_all(&partial).await.map_err(io)?;
        }
        let args = ["clone", "-q", "-c", "core.autocrlf=false", "--branch", &repo.branch, "--", &url, &target];
        match repo::remote_git(parent, &args, None).await {
            Ok(_) => return Ok(tokio::fs::rename(&partial, dir).await.map_err(io)?),
            // The repo answered, so the other protocol would not find the branch either.
            Err(f) if f.reason == RepoAccessReason::BranchMissing => {
                first = Some(f);
                break;
            }
            Err(f) => {
                first.get_or_insert(f);
            }
        }
    }
    let _ = tokio::fs::remove_dir_all(&partial).await;
    let f = first.expect("candidates is never empty");
    Err(Failed { reason: Some(f.reason), message: t!("clone 失败：{detail}", detail = f.detail) })
}

/// /cd target must be an absolute, existing, usable directory; with a group repo also a work tree of that repo.
async fn check_cd(dir: &Path, repo: Option<&RepoSpec>) -> Result<(), String> {
    existing_dir(dir)?;
    if let Some(why) = unusable(dir) {
        return Err(why);
    }
    let Some(repo) = repo else { return Ok(()) };
    if !git(dir, &["rev-parse", "--is-inside-work-tree"]).await.is_ok_and(|s| s.trim() == "true") {
        return Err(t!("不是 git 仓库").into());
    }
    let urls = remotes(dir).await;
    let want = normalize_remote(&repo.url);
    if urls.iter().any(|u| normalize_remote(u) == want) {
        return Ok(());
    }
    let found = if urls.is_empty() { t!("无 remote").into() } else { urls.join(t!("、")) };
    Err(t!("remote 与群仓库不一致（{found}）", found = found))
}

fn existing_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err(t!("需要本机绝对路径").into());
    }
    if !dir.is_dir() {
        return Err(t!("目录不存在").into());
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
        return Some(t!("目录范围过大，请选择具体的项目目录").into());
    }
    SYSTEM_DIRS.iter().any(|d| real.starts_with(d)).then(|| t!("不能使用系统目录").into())
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
    let res = crate::tls::http()?.get(url).bearer_auth(&config.token).send().await?;
    Ok(crate::bots::ok(res).await?.json().await?)
}

/// 改回托管: the server treats it as `/cd @bot --reset` from the bot owner.
pub async fn reset_cd(config: &Config, group: &str, bot: &str) -> anyhow::Result<()> {
    let url = format!("{}/api/daemon/workspaces/{group}/{bot}/reset-cd", config.server.trim_end_matches('/'));
    let res = crate::tls::http()?.post(url).bearer_auth(&config.token).send().await?;
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
            (_, true) => t!("私聊").into(),
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
            EntryKind::Managed => t!("托管"),
            EntryKind::Empty => t!("托管 · 无仓库"),
            EntryKind::Cd => t!("本机目录"),
        }
    }

    pub fn state_label(&self) -> String {
        let size = self.size.map(|s| format!(" · {}", human_size(s))).unwrap_or_default();
        match self.state {
            EntryState::Running => t!("运行中").into(),
            EntryState::Idle => t!("空闲").into(),
            EntryState::Removed => t!("已移出{size}", size = size),
            EntryState::Unused => t!("未使用{size}", size = size),
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
        return Err(t!("只能删除已移出或未使用的托管工作区").into());
    }
    let inside = entry
        .path
        .strip_prefix(home.join("workspaces"))
        .is_ok_and(|rel| rel.components().count() == 3 && rel.components().all(|c| matches!(c, Component::Normal(_))));
    let is_dir = std::fs::symlink_metadata(&entry.path).is_ok_and(|m| m.is_dir());
    if !inside || !is_dir {
        return Err(t!("不是托管工作区目录：{path}", path = entry.path.display()));
    }
    std::fs::remove_dir_all(&entry.path).map_err(|e| t!("删除失败：{e}", e = e))?;
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
        assert_eq!(entries[1].kind_label(), "本机目录");
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
