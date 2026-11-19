//! artifact.activity: which files of its checked-out artifacts a live turn has written (plan 原型协作 P1).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use super::{Files, Folder, Stat, walk};
use crate::protocol::DaemonToServer;
use crate::service::Outbox;

/// How often a live turn's checked-out folders are rescanned for artifact.activity.
const WATCH_EVERY: Duration = if cfg!(test) { Duration::from_millis(20) } else { Duration::from_millis(500) };
/// `ArtifactActivity.paths` limits in the protocol.
const ACTIVITY_PATHS: usize = 500;
const ACTIVITY_PATH_LEN: usize = 500;

/// A folder checked out for the turn: which of its files the agent has written since.
pub(super) struct Watch {
    id: String,
    dir: PathBuf,
    /// The files right after the checkout.
    baseline: Files,
    cache: BTreeMap<String, Stat>,
    sent: Vec<String>,
}

impl Watch {
    pub(super) fn new(f: &Folder) -> Result<Watch, String> {
        let cache = f.load()?.cache;
        let baseline = cache.iter().map(|(p, s)| (p.clone(), s.hash.clone())).collect();
        Ok(Watch { id: f.id.clone(), dir: f.dir.clone(), baseline, cache, sent: vec![] })
    }

    /// The paths added, changed or deleted since the checkout, when they differ from the ones last sent. Uses its own
    /// stat cache: state.json is only written by prepare and publish.
    fn poll(&mut self) -> Option<Vec<String>> {
        let mut now = BTreeMap::new();
        walk(&self.dir, "", &self.cache, &mut now).ok()?;
        let changed = now.iter().filter(|(p, s)| self.baseline.get(*p) != Some(&s.hash)).map(|(p, _)| p);
        let gone = self.baseline.keys().filter(|p| !now.contains_key(*p));
        let mut paths: Vec<String> = changed.chain(gone).filter(|p| p.len() <= ACTIVITY_PATH_LEN).cloned().collect();
        paths.sort();
        paths.truncate(ACTIVITY_PATHS);
        self.cache = now;
        if paths == self.sent {
            return None;
        }
        self.sent = paths.clone();
        Some(paths)
    }
}

/// The task rescanning a turn's folders; stopped when dropped.
pub(super) struct Watcher(tokio::task::JoinHandle<()>);

impl Drop for Watcher {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) fn watch(run_id: String, mut watches: Vec<Watch>, out: Outbox) -> Option<Watcher> {
    if watches.is_empty() {
        return None;
    }
    Some(Watcher(tokio::spawn(async move {
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            let polled = tokio::task::spawn_blocking(move || {
                let changed: Vec<_> = watches.iter_mut().filter_map(|w| Some((w.id.clone(), w.poll()?))).collect();
                (watches, changed)
            });
            let Ok((back, changed)) = polled.await else { return };
            watches = back;
            for (artifact_id, paths) in changed {
                out.send(DaemonToServer::ArtifactActivity { run_id: run_id.clone(), artifact_id, paths });
            }
        }
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_watch_reports_the_whole_set_written_since_the_checkout_only_when_it_changes() {
        let dir = tempfile::tempdir().unwrap();
        let write = |p: &str, body: &str| {
            let p = dir.path().join(p);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        };
        write("screens/home.html", "home");
        write("screens/list.html", "list");
        write("gone.css", "x");
        let mut cache = BTreeMap::new();
        walk(dir.path(), "", &BTreeMap::new(), &mut cache).unwrap();
        let baseline = cache.iter().map(|(p, s)| (p.clone(), s.hash.clone())).collect();
        let mut w = Watch { id: "a1".into(), dir: dir.path().into(), baseline, cache, sent: vec![] };
        assert_eq!(w.poll(), None, "nothing written");
        write("screens/home.html", "home, edited");
        write("tokens.css", ":root{}");
        assert_eq!(w.poll(), Some(vec!["screens/home.html".into(), "tokens.css".into()]));
        assert_eq!(w.poll(), None, "unchanged");
        write("screens/list.html", "list");
        assert_eq!(w.poll(), None, "rewritten as it was");
        std::fs::remove_file(dir.path().join("gone.css")).unwrap();
        assert_eq!(w.poll(), Some(vec!["gone.css".into(), "screens/home.html".into(), "tokens.css".into()]));
    }
}
