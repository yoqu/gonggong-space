//! Paths arriving from the server are checked before anything is written or deleted: a version naming `../x`,
//! `.git/hooks/…` or a path through a symlink must never reach outside the workspace or into git's own files.
use crate::t;
use std::path::{Component, Path};

/// Code points HFS+ ignores in names, so `.g\u{200c}it` is `.git` there (as git's `is_hfs_dotgit` knows).
fn ignorable(c: char) -> bool {
    matches!(c, '\u{200c}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{206a}'..='\u{206f}' | '\u{feff}')
}

/// The name as case-insensitive file systems compare it, ignoring trailing dots and spaces (Windows drops them).
fn folded(seg: &str) -> String {
    seg.chars().filter(|c| !ignorable(*c)).collect::<String>().trim_end_matches(['.', ' ']).to_lowercase()
}

/// `.git`, `.GIT.`, `git~1` (its 8.3 short name) and the like.
fn is_dotgit(seg: &str) -> bool {
    let f = folded(seg);
    f == ".git" || f.strip_prefix("git~").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Whether `path` is a safe relative path inside `work` to write or delete; the reason otherwise.
pub(super) fn safe(work: &Path, path: &str) -> Result<(), String> {
    let unsafe_path = || t!("同步版本含有不安全的路径，已拒绝整版：{path}", path = path);
    let segs: Vec<&str> = path.split('/').collect();
    let bad_seg = |s: &&str| {
        s.is_empty()
            || s.ends_with(['.', ' '])
            || s.chars().any(|c| c.is_control() || c == ':' || c == '\\')
            || is_dotgit(s)
    };
    if segs.iter().any(bad_seg)
        || folded(segs[0]) == ".gonggong"
        || !Path::new(path).components().all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(unsafe_path());
    }
    let mut at = work.to_path_buf();
    for seg in segs {
        at.push(seg);
        match std::fs::symlink_metadata(&at) {
            Ok(m) if m.file_type().is_symlink() => return Err(unsafe_path()),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_relative_paths_pass() {
        let dir = tempfile::tempdir().unwrap();
        for ok in
            ["a.txt", "src/main.rs", "中文/文件.md", ".gitignore", ".github/workflows/ci.yml", "x/.gitkeep", "gitx"]
        {
            assert_eq!(safe(dir.path(), ok), Ok(()), "{ok}");
        }
    }

    #[test]
    fn rejects_escapes_git_internals_and_odd_names() {
        let dir = tempfile::tempdir().unwrap();
        let bad = [
            "",
            "/etc/passwd",
            "../x",
            "a/../../x",
            "./a",
            "a//b",
            "a/",
            ".git/hooks/pre-commit",
            ".GIT/config",
            "sub/.git/config",
            ".git./config",
            ".git /config",
            "GIT~1/config",
            "git~12",
            ".g\u{200c}it/config",
            ".gonggong/attachments/a.png",
            ".GongGong/x",
            "c:/x",
            "a:b",
            "a\\..\\b",
            "tab\there",
            "dot.",
            "space ",
        ];
        for p in bad {
            assert!(safe(dir.path(), p).is_err(), "{p:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_paths_through_a_symlink_in_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", dir.path().join("file-link")).unwrap();
        assert!(safe(dir.path(), "link/x.txt").is_err());
        assert!(safe(dir.path(), "file-link").is_err());
        std::fs::create_dir(dir.path().join("real")).unwrap();
        assert_eq!(safe(dir.path(), "real/new/x.txt"), Ok(()));
    }
}
