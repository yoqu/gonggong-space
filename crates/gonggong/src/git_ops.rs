//! Manual git from the group: views of any ref, of the work tree's changes and of what stopped midway, that never
//! touch the work tree or the index. The owner's writes are in [`crate::git_write`].
use crate::explorer::{self, SNIFF_BYTES};
use crate::git::{self, EMPTY_TREE, git, git_bytes, git_capped_bytes, git_output};
use crate::protocol::{
    GitBlameCommit, GitBlameRange, GitBranch, GitBranchKind, GitChange, GitChangeKind, GitCommit, GitConflict,
    GitConflictSide, GitHeadCommit, GitLogFilter, GitLogOrder, GitOngoing, GitRemote, GitStash, GitTag, GitWhitespace,
    GitWorkChange, TreeEntry,
};
use crate::repo::{self, remote_git};
use crate::t;
use futures_util::StreamExt;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub(crate) const NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

pub(crate) fn repo_dir(dir: &Path) -> Result<(), String> {
    if git::is_repo(dir) { Ok(()) } else { Err(git::not_git().into()) }
}

/// A ref, branch or remote name given to git as an argument: one starting with `-` would be read as an option.
pub(crate) fn arg(name: &str) -> Result<&str, String> {
    match name.starts_with('-') || name.is_empty() {
        true => Err(t!("无效的名称：{name}", name = name)),
        false => Ok(name),
    }
}

/// `rel` inside a tree, `/`-separated without empty or `.` parts ('' = the root); `..` and absolute paths are refused.
pub(crate) fn tree_path(rel: &str) -> Result<String, String> {
    let path = Path::new(rel);
    if path.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(t!("路径超出工作区：{path}", path = rel));
    }
    let parts: Vec<_> = path.components().filter_map(|c| c.as_os_str().to_str()).filter(|p| *p != ".").collect();
    Ok(parts.join("/"))
}

/// A path in the daemon's private dir, which manual git never acts on.
pub(crate) fn private(path: &str) -> bool {
    format!("{path}/").starts_with(git::PRIVATE_DIR)
}

/// The directory of `repo`, a path as GitStatus.repos reports it, in the workspace `dir` (None = `dir` itself): a
/// '/'-separated path below `dir`, or an absolute one inside one of `extras`.
pub fn repo_path(dir: &Path, extras: &[String], repo: Option<&str>) -> Result<PathBuf, String> {
    let Some(repo) = repo else { return Ok(dir.to_path_buf()) };
    let path = Path::new(repo);
    if path.is_absolute() {
        let inside =
            !path.components().any(|c| c == Component::ParentDir) && extras.iter().any(|e| path.starts_with(e));
        return match inside {
            true => Ok(path.to_path_buf()),
            false => Err(t!("仓库不在附加目录内：{repo}", repo = repo)),
        };
    }
    let plain = |part: &str| {
        !matches!(part, "" | "." | "..") && Path::new(part).components().all(|c| matches!(c, Component::Normal(_)))
    };
    match repo.split('/').all(plain) {
        true => Ok(dir.join(path)),
        false => Err(t!("路径超出工作区：{path}", path = repo)),
    }
}

/// `ref:path`, the object git reads.
fn object(r#ref: Option<&str>, rel: &str) -> Result<String, String> {
    Ok(format!("{}:{}", arg(r#ref.unwrap_or("HEAD"))?, tree_path(rel)?))
}

const REFS_FORMAT: &str = "%(refname)%00%(symref)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00\
                           %(objectname:short)%00%(committerdate:iso-strict)%00%(subject)";
/// A tag's own fields, then those of what it points at (`*`: set when it is an annotated tag).
const TAGS_FORMAT: &str = "%(refname:lstrip=2)%00%(objecttype)%00%(objectname:short)%00%(subject)%00\
                           %(committerdate:iso-strict)%00%(*objecttype)%00%(*objectname:short)%00%(*subject)%00\
                           %(*committerdate:iso-strict)";

pub struct Refs {
    pub branches: Vec<GitBranch>,
    pub remotes: Vec<GitRemote>,
    pub tags: Vec<GitTag>,
    pub recent: Vec<String>,
}

/// Local branches, then remote-tracking ones (without `origin/HEAD`), the remotes' fetch URLs, the tags newest first
/// and the local branches checked out lately.
pub async fn refs(dir: &Path) -> Result<Refs, String> {
    repo_dir(dir)?;
    let format = format!("--format={REFS_FORMAT}");
    let args = ["for-each-ref", &format, "refs/heads", "refs/remotes"];
    let (listing, remotes, tags) = tokio::join!(git(dir, &args), git(dir, &["remote", "-v"]), tags(dir));
    let mut branches = vec![];
    for line in listing?.lines() {
        let f: Vec<&str> = line.split('\0').collect();
        let [refname, symref, head, upstream, track, commit, at, subject] = f[..] else { continue };
        let (name, kind) = match refname.strip_prefix("refs/heads/") {
            Some(name) => (name, GitBranchKind::Local),
            None if symref.is_empty() => (refname.trim_start_matches("refs/remotes/"), GitBranchKind::Remote),
            None => continue,
        };
        let upstream = Some(upstream).filter(|u| !u.is_empty());
        let (ahead, behind) = match (upstream, track) {
            (None, _) | (_, "gone") => (None, None),
            (Some(_), track) => (Some(count(track, "ahead ")), Some(count(track, "behind "))),
        };
        branches.push(GitBranch {
            name: name.into(),
            kind,
            current: head == "*",
            upstream: upstream.map(String::from),
            ahead,
            behind,
            commit: commit.into(),
            subject: subject.into(),
            at: at.into(),
        });
    }
    let remotes = remotes?
        .lines()
        .filter_map(|l| l.strip_suffix(" (fetch)")?.split_once('\t'))
        .map(|(name, url)| GitRemote { name: name.into(), url: repo::redact(url) })
        .collect();
    let recent = recent(dir, &branches).await;
    Ok(Refs { branches, remotes, tags: tags?, recent })
}

/// N of `ahead N` in `ahead 2, behind 1`; 0 when absent.
fn count(track: &str, label: &str) -> u32 {
    track.split(", ").find_map(|p| p.strip_prefix(label)?.parse().ok()).unwrap_or(0)
}

/// Tags pointing at commits, newest first.
async fn tags(dir: &Path) -> Result<Vec<GitTag>, String> {
    let format = format!("--format={TAGS_FORMAT}");
    let raw = git(dir, &["for-each-ref", "--sort=-creatordate", &format, "refs/tags"]).await?;
    let tags = raw.lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\0').collect();
        let [name, kind, commit, subject, at, peeled_kind, peeled, peeled_subject, peeled_at] = f[..] else {
            return None;
        };
        let (annotated, commit, subject, at) = match (kind, peeled_kind) {
            ("commit", _) => (false, commit, subject, at),
            ("tag", "commit") => (true, peeled, peeled_subject, peeled_at),
            _ => return None,
        };
        Some(GitTag { name: name.into(), commit: commit.into(), annotated, subject: subject.into(), at: at.into() })
    });
    Ok(tags.collect())
}

const RECENT_MAX: usize = 5;

/// Up to RECENT_MAX existing local branches but the current one, latest checked out first (HEAD's reflog).
async fn recent(dir: &Path, branches: &[GitBranch]) -> Vec<String> {
    let args = ["log", "-g", "--format=%gs", "--grep-reflog=^checkout: moving from ", "-n200", "HEAD", "--"];
    let Ok(raw) = git(dir, &args).await else { return vec![] };
    let locals: HashSet<&str> =
        branches.iter().filter(|b| b.kind == GitBranchKind::Local && !b.current).map(|b| b.name.as_str()).collect();
    let mut recent: Vec<String> = vec![];
    // `checkout: moving from A to B`: B was checked out after A.
    for (from, to) in raw.lines().filter_map(|l| l.strip_prefix("checkout: moving from ")?.split_once(" to ")) {
        for name in [to, from] {
            if locals.contains(name) && !recent.iter().any(|r| r == name) {
                recent.push(name.into());
            }
        }
        if recent.len() >= RECENT_MAX {
            break;
        }
    }
    recent.truncate(RECENT_MAX);
    recent
}

const COMMIT_FORMAT: &str = "%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%D";

fn commit_of(fields: &[&str]) -> Option<GitCommit> {
    let [hash, short, author, email, at, subject, parents, refs] = fields[..] else { return None };
    Some(GitCommit {
        hash: hash.into(),
        short_hash: short.into(),
        author: author.into(),
        email: email.into(),
        at: at.into(),
        subject: subject.into(),
        parents: parents.split_whitespace().map(String::from).collect(),
        refs: refs.split(", ").filter(|r| !r.is_empty()).map(String::from).collect(),
    })
}

/// Up to `limit` commits from `ref` (or a range) after `skip`, narrowed by `filter`, each before its parents; and
/// whether there are more.
pub async fn log(
    dir: &Path,
    r#ref: Option<&str>,
    skip: u32,
    limit: u32,
    filter: Option<&GitLogFilter>,
) -> Result<(Vec<GitCommit>, bool), String> {
    repo_dir(dir)?;
    let f = filter.cloned().unwrap_or_default();
    let on = |flag: Option<bool>| flag == Some(true);
    let given = |s: Option<String>| s.filter(|s| !s.trim().is_empty());
    let (author, text, path) = (given(f.author), given(f.text), given(f.path).map(|p| tree_path(&p)).transpose()?);
    let regexp = on(f.regexp) && text.is_some();
    // The revisions and what narrows them, for the page and for the names a file had alike.
    let mut args: Vec<String> = vec![];
    args.push(if f.order == Some(GitLogOrder::Topo) { "--topo-order" } else { "--date-order" }.into());
    if on(f.first_parent) {
        args.push("--first-parent".into());
    }
    if on(f.no_merges) {
        args.push("--no-merges".into());
    }
    if author.is_some() || text.is_some() {
        // Fixed strings unless the text is a regexp; the author is matched as typed either way.
        args.push(if regexp { "-E" } else { "-F" }.into());
        if !on(f.match_case) {
            args.push("-i".into());
        }
    }
    if let Some(author) = author {
        args.push(format!("--author={}", if regexp { escape_regex(&author) } else { author }));
    }
    if let Some(text) = text {
        args.push(format!("--grep={text}"));
    }
    if let Some(since) = given(f.since) {
        args.push(format!("--since={}", day(&since, "00:00:00")));
    }
    if let Some(until) = given(f.until) {
        args.push(format!("--until={}", day(&until, "23:59:59")));
    }
    let tip = match on(f.all) {
        true => {
            args.extend(["--branches", "--remotes", "--tags", "HEAD"].map(String::from));
            "HEAD".to_string()
        }
        false => {
            let rev = arg(r#ref.unwrap_or("HEAD"))?;
            args.push(rev.into());
            range_tip(rev).to_string()
        }
    };
    let paths = match path.filter(|p| !p.is_empty()) {
        // --follow takes a file past its renames but rewrites no parents: every name it had instead.
        Some(path) if is_file(dir, &tip, &path).await => names(dir, &args, skip + limit + 1, path).await?,
        Some(path) => vec![path],
        None => vec![],
    };
    if !paths.is_empty() {
        // Parents rewritten to the nearest ones listed, so the graph links what it lists.
        args.push("--parents".into());
    }
    let page = [format!("--format={COMMIT_FORMAT}%x1e"), format!("--skip={skip}"), format!("-n{}", limit + 1)];
    let args: Vec<&str> = ["--literal-pathspecs", "log", "--decorate=short"]
        .into_iter()
        .chain(page.iter().chain(&args).map(String::as_str))
        .chain(["--"])
        .chain(paths.iter().map(String::as_str))
        .collect();
    let raw = git(dir, &args).await?;
    let mut commits: Vec<GitCommit> = raw
        .split('\x1e')
        .filter_map(|record| commit_of(&record.trim_start_matches('\n').split('\0').collect::<Vec<_>>()))
        .collect();
    let more = commits.len() > limit as usize;
    commits.truncate(limit as usize);
    Ok((commits, more))
}

/// The names the file `rel` had in the first `n` commits of its history as `walk` (revisions and filters) lists it,
/// its renames followed; `rel` first.
async fn names(dir: &Path, walk: &[String], n: u32, rel: String) -> Result<Vec<String>, String> {
    let n = format!("-n{n}");
    let head = ["--literal-pathspecs", "log", "-z", "--follow", "--name-only", "--format=", &n];
    let args: Vec<&str> = head.into_iter().chain(walk.iter().map(String::as_str)).chain(["--", &rel]).collect();
    let raw = git(dir, &args).await?;
    let mut names = vec![rel.clone()];
    for name in raw.split('\0').filter(|n| !n.is_empty()) {
        if !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

/// An extended regex matching `s` literally.
fn escape_regex(s: &str) -> String {
    s.chars().fold(String::new(), |mut out, c| {
        if "\\.^$|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
        out
    })
}

/// A bare `YYYY-MM-DD` at `time` (git would otherwise take the current time of day); anything else as given.
fn day(date: &str, time: &str) -> String {
    let b = date.as_bytes();
    let bare = b.len() == 10 && b[4] == b'-' && b[7] == b'-' && date.chars().filter(char::is_ascii_digit).count() == 8;
    if bare { format!("{date} {time}") } else { date.to_string() }
}

/// The revision a range ends at (`a..b`, `a...b` → b; `a..` → HEAD).
fn range_tip(rev: &str) -> &str {
    match rev.rsplit_once("..") {
        Some((_, tip)) if !tip.trim_start_matches('.').is_empty() => tip.trim_start_matches('.'),
        Some(_) => "HEAD",
        None => rev,
    }
}

/// `rel` is a file in the work tree or at `rev`.
async fn is_file(dir: &Path, rev: &str, rel: &str) -> bool {
    dir.join(rel).is_file()
        || git(dir, &["cat-file", "-t", &format!("{rev}:{rel}")]).await.is_ok_and(|t| t.trim() == "blob")
}

pub struct Show {
    pub commit: GitCommit,
    pub body: String,
    pub committer: String,
    pub committer_email: String,
    pub committed_at: String,
    pub branches: Vec<String>,
}

/// Local and remote-tracking branches containing a commit, at most this many.
const CONTAINING_MAX: usize = 100;

/// One commit with its whole message, its committer and the branches that contain it.
pub async fn show(dir: &Path, commit: &str) -> Result<Show, String> {
    repo_dir(dir)?;
    let rev = format!("{}^{{commit}}", arg(commit)?);
    let hash = git(dir, &["rev-parse", "-q", "--verify", &rev]).await;
    let hash = hash.map_err(|_| t!("提交不存在：{commit}", commit = commit))?.trim().to_string();
    let format = format!("--format={COMMIT_FORMAT}%x00%cn%x00%ce%x00%cI%x00%B");
    let log = ["log", "-1", "--decorate=short", &format, &hash, "--"];
    let contains = ["branch", "-a", "--contains", &hash, "--format=%(refname)%00%(symref)"];
    let (raw, containing) = tokio::join!(git(dir, &log), git(dir, &contains));
    let raw = raw?;
    let f: Vec<&str> = raw.splitn(12, '\0').collect();
    let (head, rest) = (f.get(..8).unwrap_or_default(), f.get(8..).unwrap_or_default());
    let (Some(commit), [committer, committer_email, committed_at, body]) = (commit_of(head), rest) else {
        return Err(t!("提交不存在：{commit}", commit = commit));
    };
    let branches = containing?
        .lines()
        .filter_map(|l| l.split_once('\0').filter(|(_, symref)| symref.is_empty()).map(|(name, _)| name))
        .map(|name| name.strip_prefix("refs/heads/").or_else(|| name.strip_prefix("refs/remotes/")).unwrap_or(name))
        .take(CONTAINING_MAX)
        .map(String::from)
        .collect();
    Ok(Show {
        commit,
        body: body.trim_end().to_string(),
        committer: committer.to_string(),
        committer_email: committer_email.to_string(),
        committed_at: committed_at.to_string(),
        branches,
    })
}

/// One directory of `ref`'s tree, ordered and capped like the work tree browser.
pub async fn tree(dir: &Path, r#ref: Option<&str>, rel: &str) -> Result<(Vec<TreeEntry>, bool), String> {
    repo_dir(dir)?;
    let raw = git(dir, &["ls-tree", "-z", "--long", &object(r#ref, rel)?]).await?;
    let entries = raw
        .split('\0')
        .filter_map(|line| {
            let (meta, name) = line.split_once('\t')?;
            let mut meta = meta.split_whitespace();
            let kind = meta.nth(1)?;
            let size = meta.nth(1)?.parse().unwrap_or(0);
            let dir = kind != "blob";
            Some(TreeEntry { name: name.into(), dir, size, mtime: 0, uncommitted: false, ignored: false })
        })
        .collect();
    Ok(explorer::listing(entries))
}

/// One file of `ref`'s tree, with its content when it is UTF-8 text of at most `max_bytes`.
pub async fn read(dir: &Path, r#ref: Option<&str>, rel: &str, max_bytes: u64) -> Result<explorer::Read, String> {
    repo_dir(dir)?;
    let object = object(r#ref, rel)?;
    if git(dir, &["cat-file", "-t", &object]).await?.trim() != "blob" {
        return Err(t!("不是文件：{path}", path = rel));
    }
    let size: u64 = git(dir, &["cat-file", "-s", &object]).await?.trim().parse().map_err(|e| format!("{e}"))?;
    let (binary, text) = if size <= max_bytes {
        match String::from_utf8(git_bytes(dir, &["cat-file", "blob", &object]).await?) {
            Ok(s) if !s.contains('\0') => (false, Some(s)),
            _ => (true, None),
        }
    } else {
        let head = git_capped_bytes(dir, &["cat-file", "blob", &object], SNIFF_BYTES).await?;
        (!explorer::looks_like_text(&head), None)
    };
    Ok(explorer::Read { size, binary, mime: explorer::mime(Path::new(rel), binary), text })
}

/// What differs from `from` to `to`; `to` None = the work tree with its untracked files (the index is left alone).
pub async fn compare(dir: &Path, from: &str, to: Option<&str>) -> Result<Vec<GitChange>, String> {
    repo_dir(dir)?;
    let to = match to {
        Some(to) => arg(to)?.to_string(),
        None => git::work_tree(dir).await?,
    };
    let raw = git(dir, &["diff", "--name-status", "-z", "-M", arg(from)?, &to, "--"]).await?;
    let mut tokens = raw.split('\0').filter(|t| !t.is_empty());
    let mut changes = vec![];
    while let Some(status) = tokens.next() {
        let Some(path) = tokens.next() else { break };
        let (change, old_path, path) = match status.as_bytes()[0] {
            b'R' => (GitChangeKind::Renamed, Some(path.to_string()), tokens.next().unwrap_or(path)),
            b'C' => (GitChangeKind::Added, None, tokens.next().unwrap_or(path)),
            b'A' => (GitChangeKind::Added, None, path),
            b'D' => (GitChangeKind::Deleted, None, path),
            _ => (GitChangeKind::Modified, None, path),
        };
        changes.push(GitChange { path: path.into(), change, old_path });
    }
    Ok(changes)
}

/// How git.diff shows changes: whitespace (`-w`, or one of IDEA's modes over it), context lines (`-U`), and the source
/// of a rename to pair with the path.
#[derive(Debug, Clone, Default)]
pub struct DiffOptions {
    pub ignore_whitespace: bool,
    pub whitespace: Option<GitWhitespace>,
    pub context: Option<u32>,
    pub old_path: Option<String>,
}

/// The patch from `from` to `to` (None = the work tree with its untracked files), of `path` only when given, cut at
/// `max_bytes`; true when cut.
pub async fn diff(
    dir: &Path,
    from: &str,
    to: Option<&str>,
    path: Option<&str>,
    max_bytes: usize,
    options: DiffOptions,
) -> Result<(String, bool), String> {
    repo_dir(dir)?;
    let from = arg(from)?;
    let path = path.map(tree_path).transpose()?;
    let old_path = options.old_path.as_deref().map(tree_path).transpose()?;
    let to = match to {
        Some(to) => arg(to)?.to_string(),
        None => git::work_tree(dir).await?,
    };
    let context = options.context.map(|n| format!("-U{n}"));
    let mut args = vec!["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "-M"];
    args.extend(match (options.whitespace, options.ignore_whitespace) {
        (Some(GitWhitespace::Trim), _) => &["-b"][..],
        (Some(GitWhitespace::Ignore), _) | (None, true) => &["-w"],
        (Some(GitWhitespace::IgnoreBlank), _) => &["-w", "--ignore-blank-lines"],
        (None, false) => &[],
    });
    args.extend(context.as_deref());
    args.extend([from, &to, "--"]);
    // A rename's two paths together: the new one alone would be a file added.
    args.extend(old_path.as_deref().filter(|p| !p.is_empty()));
    args.extend(path.as_deref().filter(|p| !p.is_empty()));
    let out = git_capped_bytes(dir, &args, max_bytes.saturating_add(1)).await?;
    let truncated = out.len() > max_bytes;
    let mut patch = String::from_utf8_lossy(&out).into_owned();
    if truncated {
        let mut cut = max_bytes.min(patch.len());
        while !patch.is_char_boundary(cut) {
            cut -= 1;
        }
        // A whole last line, so the cut patch still parses.
        cut = patch[..cut].rfind('\n').map_or(cut, |i| i + 1);
        patch.truncate(cut);
    }
    Ok((patch, truncated))
}

pub struct Changes {
    pub changes: Vec<GitWorkChange>,
    pub conflicts: Vec<GitConflict>,
    pub ongoing: Option<GitOngoing>,
    pub head: Option<GitHeadCommit>,
}

/// The work tree against HEAD as a commit would take it (untracked files flagged, line counts), unmerged paths apart,
/// what stopped midway and HEAD's commit. Renames only pair tracked paths: an untracked file is no rename target.
pub async fn changes(dir: &Path) -> Result<Changes, String> {
    repo_dir(dir)?;
    let (tree, head, untracked, conflicts, ongoing) =
        tokio::join!(git::work_tree(dir), head_commit(dir), untracked(dir), unmerged(dir), git::ongoing(dir));
    let (tree, untracked, conflicts) = (tree?, untracked?, conflicts?);
    let base = head.as_ref().map_or(EMPTY_TREE, |h| h.hash.as_str());
    let raw = git(dir, &["diff", "--raw", "--numstat", "-z", "-M", base, &tree, "--"]).await?;
    let (entries, mut counts) = raw_numstat(&raw);
    let unmerged: HashSet<&str> = conflicts.iter().map(|c| c.path.as_str()).collect();
    let skip = |p: &str| private(p) || unmerged.contains(p);
    let mut changes = vec![];
    let mut split = HashSet::new();
    for (status, old, path) in entries {
        if skip(&path) || old.as_deref().is_some_and(skip) {
            continue;
        }
        let (change, old_path) = match status {
            'R' if untracked.contains(&path) => {
                split.extend([old.unwrap_or_default(), path]);
                continue;
            }
            'R' => (GitChangeKind::Renamed, old),
            'A' | 'C' => (GitChangeKind::Added, None),
            'D' => (GitChangeKind::Deleted, None),
            _ => (GitChangeKind::Modified, None),
        };
        let (add, del) = counts.get(&path).copied().unwrap_or_default();
        changes.push(GitWorkChange { untracked: untracked.contains(&path), path, change, old_path, add, del });
    }
    if !split.is_empty() {
        // A rename onto an untracked file is that file added and its source deleted, counted on their own.
        let raw = git(dir, &["diff", "--raw", "--numstat", "-z", "--no-renames", base, &tree, "--"]).await?;
        let (entries, own) = raw_numstat(&raw);
        counts.extend(own);
        for (status, _, path) in entries.into_iter().filter(|(_, _, p)| split.contains(p)) {
            let change = if status == 'D' { GitChangeKind::Deleted } else { GitChangeKind::Added };
            let (add, del) = counts.get(&path).copied().unwrap_or_default();
            let untracked = untracked.contains(&path);
            changes.push(GitWorkChange { untracked, path, change, old_path: None, add, del });
        }
        changes.sort_by(|a, b| a.path.cmp(&b.path));
    }
    Ok(Changes { changes, conflicts, ongoing: ongoing?, head })
}

type Counts = HashMap<String, (Option<u32>, Option<u32>)>;

/// `git diff --raw --numstat -z`: (status letter, source of a rename or copy, path) per change, and the added and
/// deleted lines per path (None for binary files).
fn raw_numstat(raw: &str) -> (Vec<(char, Option<String>, String)>, Counts) {
    let (mut entries, mut counts) = (vec![], HashMap::new());
    let mut tokens = raw.split('\0');
    while let Some(token) = tokens.next() {
        if let Some(meta) = token.strip_prefix(':') {
            let status = meta.rsplit(' ').next().and_then(|s| s.chars().next()).unwrap_or('M');
            let first = tokens.next().unwrap_or_default().to_string();
            match status {
                'R' | 'C' => entries.push((status, Some(first), tokens.next().unwrap_or_default().to_string())),
                _ => entries.push((status, None, first)),
            }
        } else if !token.is_empty() {
            let mut f = token.splitn(3, '\t');
            let (add, del, path) = (f.next(), f.next(), f.next().unwrap_or_default());
            // A rename's counts are followed by its two paths.
            let path = if path.is_empty() { tokens.nth(1).unwrap_or_default() } else { path };
            let n = |v: Option<&str>| v.and_then(|v| v.parse().ok());
            counts.insert(path.to_string(), (n(add), n(del)));
        }
    }
    (entries, counts)
}

/// Untracked files (not ignored), relative to `dir`.
pub(crate) async fn untracked(dir: &Path) -> Result<HashSet<String>, String> {
    let raw = git(dir, &["ls-files", "-z", "--others", "--exclude-standard"]).await?;
    // An embedded repo is listed as its directory.
    Ok(raw.split('\0').filter(|p| !p.is_empty()).map(|p| p.trim_end_matches('/').to_string()).collect())
}

/// HEAD's commit; None on an unborn branch.
async fn head_commit(dir: &Path) -> Option<GitHeadCommit> {
    let hash = git::head(dir).await?;
    let contains = format!("--contains={hash}");
    let log = ["log", "-1", "--format=%h%x00%B", &hash, "--"];
    let remote = ["for-each-ref", &contains, "--count=1", "--format=%(refname)", "refs/remotes"];
    let (raw, remote) = tokio::join!(git(dir, &log), git(dir, &remote));
    let raw = raw.ok()?;
    let (short, message) = raw.split_once('\0')?;
    let pushed = remote.is_ok_and(|r| !r.trim().is_empty());
    Some(GitHeadCommit { short_hash: short.into(), hash, message: message.trim_end().into(), pushed })
}

/// The stages (base, ours, theirs) of each unmerged path.
async fn stages(dir: &Path, path: Option<&str>) -> Result<BTreeMap<String, [Option<String>; 3]>, String> {
    let mut args = vec!["--literal-pathspecs", "ls-files", "-u", "-z"];
    if let Some(path) = path {
        args.extend(["--", path]);
    }
    let raw = git(dir, &args).await?;
    let mut stages: BTreeMap<String, [Option<String>; 3]> = BTreeMap::new();
    // `<mode> <object> <stage>\t<path>`
    for (meta, path) in raw.split('\0').filter_map(|e| e.split_once('\t')) {
        let mut meta = meta.split(' ').skip(1);
        let (Some(object), Some(stage)) = (meta.next(), meta.next().and_then(|s| s.parse::<usize>().ok())) else {
            continue;
        };
        if (1..=3).contains(&stage) {
            stages.entry(path.to_string()).or_default()[stage - 1] = Some(object.to_string());
        }
    }
    Ok(stages)
}

/// Unmerged paths and what each side did to them.
pub(crate) async fn unmerged(dir: &Path) -> Result<Vec<GitConflict>, String> {
    let side = |base: bool, this: bool| match (this, base) {
        (false, _) => GitConflictSide::Deleted,
        (true, true) => GitConflictSide::Modified,
        (true, false) => GitConflictSide::Added,
    };
    Ok(stages(dir, None)
        .await?
        .into_iter()
        .map(|(path, [base, ours, theirs])| GitConflict {
            path,
            ours: side(base.is_some(), ours.is_some()),
            theirs: side(base.is_some(), theirs.is_some()),
        })
        .collect())
}

pub struct Blame {
    pub ranges: Vec<GitBlameRange>,
    pub commits: Vec<GitBlameCommit>,
}

/// Who last changed each line of `rel` at `ref` (None = the work tree: lines not committed yet have commit '').
pub async fn blame(dir: &Path, r#ref: Option<&str>, rel: &str) -> Result<Blame, String> {
    repo_dir(dir)?;
    let path = tree_path(rel)?;
    if path.is_empty() {
        return Err(t!("不是文件：{path}", path = rel));
    }
    let mut args = vec!["blame", "--porcelain"];
    if let Some(r) = r#ref {
        args.push(arg(r)?);
    }
    args.extend(["--", &path]);
    Ok(parse_blame(&git(dir, &args).await?))
}

fn parse_blame(raw: &str) -> Blame {
    let (mut ranges, mut commits) = (Vec::<GitBlameRange>::new(), Vec::<GitBlameCommit>::new());
    // The commit whose header lines follow, by index in `commits`, and its author time and zone until both are read.
    let (mut current, mut time, mut zone): (Option<usize>, Option<i64>, Option<String>) = (None, None, None);
    for line in raw.lines().filter(|l| !l.starts_with('\t')) {
        let (key, value) = line.split_once(' ').unwrap_or((line, ""));
        let mut numbers = value.split(' ').map(|n| n.parse::<u32>().ok());
        let hex = matches!(key.len(), 40 | 64) && key.bytes().all(|b| b.is_ascii_hexdigit());
        // `<hash> <source line> <final line>[ <lines in group>]` heads each line of the file.
        if let (true, Some(Some(_)), Some(Some(at))) = (hex, numbers.next(), numbers.next()) {
            let commit = if key.bytes().all(|b| b == b'0') { String::new() } else { key.to_string() };
            match ranges.last_mut() {
                Some(r) if r.commit == commit && r.start + r.count == at => r.count += 1,
                _ => ranges.push(GitBlameRange { start: at, count: 1, commit: commit.clone() }),
            }
            current = match commit.is_empty() {
                true => None,
                false => Some(commits.iter().position(|c| c.hash == commit).unwrap_or_else(|| {
                    commits.push(GitBlameCommit {
                        short_hash: commit[..7].to_string(),
                        hash: commit,
                        author: String::new(),
                        email: String::new(),
                        at: String::new(),
                        subject: String::new(),
                    });
                    commits.len() - 1
                })),
            };
            continue;
        }
        let Some(c) = current.map(|i| &mut commits[i]) else { continue };
        match key {
            "author" => c.author = value.into(),
            "author-mail" => c.email = value.trim_start_matches('<').trim_end_matches('>').into(),
            "author-time" => time = value.parse().ok(),
            "author-tz" => zone = Some(value.into()),
            "summary" => c.subject = value.into(),
            _ => {}
        }
        if let (Some(t), Some(z)) = (time, zone.as_deref()) {
            c.at = iso(t, z);
            (time, zone) = (None, None);
        }
    }
    Blame { ranges, commits }
}

/// `seconds` since the epoch in the zone `+hhmm`, as git's strict ISO 8601.
fn iso(seconds: i64, zone: &str) -> String {
    let sign = if zone.starts_with('-') { -1 } else { 1 };
    let digits = zone.trim_start_matches(['+', '-']);
    let minutes = digits.get(..2).and_then(|h| h.parse::<i32>().ok()).unwrap_or(0) * 60
        + digits.get(2..4).and_then(|m| m.parse::<i32>().ok()).unwrap_or(0);
    let offset =
        chrono::FixedOffset::east_opt(sign * minutes * 60).unwrap_or(chrono::FixedOffset::east_opt(0).unwrap());
    chrono::DateTime::from_timestamp(seconds, 0).map(|d| d.with_timezone(&offset).to_rfc3339()).unwrap_or_default()
}

/// The stash list, newest first.
pub async fn stashes(dir: &Path) -> Result<Vec<GitStash>, String> {
    repo_dir(dir)?;
    let raw = git(dir, &["stash", "list", "--format=%H%x00%cI%x00%P%x00%gs"]).await?;
    let stashes = raw.lines().enumerate().filter_map(|(index, line)| {
        let [hash, at, parents, subject] = line.splitn(4, '\0').collect::<Vec<_>>()[..] else { return None };
        let (message, branch) = stash_message(subject);
        let untracked = parents.split_whitespace().count() > 2;
        Some(GitStash { index: index as u32, hash: hash.into(), message, branch, at: at.into(), untracked })
    });
    Ok(stashes.collect())
}

/// The message to show and the branch a stash was made on: git's `WIP on <branch>: …` is kept as is, a custom
/// `On <branch>: <message>` loses its prefix; `(no branch)` is a detached HEAD.
fn stash_message(subject: &str) -> (String, Option<String>) {
    let branch = |b: &str| (b != "(no branch)").then(|| b.to_string());
    if let Some((b, _)) = subject.strip_prefix("WIP on ").and_then(|r| r.split_once(": ")) {
        return (subject.into(), branch(b));
    }
    match subject.strip_prefix("On ").and_then(|r| r.split_once(": ")) {
        Some((b, message)) => (message.into(), branch(b)),
        None => (subject.into(), None),
    }
}

pub struct Conflict {
    pub base: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
    pub merged: Option<String>,
    pub binary: bool,
}

/// An unmerged path's three versions (None = absent on that side) and git's diff3 merge of them when all three are
/// text; any binary side makes them all None. A side over `max_bytes` is refused.
pub async fn conflict(dir: &Path, rel: &str, max_bytes: u64) -> Result<Conflict, String> {
    repo_dir(dir)?;
    let path = tree_path(rel)?;
    let stages = stages(dir, Some(&path)).await?;
    let Some(objects) = stages.get(&path) else { return Err(t!("没有冲突：{path}", path = path)) };
    let mut sides: Vec<Option<Vec<u8>>> = vec![];
    for object in objects {
        let Some(object) = object else {
            sides.push(None);
            continue;
        };
        let size: u64 = git(dir, &["cat-file", "-s", object]).await?.trim().parse().map_err(|e| format!("{e}"))?;
        if size > max_bytes {
            return Err(t!("冲突文件超过 {max} 字节：{path}", max = max_bytes, path = path));
        }
        sides.push(Some(git_bytes(dir, &["cat-file", "blob", object]).await?));
    }
    let text = |b: &Vec<u8>| String::from_utf8(b.clone()).ok().filter(|s| !s.contains('\0'));
    if sides.iter().flatten().any(|b| text(b).is_none()) {
        return Ok(Conflict { base: None, ours: None, theirs: None, merged: None, binary: true });
    }
    let [base, ours, theirs] = [&sides[0], &sides[1], &sides[2]].map(|s| s.as_ref().and_then(text));
    let merged = match (&base, &ours, &theirs) {
        (Some(base), Some(ours), Some(theirs)) => Some(merge_file(dir, base, ours, theirs).await?),
        // Both added it: merged as git does, from nothing, so what they share is not in conflict.
        (None, Some(ours), Some(theirs)) => Some(merge_file(dir, "", ours, theirs).await?),
        _ => None,
    };
    Ok(Conflict { base, ours, theirs, merged, binary: false })
}

/// `git merge-file --zdiff3` of the three texts (lines both sides share at a conflict's ends left out of it; plain
/// `--diff3` before git 2.35), conflict markers labelled ours / base / theirs.
async fn merge_file(dir: &Path, base: &str, ours: &str, theirs: &str) -> Result<String, String> {
    let scratch = Scratch::new("gonggong-merge")?;
    let files = [("ours", ours), ("base", base), ("theirs", theirs)].map(|(name, text)| {
        let file = scratch.0.join(name);
        std::fs::write(&file, text).map(|_| file.to_string_lossy().into_owned())
    });
    let [ours, base, theirs] = files;
    let (ours, base, theirs) = (ours.map_err(io)?, base.map_err(io)?, theirs.map_err(io)?);
    let mut stderr = String::new();
    for style in ["--zdiff3", "--diff3"] {
        let args = ["merge-file", "-p", style, "-L", "ours", "-L", "base", "-L", "theirs", &ours, &base, &theirs];
        let out = git_output(dir, &args, &[], None).await?;
        // The exit code is the number of conflicts (capped at 127); a negative one is an error, as is an unknown option.
        if let Some(0..=127) = out.status.code() {
            return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
        }
        stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if !stderr.contains("zdiff3") {
            break;
        }
    }
    Err(stderr.lines().next().unwrap_or(t!("git 执行失败")).to_string())
}

pub(crate) fn io(e: std::io::Error) -> String {
    t!("无法写入临时文件：{e}", e = e)
}

/// A temp dir for what git is handed as files (merge-file's inputs, a rebase's todo), removed however it ends.
pub(crate) struct Scratch(pub(crate) PathBuf);

impl Scratch {
    pub(crate) fn new(prefix: &str) -> Result<Self, String> {
        let dir = git::unique_temp(prefix);
        std::fs::create_dir_all(&dir).map_err(io)?;
        Ok(Scratch(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Repos fetched at the same time.
const FETCHES: usize = 4;

/// `git fetch --prune` of every remote, in each repo of the workspace `dir` and of its additional directories `extras`
/// (GitStatus.repos); the first failure, named by its repo unless that is the root, is the error.
pub async fn fetch(dir: &Path, extras: &[PathBuf]) -> Result<(), String> {
    let fetches = futures_util::stream::iter(git::repos(dir, extras).await).map(|(name, repo)| async move {
        let fetched = remote_git(&repo, &["fetch", "--prune", "--all"], Some(NETWORK_TIMEOUT)).await;
        fetched.map(drop).map_err(|f| if name.is_empty() { f.detail } else { format!("{name}: {}", f.detail) })
    });
    fetches.buffered(FETCHES).collect::<Vec<_>>().await.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_path_stays_in_the_workspace_or_its_extra_dirs() {
        let dir = Path::new("/w/app");
        let extras = ["/x/sdk".to_string()];
        let at = |repo| repo_path(dir, &extras, repo);
        assert_eq!(at(None).unwrap(), dir);
        assert_eq!(at(Some("libs/core")).unwrap(), dir.join("libs/core"));
        assert_eq!(at(Some("/x/sdk")).unwrap(), Path::new("/x/sdk"));
        assert_eq!(at(Some("/x/sdk/vendor/a")).unwrap(), Path::new("/x/sdk/vendor/a"));
        for bad in ["", "..", "../x", "libs/../..", "libs//core", "./libs", "libs/", "/x/sdk2", "/x/sdk/../y", "/w/app"]
        {
            assert!(at(Some(bad)).is_err(), "{bad}");
        }
        assert!(repo_path(dir, &[], Some("/x/sdk")).is_err());
    }

    #[test]
    fn log_arguments_keep_what_was_typed() {
        assert_eq!(escape_regex("a.b(c)*"), r"a\.b\(c\)\*");
        assert_eq!(day("2026-10-31", "23:59:59"), "2026-10-31 23:59:59");
        assert_eq!(day("2026-10-31T08:00:00Z", "23:59:59"), "2026-10-31T08:00:00Z");
        let tips = [("main..feat", "feat"), ("main...feat", "feat"), ("main..", "HEAD"), ("v1.2", "v1.2")];
        for (rev, tip) in tips {
            assert_eq!(range_tip(rev), tip, "{rev}");
        }
    }

    #[test]
    fn stash_subjects_give_the_message_and_branch() {
        let wip = "WIP on feat/x: a1b2c3d 修复";
        assert_eq!(stash_message(wip), (wip.to_string(), Some("feat/x".into())));
        assert_eq!(stash_message("On main: fix: refund"), ("fix: refund".into(), Some("main".into())));
        assert_eq!(stash_message("On (no branch): try"), ("try".into(), None));
        assert_eq!(stash_message("autostash"), ("autostash".into(), None));
    }

    #[test]
    fn raw_and_numstat_records_pair_up() {
        let raw = ":100644 100644 aaa bbb M\0src/a.txt\0:100644 100644 ccc ccc R100\0old.md\0new.md\0\
                   :000000 100644 000 ddd A\0logo.png\0\
                   2\t1\tsrc/a.txt\0\
                   0\t0\t\0old.md\0new.md\0\
                   -\t-\tlogo.png\0";
        let (entries, counts) = raw_numstat(raw);
        let entries: Vec<_> = entries.iter().map(|(s, old, p)| (*s, old.as_deref(), p.as_str())).collect();
        assert_eq!(entries, [('M', None, "src/a.txt"), ('R', Some("old.md"), "new.md"), ('A', None, "logo.png")]);
        assert_eq!(
            (counts["src/a.txt"], counts["new.md"], counts["logo.png"]),
            ((Some(2), Some(1)), (Some(0), Some(0)), (None, None))
        );
    }

    #[test]
    fn blame_groups_lines_by_commit() {
        let a = "a".repeat(40);
        let raw = format!(
            "{a} 1 1 2\nauthor 张三\nauthor-mail <z@corp.com>\nauthor-time 1792454400\nauthor-tz +0800\nsummary 发布\n\
             filename x\n\tone\n{a} 2 2\n\ttwo\n{z} 3 3 1\nauthor Not Committed Yet\nauthor-mail <not.committed.yet>\n\
             author-time 1792454400\nauthor-tz +0000\nsummary Version of x\nfilename x\n\tthree\n",
            z = "0".repeat(40)
        );
        let b = parse_blame(&raw);
        let ranges: Vec<_> = b.ranges.iter().map(|r| (r.start, r.count, r.commit.as_str())).collect();
        assert_eq!(ranges, [(1, 2, a.as_str()), (3, 1, "")]);
        assert_eq!(b.commits.len(), 1);
        let c = &b.commits[0];
        assert_eq!((c.short_hash.as_str(), c.author.as_str(), c.email.as_str()), ("aaaaaaa", "张三", "z@corp.com"));
        assert_eq!((c.at.as_str(), c.subject.as_str()), ("2026-10-20T08:00:00+08:00", "发布"));
    }
}
