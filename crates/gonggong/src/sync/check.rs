//! What must hold before a version is submitted (F17, F18, and no untracked secret files); any violation holds the
//! whole version.
use super::Tree;
use crate::i18n::Reason;
use crate::protocol::{SYNC_FILE_MAX_BYTES, SYNC_SUBMIT_CHANGES_MAX, SYNC_VERSION_MAX_BYTES, SyncChange};
use crate::reason;
use std::collections::HashMap;
use std::collections::hash_map::Entry;

/// Longest path Windows accepts without long-path support.
const PATH_MAX: usize = 260;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Issue {
    Symlink,
    NotUtf8,
    /// Equal to this other path ignoring case: one file on macOS and Windows.
    CaseClash(String),
    WindowsName,
    TooLong,
    FileTooLarge(u64),
    /// The version's new content totals this many bytes; reported on its largest file.
    VersionTooLarge(u64),
    /// Named like a secret (`.env`, private keys, credentials) and not tracked by git.
    Secret,
    /// The version changes this many files, more than a submit carries; reported on the top-level entry with most.
    TooManyFiles(usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub path: String,
    pub issue: Issue,
}

impl Violation {
    pub fn reason(&self) -> Reason {
        let mb = |n: u64| n.div_ceil(1024 * 1024);
        match &self.issue {
            Issue::Symlink => reason!("{path} 是符号链接，不能同步", path = self.path),
            Issue::NotUtf8 => reason!("{path} 的文件名不是 UTF-8 编码", path = self.path),
            Issue::CaseClash(other) => reason!(
                "{path} 与 {other} 只有大小写不同，在 macOS 与 Windows 上会冲突",
                path = self.path,
                other = other
            ),
            Issue::WindowsName => reason!("{path} 在 Windows 上是非法文件名", path = self.path),
            Issue::TooLong => reason!("{path} 路径超过 260 个字符", path = self.path),
            Issue::FileTooLarge(n) => reason!(
                "{path} 有 {size} MB，超过单文件上限 {max} MB，请加入 .gitignore",
                path = self.path,
                size = mb(*n),
                max = mb(SYNC_FILE_MAX_BYTES)
            ),
            Issue::VersionTooLarge(n) => reason!(
                "本版改动共 {size} MB，超过单版上限 {max} MB（最大的是 {path}），请把大文件加入 .gitignore",
                path = self.path,
                size = mb(*n),
                max = mb(SYNC_VERSION_MAX_BYTES)
            ),
            Issue::Secret => {
                reason!("疑似密钥文件 {path}，未被 git 跟踪，请加入 .gitignore 或移出工作区", path = self.path)
            }
            Issue::TooManyFiles(n) => reason!(
                "本版改动共 {n} 个文件，超过单版上限 {max} 个（最多的是 {path}），请把生成的文件加入 .gitignore",
                n = n,
                max = SYNC_SUBMIT_CHANGES_MAX,
                path = self.path
            ),
        }
    }
}

/// Violations of `changes` (taken from `tree`) plus whatever in the tree can never sync.
pub fn check(tree: &Tree, changes: &[SyncChange]) -> Vec<Violation> {
    let mut out = tree.odd.clone();
    let mut push = |path: &str, issue| out.push(Violation { path: path.into(), issue });
    let (mut total, mut largest) = (0, ("", 0));
    for c in changes.iter().filter(|c| c.hash.is_some()) {
        if !windows_name(&c.path) {
            push(&c.path, Issue::WindowsName);
        }
        if c.path.encode_utf16().count() > PATH_MAX {
            push(&c.path, Issue::TooLong);
        }
        let size = tree.files.get(&c.path).map_or(0, |s| s.size);
        if size > SYNC_FILE_MAX_BYTES {
            push(&c.path, Issue::FileTooLarge(size));
        }
        if tree.untracked.contains(&c.path) && secret_name(&c.path) {
            push(&c.path, Issue::Secret);
        }
        total += size;
        if size >= largest.1 {
            largest = (&c.path, size);
        }
    }
    if total > SYNC_VERSION_MAX_BYTES {
        push(largest.0, Issue::VersionTooLarge(total));
    }
    if changes.len() > SYNC_SUBMIT_CHANGES_MAX {
        let mut tops: HashMap<&str, usize> = HashMap::new();
        for c in changes {
            *tops.entry(c.path.split('/').next().unwrap_or_default()).or_default() += 1;
        }
        let top = tops.into_iter().max_by_key(|&(p, n)| (n, std::cmp::Reverse(p))).map_or("", |(p, _)| p);
        push(top, Issue::TooManyFiles(changes.len()));
    }
    out.extend(case_clashes(tree.files.keys()));
    out
}

/// Files and directories equal ignoring case, once per clashing path.
fn case_clashes<'a>(paths: impl Iterator<Item = &'a String>) -> Vec<Violation> {
    let mut seen: HashMap<String, &str> = HashMap::new();
    let mut out: Vec<Violation> = vec![];
    for p in paths {
        for end in p.match_indices('/').map(|(i, _)| i).chain([p.len()]) {
            let prefix = &p[..end];
            match seen.entry(prefix.to_lowercase()) {
                Entry::Vacant(v) => {
                    v.insert(prefix);
                }
                Entry::Occupied(o) if *o.get() != prefix && !out.iter().any(|v| v.path == prefix) => {
                    out.push(Violation { path: prefix.into(), issue: Issue::CaseClash(o.get().to_string()) })
                }
                Entry::Occupied(_) => {}
            }
        }
    }
    out
}

/// Whether the file name looks like it holds credentials (case-insensitive); `.env` templates are fine.
fn secret_name(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let env = name == ".env"
        || (name.starts_with(".env.") && !matches!(name.as_str(), ".env.example" | ".env.sample" | ".env.template"));
    let ext = name.rsplit_once('.').map(|(_, e)| e);
    env || matches!(ext, Some("pem" | "key" | "p12" | "pfx"))
        || matches!(
            name.as_str(),
            "id_rsa" | "id_dsa" | "id_ecdsa" | "id_ed25519" | ".npmrc" | ".netrc" | "credentials.json"
        )
}

fn windows_name(path: &str) -> bool {
    path.split('/').all(|seg| {
        let stem = seg.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
        let numbered = |prefix| {
            stem.strip_prefix(prefix).is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit() && n != "0")
        };
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || numbered("COM") || numbered("LPT");
        !reserved && !seg.ends_with(['.', ' ']) && !seg.chars().any(|c| c < ' ' || r#"<>:"|?*\"#.contains(c))
    })
}

#[cfg(test)]
mod tests {
    use super::super::Stat;
    use super::*;

    fn tree(files: &[(&str, u64)]) -> Tree {
        let mut t = Tree::default();
        for (p, size) in files {
            t.files.insert(p.to_string(), Stat { size: *size, mtime: 0, hash: "h".into(), exec: false });
        }
        t
    }

    fn added(paths: &[&str]) -> Vec<SyncChange> {
        paths
            .iter()
            .map(|p| SyncChange { path: p.to_string(), hash: Some("h".into()), exec: false, base_hash: None })
            .collect()
    }

    fn issues(tree: &Tree, changes: &[SyncChange]) -> Vec<(String, Issue)> {
        check(tree, changes).into_iter().map(|v| (v.path, v.issue)).collect()
    }

    #[test]
    fn a_clean_change_passes() {
        let t = tree(&[("src/a.rs", 10), ("docs/中文.md", 5)]);
        assert!(check(&t, &added(&["src/a.rs", "docs/中文.md"])).is_empty());
    }

    #[test]
    fn catches_case_clashes_of_files_and_directories() {
        let t = tree(&[("README.md", 1), ("readme.md", 1), ("Src/a.rs", 1), ("src/b.rs", 1), ("ok", 1)]);
        assert_eq!(
            issues(&t, &[]),
            [
                ("readme.md".into(), Issue::CaseClash("README.md".into())),
                ("src".into(), Issue::CaseClash("Src".into())),
            ]
        );
    }

    #[test]
    fn catches_windows_invalid_and_reserved_names() {
        let bad = ["CON", "aux.txt", "dir/com1.log", "LPT9", "nul .txt", "a.", "b ", "x/y<z", "q?", "c:d", "t\u{1}"];
        let good = ["console", "com10", "com0", "lpt", "a.b", "con1.txt", ".env"];
        let mut all = bad.to_vec();
        all.extend(good);
        let t = tree(&all.iter().map(|p| (*p, 1)).collect::<Vec<_>>());
        let found: Vec<_> = issues(&t, &added(&all)).into_iter().map(|(p, _)| p).collect();
        assert_eq!(found, bad);
    }

    #[test]
    fn catches_long_paths_and_size_limits() {
        let long = format!("{}/f", "d".repeat(259));
        let big = SYNC_FILE_MAX_BYTES + 1;
        let t = tree(&[(&long, 1), ("big.bin", big)]);
        assert_eq!(
            issues(&t, &added(&[&long, "big.bin"])),
            [(long.clone(), Issue::TooLong), ("big.bin".into(), Issue::FileTooLarge(big))]
        );
        let each = SYNC_FILE_MAX_BYTES - 10;
        let files: Vec<_> = (0..5).map(|i| (format!("p{i}"), each + i)).collect();
        let t = tree(&files.iter().map(|(p, s)| (p.as_str(), *s)).collect::<Vec<_>>());
        let total = files.iter().map(|(_, s)| s).sum();
        assert_eq!(issues(&t, &added(&["p0", "p1", "p2", "p3", "p4"])), [("p4".into(), Issue::VersionTooLarge(total))]);
    }

    #[test]
    fn a_version_with_more_files_than_a_submit_carries_is_refused_on_its_biggest_directory() {
        let mut paths: Vec<String> = (0..SYNC_SUBMIT_CHANGES_MAX).map(|i| format!("gen/{i}")).collect();
        paths.push("README.md".into());
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let changes = added(&refs);
        assert_eq!(issues(&tree(&[]), &changes), [("gen".into(), Issue::TooManyFiles(SYNC_SUBMIT_CHANGES_MAX + 1))]);
        assert!(check(&tree(&[]), &changes[1..]).is_empty());
    }

    #[test]
    fn deletions_are_not_checked_and_odd_entries_always_are() {
        let mut t = tree(&[]);
        t.odd.push(Violation { path: "link".into(), issue: Issue::Symlink });
        let del = SyncChange { path: "CON".into(), hash: None, exec: false, base_hash: Some("h".into()) };
        assert_eq!(issues(&t, &[del]), [("link".into(), Issue::Symlink)]);
    }

    #[test]
    fn reasons_name_the_path_and_carry_their_template() {
        let v = Violation { path: "a/CON".into(), issue: Issue::WindowsName };
        assert!(v.reason().text.contains("a/CON"));
        let v = Violation { path: "big".into(), issue: Issue::FileTooLarge(SYNC_FILE_MAX_BYTES + 1) };
        let r = v.reason();
        assert!(r.text.contains("51 MB"));
        let i18n = r.i18n.unwrap();
        assert_eq!(i18n.key, "{path} 有 {size} MB，超过单文件上限 {max} MB，请加入 .gitignore");
        assert_eq!((i18n.params["path"].as_str(), i18n.params["size"].as_str()), ("big", "51"));
    }

    fn untracked(mut t: Tree, paths: &[&str]) -> Tree {
        t.untracked = paths.iter().map(|p| p.to_string()).collect();
        t
    }

    #[test]
    fn refuses_untracked_files_named_like_secrets() {
        let secrets = [
            ".env",
            "app/.ENV.local",
            "certs/server.pem",
            "tls.Key",
            "a.p12",
            "b.pfx",
            "id_rsa",
            "home/.ssh/id_ed25519",
            "id_dsa",
            "id_ecdsa",
            ".npmrc",
            ".netrc",
            "gcp/credentials.json",
        ];
        let fine = [".env.example", ".env.sample", ".env.template", "id_rsa.pub", "keys.txt", "env", "src/key.rs"];
        let all: Vec<_> = secrets.iter().chain(&fine).copied().collect();
        let t = untracked(tree(&all.iter().map(|p| (*p, 1)).collect::<Vec<_>>()), &all);
        let found: Vec<_> =
            issues(&t, &added(&all)).into_iter().filter(|(_, i)| *i == Issue::Secret).map(|(p, _)| p).collect();
        assert_eq!(found, secrets);
    }

    #[test]
    fn tracked_secret_files_are_never_refused() {
        let t = untracked(tree(&[(".env", 1), ("other.txt", 1)]), &["other.txt"]);
        assert!(check(&t, &added(&[".env", "other.txt"])).is_empty());
    }

    #[test]
    fn the_secret_reason_names_the_path() {
        let r = Violation { path: "app/.env".into(), issue: Issue::Secret }.reason();
        assert_eq!(r.text, "疑似密钥文件 app/.env，未被 git 跟踪，请加入 .gitignore 或移出工作区");
        assert_eq!(r.i18n.unwrap().key, "疑似密钥文件 {path}，未被 git 跟踪，请加入 .gitignore 或移出工作区");
    }
}
