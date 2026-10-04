//! Writing a version into a replica (§3.1): every blob is fetched and verified first, then files are replaced by
//! rename one by one, so the tree is half-updated for milliseconds rather than for the length of the downloads.
use super::{Base, Replica, advance, hash_bytes, manifest};
use crate::protocol::SyncEntry;
use crate::t;
use std::collections::BTreeSet;
use std::future::Future;
use std::path::Path;

#[derive(Debug, PartialEq, Eq)]
pub enum ApplyError {
    /// These paths were edited locally since the base (F12): nothing was written.
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

impl Replica {
    /// Brings the tree from its base to `version` given that version's `entries` relative to the base; returns the
    /// rootHash of the tree afterwards. Refuses when a touched path differs from both the base and the target.
    pub async fn apply<F, Fut>(&self, version: u64, entries: &[SyncEntry], fetch: F) -> Result<String, ApplyError>
    where
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<Vec<u8>, String>>,
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
        F: Fn(String) -> Fut,
        Fut: Future<Output = Result<Vec<u8>, String>>,
    {
        let mut tree = self.tree().await?;
        let (mut drift, mut writes, mut deletes) = (vec![], vec![], vec![]);
        for e in entries {
            let now = tree.files.get(&e.path).map(|s| (s.hash.as_str(), s.exec));
            if now == e.hash.as_deref().map(|h| (h, e.exec)) {
                continue;
            }
            if now != base.files.get(&e.path).map(|f| (f.hash.as_str(), f.exec)) {
                drift.push(e.path.clone());
            } else if let Some(hash) = &e.hash {
                writes.push((e, hash, now.is_some_and(|(h, _)| h == hash.as_str())));
            } else {
                deletes.push(&e.path);
            }
        }
        if !drift.is_empty() {
            return Err(ApplyError::Drift(drift));
        }

        let staging = self.state.join("staging");
        let needed: BTreeSet<&str> = writes.iter().filter(|w| !w.2).map(|w| w.1.as_str()).collect();
        for hash in needed {
            let bytes = fetch(hash.to_string()).await?;
            if hash_bytes(&bytes) != hash {
                return Err(t!("下载内容校验失败：{hash}", hash = hash).into());
            }
            std::fs::create_dir_all(&staging)
                .and_then(|_| std::fs::write(staging.join(hash), bytes))
                .map_err(|e| t!("无法暂存下载内容：{e}", e = e))?;
        }

        // Deletions first, so a file can take the place of a removed directory and the other way round.
        for path in &deletes {
            match std::fs::remove_file(self.work.join(path)) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(t!("无法删除 {path}：{e}", path = path, e = e).into());
                }
                _ => {}
            }
            tree.files.remove(*path);
        }
        for path in &deletes {
            prune(&self.work, path);
        }
        for (e, hash, same) in &writes {
            let to = self.work.join(&e.path);
            let fail = |err: std::io::Error| t!("无法写入 {path}：{e}", path = e.path, e = err);
            if *same {
                set_exec(&to, e.exec).map_err(fail)?;
            } else {
                let parent = to.parent().expect("workspace paths have a parent");
                let tmp = parent.join(format!(".{}.gg-sync", to.file_name().unwrap_or_default().to_string_lossy()));
                std::fs::create_dir_all(parent)
                    .and_then(|_| std::fs::copy(staging.join(hash.as_str()), &tmp))
                    .and_then(|_| set_exec(&tmp, e.exec))
                    .and_then(|_| std::fs::rename(&tmp, &to))
                    .map_err(fail)?;
            }
            tree.files.insert(e.path.clone(), manifest::stat_written(&to, hash, e.exec).map_err(fail)?);
        }
        let _ = std::fs::remove_dir_all(&staging);
        self.save_cache(&tree.files)?;
        self.set_base(&Base { version, files: advance(&base.files, entries) })?;
        Ok(super::manifest_root(&self.tree().await?.manifest()))
    }
}

impl Replica {
    /// Writes (Some) or deletes (None) one file of the work tree: a conflict decision (F11).
    pub fn put(&self, path: &str, bytes: Option<&[u8]>, exec: bool) -> Result<(), String> {
        let to = self.work.join(path);
        let fail = |e: std::io::Error| t!("无法写入 {path}：{e}", path = path, e = e);
        match bytes {
            Some(bytes) => {
                std::fs::create_dir_all(to.parent().expect("workspace paths have a parent")).map_err(fail)?;
                std::fs::write(&to, bytes).and_then(|_| set_exec(&to, exec)).map_err(fail)
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
fn set_exec(path: &Path, exec: bool) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(if exec { 0o755 } else { 0o644 }))
}

#[cfg(not(unix))]
fn set_exec(_path: &Path, _exec: bool) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::testing::{Fixture, f};
    use super::super::{Manifest, manifest_root};
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

        async fn fetch(&self, hash: String) -> Result<Vec<u8>, String> {
            self.fetched.lock().unwrap().push(hash.clone());
            self.blobs.get(&hash).cloned().ok_or_else(|| "missing".to_string())
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
        let root = r.apply(2, &entries, |h| store.fetch(h)).await.unwrap();

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
        r.apply(2, &entries, |h| store.fetch(h)).await.unwrap();
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
        let err = r.apply(2, &entries, |h| store.fetch(h)).await.unwrap_err();
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
        let root = r.apply(2, &entries, |_| async { Err("no fetch".to_string()) }).await.unwrap();
        assert_eq!(root, manifest_root(&r.base().unwrap().files));
    }

    #[tokio::test]
    async fn a_bad_or_missing_blob_leaves_the_tree_untouched() {
        let fx = Fixture::new();
        let r = at_v1(&fx, &[("a.txt", "base")]).await;
        let entries = vec![entry("a.txt", Some(&hash_bytes(b"x")), false), entry("b.txt", None, false)];
        let err = r.apply(2, &entries, |_| async { Ok(b"not x".to_vec()) }).await.unwrap_err();
        assert!(matches!(err, ApplyError::Failed(e) if e.contains("校验")));
        let err = r.apply(2, &entries, |_| async { Err("offline".to_string()) }).await.unwrap_err();
        assert_eq!(err, ApplyError::Failed("offline".into()));
        assert_eq!(std::fs::read_to_string(fx.work().join("a.txt")).unwrap(), "base");
        assert_eq!(r.base().unwrap().version, 1);
    }
}
