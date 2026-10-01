//! @ file candidates from a (group, bot) workspace (spec §8.7): git-visible files incl. uncommitted, plus folders.
use crate::git::{self, git};
use crate::protocol::FileEntry;
use crate::t;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Walk cap for workspaces without git, so a huge directory can't stall the popover.
const WALK_MAX: usize = 20_000;
const SKIP: [&str; 3] = [".gonggong", ".git", "node_modules"];

/// Entries matching `query` (case-insensitive prefix / substring / subsequence), best first; folders end with `/`.
pub async fn list(dir: &Path, query: &str, limit: usize) -> Result<Vec<FileEntry>, String> {
    if !dir.is_dir() {
        return Err(t!("工作区不存在：{path}", path = dir.display()));
    }
    let files = if git::is_repo(dir) { tracked(dir).await? } else { walk(dir.to_path_buf()).await? };
    let mut entries: Vec<(Rank, FileEntry)> = with_dirs(files)
        .into_iter()
        .filter_map(|(path, (dir, uncommitted))| Some((rank(&path, query)?, FileEntry { path, dir, uncommitted })))
        .collect();
    entries.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.path.cmp(&y.path)));
    Ok(entries.into_iter().take(limit).map(|(_, e)| e).collect())
}

/// `git ls-files` (tracked + untracked, not ignored) → path → uncommitted; files deleted in the work tree are left out.
/// Checked-out submodules contribute their own files instead of their commit pointer.
async fn tracked(dir: &Path) -> Result<BTreeMap<String, bool>, String> {
    let subs = git::submodules(dir).await;
    let changed = git::porcelain(dir).await?;
    let raw = git(dir, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).await?;
    let mut files: BTreeMap<String, bool> = raw
        .split('\0')
        .filter(|p| !p.is_empty() && !p.starts_with(git::PRIVATE_DIR) && !subs.contains(*p))
        .filter(|p| !changed.get(*p).is_some_and(|xy| xy.contains('D')))
        .map(|p| (p.to_string(), changed.contains_key(p)))
        .collect();
    for sub in &subs {
        let inner = Box::pin(tracked(&dir.join(sub))).await?;
        files.extend(inner.into_iter().map(|(p, u)| (format!("{sub}/{p}"), u)));
    }
    Ok(files)
}

async fn walk(root: std::path::PathBuf) -> Result<BTreeMap<String, bool>, String> {
    tokio::task::spawn_blocking(move || {
        let mut files = BTreeMap::new();
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else { continue };
            for entry in read.flatten() {
                if files.len() >= WALK_MAX {
                    return files;
                }
                let name = entry.file_name();
                if SKIP.iter().any(|s| name == *s) {
                    continue;
                }
                let Ok(kind) = entry.file_type() else { continue };
                let path = entry.path();
                if kind.is_dir() {
                    stack.push(path);
                } else if let Ok(rel) = path.strip_prefix(&root) {
                    files.insert(rel.to_string_lossy().replace('\\', "/"), false);
                }
            }
        }
        files
    })
    .await
    .map_err(|e| t!("遍历工作区失败：{e}", e = e))
}

/// Files plus every ancestor folder (`a/`, `a/b/`) → (dir, uncommitted).
fn with_dirs(files: BTreeMap<String, bool>) -> BTreeMap<String, (bool, bool)> {
    let dirs: BTreeSet<String> =
        files.keys().flat_map(|p| p.match_indices('/').map(|(i, _)| p[..=i].to_string()).collect::<Vec<_>>()).collect();
    let mut out: BTreeMap<_, _> = files.into_iter().map(|(p, u)| (p, (false, u))).collect();
    out.extend(dirs.into_iter().map(|d| (d, (true, false))));
    out
}

/// Lower is better (ties: by path): (match kind, path length). Kinds: 0 path prefix, 1 name prefix, 2 substring,
/// 3 name subsequence. An empty query ranks by depth. Mirrored by the server (modules/candidates/match.ts).
type Rank = (usize, usize);

fn rank(path: &str, query: &str) -> Option<Rank> {
    let (p, q) = (path.to_lowercase(), query.to_lowercase());
    if q.is_empty() {
        return Some((p.trim_end_matches('/').matches('/').count(), 0));
    }
    let name = p.trim_end_matches('/').rsplit('/').next().unwrap_or(&p);
    let kind = if p.starts_with(&q) {
        0
    } else if name.starts_with(&q) {
        1
    } else if p.contains(&q) {
        2
    } else {
        let mut chars = name.chars();
        if !q.chars().all(|c| chars.any(|x| x == c)) {
            return None;
        }
        3
    };
    Some((kind, p.len()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testing::{Remote, run};
    use std::fs;

    fn paths(entries: &[FileEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.path.as_str()).collect()
    }

    #[tokio::test]
    async fn repo_lists_committed_untracked_and_folders_with_uncommitted_flags() {
        let r = Remote::new();
        r.commit("server.go", "package main\n");
        let w = r.clone_to("w");
        fs::create_dir_all(w.join("server/refund/v2")).unwrap();
        fs::write(w.join("server/refund/v2/handler.go"), "x").unwrap();
        fs::write(w.join("server.go"), "changed").unwrap();
        fs::write(w.join(".gitignore"), "ignored.log\n").unwrap();
        fs::write(w.join("ignored.log"), "x").unwrap();
        fs::create_dir_all(w.join(".gonggong/attachments")).unwrap();
        fs::write(w.join(".gonggong/attachments/a.png"), "x").unwrap();
        fs::remove_file(w.join("README.md")).unwrap();

        let all = list(&w, "", 100).await.unwrap();
        assert_eq!(
            paths(&all),
            [
                ".gitignore",
                "server.go",
                "server/",
                "server/refund/",
                "server/refund/v2/",
                "server/refund/v2/handler.go"
            ]
        );
        let get = |p: &str| all.iter().find(|e| e.path == p).unwrap();
        assert!(get("server/refund/v2/handler.go").uncommitted);
        assert!(get("server.go").uncommitted);
        assert!(get("server/refund/").dir);
        assert!(!get("server/refund/").uncommitted);
        run(&w, &["add", "-A"]);
        run(&w, &["commit", "-q", "-m", "c"]);
        assert!(list(&w, "handler", 10).await.unwrap().iter().all(|e| !e.uncommitted));
    }

    #[tokio::test]
    async fn submodule_files_are_listed_in_place_of_the_submodule_pointer() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "vendor/lib");
        fs::write(w.join("vendor/lib/b.txt"), "x").unwrap();
        let all = list(&w, "vendor", 10).await.unwrap();
        assert_eq!(paths(&all), ["vendor/", "vendor/lib/", "vendor/lib/a.txt", "vendor/lib/b.txt"]);
        assert!(all.iter().all(|e| e.dir || e.uncommitted == (e.path == "vendor/lib/b.txt")));
    }

    #[tokio::test]
    async fn query_ranks_prefix_then_name_then_substring_then_fuzzy_and_honours_the_limit() {
        let r = Remote::new();
        let w = r.clone_to("w");
        for f in ["docs/readme-old.txt", "src/reader.rs", "a/b/rd.md"] {
            fs::create_dir_all(w.join(f).parent().unwrap()).unwrap();
            fs::write(w.join(f), "x").unwrap();
        }
        let hits = list(&w, "READ", 10).await.unwrap();
        assert_eq!(paths(&hits), ["README.md", "src/reader.rs", "docs/readme-old.txt"]);
        assert_eq!(paths(&list(&w, "rd.m", 10).await.unwrap()), ["a/b/rd.md", "README.md"]);
        assert_eq!(paths(&list(&w, "sr", 10).await.unwrap())[0], "src/");
        assert_eq!(list(&w, "", 2).await.unwrap().len(), 2);
        assert!(list(&w, "zzz", 10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn plain_directories_are_walked_skipping_private_and_vendor_dirs() {
        let dir = tempfile::tempdir().unwrap();
        for f in ["notes/a.md", "node_modules/x/index.js", ".gonggong/attachments/m/a.png", "b.txt"] {
            fs::create_dir_all(dir.path().join(f).parent().unwrap()).unwrap();
            fs::write(dir.path().join(f), "x").unwrap();
        }
        let all = list(dir.path(), "", 10).await.unwrap();
        assert_eq!(paths(&all), ["b.txt", "notes/", "notes/a.md"]);
        assert!(all.iter().all(|e| !e.uncommitted));
    }

    #[tokio::test]
    async fn missing_workspace_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(&dir.path().join("nope"), "", 10).await.is_err());
    }
}
