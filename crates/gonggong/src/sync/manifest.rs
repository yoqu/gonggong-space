//! The synced file set (F4): `git ls-files -co --exclude-standard`, stat'ed and hashed with a size/mtime cache.
use super::{FileRef, Issue, Manifest, Violation, hex};
use crate::git;
use crate::t;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

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
    /// Files read and hashed by this scan (the rest came from the cache).
    pub(super) hashed: usize,
}

impl Tree {
    pub fn manifest(&self) -> Manifest {
        self.files.iter().map(|(p, s)| (p.clone(), FileRef { hash: s.hash.clone(), exec: s.exec })).collect()
    }
}

pub(super) async fn scan(work: &Path, cache: BTreeMap<String, Stat>) -> Result<Tree, String> {
    let listed = git::git_bytes(work, &["ls-files", "-co", "--exclude-standard", "-z"]).await?;
    let work = work.to_path_buf();
    tokio::task::spawn_blocking(move || scan_listed(&work, &listed, &cache)).await.map_err(|e| e.to_string())?
}

fn scan_listed(work: &Path, listed: &[u8], cache: &BTreeMap<String, Stat>) -> Result<Tree, String> {
    let mut tree = Tree::default();
    // A nested repository is listed as `dir/`; submodule gitlinks and deleted tracked files fail the is_file check.
    for raw in listed.split(|b| *b == 0).filter(|r| !r.is_empty() && !r.ends_with(b"/")) {
        let Ok(path) = std::str::from_utf8(raw) else {
            tree.odd.push(Violation { path: String::from_utf8_lossy(raw).into_owned(), issue: Issue::NotUtf8 });
            continue;
        };
        if path.starts_with(git::PRIVATE_DIR) || tree.files.contains_key(path) {
            continue;
        }
        let full = work.join(path);
        let Ok(meta) = std::fs::symlink_metadata(&full) else { continue };
        if meta.file_type().is_symlink() {
            tree.odd.push(Violation { path: path.into(), issue: Issue::Symlink });
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let size = meta.len();
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
        let mtime = mtime as u64;
        let cached = cache.get(path);
        let hash = match cached {
            Some(c) if c.size == size && c.mtime == mtime => c.hash.clone(),
            _ => {
                tree.hashed += 1;
                hash_file(&full).map_err(|e| t!("无法读取 {path}：{e}", path = path, e = e))?
            }
        };
        tree.files.insert(path.into(), Stat { size, mtime, hash, exec: exec_bit(&meta, cached) });
    }
    Ok(tree)
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
        fx.write("secret.env", "excluded");
        fx.write(".git/info/exclude", "secret.env\n");
        fx.write(".gonggong/attachments/m1/a.png", "private");
        fx.write("中文/文件.md", "unicode");
        let tree = fx.replica().tree().await.unwrap();
        assert_eq!(paths(&tree), [".gitignore", "notes/todo.md", "src/main.rs", "中文/文件.md"]);
        assert_eq!(tree.files["src/main.rs"].hash, hash_bytes(b"fn main() {}\n"));
        assert_eq!(tree.files["src/main.rs"].size, 13);
        assert!(tree.odd.is_empty());
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
