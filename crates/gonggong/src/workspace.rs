//! Per-(group, bot) workspaces (spec §4.2, §4.3): managed clones made with the owner's own git credentials, and /cd
//! bindings to the owner's existing directories. Also the directory picker and the desktop 工作区 page.
use crate::config::{Config, user_home};
use crate::git::{self, git};
use crate::protocol::{
    Answer, DaemonToServer, DirEntry, DirGit, DirPlace, DirPlaceKind, DirResult, GitStatus, Question, QuestionType,
    RepoAccessReason, RepoFind, RepoFound, RepoSpec, RunStart, ServerToDaemon, WorkspaceCd, WorkspaceEnsure,
    WorkspaceKind, WorkspaceSpec, WorkspaceState, WorkspaceStateKind,
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
/// A repo's clone sits one level below, see `managed_path`.
pub fn managed_root(home: &Path, group: &str, bot: &str, repo_id: Option<&str>) -> PathBuf {
    home.join("workspaces").join(group).join(bot).join(repo_id.unwrap_or("_empty"))
}

/// Where the managed workspace goes: `<repoId>/<repo name>/` (named like a clone of one's own), or `_empty/`.
pub fn managed_path(home: &Path, group: &str, bot: &str, repo: Option<&RepoSpec>) -> PathBuf {
    let root = managed_root(home, group, bot, repo.map(|r| &*r.id));
    match repo {
        Some(r) => root.join(repo_name(&r.url)),
        None => root,
    }
}

/// The last path segment of a repo URL (https, ssh, scp-like or local path) without `.git`, in safe characters only;
/// `repo` when nothing usable is left.
pub fn repo_name(url: &str) -> String {
    let path = url.trim_end_matches(['/', '\\']);
    let last = path.rsplit(['/', '\\', ':']).next().unwrap_or_default();
    let last = last.strip_suffix(".git").unwrap_or(last);
    let name: String = last.chars().filter(|c| c.is_ascii_alphanumeric() || "._-".contains(*c)).collect();
    if name.trim_start_matches('.').is_empty() { "repo".into() } else { name }
}

/// A clone made before workspaces were named after their repo: the clone root is `<repoId>/` itself.
fn legacy_clone(root: &Path) -> bool {
    root.join(".git").exists()
}

/// The managed workspace as it is on disk now: a clone in the old layout until it is moved (see `migrate`).
fn current_path(home: &Path, group: &str, bot: &str, repo: Option<&RepoSpec>) -> PathBuf {
    let root = managed_root(home, group, bot, repo.map(|r| &*r.id));
    if repo.is_some() && legacy_clone(&root) { root } else { managed_path(home, group, bot, repo) }
}

/// The clone under `<repoId>/` when only its id is known (force sync): `<repoId>/` itself in the old layout, else
/// its one clone below.
pub fn managed_clone(home: &Path, group: &str, bot: &str, repo_id: Option<&str>) -> PathBuf {
    let root = managed_root(home, group, bot, repo_id);
    if repo_id.is_none() { root } else { clone_in(&root) }
}

/// The directory a (group, bot) works in: the /cd directory, else the managed workspace.
pub fn workspace_dir(home: &Path, group: &str, bot: &str, spec: &WorkspaceSpec) -> PathBuf {
    match &spec.cd_path {
        Some(path) => PathBuf::from(path),
        None => current_path(home, group, bot, spec.repo.as_ref()),
    }
}

/// Serializes clones and run cwd resolution of one (group, bot).
type Locks = Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>;
type Requests = Mutex<HashMap<(String, String), watch::Sender<bool>>>;

pub struct Workspaces {
    home: PathBuf,
    locks: Locks,
    requests: Requests,
    /// Turns in each real directory, across groups and bots sharing it (plan W10): one at a time unless the group
    /// confirmed running beside the others.
    dirs: Mutex<HashMap<PathBuf, watch::Sender<Vec<Holder>>>>,
}

#[derive(Clone)]
struct Holder {
    run_id: String,
    label: String,
    /// A manual git action: turns wait for it without offering to run beside it.
    exclusive: bool,
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
        option_meta: vec![],
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
    cancelled: bool,
}

impl From<String> for Failed {
    fn from(message: String) -> Self {
        Failed { reason: None, message, cancelled: false }
    }
}

impl Failed {
    fn cancelled() -> Self {
        Failed { reason: None, message: String::new(), cancelled: true }
    }
}

/// Ready: the directory, its git status and (for /cd directories) its remote URLs.
type Outcome = Result<(PathBuf, Option<GitStatus>, Vec<String>), Failed>;

impl Workspaces {
    pub fn new(home: PathBuf) -> Self {
        Workspaces { home, locks: Mutex::default(), requests: Mutex::default(), dirs: Mutex::default() }
    }

    /// Holds the turn's directory for its duration. A busy directory asks the group first: start beside the other
    /// turns now, or wait until it is free (also when nobody answers). None: the turn was cancelled while waiting.
    pub(crate) async fn occupy(&self, req: &TurnReq, shared: &Shared) -> Option<DirGuard> {
        let key = req.cwd.canonicalize().unwrap_or_else(|_| req.cwd.clone());
        let dir = self.dirs.lock().unwrap().entry(key.clone()).or_insert_with(|| watch::Sender::new(vec![])).clone();
        let me = Holder {
            run_id: req.start.run_id.clone(),
            label: t!("{bot}（群「{group}」）", bot = req.start.bot.name, group = req.start.group_name),
            exclusive: false,
        };
        let mut changed = dir.subscribe();
        let (mut ask, mut go) = (Ask::Unasked, false);
        loop {
            if shared.is_cancelled(&me.run_id) {
                if let Ask::Pending(request_id, _) = &ask {
                    shared.withdraw(request_id, t!("已停止，不再等待工作区空闲"));
                }
                return None;
            }
            let mut others = vec![];
            let taken = dir.send_if_modified(|h| {
                if !h.is_empty() && (!go || h.iter().any(|x| x.exclusive)) {
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
                touch_used(&self.home, &req.cwd);
                return Some(DirGuard { dir, run_id: me.run_id });
            }
            if let Ask::Unasked = ask
                && !others.iter().any(|h| h.exclusive)
            {
                ask = shared
                    .confirm_dir(dir_question(&key, &others))
                    .map_or(Ask::Answered, |(id, rx)| Ask::Pending(id, rx));
            }
            let decided = match &mut ask {
                Ask::Pending(_, rx) => tokio::select! {
                    _ = changed.changed() => None,
                    choice = rx => Some(choice.unwrap_or(false)),
                    _ = shared.cancel_signal() => None,
                },
                _ => tokio::select! {
                    _ = changed.changed() => None,
                    _ = shared.cancel_signal() => None,
                },
            };
            if let Some(choice) = decided {
                (ask, go) = (Ask::Answered, choice);
            }
        }
    }

    /// Holds `dir` for a manual git action if no turn is in it (None = busy): turns arriving meanwhile wait for the
    /// guard to drop.
    pub(crate) fn hold(&self, dir: &Path, id: &str) -> Option<DirGuard> {
        let key = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        let dir = self.dirs.lock().unwrap().entry(key).or_insert_with(|| watch::Sender::new(vec![])).clone();
        let me = Holder { run_id: format!("git:{id}"), label: t!("手动 Git 操作").into(), exclusive: true };
        let run_id = me.run_id.clone();
        let taken = dir.send_if_modified(|h| {
            if !h.is_empty() {
                return false;
            }
            h.push(me);
            true
        });
        taken.then_some(DirGuard { dir, run_id })
    }

    fn lock(&self, group: &str, bot: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().unwrap().entry((group.into(), bot.into())).or_default().clone()
    }

    /// The newest workspace request wins. In particular, /cd cancels a clone instead of waiting behind its lock.
    fn begin(&self, group: &str, bot: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        let previous = self.requests.lock().unwrap().insert((group.into(), bot.into()), tx);
        if let Some(previous) = previous {
            previous.send_replace(true);
        }
        rx
    }

    /// workspace.ensure: reports `cloning` only when a clone is actually needed, then `ready` / `failed`.
    pub async fn ensure(&self, req: WorkspaceEnsure, out: &Outbox) {
        let mut cancel = self.begin(&req.group_id, &req.bot_id);
        let lock = self.lock(&req.group_id, &req.bot_id);
        let _guard = tokio::select! {
            _ = cancelled(&mut cancel) => return,
            guard = lock.lock() => guard,
        };
        let reply = |outcome| report(out, &req.group_id, &req.bot_id, &req.request_id, outcome);
        let (group, bot, extras) = (&req.group_id, &req.bot_id, &req.extra_repos);
        let outcome = self.managed(group, bot, req.repo.as_ref(), extras, || reply(None), &mut cancel).await;
        reply(Some(outcome));
    }

    /// workspace.cd: bind to a validated local directory, or go back to the managed workspace (`path: None`).
    pub async fn cd(&self, req: WorkspaceCd, out: &Outbox) {
        let mut cancel = self.begin(&req.group_id, &req.bot_id);
        let reply = |outcome| report(out, &req.group_id, &req.bot_id, &req.request_id, outcome);
        let outcome = match &req.path {
            None => {
                let lock = self.lock(&req.group_id, &req.bot_id);
                let _guard = tokio::select! {
                    _ = cancelled(&mut cancel) => return,
                    guard = lock.lock() => guard,
                };
                self.managed(&req.group_id, &req.bot_id, req.repo.as_ref(), &[], || reply(None), &mut cancel).await
            }
            Some(path) => {
                let dir = PathBuf::from(path);
                match check_cd(&dir, req.repo.as_ref().filter(|_| !req.force)).await {
                    Ok(()) => {
                        // A non-git dir still reports the repos below it.
                        let status = git::status(&dir, &[], WorkspaceKind::Cd).await.ok();
                        let remotes = if git::is_repo(&dir) { remotes(&dir).await } else { vec![] };
                        Ok((dir, status, remotes))
                    }
                    Err(e) => Err(e.into()),
                }
            }
        };
        reply(Some(outcome));
    }

    /// repo.find: the owner's local clones of the group repo, and where a managed clone would go instead.
    pub async fn find(&self, req: RepoFind) -> RepoFound {
        let managed = managed_path(&self.home, &req.group_id, &req.bot_id, Some(&req.repo));
        let want = normalize_remote(&req.repo.url);
        let paths = tokio::task::spawn_blocking(move || find_clones(&user_home(), &want)).await.unwrap_or_default();
        RepoFound {
            request_id: req.request_id,
            managed_path: managed.to_string_lossy().into_owned(),
            paths: paths.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        }
    }

    /// The directory a (group, bot) works in: the /cd directory, else the managed path.
    pub fn dir(&self, group: &str, bot: &str, spec: &WorkspaceSpec) -> PathBuf {
        workspace_dir(&self.home, group, bot, spec)
    }

    /// A run's cwd: the /cd directory, else the managed clone (re-cloned if it went missing), else `_empty`. The
    /// group's extra repos are cloned too where they went missing.
    pub async fn resolve(&self, start: &RunStart) -> Result<PathBuf, String> {
        let (group, bot, spec) = (&start.group_id, &start.bot.id, &start.workspace);
        let lock = self.lock(group, bot);
        let _guard = lock.lock().await;
        let (_cancel, mut cancelled) = watch::channel(false);
        self.extras(group, bot, &spec.extra_repos, &mut || {}, &mut cancelled).await.map_err(|f| f.message)?;
        if let Some(path) = &spec.cd_path {
            let dir = PathBuf::from(path);
            return if dir.is_dir() { Ok(dir) } else { Err(t!("/cd 目录不存在：{path}", path = path)) };
        }
        let dir = self.settle(group, bot, spec.repo.as_ref()).await?;
        prepare(&dir, spec.repo.as_ref(), || {}, &mut cancelled).await.map_err(|f| f.message)?;
        Ok(dir)
    }

    async fn managed(
        &self,
        group: &str,
        bot: &str,
        repo: Option<&RepoSpec>,
        extra_repos: &[RepoSpec],
        on_clone: impl Fn() + Send + Sync,
        cancel: &mut watch::Receiver<bool>,
    ) -> Outcome {
        let dir = self.settle(group, bot, repo).await?;
        prepare(&dir, repo, &on_clone, cancel).await?;
        let extras = self.extras(group, bot, extra_repos, &mut || on_clone(), cancel).await?;
        let git = match repo {
            Some(_) => git::status(&dir, &extras, WorkspaceKind::Managed).await.ok(),
            None => None,
        };
        Ok((dir, git, vec![]))
    }

    /// Clones the group's extra repos that are missing (existing clones are kept as they are), each to its own
    /// managed path beside the repo's.
    async fn extras(
        &self,
        group: &str,
        bot: &str,
        repos: &[RepoSpec],
        on_clone: &mut (dyn FnMut() + Send),
        cancel: &mut watch::Receiver<bool>,
    ) -> Result<Vec<PathBuf>, Failed> {
        let mut dirs = vec![];
        for repo in repos {
            let dir = managed_path(&self.home, group, bot, Some(repo));
            prepare(&dir, Some(repo), &mut *on_clone, cancel).await.map_err(|f| Failed {
                message: t!("附加仓库 {name}：{e}", name = repo_name(&repo.url), e = f.message),
                ..f
            })?;
            dirs.push(dir);
        }
        Ok(dirs)
    }

    /// Adds the managed clones of the group's extra repos to the additional directories of a message that uses them,
    /// so everything downstream (the session, git, diffs, permission rules) treats them like the owner's own.
    pub fn expand(&self, msg: &mut ServerToDaemon) {
        let (group, bot, spec) = match msg {
            ServerToDaemon::RunStart(s) => (&s.group_id, &s.bot.id, &mut s.workspace),
            ServerToDaemon::GitRefs(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitLog(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitShow(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitChanges(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitBlame(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitStashes(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitConflict(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitTree(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitRead(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitCompare(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitDiff(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitRefresh(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::GitAction(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            ServerToDaemon::WorkspaceDiff(r) => (&r.group_id, &r.bot_id, &mut r.workspace),
            _ => return,
        };
        for repo in &spec.extra_repos {
            let dir = managed_path(&self.home, group, bot, Some(repo)).to_string_lossy().into_owned();
            if !spec.extra_dirs.contains(&dir) {
                spec.extra_dirs.push(dir);
            }
        }
    }
}

impl Workspaces {
    /// The managed workspace to use, under the (group, bot) lock: a clone in the old layout is moved to
    /// `<repoId>/<repo name>/` first, unless a turn is still running in it (then it is moved by a later one).
    async fn settle(&self, group: &str, bot: &str, repo: Option<&RepoSpec>) -> Result<PathBuf, String> {
        let root = managed_root(&self.home, group, bot, repo.map(|r| &*r.id));
        let dir = managed_path(&self.home, group, bot, repo);
        if repo.is_none() {
            return Ok(dir);
        }
        let busy = |p: &Path| {
            let key = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
            self.dirs.lock().unwrap().get(&key).is_some_and(|h| !h.borrow().is_empty())
        };
        if legacy_clone(&root) && busy(&root) {
            return Ok(root);
        }
        migrate(&root, &dir).await.map_err(|e| t!("无法移动工作区 {path}: {e}", path = root.display(), e = e))?;
        Ok(dir)
    }
}

/// Moves a clone in the old layout (`<repoId>/` itself) to `<repoId>/<name>/` by renames only, so local changes,
/// branches and stashes stay: `<repoId>` → `<repoId>.moving`, a new `<repoId>/`, then `.moving` → `<repoId>/<name>`.
/// An interrupted move is completed the next time.
async fn migrate(root: &Path, dir: &Path) -> std::io::Result<()> {
    let moving = root.with_extension("moving");
    if !tokio::fs::try_exists(&moving).await? {
        if !legacy_clone(root) || tokio::fs::try_exists(dir).await? {
            return Ok(());
        }
        tokio::fs::rename(root, &moving).await?;
    }
    tokio::fs::create_dir_all(root).await?;
    if tokio::fs::try_exists(dir).await? {
        return Ok(());
    }
    tokio::fs::rename(&moving, dir).await
}

/// An unrequested workspace.state with the git status of `dir` as it is now, so the group sees a manual git action.
pub(crate) async fn report_git(out: &Outbox, group: &str, bot: &str, spec: &WorkspaceSpec, dir: &Path) {
    let (kind, remotes) = match spec.cd_path {
        Some(_) => (WorkspaceKind::Cd, remotes(dir).await),
        None => (WorkspaceKind::Managed, vec![]),
    };
    let extras: Vec<PathBuf> = spec.extra_dirs.iter().map(PathBuf::from).filter(|d| d.is_dir()).collect();
    let status = git::status(dir, &extras, kind).await.ok();
    send_state(out, group, bot, None, Some(Ok((dir.to_path_buf(), status, remotes))));
}

/// `None` = still cloning.
fn report(out: &Outbox, group: &str, bot: &str, request_id: &str, outcome: Option<Outcome>) {
    send_state(out, group, bot, Some(request_id), outcome)
}

fn send_state(out: &Outbox, group: &str, bot: &str, request_id: Option<&str>, outcome: Option<Outcome>) {
    let (state, path, git, error, reason, remotes) = match outcome {
        Some(Err(Failed { cancelled: true, .. })) => return,
        Some(Ok((dir, git, remotes))) => {
            (WorkspaceStateKind::Ready, Some(dir.to_string_lossy().into_owned()), git, None, None, remotes)
        }
        Some(Err(f)) => (WorkspaceStateKind::Failed, None, None, Some(f.message), f.reason, vec![]),
        None => (WorkspaceStateKind::Cloning, None, None, None, None, vec![]),
    };
    out.send(DaemonToServer::WorkspaceState(WorkspaceState {
        group_id: group.into(),
        bot_id: bot.into(),
        request_id: request_id.map(String::from),
        state,
        path,
        git,
        error,
        reason,
        remotes,
    }));
}

/// Makes `dir` a usable workspace: an existing clone is kept as is; anything else there is replaced by a fresh clone.
async fn prepare(
    dir: &Path,
    repo: Option<&RepoSpec>,
    on_clone: impl FnOnce(),
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), Failed> {
    let Some(repo) = repo else {
        let io = |e: std::io::Error| t!("无法创建工作区 {path}: {e}", path = dir.display(), e = e);
        return Ok(tokio::fs::create_dir_all(dir).await.map_err(io)?);
    };
    if is_clone_root(dir).await {
        // Clones made before autocrlf was enforced get it too (spec §12 risk 1). Every turn passes here: only an
        // actual change rewrites .git/config, which the agent's own git commands may be reading or locking.
        let current = git(dir, &["config", "--local", "--get", "core.autocrlf"]).await.unwrap_or_default();
        if current.trim() != "false" {
            git(dir, &["config", "core.autocrlf", "false"]).await?;
        }
    } else {
        on_clone();
        clone(dir, repo, cancel).await?;
    }
    init_submodules(dir, cancel).await?;
    Ok(())
}

/// Checks out the submodules this clone never initialized (fresh clones, clones from before submodules were
/// supported), one at a time so a broken one doesn't hold back the rest. A failed one stays initialized, so later
/// runs don't retry it; the workspace works without it.
async fn init_submodules(dir: &Path, cancel: &mut watch::Receiver<bool>) -> Result<(), Failed> {
    for (name, path) in git::gitmodules(dir).await {
        if git(dir, &["config", "--get", &format!("submodule.{name}.url")]).await.is_ok() {
            continue;
        }
        let args = ["submodule", "update", "--init", "--recursive", "--", &path];
        let result = tokio::select! {
            _ = cancelled(cancel) => return Err(Failed::cancelled()),
            result = repo::remote_git(dir, &args, None) => result,
        };
        if let Err(f) = result {
            tracing::warn!("submodule {path} of {} not checked out: {}", dir.display(), f.detail);
        }
    }
    Ok(())
}

async fn is_clone_root(dir: &Path) -> bool {
    let Ok(top) = git(dir, &["rev-parse", "--show-toplevel"]).await else { return false };
    matches!((Path::new(top.trim()).canonicalize(), dir.canonicalize()), (Ok(a), Ok(b)) if a == b)
}

/// Clones next to the target and renames, so an interrupted clone never looks like a valid workspace. Tries the
/// owner's preferred protocol first, then the other one; the URL that worked becomes `origin`.
async fn clone(dir: &Path, repo: &RepoSpec, cancel: &mut watch::Receiver<bool>) -> Result<(), Failed> {
    let parent = dir.parent().expect("managed paths have a parent");
    let mut partial = dir.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
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
        let result = tokio::select! {
            _ = cancelled(cancel) => {
                let _ = tokio::fs::remove_dir_all(&partial).await;
                return Err(Failed::cancelled());
            }
            result = repo::remote_git(parent, &args, None) => result,
        };
        match result {
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
    Err(Failed { reason: Some(f.reason), message: t!("clone 失败：{detail}", detail = f.detail), cancelled: false })
}

async fn cancelled(cancel: &mut watch::Receiver<bool>) {
    while !*cancel.borrow_and_update() {
        if cancel.changed().await.is_err() {
            return;
        }
    }
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

/// Bounds of the repo.find walk: deep enough for `~/Documents/code/<repo>`, cheap enough to answer in a moment.
const FIND_DEPTH: usize = 4;
const FIND_MAX_DIRS: usize = 20_000;
const FIND_SKIP: [&str; 9] =
    ["node_modules", "target", "dist", "build", "vendor", "Library", "Applications", "Pictures", "Movies"];

/// Work trees under `root` whose origin is `want` (a normalized remote); hidden dirs (the managed clones under
/// `~/.gonggong` among them) and other work trees are not descended into.
fn find_clones(root: &Path, want: &str) -> Vec<PathBuf> {
    let mut found = vec![];
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0)]);
    let mut seen = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        seen += 1;
        if seen > FIND_MAX_DIRS {
            break;
        }
        if dir.join(".git").is_dir() {
            if origin_of(&dir).is_some_and(|url| normalize_remote(&url) == want) {
                found.push(dir);
            }
            continue;
        }
        if depth == FIND_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let name = e.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || FIND_SKIP.contains(&&*name) {
                continue;
            }
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                queue.push_back((e.path(), depth + 1));
            }
        }
    }
    found
}

/// `remote.origin.url` read from `.git/config` directly: spawning git for every repo would make the walk slow.
fn origin_of(dir: &Path) -> Option<String> {
    let config = std::fs::read_to_string(dir.join(".git/config")).ok()?;
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == r#"[remote "origin"]"#;
        } else if in_origin
            && let Some((key, value)) = line.split_once('=')
            && key.trim() == "url"
        {
            return Some(value.trim().to_string());
        }
    }
    None
}

/// A bare drive like `D:` means the drive's current directory to Windows, not its root.
fn drive_root(mut path: String) -> String {
    if cfg!(windows) && path.len() == 2 && path.ends_with(':') {
        path.push('\\');
    }
    path
}

#[cfg(windows)]
fn fs_roots() -> Vec<String> {
    // GetLogicalDrives only reads a bitmask, so a disconnected network drive cannot stall the listing.
    let mask = unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() };
    (b'A'..=b'Z').filter(|l| mask & (1 << (l - b'A')) != 0).map(|l| format!("{}:\\", l as char)).collect()
}

#[cfg(not(windows))]
fn fs_roots() -> Vec<String> {
    vec!["/".into()]
}

/// dir.list for the workspace picker: subdirectories of `path` (home when None) and the repo containing it.
pub async fn browse(request_id: String, path: Option<String>, hidden: bool) -> DirResult {
    let dir = path.map(drive_root).map(PathBuf::from).unwrap_or_else(user_home);
    let mut result = DirResult {
        request_id,
        path: dir.to_string_lossy().into_owned(),
        entries: vec![],
        git: None,
        unusable: None,
        roots: fs_roots(),
        places: vec![],
        can_create: true,
        error: None,
    };
    result.places = tokio::task::spawn_blocking(places).await.unwrap_or_default();
    if let Err(e) = existing_dir(&dir) {
        result.error = Some(e);
        return result;
    }
    let listed = dir.clone();
    result.entries = tokio::task::spawn_blocking(move || picker_entries(&listed, hidden)).await.unwrap_or_default();
    if let Ok(root) = git(&dir, &["rev-parse", "--show-toplevel"]).await {
        let branch = git(&dir, &["symbolic-ref", "--short", "-q", "HEAD"]).await.ok().map(|b| b.trim().to_string());
        result.git = Some(DirGit { root: root.trim().into(), remotes: remotes(&dir).await, branch });
    }
    result.unusable = unusable(&dir);
    result
}

/// The first DIR_LIST_MAX subdirectories by name (dot-directories only when `hidden`); only those are probed for a repo. The entry type comes with
/// the listing on most file systems, so only symlinks cost a stat to tell whether they lead to a directory.
fn picker_entries(dir: &Path, hidden: bool) -> Vec<DirEntry> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut dirs: Vec<(String, PathBuf)> = rd
        .flatten()
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e)))
        .filter(|(name, _)| hidden || !name.starts_with('.'))
        .filter(|(_, e)| e.file_type().is_ok_and(|t| t.is_dir() || t.is_symlink() && e.path().is_dir()))
        .map(|(name, e)| (name, e.path()))
        .collect();
    dirs.sort_by_key(|(name, _)| name.to_lowercase());
    dirs.truncate(DIR_LIST_MAX);
    dirs.into_iter()
        .map(|(name, path)| {
            let modified = path.metadata().and_then(|m| m.modified()).ok().and_then(ms);
            DirEntry { git: git::is_repo(&path), name, modified }
        })
        .collect()
}

fn ms(at: SystemTime) -> Option<u64> {
    Some(at.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// The picker's sidebar: the user's own folders, then mounted volumes, like Finder / Explorer.
fn places() -> Vec<DirPlace> {
    let mut out = user_places(&user_home());
    #[cfg(windows)]
    out.extend(fs_roots().into_iter().map(|r| place(DirPlaceKind::Volume, r.trim_end_matches('\\').into(), r)));
    #[cfg(target_os = "macos")]
    out.extend(volumes(Path::new("/Volumes")));
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        out.extend(volumes(Path::new("/mnt")));
        let user = user_home().file_name().map(|n| Path::new("/media").join(n));
        out.extend(user.map(|m| volumes(&m)).unwrap_or_default());
    }
    out
}

fn place(kind: DirPlaceKind, name: String, path: String) -> DirPlace {
    DirPlace { kind, name, path }
}

/// Home, Desktop, Documents and Downloads where they exist (on Windows also redirected into OneDrive).
fn user_places(home: &Path) -> Vec<DirPlace> {
    let mut out = vec![];
    if home.is_dir() {
        let name = home.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        out.push(place(DirPlaceKind::Home, name, home.to_string_lossy().into_owned()));
    }
    for (kind, dir) in [
        (DirPlaceKind::Desktop, "Desktop"),
        (DirPlaceKind::Documents, "Documents"),
        (DirPlaceKind::Downloads, "Downloads"),
    ] {
        let found = [home.join(dir), home.join("OneDrive").join(dir)].into_iter().find(|p| p.is_dir());
        if let Some(p) = found {
            out.push(place(kind, dir.into(), p.to_string_lossy().into_owned()));
        }
    }
    out
}

/// Mounted volumes under `root`, by name; symlinks (the boot volume in /Volumes points at `/`) are skipped.
#[cfg(unix)]
fn volumes(root: &Path) -> Vec<DirPlace> {
    let mut out: Vec<DirPlace> = subdirs(root)
        // Time Machine's local snapshots and similar system mounts, hidden by Finder too.
        .filter(|(name, _)| !name.starts_with('.') && !name.starts_with("com.apple."))
        .map(|(name, p)| place(DirPlaceKind::Volume, name, p.to_string_lossy().into_owned()))
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// dir.create for the picker's 新建文件夹: `name` must be one plain path segment, made directly in `parent`.
pub fn create_dir(parent: String, name: &str) -> Result<String, String> {
    let parent = PathBuf::from(drive_root(parent));
    existing_dir(&parent)?;
    let name = name.trim();
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.chars().any(|c| c == '/' || c == '\\' || c.is_control() || cfg!(windows) && ":*?\"<>|".contains(c));
    if bad {
        return Err(t!("文件夹名称不合法").into());
    }
    let path = parent.join(name);
    std::fs::create_dir(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => t!("已有同名文件或文件夹").to_string(),
        _ => t!("无法新建文件夹：{e}", e = e),
    })?;
    Ok(path.to_string_lossy().into_owned())
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
    /// The group's extra repos, cloned beside the repo.
    #[serde(default)]
    pub extra_repo_ids: Vec<String>,
    pub removed: bool,
    pub running: bool,
}

pub async fn fetch_pairs(config: &Config) -> anyhow::Result<Vec<Pair>> {
    let url = format!("{}/api/daemon/workspaces", config.server.trim_end_matches('/'));
    let res = crate::tls::http(config)?.get(url).bearer_auth(&config.token).send().await?;
    Ok(crate::bots::ok(res).await?.json().await?)
}

/// 改回托管: the server treats it as `/cd @bot --reset` from the bot owner.
pub async fn reset_cd(config: &Config, group: &str, bot: &str) -> anyhow::Result<()> {
    let url = format!("{}/api/daemon/workspaces/{group}/{bot}/reset-cd", config.server.trim_end_matches('/'));
    let res = crate::tls::http(config)?.post(url).bearer_auth(&config.token).send().await?;
    crate::bots::ok(res).await.map(drop)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    Managed,
    /// Managed dir of a group without a repo (`_empty`).
    Empty,
    Cd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// When a turn last started in it (ms since epoch), see [`touch_used`]; `None` when never recorded or a /cd dir.
    #[serde(default)]
    pub last_used_at: Option<u64>,
    /// Filled in by [`changes`]; `None` without a repo or for /cd dirs.
    #[serde(default)]
    pub changes: Option<Changes>,
}

/// Work in a clone that is on no remote yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Changes {
    pub uncommitted: u64,
    pub unpushed: u64,
}

/// The volume holding the daemon home.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Disk {
    pub free: u64,
    pub total: u64,
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
                managed_root(home, &p.group_id, &p.bot_id, p.repo_id.as_deref()),
            ),
        };
        claimed.insert(real(&path));
        let size = (kind != EntryKind::Cd).then(|| dir_size(&path, SIZE_MAX_ENTRIES));
        let state = if p.running { EntryState::Running } else { EntryState::Idle };
        entries.push(entry(&p.group_id, &p.bot_id, Some(p), kind, path, size, state));
        for id in &p.extra_repo_ids {
            let path = managed_root(home, &p.group_id, &p.bot_id, Some(id));
            claimed.insert(real(&path));
            let size = Some(dir_size(&path, SIZE_MAX_ENTRIES));
            entries.push(entry(&p.group_id, &p.bot_id, Some(p), EntryKind::Managed, path, size, state));
        }
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
        last_used_at: (kind != EntryKind::Cd).then(|| last_used(&path)).flatten(),
        path,
        size,
        state,
        changes: None,
    }
}

/// `<home>/workspaces/<group>/<bot>/.<leaf>.used`, beside the workspace so neither git nor the agent sees it; None
/// when `dir` is not inside a managed workspace.
fn used_marker(home: &Path, dir: &Path) -> Option<PathBuf> {
    let rel = dir.strip_prefix(home.join("workspaces")).ok()?;
    let parts: Vec<_> = rel.components().take(3).collect();
    let [Component::Normal(g), Component::Normal(b), Component::Normal(leaf)] = parts[..] else { return None };
    Some(home.join("workspaces").join(g).join(b).join(format!(".{}.used", leaf.to_string_lossy())))
}

/// Records that a turn starts in `dir` (a managed workspace or its clone); /cd dirs are left alone.
pub fn touch_used(home: &Path, dir: &Path) {
    if let Some(marker) = used_marker(home, dir) {
        let _ = std::fs::write(marker, b"");
    }
}

fn last_used(path: &Path) -> Option<u64> {
    let marker = path.parent()?.join(format!(".{}.used", path.file_name()?.to_string_lossy()));
    let at = std::fs::metadata(marker).ok()?.modified().ok()?;
    Some(at.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// The clone a managed workspace dir holds: the dir itself in the old layout and for `_empty`, else its one clone.
fn clone_in(root: &Path) -> PathBuf {
    if legacy_clone(root) {
        return root.to_path_buf();
    }
    let mut clones: Vec<PathBuf> = subdirs(root)
        .filter(|(name, p)| !name.ends_with(".partial") && p.join(".git").exists())
        .map(|(_, p)| p)
        .collect();
    if clones.len() == 1 { clones.remove(0) } else { root.to_path_buf() }
}

/// Uncommitted files and commits on no remote of a managed workspace's clone; None without a repo.
pub async fn changes(entry: &Entry) -> Option<Changes> {
    if entry.kind != EntryKind::Managed {
        return None;
    }
    let dir = clone_in(&entry.path);
    if !git::is_repo(&dir) {
        return None;
    }
    let status = git(&dir, &["status", "--porcelain"]).await.ok()?;
    // An unborn HEAD has no commits to lose.
    let unpushed = git(&dir, &["rev-list", "--count", "HEAD", "--not", "--remotes"]).await.unwrap_or_default();
    Some(Changes { uncommitted: status.lines().count() as u64, unpushed: unpushed.trim().parse().unwrap_or(0) })
}

/// The volume holding `home`.
pub fn disk(home: &Path) -> Option<Disk> {
    let volume = home.ancestors().find(|p| p.exists())?;
    Some(Disk { free: fs4::available_space(volume).ok()?, total: fs4::total_space(volume).ok()? })
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

/// `<root>/<group>/<bot>/<repo | _empty>` dirs, holding the clone or (old layout) being it; symlinks, interrupted
/// clones (`*.partial`) and interrupted moves (`*.moving`) are not workspaces.
fn managed_dirs(root: &Path) -> Vec<(String, String, PathBuf)> {
    let mut out = vec![];
    for (group, g) in subdirs(root) {
        for (bot, b) in subdirs(&g) {
            let leaves = subdirs(&b).filter(|(name, _)| !name.ends_with(".partial") && !name.ends_with(".moving"));
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
            // DirEntry metadata does not follow symlinks: a link is neither, so neither its target nor its own size counts.
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(m) if m.is_file() => total += m.len(),
                _ => {}
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
    if let Some(marker) = used_marker(home, &entry.path) {
        let _ = std::fs::remove_file(marker);
    }
    for dir in entry.path.ancestors().skip(1).take(2) {
        if std::fs::remove_dir(dir).is_err() {
            break;
        }
    }
    Ok(())
}

/// The 工作区 page for the web's 机器与 Bot: the server's pairs as the desktop app gets them, sizes walked off the
/// async runtime, each clone's unpushed work and the free space.
pub async fn list_for_web(home: PathBuf, config: Option<Config>) -> Result<(Vec<Entry>, Option<Disk>), String> {
    let config = config.ok_or_else(|| t!("daemon 未登录服务器").to_string())?;
    let pairs = fetch_pairs(&config).await.map_err(|e| t!("读取工作区失败：{e}", e = e))?;
    let (mut entries, disk) = tokio::task::spawn_blocking(move || {
        let entries = list(&home, &pairs);
        (entries, disk(&home))
    })
    .await
    .map_err(|e| e.to_string())?;
    for e in &mut entries {
        e.changes = changes(e).await;
    }
    Ok((entries, disk))
}

impl Workspaces {
    /// The web's chosen row if it is still that row.
    async fn row(&self, config: Option<Config>, group_id: &str, bot_id: &str, path: &str) -> Result<Entry, String> {
        list_for_web(self.home.clone(), config)
            .await?
            .0
            .into_iter()
            .find(|e| e.group_id == group_id && e.bot_id == bot_id && e.path == Path::new(path))
            .ok_or_else(|| t!("工作区不存在或已变化，请刷新").to_string())
    }

    /// Holds the clone of `entry` so no turn or git action starts in it meanwhile.
    fn hold_clone(&self, entry: &Entry, id: &str) -> Result<DirGuard, String> {
        self.hold(&clone_in(&entry.path), id).ok_or_else(|| t!("工作区正在使用中，请稍后再试").to_string())
    }

    /// Deletes the web's chosen workspace if it is still that row, still deletable (see [`delete`]) and no turn or
    /// git action is in it; services still running in it are stopped first.
    pub async fn delete_for_web(
        &self,
        config: Option<Config>,
        services: &crate::hosted::Services,
        (group_id, bot_id, path): (String, String, String),
    ) -> Result<(), String> {
        let entry = self.row(config, &group_id, &bot_id, &path).await?;
        self.delete_entry(entry, services).await
    }

    async fn delete_entry(&self, entry: Entry, services: &crate::hosted::Services) -> Result<(), String> {
        if !entry.deletable() {
            return Err(t!("只能删除已移出或未使用的托管工作区").into());
        }
        let _guard = self.hold_clone(&entry, &format!("delete:{}", entry.path.display()))?;
        services.stop_in(&entry.path).await;
        let home = self.home.clone();
        tokio::task::spawn_blocking(move || delete(&home, &entry)).await.map_err(|e| e.to_string())?
    }

    /// 瘦身: `git gc --prune=now` in a managed clone no turn is in; its size before and after.
    pub async fn gc_for_web(
        &self,
        config: Option<Config>,
        (group_id, bot_id, path): (String, String, String),
    ) -> Result<(u64, u64), String> {
        let entry = self.row(config, &group_id, &bot_id, &path).await?;
        self.gc_entry(&entry).await
    }

    async fn gc_entry(&self, entry: &Entry) -> Result<(u64, u64), String> {
        let dir = clone_in(&entry.path);
        if entry.kind != EntryKind::Managed || entry.state == EntryState::Running || !git::is_repo(&dir) {
            return Err(t!("只能整理未在运行的托管仓库").into());
        }
        let _guard = self.hold_clone(entry, &format!("gc:{}", entry.path.display()))?;
        let size = |p: PathBuf| async move {
            tokio::task::spawn_blocking(move || dir_size(&p, SIZE_MAX_ENTRIES)).await.map_err(|e| e.to_string())
        };
        let before = size(entry.path.clone()).await?;
        git(&dir, &["gc", "--prune=now", "--quiet"]).await.map_err(|e| t!("整理失败：{e}", e = e))?;
        Ok((before, size(entry.path.clone()).await?))
    }
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

    fn clone_at(dir: &Path, origin: &str) {
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        std::fs::write(
            dir.join(".git/config"),
            format!("[core]\n\tbare = false\n[remote \"origin\"]\n\turl = {origin}\n\tfetch = +refs/heads/*\n"),
        )
        .unwrap();
    }

    #[test]
    fn finds_local_clones_of_the_repo_by_origin() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        clone_at(&h.join("code/pay-server"), "git@git.corp:pay/pay-server.git");
        clone_at(&h.join("Documents/work/pay"), "https://git.corp/pay/pay-server");
        clone_at(&h.join("code/other"), "git@git.corp:pay/other.git");
        clone_at(&h.join("code/node_modules/pay-server"), "git@git.corp:pay/pay-server.git");
        clone_at(&h.join(".gonggong/workspaces/g/b/r"), "git@git.corp:pay/pay-server.git");
        clone_at(&h.join("a/b/c/d/e/too-deep"), "git@git.corp:pay/pay-server.git");
        // Not descended into: a clone nested in another work tree is that tree's business.
        clone_at(&h.join("code/other/vendor/pay"), "git@git.corp:pay/pay-server.git");
        let mut found = find_clones(h, &normalize_remote("git@git.corp:pay/pay-server.git"));
        found.sort();
        assert_eq!(found, vec![h.join("Documents/work/pay"), h.join("code/pay-server")]);
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
            extra_repo_ids: vec![],
            removed: false,
            running: false,
        }
    }

    fn file(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    /// pay: managed + running, with an extra repo r9; data: /cd bound with its old managed clone left; old: removed; dm: repo-less, never
    /// run; gx: a dir the server no longer knows.
    fn fixture() -> (tempfile::TempDir, tempfile::TempDir, Vec<Pair>) {
        let home = tempfile::tempdir().unwrap();
        let cd = tempfile::tempdir().unwrap();
        let ws = home.path().join("workspaces");
        file(&ws.join("pay/bw/r1/src/main.go"), 1000);
        file(&ws.join("pay/bw/r1.partial/x"), 5);
        file(&ws.join("pay/bw/r9/web/x"), 40);
        file(&ws.join("data/bw/r2/a"), 300);
        file(&ws.join("old/bw/r3/a"), 2000);
        file(&ws.join("old/bw/r3/b/c"), 500);
        file(&ws.join("gx/by/_empty/notes.md"), 7);
        file(&cd.path().join("mine.go"), 10);
        let mut pay = pair("pay", WorkspaceKind::Managed, Some("r1"));
        pay.running = true;
        pay.extra_repo_ids = vec!["r9".into()];
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
                ("pay".into(), Managed, ws.join("pay/bw/r9"), Some(40), Running, false),
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
        assert_eq!(entries[2].kind_label(), "本机目录");
        assert!(old.matches("old/bw") && old.matches("群 old/小王的 Claude") && !old.matches("old"));
        let gx = entries.iter().find(|e| e.group_id == "gx").unwrap();
        assert_eq!((gx.group_label(), gx.bot_label()), ("gx".into(), "by"));
        assert_eq!(entries[3].group_label(), "私聊");
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
    fn lists_and_deletes_both_layouts_and_finds_the_clone_by_repo_id() {
        let home = tempfile::tempdir().unwrap();
        let (h, ws) = (home.path(), home.path().join("workspaces"));
        file(&ws.join("old/bw/r1/.git/HEAD"), 10);
        file(&ws.join("new/bw/r2/pay-server/.git/HEAD"), 20);
        file(&ws.join("new/bw/r2/pay-server/a"), 30);
        file(&ws.join("new/bw/r2/pay-server.partial/x"), 5);
        file(&ws.join("mid/bw/r3.moving/.git/HEAD"), 7);
        let rows: Vec<_> = list(h, &[]).into_iter().map(|e| (e.path.clone(), e.size, e.deletable())).collect();
        assert_eq!(rows, vec![(ws.join("new/bw/r2"), Some(55), true), (ws.join("old/bw/r1"), Some(10), true)]);

        assert_eq!(managed_clone(h, "old", "bw", Some("r1")), ws.join("old/bw/r1"));
        assert_eq!(managed_clone(h, "new", "bw", Some("r2")), ws.join("new/bw/r2/pay-server"));
        assert_eq!(managed_clone(h, "none", "bw", Some("r9")), ws.join("none/bw/r9"));
        assert_eq!(managed_clone(h, "new", "bw", None), ws.join("new/bw/_empty"));

        for e in list(h, &[]) {
            delete(h, &e).unwrap();
        }
        assert!(!ws.join("new").exists() && !ws.join("old").exists());
        assert!(ws.join("mid/bw/r3.moving/.git/HEAD").exists(), "an interrupted move is never offered for deletion");
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
        assert_eq!(dir_size(dir.path(), 1000), 50);
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

    fn git_in(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap().status.success();
        assert!(ok, "git {args:?}");
    }

    /// A clone at `<root>/app` with one local-only commit and one changed file.
    fn repo_at(root: &Path) -> PathBuf {
        let dir = root.join("app");
        std::fs::create_dir_all(&dir).unwrap();
        git_in(&dir, &["init", "-q"]);
        file(&dir.join("a.txt"), 10);
        git_in(&dir, &["add", "."]);
        git_in(&dir, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "one"]);
        file(&dir.join("b.txt"), 10);
        dir
    }

    #[test]
    fn records_when_a_turn_last_used_a_managed_workspace() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        file(&h.join("workspaces/g/b/r1/pay/a"), 10);
        file(&h.join("workspaces/g/b/r2/pay/a"), 10);
        touch_used(h, &h.join("workspaces/g/b/r1/pay"));
        touch_used(h, Path::new("/elsewhere/mine"));
        let entries = list(h, &[]);
        assert_eq!(entries.len(), 2, "the marker is not a workspace");
        let used = entries[0].last_used_at.unwrap();
        let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as u64;
        assert!(now.abs_diff(used) < 60_000);
        assert_eq!(entries[1].last_used_at, None);
        delete(h, &entries[0]).unwrap();
        assert!(!h.join("workspaces/g/b/.r1.used").exists());
    }

    #[tokio::test]
    async fn counts_uncommitted_files_and_commits_on_no_remote() {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().join("workspaces/g/b/r1");
        repo_at(&root);
        let mut entry = list(home.path(), &[]).remove(0);
        assert_eq!(changes(&entry).await, Some(Changes { uncommitted: 1, unpushed: 1 }));
        entry.kind = EntryKind::Empty;
        assert_eq!(changes(&entry).await, None);
    }

    #[tokio::test]
    async fn deletes_and_gcs_only_workspaces_nothing_is_in() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let clone = repo_at(&h.join("workspaces/g/b/r1"));
        let ws = Workspaces::new(h.to_path_buf());
        let services = crate::hosted::Services::new(h);
        let entry = list(h, &[]).remove(0);

        let busy = ws.hold(&clone, "manual").unwrap();
        assert!(ws.gc_entry(&entry).await.unwrap_err().contains("正在使用"));
        assert!(ws.delete_entry(entry.clone(), &services).await.unwrap_err().contains("正在使用"));
        drop(busy);

        let (before, after) = ws.gc_entry(&entry).await.unwrap();
        assert!(before > 0 && after > 0);
        let running = Entry { state: EntryState::Running, ..entry.clone() };
        assert!(ws.gc_entry(&running).await.is_err());
        ws.delete_entry(entry, &services).await.unwrap();
        assert!(!h.join("workspaces/g").exists());
    }

    #[test]
    fn lists_subdirectories_with_their_modified_time() {
        let dir = tempfile::tempdir().unwrap();
        file(&dir.path().join("app/a"), 1);
        let entries = picker_entries(dir.path(), false);
        assert_eq!(entries.len(), 1);
        let now = ms(SystemTime::now()).unwrap();
        assert!(now.abs_diff(entries[0].modified.unwrap()) < 60_000);
    }

    #[test]
    fn offers_the_user_folders_that_exist() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        std::fs::create_dir_all(h.join("Desktop")).unwrap();
        std::fs::create_dir_all(h.join("OneDrive/Documents")).unwrap();
        let got: Vec<_> = user_places(h).into_iter().map(|p| (p.kind, p.path)).collect();
        let s = |p: PathBuf| p.to_string_lossy().into_owned();
        assert_eq!(
            got,
            vec![
                (DirPlaceKind::Home, s(h.to_path_buf())),
                (DirPlaceKind::Desktop, s(h.join("Desktop"))),
                (DirPlaceKind::Documents, s(h.join("OneDrive/Documents"))),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn lists_mounted_volumes_but_not_links_to_the_boot_volume() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("Backup")).unwrap();
        std::fs::create_dir_all(root.path().join(".hidden")).unwrap();
        std::fs::create_dir_all(root.path().join("com.apple.TimeMachine.localsnapshots")).unwrap();
        std::os::unix::fs::symlink("/", root.path().join("Macintosh HD")).unwrap();
        let names: Vec<_> = volumes(root.path()).into_iter().map(|p| (p.kind, p.name)).collect();
        assert_eq!(names, vec![(DirPlaceKind::Volume, "Backup".to_string())]);
    }

    #[test]
    fn creates_one_plain_folder_in_an_existing_parent() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().to_string_lossy().into_owned();
        let made = create_dir(parent.clone(), " 新项目 ").unwrap();
        assert_eq!(PathBuf::from(&made), dir.path().join("新项目"));
        assert!(dir.path().join("新项目").is_dir());
        assert_eq!(create_dir(parent.clone(), "新项目").unwrap_err(), "已有同名文件或文件夹");
        for bad in ["", "..", "a/b", "a\\b"] {
            assert_eq!(create_dir(parent.clone(), bad).unwrap_err(), "文件夹名称不合法", "{bad:?}");
        }
        assert!(create_dir(dir.path().join("missing").to_string_lossy().into_owned(), "x").is_err());
        assert!(create_dir("relative".into(), "x").is_err());
    }

    #[test]
    fn human_sizes() {
        assert_eq!(human_size(0), "0 B");
        assert_eq!(human_size(2500), "2.5 KB");
        assert_eq!(human_size(412_000_000), "412 MB");
        assert_eq!(human_size(1_800_000_000), "1.8 GB");
    }
}
