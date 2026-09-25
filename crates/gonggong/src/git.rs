//! Workspace git plumbing for partition mode (spec §5): shells out to the machine's `git` so its credentials apply.
use crate::protocol::{GitStatus, PATCH_MAX_BYTES, WorkspaceKind};
use std::collections::{BTreeMap, BTreeSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;

/// Daemon-private files inside a workspace; never reported as the agent's changes.
pub(crate) const PRIVATE_DIR: &str = ".gonggong/";
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);
/// Appended to a patch cut at PATCH_MAX_BYTES.
pub const PATCH_TRUNCATED: &str = "… 补丁超过 512 KB，已截断\n";

/// Only a workspace root counts: a managed `_empty` dir nested in some other checkout is not a repo.
pub fn is_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

pub(crate) async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    run_git(dir, args, None).await
}

/// `index` swaps in another index file (GIT_INDEX_FILE), leaving the workspace's own index untouched.
async fn run_git(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    run_git_raw(dir, args, index).await.map(|out| String::from_utf8_lossy(&out).into_owned())
}

async fn run_git_raw(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args).env("GIT_TERMINAL_PROMPT", "0").kill_on_drop(true);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    let out = cmd.output().await.map_err(|e| format!("无法执行 git：{e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(err.lines().find(|l| !l.trim().is_empty()).unwrap_or("git 执行失败").trim().to_string())
    }
}

/// Branch/upstream position of the work tree; `upstream`, `ahead`, `behind` are None without an upstream.
struct Probe {
    branch: Option<String>,
    upstream: Option<String>,
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
    Ok(Probe { branch, upstream, ahead, behind, dirty })
}

pub async fn status(dir: &Path, workspace: WorkspaceKind) -> Result<GitStatus, String> {
    let p = probe(dir).await?;
    Ok(GitStatus { branch: p.branch, ahead: p.ahead, behind: p.behind, dirty: p.dirty, workspace })
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

/// Result of the default pre-turn action (spec §5.2).
pub struct PreTurn {
    pub fetch_error: Option<String>,
    /// Commits fast-forwarded; 0 when the tree was left alone.
    pub forwarded: u32,
    pub ff_error: Option<String>,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: Option<u32>,
    behind: Option<u32>,
    dirty: bool,
}

/// `git fetch --prune`, then (when `fast_forward`) fast-forward only when the tree is clean and the branch is strictly
/// behind its upstream. The owner's own directories are never moved (plan W9).
pub async fn pre_turn(dir: &Path, fast_forward: bool) -> Result<PreTurn, String> {
    let fetch_error = match tokio::time::timeout(FETCH_TIMEOUT, git(dir, &["fetch", "--prune", "--quiet"])).await {
        Ok(r) => r.err(),
        Err(_) => Some("超时".into()),
    };
    let mut p = probe(dir).await?;
    let (mut forwarded, mut ff_error) = (0, None);
    if let (true, false, Some(behind @ 1..), Some(0)) = (fast_forward, p.dirty, p.behind, p.ahead) {
        match git(dir, &["merge", "--ff-only", "--quiet", "@{upstream}"]).await {
            Ok(_) => {
                forwarded = behind;
                p = probe(dir).await?;
            }
            Err(e) => ff_error = Some(e),
        }
    }
    Ok(PreTurn {
        fetch_error,
        forwarded,
        ff_error,
        branch: p.branch,
        upstream: p.upstream,
        ahead: p.ahead,
        behind: p.behind,
        dirty: p.dirty,
    })
}

impl PreTurn {
    fn parts(&self) -> Vec<String> {
        let mut parts = vec![match &self.fetch_error {
            None => "fetch 完成".to_string(),
            Some(e) => format!("fetch 失败（{e}），以下基于本地已知的远端状态"),
        }];
        parts.push(match &self.branch {
            Some(b) => format!("当前分支 {b}"),
            None => "HEAD 处于游离状态（detached），未自动快进".into(),
        });
        let dirty = "工作树有未提交改动";
        match (&self.branch, &self.upstream, self.ahead.unwrap_or(0), self.behind.unwrap_or(0)) {
            (None, ..) => {}
            (Some(_), None, ..) => parts.push("当前分支没有上游，未自动快进".into()),
            (Some(_), Some(up), ahead, behind) => {
                if self.forwarded > 0 {
                    parts.push(format!("已自动快进 {} 个 commit 到 {up}", self.forwarded));
                } else if let Some(e) = &self.ff_error {
                    parts.push(format!("自动快进失败（{e}）"));
                } else if behind > 0 && self.dirty {
                    parts.push(format!("{dirty}，未自动快进"));
                } else if behind > 0 && ahead > 0 {
                    parts.push("本地与上游已分叉，未自动快进".into());
                }
                parts.push(format!("落后 {up} {behind} 个 commit，领先 {ahead} 个"));
            }
        }
        if self.dirty && !parts.iter().any(|p| p.starts_with(dirty)) {
            parts.push(dirty.into());
        }
        parts
    }

    /// Context block for the agent (spec §4.5).
    pub fn note(&self) -> String {
        format!("git 默认动作：{}。", self.parts().join("；"))
    }

    /// One-line run step for the side panel.
    pub fn step(&self) -> String {
        format!("git {}", self.parts().join("，"))
    }
}

/// Work-tree state at the start of a turn, to attribute changes to it afterwards.
pub struct Snapshot {
    head: Option<String>,
    tree: BTreeMap<String, (String, Option<u64>)>,
    /// Tree object of the whole work tree (untracked files included): the baseline of the turn's patch.
    base: Option<String>,
}

async fn head(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "-q", "--verify", "HEAD"]).await.ok().map(|h| h.trim().to_string())
}

/// Porcelain entries plus a content fingerprint, so edits to an already-dirty file still register.
async fn tree(dir: &Path) -> Result<BTreeMap<String, (String, Option<u64>)>, String> {
    Ok(porcelain(dir)
        .await?
        .into_iter()
        .map(|(path, xy)| {
            let hash = std::fs::read(dir.join(&path)).ok().map(|bytes| {
                let mut h = DefaultHasher::new();
                bytes.hash(&mut h);
                h.finish()
            });
            (path, (xy, hash))
        })
        .collect())
}

pub async fn snapshot(dir: &Path) -> Result<Snapshot, String> {
    let base = work_tree(dir).await.inspect_err(|e| tracing::warn!("work tree snapshot failed: {e}")).ok();
    Ok(Snapshot { head: head(dir).await, tree: tree(dir).await?, base })
}

/// Writes the current work tree (tracked + untracked, honoring .gitignore, without `.gonggong/`) as a tree object,
/// staging through a scratch copy of the index so the user's staging area stays as it was.
async fn work_tree(dir: &Path) -> Result<String, String> {
    let index = PathBuf::from(git(dir, &["rev-parse", "--path-format=absolute", "--git-path", "index"]).await?.trim());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let scratch = std::env::temp_dir().join(format!("gonggong-index-{}-{nanos}", std::process::id()));
    if index.exists() {
        std::fs::copy(&index, &scratch).map_err(|e| format!("无法复制 git index：{e}"))?;
    }
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

/// Unified diff of what changed since the snapshot (None when nothing did), capped at PATCH_MAX_BYTES.
pub async fn patch_since(dir: &Path, snap: &Snapshot) -> Result<Option<String>, String> {
    let Some(base) = &snap.base else { return Ok(None) };
    let now = work_tree(dir).await?;
    let args =
        ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", base, &now];
    let patch = git(dir, &args).await?;
    Ok((!patch.is_empty()).then(|| cap_patch(patch)))
}

fn cap_patch(mut patch: String) -> String {
    if patch.len() <= PATCH_MAX_BYTES {
        return patch;
    }
    let mut cut = PATCH_MAX_BYTES - PATCH_TRUNCATED.len();
    while !patch.is_char_boundary(cut) {
        cut -= 1;
    }
    cut = patch[..cut].rfind('\n').map_or(0, |i| i + 1);
    patch.truncate(cut);
    patch.push_str(PATCH_TRUNCATED);
    patch
}

pub async fn changed_since(dir: &Path, snap: &Snapshot) -> Result<usize, String> {
    Ok(touched(dir, snap).await?.len())
}

/// Puts back every path the turn touched as it was at the snapshot (plan D7), leaving other uncommitted work alone.
/// Paths dirty before the turn get their pre-turn content from the snapshot tree (index untouched); the rest go back
/// to the snapshot's HEAD (index too) or, if the turn created them, are removed. History is never rewritten.
/// Returns the number of paths restored.
pub async fn discard(dir: &Path, snap: &Snapshot) -> Result<usize, String> {
    let base = snap.base.as_deref().ok_or("这一轮开始时的工作区快照不可用")?;
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
                std::fs::create_dir_all(parent).map_err(|e| format!("无法还原 {path}：{e}"))?;
            }
            std::fs::write(&file, body).map_err(|e| format!("无法还原 {path}：{e}"))?;
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
        return Err(format!("无法删除 {}：{e}", file.display()));
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
async fn touched(dir: &Path, snap: &Snapshot) -> Result<BTreeSet<String>, String> {
    let mut paths = BTreeSet::new();
    if let Some(now) = head(dir).await
        && snap.head.as_ref() != Some(&now)
    {
        let base = snap.head.as_deref().unwrap_or(EMPTY_TREE);
        let diff = git(dir, &["diff", "--name-only", "-z", base, &now]).await?;
        paths.extend(diff.split('\0').filter(|p| !p.is_empty() && !p.starts_with(PRIVATE_DIR)).map(String::from));
    }
    let now = tree(dir).await?;
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

        pub fn url(&self) -> PathBuf {
            self.root.path().join("remote.git")
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
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{Remote, run};
    use super::*;
    use std::fs;

    fn status_of(pre: &PreTurn) -> (Option<&str>, Option<u32>, Option<u32>, bool) {
        (pre.branch.as_deref(), pre.ahead, pre.behind, pre.dirty)
    }

    #[tokio::test]
    async fn owner_directories_only_fetch() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.commit("a.txt", "a");
        let pre = pre_turn(&w, false).await.unwrap();
        assert_eq!(pre.forwarded, 0);
        assert_eq!(status_of(&pre), (Some("main"), Some(0), Some(1), false));
        assert!(!w.join("a.txt").exists());
    }

    #[tokio::test]
    async fn clean_and_behind_fast_forwards() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.commit("a.txt", "a");
        r.commit("b.txt", "b");
        let pre = pre_turn(&w, true).await.unwrap();
        assert_eq!(pre.forwarded, 2);
        assert_eq!(status_of(&pre), (Some("main"), Some(0), Some(0), false));
        assert!(w.join("b.txt").exists());
        assert_eq!(
            pre.step(),
            "git fetch 完成，当前分支 main，已自动快进 2 个 commit 到 origin/main，落后 origin/main 0 个 commit，领先 0 个"
        );
        assert!(pre.note().starts_with("git 默认动作：fetch 完成；当前分支 main；已自动快进 2 个 commit"));
        let s = status(&w, WorkspaceKind::Managed).await.unwrap();
        assert_eq!(
            s,
            GitStatus {
                branch: Some("main".into()),
                ahead: Some(0),
                behind: Some(0),
                dirty: false,
                workspace: WorkspaceKind::Managed
            }
        );
    }

    #[tokio::test]
    async fn dirty_tree_is_left_alone_and_reported() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.commit("a.txt", "a");
        fs::write(w.join("README.md"), "local edit\n").unwrap();
        let pre = pre_turn(&w, true).await.unwrap();
        assert_eq!(pre.forwarded, 0);
        assert_eq!(status_of(&pre), (Some("main"), Some(0), Some(1), true));
        assert!(!w.join("a.txt").exists());
        assert_eq!(
            pre.note(),
            "git 默认动作：fetch 完成；当前分支 main；工作树有未提交改动，未自动快进；落后 origin/main 1 个 commit，领先 0 个。"
        );
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
    async fn diverged_branch_is_not_fast_forwarded() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.commit("a.txt", "a");
        fs::write(w.join("mine.txt"), "m").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "mine"]);
        let pre = pre_turn(&w, true).await.unwrap();
        assert_eq!(pre.forwarded, 0);
        assert_eq!(status_of(&pre), (Some("main"), Some(1), Some(1), false));
        assert!(pre.note().contains("本地与上游已分叉，未自动快进；落后 origin/main 1 个 commit，领先 1 个"));
    }

    #[tokio::test]
    async fn branch_without_upstream() {
        let r = Remote::new();
        let w = r.clone_to("w");
        run(&w, &["checkout", "-q", "-b", "feat/x"]);
        let pre = pre_turn(&w, true).await.unwrap();
        assert_eq!(status_of(&pre), (Some("feat/x"), None, None, false));
        assert_eq!(pre.note(), "git 默认动作：fetch 完成；当前分支 feat/x；当前分支没有上游，未自动快进。");
    }

    #[tokio::test]
    async fn detached_head() {
        let r = Remote::new();
        let w = r.clone_to("w");
        run(&w, &["checkout", "-q", "--detach"]);
        let pre = pre_turn(&w, true).await.unwrap();
        assert_eq!(status_of(&pre), (None, None, None, false));
        assert!(pre.note().contains("HEAD 处于游离状态（detached），未自动快进"));
        assert_eq!(status(&w, WorkspaceKind::Managed).await.unwrap().branch, None);
    }

    #[tokio::test]
    async fn fetch_failure_is_reported_not_fatal() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::remove_dir_all(r.url()).unwrap();
        let pre = pre_turn(&w, true).await.unwrap();
        assert!(pre.fetch_error.is_some());
        assert!(pre.note().starts_with("git 默认动作：fetch 失败（"), "{}", pre.note());
        assert_eq!(status_of(&pre), (Some("main"), Some(0), Some(0), false));
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
        assert!(patch_since(&w, &snap).await.unwrap().is_some_and(|p| p.contains("new.txt")));
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
        assert_eq!(patch_since(&w, &snap).await.unwrap(), None);

        fs::write(w.join("README.md"), "hi\nmore\n").unwrap();
        fs::write(w.join("new.txt"), "fresh\n").unwrap();
        fs::remove_file(w.join("gone.txt")).unwrap();
        fs::write(w.join("pre.txt"), "dirty before\nand during\n").unwrap();
        fs::write(w.join("logo.bin"), [0u8, 159, 146, 150, 0, 1]).unwrap();
        fs::create_dir_all(w.join(".gonggong")).unwrap();
        fs::write(w.join(".gonggong/state"), "private\n").unwrap();
        let p = patch_since(&w, &snap).await.unwrap().unwrap();
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
        let p = patch_since(&w, &snap).await.unwrap().unwrap();
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

    #[test]
    fn caps_patches_at_a_line_boundary() {
        let small = "diff --git a/a b/a\n+x\n".to_string();
        assert_eq!(cap_patch(small.clone()), small);
        let line = format!("+{}\n", "é".repeat(99));
        let big = line.repeat(PATCH_MAX_BYTES / line.len() + 10);
        let capped = cap_patch(big);
        assert!(capped.len() <= PATCH_MAX_BYTES, "{}", capped.len());
        assert!(capped.ends_with(PATCH_TRUNCATED));
        let body = capped.strip_suffix(PATCH_TRUNCATED).unwrap();
        assert!(body.ends_with('\n') && body.lines().all(|l| l == line.trim_end()));
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
