//! Per-(group, bot) workspaces (spec §4.2, §4.3): managed clones made with the owner's own git credentials, and /cd
//! bindings to existing local clones of the group repo.
use crate::protocol::{
    DaemonToServer, GitStatus, RepoSpec, RunStart, WorkspaceCd, WorkspaceEnsure, WorkspaceKind, WorkspaceState,
    WorkspaceStateKind,
};
use crate::service::Outbox;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// `<home>/workspaces/<groupId>/<botId>/<repoId | _empty>/` — isolated per group, bot and repo (a new repo = new dir).
pub fn managed_path(home: &Path, group: &str, bot: &str, repo_id: Option<&str>) -> PathBuf {
    home.join("workspaces").join(group).join(bot).join(repo_id.unwrap_or("_empty"))
}

/// Serializes clones, /cd checks and run cwd resolution of one (group, bot).
type Locks = Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>;

pub struct Workspaces {
    home: PathBuf,
    locks: Locks,
}

type Outcome = Result<(PathBuf, Option<GitStatus>), String>;

impl Workspaces {
    pub fn new(home: PathBuf) -> Self {
        Workspaces { home, locks: Mutex::default() }
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

    /// workspace.cd: bind to a validated local clone of the group repo, or go back to the managed clone (`path: None`).
    pub async fn cd(&self, req: WorkspaceCd, out: &Outbox) {
        let lock = self.lock(&req.group_id, &req.bot_id);
        let _guard = lock.lock().await;
        let reply = |outcome| report(out, &req.group_id, &req.bot_id, &req.request_id, outcome);
        let outcome = match &req.path {
            None => self.managed(&req.group_id, &req.bot_id, Some(&req.repo), || reply(None)).await,
            Some(path) => {
                let dir = PathBuf::from(path);
                match check_cd(&dir, &req.repo).await {
                    Ok(()) => {
                        let git = git_status(&dir, WorkspaceKind::Cd).await;
                        Ok((dir, Some(git)))
                    }
                    Err(e) => Err(e),
                }
            }
        };
        reply(Some(outcome));
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
            Some(_) => Some(git_status(&dir, WorkspaceKind::Managed).await),
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
    matches!((Path::new(&top).canonicalize(), dir.canonicalize()), (Ok(a), Ok(b)) if a == b)
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

/// /cd target must be an absolute, existing git work tree with a remote pointing at the group repo.
async fn check_cd(dir: &Path, repo: &RepoSpec) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err("需要本机绝对路径".into());
    }
    if !dir.is_dir() {
        return Err("目录不存在".into());
    }
    if git(dir, &["rev-parse", "--is-inside-work-tree"]).await.as_deref() != Ok("true") {
        return Err("不是 git 仓库".into());
    }
    // Exits 1 when there is no remote at all.
    let listed = git(dir, &["config", "--get-regexp", r"^remote\..*\.url$"]).await.unwrap_or_default();
    let urls: Vec<&str> = listed.lines().filter_map(|l| l.split_once(' ').map(|(_, url)| url)).collect();
    let want = normalize_remote(&repo.url);
    if urls.iter().any(|u| normalize_remote(u) == want) {
        return Ok(());
    }
    Err(format!("remote 与群仓库不一致（{}）", if urls.is_empty() { "无 remote".into() } else { urls.join("、") }))
}

/// Branch, ahead/behind its upstream (None without one) and uncommitted changes.
pub async fn git_status(dir: &Path, workspace: WorkspaceKind) -> GitStatus {
    let branch = git(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).await.ok();
    let counts = git(dir, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .await
        .ok()
        .and_then(|s| parse_counts(&s));
    let dirty = git(dir, &["status", "--porcelain"]).await.is_ok_and(|s| !s.is_empty());
    GitStatus { branch, ahead: counts.map(|c| c.0), behind: counts.map(|c| c.1), dirty, workspace }
}

fn parse_counts(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split_whitespace();
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
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

async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = tokio::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        // Fail instead of waiting for a password nobody can type.
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .await
        .map_err(|e| format!("无法运行 git：{e}"))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    Err(stderr.lines().rfind(|l| !l.trim().is_empty()).map(str::trim).unwrap_or("git 执行失败").to_string())
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

    #[test]
    fn parses_left_right_counts() {
        assert_eq!(parse_counts("3\t5"), Some((3, 5)));
        assert_eq!(parse_counts("0 0\n"), Some((0, 0)));
        assert_eq!(parse_counts("fatal"), None);
    }
}
