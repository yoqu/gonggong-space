//! Writing a version into a replica (§3.1): every path is checked and every blob is fetched and verified first, then
//! files are replaced by rename one by one, so the tree is half-updated for milliseconds rather than for the length of
//! the downloads. `applying.json` records the version meanwhile, so a crash in between is resumed, not taken for edits.
use super::manifest::{self, Names, TEMP_SUFFIX, Tree};
use super::{Base, Replica, advance, path};
use crate::protocol::SyncEntry;
use crate::t;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum ApplyError {
    /// These paths were edited locally since the base (F12), or an ignored local file is in the way: nothing was
    /// written.
    Drift(Vec<String>),
    Failed(String),
}

impl From<String> for ApplyError {
    fn from(e: String) -> Self {
        ApplyError::Failed(e)
    }
}

impl std::fmt::Display for ApplyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApplyError::Drift(paths) => f.write_str(&t!("本地有改动：{paths}", paths = paths.join(t!("、")))),
            ApplyError::Failed(e) => f.write_str(e),
        }
    }
}

/// A version being written: applying `entries` to `base` gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Applying {
    pub version: u64,
    pub base: Base,
    pub entries: Vec<SyncEntry>,
}

impl Replica {
    /// Brings the tree from its base to `version` given that version's `entries` relative to the base; returns the
    /// rootHash of the tree afterwards. Refuses when a touched path differs from both the base and the target.
    /// `fetch(hash, to)` writes a blob to `to`; it is verified here.
    pub async fn apply<F, Fut>(&self, version: u64, entries: &[SyncEntry], fetch: F) -> Result<String, ApplyError>
    where
        F: Fn(String, PathBuf) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        self.apply_from(self.base()?, version, entries, fetch).await
    }

    /// `apply` from a given base instead of the stored one: aligning takes the tree as it is for the base (§3.5).
    pub async fn apply_from<F, Fut>(
        &self,
        base: Base,
        version: u64,
        entries: &[SyncEntry],
        fetch: F,
    ) -> Result<String, ApplyError>
    where
        F: Fn(String, PathBuf) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        let tree = self.tree().await?;
        self.apply_on(tree, base, version, entries, fetch).await
    }

    /// `apply_from` on a tree just scanned.
    pub(crate) async fn apply_on<F, Fut>(
        &self,
        mut tree: Tree,
        base: Base,
        version: u64,
        entries: &[SyncEntry],
        fetch: F,
    ) -> Result<String, ApplyError>
    where
        F: Fn(String, PathBuf) -> Fut,
        Fut: Future<Output = Result<(), String>>,
    {
        for e in entries {
            path::safe(&self.work, &e.path)?;
        }
        let deleted: HashSet<&str> = entries.iter().filter(|e| e.hash.is_none()).map(|e| e.path.as_str()).collect();
        let mut names = Names::default();
        let (mut drift, mut writes, mut deletes) = (vec![], vec![], vec![]);
        for e in entries {
            let now = tree.get(&e.path);
            if now == e.hash.as_deref().map(|h| (h, e.exec)) {
                continue;
            }
            if now != base.files.get(&e.path).map(|f| (f.hash.as_str(), f.exec)) {
                drift.push(e.path.clone());
            } else if let Some(hash) = &e.hash {
                if now.is_none() && self.in_the_way(&tree, &e.path, &deleted, &mut names) {
                    drift.push(e.path.clone());
                } else {
                    writes.push((e, hash, now.is_some_and(|(h, _)| h == hash.as_str())));
                }
            } else {
                deletes.push(&e.path);
            }
        }
        if !drift.is_empty() {
            return Err(ApplyError::Drift(drift));
        }

        let staging = self.state.join("staging");
        let result = async {
            let needed: BTreeSet<&str> = writes.iter().filter(|w| !w.2).map(|w| w.1.as_str()).collect();
            std::fs::create_dir_all(&staging).map_err(|e| t!("无法暂存下载内容：{e}", e = e))?;
            for hash in needed {
                let to = staging.join(hash);
                fetch(hash.to_string(), to.clone()).await?;
                if manifest::hash_file(&to).map_err(|e| t!("无法暂存下载内容：{e}", e = e))? != hash {
                    return Err(t!("下载内容校验失败：{hash}", hash = hash));
                }
            }
            self.set_applying(Some(&Applying { version, base: base.clone(), entries: entries.to_vec() }))?;
            self.write(&mut tree, &staging, &deletes, &writes)
        }
        .await;
        let _ = std::fs::remove_dir_all(&staging);
        result?;
        self.save_cache(&tree.files)?;
        self.set_base(&Base { version, files: advance(&base.files, entries) })?;
        self.set_applying(None)?;
        Ok(super::manifest_root(&tree.manifest()))
    }

    /// A local file the tree does not list (ignored) sits where a version writes: overwriting it would lose it. Not
    /// so for the other spelling of a path the version deletes (a case-only rename on a case-insensitive disk).
    fn in_the_way(&self, tree: &Tree, path: &str, deleted: &HashSet<&str>, names: &mut Names) -> bool {
        if !std::fs::symlink_metadata(self.work.join(path)).is_ok_and(|m| !m.is_dir()) {
            return false;
        }
        let spelled = names.on_disk(&self.work, path);
        !(spelled != path && deleted.contains(spelled.as_str()) && tree.files.contains_key(&spelled))
    }

    /// Deletions, then writes through a temp file renamed into place; `tree` follows.
    fn write(
        &self,
        tree: &mut Tree,
        staging: &Path,
        deletes: &[&String],
        writes: &[(&SyncEntry, &String, bool)],
    ) -> Result<(), String> {
        // Deletions first, so a file can take the place of a removed directory and the other way round.
        for path in deletes {
            match std::fs::remove_file(self.work.join(path)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(t!("无法删除 {path}：{e}", path = path, e = e));
                }
                _ => {}
            }
            tree.files.remove(path.as_str());
        }
        for path in deletes {
            prune(&self.work, path);
        }
        // Temp files go next to the blobs when that is the workspace's disk (a rename cannot cross disks).
        let beside = same_disk(staging, &self.work);
        for (i, (e, hash, same)) in writes.iter().enumerate() {
            let to = self.work.join(&e.path);
            let fail = |err: std::io::Error| t!("无法写入 {path}：{e}", path = e.path, e = err);
            if *same {
                set_exec(&to, e.exec, None).map_err(fail)?;
            } else {
                let parent = to.parent().expect("workspace paths have a parent");
                let name = to.file_name().unwrap_or_default().to_string_lossy();
                let tmp = match beside {
                    true => staging.join(format!("{i}{TEMP_SUFFIX}")),
                    false => parent.join(format!(".{name}{TEMP_SUFFIX}")),
                };
                let keep = std::fs::symlink_metadata(&to).ok().filter(|m| m.is_file()).map(|m| m.permissions());
                let written = std::fs::create_dir_all(parent)
                    .and_then(|_| std::fs::copy(staging.join(hash.as_str()), &tmp))
                    .and_then(|_| set_exec(&tmp, e.exec, keep))
                    .and_then(|_| std::fs::rename(&tmp, &to));
                if written.is_err() {
                    let _ = std::fs::remove_file(&tmp);
                }
                written.map_err(fail)?;
            }
            tree.files.insert(e.path.clone(), manifest::stat_written(&to, hash, e.exec).map_err(fail)?);
        }
        Ok(())
    }

    /// Writes (Some) or deletes (None) one file of the work tree: a conflict decision (F11).
    pub fn put(&self, path: &str, bytes: Option<&[u8]>, exec: bool) -> Result<(), String> {
        path::safe(&self.work, path)?;
        let to = self.work.join(path);
        let fail = |e: std::io::Error| t!("无法写入 {path}：{e}", path = path, e = e);
        match bytes {
            Some(bytes) => {
                std::fs::create_dir_all(to.parent().expect("workspace paths have a parent")).map_err(fail)?;
                std::fs::write(&to, bytes).and_then(|_| set_exec(&to, exec, None)).map_err(fail)
            }
            None => {
                match std::fs::remove_file(&to) {
                    Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(fail(e)),
                    _ => {}
                }
                prune(&self.work, path);
                Ok(())
            }
        }
    }
}

/// Removes the directories `path` leaves empty, up to the workspace root.
fn prune(work: &Path, path: &str) {
    for dir in Path::new(path).ancestors().skip(1).filter(|d| !d.as_os_str().is_empty()) {
        if std::fs::remove_dir(work.join(dir)).is_err() {
            break;
        }
    }
}

#[cfg(unix)]
fn same_disk(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    matches!((std::fs::metadata(a), std::fs::metadata(b)), (Ok(a), Ok(b)) if a.dev() == b.dev())
}

#[cfg(not(unix))]
fn same_disk(_a: &Path, _b: &Path) -> bool {
    false
}

/// Sets or clears the exec bits (where the file is readable), keeping the rest of its mode, or of `keep`'s.
#[cfg(unix)]
fn set_exec(path: &Path, exec: bool, keep: Option<std::fs::Permissions>) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = match keep {
        Some(p) => p.mode(),
        None => std::fs::metadata(path)?.permissions().mode(),
    };
    let mode = if exec { mode | (mode & 0o444) >> 2 | 0o100 } else { mode & !0o111 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn set_exec(_path: &Path, _exec: bool, _keep: Option<std::fs::Permissions>) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::testing::{Fixture, f};
    use super::super::{Manifest, hash_bytes, manifest_root};
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// An in-memory blob store that counts fetches.
    #[derive(Default)]
    struct Store {
        blobs: HashMap<String, Vec<u8>>,
        fetched: Mutex<Vec<String>>,
    }

    impl Store {
        fn put(&mut self, body: &str) -> String {
            let h = hash_bytes(body.as_bytes());
            self.blobs.insert(h.clone(), body.as_bytes().to_vec());
            h
        }

        async fn fetch(&self, hash: String, to: std::path::PathBuf) -> Result<(), String> {
            self.fetched.lock().unwrap().push(hash.clone());
            let bytes = self.blobs.get(&hash).ok_or_else(|| "missing".to_string())?;
            std::fs::write(to, bytes).map_err(|e| e.to_string())
        }
    }

    fn entry(path: &str, hash: Option<&str>, exec: bool) -> SyncEntry {
        SyncEntry { path: path.into(), hash: hash.map(Into::into), exec }
    }

    /// A replica whose base is version 1 = the files written.
    async fn at_v1(fx: &Fixture, files: &[(&str, &str)]) -> Replica {
        for (p, body) in files {
            fx.write(p, body);
        }
        let r = fx.replica();
        let files = r.tree().await.unwrap().manifest();
        r.set_base(&Base { version: 1, files }).unwrap();
        r
    }

    #[tokio::test]
    async fn writes_deletes_prunes_and_ends_at_the_target_root() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("keep.txt", "k"), ("edit.txt", "old"), ("old/deep/gone.txt", "g")]).await;
        let mut store = Store::default();
        let new = store.put("new");
        let added = store.put("added");
        let entries = vec![
            entry("edit.txt", Some(&new), false),
            entry("src/bin/run.sh", Some(&added), true),
            entry("old/deep/gone.txt", None, false),
        ];
        let root = r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap();

        let w = fx.work();
        assert_eq!(std::fs::read_to_string(w.join("edit.txt")).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(w.join("src/bin/run.sh")).unwrap(), "added");
        assert!(!w.join("old").exists());
        let expected = Manifest::from([
            ("edit.txt".into(), f("new", false)),
            ("keep.txt".into(), f("k", false)),
            ("src/bin/run.sh".into(), f("added", true)),
        ]);
        assert_eq!(r.base().unwrap(), Base { version: 2, files: expected.clone() });
        assert_eq!(root, manifest_root(&expected));
        let tree = r.tree().await.unwrap();
        assert_eq!(tree.manifest(), expected);
        assert_eq!(tree.hashed, 0, "written files go into the cache");
        assert!(!fx.home().join("sync/g1/b1/staging").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(w.join("src/bin/run.sh")).unwrap().permissions().mode() & 0o111, 0o111);
        }
    }

    #[tokio::test]
    async fn swaps_a_file_and_a_directory_and_fetches_each_blob_once() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a", "file"), ("b/x", "in dir"), ("same.txt", "s")]).await;
        let mut store = Store::default();
        let shared = store.put("shared");
        let entries = vec![
            entry("a", None, false),
            entry("a/inner", Some(&shared), false),
            entry("b/x", None, false),
            entry("b", Some(&shared), false),
            entry("same.txt", Some(&hash_bytes(b"s")), true),
        ];
        r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap();
        assert_eq!(std::fs::read_to_string(fx.work().join("a/inner")).unwrap(), "shared");
        assert_eq!(std::fs::read_to_string(fx.work().join("b")).unwrap(), "shared");
        assert_eq!(*store.fetched.lock().unwrap(), [shared], "an exec-only change downloads nothing");
        assert!(r.tree().await.unwrap().manifest()["same.txt"].exec);
    }

    #[tokio::test]
    async fn refuses_to_overwrite_local_edits() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "base"), ("b.txt", "b"), ("c.txt", "c")]).await;
        fx.write("a.txt", "local edit");
        std::fs::remove_file(fx.work().join("c.txt")).unwrap();
        let mut store = Store::default();
        let theirs = store.put("theirs");
        let entries = vec![
            entry("a.txt", Some(&theirs), false),
            entry("b.txt", None, false),
            entry("c.txt", Some(&theirs), false),
        ];
        let err = r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap_err();
        assert_eq!(err, ApplyError::Drift(vec!["a.txt".into(), "c.txt".into()]));
        assert_eq!(std::fs::read_to_string(fx.work().join("a.txt")).unwrap(), "local edit");
        assert!(fx.work().join("b.txt").exists(), "nothing applied");
        assert_eq!(r.base().unwrap().version, 1);
        assert!(store.fetched.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_local_file_already_at_the_target_is_not_drift() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "base")]).await;
        fx.write("a.txt", "same as theirs");
        fx.write("new.txt", "also theirs");
        let entries = vec![
            entry("a.txt", Some(&hash_bytes(b"same as theirs")), false),
            entry("new.txt", Some(&hash_bytes(b"also theirs")), false),
        ];
        let root = r.apply(2, &entries, |_, _| async { Err("no fetch".to_string()) }).await.unwrap();
        assert_eq!(root, manifest_root(&r.base().unwrap().files));
    }

    #[tokio::test]
    async fn a_bad_or_missing_blob_leaves_the_tree_untouched() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "base")]).await;
        let entries = vec![entry("a.txt", Some(&hash_bytes(b"x")), false), entry("b.txt", None, false)];
        let err = r
            .apply(2, &entries, |_, to: PathBuf| async move { std::fs::write(to, b"not x").map_err(|e| e.to_string()) })
            .await
            .unwrap_err();
        assert!(matches!(err, ApplyError::Failed(e) if e.contains("校验")));
        let err = r.apply(2, &entries, |_, _| async { Err("offline".to_string()) }).await.unwrap_err();
        assert_eq!(err, ApplyError::Failed("offline".into()));
        assert_eq!(std::fs::read_to_string(fx.work().join("a.txt")).unwrap(), "base");
        assert_eq!(r.base().unwrap().version, 1);
    }

    #[tokio::test]
    async fn a_version_with_an_unsafe_path_is_refused_whole() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "base")]).await;
        let mut store = Store::default();
        let evil = store.put("evil");
        for bad in ["../escape.txt", ".git/hooks/post-checkout", "GIT~1/config", ".gonggong/x", "/tmp/abs"] {
            let entries = vec![entry("a.txt", Some(&evil), false), entry(bad, Some(&evil), false)];
            let err = r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap_err();
            assert!(matches!(&err, ApplyError::Failed(e) if e.contains("不安全")), "{bad}: {err:?}");
            let err = r.apply(2, &[entry(bad, None, false)], |h, to| store.fetch(h, to)).await.unwrap_err();
            assert!(matches!(err, ApplyError::Failed(_)), "{bad}");
        }
        assert!(store.fetched.lock().unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(fx.work().join("a.txt")).unwrap(), "base");
        assert!(!fx.root.path().join("escape.txt").exists());
        assert!(!fx.work().join(".git/hooks/post-checkout").exists());
        assert!(r.put("../escape.txt", Some(b"x"), false).is_err());
        assert!(r.put(".git/config", None, false).is_err());
        assert!(fx.work().join(".git/config").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn never_writes_through_a_symlinked_directory() {
        let fx = Fixture::new();
        let outside = tempfile::tempdir().unwrap();
        let r = at_v1(&fx, &[("a.txt", "base")]).await;
        std::os::unix::fs::symlink(outside.path(), fx.work().join("link")).unwrap();
        let mut store = Store::default();
        let evil = store.put("evil");
        let err = r.apply(2, &[entry("link/x.txt", Some(&evil), false)], |h, to| store.fetch(h, to)).await.unwrap_err();
        assert!(matches!(err, ApplyError::Failed(_)));
        assert!(r.put("link/x.txt", Some(b"x"), false).is_err());
        assert!(!outside.path().join("x.txt").exists());
    }

    #[tokio::test]
    async fn an_ignored_local_file_in_the_way_is_a_local_edit_not_overwritten() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[(".gitignore", "*.local\n"), ("a.txt", "a")]).await;
        fx.write("db.local", "mine");
        let mut store = Store::default();
        let theirs = store.put("theirs");
        let err = r.apply(2, &[entry("db.local", Some(&theirs), false)], |h, to| store.fetch(h, to)).await.unwrap_err();
        assert_eq!(err, ApplyError::Drift(vec!["db.local".into()]));
        assert_eq!(std::fs::read_to_string(fx.work().join("db.local")).unwrap(), "mine");
    }

    #[tokio::test]
    async fn a_failed_write_leaves_no_temp_file_and_records_the_apply_to_resume() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "a"), ("x/keep.txt", "k")]).await;
        let mut store = Store::default();
        let new = store.put("new");
        // A file cannot replace the directory x, which keeps a file.
        let entries = vec![entry("a.txt", Some(&new), false), entry("x", Some(&new), false)];
        let err = r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap_err();
        assert!(matches!(err, ApplyError::Failed(_)));
        let leftovers = |dir: &Path| {
            walk(dir).into_iter().filter(|p| p.to_string_lossy().ends_with(".gg-sync")).collect::<Vec<_>>()
        };
        assert!(leftovers(&fx.work()).is_empty());
        assert!(leftovers(&fx.home()).is_empty());
        let applying = r.applying().unwrap().unwrap();
        assert_eq!((applying.version, applying.entries), (2, entries));
        assert_eq!(applying.base.version, 1);
        // Once the way is clear, applying again from the recorded base finishes the version.
        std::fs::remove_dir_all(fx.work().join("x")).unwrap();
        let entries =
            vec![entry("a.txt", Some(&new), false), entry("x/keep.txt", None, false), entry("x", Some(&new), false)];
        r.apply_from(applying.base, 2, &entries, |h, to| store.fetch(h, to)).await.unwrap();
        assert_eq!(r.applying().unwrap(), None);
        assert_eq!(std::fs::read_to_string(fx.work().join("x")).unwrap(), "new");
    }

    fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut out = vec![];
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if e.file_type().unwrap().is_dir() {
                out.extend(walk(&p));
            }
            out.push(p);
        }
        out
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn keeps_a_file_s_permissions_and_toggles_only_its_exec_bits() {
        use std::os::unix::fs::PermissionsExt;
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("private.txt", "p"), ("tool", "t")]).await;
        let mode = |p: &str| std::fs::metadata(fx.work().join(p)).unwrap().permissions().mode() & 0o777;
        std::fs::set_permissions(fx.work().join("private.txt"), std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::set_permissions(fx.work().join("tool"), std::fs::Permissions::from_mode(0o640)).unwrap();
        let files = r.tree().await.unwrap().manifest();
        r.set_base(&Base { version: 1, files }).unwrap();
        let mut store = Store::default();
        let (p2, t2) = (store.put("p2"), store.put("t2"));
        let entries = vec![entry("private.txt", Some(&p2), false), entry("tool", Some(&t2), true)];
        r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap();
        assert_eq!((mode("private.txt"), mode("tool")), (0o600, 0o750));
        r.apply(3, &[entry("tool", Some(&t2), false)], |h, to| store.fetch(h, to)).await.unwrap();
        assert_eq!(mode("tool"), 0o640);
    }

    /// Whether `dir` is on a case-insensitive file system (macOS and Windows by default).
    fn case_insensitive(dir: &Path) -> bool {
        std::fs::write(dir.join("case-probe"), "").unwrap();
        let yes = dir.join("CASE-PROBE").exists();
        std::fs::remove_file(dir.join("case-probe")).unwrap();
        yes
    }

    #[tokio::test]
    async fn a_case_only_rename_applies_and_the_tree_agrees_with_the_base() {
        let fx = Fixture::new();
        if !case_insensitive(&fx.work()) {
            return;
        }
        let r = at_v1(&fx, &[("readme.md", "r"), ("Src/a.rs", "a")]).await;
        crate::git::testing::run(&fx.work(), &["add", "-A"]);
        let h = hash_bytes(b"r");
        let a = hash_bytes(b"a");
        let entries = vec![
            entry("README.md", Some(&h), false),
            entry("Src/a.rs", None, false),
            entry("readme.md", None, false),
            entry("src/a.rs", Some(&a), false),
        ];
        let mut store = Store::default();
        store.put("r");
        store.put("a");
        let root = r.apply(2, &entries, |h, to| store.fetch(h, to)).await.unwrap();
        let names: Vec<_> = std::fs::read_dir(fx.work()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(names.contains(&"README.md".into()) && names.contains(&"src".into()), "{names:?}");
        let expected = Manifest::from([("README.md".into(), f("r", false)), ("src/a.rs".into(), f("a", false))]);
        assert_eq!(r.base().unwrap().files, expected);
        assert_eq!(r.tree().await.unwrap().manifest(), expected);
        assert_eq!(root, manifest_root(&expected));
    }
}
