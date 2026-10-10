//! Workspace git plumbing for partition mode (spec §5): shells out to the machine's `git` so its credentials apply.
use crate::protocol::{DiffRepo, GitStatus, PATCH_MAX_BYTES, RepoKind, RepoStatus, WorkspaceKind};
use crate::t;
use std::collections::{BTreeMap, BTreeSet};
use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncReadExt;

/// Daemon-private files inside a workspace; never reported as the agent's changes.
pub(crate) const PRIVATE_DIR: &str = ".gonggong/";
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
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

/// Raw stdout, for `-z` output whose paths may not be UTF-8.
pub(crate) async fn git_bytes(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    run_git_raw(dir, args, None).await
}

/// `index` swaps in another index file (GIT_INDEX_FILE), leaving the workspace's own index untouched.
async fn run_git(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    run_git_raw(dir, args, index).await.map(|out| String::from_utf8_lossy(&out).into_owned())
}

async fn run_git_raw(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut cmd = crate::proc::async_command("git");
    cmd.arg("-C").arg(dir).args(UNQUOTED).args(args).env("GIT_TERMINAL_PROMPT", "0").kill_on_drop(true);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    let out = cmd.output().await.map_err(|e| t!("无法执行 git：{e}", e = e))?;
    if out.status.success() { Ok(out.stdout) } else { Err(failure(&out.stderr)) }
}

fn failure(stderr: &[u8]) -> String {
    let err = String::from_utf8_lossy(stderr);
    err.lines().find(|l| !l.trim().is_empty()).unwrap_or(t!("git 执行失败")).trim().to_string()
}

/// Like [`git`], but reads at most `limit` bytes of output: past it git is killed and the output cut there.
async fn git_capped(dir: &Path, args: &[&str], limit: usize) -> Result<String, String> {
    let mut child = crate::proc::async_command("git")
        .arg("-C")
        .arg(dir)
        .args(UNQUOTED)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
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
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Branch/upstream position of the work tree; `ahead`, `behind` are None without an upstream.
struct Probe {
    branch: Option<String>,
    ahead: Option<u32>,
    behind: Option<u32>,
    dirty: bool,
}

async fn probe(dir: &Path) -> Result<Probe, String> {
    let branch = git(dir, &["symbolic-ref", "--short", "-q", "HEAD"]).await.ok().map(|b| b.trim().to_string());
    let upstream = match branch {
        Some(_) => git(dir, &["rev-parse", "--abbrev-ref", "@{upstream}"]).await.ok().map(|u| u.trim().to_string()),
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
    let dirty = !porcelain(dir).await?.is_empty();
    Ok(Probe { branch, ahead, behind, dirty })
}

/// The root's position plus every other repo's; Err when the workspace holds no repo at all.
pub async fn status(dir: &Path, workspace: WorkspaceKind) -> Result<GitStatus, String> {
    let found = discover(dir).await;
    if found.is_empty() {
        return Err(not_git().into());
    }
    let mut repos = vec![];
    for r in found.into_iter().filter(|r| r.kind != RepoKind::Root) {
        let p = probe(&dir.join(&r.path)).await?;
        let (branch, ahead, behind, dirty) = (p.branch, p.ahead, p.behind, p.dirty);
        repos.push(RepoStatus { path: r.path, kind: r.kind, branch, ahead, behind, dirty });
    }
    if !is_repo(dir) {
        return Ok(GitStatus { branch: None, ahead: None, behind: None, dirty: false, workspace, repos });
    }
    let p = probe(dir).await?;
    Ok(GitStatus { branch: p.branch, ahead: p.ahead, behind: p.behind, dirty: p.dirty, workspace, repos })
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
    /// Without submodule paths: their contents are tracked by `subs`.
    tree: BTreeMap<String, (String, Option<u64>)>,
    /// Tree object of the whole work tree (untracked files included): the baseline of the turn's patch.
    base: Option<String>,
    /// Checked-out submodules, by path.
    subs: BTreeMap<String, Snapshot>,
}

async fn head(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "-q", "--verify", "HEAD"]).await.ok().map(|h| h.trim().to_string())
}

/// Porcelain entries plus a content fingerprint, so edits to an already-dirty file still register.
async fn tree(dir: &Path, subs: &BTreeSet<String>) -> Result<BTreeMap<String, (String, Option<u64>)>, String> {
    let entries: Vec<_> = porcelain(dir).await?.into_iter().filter(|(path, _)| !subs.contains(path)).collect();
    let dir = dir.to_path_buf();
    // Dirty files can be large and many: read them off the async workers.
    tokio::task::spawn_blocking(move || {
        entries
            .into_iter()
            .map(|(path, xy)| {
                let hash = fingerprint(&dir.join(&path));
                (path, (xy, hash))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Streamed content hash; None when the path can't be read as a file.
fn fingerprint(path: &Path) -> Option<u64> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let (mut h, mut buf, mut len) = (DefaultHasher::new(), [0u8; 64 * 1024], 0u64);
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                h.write(&buf[..n]);
                len += n as u64;
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
    h.write_u64(len);
    Some(h.finish())
}

pub async fn snapshot(dir: &Path) -> Result<Snapshot, String> {
    let base = work_tree(dir).await.inspect_err(|e| tracing::warn!("work tree snapshot failed: {e}")).ok();
    let paths = submodules(dir).await;
    let mut subs = BTreeMap::new();
    for path in &paths {
        subs.insert(path.clone(), Box::pin(snapshot(&dir.join(path))).await?);
    }
    Ok(Snapshot { head: head(dir).await, tree: tree(dir, &paths).await?, base, subs })
}

/// Writes the current work tree (tracked + untracked, honoring .gitignore, without `.gonggong/`) as a tree object,
/// staging through a scratch copy of the index so the user's staging area stays as it was.
async fn work_tree(dir: &Path) -> Result<String, String> {
    let index = PathBuf::from(git(dir, &["rev-parse", "--path-format=absolute", "--git-path", "index"]).await?.trim());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let scratch = std::env::temp_dir().join(format!("gonggong-index-{}-{nanos}", std::process::id()));
    let copy = scratch.clone();
    tokio::task::spawn_blocking(move || if index.exists() { std::fs::copy(&index, &copy).map(drop) } else { Ok(()) })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| t!("无法复制 git index：{e}", e = e))?;
    // Naming an ignored path in a pathspec is an error, so the exclusion is only spelled out when git doesn't ignore it.
    let ignored = git(dir, &["check-ignore", "-q", ".gonggong"]).await.is_ok();
    let spec: &[&str] = if ignored { &["."] } else { &[".", ":(exclude).gonggong"] };
    let tree = async {
        run_git(dir, &[&["add", "-A", "--"][..], spec].concat(), Some(&scratch)).await?;
        run_git(dir, &["write-tree"], Some(&scratch)).await
    }
    .await;
    let _ = std::fs::remove_file(&scratch);
    Ok(tree?.trim().to_string())
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
    diff(dir, Scope::Turn(snap)).await
}

/// Everything not committed yet: each repo's HEAD (or the empty tree before its first commit) against its work tree.
pub async fn uncommitted_patch(dir: &Path) -> Result<Diff, String> {
    diff(dir, Scope::Uncommitted).await
}

/// Each repo's branch changes against its own main branch, uncommitted ones included; a repo on its main (or
/// detached, or without one) contributes nothing.
pub async fn base_patch(dir: &Path) -> Result<Diff, String> {
    diff(dir, Scope::Base).await
}

/// Each repo diffed on its own, outer before inner, paths prefixed with the repo's path; a parent leaves its
/// submodules' commit pointers out. Stops reading once the patch is sure to be capped.
async fn diff(dir: &Path, scope: Scope<'_>) -> Result<Diff, String> {
    let found = discover(dir).await;
    if found.is_empty() {
        return Err(not_git().into());
    }
    let mut patch = String::new();
    let mut repos = vec![];
    // Patch length once each repo's share is in (0: nothing to compare, usize::MAX: no room was left for it).
    let mut ends = vec![];
    for r in found {
        let rdir = dir.join(&r.path);
        let branch = branch(&rdir).await;
        let (from, base) = match &scope {
            Scope::Turn(snap) => match find(snap, &r.path) {
                Some(s) => (s.base.clone(), None),
                None => (Some(EMPTY_TREE.into()), None),
            },
            Scope::Uncommitted => (Some(head(&rdir).await.unwrap_or_else(|| EMPTY_TREE.into())), None),
            Scope::Base => match main_of(&rdir, branch.as_deref()).await {
                Some(main) => (Some(git(&rdir, &["merge-base", "HEAD", &main]).await?.trim().to_string()), Some(main)),
                None => (None, None),
            },
        };
        let room = (PATCH_MAX_BYTES + 1).saturating_sub(patch.len());
        ends.push(match from {
            None => 0,
            Some(_) if room == 0 => usize::MAX,
            Some(from) => {
                let prefix = if r.path.is_empty() { String::new() } else { format!("{}/", r.path) };
                diff_repo(&rdir, &prefix, &from, room, &mut patch).await?;
                patch.len()
            }
        });
        repos.push(DiffRepo { path: r.path, kind: r.kind, branch, base, truncated: false });
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
async fn diff_repo(dir: &Path, prefix: &str, from: &str, room: usize, patch: &mut String) -> Result<(), String> {
    let to = work_tree(dir).await?;
    let subs = submodules(dir).await;
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
    let mut n = touched(dir, snap).await?.len();
    for (path, sub) in live_subs(dir, snap) {
        n += Box::pin(changed_since(&dir.join(path), sub)).await?;
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
    let paths = touched(dir, snap).await?;
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
fn remove(root: &Path, file: &Path) -> Result<(), String> {
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

/// Distinct paths the turn touched: committed since the snapshot's HEAD ∪ work-tree entries whose state changed.
/// Submodule paths are left out: their contents count on their own.
async fn touched(dir: &Path, snap: &Snapshot) -> Result<BTreeSet<String>, String> {
    let mut subs = submodules(dir).await;
    subs.extend(snap.subs.keys().cloned());
    let mut paths = BTreeSet::new();
    if let Some(now) = head(dir).await
        && snap.head.as_ref() != Some(&now)
    {
        let base = snap.head.as_deref().unwrap_or(EMPTY_TREE);
        let diff = git(dir, &["diff", "--name-only", "-z", base, &now]).await?;
        let own = diff.split('\0').filter(|p| !p.is_empty() && !p.starts_with(PRIVATE_DIR) && !subs.contains(*p));
        paths.extend(own.map(String::from));
    }
    let now = tree(dir, &subs).await?;
    paths.extend(now.iter().filter(|(p, s)| snap.tree.get(*p) != Some(s)).map(|(p, _)| p.clone()));
    paths.extend(snap.tree.keys().filter(|p| !now.contains_key(*p)).cloned());
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
        assert_eq!(status(&w, WorkspaceKind::Managed).await.unwrap().behind, Some(0));
        run(&w, &["fetch", "-q"]);
        let s = status(&w, WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch.as_deref(), s.ahead, s.behind), (Some("main"), Some(0), Some(1)));
        run(&w, &["checkout", "-q", "--detach"]);
        let s = status(&w, WorkspaceKind::Managed).await.unwrap();
        assert_eq!((s.branch, s.ahead, s.behind), (None, None, None));
    }

    #[tokio::test]
    async fn untracked_files_make_the_tree_dirty_but_the_private_dir_does_not() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::create_dir_all(w.join(".gonggong")).unwrap();
        fs::write(w.join(".gonggong/state"), "x").unwrap();
        assert!(!status(&w, WorkspaceKind::Cd).await.unwrap().dirty);
        fs::write(w.join("new.txt"), "x").unwrap();
        assert!(status(&w, WorkspaceKind::Cd).await.unwrap().dirty);
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
        assert_eq!(uncommitted_patch(&w).await.unwrap().patch, None);
        fs::write(w.join("README.md"), "changed\n").unwrap();
        fs::write(w.join("new.txt"), "untracked\n").unwrap();
        let p = uncommitted_patch(&w).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/README.md b/README.md") && p.contains("+changed"));
        assert!(p.contains("b/new.txt") && p.contains("+untracked"));
    }

    #[tokio::test]
    async fn patches_keep_non_ascii_paths_readable() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("计划.md"), "中文\n").unwrap();
        let p = uncommitted_patch(&w).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/计划.md b/计划.md"), "{p}");
    }

    #[tokio::test]
    async fn base_patch_compares_a_branch_with_main_and_is_none_on_main() {
        let r = Remote::new();
        let w = r.clone_to("w");
        let on_main = base_patch(&w).await.unwrap();
        assert_eq!(on_main, Diff { patch: None, repos: vec![root(Some("main"), None)] });

        run(&w, &["checkout", "-q", "-b", "feat/x"]);
        fs::write(w.join("feature.txt"), "f\n").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "feature"]);
        fs::write(w.join("wip.txt"), "wip\n").unwrap();
        // Main moving on upstream must not show up as a removal on the branch (merge base).
        r.commit("later.txt", "later");
        run(&w, &["fetch", "-q"]);
        let b = base_patch(&w).await.unwrap();
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
        assert_eq!(status(&w, WorkspaceKind::Managed).await.unwrap().branch.as_deref(), Some("feat/hello"));
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
        assert_eq!(status(&w, WorkspaceKind::Managed).await.unwrap().ahead, Some(1));
    }

    #[tokio::test]
    async fn patches_show_submodule_contents_instead_of_their_commit_pointers() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "my lib");
        fs::write(w.join("my lib/a.txt"), "a\nedited\n").unwrap();
        fs::write(w.join("my lib/n.txt"), "new\n").unwrap();
        let p = uncommitted_patch(&w).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/my lib/a.txt b/my lib/a.txt\n") && p.contains("+edited\n"), "{p}");
        assert!(p.contains("b/my lib/n.txt") && p.contains("+new\n"), "{p}");

        // A submodule's uncommitted work starts at its own HEAD, not at the commit the parent records.
        run(&w.join("my lib"), &["add", "-A"]);
        run(&w.join("my lib"), &["commit", "-q", "-m", "sub"]);
        let d = uncommitted_patch(&w).await.unwrap();
        assert_eq!(d.patch, None, "the bumped pointer is no content change");
        fs::write(w.join("my lib/n.txt"), "new\nwip\n").unwrap();
        let p = uncommitted_patch(&w).await.unwrap().patch.unwrap();
        assert!(p.contains("diff --git a/my lib/n.txt b/my lib/n.txt\n") && p.contains(" new\n+wip\n"), "{p}");
        assert!(!p.contains("a.txt") && !p.contains("Subproject commit"), "{p}");
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
        let d = base_patch(&w).await.unwrap();
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
        assert_eq!(base_patch(&w).await.unwrap().patch, None);
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
        assert_eq!(uncommitted_patch(ws).await.unwrap_err(), not_git());
        assert_eq!(status(ws, WorkspaceKind::Cd).await.unwrap_err(), not_git());
        init(&ws.join("a"));
        init(&ws.join("b"));
        fs::write(ws.join("a/a.txt"), "a\nmore\n").unwrap();
        run(&ws.join("b"), &["checkout", "-q", "-b", "feat/x"]);
        fs::write(ws.join("b/new.txt"), "n\n").unwrap();
        run(&ws.join("b"), &["add", "-A"]);
        run(&ws.join("b"), &["commit", "-q", "-m", "n"]);

        let d = uncommitted_patch(ws).await.unwrap();
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/a/a.txt b/a/a.txt\n") && !p.contains("new.txt"), "{p}");
        let a = repo("a", RepoKind::Nested, Some("main"), None);
        assert_eq!(d.repos, vec![a.clone(), repo("b", RepoKind::Nested, Some("feat/x"), None)]);

        let d = base_patch(ws).await.unwrap();
        let p = d.patch.unwrap();
        assert!(p.contains("diff --git a/b/new.txt b/b/new.txt\n") && !p.contains("a/a.txt"), "{p}");
        assert_eq!(d.repos, vec![a, repo("b", RepoKind::Nested, Some("feat/x"), Some("main"))]);

        let s = status(ws, WorkspaceKind::Cd).await.unwrap();
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
            workspace: WorkspaceKind::Cd,
            repos: vec![st("a", "main", true), st("b", "feat/x", false)],
        };
        assert_eq!(s, want);
    }

    #[tokio::test]
    async fn status_reports_submodules_on_their_own() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        run(&w.join("lib"), &["checkout", "-q", "-b", "feat/y"]);
        fs::write(w.join("lib/n.txt"), "n\n").unwrap();
        let s = status(&w, WorkspaceKind::Managed).await.unwrap();
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
        let d = uncommitted_patch(ws).await.unwrap();
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
    fn fingerprints_follow_content_across_read_chunks() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a"), d.path().join("b"));
        let body = "y".repeat(200_000);
        fs::write(&a, &body).unwrap();
        fs::write(&b, &body).unwrap();
        assert_eq!(fingerprint(&a), fingerprint(&b));
        fs::write(&b, format!("{body}z")).unwrap();
        assert_ne!(fingerprint(&a), fingerprint(&b));
        assert_eq!(fingerprint(d.path()), None);
        assert_eq!(fingerprint(&d.path().join("missing")), None);
    }

    #[tokio::test]
    async fn a_huge_patch_is_cut_while_it_is_read() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::write(w.join("big.txt"), "x\n".repeat(4 << 20)).unwrap();
        let out = git_capped(&w, &["diff", "--no-index", "--", "/dev/null", "big.txt"], 1000).await.unwrap();
        assert_eq!(out.len(), 1000);
        let p = uncommitted_patch(&w).await.unwrap().patch.unwrap();
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
