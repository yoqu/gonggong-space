//! Spec §9 账号停用: once the server revokes this machine, drop what the team handed it (best effort, not a guarantee).

use std::path::{Path, PathBuf};

/// Removes every managed workspace (in `<home>/workspaces` and the named layout's root) and the saved machine token,
/// returning what was removed. /cd directories live elsewhere and symlinks are removed, never followed;
/// `<home>/backups` is kept.
pub fn wipe(home: &Path) -> Vec<PathBuf> {
    let entries = [home.join("workspaces"), crate::layout::root(home)]
        .into_iter()
        .flat_map(|root| std::fs::read_dir(root).into_iter().flatten().flatten());
    let mut removed: Vec<PathBuf> = entries.map(|e| e.path()).filter(|p| remove(p)).collect();
    crate::layout::clear(home);
    let config = home.join("config.json");
    if std::fs::remove_file(&config).is_ok() {
        removed.push(config);
    }
    removed
}

fn remove(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(path).is_ok(),
        Ok(_) => std::fs::remove_file(path).is_ok(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn wipes_managed_workspaces_and_the_token_but_not_cd_dirs_or_backups() {
        let home = tempfile::tempdir().unwrap();
        let cd = tempfile::tempdir().unwrap();
        let h = home.path();
        let managed = h.join("workspaces/g1/b1/_empty");
        fs::create_dir_all(&managed).unwrap();
        fs::write(managed.join("keep.txt"), "x").unwrap();
        fs::create_dir_all(h.join("workspaces/g2/b1/repo/.git")).unwrap();
        let names = crate::protocol::WorkspaceNames { group: "支付组".into(), bot: "小码".into() };
        let named = crate::layout::assign(h, "g3/b1/r1", &names, "pay-server").unwrap();
        fs::create_dir_all(named.join(".git")).unwrap();
        fs::create_dir_all(h.join("backups/g1")).unwrap();
        fs::write(h.join("backups/g1/old.patch"), "x").unwrap();
        fs::write(h.join("config.json"), "{}").unwrap();
        fs::write(cd.path().join("mine.go"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(cd.path(), h.join("workspaces/cd-link")).unwrap();

        let mut removed = wipe(h);
        removed.sort();
        let mut expected =
            vec![h.join("config.json"), h.join("workspaces/g1"), h.join("workspaces/g2"), h.join("named/支付组")];
        #[cfg(unix)]
        expected.push(h.join("workspaces/cd-link"));
        expected.sort();
        assert_eq!(removed, expected);
        assert!(fs::read_dir(h.join("workspaces")).unwrap().next().is_none());
        assert!(fs::read_dir(h.join("named")).unwrap().next().is_none());
        assert!(crate::layout::read(h).is_empty(), "the record goes too");
        assert!(h.join("backups/g1/old.patch").exists());
        assert!(cd.path().join("mine.go").exists());
    }

    #[test]
    fn a_machine_without_workspaces_or_token_removes_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert!(wipe(home.path()).is_empty());
    }
}
