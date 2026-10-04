//! Force sync on the daemon side (docs/plan/强制同步-开发计划.md §3, S3): a replica's manifest and its diff against the
//! last known version, the cross-platform and size checks, blob transfer, apply and three-way merge.
//! A replica is one (group, bot) managed workspace; its state lives in `<home>/sync/<group>/<bot>/`, never in the
//! workspace: `cache.json` (path → size, mtime, hash, exec, so only touched files are rehashed), `base.json` (the
//! manifest at the version the replica last matched; it exists once the replica joined), `work` (the workspace path,
//! so idle replicas can be found) and `issue.json` (why it stopped taking versions, if it did).
mod apply;
mod check;
mod client;
mod manifest;
mod merge;

pub use apply::ApplyError;
pub use check::{Issue, Violation, check};
pub use client::Client;
pub use manifest::{Stat, Tree};
pub use merge::Merge;

use crate::git;
use crate::protocol::{SyncChange, SyncEntry, SyncReplicaIssue};
use crate::t;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// A live file in a version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileRef {
    pub hash: String,
    pub exec: bool,
}

/// Path → live file; ordered by the path's UTF-8 bytes, as rootHash wants.
pub type Manifest = BTreeMap<String, FileRef>;

/// The version a replica last matched, and that version's manifest.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Base {
    pub version: u64,
    pub files: Manifest,
}

pub struct Replica {
    state: PathBuf,
    work: PathBuf,
    backups: PathBuf,
    group: String,
    bot: String,
}

impl Replica {
    pub fn new(home: &Path, group: &str, bot: &str, work: PathBuf) -> Self {
        Replica {
            state: home.join("sync").join(group).join(bot),
            work,
            backups: home.join("backups").join(group),
            group: group.into(),
            bot: bot.into(),
        }
    }

    /// The joined replicas of `group` on this machine.
    pub fn joined_in(home: &Path, group: &str) -> Vec<Replica> {
        let Ok(dirs) = std::fs::read_dir(home.join("sync").join(group)) else { return vec![] };
        dirs.flatten()
            .filter_map(|d| {
                let work = std::fs::read_to_string(d.path().join("work")).ok()?;
                let r = Replica::new(home, group, &d.file_name().to_string_lossy(), work.into());
                r.joined().then_some(r)
            })
            .collect()
    }

    pub fn work(&self) -> &Path {
        &self.work
    }

    pub fn group(&self) -> &str {
        &self.group
    }

    pub fn bot(&self) -> &str {
        &self.bot
    }

    /// It matched a version once (mode switch or join, S8); until then its tree is not synced.
    pub fn joined(&self) -> bool {
        self.state.join("base.json").is_file()
    }

    pub fn issue(&self) -> Result<Option<SyncReplicaIssue>, String> {
        read_json(&self.state.join("issue.json"))
    }

    pub fn set_issue(&self, issue: Option<SyncReplicaIssue>) -> Result<(), String> {
        write_json(&self.state.join("issue.json"), &issue)
    }

    /// Version 0 with no files before the replica ever matched one.
    pub fn base(&self) -> Result<Base, String> {
        read_json(&self.state.join("base.json"))
    }

    pub fn set_base(&self, base: &Base) -> Result<(), String> {
        write_json(&self.state.join("base.json"), base)?;
        std::fs::write(self.state.join("work"), self.work.to_string_lossy().as_bytes())
            .map_err(|e| t!("无法保存同步状态：{e}", e = e))
    }

    /// The work tree now (F4), rehashing only files whose size or mtime changed since the last scan.
    pub async fn tree(&self) -> Result<Tree, String> {
        let cache: BTreeMap<String, Stat> = read_json(&self.state.join("cache.json"))?;
        let tree = manifest::scan(&self.work, cache).await?;
        self.save_cache(&tree.files)?;
        Ok(tree)
    }

    fn save_cache(&self, files: &BTreeMap<String, Stat>) -> Result<(), String> {
        write_json(&self.state.join("cache.json"), files)
    }

    /// Leaves force sync: the replica's state goes (its group's directory too once empty); the work tree stays.
    pub fn forget(&self) -> Result<(), String> {
        match std::fs::remove_dir_all(&self.state) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(t!("无法清除同步状态：{e}", e = e));
            }
            _ => {}
        }
        if let Some(group) = self.state.parent() {
            let _ = std::fs::remove_dir(group);
        }
        Ok(())
    }

    /// Copies the existing ones of `paths` to `<home>/backups/<group>/<MMDD-HHMMSS>-<bot>/` before they are
    /// overwritten or discarded; None when none exists.
    pub fn backup(&self, paths: &[String]) -> Result<Option<PathBuf>, String> {
        let present: Vec<_> = paths.iter().filter(|p| self.work.join(p).is_file()).collect();
        if present.is_empty() {
            return Ok(None);
        }
        let stamp = chrono::Local::now().format("%m%d-%H%M%S");
        let mut dir = self.backups.join(format!("{stamp}-{}", self.bot));
        for n in 2.. {
            if !dir.exists() {
                break;
            }
            dir = self.backups.join(format!("{stamp}-{}-{n}", self.bot));
        }
        for p in present {
            let to = dir.join(p);
            std::fs::create_dir_all(to.parent().expect("backup paths have a parent"))
                .and_then(|_| std::fs::copy(self.work.join(p), &to))
                .map_err(|e| t!("备份失败：{path}：{e}", path = p, e = e))?;
        }
        Ok(Some(dir))
    }
}

/// Changes taking `base` to `current`, each with the path's hash in `base` (F6).
pub fn diff(base: &Manifest, current: &Manifest) -> Vec<SyncChange> {
    let mut out: Vec<_> = current
        .iter()
        .filter(|(p, f)| base.get(*p) != Some(f))
        .map(|(p, f)| SyncChange {
            path: p.clone(),
            hash: Some(f.hash.clone()),
            exec: f.exec,
            base_hash: base.get(p).map(|b| b.hash.clone()),
        })
        .chain(base.iter().filter(|(p, _)| !current.contains_key(*p)).map(|(p, b)| SyncChange {
            path: p.clone(),
            hash: None,
            exec: false,
            base_hash: Some(b.hash.clone()),
        }))
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Whether the tree differs from the version it last matched: local edits (F12).
pub fn drift(base: &Manifest, current: &Manifest) -> bool {
    base != current
}

/// `base` with a version's entries applied (hash None = deleted).
pub fn advance(base: &Manifest, entries: &[SyncEntry]) -> Manifest {
    let mut out = base.clone();
    for e in entries {
        match &e.hash {
            Some(h) => out.insert(e.path.clone(), FileRef { hash: h.clone(), exec: e.exec }),
            None => out.remove(&e.path),
        };
    }
    out
}

/// rootHash (F14): sha256 of the same text as the protocol's `syncRootText`.
pub fn root_hash(entries: &[SyncEntry]) -> String {
    let mut live: Vec<_> = entries.iter().filter_map(|e| Some((e.path.as_str(), e.hash.as_deref()?, e.exec))).collect();
    live.sort_by_key(|(p, _, _)| p.as_bytes());
    root_of(live)
}

pub fn manifest_root(m: &Manifest) -> String {
    root_of(m.iter().map(|(p, f)| (p.as_str(), f.hash.as_str(), f.exec)))
}

fn root_of<'a>(sorted: impl IntoIterator<Item = (&'a str, &'a str, bool)>) -> String {
    let mut h = Sha256::new();
    for (path, hash, exec) in sorted {
        h.update(format!("{path}\0{}\0{hash}\n", if exec { 'x' } else { '-' }));
    }
    hex(&h.finalize())
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Synced bytes are taken as they are (F17): no line-ending conversion in a managed workspace.
pub async fn prepare(work: &Path) -> Result<(), String> {
    git::git(work, &["config", "core.autocrlf", "false"]).await.map(drop)
}

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    match std::fs::read(path) {
        Ok(raw) => {
            serde_json::from_slice(&raw).map_err(|e| t!("同步状态文件损坏：{path}：{e}", path = path.display(), e = e))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(t!("无法读取同步状态：{e}", e = e)),
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let err = |e: std::io::Error| t!("无法保存同步状态：{e}", e = e);
    std::fs::create_dir_all(path.parent().expect("state files have a parent")).map_err(err)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(value).expect("serializable")).map_err(err)?;
    std::fs::rename(&tmp, path).map_err(err)
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;
    use crate::git::testing::run;

    /// A git repo `work` and a daemon home, both temporary.
    pub struct Fixture {
        pub root: tempfile::TempDir,
    }

    impl Fixture {
        pub fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(root.path().join("work")).unwrap();
            run(&root.path().join("work"), &["init", "-q"]);
            Fixture { root }
        }

        pub fn work(&self) -> PathBuf {
            self.root.path().join("work")
        }

        pub fn home(&self) -> PathBuf {
            self.root.path().join("home")
        }

        pub fn replica(&self) -> Replica {
            Replica::new(&self.home(), "g1", "b1", self.work())
        }

        pub fn write(&self, path: &str, body: &str) {
            let p = self.work().join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
    }

    pub fn f(body: &str, exec: bool) -> FileRef {
        FileRef { hash: hash_bytes(body.as_bytes()), exec }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    fn change(path: &str, hash: Option<&str>, exec: bool, base: Option<&str>) -> SyncChange {
        SyncChange {
            path: path.into(),
            hash: hash.map(|b| hash_bytes(b.as_bytes())),
            exec,
            base_hash: base.map(|b| hash_bytes(b.as_bytes())),
        }
    }

    #[test]
    fn diff_lists_adds_edits_deletes_and_mode_changes_with_their_base_hash() {
        let base = Manifest::from([
            ("same".into(), f("s", false)),
            ("edit".into(), f("old", false)),
            ("gone".into(), f("g", true)),
            ("run.sh".into(), f("sh", false)),
        ]);
        let now = Manifest::from([
            ("same".into(), f("s", false)),
            ("edit".into(), f("new", false)),
            ("added".into(), f("a", false)),
            ("run.sh".into(), f("sh", true)),
        ]);
        assert_eq!(
            diff(&base, &now),
            vec![
                change("added", Some("a"), false, None),
                change("edit", Some("new"), false, Some("old")),
                change("gone", None, false, Some("g")),
                change("run.sh", Some("sh"), true, Some("sh")),
            ]
        );
        assert!(drift(&base, &now));
        assert!(!drift(&base, &base.clone()));
        assert!(diff(&base, &base).is_empty());
    }

    #[test]
    fn advance_applies_writes_and_deletes() {
        let base = Manifest::from([("a".into(), f("a", false)), ("b".into(), f("b", false))]);
        let entries = vec![
            SyncEntry { path: "a".into(), hash: None, exec: false },
            SyncEntry { path: "c".into(), hash: Some(hash_bytes(b"c")), exec: true },
        ];
        assert_eq!(advance(&base, &entries), Manifest::from([("b".into(), f("b", false)), ("c".into(), f("c", true))]));
    }

    #[test]
    fn root_hash_sorts_by_bytes_and_skips_deletions() {
        let entries = vec![
            SyncEntry { path: "b".into(), hash: Some(hash_bytes(b"b")), exec: false },
            SyncEntry { path: "a".into(), hash: Some(hash_bytes(b"a")), exec: true },
            SyncEntry { path: "z".into(), hash: None, exec: false },
        ];
        let m = Manifest::from([("a".into(), f("a", true)), ("b".into(), f("b", false))]);
        assert_eq!(root_hash(&entries), manifest_root(&m));
        assert_eq!(manifest_root(&Manifest::new()), hash_bytes(b""));
    }

    #[test]
    fn base_and_cache_live_in_the_state_dir_not_the_workspace() {
        let fx = Fixture::new();
        let r = fx.replica();
        assert_eq!(r.base().unwrap(), Base::default());
        let base = Base { version: 3, files: Manifest::from([("a".into(), f("a", false))]) };
        r.set_base(&base).unwrap();
        assert_eq!(r.base().unwrap(), base);
        assert!(fx.home().join("sync/g1/b1/base.json").is_file());
        assert!(!fx.work().join("base.json").exists());
    }

    #[test]
    fn a_replica_joins_with_its_first_base_and_is_found_by_group() {
        let fx = Fixture::new();
        let r = fx.replica();
        assert!(!r.joined());
        r.set_issue(Some(SyncReplicaIssue::Drift)).unwrap();
        assert!(Replica::joined_in(&fx.home(), "g1").is_empty());
        r.set_base(&Base::default()).unwrap();
        let found = Replica::joined_in(&fx.home(), "g1");
        assert_eq!(
            found.iter().map(|r| (r.group(), r.bot(), r.work())).collect::<Vec<_>>(),
            [("g1", "b1", fx.work().as_path())]
        );
        assert_eq!(found[0].issue().unwrap(), Some(SyncReplicaIssue::Drift));
        assert!(Replica::joined_in(&fx.home(), "other").is_empty());
    }

    #[test]
    fn backup_copies_existing_files_under_a_timestamped_folder() {
        let fx = Fixture::new();
        fx.write("src/a.txt", "mine");
        let r = fx.replica();
        let dir = r.backup(&["src/a.txt".into(), "missing".into()]).unwrap().unwrap();
        assert!(dir.starts_with(fx.home().join("backups/g1")));
        assert!(dir.file_name().unwrap().to_string_lossy().ends_with("-b1"));
        assert_eq!(std::fs::read_to_string(dir.join("src/a.txt")).unwrap(), "mine");
        assert!(!dir.join("missing").exists());
        let again = r.backup(&["src/a.txt".into()]).unwrap().unwrap();
        assert_ne!(again, dir);
        assert_eq!(r.backup(&["missing".into()]).unwrap(), None);
        assert_eq!(crate::workspace::backups(&fx.home()).len(), 2);
    }

    #[tokio::test]
    async fn prepare_turns_off_autocrlf_locally() {
        let fx = Fixture::new();
        prepare(&fx.work()).await.unwrap();
        let v = crate::git::testing::run(&fx.work(), &["config", "--local", "core.autocrlf"]);
        assert_eq!(v.trim(), "false");
    }
}
