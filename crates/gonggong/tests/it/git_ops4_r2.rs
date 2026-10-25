//! The second IDEA round of gitOps4 driven through the Engine against temp clones of a local bare remote: rename and
//! whitespace diffs, reverting one hunk, what an action answers beyond its text (files in the way, a diverged branch,
//! conflicts left restoring changes, what a pull brought in), checking out a remote branch whose local one exists,
//! overwriting a branch, and fetching every repo of the workspace.
use super::git_ops::{DOC, Rig, commit, rig, sh};
use super::git_ops3::{a, read, write};
use gonggong::protocol::*;
use std::fs;
use std::path::Path;

impl Rig {
    async fn diff_of(
        &mut self,
        (from, to, path): (&str, Option<&str>, &str),
        old_path: Option<&str>,
        whitespace: Option<GitWhitespace>,
        ignore_whitespace: Option<bool>,
    ) -> String {
        self.send(ServerToDaemon::GitDiff(GitDiff {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: None,
            from: from.into(),
            to: to.map(String::from),
            path: Some(path.into()),
            max_bytes: 1 << 20,
            ignore_whitespace,
            context: None,
            old_path: old_path.map(String::from),
            whitespace,
        }));
        match self.next().await {
            DaemonToServer::GitDiffResult { patch: Some(patch), error: None, .. } => patch,
            other => panic!("unexpected {other:?}"),
        }
    }

    fn took(&mut self) -> GitActionDetail {
        self.detail.take().expect("the answer has a detail")
    }

    /// git.refresh with `fetch` of `workspace`: its own error, after the status.
    async fn fetch_in(&mut self, workspace: WorkspaceSpec) -> Option<String> {
        let req =
            GitRefresh { request_id: "q".into(), group_id: "g1".into(), bot_id: "b1".into(), workspace, fetch: true };
        self.send(ServerToDaemon::GitRefresh(req));
        loop {
            if let DaemonToServer::GitRefreshResult { error, .. } = self.next().await {
                return error;
            }
        }
    }
}

fn short(dir: &Path, rev: &str) -> String {
    sh(dir, &["rev-parse", "--short", rev])
}

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[tokio::test]
async fn a_rename_is_diffed_as_one_file_in_each_whitespace_mode() {
    let mut r = rig();
    let w = r.work.clone();
    let patch = r.diff_of(("main", Some("origin/feat"), "docs/new.md"), Some("docs/old.md"), None, None).await;
    assert!(
        patch.starts_with(
            "diff --git a/docs/old.md b/docs/new.md\nsimilarity index 100%\nrename from docs/old.md\nrename to docs/new.md\n"
        ),
        "{patch}"
    );

    // Moved in the shell, the new file untracked, and edited.
    fs::remove_file(w.join("docs/old.md")).unwrap();
    write(&w, "docs/moved.md", &DOC.replace("line three", "line 3"));
    let patch = r.diff_of(("HEAD", None, "docs/moved.md"), Some("docs/old.md"), None, None).await;
    assert!(patch.contains("rename from docs/old.md\nrename to docs/moved.md\n"), "{patch}");
    assert!(patch.contains("-line three\n+line 3\n") && !patch.contains("+line one"), "{patch}");
    let alone = r.diff_of(("HEAD", None, "docs/moved.md"), None, None, None).await;
    assert!(alone.contains("new file mode") && alone.contains("+line one\n"), "{alone}");

    commit(&w, "ws.txt", "alpha beta\ngamma\ndelta\nepsilon\n", "ws");
    write(&w, "ws.txt", "alpha  beta \ngam ma\ndelta\n\nepsilon\n");
    let lines = ["+alpha  beta \n", "+gam ma\n", "+\n"];
    let modes = [
        (None, None),
        (Some(GitWhitespace::Trim), Some(true)),
        (Some(GitWhitespace::Ignore), None),
        (Some(GitWhitespace::IgnoreBlank), None),
        (None, Some(true)),
    ];
    let mut shown = vec![];
    for (whitespace, ignore) in modes {
        let patch = r.diff_of(("HEAD", None, "ws.txt"), None, whitespace, ignore).await;
        shown.push(lines.iter().filter(|l| patch.contains(**l)).copied().collect::<Vec<_>>());
    }
    let (none, blank_only): (&[&str], &[&str]) = (&[], &["+\n"]);
    assert_eq!(shown, [&lines[..], &lines[1..], blank_only, none, blank_only]);
}

const TWELVE: &str = "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n";

fn revert(paths: &[&str], patch: &str) -> impl FnOnce(&mut GitAction) {
    let (paths, patch) = (strings(paths), patch.to_string());
    move |q| {
        q.paths = Some(paths);
        q.args = Some(GitActionArgs { patch: Some(patch), ..a() });
    }
}

/// The file headers of a one-file patch, and its hunks.
fn hunks(patch: &str) -> (String, Vec<String>) {
    let (head, body) = patch.split_at(patch.find("\n@@").unwrap() + 1);
    let mut hunks: Vec<String> = vec![];
    for line in body.split_inclusive('\n') {
        if line.starts_with("@@") {
            hunks.push(String::new());
        }
        hunks.last_mut().unwrap().push_str(line);
    }
    (head.to_string(), hunks)
}

#[tokio::test]
async fn one_hunk_is_reverted_in_the_work_tree_while_it_still_applies() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "p.txt", TWELVE, "twelve");
    let edited = TWELVE.replace("l1\n", "L1\n").replace("l12\n", "L12\n");
    write(&w, "p.txt", &edited);
    sh(&w, &["add", "p.txt"]);
    let (head, hunks) = hunks(&r.diff_of(("HEAD", None, "p.txt"), None, None, None).await);
    assert_eq!(hunks.len(), 2);
    let first = format!("{head}{}", hunks[0]);
    let output = r.git(GitActionKind::Discard, revert(&["p.txt"], &first)).await.unwrap();
    assert_eq!(output, "已回滚 p.txt 中的 1 处改动");
    assert_eq!(read(&w, "p.txt").unwrap(), TWELVE.replace("l12\n", "L12\n"));
    assert_eq!(sh(&w, &["diff", "--cached", "--numstat"]), "2\t2\tp.txt", "the index is left alone");

    let changed = "改动已变化，请刷新后重试";
    assert_eq!(r.git(GitActionKind::Discard, revert(&["p.txt"], &first)).await.unwrap_err(), changed);

    // Anything but hunks of that one path is refused, and nothing is reverted.
    let second = format!("{head}{}", hunks[1]);
    let other = second.replace("p.txt", "README.md");
    let renamed = format!(
        "diff --git a/p.txt b/p.txt\nsimilarity index 90%\nrename from README.md\nrename to p.txt\n{}",
        &second[second.find("---").unwrap()..]
    );
    let crossed = second.replace("+++ b/p.txt", "+++ b/README.md");
    let only = "补丁只能包含 p.txt 的改动";
    let refused: [(&[&str], String, &str); 6] = [
        (&["p.txt", "README.md"], second.clone(), "逐块回滚只能针对一个文件"),
        (&["p.txt"], other.clone(), only),
        (&["p.txt"], format!("{second}{other}"), only),
        (&["p.txt"], renamed, only),
        (&["p.txt"], crossed, only),
        (&["p.txt"], format!("{second}{}", " x\n".repeat(400_000)), "补丁超过 1048576 字节"),
    ];
    for (paths, patch, error) in refused {
        assert_eq!(r.git(GitActionKind::Discard, revert(paths, &patch)).await.unwrap_err(), error, "{patch:.300}");
    }
    let escape = r.git(GitActionKind::Discard, revert(&["../work/p.txt"], &second)).await.unwrap_err();
    assert!(escape.contains("超出"), "{escape}");
    assert_eq!(read(&w, "p.txt").unwrap(), TWELVE.replace("l12\n", "L12\n"));
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\n"));

    // Lines of a hunk that read like file headers are the hunk's.
    commit(&w, "x.txt", "keep\n-- a/README.md\n", "x");
    write(&w, "x.txt", "keep\n++ b/README.md\n");
    let patch = r.diff_of(("HEAD", None, "x.txt"), None, None, None).await;
    assert!(patch.contains("\n--- a/README.md\n+++ b/README.md\n"), "{patch}");
    r.git(GitActionKind::Discard, revert(&["x.txt"], &patch)).await.unwrap();
    assert_eq!(read(&w, "x.txt").as_deref(), Some("keep\n-- a/README.md\n"));
}

#[tokio::test]
async fn files_in_the_way_of_a_checkout_are_named() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "src/a.txt", "mine\n");
    write(&w, "src/b.txt", "untracked\n");
    write(&w, "README.md", "hello\nnot in the way\n");
    let checkout = |q: &mut GitAction| q.branch = Some("origin/feat".into());
    let error = r.git(GitActionKind::Checkout, checkout).await.unwrap_err();
    assert_eq!(error, "error: Your local changes to the following files would be overwritten by checkout:");
    let d = r.took();
    assert_eq!((d.code, d.paths), (Some(GitActionCode::Overwritten), strings(&["src/a.txt", "src/b.txt"])));
    assert_eq!((r.current(), read(&w, "src/a.txt")), ("main".to_string(), Some("mine\n".into())));

    sh(&w, &["checkout", "--", "src/a.txt"]);
    let error = r.git(GitActionKind::Checkout, checkout).await.unwrap_err();
    assert!(error.contains("untracked working tree files would be overwritten"), "{error}");
    assert_eq!(r.took().paths, ["src/b.txt"]);
    assert_eq!(r.current(), "main");
}

fn from_remote(local_commits: Option<GitLocalCommits>) -> impl FnOnce(&mut GitAction) {
    move |q| {
        q.branch = Some("origin/feat".into());
        q.args = local_commits.map(|l| GitActionArgs { local_commits: Some(l), ..a() });
    }
}

/// `other` adds `n` commits to the remote feat, fetched by the work clone.
fn remote_feat_moves(r: &Rig, n: usize, file: &str) {
    sh(&r.other, &["switch", "-q", "feat"]);
    for i in 0..n {
        commit(&r.other, file, &format!("theirs {i}\n"), &format!("theirs {i}"));
    }
    sh(&r.other, &["push", "-q", "origin", "feat"]);
    sh(&r.work, &["fetch", "-q"]);
}

#[tokio::test]
async fn a_remote_branch_brings_its_local_one_up_to_it_unless_that_has_commits_of_its_own() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["branch", "feat", "main"]);
    let output = r.git(GitActionKind::Checkout, from_remote(None)).await.unwrap();
    assert!(output.starts_with("[feat ") && output.ends_with("feat work"), "{output}");
    let detail = r.detail.take().unwrap();
    assert_eq!(r.head(), sh(&w, &["rev-parse", "origin/feat"]));
    assert_eq!(GitActionDetail { commands: None, ..detail }, GitActionDetail::default());
    assert_eq!(sh(&w, &["rev-parse", "--abbrev-ref", "feat@{upstream}"]), "origin/feat");

    // Ahead of it: only switched to.
    commit(&w, "mine.txt", "m\n", "mine");
    let mine = r.head();
    sh(&w, &["switch", "-q", "main"]);
    r.git(GitActionKind::Checkout, from_remote(None)).await.unwrap();
    assert_eq!((r.current(), r.head()), ("feat".to_string(), mine.clone()));

    // Diverged: nothing done.
    remote_feat_moves(&r, 2, "theirs.txt");
    sh(&w, &["switch", "-q", "main"]);
    let error = r.git(GitActionKind::Checkout, from_remote(None)).await.unwrap_err();
    assert_eq!(error, "feat 与 origin/feat 已分叉：本地有 1 个提交不在远程分支上，远程分支有 2 个新提交");
    let d = r.took();
    assert_eq!((d.code, d.ahead, d.behind), (Some(GitActionCode::Diverged), Some(1), Some(2)));
    assert_eq!((r.current(), sh(&w, &["rev-parse", "feat"])), ("main".to_string(), mine));

    let output = r.git(GitActionKind::Checkout, from_remote(Some(GitLocalCommits::Rebase))).await.unwrap();
    assert!(output.starts_with("[feat ") && output.ends_with("mine"), "{output}");
    assert_eq!(sh(&w, &["rev-parse", "HEAD~1"]), sh(&w, &["rev-parse", "origin/feat"]));
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn"]), "t|共字君");

    remote_feat_moves(&r, 1, "theirs.txt");
    sh(&w, &["switch", "-q", "main"]);
    r.git(GitActionKind::Checkout, from_remote(Some(GitLocalCommits::Drop))).await.unwrap();
    assert_eq!((r.current(), r.head()), ("feat".to_string(), sh(&w, &["rev-parse", "origin/feat"])));
    assert_eq!(sh(&w, &["log", "--format=%s", "--grep=^mine$", "feat"]), "", "dropped");
}

#[tokio::test]
async fn rebasing_a_local_branch_onto_its_remote_one_stops_on_conflicts() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "feat", "origin/feat"]);
    commit(&w, "src/a.txt", "mine\n", "mine");
    sh(&w, &["switch", "-q", "main"]);
    remote_feat_moves(&r, 1, "src/a.txt");
    let error = r.git(GitActionKind::Checkout, from_remote(Some(GitLocalCommits::Rebase))).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：src/a.txt");
    let d = r.took();
    assert_eq!((d.code, d.paths), (Some(GitActionCode::Conflicts), strings(&["src/a.txt"])));
    assert_eq!(r.state.as_ref().unwrap().git.as_ref().unwrap().ongoing, Some(GitOngoingKind::Rebase));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert_eq!(r.current(), "feat");
}

fn pull(mode: Option<&str>, from: Option<&str>) -> impl FnOnce(&mut GitAction) {
    let (mode, from) = (mode.map(String::from), from.map(String::from));
    move |q| q.args = (mode.is_some() || from.is_some()).then(|| GitActionArgs { mode, from, ..a() })
}

#[tokio::test]
async fn pulls_stash_around_every_mode_and_say_what_came_in() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&r.other, "README.md", "hello\ntheirs\n", "theirs 1");
    commit(&r.other, "t.txt", "t\n", "theirs 2");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    let before = short(&w, "HEAD");
    write(&w, "README.md", "mine\nhello\n");
    r.git(GitActionKind::Pull, pull(None, None)).await.unwrap();
    assert_eq!(read(&w, "README.md").as_deref(), Some("mine\nhello\ntheirs\n"), "stashed around a fast-forward");
    let to = short(&w, "HEAD");
    let updated = GitUpdated { from: before, to, commits: 2, files: 2 };
    let detail = r.took();
    assert_eq!(
        GitActionDetail { commands: None, ..detail },
        GitActionDetail { updated: Some(updated), ..GitActionDetail::default() }
    );
    assert_eq!(sh(&w, &["stash", "list"]), "");

    r.git(GitActionKind::Pull, pull(None, None)).await.unwrap();
    assert_eq!(GitActionDetail { commands: None, ..r.took() }, GitActionDetail::default(), "nothing came in");

    // Restoring clashes with what came in: pulled all the same, the clash left to resolve, the stash kept.
    commit(&r.other, "README.md", "hello\ntheirs again\n", "theirs 3");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    write(&w, "README.md", "mine\nhello\nmine again\n");
    r.git(GitActionKind::Pull, pull(Some("rebase"), None)).await.unwrap();
    let d = r.took();
    assert_eq!((d.code, d.paths), (Some(GitActionCode::Conflicts), strings(&["README.md"])));
    assert_eq!(d.updated.map(|u| (u.commits, u.files)), Some((1, 1)));
    assert_eq!(sh(&w, &["log", "-1", "--format=%s"]), "theirs 3");
    assert!(sh(&w, &["stash", "list"]).contains("autostash"));
    sh(&w, &["reset", "-q", "--hard"]);
    sh(&w, &["stash", "clear"]);

    // Another remote branch than the upstream, fetched first, merged in.
    remote_feat_moves(&r, 0, "");
    sh(&r.other, &["switch", "-q", "feat"]);
    commit(&r.other, "f.txt", "f\n", "feat more");
    sh(&r.other, &["push", "-q", "origin", "feat"]);
    let before = short(&w, "HEAD");
    r.git(GitActionKind::Pull, pull(Some("merge"), Some("origin/feat"))).await.unwrap();
    assert_eq!(sh(&w, &["rev-parse", "origin/feat"]), sh(&r.other, &["rev-parse", "HEAD"]), "fetched");
    assert_eq!(sh(&w, &["log", "-1", "--format=%P|%cn"]).split(' ').count(), 2, "merged");
    assert_eq!(sh(&w, &["log", "-1", "--format=%cn"]), "共字君");
    assert_eq!(read(&w, "f.txt").as_deref(), Some("f\n"));
    let updated = r.took().updated.unwrap();
    assert_eq!((updated.from, updated.commits, updated.files), (before, 3, 4));
    assert_eq!(sh(&w, &["rev-parse", "--abbrev-ref", "main@{upstream}"]), "origin/main", "the upstream stays");
}

#[tokio::test]
async fn merges_and_rebases_stash_around_and_name_what_stopped_them() {
    let mut r = rig();
    let w = r.work.clone();
    let merge = |branch: &str| {
        let branch = branch.to_string();
        move |q: &mut GitAction| q.branch = Some(branch)
    };
    sh(&w, &["switch", "-q", "-c", "side"]);
    commit(&w, "README.md", "hello\nside\n", "side");
    sh(&w, &["switch", "-q", "-c", "clash", "main"]);
    commit(&w, "README.md", "hello\nclash\n", "clash");
    sh(&w, &["switch", "-q", "-c", "adds", "main"]);
    commit(&w, "new.txt", "new\n", "adds");
    sh(&w, &["switch", "-q", "main"]);

    write(&w, "README.md", "mine\nhello\n");
    r.git(GitActionKind::Merge, merge("side")).await.unwrap();
    assert_eq!(read(&w, "README.md").as_deref(), Some("mine\nhello\nside\n"));
    let detail = r.detail.take().unwrap();
    assert_eq!(GitActionDetail { commands: None, ..detail }, GitActionDetail::default());
    assert_eq!(sh(&w, &["stash", "list"]), "");

    sh(&w, &["checkout", "--", "README.md"]);
    let error = r.git(GitActionKind::Merge, merge("clash")).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：README.md");
    let d = r.took();
    assert_eq!((d.code, d.paths), (Some(GitActionCode::Conflicts), strings(&["README.md"])));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();

    write(&w, "new.txt", "untracked\n");
    let in_the_way = |r: &mut Rig, error: String| {
        assert!(error.contains("untracked working tree files would be overwritten"), "{error}");
        let d = r.took();
        assert_eq!((d.code, d.paths), (Some(GitActionCode::Overwritten), strings(&["new.txt"])));
    };
    let error = r.git(GitActionKind::Merge, merge("adds")).await.unwrap_err();
    in_the_way(&mut r, error);
    let rebase = |q: &mut GitAction| q.args = Some(GitActionArgs { onto: Some("adds".into()), ..a() });
    let error = r.git(GitActionKind::Rebase, rebase).await.unwrap_err();
    in_the_way(&mut r, error);
    fs::remove_file(w.join("new.txt")).unwrap();
    commit(&w, "mine.txt", "m\n", "mine");
    write(&w, "README.md", "mine\nhello\nside\n");
    r.git(GitActionKind::Rebase, rebase).await.unwrap();
    assert_eq!(sh(&w, &["rev-parse", "HEAD~2"]), sh(&w, &["rev-parse", "adds"]), "side and mine on top");
    assert_eq!(read(&w, "README.md").as_deref(), Some("mine\nhello\nside\n"), "stashed around the rebase");
    assert_eq!(sh(&w, &["stash", "list"]), "");
}

#[tokio::test]
async fn a_new_branch_may_replace_another_one_but_never_the_current_one() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["branch", "dev"]);
    let create = |from: &str, force: bool, checkout: bool| {
        let from = from.to_string();
        move |q: &mut GitAction| {
            q.branch = Some("dev".into());
            q.args = Some(GitActionArgs { from: Some(from), force: Some(force), checkout: Some(checkout), ..a() });
        }
    };
    let error = r.git(GitActionKind::BranchCreate, create("origin/feat", false, false)).await.unwrap_err();
    assert!(error.contains("already exists"), "{error}");
    let feat = sh(&w, &["rev-parse", "origin/feat"]);
    let output = r.git(GitActionKind::BranchCreate, create("origin/feat", true, false)).await.unwrap();
    assert!(output.starts_with("[dev "), "{output}");
    assert_eq!((sh(&w, &["rev-parse", "dev"]), r.current()), (feat.clone(), "main".to_string()));

    sh(&w, &["branch", "-f", "dev", "main"]);
    r.git(GitActionKind::BranchCreate, create("origin/feat", true, true)).await.unwrap();
    assert_eq!((r.current(), r.head()), ("dev".to_string(), feat.clone()));
    assert!(!sh(&w, &["config", "--list"]).contains("branch.dev."), "tracking nothing");

    let error = r.git(GitActionKind::BranchCreate, create("main", true, false)).await.unwrap_err();
    assert_eq!(error, "不能覆盖当前分支 dev");
    assert_eq!(r.head(), feat);
}

#[tokio::test]
async fn fetching_covers_every_repo_of_the_workspace_and_its_extra_dirs() {
    let mut r = rig();
    let tmp = r._tmp.path().to_path_buf();
    let (multi, extra) = (tmp.join("multi"), tmp.join("extra"));
    for (dir, name) in [(&multi, "a"), (&multi, "b"), (&extra, "c")] {
        fs::create_dir_all(dir).unwrap();
        sh(dir, &["clone", "-q", tmp.join("remote.git").to_str().unwrap(), name]);
    }
    let spec = WorkspaceSpec {
        cd_path: Some(multi.to_string_lossy().into()),
        extra_dirs: vec![extra.to_string_lossy().into()],
        ..r.spec()
    };
    let fetched = |dir: &Path| sh(dir, &["rev-parse", "origin/main"]);
    commit(&r.other, "theirs.txt", "1\n", "theirs 1");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    assert_eq!(r.fetch_in(spec.clone()).await, None, "the root is no repo");
    let theirs = r.head_of(&r.other);
    for dir in [multi.join("a"), multi.join("b"), extra.join("c")] {
        assert_eq!(fetched(&dir), theirs, "{}", dir.display());
    }

    sh(&multi.join("b"), &["remote", "set-url", "origin", "/nonexistent/remote.git"]);
    commit(&r.other, "theirs.txt", "2\n", "theirs 2");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    let error = r.fetch_in(spec).await.unwrap();
    assert!(error.starts_with("b: "), "{error}");
    let theirs = r.head_of(&r.other);
    assert_eq!((fetched(&multi.join("a")), fetched(&extra.join("c"))), (theirs.clone(), theirs));
}

impl Rig {
    fn head_of(&self, dir: &Path) -> String {
        sh(dir, &["rev-parse", "HEAD"])
    }
}
