//! Where managed workspaces live: `~/gonggong/workspaces/<group>/<bot>/<repo name | _empty>`, named after the group
//! and Bot when first placed and recorded in `<home>/workspaces.json`, so renaming them later moves nothing. A
//! workspace placed by an older daemon stays in the id layout under `<home>/workspaces/<groupId>/<botId>/…` until its
//! next run or bind moves it (see `workspace::Workspaces::settle`).
use crate::protocol::WorkspaceNames;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes changes to the record: (group, bot) locks are per pair, but names are unique across pairs.
static WRITE: Mutex<()> = Mutex::new(());

const NAME_MAX: usize = 60;

/// Beside the default `~/.gonggong`: `~/gonggong/workspaces`. Inside any other GONGGONG_HOME (tests, several daemons
/// on one machine) `<home>/named`, so they never share it.
pub fn root(home: &Path) -> PathBuf {
    match (home.file_name(), home.parent()) {
        (Some(name), Some(parent)) if name == ".gonggong" => parent.join("gonggong").join("workspaces"),
        _ => home.join("named"),
    }
}

/// `<groupId>/<botId>/<repoId | _empty>`.
pub fn key(group: &str, bot: &str, repo_id: Option<&str>) -> String {
    format!("{group}/{bot}/{}", repo_id.unwrap_or("_empty"))
}

/// The (group, bot) of a key.
pub fn pair(key: &str) -> Option<(&str, &str)> {
    let mut parts = key.splitn(3, '/');
    Some((parts.next()?, parts.next()?))
}

fn file(home: &Path) -> PathBuf {
    home.join("workspaces.json")
}

/// Every placed workspace by key.
pub fn read(home: &Path) -> BTreeMap<String, PathBuf> {
    std::fs::read(file(home)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write(home: &Path, placed: &BTreeMap<String, PathBuf>) -> std::io::Result<()> {
    let tmp = file(home).with_extension("json.tmp");
    std::fs::create_dir_all(home)?;
    std::fs::write(&tmp, serde_json::to_vec_pretty(placed)?)?;
    std::fs::rename(tmp, file(home))
}

pub fn lookup(home: &Path, key: &str) -> Option<PathBuf> {
    read(home).remove(key)
}

/// The directory `key` has or would get now: the group's and the Bot's directories as already named for their other
/// workspaces, else after `names`, made unique against other records and anything already on disk.
fn plan(home: &Path, placed: &BTreeMap<String, PathBuf>, key: &str, names: &WorkspaceNames, leaf: &str) -> PathBuf {
    if let Some(dir) = placed.get(key) {
        return dir.clone();
    }
    let (group, bot) = pair(key).expect("keys have a group and a bot");
    // The ancestor `depth` levels above each record: ours (same group, or same pair) and everyone else's.
    let dirs_of = |own: &dyn Fn(&str) -> bool, depth: usize| -> (Option<PathBuf>, HashSet<PathBuf>) {
        let (mut mine, mut others) = (None, HashSet::new());
        for (k, dir) in placed {
            let Some(at) = dir.ancestors().nth(depth) else { continue };
            if own(k) {
                mine = Some(at.to_path_buf());
            } else {
                others.insert(at.to_path_buf());
            }
        }
        (mine, others)
    };
    let (mine, others) = dirs_of(&|k| pair(k).is_some_and(|(g, _)| g == group), 2);
    let group_dir = mine.unwrap_or_else(|| unique(&root(home), &safe(&names.group, group), &others));
    let (mine, others) = dirs_of(&|k| pair(k) == Some((group, bot)), 1);
    let bot_dir = mine.unwrap_or_else(|| unique(&group_dir, &safe(&names.bot, bot), &others));
    let taken: HashSet<PathBuf> = placed.values().cloned().collect();
    unique(&bot_dir, leaf, &taken)
}

/// Where `key` would be placed, without recording it.
pub fn preview(home: &Path, key: &str, names: &WorkspaceNames, leaf: &str) -> PathBuf {
    plan(home, &read(home), key, names, leaf)
}

/// The directory of `key`, named and recorded now unless it already is (see `plan`). Nothing is created on disk.
pub fn assign(home: &Path, key: &str, names: &WorkspaceNames, leaf: &str) -> std::io::Result<PathBuf> {
    let _write = WRITE.lock().unwrap();
    let mut placed = read(home);
    if let Some(dir) = placed.get(key) {
        return Ok(dir.clone());
    }
    let dir = plan(home, &placed, key, names, leaf);
    placed.insert(key.into(), dir.clone());
    write(home, &placed)?;
    Ok(dir)
}

/// Forgets every key placed at `dir` (deleted, or it could not be moved there).
pub fn forget(home: &Path, dir: &Path) -> std::io::Result<()> {
    let _write = WRITE.lock().unwrap();
    let mut placed = read(home);
    let before = placed.len();
    placed.retain(|_, d| d != dir);
    if placed.len() != before {
        write(home, &placed)?;
    }
    Ok(())
}

/// Drops the record itself (machine revoked, every workspace deleted).
pub fn clear(home: &Path) {
    let _write = WRITE.lock().unwrap();
    let _ = std::fs::remove_file(file(home));
}

/// `<parent>/<name>`, or `<name>-2`, `-3`… when another record or anything on disk has it.
fn unique(parent: &Path, name: &str, taken: &HashSet<PathBuf>) -> PathBuf {
    let free = |p: &PathBuf| !taken.contains(p) && std::fs::symlink_metadata(p).is_err();
    let first = parent.join(name);
    if free(&first) {
        return first;
    }
    (2..).map(|n| parent.join(format!("{name}-{n}"))).find(free).expect("some suffix is free")
}

/// A name as one visible path segment on every OS: separators, reserved and control characters become `_`, leading
/// dots and trailing dots or spaces go, long names are cut; `fallback` (an id) when nothing is left.
pub fn safe(name: &str, fallback: &str) -> String {
    let swapped: String =
        name.chars().map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let cut: String = swapped.trim().trim_start_matches('.').chars().take(NAME_MAX).collect();
    let name = cut.trim_end_matches(['.', ' ']);
    if name.is_empty() { fallback.into() } else { name.into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(group: &str, bot: &str) -> WorkspaceNames {
        WorkspaceNames { group: group.into(), bot: bot.into() }
    }

    fn place(h: &Path, group: &str, bot: &str, repo: Option<&str>, n: &WorkspaceNames, leaf: &str) -> PathBuf {
        assign(h, &key(group, bot, repo), n, leaf).unwrap()
    }

    #[test]
    fn sits_beside_the_default_home_and_inside_any_other() {
        assert_eq!(root(Path::new("/u/.gonggong")), Path::new("/u/gonggong/workspaces"));
        assert_eq!(root(Path::new("/home/gg/.gonggong")), Path::new("/home/gg/gonggong/workspaces"));
        assert_eq!(root(Path::new("/tmp/h")), Path::new("/tmp/h/named"));
    }

    #[test]
    fn names_dirs_after_the_group_bot_and_repo_once() {
        let home = tempfile::tempdir().unwrap();
        let (h, r) = (home.path(), root(home.path()));
        let pay = names("支付组", "小码");
        assert_eq!(preview(h, &key("g1", "b1", Some("r1")), &pay, "pay-server"), r.join("支付组/小码/pay-server"));
        assert_eq!(lookup(h, &key("g1", "b1", Some("r1"))), None, "a preview records nothing");
        assert_eq!(place(h, "g1", "b1", Some("r1"), &pay, "pay-server"), r.join("支付组/小码/pay-server"));
        assert_eq!(place(h, "g1", "b1", None, &pay, "_empty"), r.join("支付组/小码/_empty"));
        // Renamed since: the recorded dir stays, and the group keeps its dir for another Bot.
        let renamed = names("支付二组", "小码2");
        assert_eq!(place(h, "g1", "b1", Some("r1"), &renamed, "pay-server"), r.join("支付组/小码/pay-server"));
        assert_eq!(place(h, "g1", "b2", Some("r1"), &renamed, "pay-server"), r.join("支付组/小码2/pay-server"));
        assert_eq!(lookup(h, &key("g1", "b1", None)), Some(r.join("支付组/小码/_empty")));
    }

    #[test]
    fn keeps_same_names_apart() {
        let home = tempfile::tempdir().unwrap();
        let (h, r) = (home.path(), root(home.path()));
        let same = names("值班", "小码");
        assert_eq!(place(h, "g1", "b1", None, &same, "_empty"), r.join("值班/小码/_empty"));
        assert_eq!(place(h, "g2", "b1", None, &same, "_empty"), r.join("值班-2/小码/_empty"));
        assert_eq!(place(h, "g1", "b2", None, &same, "_empty"), r.join("值班/小码-2/_empty"));
        // Two repos of one name in one group, and a folder of the user's own that is already there.
        assert_eq!(place(h, "g1", "b1", Some("r1"), &same, "app"), r.join("值班/小码/app"));
        assert_eq!(place(h, "g1", "b1", Some("r2"), &same, "app"), r.join("值班/小码/app-2"));
        std::fs::create_dir_all(r.join("运维")).unwrap();
        assert_eq!(place(h, "g3", "b1", None, &names("运维", "小码"), "_empty"), r.join("运维-2/小码/_empty"));
    }

    #[test]
    fn forgets_a_placed_workspace_by_its_dir() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        let dir = place(h, "g1", "b1", None, &names("a", "b"), "_empty");
        place(h, "g1", "b1", Some("r1"), &names("a", "b"), "app");
        forget(h, &dir).unwrap();
        assert_eq!(lookup(h, &key("g1", "b1", None)), None);
        assert!(lookup(h, &key("g1", "b1", Some("r1"))).is_some());
        clear(h);
        assert!(read(h).is_empty());
    }

    #[test]
    fn makes_names_one_visible_path_segment() {
        assert_eq!(safe("a/b\\c:d*e?\"<>|", "id"), "a_b_c_d_e_____");
        assert_eq!(safe("  ..隐藏 . ", "id"), "隐藏");
        assert_eq!(safe("..", "g1"), "g1");
        assert_eq!(safe("", "g1"), "g1");
        assert_eq!(safe(&"长".repeat(80), "id").chars().count(), NAME_MAX);
    }
}
