//! A replica's base and stat cache: loaded once, then kept in memory and persisted as `state.json` (a snapshot) plus
//! `journal.jsonl` (one line per change since, the base's fsync'd before anyone is told of it). The journal is folded
//! into a new snapshot once it outgrows a fifth of it. Every line sets values, so replaying it twice is harmless: a
//! crash between writing a snapshot and emptying the journal loses nothing. A torn last line was never acknowledged
//! and is dropped. Older daemons kept `base.json` and `cache.json`; those are read once and replaced.
use super::{Base, FileRef, Manifest, Stat, read_json};
use crate::t;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Journal size below which it is never folded, however small the snapshot.
const JOURNAL_MIN_BYTES: u64 = 1 << 20;

/// A replica's state as loaded; None until first needed (and after a failure, so it is read again).
pub(crate) type Memory = Arc<Mutex<Option<State>>>;

#[derive(Debug, Default)]
pub(crate) struct State {
    pub(super) base: Base,
    pub(super) cache: BTreeMap<String, Stat>,
    /// `state.json` exists: the replica joined. Until then the cache stays in memory; the first base writes it.
    saved: bool,
    snapshot_bytes: u64,
    journal_bytes: u64,
}

/// One change: the base's version and files, the cache's entries (None = removed).
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct Delta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    version: Option<u64>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    files: BTreeMap<String, Option<FileRef>>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    cache: BTreeMap<String, Option<Stat>>,
}

impl Delta {
    fn moves_base(&self) -> bool {
        self.version.is_some() || !self.files.is_empty()
    }
}

#[derive(Serialize)]
struct SnapshotRef<'a> {
    version: u64,
    files: &'a Manifest,
    cache: &'a BTreeMap<String, Stat>,
}

#[derive(Deserialize)]
struct Snapshot {
    version: u64,
    files: Manifest,
    #[serde(default)]
    cache: BTreeMap<String, Stat>,
}

fn save_err(e: std::io::Error) -> String {
    t!("无法保存同步状态：{e}", e = e)
}

impl State {
    pub(super) fn joined(dir: &Path) -> bool {
        dir.join("state.json").is_file() || dir.join("base.json").is_file()
    }

    pub(super) fn saved(&self) -> bool {
        self.saved
    }

    pub(super) fn load(dir: &Path) -> Result<State, String> {
        let path = dir.join("state.json");
        let raw = match std::fs::read(&path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Self::migrate(dir),
            Err(e) => return Err(t!("无法读取同步状态：{e}", e = e)),
        };
        let snap: Snapshot = serde_json::from_slice(&raw)
            .map_err(|e| t!("同步状态文件损坏：{path}：{e}", path = path.display(), e = e))?;
        let mut state = State {
            base: Base { version: snap.version, files: snap.files },
            cache: snap.cache,
            saved: true,
            snapshot_bytes: raw.len() as u64,
            journal_bytes: 0,
        };
        state.replay(dir)?;
        Ok(state)
    }

    /// Applies the journal's complete lines; whatever follows the first incomplete or unreadable one is cut off.
    fn replay(&mut self, dir: &Path) -> Result<(), String> {
        let path = dir.join("journal.jsonl");
        let raw = match std::fs::read(&path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(t!("无法读取同步状态：{e}", e = e)),
        };
        let mut good = 0;
        for line in raw.split_inclusive(|b| *b == b'\n') {
            let Some(body) = line.strip_suffix(b"\n") else { break };
            let Ok(delta) = serde_json::from_slice::<Delta>(body) else { break };
            self.apply(delta);
            good += line.len();
        }
        if good < raw.len() {
            tracing::warn!("{}: dropping a torn last entry ({} bytes)", path.display(), raw.len() - good);
            let file = std::fs::File::options().write(true).open(&path).map_err(save_err)?;
            file.set_len(good as u64).and_then(|_| file.sync_all()).map_err(save_err)?;
        }
        self.journal_bytes = good as u64;
        Ok(())
    }

    /// `base.json` and `cache.json` of an older daemon, rewritten as a snapshot once the replica joined.
    fn migrate(dir: &Path) -> Result<State, String> {
        let base: Option<Base> = read_json(&dir.join("base.json"))?;
        let cache = read_json(&dir.join("cache.json"))?;
        let joined = base.is_some();
        let mut state = State { base: base.unwrap_or_default(), cache, ..State::default() };
        if joined {
            state.save(dir)?;
        }
        Ok(state)
    }

    /// Records changed cache entries, with the base moving to `base` if given (one entry: both or neither stay).
    pub(super) fn record(
        &mut self,
        dir: &Path,
        cache: BTreeMap<String, Option<Stat>>,
        base: Option<&Base>,
    ) -> Result<(), String> {
        let delta = match base {
            Some(b) => Delta { version: Some(b.version), files: changes(&self.base.files, &b.files), cache },
            None if cache.is_empty() => return Ok(()),
            None => Delta { cache, ..Delta::default() },
        };
        self.commit(dir, delta)
    }

    /// Records `delta` and applies it. A change of the base is on disk when this returns; the first one joins the
    /// replica. Cache changes before that stay in memory.
    fn commit(&mut self, dir: &Path, delta: Delta) -> Result<(), String> {
        let moves_base = delta.moves_base();
        if self.saved {
            let mut line = serde_json::to_vec(&delta).expect("serializable");
            line.push(b'\n');
            let mut file =
                std::fs::File::options().create(true).append(true).open(dir.join("journal.jsonl")).map_err(save_err)?;
            file.write_all(&line).map_err(save_err)?;
            if moves_base {
                file.sync_data().map_err(save_err)?;
            }
            self.journal_bytes += line.len() as u64;
        }
        self.apply(delta);
        if (!self.saved && moves_base) || self.journal_bytes > (self.snapshot_bytes / 5).max(JOURNAL_MIN_BYTES) {
            self.save(dir)?;
        }
        Ok(())
    }

    fn apply(&mut self, delta: Delta) {
        if let Some(v) = delta.version {
            self.base.version = v;
        }
        for (path, f) in delta.files {
            match f {
                Some(f) => self.base.files.insert(path, f),
                None => self.base.files.remove(&path),
            };
        }
        for (path, s) in delta.cache {
            match s {
                Some(s) => self.cache.insert(path, s),
                None => self.cache.remove(&path),
            };
        }
    }

    /// Writes a new snapshot (temp file, fsync, rename), then empties the journal.
    fn save(&mut self, dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dir).map_err(save_err)?;
        let raw = serde_json::to_vec(&SnapshotRef {
            version: self.base.version,
            files: &self.base.files,
            cache: &self.cache,
        })
        .expect("serializable");
        let tmp = dir.join("state.json.tmp");
        let mut file = std::fs::File::create(&tmp).map_err(save_err)?;
        file.write_all(&raw).and_then(|_| file.sync_all()).map_err(save_err)?;
        std::fs::rename(&tmp, dir.join("state.json")).map_err(save_err)?;
        for old in ["base.json", "cache.json"] {
            let _ = std::fs::remove_file(dir.join(old));
        }
        let journal = dir.join("journal.jsonl");
        if self.journal_bytes > 0 || journal.exists() {
            std::fs::File::create(&journal).and_then(|f| f.sync_all()).map_err(save_err)?;
        }
        (self.saved, self.snapshot_bytes, self.journal_bytes) = (true, raw.len() as u64, 0);
        Ok(())
    }
}

/// What turns `old` into `new`, entry by entry (None = removed); one walk over both, which are sorted alike.
pub(super) fn changes<V: Clone + PartialEq>(
    old: &BTreeMap<String, V>,
    new: &BTreeMap<String, V>,
) -> BTreeMap<String, Option<V>> {
    let mut out = BTreeMap::new();
    walk(old, new, |path, a, b| {
        if a != b {
            out.insert(path.clone(), b.cloned());
        }
    });
    out
}

/// Calls `f` with every path of `a` or `b`, in order, and its entry in each.
pub(super) fn walk<'a, A, B>(
    a: &'a BTreeMap<String, A>,
    b: &'a BTreeMap<String, B>,
    mut f: impl FnMut(&'a String, Option<&'a A>, Option<&'a B>),
) {
    let (mut a, mut b) = (a.iter().peekable(), b.iter().peekable());
    loop {
        match (a.peek(), b.peek()) {
            (None, None) => return,
            (Some((pa, va)), Some((pb, vb))) if pa == pb => {
                f(pa, Some(va), Some(vb));
                a.next();
                b.next();
            }
            (Some((pa, va)), Some((pb, _))) if pa < pb => {
                f(pa, Some(va), None);
                a.next();
            }
            (Some((pa, va)), None) => {
                f(pa, Some(va), None);
                a.next();
            }
            (_, Some((pb, vb))) => {
                f(pb, None, Some(vb));
                b.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::f;
    use super::*;

    fn stat(body: &str, mtime: u64) -> Stat {
        Stat { size: body.len() as u64, mtime, hash: f(body, false).hash, exec: false }
    }

    fn files(delta: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<FileRef>> {
        delta.iter().map(|(p, b)| (p.to_string(), b.map(|b| f(b, false)))).collect()
    }

    /// A joined replica's state dir at v1 with a.txt and b.txt.
    fn joined() -> (tempfile::TempDir, State) {
        let dir = tempfile::tempdir().unwrap();
        let mut s = State::load(dir.path()).unwrap();
        s.commit(
            dir.path(),
            Delta { version: Some(1), files: files(&[("a.txt", Some("a")), ("b.txt", Some("b"))]), ..Delta::default() },
        )
        .unwrap();
        (dir, s)
    }

    fn base(s: &State) -> (u64, Vec<(&str, &str)>) {
        (s.base.version, s.base.files.iter().map(|(p, f)| (p.as_str(), f.hash.as_str())).collect())
    }

    #[test]
    fn nothing_is_saved_before_the_first_base_which_joins() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!State::joined(dir.path()));
        let mut s = State::load(dir.path()).unwrap();
        s.commit(dir.path(), Delta { cache: [("a".into(), Some(stat("a", 1)))].into(), ..Delta::default() }).unwrap();
        assert!(!State::joined(dir.path()));
        s.commit(dir.path(), Delta { version: Some(0), ..Delta::default() }).unwrap();
        assert!(State::joined(dir.path()));
        let loaded = State::load(dir.path()).unwrap();
        assert_eq!((loaded.base, loaded.cache), (Base::default(), [("a".into(), stat("a", 1))].into()));
    }

    #[test]
    fn changes_go_to_the_journal_and_replay_onto_the_snapshot() {
        let (dir, mut s) = joined();
        let delta = Delta {
            version: Some(2),
            files: files(&[("a.txt", None), ("c.txt", Some("c"))]),
            cache: [("c.txt".into(), Some(stat("c", 5)))].into(),
        };
        s.commit(dir.path(), delta).unwrap();
        s.commit(dir.path(), Delta { cache: [("c.txt".into(), None)].into(), ..Delta::default() }).unwrap();
        let journal = std::fs::read_to_string(dir.path().join("journal.jsonl")).unwrap();
        assert_eq!(journal.lines().count(), 2);
        let loaded = State::load(dir.path()).unwrap();
        assert_eq!(base(&loaded), base(&s));
        assert_eq!(
            base(&loaded),
            (2, vec![("b.txt", f("b", false).hash.as_str()), ("c.txt", f("c", false).hash.as_str())])
        );
        assert!(loaded.cache.is_empty());
    }

    #[test]
    fn a_torn_last_line_is_dropped_and_cut_off() {
        let (dir, mut s) = joined();
        s.commit(dir.path(), Delta { version: Some(2), files: files(&[("c.txt", Some("c"))]), ..Delta::default() })
            .unwrap();
        let journal = dir.path().join("journal.jsonl");
        let good = std::fs::read(&journal).unwrap();
        let mut torn = good.clone();
        torn.extend_from_slice(br#"{"version":3,"files":{"d.t"#);
        std::fs::write(&journal, &torn).unwrap();
        let mut loaded = State::load(dir.path()).unwrap();
        assert_eq!(base(&loaded), base(&s));
        assert_eq!(std::fs::read(&journal).unwrap(), good);
        // Later lines start on a line of their own.
        loaded.commit(dir.path(), Delta { version: Some(3), ..Delta::default() }).unwrap();
        assert_eq!(State::load(dir.path()).unwrap().base.version, 3);
    }

    #[test]
    fn a_full_journal_is_folded_into_a_new_snapshot() {
        let (dir, mut s) = joined();
        let journal = dir.path().join("journal.jsonl");
        let mut v = 1;
        loop {
            v += 1;
            let paths: Vec<String> = (0..200).map(|i| format!("v{v}/f{i}.txt")).collect();
            let delta = files(&paths.iter().map(|p| (p.as_str(), Some("x"))).collect::<Vec<_>>());
            s.commit(dir.path(), Delta { version: Some(v), files: delta, ..Delta::default() }).unwrap();
            if std::fs::metadata(&journal).unwrap().len() == 0 {
                break;
            }
        }
        assert!(v > 2 && s.journal_bytes == 0);
        let loaded = State::load(dir.path()).unwrap();
        assert_eq!((loaded.base.version, loaded.base.files.len()), (v, 2 + 200 * (v as usize - 1)));
        assert_eq!(loaded.base, s.base);
    }

    #[test]
    fn replaying_a_journal_already_in_the_snapshot_changes_nothing() {
        let (dir, mut s) = joined();
        s.commit(dir.path(), Delta { version: Some(2), files: files(&[("a.txt", None)]), ..Delta::default() }).unwrap();
        s.commit(dir.path(), Delta { version: Some(3), files: files(&[("a.txt", Some("a2"))]), ..Delta::default() })
            .unwrap();
        // A crash after the new snapshot's rename, before the journal was emptied.
        let journal = std::fs::read(dir.path().join("journal.jsonl")).unwrap();
        s.save(dir.path()).unwrap();
        std::fs::write(dir.path().join("journal.jsonl"), journal).unwrap();
        assert_eq!(base(&State::load(dir.path()).unwrap()), base(&s));
    }

    #[test]
    fn base_json_and_cache_json_of_an_older_daemon_are_read_once_and_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let old = Base { version: 4, files: [("a.txt".into(), f("a", false))].into() };
        std::fs::write(dir.path().join("base.json"), serde_json::to_vec(&old).unwrap()).unwrap();
        let cache: BTreeMap<String, Stat> = [("a.txt".into(), stat("a", 7))].into();
        std::fs::write(dir.path().join("cache.json"), serde_json::to_vec(&cache).unwrap()).unwrap();
        assert!(State::joined(dir.path()));
        let s = State::load(dir.path()).unwrap();
        assert_eq!((&s.base, &s.cache), (&old, &cache));
        assert!(!dir.path().join("base.json").exists() && !dir.path().join("cache.json").exists());
        assert!(State::joined(dir.path()));
        let again = State::load(dir.path()).unwrap();
        assert_eq!((again.base, again.cache), (old, cache));
    }

    #[test]
    fn changes_walks_both_maps_once() {
        let old: BTreeMap<String, u8> = [("a".into(), 1), ("b".into(), 2), ("d".into(), 4)].into();
        let new: BTreeMap<String, u8> = [("b".into(), 2), ("c".into(), 3), ("d".into(), 5)].into();
        assert_eq!(changes(&old, &new), [("a".into(), None), ("c".into(), Some(3)), ("d".into(), Some(5))].into());
        assert!(changes(&new, &new).is_empty());
    }
}
