//! Workspace git plumbing for partition mode (spec §5): shells out to the machine's `git` so its credentials apply.
use crate::protocol::{
    DiffRepo, GitOngoing, GitOngoingKind, GitStatus, PATCH_MAX_BYTES, RepoKind, RepoStatus, WorkspaceKind,
};
use crate::t;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncReadExt;
use tokio::sync::OnceCell;

/// Daemon-private files inside a workspace; never reported as the agent's changes.
pub(crate) const PRIVATE_DIR: &str = ".gonggong/";
pub(crate) const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/// Appended to a patch cut at PATCH_MAX_BYTES.
pub fn patch_truncated() -> &'static str {
    t!("… 补丁超过 512 KB，已截断\n")
}

pub fn not_git() -> &'static str {
    t!("工作区不是 git 仓库")
}

/// Only a workspace root counts: a managed `_empty` dir nested in some other checkout is not a repo.
pub fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

/// Git escapes non-ASCII paths as octal (`\345\233...`) by default; keep them readable in patches and listings.
const UNQUOTED: [&str; 2] = ["-c", "core.quotePath=false"];
/// Never prompt; and no optional locks: a read like `git status` would otherwise refresh the index under
/// `.git/index.lock`, failing a manual write (or the agent's own git) that runs at the same moment.
const QUIET: [(&str, &str); 2] = [("GIT_TERMINAL_PROMPT", "0"), ("GIT_OPTIONAL_LOCKS", "0")];

pub(crate) async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, None).await
}

/// Adds `pattern` to the repo's `.git/info/exclude` unless already there: kept out of git, not shared by sync.
pub(crate) async fn exclude(cwd: &Path, pattern: &str) -> Result<(), String> {
    let file = cwd.join(git(cwd, &["rev-parse", "--git-path", "info/exclude"]).await?.trim());
    let current = tokio::fs::read_to_string(&file).await.unwrap_or_default();
    if current.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let sep = if current.is_empty() || current.ends_with('\n') { "" } else { "\n" };
    tokio::fs::create_dir_all(file.parent().expect("exclude has a parent")).await.map_err(|e| e.to_string())?;
    tokio::fs::write(&file, format!("{current}{sep}{pattern}\n")).await.map_err(|e| e.to_string())
}

/// Removes a line added by [`exclude`]; the rest of the file is kept as is.
pub(crate) async fn unexclude(cwd: &Path, pattern: &str) -> Result<(), String> {
    let file = cwd.join(git(cwd, &["rev-parse", "--git-path", "info/exclude"]).await?.trim());
    let Ok(current) = tokio::fs::read_to_string(&file).await else { return Ok(()) };
    if !current.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let kept: String = current.lines().filter(|l| l.trim() != pattern).map(|l| format!("{l}\n")).collect();
    tokio::fs::write(&file, kept).await.map_err(|e| e.to_string())
}

/// Raw stdout, for `-z` output whose paths may not be UTF-8.
pub(crate) async fn git_bytes(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    run_git_raw(dir, args, None).await
}

/// `index` swaps in another index file (GIT_INDEX_FILE), leaving the workspace's own index untouched.
async fn run_git(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    run_git_raw(dir, args, index).await.map(|out| String::from_utf8_lossy(&out).into_owned())
}

async fn run_git_raw(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
    let env: Vec<(&str, &Path)> = index.map(|i| ("GIT_INDEX_FILE", i)).into_iter().collect();
    let out = output(dir, args, &env, None).await?;
    if out.status.success() { Ok(out.stdout) } else { Err(failure(&out.stderr)) }
}

/// Like [`git`], with `input` on stdin (path lists too long for a command line).
pub(crate) async fn git_input(dir: &Path, args: &[&str], input: &[u8]) -> Result<String, String> {
    let out = output::<&str>(dir, args, &[], Some(input)).await?;
    if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(failure(&out.stderr)) }
}

/// The whole output of `git <args>` whatever its exit status, with `env` set and `input` on stdin: a write tells its
/// conflicts from other failures itself, and merge-file exits with its conflict count.
pub(crate) async fn git_output(
    dir: &Path,
    args: &[&str],
    env: &[(&str, &str)],
    input: Option<&[u8]>,
) -> Result<std::process::Output, String> {
    output(dir, args, env, input).await
}

/// Waits before trying again when another git holds the index: it fails at once with `index.lock`, before changing
/// anything, and such holds (an IDE's status, the agent's own git) last moments.
const LOCK_WAITS_MS: [u64; 4] = [100, 250, 500, 1000];

async fn output<V: AsRef<std::ffi::OsStr>>(
    dir: &Path,
    args: &[&str],
    env: &[(&str, V)],
    input: Option<&[u8]>,
) -> Result<std::process::Output, String> {
    let mut waits = LOCK_WAITS_MS.iter();
    loop {
        let out = spawn(dir, args, env, input).await?;
        match waits.next() {
            Some(ms) if !out.status.success() && String::from_utf8_lossy(&out.stderr).contains("index.lock") => {
                tokio::time::sleep(std::time::Duration::from_millis(*ms)).await
            }
            _ => return Ok(out),
        }
    }
}

async fn spawn<V: AsRef<std::ffi::OsStr>>(
    dir: &Path,
    args: &[&str],
    env: &[(&str, V)],
    input: Option<&[u8]>,
) -> Result<std::process::Output, String> {
    let child = crate::proc::async_command("git")
        .arg("-C")
        .arg(dir)
        .args(UNQUOTED)
        .args(args)
        .envs(QUIET)
        .envs(env.iter().map(|(k, v)| (k, v)))
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(e) => {
            let error = t!("无法执行 git：{e}", e = e);
            crate::git_console::start(dir, args).error(&error);
            return Err(error);
        }
    };
    let started = crate::git_console::start(dir, args);
    // Written aside so a child filling its stdout before reading all of stdin cannot deadlock.
    let writer = child.stdin.take().zip(input).map(|(mut stdin, input)| {
        let input = input.to_vec();
        tokio::spawn(async move { tokio::io::AsyncWriteExt::write_all(&mut stdin, &input).await })
    });
    let out = child.wait_with_output().await.map_err(|e| t!("无法执行 git：{e}", e = e))?;
    if let Some(writer) = writer {
        let _ = writer.await;
    }
    started.output(&out);
    Ok(out)
}

fn failure(stderr: &[u8]) -> String {
    let err = String::from_utf8_lossy(stderr);
    err.lines().find(|l| !l.trim().is_empty()).unwrap_or(t!("git 执行失败")).trim().to_string()
}

/// Like [`git`], but reads at most `limit` bytes of output: past it git is killed and the output cut there.
async fn git_capped(dir: &Path, args: &[&str], limit: usize) -> Result<String, String> {
    git_capped_bytes(dir, args, limit).await.map(|out| String::from_utf8_lossy(&out).into_owned())
}

pub(crate) async fn git_capped_bytes(dir: &Path, args: &[&str], limit: usize) -> Result<Vec<u8>, String> {
    let mut child = crate::proc::async_command("git")
        .arg("-C")
        .arg(dir)
        .args(UNQUOTED)
        .args(args)
        .envs(QUIET)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| t!("无法执行 git：{e}", e = e))?;
    let mut out = Vec::new();
    let stdout = child.stdout.take().expect("piped");
    stdout.take(limit as u64).read_to_end(&mut out).await.map_err(|e| t!("读取 git 输出失败：{e}", e = e))?;
    if out.len() < limit {
        let done = child.wait_with_output().await.map_err(|e| t!("无法执行 git：{e}", e = e))?;
        if !done.status.success() {
            return Err(failure(&done.stderr));
        }
    }
    Ok(out)
}

/// Branch/upstream position of the work tree; `ahead`, `behind` are None without an upstream.
struct Probe {
    branch: Option<String>,
    ahead: Option<u32>,
    behind: Option<u32>,
    dirty: u32,
}

async fn probe(dir: &Path, scans: &Scans) -> Result<Probe, String> {
    let position = async {
        let branch = scans.branch(dir).await;
        let upstream = match branch {
            Some(_) => git(dir, &["rev-parse", "--abbrev-ref", "@{upstream}"]).await.ok(),
            None => None,
        };
        let (ahead, behind) = match upstream {
            Some(_) => {
                let counts = git(dir, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).await?;
                let mut n = counts.split_whitespace().map(|n| n.parse::<u32>().ok());
                (n.next().flatten(), n.next().flatten())
            }
            None => (None, None),
        };
        Ok::<_, String>((branch, ahead, behind))
    };
    let (position, dirty) = tokio::join!(position, scans.porcelain(dir));
    let ((branch, ahead, behind), dirty) = (position?, dirty?.len() as u32);
    Ok(Probe { branch, ahead, behind, dirty })
}

/// Per-repo results shared by the steps that end a turn, so each work tree is scanned and staged once.
#[derive(Default)]
struct Scans {
    porcelain: Memo<Result<BTreeMap<String, String>, String>>,
    trees: Memo<Result<String, String>>,
    branches: Memo<Option<String>>,
}

impl Scans {
    async fn porcelain(&self, dir: &Path) -> Result<BTreeMap<String, String>, String> {
        self.porcelain.get(dir, porcelain(dir)).await
    }

    async fn tree(&self, dir: &Path) -> Result<String, String> {
        self.trees.get(dir, work_tree(dir)).await
    }

    async fn branch(&self, dir: &Path) -> Option<String> {
        self.branches.get(dir, branch(dir)).await
    }
}

/// One value per repo dir, computed by its first caller while later ones wait for it.
struct Memo<T>(Mutex<HashMap<PathBuf, Arc<OnceCell<T>>>>);

impl<T> Default for Memo<T> {
    fn default() -> Self {
        Self(Mutex::default())
    }
}

impl<T: Clone> Memo<T> {
    async fn get(&self, dir: &Path, compute: impl Future<Output = T>) -> T {
        let cell = self.0.lock().unwrap().entry(dir.to_path_buf()).or_default().clone();
        cell.get_or_init(|| compute).await.clone()
    }
}

/// The root's position plus every other repo's, those of the additional directories `extras` as `extra` repos under
/// their absolute paths; Err when none of them holds a repo.
pub async fn status(dir: &Path, extras: &[PathBuf], workspace: WorkspaceKind) -> Result<GitStatus, String> {
    status_in(dir, extras, workspace, &Scans::default()).await
}

async fn status_in(
    dir: &Path,
    extras: &[PathBuf],
    workspace: WorkspaceKind,
    scans: &Scans,
) -> Result<GitStatus, String> {
    let mut repos = vec![];
    let mut any = false;
    for (root, label) in roots(dir, extras) {
        for r in discover(&root).await {
            any = true;
            if label.is_empty() && r.kind == RepoKind::Root {
                continue;
            }
            let p = probe(&root.join(&r.path), scans).await?;
            let (branch, ahead, behind, dirty) = (p.branch, p.ahead, p.behind, p.dirty > 0);
            let (path, kind) = (under(&label, &r.path), extra_kind(&label, r.kind));
            repos.push(RepoStatus { path, kind, branch, ahead, behind, dirty });
        }
    }
    if !any {
        return Err(not_git().into());
    }
    let checked_at = Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    if !is_repo(dir) {
        let (dirty, dirty_count) = (false, None);
        return Ok(GitStatus {
            branch: None,
            ahead: None,
            behind: None,
            dirty,
            dirty_count,
            checked_at,
            workspace,
            repos,
            head: None,
            ongoing: None,
            conflicts: None,
            stashes: None,
        });
    }
    let (p, (head, ongoing, conflicts, stashes)) = tokio::join!(probe(dir, scans), root_state(dir, scans));
    let (p, ongoing) = (p?, ongoing?.map(|o| o.kind));
    let (branch, ahead, behind, dirty_count) = (p.branch, p.ahead, p.behind, Some(p.dirty));
    let (dirty, conflicts, stashes) = (p.dirty > 0, Some(conflicts?), Some(stashes?));
    Ok(GitStatus {
        branch,
        ahead,
        behind,
        dirty,
        dirty_count,
        checked_at,
        workspace,
        repos,
        head,
        ongoing,
        conflicts,
        stashes,
    })
}

type RootState = (Option<String>, Result<Option<GitOngoing>, String>, Result<u32, String>, Result<u32, String>);

/// The root repo's HEAD (short), what stopped midway, its unmerged paths and stashes.
async fn root_state(dir: &Path, scans: &Scans) -> RootState {
    let (head, ongoing, porcelain, stashes) = tokio::join!(
        git(dir, &["rev-parse", "-q", "--short", "--verify", "HEAD"]),
        ongoing(dir),
        scans.porcelain(dir),
        git(dir, &["stash", "list", "--format=%H"]),
    );
    let unmerged = porcelain.map(|p| p.values().filter(|xy| UNMERGED.contains(&xy.as_str())).count() as u32);
    (head.ok().map(|h| h.trim().to_string()), ongoing, unmerged, stashes.map(|s| s.lines().count() as u32))
}

/// Porcelain `XY` of an unmerged path.
const UNMERGED: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];

/// What stopped midway in `dir`'s repo, read from the state git keeps in its git dir. A rebase wins over the merges,
/// picks and reverts it may stop in; `git am` (rebase-apply without `rebasing`) is not reported. A squash merge keeps no
/// MERGE_HEAD: it counts as a merge while its conflicts last.
pub(crate) async fn ongoing(dir: &Path) -> Result<Option<GitOngoing>, String> {
    let names =
        ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_MSG", "SQUASH_MSG"];
    let mut args = vec!["rev-parse"];
    args.extend(names.iter().flat_map(|n| ["--git-path", n]));
    let raw = git(dir, &args).await?;
    // Relative to `dir` (absolute in a linked worktree or submodule), on every git version.
    let paths: Vec<PathBuf> = raw.lines().map(|p| dir.join(p)).collect();
    let [merge_dir, apply_dir, merge_head, pick_head, revert_head, merge_msg, squash_msg] = &paths[..] else {
        return Err(t!("git 执行失败").into());
    };
    let read = |p: &Path| std::fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let message = read(merge_msg)
        .map(|m| m.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n").trim().to_string())
        .filter(|m| !m.is_empty());
    // A state file holds a full hash (MERGE_HEAD: one per merged head).
    let short = async |hash: Option<String>| -> Option<String> {
        let hash = hash?.lines().next()?.to_string();
        git(dir, &["rev-parse", "--short", &hash]).await.ok().map(|h| h.trim().to_string())
    };
    let (kind, subject, step, total) = if merge_dir.is_dir() || apply_dir.join("rebasing").exists() {
        let (state, step, total) =
            if merge_dir.is_dir() { (merge_dir, "msgnum", "end") } else { (apply_dir, "next", "last") };
        let number = |name: &str| -> Option<u32> { read(&state.join(name))?.parse().ok() };
        let subject = match read(&state.join("head-name")) {
            Some(name) if name != "detached HEAD" => Some(name.trim_start_matches("refs/heads/").to_string()),
            _ => short(read(&state.join("orig-head"))).await,
        };
        (GitOngoingKind::Rebase, subject, number(step), number(total))
    } else if merge_head.exists() {
        (GitOngoingKind::Merge, merged(dir, read(merge_head)).await, None, None)
    } else if pick_head.exists() {
        (GitOngoingKind::CherryPick, short(read(pick_head)).await, None, None)
    } else if revert_head.exists() {
        (GitOngoingKind::Revert, short(read(revert_head)).await, None, None)
    } else if squash_msg.exists() && !git(dir, &["ls-files", "-u"]).await?.is_empty() {
        // `Squashed commit of the following:`, then `commit <hash>` per commit, the merged tip first.
        let tip = read(squash_msg).and_then(|m| m.lines().find_map(|l| Some(l.strip_prefix("commit ")?.to_string())));
        (GitOngoingKind::Merge, merged(dir, tip).await, None, None)
    } else {
        return Ok(None);
    };
    Ok(Some(GitOngoing { kind, subject, step, total, message }))
}

/// What a merge of `hash` (a state file's first line) is named by: a local branch pointing at it, else a remote-tracking
/// one (an update merging `origin/main`), else a tag, else its short hash.
async fn merged(dir: &Path, hash: Option<String>) -> Option<String> {
    let hash = hash?.lines().next()?.to_string();
    let points_at = format!("--points-at={hash}");
    let args = ["for-each-ref", &points_at, "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"];
    // Listed by full name: heads, then remotes, then tags.
    let refs = git(dir, &args).await.unwrap_or_default();
    let named = refs.lines().filter(|r| !r.ends_with("/HEAD")).find_map(|r| {
        ["refs/heads/", "refs/remotes/", "refs/tags/"].iter().find_map(|p| r.strip_prefix(p)).map(String::from)
    });
    match named {
        Some(name) => Some(name),
        None => git(dir, &["rev-parse", "--short", &hash]).await.ok().map(|h| h.trim().to_string()),
    }
}

/// The directory of each repo of the workspace `dir` and of its additional directories `extras`, with its path as
/// GitStatus.repos has it ('' = the root).
pub(crate) async fn repos(dir: &Path, extras: &[PathBuf]) -> Vec<(String, PathBuf)> {
    let mut repos = vec![];
    for (root, label) in roots(dir, extras) {
        for r in discover(&root).await {
            repos.push((under(&label, &r.path), root.join(&r.path)));
        }
    }
    repos
}

/// The workspace (label '') and each additional directory, labelled with its absolute path.
fn roots(dir: &Path, extras: &[PathBuf]) -> Vec<(PathBuf, String)> {
    let extras = extras.iter().map(|e| (e.clone(), e.to_string_lossy().into_owned()));
    std::iter::once((dir.to_path_buf(), String::new())).chain(extras).collect()
}

/// A repo path below a root's label.
fn under(label: &str, path: &str) -> String {
    match (label, path) {
        ("", p) => p.to_string(),
        (l, "") => l.to_string(),
        (l, p) => format!("{l}/{p}"),
    }
}

/// The root repo of an additional directory is reported as `extra`.
fn extra_kind(label: &str, kind: RepoKind) -> RepoKind {
    if !label.is_empty() && kind == RepoKind::Root { RepoKind::Extra } else { kind }
}

/// A repo of the workspace; `path` is relative to its root, '/'-separated ('' = the root).
#[derive(Debug, Clone, PartialEq)]
pub struct Repo {
    pub path: String,
    pub kind: RepoKind,
}

/// How deep below a non-git root independent repos are looked for.
const SCAN_DEPTH: usize = 3;
/// Never hold the user's own repos and can be huge. Hidden dirs (`.git`, `.gonggong`…) are skipped too.
const SCAN_SKIP: [&str; 4] = ["node_modules", "target", "dist", "build"];

/// The root (if it is a repo) and its checked-out submodules, recursively; below a non-git root, the repos found
/// within SCAN_DEPTH levels and their submodules. Root first, then by path.
pub async fn discover(dir: &Path) -> Vec<Repo> {
    let mut repos = vec![];
    if is_repo(dir) {
        repos.push(Repo { path: String::new(), kind: RepoKind::Root });
        add_submodules(dir, "", &mut repos).await;
    } else {
        let root = dir.to_path_buf();
        let nested = tokio::task::spawn_blocking(move || {
            let mut found = vec![];
            scan(&root, "", 1, &mut found);
            found
        })
        .await
        .unwrap_or_default();
        for path in nested {
            add_submodules(&dir.join(&path), &format!("{path}/"), &mut repos).await;
            repos.push(Repo { path, kind: RepoKind::Nested });
        }
    }
    repos.sort_by(|a, b| a.path.cmp(&b.path));
    repos
}

async fn add_submodules(dir: &Path, prefix: &str, repos: &mut Vec<Repo>) {
    for path in submodules(dir).await {
        Box::pin(add_submodules(&dir.join(&path), &format!("{prefix}{path}/"), repos)).await;
        repos.push(Repo { path: format!("{prefix}{path}"), kind: RepoKind::Submodule });
    }
}

fn scan(root: &Path, rel: &str, depth: usize, found: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(root.join(rel)) else { return };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(String::from) else { continue };
        let dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if !dir || name.starts_with('.') || SCAN_SKIP.contains(&name.as_str()) {
            continue;
        }
        let path = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        if is_repo(&root.join(&path)) {
            found.push(path);
        } else if depth < SCAN_DEPTH {
            scan(root, &path, depth + 1, found);
        }
    }
}

/// Porcelain entries (path → `XY`) including untracked files, without the daemon's private dir.
pub(crate) async fn porcelain(dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let raw = git(dir, &["status", "--porcelain=v1", "-z", "--untracked-files=all"]).await?;
    let mut entries = BTreeMap::new();
    let mut tokens = raw.split('\0').filter(|t| !t.is_empty());
    while let Some(t) = tokens.next() {
        let (xy, path) = t.split_at(3.min(t.len()));
        let xy = xy.trim_end().to_string();
        // Renames/copies carry the source path as the next token.
        if xy.contains(['R', 'C']) {
            tokens.next();
        }
        if !path.starts_with(PRIVATE_DIR) {
            entries.insert(path.to_string(), xy);
        }
    }
    Ok(entries)
}

/// `(name, path)` of each submodule `.gitmodules` declares directly in `dir`.
pub(crate) async fn gitmodules(dir: &Path) -> Vec<(String, String)> {
    if !dir.join(".gitmodules").is_file() {
        return vec![];
    }
    let args = ["config", "-z", "--file", ".gitmodules", "--get-regexp", r"^submodule\..*\.path$"];
    let raw = git(dir, &args).await.unwrap_or_default();
    raw.split('\0')
        .filter_map(|e| e.split_once('\n'))
        .filter_map(|(key, path)| {
            let name = key.strip_prefix("submodule.")?.strip_suffix(".path")?;
            Some((name.to_string(), path.trim_end_matches('/').to_string()))
        })
        .collect()
}

/// Checked-out submodules directly in `dir`, as paths relative to it.
pub(crate) async fn submodules(dir: &Path) -> BTreeSet<String> {
    gitmodules(dir).await.into_iter().map(|(_, p)| p).filter(|p| dir.join(p).join(".git").exists()).collect()
}

/// Work-tree state at the start of a turn, to attribute changes to it afterwards.
#[derive(Clone)]
pub struct Snapshot {
    head: Option<String>,
    /// Porcelain entries (path → `XY`) of the paths dirty at the start, without submodule paths: their contents are
    /// tracked by `subs`.
    tree: BTreeMap<String, String>,
    /// Tree object of the whole work tree (untracked files included): the baseline of the turn's patch, and of what
    /// the turn edited in already-dirty files.
    base: Option<String>,
    /// Checked-out submodules, by path.
    subs: BTreeMap<String, Snapshot>,
}

pub(crate) async fn head(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "-q", "--verify", "HEAD"]).await.ok().map(|h| h.trim().to_string())
}

pub async fn snapshot(dir: &Path) -> Result<Snapshot, String> {
    let (base, paths, head, tree) = tokio::join!(work_tree(dir), submodules(dir), head(dir), porcelain(dir));
    let base = base.inspect_err(|e| tracing::warn!("work tree snapshot failed: {e}")).ok();
    let mut tree = tree?;
    tree.retain(|path, _| !paths.contains(path));
    let mut subs = BTreeMap::new();
    for path in &paths {
        subs.insert(path.clone(), Box::pin(snapshot(&dir.join(path))).await?);
    }
    Ok(Snapshot { head, tree, base, subs })
}

/// A path in the temp dir that no other call, of this process or another, gets.
pub(crate) fn unique_temp(prefix: &str) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("{prefix}-{}-{nanos}-{seq}", std::process::id()))
}

/// A scratch index, deleted with its lock however the staging ends: a diff dropped on timeout leaves nothing behind.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        Scratch(unique_temp("gonggong-index"))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
        let mut lock = self.0.clone().into_os_string();
        lock.push(".lock");
        let _ = std::fs::remove_file(lock);
    }
}

/// Writes the current work tree (tracked + untracked, honoring .gitignore, without `.gonggong/`) as a tree object,
/// staging through a scratch copy of the index so the user's staging area stays as it was.
pub(crate) async fn work_tree(dir: &Path) -> Result<String, String> {
    let (index, spec) =
        tokio::join!(git(dir, &["rev-parse", "--path-format=absolute", "--git-path", "index"]), everything(dir));
    let index = PathBuf::from(index?.trim());
    // The guard is made inside the copy task: if this future is dropped meanwhile, the task's output still drops it.
    let scratch = tokio::task::spawn_blocking(move || {
        let scratch = Scratch::new();
        if index.exists() {
            std::fs::copy(&index, &scratch.0)?;
        }
        Ok::<_, std::io::Error>(scratch)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| t!("无法复制 git index：{e}", e = e))?;
    run_git(dir, &[&["add", "-A", "--"][..], spec].concat(), Some(&scratch.0)).await?;
    Ok(run_git(dir, &["write-tree"], Some(&scratch.0)).await?.trim().to_string())
}

/// Pathspec of the whole work tree but the daemon's private dir.
pub(crate) async fn everything(dir: &Path) -> &'static [&'static str] {
    // Naming an ignored path in a pathspec is an error, so the exclusion is only spelled out when git doesn't ignore it.
    match git(dir, &["check-ignore", "-q", ".gonggong"]).await {
        Ok(_) => &["."],
        Err(_) => &[".", ":(exclude).gonggong"],
    }
}

/// A workspace patch (None when nothing differs, capped at PATCH_MAX_BYTES) and the repos it spans.
#[derive(Debug, Clone, PartialEq)]
pub struct Diff {
    pub patch: Option<String>,
    pub repos: Vec<DiffRepo>,
}

/// Where each repo's patch starts.
enum Scope<'a> {
    /// The turn snapshot (git roots only).
    Turn(&'a Snapshot),
    /// The repo's own HEAD.
    Uncommitted,
    /// The merge base with the repo's own main branch.
    Base,
}

/// What changed since the snapshot.
pub async fn patch_since(dir: &Path, snap: &Snapshot) -> Result<Diff, String> {
    diff(vec![(dir.to_path_buf(), String::new(), Scope::Turn(snap))], &Scans::default()).await
}

/// A git root whose changes a turn tracks: the workspace (label '') or an additional directory, labelled with its
/// absolute path, which prefixes its repos' paths in patches.
#[derive(Clone)]
pub struct Tracked {
    pub dir: PathBuf,
    pub label: String,
    pub snap: Snapshot,
}

/// Snapshots the workspace and each additional directory that is a git repo.
pub async fn track(dir: &Path, extras: &[PathBuf]) -> Vec<Tracked> {
    let mut tracked = vec![];
    for (dir, label) in roots(dir, extras).into_iter().filter(|(d, _)| is_repo(d)) {
        match snapshot(&dir).await {
            Ok(snap) => tracked.push(Tracked { dir, label, snap }),
            Err(e) => tracing::warn!("git snapshot of {} failed: {e}", dir.display()),
        }
    }
    tracked
}

/// What changed in every tracked root since its snapshot, one patch.
pub async fn turn_patch(tracked: &[Tracked]) -> Result<Diff, String> {
    turn_patch_in(tracked, &Scans::default()).await
}

async fn turn_patch_in(tracked: &[Tracked], scans: &Scans) -> Result<Diff, String> {
    diff(tracked.iter().map(|t| (t.dir.clone(), t.label.clone(), Scope::Turn(&t.snap))).collect(), scans).await
}

pub async fn turn_changed(tracked: &[Tracked]) -> Result<usize, String> {
    turn_changed_in(tracked, &Scans::default()).await
}

async fn turn_changed_in(tracked: &[Tracked], scans: &Scans) -> Result<usize, String> {
    let mut n = 0;
    for t in tracked {
        n += changed_in(&t.dir, &t.snap, scans).await?;
    }
    Ok(n)
}

/// What a turn left behind: the workspace's [`status`], the number of paths it changed ([`turn_changed`]) and its
/// patch ([`turn_patch`]), worked out together so each repo is scanned and staged once.
pub async fn turn_end(
    dir: &Path,
    extras: &[PathBuf],
    kind: WorkspaceKind,
    tracked: &[Tracked],
) -> (Result<GitStatus, String>, Result<usize, String>, Result<Diff, String>) {
    let scans = Scans::default();
    tokio::join!(status_in(dir, extras, kind, &scans), turn_changed_in(tracked, &scans), turn_patch_in(tracked, &scans))
}

/// [`discard`] in every tracked root.
pub async fn turn_discard(tracked: &[Tracked]) -> Result<usize, String> {
    let mut n = 0;
    for t in tracked {
        n += discard(&t.dir, &t.snap).await?;
    }
    Ok(n)
}

/// Everything not committed yet: each repo's HEAD (or the empty tree before its first commit) against its work tree.
pub async fn uncommitted_patch(dir: &Path, extras: &[PathBuf]) -> Result<Diff, String> {
    let roots = roots(dir, extras).into_iter().map(|(d, l)| (d, l, Scope::Uncommitted)).collect();
    diff(roots, &Scans::default()).await
}

/// Each repo's branch changes against its own main branch, uncommitted ones included; a repo on its main (or
/// detached, or without one) contributes nothing.
pub async fn base_patch(dir: &Path, extras: &[PathBuf]) -> Result<Diff, String> {
    diff(roots(dir, extras).into_iter().map(|(d, l)| (d, l, Scope::Base)).collect(), &Scans::default()).await
}

/// Each repo of each root diffed on its own, outer before inner, paths prefixed with the repo's path below the root's
/// label; a parent leaves its submodules' commit pointers out. Stops reading once the patch is sure to be capped.
async fn diff(roots: Vec<(PathBuf, String, Scope<'_>)>, scans: &Scans) -> Result<Diff, String> {
    let mut patch = String::new();
    let mut repos = vec![];
    // Patch length once each repo's share is in (0: nothing to compare, usize::MAX: no room was left for it).
    let mut ends = vec![];
    for (dir, label, scope) in roots {
        for r in discover(&dir).await {
            let rdir = dir.join(&r.path);
            let branch = scans.branch(&rdir).await;
            let (from, base) = match &scope {
                Scope::Turn(snap) => match find(snap, &r.path) {
                    Some(s) => (s.base.clone(), None),
                    None => (Some(EMPTY_TREE.into()), None),
                },
                Scope::Uncommitted => (Some(head(&rdir).await.unwrap_or_else(|| EMPTY_TREE.into())), None),
                Scope::Base => match main_of(&rdir, branch.as_deref()).await {
                    Some(main) => {
                        (Some(git(&rdir, &["merge-base", "HEAD", &main]).await?.trim().to_string()), Some(main))
                    }
                    None => (None, None),
                },
            };
            let path = under(&label, &r.path);
            let room = (PATCH_MAX_BYTES + 1).saturating_sub(patch.len());
            ends.push(match from {
                None => 0,
                Some(_) if room == 0 => usize::MAX,
                Some(from) => {
                    let prefix = if path.is_empty() { String::new() } else { format!("{path}/") };
                    diff_repo(&rdir, &prefix, &from, room, &mut patch, scans).await?;
                    patch.len()
                }
            });
            repos.push(DiffRepo { path, kind: extra_kind(&label, r.kind), branch, base, truncated: false });
        }
    }
    if repos.is_empty() {
        return Err(not_git().into());
    }
    if patch.is_empty() {
        return Ok(Diff { patch: None, repos });
    }
    let full = patch.len();
    let patch = cap_patch(patch);
    if full > PATCH_MAX_BYTES {
        let cut = patch.len() - patch_truncated().len();
        for (r, end) in repos.iter_mut().zip(ends) {
            r.truncated = end > cut;
        }
    }
    Ok(Diff { patch: Some(patch), repos })
}

/// The snapshot of the repo at `path` (relative to `snap`'s repo); None when it was not checked out then.
fn find<'a>(snap: &'a Snapshot, path: &str) -> Option<&'a Snapshot> {
    if path.is_empty() {
        return Some(snap);
    }
    snap.subs.iter().find_map(|(p, s)| match path.strip_prefix(p.as_str())? {
        "" => Some(s),
        rest => find(s, rest.strip_prefix('/')?),
    })
}

/// Appends one repo's patch from `from` to its work tree, its submodules' commit pointers left out.
async fn diff_repo(
    dir: &Path,
    prefix: &str,
    from: &str,
    room: usize,
    patch: &mut String,
    scans: &Scans,
) -> Result<(), String> {
    let (to, subs) = tokio::join!(scans.tree(dir), submodules(dir));
    let to = to?;
    if to == from {
        return Ok(());
    }
    let (src, dst) = (format!("--src-prefix=a/{prefix}"), format!("--dst-prefix=b/{prefix}"));
    let excluded: Vec<String> = subs.iter().map(|p| format!(":(exclude,literal){p}")).collect();
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-renames", &src, &dst, from, &to, "--", "."];
    args.extend(excluded.iter().map(String::as_str));
    patch.push_str(&git_capped(dir, &args, room).await?);
    Ok(())
}

/// origin/HEAD, else main, else master (local first, then origin/).
async fn main_branch(dir: &Path) -> Option<String> {
    if let Ok(r) = git(dir, &["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]).await {
        return Some(r.trim().to_string());
    }
    for name in ["main", "master", "origin/main", "origin/master"] {
        if git(dir, &["rev-parse", "-q", "--verify", &format!("{name}^{{commit}}")]).await.is_ok() {
            return Some(name.into());
        }
    }
    None
}

/// The main branch to compare `branch` with; None when `branch` is it, is detached, or there is none.
async fn main_of(dir: &Path, branch: Option<&str>) -> Option<String> {
    let branch = branch?;
    let main = main_branch(dir).await?;
    (main.rsplit_once('/').map_or(main.as_str(), |(_, n)| n) != branch).then_some(main)
}

/// Current branch name, None when detached.
pub async fn branch(dir: &Path) -> Option<String> {
    git(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).await.ok().map(|b| b.trim().to_string())
}

fn cap_patch(mut patch: String) -> String {
    if patch.len() <= PATCH_MAX_BYTES {
        return patch;
    }
    let mut cut = PATCH_MAX_BYTES - patch_truncated().len();
    while !patch.is_char_boundary(cut) {
        cut -= 1;
    }
    cut = patch[..cut].rfind('\n').map_or(0, |i| i + 1);
    patch.truncate(cut);
    patch.push_str(patch_truncated());
    patch
}

pub async fn changed_since(dir: &Path, snap: &Snapshot) -> Result<usize, String> {
    changed_in(dir, snap, &Scans::default()).await
}

async fn changed_in(dir: &Path, snap: &Snapshot, scans: &Scans) -> Result<usize, String> {
    let mut n = touched(dir, snap, scans).await?.len();
    for (path, sub) in live_subs(dir, snap) {
        n += Box::pin(changed_in(&dir.join(path), sub, scans)).await?;
    }
    Ok(n)
}

/// Submodules of the snapshot still checked out.
fn live_subs<'a>(dir: &Path, snap: &'a Snapshot) -> impl Iterator<Item = (&'a String, &'a Snapshot)> {
    snap.subs.iter().filter(move |(path, _)| dir.join(path).join(".git").exists())
}

/// Puts back every path the turn touched as it was at the snapshot (plan D7), leaving other uncommitted work alone.
/// Paths dirty before the turn get their pre-turn content from the snapshot tree (index untouched); the rest go back
/// to the snapshot's HEAD (index too) or, if the turn created them, are removed. History is never rewritten.
/// Submodules are restored the same way inside, their commit pointers left alone. Returns the number of paths restored.
pub async fn discard(dir: &Path, snap: &Snapshot) -> Result<usize, String> {
    let mut n = discard_own(dir, snap).await?;
    for (path, sub) in live_subs(dir, snap) {
        n += Box::pin(discard(&dir.join(path), sub)).await?;
    }
    Ok(n)
}

async fn discard_own(dir: &Path, snap: &Snapshot) -> Result<usize, String> {
    let base = snap.base.as_deref().ok_or(t!("这一轮开始时的工作区快照不可用"))?;
    let exists = async |rev: &str, path: &str| git(dir, &["cat-file", "-e", &format!("{rev}:{path}")]).await.is_ok();
    let paths = touched(dir, snap, &Scans::default()).await?;
    let (mut from_head, mut created) = (vec![], vec![]);
    for path in &paths {
        let file = dir.join(path);
        if !snap.tree.contains_key(path) {
            match &snap.head {
                Some(h) if exists(h, path).await => from_head.push(format!(":(literal){path}")),
                _ => created.push(path),
            }
        } else if exists(base, path).await {
            let body = run_git_raw(dir, &["cat-file", "blob", &format!("{base}:{path}")], None).await?;
            if let Some(parent) = file.parent() {
                std::fs::create_dir_all(parent).map_err(|e| t!("无法还原 {path}：{e}", path = path, e = e))?;
            }
            std::fs::write(&file, body).map_err(|e| t!("无法还原 {path}：{e}", path = path, e = e))?;
        } else {
            remove(dir, &file)?;
        }
    }
    if let (Some(h), false) = (&snap.head, from_head.is_empty()) {
        let mut args = vec!["checkout", h.as_str(), "--"];
        args.extend(from_head.iter().map(String::as_str));
        git(dir, &args).await?;
    }
    if !created.is_empty() {
        let specs: Vec<String> = created.iter().map(|p| format!(":(literal){p}")).collect();
        let mut args = vec!["rm", "-q", "--cached", "--ignore-unmatch", "--"];
        args.extend(specs.iter().map(String::as_str));
        git(dir, &args).await?;
        for path in created {
            remove(dir, &dir.join(path))?;
        }
    }
    Ok(paths.len())
}

/// Removes a file, then any directories left empty by it (up to the workspace root).
pub(crate) fn remove(root: &Path, file: &Path) -> Result<(), String> {
    if let Err(e) = std::fs::remove_file(file)
        && e.kind() != std::io::ErrorKind::NotFound
    {
        return Err(t!("无法删除 {path}：{e}", path = file.display(), e = e));
    }
    let mut dir = file.parent();
    while let Some(d) = dir.filter(|d| *d != root && d.starts_with(root)) {
        if std::fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
    Ok(())
}

/// Distinct paths the turn touched: committed since the snapshot's HEAD ∪ porcelain entries whose `XY` changed ∪
/// paths whose content differs from the snapshot's work tree (edits to already-dirty files). Submodule paths are left
/// out: their contents count on their own.
async fn touched(dir: &Path, snap: &Snapshot, scans: &Scans) -> Result<BTreeSet<String>, String> {
    let (mut subs, now_head, now, to) = tokio::join!(submodules(dir), head(dir), scans.porcelain(dir), scans.tree(dir));
    subs.extend(snap.subs.keys().cloned());
    let mut paths = BTreeSet::new();
    if let Some(now) = now_head
        && snap.head.as_ref() != Some(&now)
    {
        let base = snap.head.as_deref().unwrap_or(EMPTY_TREE);
        let diff = git(dir, &["diff", "--name-only", "-z", base, &now]).await?;
        let own = diff.split('\0').filter(|p| !p.is_empty() && !p.starts_with(PRIVATE_DIR) && !subs.contains(*p));
        paths.extend(own.map(String::from));
    }
    let mut now = now?;
    now.retain(|path, _| !subs.contains(path));
    paths.extend(now.iter().filter(|(p, xy)| snap.tree.get(*p) != Some(*xy)).map(|(p, _)| p.clone()));
    paths.extend(snap.tree.keys().filter(|p| !now.contains_key(*p)).cloned());
    if let Some(from) = &snap.base {
        paths.extend(edited(dir, from, &to?).await?.into_iter().filter(|p| !subs.contains(p)));
    }
    Ok(paths)
}

/// Paths whose content or mode differs between two trees, gitlinks (submodules, embedded repos) left out.
async fn edited(dir: &Path, from: &str, to: &str) -> Result<Vec<String>, String> {
    if from == to {
        return Ok(vec![]);
    }
    let raw = git(dir, &["diff", "--raw", "-z", "--no-renames", from, to]).await?;
    let mut tokens = raw.split('\0');
    let mut paths = vec![];
    // `:<old mode> <new mode> <old id> <new id> <status>` then the path.
    while let (Some(meta), Some(path)) = (tokens.next(), tokens.next()) {
        let gitlink = meta.trim_start_matches(':').split(' ').take(2).any(|mode| mode == "160000");
        if !gitlink && !path.starts_with(PRIVATE_DIR) {
            paths.push(path.to_string());
        }
    }
    Ok(paths)
}

#[cfg(test)]
pub(crate) mod testing {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// A bare `remote.git`, a `seed` clone that pushes upstream commits, and clones to work in.
    pub struct Remote {
        pub root: tempfile::TempDir,
    }

    pub fn run(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    impl Remote {
        pub fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let r = Remote { root };
            run(r.root.path(), &["init", "-q", "--bare", "-b", "main", "remote.git"]);
            run(r.root.path(), &["clone", "-q", "remote.git", "seed"]);
            r.commit("README.md", "hi\n");
            r
        }

        pub fn seed(&self) -> PathBuf {
            self.root.path().join("seed")
        }

        /// Commits `file` on the seed's main and pushes it.
        pub fn commit(&self, file: &str, body: &str) {
            let seed = self.seed();
            std::fs::write(seed.join(file), body).unwrap();
            run(&seed, &["add", "-A"]);
            run(&seed, &["commit", "-q", "-m", file]);
            run(&seed, &["push", "-q", "origin", "HEAD:main"]);
        }

        pub fn clone_to(&self, name: &str) -> PathBuf {
            run(self.root.path(), &["clone", "-q", "remote.git", name]);
            self.root.path().join(name)
        }

        /// A fresh `<name>.git` (one commit of `a.txt`) added to `w` as the submodule `path` and committed there.
        pub fn add_submodule(&self, w: &Path, name: &str, path: &str) {
            let src = self.root.path().join(format!("{name}-src"));
            run(self.root.path(), &["init", "-q", "-b", "main", &src.to_string_lossy()]);
            std::fs::write(src.join("a.txt"), "a\n").unwrap();
            run(&src, &["add", "-A"]);
            run(&src, &["commit", "-q", "-m", "a"]);
            let url = self.root.path().join(format!("{name}.git"));
            run(self.root.path(), &["clone", "-q", "--bare", &src.to_string_lossy(), &url.to_string_lossy()]);
            run(w, &["-c", "protocol.file.allow=always", "submodule", "add", "-q", &url.to_string_lossy(), path]);
            run(w, &["commit", "-q", "-m", &format!("add {path}")]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{Remote, run};
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn status_reports_position_against_the_known_upstream_without_fetching() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.commit("a.txt", "a");
        assert_eq!(status(&w, &[], WorkspaceKind::Managed).await.unwrap().behind, Some(0));
        run(&w, &["fetch", "-q"]);
        let s = status(&w, &[], WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch.as_deref(), s.ahead, s.behind), (Some("main"), Some(0), Some(1)));
        run(&w, &["checkout", "-q", "--detach"]);
        let s = status(&w, &[], WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch, s.ahead, s.behind), (None, None, None));
    }

    #[tokio::test]
    async fn untracked_files_make_the_tree_dirty_but_the_private_dir_does_not() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::create_dir_all(w.join(".gonggong")).unwrap();
        fs::write(w.join(".gonggong/state"), "x").unwrap();
        assert!(!status(&w, &[], WorkspaceKind::Cd).await.unwrap().dirty);
        fs::write(w.join("new.txt"), "x").unwrap();
        assert!(status(&w, &[], WorkspaceKind::Cd).await.unwrap().dirty);
    }

    #[tokio::test]
    async fn counts_paths_changed_during_the_turn() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("pre.txt"), "already dirty").unwrap();
        fs::write(w.join("same.txt"), "untouched dirty").unwrap();
        let snap = snapshot(&w).await.unwrap();
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 0);

        fs::write(w.join("pre.txt"), "edited again").unwrap();
        fs::write(w.join("new.txt"), "untracked").unwrap();
        fs::create_dir_all(w.join(".gonggong")).unwrap();
        fs::write(w.join(".gonggong/log"), "private").unwrap();
        fs::write(w.join("c1.txt"), "c").unwrap();
        fs::write(w.join("README.md"), "changed").unwrap();
        run(&w, &["add", "c1.txt", "README.md"]);
        run(&w, &["commit", "-q", "-m", "turn"]);
        // pre.txt, new.txt, c1.txt, README.md
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 4);
    }

    #[tokio::test]
    async fn tracks_changes_when_the_private_dir_is_git_excluded() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::create_dir_all(w.join(".gonggong/attachments/m1")).unwrap();
        fs::write(w.join(".gonggong/attachments/m1/shot.png"), "png").unwrap();
        fs::write(w.join(".git/info/exclude"), ".gonggong/\n").unwrap();
        let snap = snapshot(&w).await.unwrap();
        fs::write(w.join("new.txt"), "untracked").unwrap();
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 1);
        assert!(patch_since(&w, &snap).await.unwrap().patch.is_some_and(|p| p.contains("new.txt")));
    }

    #[tokio::test]
    async fn uncommitted_patch_covers_edits_and_untracked_files() {
        let r = Remote::new();
        let w = r.clone_to("w");
        assert_eq!(uncommitted_patch(&w, &[]).await.unwrap().patch, None);
        fs::write(w.join("README.md"), "changed\n").unwrap();
        fs::write(w.join("new.txt"), "untracked\n").unwrap();
        let p = uncommitted_patch(&w, &[]).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/README.md b/README.md") && p.contains("+changed"));
        assert!(p.contains("b/new.txt") && p.contains("+untracked"));
    }

    #[tokio::test]
    async fn patches_keep_non_ascii_paths_readable() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("计划.md"), "中文\n").unwrap();
        let p = uncommitted_patch(&w, &[]).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/计划.md b/计划.md"), "{p}");
    }

    #[tokio::test]
    async fn base_patch_compares_a_branch_with_main_and_is_none_on_main() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let on_main = base_patch(&w, &[]).await.unwrap();
        assert_eq!(on_main, Diff { patch: None, repos: vec![root(Some("main"), None)] });

        run(&w, &["checkout", "-q", "-b", "feat/x"]);
        fs::write(w.join("feature.txt"), "f\n").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "feature"]);
        fs::write(w.join("wip.txt"), "wip\n").unwrap();
        // Main moving on upstream must not show up as a removal on the branch (merge base).
        r.commit("later.txt", "later");
        run(&w, &["fetch", "-q"]);
        let b = base_patch(&w, &[]).await.unwrap();
        assert_eq!(b.repos, vec![root(Some("feat/x"), Some("origin/main"))]);
        let p = b.patch.unwrap();
        assert!(p.contains("b/feature.txt") && p.contains("b/wip.txt"));
        assert!(!p.contains("later.txt"));
    }

    #[tokio::test]
    async fn commits_on_a_new_branch_count() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let snap = snapshot(&w).await.unwrap();
        run(&w, &["checkout", "-q", "-b", "feat/hello"]);
        fs::write(w.join("hello.txt"), "hi").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "hello"]);
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 1);
        assert_eq!(status(&w, &[], WorkspaceKind::Managed).await.unwrap().branch.as_deref(), Some("feat/hello"));
    }

    #[tokio::test]
    async fn patch_holds_only_this_turns_changes() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("gone.txt"), "bye\n").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "gone"]);
        fs::write(w.join("pre.txt"), "dirty before\n").unwrap();
        let snap = snapshot(&w).await.unwrap();
        assert_eq!(patch_since(&w, &snap).await.unwrap().patch, None);

        fs::write(w.join("README.md"), "hi\nmore\n").unwrap();
        fs::write(w.join("new.txt"), "fresh\n").unwrap();
        fs::remove_file(w.join("gone.txt")).unwrap();
        fs::write(w.join("pre.txt"), "dirty before\nand during\n").unwrap();
        fs::write(w.join("logo.bin"), [0u8, 159, 146, 150, 0, 1]).unwrap();
        fs::create_dir_all(w.join(".gonggong")).unwrap();
        fs::write(w.join(".gonggong/state"), "private\n").unwrap();
        let p = patch_since(&w, &snap).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/README.md b/README.md\n"), "{p}");
        assert!(p.contains("\n hi\n+more\n"), "{p}");
        assert!(p.contains("diff --git a/new.txt b/new.txt\nnew file mode 100644\n"), "{p}");
        assert!(p.contains("+fresh\n"), "{p}");
        assert!(p.contains("diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n"), "{p}");
        assert!(p.contains("\n dirty before\n+and during\n"), "pre-turn dirt is the baseline: {p}");
        assert!(p.contains("Binary files /dev/null and b/logo.bin differ"), "{p}");
        assert!(!p.contains(".gonggong"), "{p}");
        // The work tree was not touched: the real index still has no staged changes.
        assert_eq!(run(&w, &["diff", "--cached", "--name-only"]), "");
    }

    #[tokio::test]
    async fn patch_includes_changes_committed_during_the_turn() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let snap = snapshot(&w).await.unwrap();
        fs::write(w.join("c.txt"), "committed\n").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "turn"]);
        let p = patch_since(&w, &snap).await.unwrap().patch.unwrap();
        assert!(p.contains("+committed\n"), "{p}");
    }

    fn read(w: &Path, f: &str) -> Option<String> {
        fs::read_to_string(w.join(f)).ok()
    }

    #[tokio::test]
    async fn discard_restores_only_what_the_turn_touched() {
        let r = Remote::new();
        r.commit("gone.txt", "tracked\n");
        r.commit("edit.txt", "base\n");
        let w = r.clone_to("w");
        // Uncommitted work from before the turn.
        fs::write(w.join("README.md"), "local wip\n").unwrap();
        fs::write(w.join("mine.txt"), "untracked wip\n").unwrap();
        fs::write(w.join("pre.txt"), "pre-turn draft\n").unwrap();
        fs::write(w.join("drop.txt"), "untracked, deleted by the turn\n").unwrap();
        let snap = snapshot(&w).await.unwrap();

        fs::write(w.join("pre.txt"), "rewritten by the turn\n").unwrap();
        fs::remove_file(w.join("drop.txt")).unwrap();
        fs::write(w.join("edit.txt"), "changed\n").unwrap();
        fs::remove_file(w.join("gone.txt")).unwrap();
        fs::create_dir_all(w.join("src/new")).unwrap();
        fs::write(w.join("src/new/a.rs"), "fn a() {}\n").unwrap();
        fs::write(w.join("staged*.txt"), "new and staged\n").unwrap();
        run(&w, &["add", "staged*.txt"]);
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 6);

        assert_eq!(discard(&w, &snap).await.unwrap(), 6);
        assert_eq!(read(&w, "README.md").as_deref(), Some("local wip\n"));
        assert_eq!(read(&w, "mine.txt").as_deref(), Some("untracked wip\n"));
        assert_eq!(read(&w, "pre.txt").as_deref(), Some("pre-turn draft\n"));
        assert_eq!(read(&w, "drop.txt").as_deref(), Some("untracked, deleted by the turn\n"));
        assert_eq!(read(&w, "edit.txt").as_deref(), Some("base\n"));
        assert_eq!(read(&w, "gone.txt").as_deref(), Some("tracked\n"));
        assert!(!w.join("src").exists());
        assert!(!w.join("staged*.txt").exists());
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 0);
        let status = git(&w, &["status", "--porcelain"]).await.unwrap();
        assert_eq!(status, " M README.md\n?? drop.txt\n?? mine.txt\n?? pre.txt\n");
    }

    #[tokio::test]
    async fn discard_restores_files_committed_during_the_turn_without_rewriting_history() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let snap = snapshot(&w).await.unwrap();
        fs::write(w.join("README.md"), "committed by the turn\n").unwrap();
        fs::write(w.join("c.txt"), "c").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "turn"]);
        assert_eq!(discard(&w, &snap).await.unwrap(), 2);
        assert_eq!(read(&w, "README.md").as_deref(), Some("hi\n"));
        assert!(!w.join("c.txt").exists());
        assert_eq!(status(&w, &[], WorkspaceKind::Managed).await.unwrap().ahead, Some(1));
    }

    #[tokio::test]
    async fn patches_show_submodule_contents_instead_of_their_commit_pointers() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "my lib");
        fs::write(w.join("my lib/a.txt"), "a\nedited\n").unwrap();
        fs::write(w.join("my lib/n.txt"), "new\n").unwrap();
        let p = uncommitted_patch(&w, &[]).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/my lib/a.txt b/my lib/a.txt\n") && p.contains("+edited\n"), "{p}");
        assert!(p.contains("b/my lib/n.txt") && p.contains("+new\n"), "{p}");

        // A submodule's uncommitted work starts at its own HEAD, not at the commit the parent records.
        run(&w.join("my lib"), &["add", "-A"]);
        run(&w.join("my lib"), &["commit", "-q", "-m", "sub"]);
        let d = uncommitted_patch(&w, &[]).await.unwrap();
        assert_eq!(d.patch, None, "the bumped pointer is no content change");
        fs::write(w.join("my lib/n.txt"), "new\nwip\n").unwrap();
        let p = uncommitted_patch(&w, &[]).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/my lib/n.txt b/my lib/n.txt\n") && p.contains(" new\n+wip\n"), "{p}");
        assert!(!p.contains("a.txt") && !p.contains("Subproject commit"), "{p}");
    }

    #[tokio::test]
    async fn turns_track_additional_directories_under_their_absolute_paths() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let e = r.clone_to("sdk");
        let plain = r.root.path().join("notes");
        fs::create_dir_all(&plain).unwrap();
        let tracked = track(&w, &[e.clone(), plain.clone()]).await;
        let labels: Vec<_> = tracked.iter().map(|t| t.label.clone()).collect();
        assert_eq!(labels, vec![String::new(), e.to_string_lossy().into_owned()]);

        fs::write(w.join("README.md"), "hi\nmain\n").unwrap();
        fs::write(e.join("sdk.txt"), "sdk\n").unwrap();
        fs::write(plain.join("n.txt"), "untracked dir\n").unwrap();
        assert_eq!(turn_changed(&tracked).await.unwrap(), 2);
        let d = turn_patch(&tracked).await.unwrap();
        let ep = e.to_string_lossy();
        assert_eq!(d.repos, vec![root(Some("main"), None), repo(&ep, RepoKind::Extra, Some("main"), None)]);
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/README.md b/README.md\n"), "{p}");
        assert!(p.contains(&format!("diff --git a/{ep}/sdk.txt b/{ep}/sdk.txt\n")), "{p}");

        assert_eq!(turn_discard(&tracked).await.unwrap(), 2);
        assert!(!e.join("sdk.txt").exists());
        assert_eq!(fs::read_to_string(w.join("README.md")).unwrap(), "hi\n");
    }

    #[tokio::test]
    async fn additional_directories_join_status_and_scoped_patches() {
        let r = Remote::new();
        let e = r.clone_to("sdk");
        let ep = e.to_string_lossy().into_owned();
        fs::write(e.join("sdk.txt"), "sdk\n").unwrap();
        // A repo-less workspace still reports the repos of its additional directories.
        let ws = tempfile::tempdir().unwrap();
        let s = status(ws.path(), std::slice::from_ref(&e), WorkspaceKind::Managed).await.unwrap();
        let sdk = RepoStatus {
            path: ep.clone(),
            kind: RepoKind::Extra,
            branch: Some("main".into()),
            ahead: Some(0),
            behind: Some(0),
            dirty: true,
        };
        assert_eq!((s.branch, s.repos), (None, vec![sdk]));
        let d = uncommitted_patch(ws.path(), std::slice::from_ref(&e)).await.unwrap();
        assert_eq!(d.repos, vec![repo(&ep, RepoKind::Extra, Some("main"), None)]);
        assert!(d.patch.unwrap().contains(&format!("b/{ep}/sdk.txt")));

        let w = r.clone_to("w");
        let s = status(&w, std::slice::from_ref(&e), WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch.as_deref(), s.repos.len(), s.repos[0].kind), (Some("main"), 1, RepoKind::Extra));
        assert_eq!(base_patch(&w, &[e]).await.unwrap().patch, None);
    }

    fn root(branch: Option<&str>, base: Option<&str>) -> DiffRepo {
        repo("", RepoKind::Root, branch, base)
    }

    fn repo(path: &str, kind: RepoKind, branch: Option<&str>, base: Option<&str>) -> DiffRepo {
        let (branch, base) = (branch.map(String::from), base.map(String::from));
        DiffRepo { path: path.into(), kind, branch, base, truncated: false }
    }

    /// `git init` at `dir` with one commit of `a.txt`.
    fn init(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        run(dir, &["init", "-q", "-b", "main"]);
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        run(dir, &["add", "-A"]);
        run(dir, &["commit", "-q", "-m", "a"]);
    }

    #[tokio::test]
    async fn base_scope_compares_each_repo_with_its_own_main() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        let sub = w.join("lib");
        run(&sub, &["checkout", "-q", "-b", "feat/y"]);
        fs::write(sub.join("b.txt"), "b\n").unwrap();
        run(&sub, &["add", "-A"]);
        run(&sub, &["commit", "-q", "-m", "b"]);
        fs::write(sub.join("a.txt"), "a\nwip\n").unwrap();
        // The root sits on its main: it adds nothing, but must not blank the submodule's changes.
        let d = base_patch(&w, &[]).await.unwrap();
        let main = main_branch(&sub).await;
        assert_eq!(
            d.repos,
            vec![root(Some("main"), None), repo("lib", RepoKind::Submodule, Some("feat/y"), main.as_deref())]
        );
        assert!(main.is_some());
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/lib/b.txt b/lib/b.txt\n") && p.contains("+wip\n"), "{p}");
        assert!(!p.contains("Subproject commit"), "{p}");

        run(&sub, &["checkout", "-q", "-f", "main"]);
        assert_eq!(base_patch(&w, &[]).await.unwrap().patch, None);
    }

    #[tokio::test]
    async fn discovers_nested_repos_below_a_non_git_root() {
        let r = Remote::new();
        let ws = r.root.path().join("ws");
        init(&ws.join("a"));
        init(&ws.join("a/inner"));
        init(&ws.join("x/y/c"));
        init(&ws.join("x/y/z/d"));
        init(&ws.join("node_modules/n"));
        init(&ws.join(".hidden/h"));
        let lib = r.clone_to("ws/p/lib");
        r.add_submodule(&lib, "vendor", "vendor");
        let found: Vec<_> = discover(&ws).await.into_iter().map(|r| (r.path, r.kind)).collect();
        let want = [("a", RepoKind::Nested), ("p/lib", RepoKind::Nested), ("p/lib/vendor", RepoKind::Submodule)];
        let mut want: Vec<_> = want.into_iter().map(|(p, k)| (p.to_string(), k)).collect();
        want.push(("x/y/c".into(), RepoKind::Nested));
        assert_eq!(found, want);

        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        init(&w.join("own"));
        let found: Vec<_> = discover(&w).await.into_iter().map(|r| (r.path, r.kind)).collect();
        assert_eq!(found, vec![(String::new(), RepoKind::Root), ("lib".into(), RepoKind::Submodule)]);
    }

    #[tokio::test]
    async fn non_git_roots_diff_and_report_their_nested_repos() {
        let ws = tempfile::tempdir().unwrap();
        let ws = ws.path();
        assert_eq!(uncommitted_patch(ws, &[]).await.unwrap_err(), not_git());
        assert_eq!(status(ws, &[], WorkspaceKind::Cd).await.unwrap_err(), not_git());
        init(&ws.join("a"));
        init(&ws.join("b"));
        fs::write(ws.join("a/a.txt"), "a\nmore\n").unwrap();
        run(&ws.join("b"), &["checkout", "-q", "-b", "feat/x"]);
        fs::write(ws.join("b/new.txt"), "n\n").unwrap();
        run(&ws.join("b"), &["add", "-A"]);
        run(&ws.join("b"), &["commit", "-q", "-m", "n"]);

        let d = uncommitted_patch(ws, &[]).await.unwrap();
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/a/a.txt b/a/a.txt\n") && !p.contains("new.txt"), "{p}");
        let a = repo("a", RepoKind::Nested, Some("main"), None);
        assert_eq!(d.repos, vec![a.clone(), repo("b", RepoKind::Nested, Some("feat/x"), None)]);

        let d = base_patch(ws, &[]).await.unwrap();
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/b/new.txt b/b/new.txt\n") && !p.contains("a/a.txt"), "{p}");
        assert_eq!(d.repos, vec![a, repo("b", RepoKind::Nested, Some("feat/x"), Some("main"))]);

        let s = status(ws, &[], WorkspaceKind::Cd).await.unwrap();
        let st = |path: &str, branch: &str, dirty| RepoStatus {
            path: path.into(),
            kind: RepoKind::Nested,
            branch: Some(branch.into()),
            ahead: None,
            behind: None,
            dirty,
        };
        let want = GitStatus {
            branch: None,
            ahead: None,
            behind: None,
            dirty: false,
            dirty_count: None,
            checked_at: None,
            workspace: WorkspaceKind::Cd,
            repos: vec![st("a", "main", true), st("b", "feat/x", false)],
            head: None,
            ongoing: None,
            conflicts: None,
            stashes: None,
        };
        assert!(s.checked_at.is_some());
        assert_eq!(GitStatus { checked_at: None, ..s }, want);
    }

    #[tokio::test]
    async fn status_reports_submodules_on_their_own() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        run(&w.join("lib"), &["checkout", "-q", "-b", "feat/y"]);
        fs::write(w.join("lib/n.txt"), "n\n").unwrap();
        let s = status(&w, &[], WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch.as_deref(), s.dirty), (Some("main"), true));
        let lib = RepoStatus {
            path: "lib".into(),
            kind: RepoKind::Submodule,
            branch: Some("feat/y".into()),
            ahead: None,
            behind: None,
            dirty: true,
        };
        assert_eq!(s.repos, vec![lib]);
    }

    #[tokio::test]
    async fn repos_past_the_patch_cap_are_marked_truncated() {
        let ws = tempfile::tempdir().unwrap();
        let ws = ws.path();
        for name in ["a", "b", "c"] {
            init(&ws.join(name));
        }
        fs::write(ws.join("a/a.txt"), "small\n").unwrap();
        fs::write(ws.join("b/big.txt"), "x\n".repeat(PATCH_MAX_BYTES)).unwrap();
        fs::write(ws.join("c/a.txt"), "small\n").unwrap();
        let d = uncommitted_patch(ws, &[]).await.unwrap();
        assert!(d.patch.unwrap().ends_with(patch_truncated()));
        let truncated: Vec<_> = d.repos.iter().map(|r| (r.path.as_str(), r.truncated)).collect();
        assert_eq!(truncated, [("a", false), ("b", true), ("c", true)]);
    }

    #[tokio::test]
    async fn turns_track_patch_count_and_discard_inside_submodules() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        let sub = w.join("lib");
        fs::write(sub.join("pre.txt"), "dirty before\n").unwrap();
        let snap = snapshot(&w).await.unwrap();
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 0);
        assert_eq!(patch_since(&w, &snap).await.unwrap().patch, None);

        fs::write(sub.join("pre.txt"), "dirty before\nand during\n").unwrap();
        fs::write(sub.join("a.txt"), "changed\n").unwrap();
        fs::write(sub.join("c.txt"), "committed\n").unwrap();
        run(&sub, &["add", "c.txt"]);
        run(&sub, &["commit", "-q", "-m", "turn"]);
        fs::write(w.join("top.txt"), "top\n").unwrap();
        let d = patch_since(&w, &snap).await.unwrap();
        let lib = repo("lib", RepoKind::Submodule, Some("main"), None);
        assert_eq!(d.repos, vec![root(Some("main"), None), lib]);
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/lib/pre.txt b/lib/pre.txt\n") && p.contains("\n dirty before\n+and during\n"));
        assert!(p.contains("b/lib/c.txt") && p.contains("b/top.txt") && !p.contains("Subproject commit"), "{p}");
        // top.txt, lib/pre.txt, lib/a.txt, lib/c.txt
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 4);

        assert_eq!(discard(&w, &snap).await.unwrap(), 4);
        assert_eq!(read(&sub, "pre.txt").as_deref(), Some("dirty before\n"));
        assert_eq!(read(&sub, "a.txt").as_deref(), Some("a\n"));
        assert!(!sub.join("c.txt").exists() && !w.join("top.txt").exists());
    }

    #[test]
    fn caps_patches_at_a_line_boundary() {
        let small = "diff --git a/a b/a\n+x\n".to_string();
        assert_eq!(cap_patch(small.clone()), small);
        let line = format!("+{}\n", "é".repeat(99));
        let big = line.repeat(PATCH_MAX_BYTES / line.len() + 10);
        let capped = cap_patch(big);
        assert!(capped.len() <= PATCH_MAX_BYTES, "{}", capped.len());
        assert!(capped.ends_with(patch_truncated()));
        let body = capped.strip_suffix(patch_truncated()).unwrap();
        assert!(body.ends_with('\n') && body.lines().all(|l| l == line.trim_end()));
    }

    #[test]
    fn dropping_a_scratch_index_deletes_it_and_its_lock() {
        let (a, b) = (Scratch::new(), Scratch::new());
        assert_ne!(a.0, b.0);
        let lock = PathBuf::from(format!("{}.lock", a.0.display()));
        fs::write(&a.0, "index").unwrap();
        fs::write(&lock, "").unwrap();
        let path = a.0.clone();
        drop(a);
        assert!(!path.exists() && !lock.exists());
    }

    #[tokio::test]
    async fn edits_to_already_dirty_files_count_without_their_porcelain_changing() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("README.md"), "dirty before\n").unwrap();
        fs::write(w.join("draft.txt"), "untracked before\n").unwrap();
        let snap = snapshot(&w).await.unwrap();
        fs::write(w.join("README.md"), "dirty before\nand during\n").unwrap();
        fs::write(w.join("draft.txt"), "untracked before\nand during\n").unwrap();
        assert_eq!(git(&w, &["status", "--porcelain"]).await.unwrap(), " M README.md\n?? draft.txt\n");
        assert_eq!(changed_since(&w, &snap).await.unwrap(), 2);
    }

    #[tokio::test]
    async fn a_huge_patch_is_cut_while_it_is_read() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("big.txt"), "x\n".repeat(4 << 20)).unwrap();
        let out = git_capped(&w, &["diff", "--no-index", "--", "/dev/null", "big.txt"], 1000).await.unwrap();
        assert_eq!(out.len(), 1000);
        let p = uncommitted_patch(&w, &[]).await.unwrap().patch.unwrap();
        assert!(p.len() <= PATCH_MAX_BYTES && p.ends_with(patch_truncated()), "{}", p.len());
    }

    #[test]
    fn repo_detection_needs_a_git_root() {
        let r = Remote::new();
        let w = r.clone_to("w");
        assert!(is_repo(&w));
        fs::create_dir_all(w.join("sub")).unwrap();
        assert!(!is_repo(&w.join("sub")));
    }
}
