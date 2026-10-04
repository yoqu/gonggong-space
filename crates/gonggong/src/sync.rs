//! Force sync on the daemon side (docs/plan/强制同步-开发计划.md §3, S3): a replica's manifest and its diff against the
//! last known version, the cross-platform and size checks, blob transfer, apply and three-way merge.
//! A replica is one (group, bot) managed workspace; its state lives in `<home>/sync/<group>/<bot>/`, never in the
//! workspace: `state.json` + `journal.jsonl` (the manifest at the version the replica last matched, and the stat
//! cache: path → size, mtime, hash, exec, so only touched files are rehashed; they exist once the replica joined; see
//! `state`), `work` (the workspace path, so idle replicas can be found), `issue.json` (why it stopped taking versions,
//! if it did), `held.json` (the held change while a conflict waits, F11), `stopped.json` (the /stop'ped run whose changes wait for keep / discard, F21),
//! `pending.json` (the submit sent and not settled yet, resent with the same id after a timeout or reconnect) and
//! `applying.json` (the version being written, so an apply a crash cut off is finished rather than taken for edits).
mod apply;
mod check;
mod client;
mod manifest;
mod merge;
mod path;
mod state;

pub use apply::{ApplyError, Applying};
pub use check::{Issue, Violation, check};
pub use client::{Client, TRANSFERS};
pub use manifest::{Stat, Tree};
pub use merge::Merge;
pub(crate) use state::Memory;

use crate::git;
use crate::protocol::{SyncChange, SyncEntry, SyncReplicaIssue, SyncSubmit};
use crate::t;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use state::State;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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

/// A held change (F11) until it is settled: the refused submit's changes, the head's state of each conflicting path,
/// the head hash each path is rebased on (clean merges, then decisions; None = absent in the head), and whether a bot
/// merge turn is due to resolve markers written into the tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Held {
    pub changes: Vec<SyncChange>,
    pub conflicts: Vec<SyncEntry>,
    pub rebased: BTreeMap<String, Option<String>>,
    pub merging: bool,
}

/// A submit on its way: resent as it is until a result settles it. Accepted, the tree it carries (its changes on top of
/// the base it was made on) becomes the replica's base; the base moves on only by catching up, which also moves its
/// version, or by settling, which clears the pending submit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pending {
    pub submit: SyncSubmit,
}

pub struct Replica {
    state: PathBuf,
    work: PathBuf,
    backups: PathBuf,
    group: String,
    bot: String,
    /// Its base and stat cache once loaded, shared by every handle on the replica the daemon makes.
    memory: Memory,
}

impl Replica {
    pub fn new(home: &Path, group: &str, bot: &str, work: PathBuf) -> Self {
        Replica {
            state: home.join("sync").join(group).join(bot),
            work,
            backups: home.join("backups").join(group),
            group: group.into(),
            bot: bot.into(),
            memory: Memory::default(),
        }
    }

    /// This handle with the state in `memory` (one per replica, kept by the caller).
    pub(crate) fn sharing(self, memory: Memory) -> Self {
        Replica { memory, ..self }
    }

    /// The joined replica of (`group`, `bot`) on this machine.
    pub fn find(home: &Path, group: &str, bot: &str) -> Option<Replica> {
        Self::joined_in(home, group).into_iter().find(|r| r.bot == bot)
    }

    /// Every joined replica on this machine.
    pub fn all(home: &Path) -> Vec<Replica> {
        let Ok(groups) = std::fs::read_dir(home.join("sync")) else { return vec![] };
        groups.flatten().flat_map(|g| Self::joined_in(home, &g.file_name().to_string_lossy())).collect()
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
        let joined = State::joined(&self.state);
        let mut memory = self.memory.lock().unwrap();
        if !joined && memory.as_ref().is_some_and(State::saved) {
            // Its state was removed under the daemon: what is in memory is gone too.
            *memory = None;
        }
        joined
    }

    /// Runs `f` on the loaded state. On failure the memory is dropped, to be read from disk again: it may be ahead.
    fn with_state<T>(&self, f: impl FnOnce(&mut State, &Path) -> Result<T, String>) -> Result<T, String> {
        let mut memory = self.memory.lock().unwrap();
        let state = match memory.as_mut() {
            Some(state) => state,
            None => memory.insert(State::load(&self.state)?),
        };
        let result = f(state, &self.state);
        if result.is_err() {
            *memory = None;
        }
        result
    }

    pub fn issue(&self) -> Result<Option<SyncReplicaIssue>, String> {
        read_json(&self.state.join("issue.json"))
    }

    pub fn set_issue(&self, issue: Option<SyncReplicaIssue>) -> Result<(), String> {
        write_json(&self.state.join("issue.json"), &issue)
    }

    pub fn held(&self) -> Result<Option<Held>, String> {
        read_json(&self.state.join("held.json"))
    }

    pub fn set_held(&self, held: Option<&Held>) -> Result<(), String> {
        write_json(&self.state.join("held.json"), &held)
    }

    /// The run whose /stop left its changes waiting for keep / discard (F21).
    pub fn stopped(&self) -> Result<Option<String>, String> {
        read_json(&self.state.join("stopped.json"))
    }

    pub fn set_stopped(&self, run_id: Option<&str>) -> Result<(), String> {
        write_json(&self.state.join("stopped.json"), &run_id)
    }

    pub fn pending(&self) -> Result<Option<Pending>, String> {
        read_json(&self.state.join("pending.json"))
    }

    pub fn set_pending(&self, pending: Option<&Pending>) -> Result<(), String> {
        write_json(&self.state.join("pending.json"), &pending)
    }

    pub fn applying(&self) -> Result<Option<Applying>, String> {
        read_json(&self.state.join("applying.json"))
    }

    pub fn set_applying(&self, applying: Option<&Applying>) -> Result<(), String> {
        write_json(&self.state.join("applying.json"), &applying)
    }

    /// Settled: takes versions again.
    pub fn clear(&self) -> Result<(), String> {
        self.set_applying(None)?;
        self.set_held(None)?;
        self.set_stopped(None)?;
        self.set_pending(None)?;
        self.set_issue(None)
    }

    /// Version 0 with no files before the replica ever matched one.
    pub fn base(&self) -> Result<Base, String> {
        self.with_state(|s, _| Ok(s.base.clone()))
    }

    pub fn version(&self) -> Result<u64, String> {
        self.with_state(|s, _| Ok(s.base.version))
    }

    /// Persisted before it returns; the first base joins the replica.
    pub fn set_base(&self, base: &Base) -> Result<(), String> {
        self.commit_base(base, None)
    }

    /// `set_base`, with the stat cache now `cache` (a tree just written) in the same journal entry.
    fn commit_base(&self, base: &Base, cache: Option<&BTreeMap<String, Stat>>) -> Result<(), String> {
        self.with_state(|s, dir| {
            let cache = cache.map(|c| state::changes(&s.cache, c)).unwrap_or_default();
            s.record(dir, cache, Some(base))
        })?;
        let (file, work) = (self.state.join("work"), self.work.to_string_lossy());
        if std::fs::read(&file).ok().as_deref() == Some(work.as_bytes()) {
            return Ok(());
        }
        std::fs::write(file, work.as_bytes()).map_err(|e| t!("无法保存同步状态：{e}", e = e))
    }

    /// The work tree now (F4), rehashing only files whose size or mtime changed since the last scan. Sparse-checkout
    /// entries are not on disk: they stay as the base has them.
    pub async fn tree(&self) -> Result<Tree, String> {
        count_scan(&self.work);
        let cache = self.with_state(|s, _| Ok(std::mem::take(&mut s.cache)))?;
        let (tree, cache) = manifest::scan(&self.work, cache).await;
        self.with_state(|s, dir| {
            s.cache = cache;
            let Ok(tree) = &tree else { return Ok(()) };
            let changed = state::changes(&s.cache, &tree.files);
            s.record(dir, changed, None)
        })?;
        let mut tree = tree?;
        if !tree.sparse.is_empty() {
            let kept = self.with_state(|s, _| {
                Ok(tree.sparse.iter().filter_map(|p| Some((p.clone(), s.base.files.get(p)?.clone()))).collect())
            })?;
            tree.kept = kept;
        }
        Ok(tree)
    }

    /// Leaves force sync: the replica's state goes (its group's directory too once empty); the work tree stays.
    pub fn forget(&self) -> Result<(), String> {
        *self.memory.lock().unwrap() = None;
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
    let mut out = vec![];
    state::walk(base, current, |path, b, c| {
        if b != c {
            out.push(SyncChange {
                path: path.clone(),
                hash: c.map(|c| c.hash.clone()),
                exec: c.is_some_and(|c| c.exec),
                base_hash: b.map(|b| b.hash.clone()),
            });
        }
    });
    out
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

/// Full scans of each work tree by this process, for tests to count.
static SCANS: Mutex<BTreeMap<PathBuf, usize>> = Mutex::new(BTreeMap::new());

fn count_scan(work: &Path) {
    *SCANS.lock().unwrap().entry(work.to_path_buf()).or_default() += 1;
}

#[doc(hidden)]
pub fn scans(work: &Path) -> usize {
    SCANS.lock().unwrap().get(work).copied().unwrap_or(0)
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
    let mut file = std::fs::File::create(&tmp).map_err(err)?;
    file.write_all(&serde_json::to_vec(value).expect("serializable")).and_then(|_| file.sync_all()).map_err(err)?;
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
        assert!(fx.home().join("sync/g1/b1/state.json").is_file());
        assert!(!fx.work().join("state.json").exists());
        assert_eq!(Replica::new(&fx.home(), "g1", "b1", fx.work()).base().unwrap(), base);
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

    #[test]
    fn state_files_missing_newer_fields_still_load() {
        let fx = Fixture::new();
        let r = fx.replica();
        let dir = fx.home().join("sync/g1/b1");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("held.json"), r#"{"changes":[],"future":1}"#).unwrap();
        assert_eq!(r.held().unwrap(), Some(Held::default()));
        let submit = r#"{"groupId":"g1","botId":"b1","submitId":"s","runId":null,"baseVersion":1,"kind":"run","merged":false,"changes":[]}"#;
        // An older daemon's pending submit also carried its tree.
        std::fs::write(dir.join("pending.json"), format!(r#"{{"submit":{submit},"files":{{}}}}"#)).unwrap();
        assert_eq!(r.pending().unwrap().unwrap().submit.submit_id, "s");
        let applying = r#"{"version":2,"base":{"version":1,"files":{}},"entries":[]}"#;
        std::fs::write(dir.join("applying.json"), applying).unwrap();
        assert_eq!(r.applying().unwrap().unwrap().base, Some(Base { version: 1, files: Manifest::new() }));
    }

    #[tokio::test]
    async fn prepare_turns_off_autocrlf_locally() {
        let fx = Fixture::new();
        prepare(&fx.work()).await.unwrap();
        let v = crate::git::testing::run(&fx.work(), &["config", "--local", "core.autocrlf"]);
        assert_eq!(v.trim(), "false");
    }
}
