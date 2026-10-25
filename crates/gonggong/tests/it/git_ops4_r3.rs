//! The third IDEA round of gitOps4 driven through the Engine against temp clones of a local bare remote: pushing only
//! up to a commit of the branch, reset and amend refused once HEAD moved from the one expected, and a log narrowed to
//! a path whose commits stay linked in the graph.
use super::git_ops::{Rig, commit, rig, sh};
use super::git_ops3::{a, history, read, write};
use gonggong::protocol::*;
use std::collections::HashMap;
use std::process::Command;

fn push_up_to(branch: &str, commit: &str, target: Option<&str>, force: bool) -> impl FnOnce(&mut GitAction) {
    let (branch, commit, target) = (branch.to_string(), commit.to_string(), target.map(String::from));
    move |q| {
        q.branch = Some(branch);
        q.remote = Some("origin".into());
        q.args = Some(GitActionArgs { commit: Some(commit), target, force: Some(force), ..a() });
    }
}

fn reset(commit: &str, expect: &str) -> impl FnOnce(&mut GitAction) {
    let args =
        GitActionArgs { commit: Some(commit.into()), mode: Some("soft".into()), expect: Some(expect.into()), ..a() };
    move |q| q.args = Some(args)
}

/// An amend with `message`, of only the message when `paths` is [] and of every change when None.
fn amend(message: &str, paths: Option<Vec<String>>, expect: &str) -> impl FnOnce(&mut GitAction) {
    let (message, expect) = (message.to_string(), expect.to_string());
    move |q| {
        q.message = Some(message);
        q.paths = paths;
        q.args = Some(GitActionArgs { amend: Some(true), expect: Some(expect), ..a() });
    }
}

fn upstream(dir: &std::path::Path, branch: &str) -> Option<String> {
    let out = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")])
        .current_dir(dir)
        .output()
        .unwrap();
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

impl Rig {
    /// The page of commits git.log lists in work/`repo`.
    async fn commits(&mut self, repo: Option<&str>, skip: u32, limit: u32, filter: GitLogFilter) -> Vec<GitCommit> {
        self.send(ServerToDaemon::GitLog(GitLog {
            request_id: "q".into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: self.spec(),
            repo: repo.map(String::from),
            r#ref: None,
            skip,
            limit,
            filter: Some(filter),
        }));
        match self.next().await {
            DaemonToServer::GitLogResult { commits, error: None, .. } => commits,
            other => panic!("unexpected {other:?}"),
        }
    }
}

/// Each listed commit's subject with those of its parents, a parent not listed by its hash.
fn graph(commits: &[GitCommit]) -> HashMap<String, Vec<String>> {
    let subject: HashMap<&str, &str> = commits.iter().map(|c| (c.hash.as_str(), c.subject.as_str())).collect();
    commits
        .iter()
        .map(|c| {
            let parents = c.parents.iter().map(|p| subject.get(p.as_str()).map_or(p.clone(), |s| s.to_string()));
            (c.subject.clone(), parents.collect())
        })
        .collect()
}

fn edges(list: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
    list.iter().map(|(c, parents)| (c.to_string(), parents.iter().map(|p| p.to_string()).collect())).collect()
}

fn subjects(commits: &[GitCommit]) -> Vec<&str> {
    commits.iter().map(|c| c.subject.as_str()).collect()
}

#[tokio::test]
async fn a_push_goes_only_up_to_the_commit_given_and_sets_the_upstream() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "t1.txt", "1\n", "one");
    let one = r.head();
    commit(&w, "t2.txt", "2\n", "two");
    let two = r.head();
    commit(&w, "t3.txt", "3\n", "three");

    // Tracking nothing: to the same name, which it tracks from then on, the commits after it left to push.
    let output = r.git(GitActionKind::Push, push_up_to("topic", &one[..8], None, false)).await.unwrap();
    assert!(output.starts_with("origin/topic "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic"]), one);
    assert_eq!(upstream(&w, "topic").as_deref(), Some("origin/topic"));
    assert_eq!(sh(&w, &["rev-list", "--count", "topic@{upstream}..topic"]), "2");
    r.git(GitActionKind::Push, push_up_to("topic", &two, None, false)).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic"]), two);

    // Tracking a branch of another name: there, the upstream left as it is, also by a target of its own.
    sh(&w, &["switch", "-q", "-c", "feat2", "--track", "origin/feat"]);
    commit(&w, "f1.txt", "f1\n", "f1");
    let f1 = r.head();
    commit(&w, "f2.txt", "f2\n", "f2");
    let output = r.git(GitActionKind::Push, push_up_to("feat2", &f1, None, false)).await.unwrap();
    assert!(output.starts_with("origin/feat "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/feat"]), f1);
    r.git(GitActionKind::Push, push_up_to("feat2", &f1, Some("feat-copy"), false)).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/feat-copy"]), f1);
    assert_eq!(sh(&r.remote, &["branch", "--list", "feat2"]), "");
    assert_eq!(upstream(&w, "feat2").as_deref(), Some("origin/feat"));

    // A target given while tracking nothing: there, then tracked.
    sh(&w, &["switch", "-q", "-c", "side", "main"]);
    commit(&w, "s.txt", "s\n", "side");
    let side = r.head();
    commit(&w, "s.txt", "s2\n", "side 2");
    let output = r.git(GitActionKind::Push, push_up_to("side", &side, Some("side-v2"), false)).await.unwrap();
    assert!(output.starts_with("origin/side-v2 "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/side-v2"]), side);
    assert_eq!(sh(&r.remote, &["branch", "--list", "side"]), "");
    assert_eq!(upstream(&w, "side").as_deref(), Some("origin/side-v2"));
}

#[tokio::test]
async fn a_commit_not_on_the_branch_pushes_nothing() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "m.txt", "m\n", "main only");
    let main = r.head();
    sh(&w, &["switch", "-q", "-c", "topic", "HEAD~1"]);
    commit(&w, "t.txt", "t\n", "topic work");
    let remote = r.remote.clone();
    let heads = || sh(&remote, &["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
    let before = heads();

    let error = r.git(GitActionKind::Push, push_up_to("topic", &main, None, false)).await.unwrap_err();
    assert_eq!(error, "该提交不在分支 topic 上");
    let error = r.git(GitActionKind::Push, push_up_to("topic", "0123abcd", None, false)).await.unwrap_err();
    assert_eq!(error, "提交不存在：0123abcd");
    // Never a refspec: no force, nor a second ref, rides along.
    let head = r.head();
    for commit in [format!("+{head}"), format!("{head}:refs/heads/main"), format!("{head} main")] {
        let error = r.git(GitActionKind::Push, push_up_to("topic", &commit, None, true)).await.unwrap_err();
        assert_eq!(error, format!("提交不存在：{commit}"));
    }
    let error = r.git(GitActionKind::Push, push_up_to("topic", "-f", None, false)).await.unwrap_err();
    assert_eq!(error, "无效的名称：-f");
    assert_eq!(heads(), before);
    assert_eq!(upstream(&w, "topic"), None);

    // Commits it shares with another branch are its own too.
    let base = sh(&w, &["rev-parse", "HEAD~1"]);
    r.git(GitActionKind::Push, push_up_to("topic", &base, Some("topic-base"), false)).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic-base"]), base);
}

#[tokio::test]
async fn a_forced_push_up_to_a_commit_leases_the_one_ref_it_pushes() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "t.txt", "t1\n", "topic 1");
    commit(&w, "t.txt", "t2\n", "topic 2");
    r.git(GitActionKind::Push, push_up_to("topic", &r.head(), None, false)).await.unwrap();

    // History rewritten: only up to the rewritten commit, which takes a force.
    sh(&w, &["reset", "-q", "--hard", "HEAD~2"]);
    commit(&w, "t.txt", "t1 again\n", "topic 1 again");
    let again = r.head();
    commit(&w, "t.txt", "t2 again\n", "topic 2 again");
    let error = r.git(GitActionKind::Push, push_up_to("topic", &again, None, false)).await.unwrap_err();
    assert!(error.starts_with("origin/topic ") && error.contains("rejected"), "{error}");
    let main = sh(&r.remote, &["rev-parse", "refs/heads/main"]);
    let output = r.git(GitActionKind::Push, push_up_to("topic", &again, None, true)).await.unwrap();
    assert!(output.starts_with("origin/topic "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic"]), again);
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/main"]), main);

    // Someone else pushed meanwhile: the lease holds, theirs stays.
    sh(&r.other, &["fetch", "-q"]);
    sh(&r.other, &["switch", "-q", "topic"]);
    commit(&r.other, "o.txt", "o\n", "theirs");
    sh(&r.other, &["push", "-q", "origin", "topic"]);
    let error = r.git(GitActionKind::Push, push_up_to("topic", &r.head(), None, true)).await.unwrap_err();
    assert!(error.contains("stale info"), "{error}");
    assert_eq!(sh(&r.remote, &["log", "-1", "--format=%s", "topic"]), "theirs");
}

#[tokio::test]
async fn reset_and_amend_run_only_while_head_is_the_one_expected() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "README.md", "hello\nc1\n", "c1");
    let c1 = r.head();
    commit(&w, "README.md", "hello\nc2\n", "c2");
    let c2 = r.head();
    let moved = format!("HEAD 已变化（现在是 {}），请刷新后重试", sh(&w, &["rev-parse", "--short", "HEAD"]));

    // An Undo Commit or a reword of c1 approved after c2 landed on it: refused, nothing moves.
    for expect in [&c1[..], &c1[..8], ""] {
        let error = r.git(GitActionKind::Reset, reset("HEAD~1", expect)).await.unwrap_err();
        assert_eq!(error, moved, "{expect}");
    }
    let only = amend("c1 reworded", Some(vec![]), &c1);
    assert_eq!(r.git(GitActionKind::Commit, only).await.unwrap_err(), moved);
    write(&w, "src/a.txt", "changed\n");
    assert_eq!(r.git(GitActionKind::Commit, amend("c1 with a", None, &c1[..7])).await.unwrap_err(), moved);
    assert_eq!(
        (r.head(), sh(&w, &["log", "-1", "--format=%s"]), sh(&w, &["status", "--porcelain"])),
        (c2.clone(), "c2".into(), "M src/a.txt".into()),
        "nothing committed nor staged"
    );

    // HEAD as expected, in full or abbreviated.
    let output = r.git(GitActionKind::Commit, amend("c2 with a", None, &c2[..8])).await.unwrap();
    assert!(output.ends_with("c2 with a"), "{output}");
    let amended = r.head();
    assert_ne!(amended, c2);
    assert_eq!((read(&w, "src/a.txt").as_deref(), sh(&w, &["status", "--porcelain"])), (Some("changed\n"), "".into()));
    r.git(GitActionKind::Commit, amend("c2 reworded", Some(vec![]), &amended)).await.unwrap();
    assert_eq!(sh(&w, &["log", "-1", "--format=%s"]), "c2 reworded");
    let reworded = r.head();
    r.git(GitActionKind::Reset, reset("HEAD~1", &reworded[..10])).await.unwrap();
    assert_eq!((r.head(), sh(&w, &["status", "--porcelain"])), (c1, "M  README.md\nM  src/a.txt".to_string()));
}

#[tokio::test]
async fn a_log_narrowed_to_a_path_links_the_commits_it_lists() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "src/a.txt", "src one\n", "src one");
    commit(&w, "README.md", "readme one\n", "readme one");
    sh(&w, &["switch", "-q", "-c", "side"]);
    commit(&w, "src/s.txt", "side\n", "side src");
    commit(&w, "docs/old.md", "side docs\n", "side docs");
    sh(&w, &["switch", "-q", "main"]);
    commit(&w, "src/a.txt", "src two\n", "src two");
    commit(&w, "README.md", "readme two\n", "readme two");
    sh(&w, &["merge", "-q", "--no-ff", "-m", "merge side", "side"]);

    let src = r.commits(None, 0, 50, GitLogFilter { path: Some("src".into()), ..GitLogFilter::default() }).await;
    let linked = edges(&[
        ("merge side", &["src two", "side src"]),
        ("src two", &["src one"]),
        ("side src", &["src one"]),
        ("src one", &["init"]),
        ("init", &[]),
    ]);
    assert_eq!(graph(&src), linked);

    // Other filters leave the parents as they are.
    let text = r.commits(None, 0, 50, GitLogFilter { text: Some("src".into()), ..GitLogFilter::default() }).await;
    assert_eq!(text.len(), 3);
    assert_eq!(graph(&text)["src two"], [sh(&w, &["rev-parse", "HEAD~3"])]);

    // A file's history goes on past its renames, its commits linked across them, page after page.
    history(&r);
    let file = GitLogFilter { path: Some("g1.txt".into()), ..GitLogFilter::default() };
    let all = r.commits(Some("hist"), 0, 50, file.clone()).await;
    assert_eq!(subjects(&all), ["edit g1", "other work", "fix refund bug"]);
    let linked = edges(&[("edit g1", &["other work"]), ("other work", &["fix refund bug"]), ("fix refund bug", &[])]);
    assert_eq!(graph(&all), linked);
    for skip in 0..3 {
        let page = r.commits(Some("hist"), skip, 1, file.clone()).await;
        assert_eq!(page, all[skip as usize..=skip as usize], "{skip}");
    }
}
