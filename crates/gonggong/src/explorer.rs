//! Read-only files browser over a (group, bot) workspace (预览工作台): one directory level at a time, text content,
//! and the path check every workspace file access goes through.
use crate::git::{self, git};
use crate::protocol::TreeEntry;
use crate::t;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const TREE_MAX_ENTRIES: usize = 1000;
/// Bytes sniffed to tell text from binary when the file is too big to read whole.
const SNIFF_BYTES: usize = 8 * 1024;

/// `rel` (relative to `root`, '' = the root) as a canonical path inside the canonical root. Absolute paths, `..`,
/// symlinks leading outside and anything in `.git` (remote URLs may carry credentials) are refused.
pub fn resolve(root: &Path, rel: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = root.canonicalize().map_err(|_| t!("工作区不存在：{path}", path = root.display()))?;
    let outside = || t!("路径超出工作区：{path}", path = rel);
    let rel_path = Path::new(rel);
    if rel_path.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(outside());
    }
    let path = root.join(rel_path).canonicalize().map_err(|_| t!("文件不存在：{path}", path = rel))?;
    let inner = path.strip_prefix(&root).map_err(|_| outside())?;
    if inner.components().any(|c| c.as_os_str() == ".git") {
        return Err(t!("不能读取 .git：{path}", path = rel));
    }
    Ok((root, path))
}

/// One directory level: dirs first, then files, each by name; `.git` hidden, ignored entries only when asked.
/// The bool is true when the directory had more than TREE_MAX_ENTRIES shown entries.
pub async fn tree(root: &Path, rel: &str, show_ignored: bool) -> Result<(Vec<TreeEntry>, bool), String> {
    let (root, dir) = resolve(root, rel)?;
    if !dir.is_dir() {
        return Err(t!("不是目录：{path}", path = rel));
    }
    let prefix = dir.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
    let marks = if git::is_repo(&root) { Marks::of(&root, &prefix).await? } else { Marks::default() };
    let mut entries = tokio::task::spawn_blocking(move || {
        std::fs::read_dir(&dir).map(|read| {
            read.flatten()
                .filter(|e| e.file_name() != ".git")
                .filter_map(|e| {
                    let meta = e.metadata().or_else(|_| e.path().symlink_metadata()).ok()?;
                    let name = e.file_name().to_string_lossy().into_owned();
                    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok());
                    Some(TreeEntry {
                        dir: meta.is_dir(),
                        size: if meta.is_dir() { 0 } else { meta.len() },
                        mtime: mtime.map_or(0, |d| d.as_millis() as u64),
                        uncommitted: false,
                        ignored: false,
                        name,
                    })
                })
                .collect::<Vec<_>>()
        })
    })
    .await
    .map_err(|e| t!("读取目录失败：{e}", e = e))?
    .map_err(|e| t!("读取目录失败：{e}", e = e))?;
    for e in &mut entries {
        e.ignored = marks.ignored.contains(&e.name);
        e.uncommitted = marks.untracked || marks.changed.contains(&e.name);
    }
    entries.retain(|e| show_ignored || !e.ignored);
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let truncated = entries.len() > TREE_MAX_ENTRIES;
    entries.truncate(TREE_MAX_ENTRIES);
    Ok((entries, truncated))
}

/// Names directly under one directory that git reports as ignored, or as changed / untracked (at or below them).
#[derive(Default)]
struct Marks {
    ignored: HashSet<String>,
    changed: HashSet<String>,
    /// The directory (or one above it) is untracked, so is everything in it.
    untracked: bool,
}

impl Marks {
    /// Asked of the innermost checked-out submodule holding `prefix`: git refuses pathspecs inside a submodule.
    async fn of(root: &Path, prefix: &str) -> Result<Self, String> {
        let (mut root, mut prefix) = (root.to_path_buf(), prefix.to_string());
        'descend: loop {
            for sub in git::submodules(&root).await {
                if let Some(rest) = prefix.strip_prefix(&sub).filter(|r| r.is_empty() || r.starts_with('/')) {
                    (root, prefix) = (root.join(&sub), rest.trim_start_matches('/').to_string());
                    continue 'descend;
                }
            }
            break;
        }
        let (root, prefix) = (root.as_path(), prefix.as_str());
        let spec = if prefix.is_empty() { ".".to_string() } else { format!(":(literal){prefix}") };
        let args = ["status", "--porcelain=v1", "-z", "--ignored=matching", "--untracked-files=normal", "--", &spec];
        let raw = git(root, &args).await?;
        let lead = if prefix.is_empty() { String::new() } else { format!("{prefix}/") };
        let mut marks = Marks::default();
        let mut tokens = raw.split('\0').filter(|t| !t.is_empty());
        while let Some(t) = tokens.next() {
            let (xy, path) = t.split_at(3.min(t.len()));
            if xy.contains(['R', 'C']) {
                tokens.next();
            }
            if xy.trim_end() == "??" && path.ends_with('/') && lead.starts_with(path) {
                marks.untracked = true;
            }
            let Some(rest) = path.strip_prefix(&lead) else { continue };
            let name = rest.split('/').next().unwrap_or_default().to_string();
            if xy.trim_end() != "!!" {
                marks.changed.insert(name);
            } else if rest.trim_end_matches('/') == name {
                marks.ignored.insert(name);
            }
        }
        Ok(marks)
    }
}

#[derive(Debug, PartialEq)]
pub struct Read {
    pub size: u64,
    pub binary: bool,
    pub mime: String,
    pub text: Option<String>,
}

/// A file's metadata, with its content when it is UTF-8 text of at most `max_bytes`.
pub async fn read(root: &Path, rel: &str, max_bytes: u64) -> Result<Read, String> {
    let (_, path) = resolve(root, rel)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| t!("读取文件失败：{e}", e = e))?;
    if !meta.is_file() {
        return Err(t!("不是文件：{path}", path = rel));
    }
    let size = meta.len();
    let (binary, text) = if size <= max_bytes {
        let bytes = tokio::fs::read(&path).await.map_err(|e| t!("读取文件失败：{e}", e = e))?;
        match String::from_utf8(bytes) {
            Ok(s) if !s.contains('\0') => (false, Some(s)),
            _ => (true, None),
        }
    } else {
        let mut head = vec![0; SNIFF_BYTES];
        let n = {
            use tokio::io::AsyncReadExt;
            let mut f = tokio::fs::File::open(&path).await.map_err(|e| t!("读取文件失败：{e}", e = e))?;
            f.read(&mut head).await.map_err(|e| t!("读取文件失败：{e}", e = e))?
        };
        (!looks_like_text(&head[..n]), None)
    };
    let mime = match crate::static_site::mime(&path) {
        "application/octet-stream" if !binary => "text/plain; charset=utf-8",
        m => m,
    };
    Ok(Read { size, binary, mime: mime.into(), text })
}

/// UTF-8 without NULs; a character cut off at the end of the sample still counts as text.
fn looks_like_text(head: &[u8]) -> bool {
    !head.contains(&0)
        && match std::str::from_utf8(head) {
            Ok(_) => true,
            Err(e) => e.error_len().is_none(),
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testing::{Remote, run};
    use std::fs;

    fn names(entries: &[TreeEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[tokio::test]
    async fn lists_one_level_dirs_first_hiding_git_and_ignored_entries() {
        let r = Remote::new();
        let w = r.clone_to("w");
        fs::create_dir_all(w.join("src")).unwrap();
        fs::write(w.join("src/main.rs"), "fn main() {}\n").unwrap();
        run(&w, &["add", "-A"]);
        run(&w, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "src"]);
        fs::write(w.join(".gitignore"), "target/\n*.log\n").unwrap();
        fs::create_dir_all(w.join("target/debug")).unwrap();
        fs::write(w.join("app.log"), "x").unwrap();
        fs::write(w.join("b.txt"), "hello").unwrap();
        fs::create_dir_all(w.join("Assets")).unwrap();
        fs::write(w.join("Assets/logo.svg"), "<svg/>").unwrap();

        let (all, truncated) = tree(&w, "", false).await.unwrap();
        assert!(!truncated);
        assert_eq!(names(&all), ["Assets", "src", ".gitignore", "b.txt", "README.md"]);
        let get = |n: &str| all.iter().find(|e| e.name == n).unwrap();
        assert!(get("Assets").dir && get("Assets").uncommitted, "untracked dir");
        assert!(!get("src").uncommitted);
        assert!(get("b.txt").uncommitted);
        assert_eq!((get("b.txt").size, get("Assets").size), (5, 0));
        assert!(get("b.txt").mtime > 1_600_000_000_000);

        let (with_ignored, _) = tree(&w, "", true).await.unwrap();
        assert_eq!(names(&with_ignored), ["Assets", "src", "target", ".gitignore", "app.log", "b.txt", "README.md"]);
        assert!(with_ignored.iter().filter(|e| e.ignored).map(|e| e.name.as_str()).eq(["target", "app.log"]));

        fs::write(w.join("src/main.rs"), "changed").unwrap();
        let (src, _) = tree(&w, "src", false).await.unwrap();
        assert_eq!(names(&src), ["main.rs"]);
        assert!(src[0].uncommitted);
        assert!(tree(&w, "", false).await.unwrap().0.iter().find(|e| e.name == "src").unwrap().uncommitted);
    }

    #[tokio::test]
    async fn marks_changes_inside_submodules() {
        let r = Remote::new();
        let w = r.clone_to("w");
        r.add_submodule(&w, "lib", "lib");
        fs::create_dir_all(w.join("lib/src")).unwrap();
        fs::write(w.join("lib/src/new.rs"), "x").unwrap();
        fs::write(w.join("lib/a.txt"), "changed").unwrap();
        let (top, _) = tree(&w, "", false).await.unwrap();
        assert!(top.iter().find(|e| e.name == "lib").unwrap().uncommitted);
        let (lib, _) = tree(&w, "lib", false).await.unwrap();
        assert_eq!(names(&lib), ["src", "a.txt"]);
        assert!(lib.iter().all(|e| e.uncommitted));
        let (src, _) = tree(&w, "lib/src", false).await.unwrap();
        assert!(src[0].uncommitted);
    }

    #[tokio::test]
    async fn plain_directories_list_without_git_marks_and_truncate() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..TREE_MAX_ENTRIES + 5 {
            fs::write(dir.path().join(format!("f{i:04}.txt")), "x").unwrap();
        }
        fs::create_dir(dir.path().join("zdir")).unwrap();
        let (entries, truncated) = tree(dir.path(), "", false).await.unwrap();
        assert!(truncated);
        assert_eq!(entries.len(), TREE_MAX_ENTRIES);
        assert_eq!(entries[0].name, "zdir");
        assert!(entries.iter().all(|e| !e.uncommitted && !e.ignored));
        assert!(tree(dir.path(), "f0000.txt", false).await.is_err());
    }

    #[tokio::test]
    async fn reads_utf8_text_and_reports_binary_or_oversized_files_without_content() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        fs::write(p.join("a.md"), "# 标题\n").unwrap();
        fs::write(p.join("Makefile"), "all:\n").unwrap();
        fs::write(p.join("logo.png"), [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        fs::write(p.join("big.txt"), "中".repeat(10)).unwrap();

        let md = read(p, "a.md", 1024).await.unwrap();
        assert_eq!(
            md,
            Read { size: 9, binary: false, mime: "text/plain; charset=utf-8".into(), text: Some("# 标题\n".into()) }
        );
        assert_eq!(read(p, "Makefile", 1024).await.unwrap().mime, "text/plain; charset=utf-8");
        let png = read(p, "logo.png", 1024).await.unwrap();
        assert_eq!((png.binary, png.mime.as_str(), png.text, png.size), (true, "image/png", None, 7));
        // Over the cap: sniffed as text (a cut-off character included), no content.
        let big = read(p, "big.txt", 4).await.unwrap();
        assert_eq!((big.size, big.binary, big.text), (30, false, None));
        assert!(read(p, "", 1024).await.is_err());
        assert!(read(p, "nope.txt", 1024).await.unwrap_err().contains("不存在"));
    }

    #[test]
    fn refuses_every_way_out_of_the_workspace() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "url = https://token@host/x").unwrap();
        fs::write(outer.path().join("secret.txt"), "s").unwrap();
        fs::write(root.join("sub/ok.txt"), "ok").unwrap();

        assert!(resolve(&root, "sub/ok.txt").unwrap().1.ends_with("sub/ok.txt"));
        assert_eq!(resolve(&root, "").unwrap().1, root.canonicalize().unwrap());
        for bad in ["../secret.txt", "sub/../../secret.txt", "..", "/etc/passwd", ".git/config", "sub/../.git"] {
            assert!(resolve(&root, bad).is_err(), "{bad}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(outer.path().join("secret.txt"), root.join("link.txt")).unwrap();
            std::os::unix::fs::symlink(outer.path(), root.join("up")).unwrap();
            std::os::unix::fs::symlink(root.join("sub/ok.txt"), root.join("inside.txt")).unwrap();
            assert!(resolve(&root, "link.txt").unwrap_err().contains("超出工作区"));
            assert!(resolve(&root, "up/secret.txt").unwrap_err().contains("超出工作区"));
            assert!(resolve(&root, "inside.txt").is_ok(), "symlinks within the workspace are fine");
        }
    }

    #[tokio::test]
    async fn reads_and_lists_refuse_escapes_too() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        fs::write(outer.path().join("secret.txt"), "s").unwrap();
        assert!(read(&root, "../secret.txt", 1024).await.unwrap_err().contains("超出工作区"));
        assert!(tree(&root, "..", false).await.unwrap_err().contains("超出工作区"));
        run(&root, &["init", "-q"]);
        assert!(tree(&root, ".git", true).await.is_err());
    }
}
