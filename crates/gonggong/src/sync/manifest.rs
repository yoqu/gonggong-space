//! The synced file set (F4): `git ls-files -co`, stat'ed and hashed with a size/mtime cache. Only ignore rules the
//! repo shares count (`.gitignore` files, which sync too), never `.git/info/exclude` or a user's global excludes:
//! replicas on different machines must agree on which files are synced.
use super::{FileRef, Issue, Manifest, Violation, hex};
use crate::git;
use crate::t;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Suffix of the temp file a write goes through; one left behind is an apply cut off.
pub(super) const TEMP_SUFFIX: &str = ".gg-sync";

/// A file as last scanned; `mtime` in nanoseconds since the epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stat {
    pub size: u64,
    pub mtime: u64,
    pub hash: String,
    pub exec: bool,
}

/// The work tree's synced files, plus entries that can never sync (symlinks, non-UTF-8 paths; F17).
#[derive(Debug, Default)]
pub struct Tree {
    pub files: BTreeMap<String, Stat>,
    pub odd: Vec<Violation>,
    /// Sparse-checkout (skip-worktree) entries, absent on disk, and the base's state of those it has.
    pub(super) sparse: Vec<String>,
    pub(super) kept: Manifest,
    /// Files read and hashed by this scan (the rest came from the cache).
    pub(super) hashed: usize,
}

impl Tree {
    pub fn manifest(&self) -> Manifest {
        let files = self.files.iter().map(|(p, s)| (p.clone(), FileRef { hash: s.hash.clone(), exec: s.exec }));
        files.chain(self.kept.iter().map(|(p, f)| (p.clone(), f.clone()))).collect()
    }

    /// A path's (hash, exec) as `manifest()` has it.
    pub(super) fn get(&self, path: &str) -> Option<(&str, bool)> {
        match self.files.get(path) {
            Some(s) => Some((s.hash.as_str(), s.exec)),
            None => self.kept.get(path).map(|f| (f.hash.as_str(), f.exec)),
        }
    }
}

/// The tree, and the cache it was scanned with (to tell whether it changed).
pub(super) async fn scan(work: &Path, cache: BTreeMap<String, Stat>) -> Result<(Tree, BTreeMap<String, Stat>), String> {
    let excludes = format!("core.excludesFile={}", if cfg!(windows) { "NUL" } else { "/dev/null" });
    let args = [
        "-c",
        &excludes,
        "ls-files",
        "-cot",
        "--exclude-per-directory=.gitignore",
        "-z",
        "--",
        ".",
        ":(exclude).gonggong",
    ];
    let listed = git::git_bytes(work, &args).await?;
    let work = work.to_path_buf();
    tokio::task::spawn_blocking(move || scan_listed(&work, &listed, &cache).map(|t| (t, cache)))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_listed(work: &Path, listed: &[u8], cache: &BTreeMap<String, Stat>) -> Result<Tree, String> {
    let mut tree = Tree::default();
    let mut names = case_insensitive(work).then(Names::default);
    // `<tag> <path>`: `?` untracked (as spelled on disk), `S` skip-worktree, else tracked (as spelled in the index).
    // A nested repository is listed as `dir/`; submodule gitlinks and deleted tracked files fail the is_file check.
    for raw in listed.split(|b| *b == 0).filter(|r| r.len() > 2 && !r.ends_with(b"/")) {
        let (tag, raw) = (raw[0], &raw[2..]);
        let Ok(path) = std::str::from_utf8(raw) else {
            tree.odd.push(Violation { path: String::from_utf8_lossy(raw).into_owned(), issue: Issue::NotUtf8 });
            continue;
        };
        if tag == b'S' {
            tree.sparse.push(path.into());
            continue;
        }
        let path = match names.as_mut() {
            Some(names) if tag != b'?' => names.on_disk(work, path),
            _ => path.to_string(),
        };
        if tree.files.contains_key(&path) {
            continue;
        }
        let full = work.join(&path);
        if full.file_name().is_some_and(|n| {
            let n = n.to_string_lossy();
            n.starts_with('.') && n.ends_with(TEMP_SUFFIX)
        }) {
            let _ = std::fs::remove_file(&full);
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&full) else { continue };
        if meta.file_type().is_symlink() {
            tree.odd.push(Violation { path, issue: Issue::Symlink });
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let size = meta.len();
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
        let mtime = mtime as u64;
        let cached = cache.get(&path);
        let hash = match cached {
            Some(c) if c.size == size && c.mtime == mtime => c.hash.clone(),
            _ => {
                tree.hashed += 1;
                hash_file(&full).map_err(|e| t!("无法读取 {path}：{e}", path = path, e = e))?
            }
        };
        let exec = exec_bit(&meta, cached);
        tree.files.insert(path, Stat { size, mtime, hash, exec });
    }
    Ok(tree)
}

/// Whether the workspace's file system ignores case (macOS and Windows by default).
fn case_insensitive(work: &Path) -> bool {
    work.join(".git").exists() && work.join(".GIT").exists()
}

/// Directory listings, to spell paths as they are on disk: after a case-only rename on a case-insensitive file system
/// the index keeps the old spelling, while the file (and every other replica) has the new one.
#[derive(Default)]
pub(super) struct Names(HashMap<PathBuf, Vec<String>>);

impl Names {
    /// `path` with each component spelled as on disk; a component not found ignoring case stays as it is.
    pub(super) fn on_disk(&mut self, work: &Path, path: &str) -> String {
        let mut dir = PathBuf::new();
        let mut out = vec![];
        for seg in path.split('/') {
            let names = self.0.entry(dir.clone()).or_insert_with(|| {
                let entries = std::fs::read_dir(work.join(&dir)).into_iter().flatten().flatten();
                entries.map(|e| e.file_name().to_string_lossy().into_owned()).collect()
            });
            let lower = seg.to_lowercase();
            let name = match names.iter().any(|n| n == seg) {
                true => seg.to_string(),
                false => names.iter().find(|n| n.to_lowercase() == lower).cloned().unwrap_or_else(|| seg.into()),
            };
            dir.push(&name);
            out.push(name);
        }
        out.join("/")
    }
}

/// Windows has no exec bit: the one last recorded (by a scan elsewhere or an apply) is kept.
#[cfg(unix)]
fn exec_bit(meta: &std::fs::Metadata, _cached: Option<&Stat>) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn exec_bit(_meta: &std::fs::Metadata, cached: Option<&Stat>) -> bool {
    cached.is_some_and(|c| c.exec)
}

pub(super) fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0; 64 * 1024];
    loop {
        match file.read(&mut buf)? {
            0 => return Ok(hex(&h.finalize())),
            n => h.update(&buf[..n]),
        }
    }
}

/// The cache entry of a file just written with known content.
pub(super) fn stat_written(path: &Path, hash: &str, exec: bool) -> std::io::Result<Stat> {
    let meta = std::fs::metadata(path)?;
    let mtime = meta.modified()?.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos()) as u64;
    Ok(Stat { size: meta.len(), mtime, hash: hash.into(), exec })
}

#[cfg(test)]
mod tests {
    use super::super::testing::Fixture;
    use super::super::{Replica, hash_bytes};
    use super::*;
    use crate::git::testing::{Remote, run};

    fn paths(tree: &Tree) -> Vec<&str> {
        tree.files.keys().map(String::as_str).collect()
    }

    #[tokio::test]
    async fn lists_tracked_and_untracked_files_honoring_ignores_without_git_internals() {
        let fx = Fixture::new();
        let w = fx.work();
        fx.write(".gitignore", "*.log\nbuild/\n");
        fx.write("src/main.rs", "fn main() {}\n");
        fx.write("tracked-then-deleted.txt", "x");
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "init"]);
        std::fs::remove_file(w.join("tracked-then-deleted.txt")).unwrap();
        fx.write("notes/todo.md", "untracked");
        fx.write("debug.log", "ignored");
        fx.write("build/out.js", "ignored");
        fx.write("中文/文件.md", "unicode");
        fx.write(".gonggong/attachments/m1/a.png", "private");
        let tree = fx.replica().tree().await.unwrap();
        assert_eq!(paths(&tree), [".gitignore", "notes/todo.md", "src/main.rs", "中文/文件.md"]);
        assert_eq!(tree.files["src/main.rs"].hash, hash_bytes(b"fn main() {}\n"));
        assert_eq!(tree.files["src/main.rs"].size, 13);
        assert!(tree.odd.is_empty());
    }

    #[tokio::test]
    async fn only_ignore_rules_shared_through_the_repo_count() {
        let fx = Fixture::new();
        let w = fx.work();
        fx.write(".gitignore", "*.log\n");
        fx.write("debug.log", "ignored by the repo");
        fx.write("secret.env", "excluded on this machine only");
        fx.write(".git/info/exclude", "secret.env\n.gonggong/\n");
        fx.write("notes.mine", "excluded by this user's global rules");
        fx.write("global-ignore", "*.mine\n");
        run(&w, &["config", "core.excludesFile", &w.join("global-ignore").to_string_lossy()]);
        fx.write(".gonggong/attachments/m1/a.png", "private");
        let tree = fx.replica().tree().await.unwrap();
        assert_eq!(paths(&tree), [".gitignore", "global-ignore", "notes.mine", "secret.env"]);
    }

    #[tokio::test]
    async fn removes_temp_files_an_interrupted_apply_left() {
        let fx = Fixture::new();
        fx.write("a.txt", "a");
        fx.write("src/.b.rs.gg-sync", "half");
        let tree = fx.replica().tree().await.unwrap();
        assert_eq!(paths(&tree), ["a.txt"]);
        assert!(!fx.work().join("src/.b.rs.gg-sync").exists());
    }

    #[tokio::test]
    async fn sparse_checkout_entries_are_kept_at_the_base_not_taken_as_deleted() {
        let fx = Fixture::new();
        let w = fx.work();
        fx.write("a.txt", "a");
        fx.write("far/b.txt", "b");
        run(&w, &["add", "-A"]);
        let r = fx.replica();
        let files = r.tree().await.unwrap().manifest();
        r.set_base(&super::super::Base { version: 1, files: files.clone() }).unwrap();
        run(&w, &["update-index", "--skip-worktree", "far/b.txt"]);
        std::fs::remove_dir_all(w.join("far")).unwrap();
        let tree = r.tree().await.unwrap();
        assert_eq!(paths(&tree), ["a.txt"]);
        assert_eq!(tree.manifest(), files);
    }

    #[tokio::test]
    async fn reports_the_on_disk_spelling_after_a_case_only_rename() {
        let fx = Fixture::new();
        let w = fx.work();
        fx.write("probe", "");
        if !w.join("PROBE").exists() {
            return;
        }
        std::fs::remove_file(w.join("probe")).unwrap();
        fx.write("readme.md", "r");
        fx.write("Docs/guide.md", "g");
        run(&w, &["add", "-A"]);
        std::fs::rename(w.join("readme.md"), w.join("README.md")).unwrap();
        std::fs::rename(w.join("Docs"), w.join("docs")).unwrap();
        let tree = fx.replica().tree().await.unwrap();
        assert_eq!(paths(&tree), ["README.md", "docs/guide.md"]);
    }

    #[tokio::test]
    async fn the_cache_is_written_only_when_it_changed() {
        let fx = Fixture::new();
        fx.write("a.txt", "a");
        let r = fx.replica();
        r.tree().await.unwrap();
        let cache = fx.home().join("sync/g1/b1/cache.json");
        let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000);
        std::fs::File::options().write(true).open(&cache).unwrap().set_modified(old).unwrap();
        r.tree().await.unwrap();
        assert_eq!(std::fs::metadata(&cache).unwrap().modified().unwrap(), old);
        fx.write("b.txt", "b");
        r.tree().await.unwrap();
        assert_ne!(std::fs::metadata(&cache).unwrap().modified().unwrap(), old);
    }

    #[tokio::test]
    async fn skips_submodules_and_nested_repositories() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "vendor/lib");
        std::fs::create_dir_all(w.join("nested")).unwrap();
        run(&w.join("nested"), &["init", "-q"]);
        std::fs::write(w.join("nested/inner.txt"), "x").unwrap();
        let tree = Replica::new(&r.root.path().join("home"), "g", "b", w).tree().await.unwrap();
        assert_eq!(paths(&tree), [".gitmodules", "README.md"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn records_the_exec_bit_and_reports_symlinks() {
        use std::os::unix::fs::PermissionsExt;
        let fx = Fixture::new();
        fx.write("run.sh", "#!/bin/sh\n");
        fx.write("plain.txt", "p");
        std::fs::set_permissions(fx.work().join("run.sh"), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink("plain.txt", fx.work().join("link")).unwrap();
        let tree = fx.replica().tree().await.unwrap();
        assert!(tree.files["run.sh"].exec);
        assert!(!tree.files["plain.txt"].exec);
        assert!(!tree.files.contains_key("link"));
        assert_eq!(tree.odd, [Violation { path: "link".into(), issue: Issue::Symlink }]);
    }

    #[tokio::test]
    async fn rehashes_only_files_whose_size_or_mtime_changed() {
        let fx = Fixture::new();
        for i in 0..5 {
            fx.write(&format!("f{i}.txt"), "same");
        }
        let r = fx.replica();
        assert_eq!(r.tree().await.unwrap().hashed, 5);
        assert_eq!(r.tree().await.unwrap().hashed, 0);
        fx.write("f2.txt", "longer body");
        fx.write("new.txt", "n");
        let tree = r.tree().await.unwrap();
        assert_eq!(tree.hashed, 2);
        assert_eq!(tree.files["f2.txt"].hash, hash_bytes(b"longer body"));
        std::fs::remove_file(fx.work().join("f0.txt")).unwrap();
        let tree = r.tree().await.unwrap();
        assert_eq!((tree.hashed, tree.files.len()), (0, 5));
    }
}
