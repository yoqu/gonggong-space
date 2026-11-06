//! Background cleanup (plan 空间管理): state left by groups and bots gone from this machine, plugin versions no turn
//! took for a month, and superseded Node / gg-cast builds no process runs from. Workspaces and backups are never
//! touched: the 空间 page only offers them.
use crate::config::Config;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// Lets the daemon settle (connect, first turns) before the first sweep.
const FIRST_DELAY: Duration = Duration::from_secs(60);
/// A pair added after the server's list was fetched gets its state written meanwhile: only older state goes.
const ORPHAN_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const PLUGIN_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// Sweeps once a day while the daemon runs; a round whose pair list cannot be fetched is skipped, never taken as
/// "no pairs left".
pub async fn run(home: PathBuf, config: Config) {
    tokio::time::sleep(FIRST_DELAY).await;
    let mut tick = tokio::time::interval(EVERY);
    loop {
        tick.tick().await;
        let pairs = match crate::workspace::fetch_pairs(&config).await {
            Ok(pairs) => pairs,
            Err(e) => {
                tracing::warn!("cleanup skipped, workspaces unavailable: {e:#}");
                continue;
            }
        };
        let active: HashSet<(String, String)> =
            pairs.into_iter().filter(|p| !p.removed).map(|p| (p.group_id, p.bot_id)).collect();
        let home = home.clone();
        let swept =
            tokio::task::spawn_blocking(move || sweep(&home, &active, SystemTime::now(), &running_exes())).await;
        for path in swept.unwrap_or_default() {
            tracing::info!("cleanup removed {}", path.display());
        }
    }
}

/// Removes what is unused under `home` and returns it. `active` = the (group, bot) pairs still on this machine;
/// `running` = executables of live processes.
pub fn sweep(home: &Path, active: &HashSet<(String, String)>, now: SystemTime, running: &[PathBuf]) -> Vec<PathBuf> {
    let old = |p: &Path, age: Duration| {
        std::fs::symlink_metadata(p)
            .and_then(|m| m.modified())
            .is_ok_and(|t| now.duration_since(t).unwrap_or_default() >= age)
    };
    let names: HashSet<String> = active.iter().map(|(g, b)| format!("{g}-{b}")).collect();
    let mut gone = vec![];
    for (name, path) in entries(&home.join("skill-sets")) {
        if !names.contains(&name) && old(&path, ORPHAN_AGE) {
            gone.push(path);
        }
    }
    for (name, path) in entries(&home.join("plugin-links")) {
        let pair = name.strip_suffix(".json").unwrap_or(&name);
        if !names.contains(pair) && old(&path, ORPHAN_AGE) {
            gone.push(path);
        }
    }
    for (group, g) in entries(&home.join("sync")) {
        for (bot, path) in entries(&g) {
            if !active.contains(&(group.clone(), bot)) && old(&path, ORPHAN_AGE) {
                gone.push(path);
            }
        }
    }
    let sets = home.join("plugin-sets");
    for (name, path) in entries(&sets).filter(|(n, _)| !n.starts_with('.')) {
        let marker = sets.join(format!(".{name}.used"));
        if old(if marker.exists() { &marker } else { &path }, PLUGIN_AGE) {
            let _ = std::fs::remove_file(marker);
            gone.push(path);
        }
    }
    let in_use = |p: &Path| running.iter().any(|exe| exe.starts_with(p));
    if let Some(current) = crate::tools::current_runtime(home) {
        for (name, path) in entries(&home.join("runtime")) {
            let path = path.canonicalize().unwrap_or(path);
            if name.starts_with("node-v") && path != current && !in_use(&path) {
                gone.push(path);
            }
        }
    }
    let mut casts: Vec<(SystemTime, PathBuf)> = entries(&home.join("bin"))
        .filter(|(n, _)| n.starts_with("gg-cast-"))
        .filter_map(|(_, p)| Some((std::fs::metadata(&p).ok()?.modified().ok()?, p)))
        .collect();
    casts.sort();
    casts.pop();
    gone.extend(casts.into_iter().map(|(_, p)| p).filter(|p| !in_use(p)));

    gone.retain(|p| remove(p).is_ok());
    for g in entries(&home.join("sync")).map(|(_, g)| g) {
        let _ = std::fs::remove_dir(g);
    }
    gone
}

fn entries(dir: &Path) -> impl Iterator<Item = (String, PathBuf)> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
}

fn remove(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) }
}

fn running_exes() -> Vec<PathBuf> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.processes().values().filter_map(|p| p.exe().map(Path::to_path_buf)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    fn file(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn rel(home: &Path, paths: Vec<PathBuf>) -> Vec<String> {
        let home = home.canonicalize().unwrap();
        let mut out: Vec<String> =
            paths.into_iter().map(|p| p.strip_prefix(&home).unwrap_or(&p).to_string_lossy().into()).collect();
        out.sort();
        out
    }

    #[test]
    fn removes_state_of_pairs_gone_from_the_machine_once_it_is_a_day_old() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path().canonicalize().unwrap();
        file(&h.join("skill-sets/g1-b1/s/SKILL.md"));
        file(&h.join("skill-sets/g2-b1/s/SKILL.md"));
        file(&h.join("plugin-links/g1-b1.json"));
        file(&h.join("plugin-links/g2-b1.json"));
        file(&h.join("sync/g1/b1/work"));
        file(&h.join("sync/g2/b1/work"));
        file(&h.join("workspaces/g2/b1/r/a"));
        file(&h.join("named/支付组/小码/_empty/a"));
        file(&h.join("workspaces.json"));
        file(&h.join("backups/g2/0101-1200-b1/a"));
        let active = HashSet::from([("g1".to_string(), "b1".to_string())]);

        assert!(sweep(&h, &active, SystemTime::now(), &[]).is_empty(), "fresh state may belong to a new pair");
        let later = SystemTime::now() + DAY;
        assert_eq!(
            rel(&h, sweep(&h, &active, later, &[])),
            ["plugin-links/g2-b1.json", "skill-sets/g2-b1", "sync/g2/b1"]
        );
        assert!(!h.join("sync/g2").exists(), "an emptied group dir goes too");
        assert!(h.join("skill-sets/g1-b1").exists() && h.join("sync/g1/b1/work").exists());
        assert!(h.join("workspaces/g2/b1/r/a").exists() && h.join("backups/g2/0101-1200-b1/a").exists());
        assert!(h.join("named/支付组/小码/_empty/a").exists() && h.join("workspaces.json").exists());
    }

    #[test]
    fn removes_plugin_versions_no_turn_took_for_a_month() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path().canonicalize().unwrap();
        file(&h.join("plugin-sets/slides-aaa/skills/x/SKILL.md"));
        file(&h.join("plugin-sets/slides-bbb/skills/x/SKILL.md"));
        file(&h.join("plugin-sets/.slides-ccc.1.partial/x"));
        let month = SystemTime::now() + 30 * DAY;
        // A turn took bbb just now: its marker is newer than the folder.
        std::fs::write(h.join("plugin-sets/.slides-bbb.used"), b"").unwrap();
        std::fs::File::options()
            .write(true)
            .open(h.join("plugin-sets/.slides-bbb.used"))
            .unwrap()
            .set_modified(month)
            .unwrap();
        assert_eq!(rel(&h, sweep(&h, &HashSet::new(), month, &[])), ["plugin-sets/slides-aaa"]);
        assert!(h.join("plugin-sets/slides-bbb").exists() && h.join("plugin-sets/.slides-ccc.1.partial").exists());
    }

    #[cfg(unix)]
    #[test]
    fn removes_superseded_node_and_gg_cast_builds_nothing_runs_from() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path().canonicalize().unwrap();
        for v in ["20.1.0", "22.0.0", "24.0.0"] {
            file(&h.join(format!("runtime/node-v{v}/bin/node")));
        }
        std::os::unix::fs::symlink("node-v24.0.0", h.join("runtime/current")).unwrap();
        let old = SystemTime::now() - DAY;
        for (i, name) in ["gg-cast-1.0-a", "gg-cast-1.1-b", "gg-cast-1.2-c"].into_iter().enumerate() {
            file(&h.join("bin").join(name));
            let f = std::fs::File::options().write(true).open(h.join("bin").join(name)).unwrap();
            f.set_modified(old + Duration::from_secs(i as u64)).unwrap();
        }
        let running = [h.join("runtime/node-v20.1.0/bin/node"), h.join("bin/gg-cast-1.0-a")];
        assert_eq!(
            rel(&h, sweep(&h, &HashSet::new(), SystemTime::now(), &running)),
            ["bin/gg-cast-1.1-b", "runtime/node-v22.0.0"]
        );
        assert!(h.join("runtime/node-v24.0.0/bin/node").exists() && h.join("bin/gg-cast-1.2-c").exists());
    }

    #[test]
    fn keeps_every_node_without_a_current_one() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path().canonicalize().unwrap();
        file(&h.join("runtime/node-v22.0.0/bin/node"));
        assert!(sweep(&h, &HashSet::new(), SystemTime::now(), &[]).is_empty());
    }
}
