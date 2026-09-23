use crate::host::Host;
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    managed_workspaces: usize,
}

#[tauri::command]
pub fn overview(host: State<'_, Host>) -> Overview {
    Overview { managed_workspaces: managed_workspaces(&host.home) }
}

/// `<home>/workspaces/<group>/<bot>/<repo | _empty>` directories.
fn managed_workspaces(home: &Path) -> usize {
    let dirs = |p: &Path| std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| e.path()).filter(|p| p.is_dir());
    dirs(&home.join("workspaces")).flat_map(|g| dirs(&g).collect::<Vec<_>>()).map(|b| dirs(&b).count()).sum()
}

#[cfg(test)]
mod tests {
    #[test]
    fn counts_workspace_dirs_three_levels_down() {
        let home = tempfile::tempdir().unwrap();
        for dir in ["g1/b1/_empty", "g1/b1/r1", "g2/b1/r2"] {
            std::fs::create_dir_all(home.path().join("workspaces").join(dir)).unwrap();
        }
        std::fs::write(home.path().join("workspaces/g1/b1/stray.txt"), "x").unwrap();
        assert_eq!(super::managed_workspaces(home.path()), 3);
    }
}
