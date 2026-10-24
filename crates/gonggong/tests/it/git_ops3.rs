//! The IDEA-style git tools (gitOps3) driven through the Engine against temp clones of a local bare remote: the reads
//! git.changes / show / blame / stashes / conflict, log filters, diff options, tags and recent branches, `repo` on every
//! read, the GitStatus extras, and every git.action kind.
use super::git_ops::{DOC, Rig, commit, rig, sh, side_repo, slow_run};
use gonggong::protocol::*;
use std::fs;
use std::path::Path;
use std::process::Command;

macro_rules! req {
    ($r:expr, $ty:ident { $($field:ident: $value:expr),* $(,)? }) => {
        $ty {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: $r.spec(),
            $($field: $value),*
        }
    };
}

fn bot() -> GitIdentity {
    GitIdentity { name: "共字君".into(), email: "bot@gonggong.local".into() }
}

pub(super) fn write(dir: &Path, file: &str, content: &str) {
    let path = dir.join(file);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

pub(super) fn read(dir: &Path, file: &str) -> Option<String> {
    fs::read_to_string(dir.join(file)).ok()
}

fn short(dir: &Path, rev: &str) -> String {
    sh(dir, &["rev-parse", "--short", rev])
}

fn subjects(dir: &Path, range: &str) -> Vec<String> {
    sh(dir, &["log", "--format=%s", range]).lines().map(String::from).collect()
}

/// Commits everything as `author` (`Name <mail>`), authored and committed at `date`.
fn commit_at(dir: &Path, file: &str, content: &str, msg: &str, author: &str, date: &str) {
    write(dir, file, content);
    sh(dir, &["add", "-A"]);
    let out = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg])
        .arg(format!("--author={author}"))
        .arg(format!("--date={date}"))
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .env("GIT_COMMITTER_DATE", date)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(out.status.success(), "commit {msg}: {}", String::from_utf8_lossy(&out.stderr));
}

fn conflict(path: &str, ours: GitConflictSide, theirs: GitConflictSide) -> GitConflict {
    GitConflict { path: path.into(), ours, theirs }
}

pub(super) fn a() -> GitActionArgs {
    GitActionArgs::default()
}

#[derive(Debug)]
struct Work {
    changes: Vec<GitWorkChange>,
    conflicts: Vec<GitConflict>,
    ongoing: Option<GitOngoing>,
    head: Option<GitHeadCommit>,
}

#[derive(Debug)]
struct Sides {
    base: Option<String>,
    ours: Option<String>,
    theirs: Option<String>,
    merged: Option<String>,
    binary: bool,
}

#[derive(Debug)]
struct Shown {
    commit: GitCommit,
    body: String,
    committer: String,
    committer_email: String,
    committed_at: String,
    branches: Vec<String>,
}

impl Rig {
    /// The action as the bot, `edit` applied: Ok(output) or Err(error), never refused as busy.
    pub(super) async fn git(
        &mut self,
        action: GitActionKind,
        edit: impl FnOnce(&mut GitAction),
    ) -> Result<String, String> {
        let mut req = GitAction { identity: Some(bot()), ..self.action_req(action) };
        edit(&mut req);
        let (ok, busy, output, error) = self.act(req).await;
        assert!(!busy);
        match ok {
            true => Ok(output.unwrap()),
            false => Err(error.unwrap()),
        }
    }

    /// The status sent after the last action.
    fn git_state(&self) -> GitStatus {
        self.state.as_ref().unwrap().git.clone().unwrap()
    }

    async fn work_in(&mut self, repo: Option<&str>) -> Result<Work, String> {
        self.send(ServerToDaemon::GitChanges(req!(self, GitChanges { repo: repo.map(String::from) })));
        match self.next().await {
            DaemonToServer::GitChangesResult { changes, conflicts, ongoing, head, error: None, .. } => {
                Ok(Work { changes, conflicts, ongoing, head })
            }
            DaemonToServer::GitChangesResult { error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn work(&mut self) -> Work {
        self.work_in(None).await.unwrap()
    }

    async fn tags_and_recent(&mut self) -> (Vec<GitTag>, Vec<String>) {
        self.send(ServerToDaemon::GitRefs(req!(self, GitRefs { repo: None })));
        match self.next().await {
            DaemonToServer::GitRefsResult { tags, recent, error: None, .. } => (tags, recent),
            other => panic!("unexpected {other:?}"),
        }
    }

    /// Subjects of the page, and whether there are more.
    async fn log_in(
        &mut self,
        repo: Option<&str>,
        r#ref: Option<&str>,
        skip: u32,
        limit: u32,
        filter: GitLogFilter,
    ) -> (Vec<String>, bool) {
        let (repo, r#ref, filter) = (repo.map(String::from), r#ref.map(String::from), Some(filter));
        self.send(ServerToDaemon::GitLog(req!(
            self,
            GitLog { repo: repo, r#ref: r#ref, skip: skip, limit: limit, filter: filter }
        )));
        match self.next().await {
            DaemonToServer::GitLogResult { commits, has_more, error: None, .. } => {
                (commits.into_iter().map(|c| c.subject).collect(), has_more)
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn show_in(&mut self, repo: Option<&str>, commit: &str) -> Result<Shown, String> {
        self.send(ServerToDaemon::GitShow(req!(self, GitShow { repo: repo.map(String::from), commit: commit.into() })));
        match self.next().await {
            DaemonToServer::GitShowResult {
                commit: Some(commit),
                body,
                committer,
                committer_email,
                committed_at,
                branches,
                error: None,
                ..
            } => Ok(Shown { commit, body, committer, committer_email, committed_at, branches }),
            DaemonToServer::GitShowResult { commit: None, error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn blame_in(
        &mut self,
        repo: Option<&str>,
        r#ref: Option<&str>,
        path: &str,
    ) -> Result<(Vec<GitBlameRange>, Vec<GitBlameCommit>), String> {
        let (repo, r#ref) = (repo.map(String::from), r#ref.map(String::from));
        self.send(ServerToDaemon::GitBlame(req!(self, GitBlame { repo: repo, r#ref: r#ref, path: path.into() })));
        match self.next().await {
            DaemonToServer::GitBlameResult { ranges, commits, error: None, .. } => Ok((ranges, commits)),
            DaemonToServer::GitBlameResult { error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn stashes_in(&mut self, repo: Option<&str>) -> Vec<GitStash> {
        self.send(ServerToDaemon::GitStashes(req!(self, GitStashes { repo: repo.map(String::from) })));
        match self.next().await {
            DaemonToServer::GitStashesResult { stashes, error: None, .. } => stashes,
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn conflict_in(&mut self, repo: Option<&str>, path: &str, max_bytes: u64) -> Result<Sides, String> {
        let repo = repo.map(String::from);
        self.send(ServerToDaemon::GitConflict(req!(
            self,
            GitConflictRead { repo: repo, path: path.into(), max_bytes: max_bytes }
        )));
        match self.next().await {
            DaemonToServer::GitConflictResult { base, ours, theirs, merged, binary, error: None, .. } => {
                Ok(Sides { base, ours, theirs, merged, binary })
            }
            DaemonToServer::GitConflictResult { error: Some(e), .. } => Err(e),
            other => panic!("unexpected {other:?}"),
        }
    }

    async fn conflict(&mut self, path: &str) -> Result<Sides, String> {
        self.conflict_in(None, path, 1 << 20).await
    }

    async fn diff_with(
        &mut self,
        repo: Option<&str>,
        (from, to, path): (&str, Option<&str>, Option<&str>),
        ignore_whitespace: Option<bool>,
        context: Option<u32>,
    ) -> String {
        let (repo, to, path) = (repo.map(String::from), to.map(String::from), path.map(String::from));
        let req = req!(
            self,
            GitDiff {
                repo: repo,
                from: from.into(),
                to: to,
                path: path,
                max_bytes: 1 << 20,
                ignore_whitespace: ignore_whitespace,
                context: context,
            }
        );
        self.send(ServerToDaemon::GitDiff(req));
        match self.next().await {
            DaemonToServer::GitDiffResult { patch: Some(patch), error: None, .. } => patch,
            other => panic!("unexpected {other:?}"),
        }
    }
}

#[tokio::test]
async fn changes_flag_untracked_files_count_lines_and_leave_the_index_alone() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "src/a.txt", "a1\nmore\n");
    fs::remove_file(w.join("README.md")).unwrap();
    write(&w, "notes/todo.md", "1\n2\n");
    write(&w, "staged.txt", "s\n");
    sh(&w, &["add", "staged.txt"]);
    sh(&w, &["mv", "docs/old.md", "docs/moved.md"]);
    fs::write(w.join("logo.png"), [0x89, b'P', 0, 9]).unwrap();
    write(&w, ".gonggong/state", "private\n");
    let staged = sh(&w, &["diff", "--cached", "--name-status"]);

    let c = r.work().await;
    let mut view: Vec<_> = c
        .changes
        .iter()
        .map(|c| (c.path.as_str(), c.change, c.old_path.as_deref(), c.untracked, c.add, c.del))
        .collect();
    view.sort_by(|a, b| a.0.cmp(b.0));
    use GitChangeKind as K;
    assert_eq!(
        view,
        [
            ("README.md", K::Deleted, None, false, Some(0), Some(1)),
            ("docs/moved.md", K::Renamed, Some("docs/old.md"), false, Some(0), Some(0)),
            ("logo.png", K::Modified, None, false, None, None),
            ("notes/todo.md", K::Added, None, true, Some(2), Some(0)),
            ("src/a.txt", K::Modified, None, false, Some(1), Some(0)),
            ("staged.txt", K::Added, None, false, Some(1), Some(0)),
        ]
    );
    assert!(c.conflicts.is_empty() && c.ongoing.is_none());
    let head = c.head.unwrap();
    assert_eq!((head.hash, head.short_hash, head.message.as_str()), (r.head(), short(&w, "HEAD"), "init"));
    assert!(head.pushed, "origin/main has it");
    assert_eq!(sh(&w, &["diff", "--cached", "--name-status"]), staged, "the index is left alone");

    // A file moved in the shell is its source deleted and an untracked file, not a rename.
    sh(&w, &["add", "-A", "--", ".", ":(exclude).gonggong"]);
    sh(&w, &["commit", "-q", "-m", "local\n\nwith a body"]);
    fs::rename(w.join("src/a.txt"), w.join("src/z.txt")).unwrap();
    let c = r.work().await;
    let view: Vec<_> = c.changes.iter().map(|c| (c.path.as_str(), c.change, c.untracked, c.add, c.del)).collect();
    assert_eq!(
        view,
        [("src/a.txt", K::Deleted, false, Some(0), Some(2)), ("src/z.txt", K::Added, true, Some(2), Some(0))]
    );
    let head = c.head.unwrap();
    assert_eq!((head.message.as_str(), head.pushed), ("local\n\nwith a body", false));
}

#[tokio::test]
async fn changes_of_an_unborn_repo_have_no_head() {
    let mut r = rig();
    let fresh = r.work.join("fresh");
    fs::create_dir_all(&fresh).unwrap();
    sh(&fresh, &["init", "-q", "-b", "main"]);
    write(&fresh, "a.txt", "a\n");
    let c = r.work_in(Some("fresh")).await.unwrap();
    assert!(c.head.is_none());
    let view: Vec<_> = c.changes.iter().map(|c| (c.path.as_str(), c.change, c.untracked)).collect();
    assert_eq!(view, [("a.txt", GitChangeKind::Added, true)]);
}

/// On main: README.md and src/a.txt edited; on feat/x: README.md edited, src/a.txt deleted, x.txt added.
fn diverged(r: &Rig) {
    let w = &r.work;
    sh(w, &["switch", "-q", "-c", "feat/x"]);
    write(w, "README.md", "hello\nfrom feat\n");
    fs::remove_file(w.join("src/a.txt")).unwrap();
    write(w, "x.txt", "x\n");
    sh(w, &["add", "-A"]);
    sh(w, &["commit", "-q", "-m", "feat x"]);
    sh(w, &["switch", "-q", "main"]);
    write(w, "README.md", "hello\nfrom main\n");
    write(w, "src/a.txt", "a1\nmain\n");
    sh(w, &["add", "-A"]);
    sh(w, &["commit", "-q", "-m", "main work"]);
}

#[tokio::test]
async fn a_merge_that_conflicts_is_shown_resolved_and_concluded_as_the_bot() {
    let mut r = rig();
    diverged(&r);
    let w = r.work.clone();
    let main = r.head();
    let error = r.git(GitActionKind::Merge, |q| q.branch = Some("feat/x".into())).await.unwrap_err();
    assert_eq!(error, "有 2 个冲突待解决：README.md, src/a.txt");
    let s = r.git_state();
    assert_eq!(
        (s.ongoing, s.conflicts, s.head.clone()),
        (Some(GitOngoingKind::Merge), Some(2), Some(short(&w, &main)))
    );

    let c = r.work().await;
    use GitConflictSide as S;
    assert_eq!(
        c.conflicts,
        [conflict("README.md", S::Modified, S::Modified), conflict("src/a.txt", S::Modified, S::Deleted)]
    );
    let merging = GitOngoing {
        kind: GitOngoingKind::Merge,
        subject: Some("feat/x".into()),
        step: None,
        total: None,
        message: Some("Merge branch 'feat/x'".into()),
    };
    assert_eq!(c.ongoing.as_ref(), Some(&merging));
    let paths: Vec<_> = c.changes.iter().map(|c| (c.path.as_str(), c.untracked)).collect();
    assert_eq!(paths, [("x.txt", false)], "unmerged paths are listed apart");
    assert_eq!(c.head.unwrap().hash, main);

    let sides = r.conflict("README.md").await.unwrap();
    assert_eq!(
        (sides.base.as_deref(), sides.ours.as_deref(), sides.theirs.as_deref(), sides.binary),
        (Some("hello\n"), Some("hello\nfrom main\n"), Some("hello\nfrom feat\n"), false)
    );
    let merged = sides.merged.unwrap();
    assert!(
        merged.starts_with("hello\n<<<<<<< ours\nfrom main\n||||||| base\n=======\nfrom feat\n>>>>>>> theirs\n"),
        "{merged}"
    );
    let deleted = r.conflict("src/a.txt").await.unwrap();
    assert_eq!(
        (deleted.base.as_deref(), deleted.ours.as_deref(), deleted.theirs, deleted.merged, deleted.binary),
        (Some("a1\n"), Some("a1\nmain\n"), None, None, false)
    );
    assert!(r.conflict("x.txt").await.unwrap_err().contains("x.txt"));
    assert!(r.conflict_in(None, "README.md", 4).await.unwrap_err().contains("超过"));

    let resolve = |path: &str, side: Option<GitConflictPick>, content: Option<&str>| {
        let args = GitActionArgs { path: Some(path.into()), side, content: content.map(String::from), ..a() };
        move |q: &mut GitAction| q.args = Some(args)
    };
    let done = r.git(GitActionKind::Resolve, resolve("README.md", None, Some("hello\nboth\n"))).await.unwrap();
    assert_eq!(done, "已解决 README.md");
    assert_eq!(r.git_state().conflicts, Some(1));
    r.git(GitActionKind::Resolve, resolve("src/a.txt", Some(GitConflictPick::Theirs), None)).await.unwrap();
    assert!(!w.join("src/a.txt").exists(), "theirs deleted it");
    assert!(r.git(GitActionKind::Resolve, resolve("x.txt", Some(GitConflictPick::Ours), None)).await.is_err());

    let c = r.work().await;
    assert!(c.conflicts.is_empty());
    assert_eq!(c.ongoing.map(|o| o.kind), Some(GitOngoingKind::Merge));
    let mut paths: Vec<_> = c.changes.iter().map(|c| (c.path.as_str(), c.change)).collect();
    paths.sort_by(|a, b| a.0.cmp(b.0));
    use GitChangeKind as K;
    assert_eq!(paths, [("README.md", K::Modified), ("src/a.txt", K::Deleted), ("x.txt", K::Added)]);

    let output = r.git(GitActionKind::Continue, |q| q.message = Some("合并 feat/x".into())).await.unwrap();
    assert!(output.starts_with("[main ") && output.ends_with("合并 feat/x"), "{output}");
    assert_eq!(
        sh(&w, &["log", "-1", "--format=%an|%ae|%cn|%ce|%s|%P"]),
        format!(
            "共字君|bot@gonggong.local|共字君|bot@gonggong.local|合并 feat/x|{main} {}",
            sh(&w, &["rev-parse", "feat/x"])
        )
    );
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nboth\n"));
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
    let s = r.git_state();
    assert_eq!((s.ongoing, s.conflicts, s.dirty), (None, Some(0), false));
}

#[tokio::test]
async fn conflicts_take_either_side_and_abort_puts_everything_back() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "feat/y"]);
    write(&w, "README.md", "hello\nfeat\n");
    write(&w, "src/a.txt", "feat\n");
    fs::write(w.join("logo.png"), [0u8, 1, 2, 3]).unwrap();
    write(&w, "both.txt", "feat side\n");
    write(&w, "docs/old.md", "edited on feat\n");
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "feat y"]);
    sh(&w, &["switch", "-q", "main"]);
    write(&w, "README.md", "hello\nmain\n");
    write(&w, "src/a.txt", "main\n");
    fs::write(w.join("logo.png"), [0u8, 9, 9, 9]).unwrap();
    write(&w, "both.txt", "main side\n");
    fs::remove_file(w.join("docs/old.md")).unwrap();
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "main y"]);
    let main = r.head();
    let error = r.git(GitActionKind::Merge, |q| q.branch = Some("feat/y".into())).await.unwrap_err();
    assert_eq!(error, "有 5 个冲突待解决：README.md, both.txt, docs/old.md, logo.png, src/a.txt");
    use GitConflictSide as S;
    let kinds: Vec<_> = r.work().await.conflicts.into_iter().map(|c| (c.ours, c.theirs)).collect();
    let both_modified = (S::Modified, S::Modified);
    assert_eq!(kinds, [both_modified, (S::Added, S::Added), (S::Deleted, S::Modified), both_modified, both_modified]);

    let binary = r.conflict("logo.png").await.unwrap();
    assert!(binary.binary);
    assert_eq!((binary.base, binary.ours, binary.theirs, binary.merged), (None, None, None, None));
    let added = r.conflict("both.txt").await.unwrap();
    assert_eq!(
        (added.base, added.ours.as_deref(), added.merged),
        (None, Some("main side\n"), None),
        "no base to merge from"
    );

    let side = |path: &str, side| {
        let args = GitActionArgs { path: Some(path.into()), side: Some(side), ..a() };
        move |q: &mut GitAction| q.args = Some(args)
    };
    r.git(GitActionKind::Resolve, side("README.md", GitConflictPick::Ours)).await.unwrap();
    r.git(GitActionKind::Resolve, side("src/a.txt", GitConflictPick::Theirs)).await.unwrap();
    r.git(GitActionKind::Resolve, side("both.txt", GitConflictPick::Theirs)).await.unwrap();
    r.git(GitActionKind::Resolve, side("docs/old.md", GitConflictPick::Ours)).await.unwrap();
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nmain\n"));
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("feat\n"));
    assert_eq!(read(&w, "both.txt").as_deref(), Some("feat side\n"));
    assert!(!w.join("docs/old.md").exists(), "ours deleted it");
    let c = r.work().await;
    assert_eq!(c.conflicts.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["logo.png"]);

    assert_eq!(r.git(GitActionKind::Skip, |_| {}).await.unwrap_err(), "合并不能跳过");
    let output = r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert!(output.starts_with("[main "), "{output}");
    assert_eq!(r.head(), main);
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("main\n"));
    let s = r.git_state();
    assert_eq!((s.ongoing, s.conflicts), (None, Some(0)));

    for kind in [GitActionKind::Continue, GitActionKind::Abort, GitActionKind::Skip] {
        assert_eq!(r.git(kind, |_| {}).await.unwrap_err(), "没有进行中的操作");
    }
}

#[tokio::test]
async fn a_rebase_stops_with_its_progress_and_skips_continues_or_aborts() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "README.md", "hello\ntopic1\n", "t1");
    commit(&w, "README.md", "hello\ntopic1\ntopic2\n", "t2");
    commit(&w, "c.txt", "c\n", "t3");
    sh(&w, &["switch", "-q", "main"]);
    commit(&w, "README.md", "hello\nmain\n", "m1");

    let rebase = |q: &mut GitAction| {
        q.branch = Some("topic".into());
        q.args = Some(GitActionArgs { onto: Some("main".into()), ..a() });
    };
    let error = r.git(GitActionKind::Rebase, rebase).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：README.md");
    let s = r.git_state();
    assert_eq!((s.ongoing, s.conflicts, s.branch), (Some(GitOngoingKind::Rebase), Some(1), None));
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!(
        (ongoing.kind, ongoing.subject.as_deref(), ongoing.step, ongoing.total, ongoing.message.as_deref()),
        (GitOngoingKind::Rebase, Some("topic"), Some(1), Some(3), Some("t1"))
    );

    // t2 builds on the skipped t1: it stops too.
    let error = r.git(GitActionKind::Skip, |_| {}).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：README.md");
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!((ongoing.step, ongoing.total), (Some(2), Some(3)));
    let resolved =
        GitActionArgs { path: Some("README.md".into()), content: Some("hello\nmain\ntopic2\n".into()), ..a() };
    r.git(GitActionKind::Resolve, |q| q.args = Some(resolved)).await.unwrap();
    let output = r.git(GitActionKind::Continue, |_| {}).await.unwrap();
    assert!(output.starts_with("[topic ") && output.ends_with("t3"), "{output}");
    assert_eq!(subjects(&w, "main..topic"), ["t3", "t2"]);
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn", "topic~1"]), "t|共字君", "replayed as the bot");
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nmain\ntopic2\n"));
    assert_eq!(r.git_state().ongoing, None);

    sh(&w, &["switch", "-q", "-c", "topic2", "main~1"]);
    commit(&w, "README.md", "hello\nagain\n", "again");
    let tip = r.head();
    let rebase = |q: &mut GitAction| q.args = Some(GitActionArgs { onto: Some("main".into()), ..a() });
    assert!(r.git(GitActionKind::Rebase, rebase).await.unwrap_err().contains("README.md"));
    let output = r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert!(output.starts_with("[topic2 "), "{output}");
    assert_eq!((r.head(), r.current()), (tip, "topic2".to_string()));
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
}

#[tokio::test]
async fn cherry_picks_apply_in_order_and_reverts_undo_newest_first() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "side"]);
    commit(&w, "s.txt", "one\n", "s1");
    commit(&w, "s.txt", "one\ntwo\n", "s2");
    let (s1, s2) = (sh(&w, &["rev-parse", "side~1"]), sh(&w, &["rev-parse", "side"]));
    sh(&w, &["switch", "-q", "main"]);

    let picks =
        |commits: Vec<String>| move |q: &mut GitAction| q.args = Some(GitActionArgs { commits: Some(commits), ..a() });
    let output = r.git(GitActionKind::CherryPick, picks(vec![s1.clone(), s2.clone()])).await.unwrap();
    assert!(output.starts_with("[main ") && output.ends_with("s2"), "{output}");
    assert_eq!(subjects(&w, "origin/main..main"), ["s2", "s1"]);
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn"]), "t|共字君");

    // Given oldest first; reverted newest first, so neither undo meets the other's change.
    let picked = vec![sh(&w, &["rev-parse", "HEAD~1"]), r.head()];
    r.git(GitActionKind::Revert, picks(picked)).await.unwrap();
    assert_eq!(subjects(&w, "origin/main..main")[..2], ["Revert \"s1\"", "Revert \"s2\""]);
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn"]), "共字君|共字君");
    assert!(!w.join("s.txt").exists());

    // Picking s2 alone over a different s.txt stops; the pick is shown and can be aborted.
    commit(&w, "s.txt", "mine\n", "mine");
    let head = r.head();
    assert_eq!(
        r.git(GitActionKind::CherryPick, picks(vec![s2.clone()])).await.unwrap_err(),
        "有 1 个冲突待解决：s.txt"
    );
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!((ongoing.kind, ongoing.subject), (GitOngoingKind::CherryPick, Some(short(&w, &s2))));
    assert_eq!(r.git_state().ongoing, Some(GitOngoingKind::CherryPick));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert_eq!(r.head(), head);
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");

    // Reverting a commit a later one built on stops; resolved, it goes on.
    commit(&w, "s.txt", "mine\nlater\n", "later");
    let mine = sh(&w, &["rev-parse", "HEAD~1"]);
    assert!(r.git(GitActionKind::Revert, picks(vec![mine.clone()])).await.unwrap_err().contains("s.txt"));
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!((ongoing.kind, ongoing.subject), (GitOngoingKind::Revert, Some(short(&w, &mine))));
    let resolved = GitActionArgs { path: Some("s.txt".into()), content: Some("later\n".into()), ..a() };
    r.git(GitActionKind::Resolve, |q| q.args = Some(resolved)).await.unwrap();
    let output = r.git(GitActionKind::Continue, |_| {}).await.unwrap();
    assert!(output.contains("Revert \"mine\""), "{output}");
    assert_eq!(r.git_state().ongoing, None);
}

#[tokio::test]
async fn merge_commits_are_picked_on_their_own_against_their_first_parent() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "side"]);
    commit(&w, "s.txt", "s\n", "s1");
    sh(&w, &["switch", "-q", "-c", "merged", "main"]);
    commit(&w, "m.txt", "m\n", "m1");
    sh(&w, &["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    let (merge, m1) = (r.head(), sh(&w, &["rev-parse", "HEAD^1"]));
    sh(&w, &["switch", "-q", "main"]);

    let picks =
        |commits: Vec<String>| move |q: &mut GitAction| q.args = Some(GitActionArgs { commits: Some(commits), ..a() });
    let error = r.git(GitActionKind::CherryPick, picks(vec![m1.clone(), merge.clone()])).await.unwrap_err();
    assert_eq!(error, "合并提交需要单独优选或还原");
    r.git(GitActionKind::CherryPick, picks(vec![merge])).await.unwrap();
    assert_eq!(subjects(&w, "origin/main..main"), ["merge side"]);
    assert!(w.join("s.txt").exists() && !w.join("m.txt").exists(), "the side the merge brought in");
}

#[tokio::test]
async fn merges_follow_their_mode_and_are_made_as_the_bot() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "ahead"]);
    commit(&w, "f.txt", "f\n", "f1");
    sh(&w, &["switch", "-q", "main"]);
    let merge = |branch: &str, mode: &str, no_commit: bool, message: Option<&str>| {
        let (branch, mode, message) = (branch.to_string(), mode.to_string(), message.map(String::from));
        move |q: &mut GitAction| {
            q.branch = Some(branch);
            q.message = message;
            q.args = Some(GitActionArgs { mode: Some(mode), no_commit: Some(no_commit), ..a() });
        }
    };
    let main = r.head();
    let output = r.git(GitActionKind::Merge, merge("ahead", "no-ff", false, Some("合并 ahead"))).await.unwrap();
    assert!(output.starts_with("[main ") && output.ends_with("合并 ahead"), "{output}");
    assert_eq!(
        sh(&w, &["log", "-1", "--format=%an|%cn|%P"]),
        format!("共字君|共字君|{main} {}", sh(&w, &["rev-parse", "ahead"]))
    );

    sh(&w, &["reset", "-q", "--hard", &main]);
    commit(&w, "g.txt", "g\n", "g1");
    let head = r.head();
    assert!(r.git(GitActionKind::Merge, merge("ahead", "ff-only", false, None)).await.is_err());
    assert_eq!(r.head(), head);

    let output = r.git(GitActionKind::Merge, merge("ahead", "squash", false, None)).await.unwrap();
    assert_eq!(output, "已合并 ahead，尚未提交");
    assert_eq!((r.head(), sh(&w, &["diff", "--cached", "--name-only"])), (head.clone(), "f.txt".to_string()));
    assert_eq!(r.git_state().ongoing, None, "a squash leaves nothing in progress");
    sh(&w, &["reset", "-q", "--hard"]);

    r.git(GitActionKind::Merge, merge("ahead", "default", true, None)).await.unwrap();
    assert_eq!(r.git_state().ongoing, Some(GitOngoingKind::Merge));
    assert_eq!(r.work().await.ongoing.unwrap().subject.as_deref(), Some("ahead"));
    r.git(GitActionKind::Continue, |_| {}).await.unwrap();
    assert_eq!(sh(&w, &["log", "-1", "--format=%s|%cn"]), "Merge branch 'ahead'|共字君");

    assert!(r.git(GitActionKind::Merge, merge("ahead", "octopus", false, None)).await.unwrap_err().contains("octopus"));
}

#[tokio::test]
async fn reset_moves_the_branch_in_each_mode() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "README.md", "hello\nc1\n", "c1");
    let c1 = r.head();
    commit(&w, "README.md", "hello\nc2\n", "c2");
    let reset = |commit: &str, mode: &str| {
        let args = GitActionArgs { commit: Some(commit.into()), mode: Some(mode.into()), ..a() };
        move |q: &mut GitAction| q.args = Some(args)
    };
    let output = r.git(GitActionKind::Reset, reset("HEAD~1", "soft")).await.unwrap();
    assert!(output.starts_with("[main ") && output.ends_with("c1"), "{output}");
    assert_eq!((r.head(), sh(&w, &["status", "--porcelain"])), (c1.clone(), "M  README.md".to_string()));
    r.git(GitActionKind::Reset, reset("HEAD", "mixed")).await.unwrap();
    assert_eq!(sh(&w, &["status", "--porcelain"]), "M README.md");
    r.git(GitActionKind::Reset, reset("HEAD", "hard")).await.unwrap();
    assert_eq!(
        (sh(&w, &["status", "--porcelain"]), read(&w, "README.md")),
        (String::new(), Some("hello\nc1\n".into()))
    );

    // keep: local changes the move does not touch stay, the others make it refuse.
    commit(&w, "src/a.txt", "c3\n", "c3");
    write(&w, "docs/old.md", "local\n");
    r.git(GitActionKind::Reset, reset("HEAD~1", "keep")).await.unwrap();
    assert_eq!(
        (r.head(), read(&w, "src/a.txt"), read(&w, "docs/old.md")),
        (c1.clone(), Some("a1\n".into()), Some("local\n".into()))
    );
    commit(&w, "src/a.txt", "c4\n", "c4");
    write(&w, "src/a.txt", "dirty\n");
    let head = r.head();
    assert!(r.git(GitActionKind::Reset, reset("HEAD~1", "keep")).await.is_err());
    assert_eq!((r.head(), read(&w, "src/a.txt")), (head, Some("dirty\n".into())));
    assert!(r.git(GitActionKind::Reset, reset("HEAD", "merge")).await.unwrap_err().contains("merge"));
}

#[tokio::test]
async fn discard_puts_paths_back_and_deletes_untracked_ones() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "README.md", "changed\n");
    fs::remove_file(w.join("docs/old.md")).unwrap();
    write(&w, "n/new.txt", "untracked\n");
    sh(&w, &["mv", "src/a.txt", "src/c.txt"]);
    write(&w, "w*.txt", "untracked too\n");
    write(&w, ".gonggong/x", "private\n");
    let paths = ["README.md", "docs/old.md", "n/new.txt", "src/a.txt", "src/c.txt", "w*.txt", ".gonggong/x"];
    let output = r.git(GitActionKind::Discard, |q| q.paths = Some(paths.map(String::from).to_vec())).await.unwrap();
    assert_eq!(output, "已回滚 6 个文件");
    assert_eq!(sh(&w, &["status", "--porcelain", "--untracked-files=all"]), "?? .gonggong/x");
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\n"));
    assert_eq!(read(&w, "docs/old.md").as_deref(), Some(DOC));
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a1\n"));
    assert!(!w.join("src/c.txt").exists() && !w.join("n").exists() && !w.join("w*.txt").exists());
    assert!(r.git(GitActionKind::Discard, |q| q.paths = Some(vec!["../other/README.md".into()])).await.is_err());

    // Before the first commit, back to HEAD is gone, staged or not.
    let fresh = w.join("fresh");
    fs::create_dir_all(&fresh).unwrap();
    sh(&fresh, &["init", "-q", "-b", "main"]);
    write(&fresh, "a.txt", "staged\n");
    sh(&fresh, &["add", "a.txt"]);
    write(&fresh, "b.txt", "untracked\n");
    let both = vec!["a.txt".to_string(), "b.txt".to_string()];
    r.git(GitActionKind::Discard, |q| {
        q.repo = Some("fresh".into());
        q.paths = Some(both);
    })
    .await
    .unwrap();
    assert!(!fresh.join("a.txt").exists() && !fresh.join("b.txt").exists());
    assert_eq!(sh(&fresh, &["ls-files"]), "");
}

#[tokio::test]
async fn stashes_are_made_listed_restored_and_dropped() {
    let mut r = rig();
    let w = r.work.clone();
    let stash = |message: Option<&str>, untracked: bool, paths: Option<Vec<String>>| {
        let message = message.map(String::from);
        move |q: &mut GitAction| {
            q.message = message;
            q.paths = paths;
            q.args = Some(GitActionArgs { untracked: Some(untracked), ..a() });
        }
    };
    let unstash = |n: u32, pop: bool, index: bool| {
        move |q: &mut GitAction| {
            q.args = Some(GitActionArgs { stash: Some(n), pop: Some(pop), index: Some(index), ..a() })
        }
    };
    write(&w, "README.md", "hello\none\n");
    write(&w, "u.txt", "untracked\n");
    assert_eq!(r.git(GitActionKind::Stash, stash(Some("试验"), true, None)).await.unwrap(), "stash@{0}: On main: 试验");
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
    assert_eq!(r.git_state().stashes, Some(1));
    write(&w, "src/a.txt", "a1\ntwo\n");
    let wip = format!("WIP on main: {} init", short(&w, "HEAD"));
    assert_eq!(r.git(GitActionKind::Stash, stash(None, false, None)).await.unwrap(), format!("stash@{{0}}: {wip}"));

    let list = r.stashes_in(None).await;
    let view: Vec<_> = list.iter().map(|s| (s.index, s.message.as_str(), s.branch.as_deref(), s.untracked)).collect();
    assert_eq!(view, [(0, wip.as_str(), Some("main"), false), (1, "试验", Some("main"), true)]);
    assert_eq!(list[0].hash, sh(&w, &["rev-parse", "stash@{0}"]));
    assert!(list[0].at.starts_with("20"), "{}", list[0].at);

    assert_eq!(r.git(GitActionKind::Unstash, unstash(1, false, false)).await.unwrap(), "已应用 stash@{1}");
    assert_eq!(
        (read(&w, "README.md").as_deref(), read(&w, "u.txt").as_deref()),
        (Some("hello\none\n"), Some("untracked\n"))
    );
    assert_eq!(r.stashes_in(None).await.len(), 2, "applied, not dropped");

    // Only the given paths: u.txt and the rest stay.
    r.git(GitActionKind::Stash, stash(Some("only readme"), false, Some(vec!["README.md".into()]))).await.unwrap();
    assert_eq!(sh(&w, &["status", "--porcelain"]), "?? u.txt");
    let output =
        r.git(GitActionKind::StashDrop, |q| q.args = Some(GitActionArgs { stash: Some(0), ..a() })).await.unwrap();
    assert!(output.contains("stash@{0}"), "{output}");
    assert_eq!(r.git_state().stashes, Some(2));
    fs::remove_file(w.join("u.txt")).unwrap();

    assert_eq!(r.git(GitActionKind::Unstash, unstash(0, true, false)).await.unwrap(), "已弹出 stash@{0}");
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a1\ntwo\n"));
    assert_eq!(r.stashes_in(None).await.len(), 1);

    // --index puts what was staged back in the index.
    sh(&w, &["add", "src/a.txt"]);
    r.git(GitActionKind::Stash, stash(None, false, None)).await.unwrap();
    r.git(GitActionKind::Unstash, unstash(0, true, true)).await.unwrap();
    assert_eq!(sh(&w, &["diff", "--cached", "--name-only"]), "src/a.txt");

    // As a new branch, made where the stash was.
    r.git(GitActionKind::Stash, stash(None, false, None)).await.unwrap();
    let output = r
        .git(GitActionKind::Unstash, |q| {
            q.branch = Some("from-stash".into());
            q.args = Some(GitActionArgs { stash: Some(0), ..a() });
        })
        .await
        .unwrap();
    assert!(output.starts_with("[from-stash "), "{output}");
    assert_eq!((r.current(), read(&w, "src/a.txt")), ("from-stash".to_string(), Some("a1\ntwo\n".into())));
    assert_eq!(r.stashes_in(None).await.len(), 1);

    assert_eq!(r.git(GitActionKind::StashDrop, |_| {}).await.unwrap(), "已清空贮藏");
    assert!(r.stashes_in(None).await.is_empty());
    assert_eq!(r.git_state().stashes, Some(0));
    sh(&w, &["reset", "-q", "--hard"]);
    assert_eq!(r.git(GitActionKind::Stash, stash(None, true, None)).await.unwrap_err(), "没有可贮藏的改动");

    sh(&w, &["switch", "-q", "--detach"]);
    write(&w, "README.md", "detached\n");
    r.git(GitActionKind::Stash, stash(Some("on a detached head"), false, None)).await.unwrap();
    let list = r.stashes_in(None).await;
    assert_eq!((list[0].message.as_str(), list[0].branch.as_deref()), ("on a detached head", None));
}

#[tokio::test]
async fn tags_are_listed_created_pushed_and_deleted() {
    let mut r = rig();
    let w = r.work.clone();
    let tag = |name: &str, message: Option<&str>| {
        let (name, message) = (name.to_string(), message.map(String::from));
        move |q: &mut GitAction| {
            q.message = message;
            q.args = Some(GitActionArgs { name: Some(name), ..a() });
        }
    };
    let output = r.git(GitActionKind::TagCreate, tag("v1.0", Some("发布 1.0"))).await.unwrap();
    assert!(output.starts_with("[v1.0 ") && output.ends_with("init"), "{output}");
    // A later commit date makes the lightweight tag on it the newest.
    commit_at(&w, "after.txt", "a\n", "after", "t <t@t>", "2030-01-01T00:00:00+00:00");
    r.git(GitActionKind::TagCreate, tag("nightly", None)).await.unwrap();
    let old = |q: &mut GitAction| {
        q.args = Some(GitActionArgs { name: Some("old".into()), from: Some("HEAD~1".into()), ..a() })
    };
    r.git(GitActionKind::TagCreate, old).await.unwrap();
    assert!(r.git(GitActionKind::TagCreate, tag("bad name", None)).await.is_err());

    let (tags, _) = r.tags_and_recent().await;
    let view: Vec<_> =
        tags.iter().map(|t| (t.name.as_str(), t.annotated, t.commit.clone(), t.subject.as_str())).collect();
    let (head, init) = (short(&w, "HEAD"), short(&w, "HEAD~1"));
    assert_eq!(view[0], ("nightly", false, head, "after"));
    assert!(
        view.contains(&("v1.0", true, init.clone(), "init")) && view.contains(&("old", false, init, "init")),
        "{view:?}"
    );
    assert!(tags[0].at.starts_with("2030-01-01"), "{}", tags[0].at);
    assert_eq!(
        sh(&w, &["cat-file", "-p", "v1.0"]).lines().find(|l| l.starts_with("tagger")).unwrap().split(" <").next(),
        Some("tagger 共字君")
    );

    let push = |q: &mut GitAction| {
        q.remote = Some("origin".into());
        q.args = Some(GitActionArgs { name: Some("v1.0".into()), ..a() });
    };
    r.git(GitActionKind::TagPush, push).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "v1.0^{commit}"]), sh(&w, &["rev-parse", "v1.0^{commit}"]));
    r.git(GitActionKind::TagDelete, push).await.unwrap();
    assert_eq!(sh(&r.remote, &["tag", "--list", "v1.0"]), "");
    assert_eq!(sh(&w, &["tag", "--list", "v1.0"]), "");
    let output =
        r.git(GitActionKind::TagDelete, |q| q.args = Some(GitActionArgs { name: Some("nightly".into()), ..a() })).await;
    assert!(output.unwrap().contains("nightly"));
    assert_eq!(sh(&w, &["tag", "--list"]), "old");
}

#[tokio::test]
async fn branches_are_created_renamed_and_deleted_here_and_on_the_remote() {
    let mut r = rig();
    let w = r.work.clone();
    let create = |name: &str, from: Option<&str>, checkout: bool| {
        let (name, from) = (name.to_string(), from.map(String::from));
        move |q: &mut GitAction| {
            q.branch = Some(name);
            q.args = Some(GitActionArgs { from, checkout: Some(checkout), ..a() });
        }
    };
    let output = r.git(GitActionKind::BranchCreate, create("feat/new", Some("origin/main"), true)).await.unwrap();
    assert!(output.starts_with("[feat/new "), "{output}");
    assert_eq!(r.current(), "feat/new");
    assert!(
        Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "feat/new@{upstream}"])
            .current_dir(&w)
            .env_remove("GIT_AUTHOR_NAME")
            .env_remove("GIT_AUTHOR_EMAIL")
            .env_remove("GIT_COMMITTER_NAME")
            .env_remove("GIT_COMMITTER_EMAIL")
            .output()
            .unwrap()
            .stdout
            .is_empty(),
        "tracks nothing yet"
    );
    r.git(GitActionKind::BranchCreate, create("feat/other", None, false)).await.unwrap();
    assert_eq!(r.current(), "feat/new");
    for bad in ["@{-1}", "-x", "a..b", "feat/new"] {
        assert!(r.git(GitActionKind::BranchCreate, create(bad, None, false)).await.is_err(), "{bad}");
    }
    let rename = |q: &mut GitAction| {
        q.branch = Some("feat/other".into());
        q.args = Some(GitActionArgs { name: Some("feat/renamed".into()), ..a() });
    };
    assert_eq!(r.git(GitActionKind::BranchRename, rename).await.unwrap(), "feat/other → feat/renamed");

    sh(&w, &["switch", "-q", "main"]);
    sh(&w, &["switch", "-q", "feat/renamed"]);
    sh(&w, &["switch", "-q", "main"]);
    let (_, recent) = r.tags_and_recent().await;
    assert_eq!(recent, ["feat/renamed", "feat/new"]);

    sh(&w, &["switch", "-q", "feat/renamed"]);
    commit(&w, "r.txt", "r\n", "unmerged work");
    sh(&w, &["switch", "-q", "main"]);
    let delete = |name: &str, force: bool| {
        let name = name.to_string();
        move |q: &mut GitAction| {
            q.branch = Some(name);
            q.args = Some(GitActionArgs { force: Some(force), ..a() });
        }
    };
    assert!(r.git(GitActionKind::BranchDelete, delete("feat/renamed", false)).await.is_err());
    assert!(r.git(GitActionKind::BranchDelete, delete("feat/renamed", true)).await.unwrap().contains("feat/renamed"));
    r.git(GitActionKind::BranchDelete, delete("feat/new", false)).await.unwrap();
    assert_eq!(sh(&w, &["branch", "--format=%(refname:short)"]), "main");

    sh(&r.other, &["push", "-q", "origin", "main:gone"]);
    sh(&w, &["fetch", "-q"]);
    let output = r.git(GitActionKind::BranchDelete, delete("origin/gone", false)).await.unwrap();
    assert!(output.starts_with("origin/gone "), "{output}");
    assert_eq!(sh(&r.remote, &["branch", "--list", "gone"]), "");
    assert_eq!(sh(&w, &["branch", "-r", "--list", "origin/gone"]), "");
    assert!(r.git(GitActionKind::BranchDelete, delete("nope", false)).await.is_err());
}

#[tokio::test]
async fn a_push_is_forced_with_a_lease_after_an_amend_and_can_carry_the_tags() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "t.txt", "t\n", "topic v1");
    let push = |force: bool, tags: bool| {
        move |q: &mut GitAction| {
            q.branch = Some("topic".into());
            q.remote = Some("origin".into());
            q.args = Some(GitActionArgs { force: Some(force), tags: Some(tags), ..a() });
        }
    };
    r.git(GitActionKind::Push, push(false, false)).await.unwrap();
    let reword = |q: &mut GitAction| {
        q.message = Some("topic v2".into());
        q.paths = Some(vec![]);
        q.args = Some(GitActionArgs { amend: Some(true), ..a() });
    };
    r.git(GitActionKind::Commit, reword).await.unwrap();
    let error = r.git(GitActionKind::Push, push(false, false)).await.unwrap_err();
    assert!(error.contains("rejected"), "{error}");
    let output = r.git(GitActionKind::Push, push(true, false)).await.unwrap();
    assert!(output.starts_with("origin/topic "), "{output}");
    assert_eq!(sh(&r.remote, &["log", "-1", "--format=%s", "topic"]), "topic v2");

    sh(&w, &["tag", "v-topic"]);
    r.git(GitActionKind::Push, push(false, true)).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "v-topic"]), r.head());
}

#[tokio::test]
async fn pulls_merge_or_rebase_around_local_changes_and_update_other_branches() {
    let mut r = rig();
    let w = r.work.clone();
    let pull = |mode: &str, branch: Option<&str>| {
        let (mode, branch) = (mode.to_string(), branch.map(String::from));
        move |q: &mut GitAction| {
            q.branch = branch;
            q.args = Some(GitActionArgs { mode: Some(mode), ..a() });
        }
    };
    commit(&r.other, "theirs.txt", "1", "theirs 1");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    commit(&w, "mine.txt", "m", "mine 1");
    write(&w, "README.md", "hello\nwip\n");
    let output = r.git(GitActionKind::Pull, pull("merge", None)).await.unwrap();
    assert!(output.starts_with("[main "), "{output}");
    assert_eq!(sh(&w, &["log", "-1", "--format=%cn|%P"]).split(' ').count(), 2, "a merge commit");
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn"]), "共字君|共字君");
    assert!(w.join("theirs.txt").exists());
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nwip\n"), "stashed around the merge");

    commit(&r.other, "theirs.txt", "2", "theirs 2");
    sh(&r.other, &["push", "-q", "origin", "main"]);
    commit(&w, "mine.txt", "m2", "mine 2");
    r.git(GitActionKind::Pull, pull("rebase", None)).await.unwrap();
    assert_eq!(sh(&w, &["rev-list", "--merges", "origin/main..HEAD"]), "", "replayed on top");
    assert_eq!(subjects(&w, "origin/main..HEAD"), ["mine 2", "mine 1"]);
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nwip\n"));

    // Another local branch is fast-forwarded without checking it out.
    sh(&w, &["branch", "feat", "origin/feat"]);
    sh(&r.other, &["switch", "-q", "-c", "feat", "origin/feat"]);
    commit(&r.other, "f.txt", "f", "feat more");
    sh(&r.other, &["push", "-q", "origin", "feat"]);
    let (head, before) = (r.head(), short(&w, "feat"));
    let output = r.git(GitActionKind::Pull, pull("ff-only", Some("feat"))).await.unwrap();
    assert_eq!(output, format!("feat {before}..{}", short(&r.other, "HEAD")));
    assert_eq!((sh(&w, &["rev-parse", "feat"]), r.head()), (sh(&r.other, &["rev-parse", "HEAD"]), head));
    assert_eq!(r.git(GitActionKind::Pull, pull("ff-only", Some("feat"))).await.unwrap(), "feat 已是最新");
    sh(&w, &["branch", "solo"]);
    assert_eq!(
        r.git(GitActionKind::Pull, pull("ff-only", Some("solo"))).await.unwrap_err(),
        "分支 solo 没有上游分支，无法更新"
    );
    assert!(r.git(GitActionKind::Pull, pull("octopus", None)).await.is_err());
}

#[tokio::test]
async fn checkout_detaches_stashes_around_the_switch_or_forces_it() {
    let mut r = rig();
    let w = r.work.clone();
    let checkout = |branch: &str, detach: bool, mode: &str| {
        let (branch, mode) = (branch.to_string(), mode.to_string());
        move |q: &mut GitAction| {
            q.branch = Some(branch);
            q.args = Some(GitActionArgs { detach: Some(detach), mode: Some(mode), ..a() });
        }
    };
    sh(&w, &["tag", "v0"]);
    commit(&w, "later.txt", "l", "later");
    let output = r.git(GitActionKind::Checkout, checkout("v0", true, "keep")).await.unwrap();
    assert!(output.starts_with("[HEAD ") && output.ends_with("init"), "{output}");
    let s = r.git_state();
    assert_eq!((s.branch, s.head), (None, Some(short(&w, "v0"))));

    sh(&w, &["switch", "-q", "main"]);
    write(&w, "README.md", "hello\nmine\n");
    write(&w, "new.txt", "untracked\n");
    r.git(GitActionKind::Checkout, checkout("origin/feat", false, "smart")).await.unwrap();
    assert_eq!(r.current(), "feat");
    assert_eq!(
        (read(&w, "README.md").as_deref(), read(&w, "new.txt").as_deref()),
        (Some("hello\nmine\n"), Some("untracked\n"))
    );
    assert_eq!(sh(&w, &["stash", "list"]), "", "restored and dropped");

    // A change that clashes with the other branch stays in conflict, its stash kept.
    write(&w, "src/a.txt", "mine\n");
    let error = r.git(GitActionKind::Checkout, checkout("main", false, "smart")).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：src/a.txt");
    assert_eq!(r.current(), "main");
    assert_eq!(r.git_state().conflicts, Some(1));
    assert!(sh(&w, &["stash", "list"]).contains("gonggong: smart checkout"));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert_eq!(r.git_state().conflicts, Some(0));

    write(&w, "src/a.txt", "dirty\n");
    r.git(GitActionKind::Checkout, checkout("feat", false, "force")).await.unwrap();
    assert_eq!((r.current(), read(&w, "src/a.txt")), ("feat".to_string(), Some("a2\n".into())));
    assert!(r.git(GitActionKind::Checkout, checkout("main", false, "hard")).await.is_err());
}

#[tokio::test]
async fn amend_takes_the_given_paths_or_only_the_message() {
    let mut r = rig();
    let w = r.work.clone();
    let commit = |message: &str, paths: Option<&[&str]>, amend: bool| {
        let (message, paths) = (message.to_string(), paths.map(|p| p.iter().map(|p| p.to_string()).collect()));
        move |q: &mut GitAction| {
            q.message = Some(message);
            q.paths = paths;
            q.args = Some(GitActionArgs { amend: Some(amend), ..a() });
        }
    };
    write(&w, "README.md", "hello\nv2\n");
    write(&w, "new.txt", "new\n");
    r.git(GitActionKind::Commit, commit("c1", Some(&["README.md"]), false)).await.unwrap();
    let parent = sh(&w, &["rev-parse", "HEAD~1"]);
    write(&w, "README.md", "hello\nv3\n");
    let output =
        r.git(GitActionKind::Commit, commit("c1 amended", Some(&["README.md", "new.txt"]), true)).await.unwrap();
    assert!(output.contains("c1 amended"), "{output}");
    assert_eq!(sh(&w, &["rev-parse", "HEAD~1"]), parent, "rewritten, not added");
    assert_eq!(sh(&w, &["show", "--name-only", "--format=%s", "HEAD"]), "c1 amended\n\nREADME.md\nnew.txt");
    assert_eq!(sh(&w, &["log", "-1", "--format=%an|%cn"]), "共字君|共字君");

    write(&w, "src/a.txt", "staged\n");
    sh(&w, &["add", "src/a.txt"]);
    let tree = sh(&w, &["rev-parse", "HEAD^{tree}"]);
    r.git(GitActionKind::Commit, commit("c1 reworded", Some(&[]), true)).await.unwrap();
    assert_eq!(
        (sh(&w, &["log", "-1", "--format=%s"]), sh(&w, &["rev-parse", "HEAD^{tree}"])),
        ("c1 reworded".to_string(), tree)
    );
    assert_eq!(sh(&w, &["diff", "--cached", "--name-only"]), "src/a.txt", "still staged");

    r.git(GitActionKind::Commit, commit("c1 with everything", None, true)).await.unwrap();
    assert_eq!(sh(&w, &["rev-parse", "HEAD~1"]), parent);
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
}

#[tokio::test]
async fn blame_attributes_lines_and_marks_uncommitted_ones() {
    let mut r = rig();
    let w = r.work.clone();
    commit_at(&w, "README.md", "hello\nsecond\n", "second", "Alice <alice@corp.com>", "2026-10-20T08:00:00+08:00");
    write(&w, "README.md", "hello\nsecond\nthird\nfourth\n");
    let (init, second) = (sh(&w, &["rev-parse", "HEAD~1"]), r.head());
    let (ranges, commits) = r.blame_in(None, None, "README.md").await.unwrap();
    let range = |start, count, commit: &str| GitBlameRange { start, count, commit: commit.into() };
    assert_eq!(ranges, [range(1, 1, &init), range(2, 1, &second), range(3, 2, "")]);
    let alice = GitBlameCommit {
        hash: second.clone(),
        short_hash: second[..7].into(),
        author: "Alice".into(),
        email: "alice@corp.com".into(),
        at: "2026-10-20T08:00:00+08:00".into(),
        subject: "second".into(),
    };
    assert_eq!(commits.iter().map(|c| c.hash.as_str()).collect::<Vec<_>>(), [init.as_str(), second.as_str()]);
    assert_eq!(commits[1], alice);
    assert_eq!(
        (commits[0].author.as_str(), commits[0].email.as_str(), commits[0].subject.as_str()),
        ("t", "t@t", "init")
    );

    let (ranges, _) = r.blame_in(None, Some("HEAD~1"), "README.md").await.unwrap();
    assert_eq!(ranges, [range(1, 1, &init)]);
    assert!(r.blame_in(None, None, "nope.txt").await.is_err());
    assert!(r.blame_in(None, None, "../x").await.unwrap_err().contains("超出"));
}

/// work/hist: a history of its own with set dates, authors, a rename, a merged side branch and an unmerged one.
fn history(r: &Rig) -> std::path::PathBuf {
    let h = r.work.join("hist");
    fs::create_dir_all(&h).unwrap();
    sh(&h, &["init", "-q", "-b", "main"]);
    commit_at(&h, "base.txt", "b\n", "base", "Carol <carol@x>", "2026-09-01T10:00:00+08:00");
    commit_at(&h, "f1.txt", "f1\n", "fix refund bug", "Alice <alice@x>", "2026-10-01T10:00:00+08:00");
    commit_at(&h, "f2.txt", "f2\n", "Fix (refund) again", "Bob <bob@x>", "2026-10-05T10:00:00+08:00");
    sh(&h, &["switch", "-q", "-c", "side"]);
    commit_at(&h, "s1.txt", "s1\n", "side one", "Bob <bob@x>", "2026-10-06T10:00:00+08:00");
    commit_at(&h, "s2.txt", "s2\n", "side two", "Bob <bob@x>", "2026-10-08T10:00:00+08:00");
    sh(&h, &["switch", "-q", "main"]);
    sh(&h, &["mv", "f1.txt", "g1.txt"]);
    commit_at(&h, "g1.txt", "f1\n", "other work\n\nmoved f1 to g1", "Alice <alice@x>", "2026-10-07T10:00:00+08:00");
    commit_at(&h, "g1.txt", "f1\nedited\n", "edit g1", "Alice <alice@x>", "2026-10-09T10:00:00+08:00");
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "merge",
            "-q",
            "--no-ff",
            "-m",
            "Merge branch 'side'",
            "side",
        ])
        .env("GIT_COMMITTER_DATE", "2026-10-10T10:00:00+08:00")
        .env("GIT_AUTHOR_DATE", "2026-10-10T10:00:00+08:00")
        .env_remove("GIT_AUTHOR_NAME")
        .env_remove("GIT_AUTHOR_EMAIL")
        .env_remove("GIT_COMMITTER_NAME")
        .env_remove("GIT_COMMITTER_EMAIL")
        .current_dir(&h)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    sh(&h, &["switch", "-q", "-c", "extra", "main~4"]);
    commit_at(&h, "x.txt", "x\n", "extra work", "Dave <dave@x>", "2026-10-02T10:00:00+08:00");
    sh(&h, &["switch", "-q", "main"]);
    h
}

/// Subjects of work/hist's log from `ref` with `filter`.
async fn log(r: &mut Rig, r#ref: Option<&str>, filter: GitLogFilter) -> Vec<String> {
    r.log_in(Some("hist"), r#ref, 0, 50, filter).await.0
}

#[tokio::test]
async fn log_filters_by_author_text_dates_and_path_in_date_or_topo_order() {
    let mut r = rig();
    history(&r);
    let hist = Some("hist");
    let f = GitLogFilter::default;
    let dated = [
        "Merge branch 'side'",
        "edit g1",
        "side two",
        "other work",
        "side one",
        "Fix (refund) again",
        "fix refund bug",
        "base",
    ];
    assert_eq!(log(&mut r, None, f()).await, dated);
    assert_eq!(log(&mut r, None, GitLogFilter { order: Some(GitLogOrder::Date), ..f() }).await, dated);
    let topo = log(&mut r, None, GitLogFilter { order: Some(GitLogOrder::Topo), ..f() }).await;
    assert_ne!(topo, dated);
    let at = |s: &str| topo.iter().position(|t| t == s).unwrap();
    assert!(
        at("other work") == at("edit g1") + 1 && at("side one") == at("side two") + 1,
        "lines kept apart: {topo:?}"
    );

    let alice = GitLogFilter { author: Some("ALICE".into()), ..f() };
    assert_eq!(log(&mut r, None, alice.clone()).await, ["edit g1", "other work", "fix refund bug"]);
    assert!(log(&mut r, None, GitLogFilter { match_case: Some(true), ..alice }).await.is_empty());
    let text = |t: &str, regexp: bool, case: bool| GitLogFilter {
        text: Some(t.into()),
        regexp: Some(regexp),
        match_case: Some(case),
        ..f()
    };
    assert_eq!(log(&mut r, None, text("refund", false, false)).await, ["Fix (refund) again", "fix refund bug"]);
    assert_eq!(log(&mut r, None, text("(refund)", false, false)).await, ["Fix (refund) again"]);
    assert_eq!(log(&mut r, None, text("^fix.*bug$", true, false)).await, ["fix refund bug"]);
    assert_eq!(log(&mut r, None, text("Fix", false, true)).await, ["Fix (refund) again"]);
    let both = GitLogFilter { author: Some("bob".into()), ..text("refund", false, false) };
    assert_eq!(log(&mut r, None, both).await, ["Fix (refund) again"]);
    let regexp_author = GitLogFilter { author: Some("b.b".into()), ..text("side", true, false) };
    assert!(log(&mut r, None, regexp_author).await.is_empty(), "the author is matched as typed");

    let dates = GitLogFilter { since: Some("2026-10-02".into()), until: Some("2026-10-06".into()), ..f() };
    assert_eq!(log(&mut r, None, dates).await, ["side one", "Fix (refund) again"]);
    let file = GitLogFilter { path: Some("g1.txt".into()), ..f() };
    assert_eq!(log(&mut r, None, file).await, ["edit g1", "other work", "fix refund bug"], "renames followed");
    let dir = GitLogFilter { path: Some("./".into()), ..f() };
    assert_eq!(log(&mut r, None, dir).await.len(), dated.len());

    let all = log(&mut r, None, GitLogFilter { all: Some(true), ..f() }).await;
    assert_eq!(all.len(), dated.len() + 1);
    assert_eq!(all[all.len() - 3..], ["extra work", "fix refund bug", "base"]);
    let first = log(&mut r, None, GitLogFilter { first_parent: Some(true), ..f() }).await;
    assert_eq!(first, ["Merge branch 'side'", "edit g1", "other work", "Fix (refund) again", "fix refund bug", "base"]);
    let plain = log(&mut r, None, GitLogFilter { no_merges: Some(true), ..f() }).await;
    assert_eq!(plain, dated[1..]);
    assert_eq!(log(&mut r, Some("side..main"), f()).await, ["Merge branch 'side'", "edit g1", "other work"]);
    assert_eq!(log(&mut r, Some("extra"), f()).await, ["extra work", "fix refund bug", "base"]);

    let alice = GitLogFilter { author: Some("alice".into()), ..f() };
    assert_eq!(r.log_in(hist, None, 0, 2, alice.clone()).await, (vec!["edit g1".into(), "other work".into()], true));
    assert_eq!(r.log_in(hist, None, 2, 2, alice).await, (vec!["fix refund bug".into()], false));
}

#[tokio::test]
async fn show_gives_the_whole_message_the_committer_and_the_branches_containing_it() {
    let mut r = rig();
    let h = history(&r);
    let moved = sh(&h, &["rev-parse", "main~1^1"]);
    let s = r.show_in(Some("hist"), &moved).await.unwrap();
    assert_eq!(
        (s.commit.subject.as_str(), s.commit.author.as_str(), s.commit.hash.as_str()),
        ("other work", "Alice", moved.as_str())
    );
    assert_eq!(s.body, "other work\n\nmoved f1 to g1");
    assert_eq!((s.committer.as_str(), s.committer_email.as_str()), ("t", "t@t"));
    assert_eq!(s.committed_at, "2026-10-07T10:00:00+08:00");
    assert_eq!(s.branches, ["main"]);
    let merge = r.show_in(Some("hist"), "main").await.unwrap();
    assert_eq!((merge.commit.parents.len(), merge.commit.refs.clone()), (2, vec!["HEAD -> main".to_string()]));
    assert_eq!(r.show_in(Some("hist"), "nope").await.unwrap_err(), "提交不存在：nope");
    assert!(r.show_in(Some("hist"), "--all").await.is_err());

    let init = r.show_in(None, "HEAD").await.unwrap();
    assert_eq!(init.branches, ["main", "origin/feat", "origin/main"]);
}

#[tokio::test]
async fn diff_ignores_whitespace_and_takes_the_context_asked_for() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "README.md", "hello  \n");
    let one = ("HEAD", None, Some("README.md"));
    let patch = r.diff_with(None, one, None, None).await;
    assert!(patch.contains("-hello\n+hello  \n"), "{patch}");
    let patch = r.diff_with(None, one, Some(true), None).await;
    assert!(!patch.contains("@@"), "{patch}");

    write(&w, "docs/old.md", &DOC.replace("line five", "line 5"));
    let doc = ("HEAD", None, Some("docs/old.md"));
    let patch = r.diff_with(None, doc, None, Some(0)).await;
    assert!(patch.contains("@@ -5 +5 @@") && patch.contains("\n-line five\n+line 5\n"), "{patch}");
    assert!(!patch.contains("\n line four\n"), "{patch}");
    let patch = r.diff_with(None, doc, None, Some(100_000)).await;
    assert!(patch.contains("@@ -1,5 +1,5 @@\n line one\n"), "{patch}");
}

#[tokio::test]
async fn every_read_works_on_the_chosen_repo() {
    let mut r = rig();
    let lib = r.work.join("libs/core");
    side_repo(&lib);
    write(&lib, "lib.txt", "stashed\n");
    sh(&lib, &["stash", "-q"]);
    write(&lib, "lib.txt", "1\nwip\n");
    let core = Some("libs/core");

    assert_eq!(r.log_in(core, None, 0, 10, GitLogFilter::default()).await.0, ["lib init"]);
    assert_eq!(r.show_in(core, "dev").await.unwrap().commit.subject, "lib dev");
    let req = req!(r, GitTree { repo: core.map(String::from), r#ref: Some("dev".into()), path: String::new() });
    r.send(ServerToDaemon::GitTree(req));
    let DaemonToServer::GitTreeResult { entries, error: None, .. } = r.next().await else { panic!() };
    assert_eq!(entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["lib.txt"]);
    let req = req!(
        r,
        GitRead { repo: core.map(String::from), r#ref: Some("dev".into()), path: "lib.txt".into(), max_bytes: 100 }
    );
    r.send(ServerToDaemon::GitRead(req));
    let DaemonToServer::GitReadResult { text, error: None, .. } = r.next().await else { panic!() };
    assert_eq!(text.as_deref(), Some("2"));
    let req = req!(r, GitCompare { repo: core.map(String::from), from: "main".into(), to: Some("dev".into()) });
    r.send(ServerToDaemon::GitCompare(req));
    let DaemonToServer::GitCompareResult { changes, error: None, .. } = r.next().await else { panic!() };
    assert_eq!(changes.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["lib.txt"]);
    let patch = r.diff_with(core, ("main", Some("dev"), None), None, None).await;
    assert!(patch.contains("-1\n\\ No newline at end of file\n+2"), "{patch}");

    let c = r.work_in(core).await.unwrap();
    assert_eq!(
        c.changes.iter().map(|c| (c.path.as_str(), c.add, c.del)).collect::<Vec<_>>(),
        [("lib.txt", Some(2), Some(1))]
    );
    let (ranges, _) = r.blame_in(core, None, "lib.txt").await.unwrap();
    assert_eq!(ranges.iter().map(|g| g.commit.is_empty()).collect::<Vec<_>>(), [true]);
    assert_eq!(r.stashes_in(core).await.len(), 1);
    assert!(r.conflict_in(core, "lib.txt", 100).await.unwrap_err().contains("lib.txt"));
    assert!(r.stashes_in(None).await.is_empty(), "the root has none");
    assert!(r.work_in(Some("../x")).await.is_err());
}

#[tokio::test]
async fn the_status_carries_head_ongoing_conflicts_and_stashes() {
    let mut r = rig();
    let w = r.work.clone();
    let (git, _) = r.refresh(false).await;
    assert_eq!((git.head, git.ongoing, git.conflicts, git.stashes), (Some(short(&w, "HEAD")), None, Some(0), Some(0)));
    write(&w, "README.md", "x\n");
    sh(&w, &["stash", "-q"]);
    let (git, _) = r.refresh(false).await;
    assert_eq!(git.stashes, Some(1));
    // A root that is no repo has none of them.
    let json =
        serde_json::to_value(GitStatus { head: None, ongoing: None, conflicts: None, stashes: None, ..git }).unwrap();
    assert!(json.get("head").is_none() && json.get("stashes").is_none(), "{json}");
}

#[tokio::test]
async fn new_actions_are_refused_while_a_turn_holds_the_directory() {
    let mut r = rig();
    sh(&r.work, &["branch", "other"]);
    r.send(ServerToDaemon::RunStart(Box::new(slow_run(&r, "r1", "mock:slow"))));
    loop {
        if let DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. } = r.next().await {
            break;
        }
    }
    let head = r.head();
    let req = GitAction { branch: Some("other".into()), identity: Some(bot()), ..r.action_req(GitActionKind::Merge) };
    r.send(ServerToDaemon::GitAction(Box::new(req)));
    let result = loop {
        if let msg @ DaemonToServer::GitActionResult { .. } = r.next().await {
            break msg;
        }
    };
    let DaemonToServer::GitActionResult { ok, busy, error, .. } = result else { unreachable!() };
    assert_eq!((ok, busy, error.as_deref()), (false, true, Some("工作目录正被运行占用")));
    assert_eq!(r.head(), head);
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
}

#[tokio::test]
async fn a_write_waits_out_another_git_holding_the_index() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "busy.txt", "x\n");
    // Another git (an IDE's status, the agent's own) holds the index for a moment.
    let lock = w.join(".git/index.lock");
    fs::write(&lock, "").unwrap();
    let release = tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        fs::remove_file(lock).unwrap();
    });
    let out = r
        .git(GitActionKind::Commit, |q| {
            q.message = Some("waited".into());
            q.paths = Some(vec!["busy.txt".into()]);
        })
        .await;
    release.await.unwrap();
    assert!(out.unwrap().contains("waited"));
    assert_eq!(subjects(&w, "-1"), ["waited"]);
}
