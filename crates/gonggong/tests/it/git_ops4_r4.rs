//! The fourth IDEA round of gitOps4 driven through the Engine against temp clones of a local bare remote: interactive
//! rebase, several conflicts taking one side, a commit's changes to some files applied or undone, files got from a
//! revision, conflicts read with zdiff3 (and from an empty base when both sides added), and what a stopped merge names.
use super::git_ops::{Rig, commit, rig, sh};
use super::git_ops3::{a, read, write};
use gonggong::protocol::*;
use std::path::Path;

fn subjects(dir: &Path, range: &str) -> Vec<String> {
    sh(dir, &["log", "--format=%s", range]).lines().map(String::from).collect()
}

fn step(action: GitRebaseAction, commit: &str, message: Option<&str>) -> GitRebaseStep {
    GitRebaseStep { action, commit: commit.into(), message: message.map(String::from) }
}

fn rebase(onto: &str, todo: Vec<GitRebaseStep>) -> impl FnOnce(&mut GitAction) {
    let args = GitActionArgs { onto: Some(onto.into()), todo: Some(todo), ..a() };
    move |q| q.args = Some(args)
}

fn resolve(path: &str, paths: &[&str], side: GitConflictPick) -> impl FnOnce(&mut GitAction) {
    let args = GitActionArgs { path: Some(path.into()), side: Some(side), ..a() };
    let paths = paths.iter().map(|p| p.to_string()).collect();
    move |q| {
        q.paths = Some(paths);
        q.args = Some(args)
    }
}

fn on(commit: &str, paths: &[&str], reverse: Option<bool>) -> impl FnOnce(&mut GitAction) {
    let args = GitActionArgs { commit: Some(commit.into()), reverse, ..a() };
    let paths = paths.iter().map(|p| p.to_string()).collect();
    move |q| {
        q.paths = Some(paths);
        q.args = Some(args)
    }
}

/// topic off main with commits one…five (each adding `<n>.txt`); their hashes, oldest first.
fn topic(w: &Path) -> Vec<String> {
    sh(w, &["switch", "-q", "-c", "topic"]);
    ["one", "two", "three", "four", "five"]
        .iter()
        .map(|n| {
            commit(w, &format!("{n}.txt"), &format!("{n}\n"), n);
            sh(w, &["rev-parse", "HEAD"])
        })
        .collect()
}

#[tokio::test]
async fn an_interactive_rebase_reorders_rewords_squashes_fixes_up_and_drops() {
    let mut r = rig();
    let w = r.work.clone();
    let main = r.head();
    let c = topic(&w);
    write(&w, "README.md", "hello\nlocal\n");
    use GitRebaseAction as A;
    let todo = vec![
        step(A::Pick, &c[2], None),
        step(A::Reword, &c[0][..7], Some("第一\n\n正文")),
        step(A::Squash, &c[1], Some("一和二")),
        step(A::Fixup, &c[3], None),
        step(A::Drop, &c[4], None),
    ];
    let output = r.git(GitActionKind::Rebase, rebase("main", todo)).await.unwrap();
    assert!(output.starts_with("[topic ") && output.ends_with("一和二"), "{output}");
    assert_eq!(subjects(&w, "main..topic"), ["一和二", "three"]);
    assert_eq!(sh(&w, &["rev-parse", "topic~2"]), main);
    assert_eq!(sh(&w, &["log", "-1", "--format=%B", "topic"]), "一和二");
    assert_eq!(sh(&w, &["log", "-1", "--format=%cn", "topic"]), "共字君");
    let files = sh(&w, &["show", "--format=", "--name-only", "topic"]);
    assert_eq!(files.lines().collect::<Vec<_>>(), ["four.txt", "one.txt", "two.txt"]);
    assert!(!w.join("five.txt").exists());
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\nlocal\n"), "changes stashed around it");
    assert!(r.work().await.ongoing.is_none());

    // A squash without a message keeps both; only rewording goes the same way.
    let c: Vec<String> = sh(&w, &["rev-list", "--reverse", "main..topic"]).lines().map(String::from).collect();
    let todo = vec![step(A::Pick, &c[0], None), step(A::Squash, &c[1], None)];
    r.git(GitActionKind::Rebase, rebase(&main, todo)).await.unwrap();
    let body = sh(&w, &["log", "-1", "--format=%B", "topic"]);
    assert!(body.contains("three") && body.contains("一和二") && !body.contains('#'), "{body}");
    let c = sh(&w, &["rev-parse", "topic"]);
    r.git(GitActionKind::Rebase, rebase(&main, vec![step(A::Reword, &c, Some("合起来"))])).await.unwrap();
    assert_eq!(subjects(&w, "main..topic"), ["合起来"]);
}

#[tokio::test]
async fn an_interactive_rebase_is_refused_unless_it_lists_each_commit_once() {
    let mut r = rig();
    let w = r.work.clone();
    let c = topic(&w);
    use GitRebaseAction as A;
    let picks = |ids: &[usize]| ids.iter().map(|i| step(A::Pick, &c[*i], None)).collect::<Vec<_>>();
    let mut first_fixup = picks(&[0, 1, 2, 3, 4]);
    first_fixup[0].action = A::Fixup;
    let mut no_message = picks(&[0, 1, 2, 3, 4]);
    no_message[1].action = A::Reword;
    let refused = [
        (picks(&[0, 1, 2, 3]), "缺少"),
        (picks(&[0, 1, 2, 3, 4, 4]), "重复"),
        ([picks(&[0, 1, 2, 3, 4]), vec![step(A::Pick, "abcdef1", None)]].concat(), "abcdef1"),
        (first_fixup, "第一个"),
        (no_message, "说明"),
    ];
    for (todo, why) in refused {
        let error = r.git(GitActionKind::Rebase, rebase("main", todo)).await.unwrap_err();
        assert!(error.contains(why), "{why}: {error}");
    }
    let other = r.git(GitActionKind::Rebase, |q| {
        rebase("main", picks(&[0, 1, 2, 3, 4]))(q);
        q.branch = Some("main".into());
    });
    assert!(other.await.unwrap_err().contains("当前分支"));

    sh(&w, &["switch", "-q", "-c", "side", "main"]);
    commit(&w, "side.txt", "side\n", "side");
    sh(&w, &["switch", "-q", "topic"]);
    sh(&w, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let merge = r.head();
    let all = sh(&w, &["rev-list", "--reverse", "main..topic"]);
    let todo = all.lines().map(|h| step(A::Pick, h, None)).collect();
    let error = r.git(GitActionKind::Rebase, rebase("main", todo)).await.unwrap_err();
    assert!(error.contains("合并提交"), "{error}");
    assert_eq!(r.head(), merge);
    assert!(r.work().await.ongoing.is_none());
}

#[tokio::test]
async fn an_interactive_rebase_stops_on_conflicts_and_rewords_once_they_are_resolved() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "src/a.txt", "b\n", "to b");
    let b = r.head();
    commit(&w, "src/a.txt", "c\n", "to c");
    let c = r.head();
    use GitRebaseAction as A;
    let todo = vec![step(A::Drop, &b, None), step(A::Reword, &c, Some("只要 c"))];
    let error = r.git(GitActionKind::Rebase, rebase("main", todo)).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：src/a.txt");
    assert_eq!(
        r.detail.as_ref().map(|d| (d.code, d.paths.clone())),
        Some((Some(GitActionCode::Conflicts), vec!["src/a.txt".into()]))
    );
    assert_eq!(r.work().await.ongoing.map(|o| o.kind), Some(GitOngoingKind::Rebase));

    let args = GitActionArgs { path: Some("src/a.txt".into()), content: Some("c\n".into()), ..a() };
    r.git(GitActionKind::Resolve, |q| q.args = Some(args)).await.unwrap();
    r.git(GitActionKind::Continue, |_| {}).await.unwrap();
    assert_eq!(subjects(&w, "main..topic"), ["只要 c"]);
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("c\n"));
    assert!(r.work().await.ongoing.is_none());
    assert_eq!(sh(&w, &["status", "--porcelain"]), "");
}

/// main and feat/x each changing README.md, src/a.txt and both.txt; merged into main, which stops on all three.
async fn three_conflicts(r: &mut Rig) {
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "feat/x"]);
    for f in ["README.md", "src/a.txt", "both.txt"] {
        write(&w, f, "feat\n");
    }
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "feat"]);
    sh(&w, &["switch", "-q", "main"]);
    for f in ["README.md", "src/a.txt", "both.txt"] {
        write(&w, f, "main\n");
    }
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "main"]);
    r.git(GitActionKind::Merge, |q| q.branch = Some("feat/x".into())).await.unwrap_err();
}

#[tokio::test]
async fn several_conflicts_take_one_side_at_once_or_none_does() {
    let mut r = rig();
    let w = r.work.clone();
    three_conflicts(&mut r).await;
    use GitConflictPick as P;
    let error = r.git(GitActionKind::Resolve, resolve("README.md", &["src/a.txt", "logo.png"], P::Theirs)).await;
    assert!(error.unwrap_err().contains("logo.png"));
    assert_eq!(r.work().await.conflicts.len(), 3, "none resolved");

    let done = r.git(GitActionKind::Resolve, resolve("README.md", &["README.md", "src/a.txt"], P::Theirs)).await;
    assert_eq!(done.unwrap(), "已解决 2 个文件");
    let left: Vec<_> = r.work().await.conflicts.into_iter().map(|c| c.path).collect();
    assert_eq!(left, ["both.txt"]);
    assert_eq!((read(&w, "README.md").as_deref(), read(&w, "src/a.txt").as_deref()), (Some("feat\n"), Some("feat\n")));
    assert_eq!(read(&w, "both.txt").as_deref(), Some("<<<<<<< HEAD\nmain\n=======\nfeat\n>>>>>>> feat/x\n"));
}

#[tokio::test]
async fn a_commits_changes_to_chosen_files_are_applied_or_undone_uncommitted() {
    let mut r = rig();
    let w = r.work.clone();
    let main = r.head();
    sh(&w, &["switch", "-q", "-c", "feat/x"]);
    write(&w, "src/a.txt", "a1\nfeat\n");
    write(&w, "src/b.txt", "b\n");
    write(&w, "src/new.txt", "new\n");
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "feat"]);
    let feat = r.head();
    sh(&w, &["switch", "-q", "main"]);

    let out = r.git(GitActionKind::Apply, on(&feat, &["src/a.txt", "src/new.txt"], None)).await.unwrap();
    assert!(out.contains("2"), "{out}");
    assert_eq!(r.head(), main, "nothing committed");
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a1\nfeat\n"));
    assert_eq!(read(&w, "src/new.txt").as_deref(), Some("new\n"));
    assert!(!w.join("src/b.txt").exists());
    assert!(r.work().await.conflicts.is_empty());

    // Undone: back as they were.
    r.git(GitActionKind::Apply, on(&feat, &["src/a.txt", "src/new.txt"], Some(true))).await.unwrap();
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a1\n"));
    assert!(!w.join("src/new.txt").exists());
    // The root commit's change: undone, it removes the file.
    r.git(GitActionKind::Apply, on(&main, &["README.md"], Some(true))).await.unwrap();
    assert!(!w.join("README.md").exists());
    sh(&w, &["checkout", "HEAD", "--", "README.md"]);
    let none = r.git(GitActionKind::Apply, on(&feat, &["README.md"], None)).await.unwrap_err();
    assert!(none.contains("没有改动"), "{none}");

    // On top of a file's unstaged changes.
    write(&w, "src/a.txt", "a0\na1\n");
    r.git(GitActionKind::Apply, on(&feat, &["src/a.txt"], None)).await.unwrap();
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a0\na1\nfeat\n"));
    sh(&w, &["checkout", "HEAD", "--", "src/a.txt"]);

    // A clash is left as markers.
    write(&w, "src/a.txt", "a1\nmain\n");
    sh(&w, &["commit", "-q", "-am", "main a"]);
    let error = r.git(GitActionKind::Apply, on(&feat, &["src/a.txt"], None)).await.unwrap_err();
    assert_eq!(error, "有 1 个冲突待解决：src/a.txt");
    assert_eq!(r.detail.as_ref().map(|d| d.paths.clone()), Some(vec!["src/a.txt".into()]));
    let text = read(&w, "src/a.txt").unwrap();
    assert!(text.contains("<<<<<<<") && text.contains("main") && text.contains("feat"), "{text}");
}

#[tokio::test]
async fn files_are_got_from_a_revision_deleted_when_absent_there() {
    let mut r = rig();
    let w = r.work.clone();
    let init = r.head();
    commit(&w, "README.md", "changed\n", "change");
    commit(&w, "added.txt", "added\n", "add");
    write(&w, "untracked.txt", "u\n");
    write(&w, "src/a.txt", "dirty\n");
    let head = r.head();
    let paths = ["README.md", "added.txt", "untracked.txt", "src/a.txt"];
    let out = r.git(GitActionKind::Restore, on(&init[..7], &paths, None)).await.unwrap();
    assert!(out.contains(&init[..7]), "{out}");
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\n"));
    assert_eq!(read(&w, "src/a.txt").as_deref(), Some("a1\n"));
    assert!(!w.join("added.txt").exists() && !w.join("untracked.txt").exists());
    assert_eq!(r.head(), head, "HEAD stays");

    for bad in ["../x", "/etc/hosts"] {
        assert!(r.git(GitActionKind::Restore, on(&init, &[bad], None)).await.unwrap_err().contains("超出"), "{bad}");
    }
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.txt"), "keep\n").unwrap();
        std::os::unix::fs::symlink(outside.path(), w.join("link")).unwrap();
        let error = r.git(GitActionKind::Restore, on(&init, &["link/keep.txt"], None)).await.unwrap_err();
        assert!(error.contains("link/keep.txt"), "{error}");
        assert!(outside.path().join("keep.txt").exists());
    }
}

#[tokio::test]
async fn conflicts_are_read_with_zdiff3_and_both_added_from_an_empty_base() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "feat/x"]);
    commit(&w, "README.md", "same\nfeat\nend\n", "feat");
    write(&w, "both.txt", "shared\nfeat side\n");
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "feat both"]);
    sh(&w, &["switch", "-q", "main"]);
    commit(&w, "README.md", "same\nmain\nend\n", "main");
    write(&w, "both.txt", "shared\nmain side\n");
    sh(&w, &["add", "-A"]);
    sh(&w, &["commit", "-q", "-m", "main both"]);
    r.git(GitActionKind::Merge, |q| q.branch = Some("feat/x".into())).await.unwrap_err();

    let readme = r.conflict("README.md").await.unwrap();
    assert_eq!(
        readme.merged.as_deref(),
        Some("same\n<<<<<<< ours\nmain\n||||||| base\nhello\n=======\nfeat\n>>>>>>> theirs\nend\n")
    );
    let both = r.conflict("both.txt").await.unwrap();
    assert_eq!(
        (both.base, both.merged.as_deref()),
        (None, Some("shared\n<<<<<<< ours\nmain side\n||||||| base\n=======\nfeat side\n>>>>>>> theirs\n"))
    );
}

#[tokio::test]
async fn a_stopped_merge_is_named_by_the_ref_it_merges() {
    let mut r = rig();
    let (w, o) = (r.work.clone(), r.other.clone());
    commit(&o, "README.md", "theirs\n", "theirs");
    sh(&o, &["push", "-q", "origin", "main"]);
    commit(&w, "README.md", "ours\n", "ours");
    let pull = GitActionArgs { mode: Some("merge".into()), ..a() };
    r.git(GitActionKind::Pull, |q| q.args = Some(pull)).await.unwrap_err();
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!((ongoing.kind, ongoing.subject.as_deref()), (GitOngoingKind::Merge, Some("origin/main")));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();

    // A commit no ref points at: its short hash.
    sh(&w, &["switch", "-q", "-c", "gone", "HEAD~1"]);
    commit(&w, "README.md", "gone\n", "gone");
    let gone = sh(&w, &["rev-parse", "--short", "HEAD"]);
    sh(&w, &["switch", "-q", "main"]);
    sh(&w, &["branch", "-q", "-D", "gone"]);
    r.git(GitActionKind::Merge, |q| q.branch = Some(gone.clone())).await.unwrap_err();
    assert_eq!(r.work().await.ongoing.and_then(|o| o.subject), Some(gone));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();

    // A squash merge's conflicts: a merge of that branch too, aborted as one.
    sh(&w, &["switch", "-q", "-c", "feat/sq", "HEAD~1"]);
    commit(&w, "README.md", "squashed\n", "sq");
    sh(&w, &["switch", "-q", "main"]);
    let squash = GitActionArgs { mode: Some("squash".into()), ..a() };
    let error = r.git(GitActionKind::Merge, |q| {
        q.branch = Some("feat/sq".into());
        q.args = Some(squash);
    });
    assert!(error.await.unwrap_err().contains("README.md"));
    let ongoing = r.work().await.ongoing.unwrap();
    assert_eq!((ongoing.kind, ongoing.subject.as_deref()), (GitOngoingKind::Merge, Some("feat/sq")));
    r.git(GitActionKind::Abort, |_| {}).await.unwrap();
    assert_eq!(read(&w, "README.md").as_deref(), Some("ours\n"));
    assert!(r.work().await.ongoing.is_none());
}
