//! The second IDEA pass (gitOps4) driven through the Engine against temp clones of a local bare remote: pushes as
//! explicit refs to a chosen remote branch, remote tags and branches named alike, stash `expect`, discard
//! `keepAdded`, and the add / ignore actions.
use super::git_ops::{commit, rig, sh};
use super::git_ops3::{a, read, write};
use gonggong::protocol::*;
use std::fs;
use std::path::Path;
use std::process::Command;

fn push(branch: &str, target: Option<&str>, force: bool) -> impl FnOnce(&mut GitAction) {
    let (branch, target) = (branch.to_string(), target.map(String::from));
    move |q| {
        q.branch = Some(branch);
        q.remote = Some("origin".into());
        q.args = Some(GitActionArgs { target, force: Some(force), ..a() });
    }
}

fn paths(list: &[&str]) -> Option<Vec<String>> {
    Some(list.iter().map(|p| p.to_string()).collect())
}

/// Untracked files git doesn't ignore, as git lists them (some names here start or end with a space).
fn unignored(dir: &Path) -> Vec<String> {
    let out = Command::new("git").args(["ls-files", "-z", "--others", "--exclude-standard"]).current_dir(dir).output();
    let out = out.unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap().split('\0').filter(|p| !p.is_empty()).map(String::from).collect()
}

#[tokio::test]
async fn pushes_go_to_the_target_else_the_upstream_branch_as_explicit_refs() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "t.txt", "t\n", "topic work");
    let output = r.git(GitActionKind::Push, push("topic", Some("topic-v2"), false)).await.unwrap();
    assert!(output.starts_with("origin/topic-v2 "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic-v2"]), r.head());
    assert_eq!(sh(&r.remote, &["branch", "--list", "topic"]), "", "nothing under its own name");
    assert_eq!(sh(&w, &["rev-parse", "--abbrev-ref", "topic@{upstream}"]), "origin/topic-v2", "tracks the target");

    // Tracked now: without a target it goes to the upstream's branch.
    commit(&w, "t.txt", "t\nmore\n", "more");
    let output = r.git(GitActionKind::Push, push("topic", None, false)).await.unwrap();
    assert!(output.starts_with("origin/topic-v2 "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic-v2"]), r.head());
    assert_eq!(sh(&r.remote, &["branch", "--list", "topic"]), "");

    // A target of its own leaves the upstream alone.
    r.git(GitActionKind::Push, push("topic", Some("topic-copy"), false)).await.unwrap();
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/topic-copy"]), r.head());
    assert_eq!(sh(&w, &["rev-parse", "--abbrev-ref", "topic@{upstream}"]), "origin/topic-v2");

    // An upstream on another remote: the same name on this one, the upstream kept.
    sh(&w, &["remote", "add", "mirror", r.remote.to_str().unwrap()]);
    sh(&w, &["fetch", "-q", "mirror"]);
    sh(&w, &["switch", "-q", "-c", "side", "--track", "mirror/feat"]);
    commit(&w, "s.txt", "s\n", "side work");
    let output = r.git(GitActionKind::Push, push("side", None, false)).await.unwrap();
    assert!(output.starts_with("origin/side "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/side"]), r.head());
    assert_eq!(sh(&w, &["rev-parse", "--abbrev-ref", "side@{upstream}"]), "mirror/feat");
    assert_ne!(sh(&r.remote, &["rev-parse", "refs/heads/feat"]), r.head());
}

#[tokio::test]
async fn names_a_refspec_would_read_as_more_push_nothing() {
    let mut r = rig();
    let w = r.work.clone();
    commit(&w, "mine.txt", "m\n", "mine");
    sh(&w, &["switch", "-q", "-c", "feat2"]);
    commit(&w, "f.txt", "f\n", "feat2 work");
    sh(&w, &["switch", "-q", "main"]);
    let (main, feat) = (sh(&r.remote, &["rev-parse", "main"]), sh(&r.remote, &["rev-parse", "feat"]));
    // HEAD is no local branch: never the current one (main, ahead of the remote's).
    for branch in ["HEAD", "+feat2:main", "feat2:main", ":main"] {
        let error = r.git(GitActionKind::Push, push(branch, None, true)).await.unwrap_err();
        assert_eq!(error, format!("分支不存在：{branch}"));
    }
    for target in [":main", "HEAD", "a..b", "-f", "main:feat", "refs/heads/main:x"] {
        let error = r.git(GitActionKind::Push, push("feat2", Some(target), true)).await.unwrap_err();
        assert_eq!(error, format!("无效的名称：{target}"));
    }
    assert_eq!((sh(&r.remote, &["rev-parse", "main"]), sh(&r.remote, &["rev-parse", "feat"])), (main, feat));
    let heads = sh(&r.remote, &["for-each-ref", "--format=%(refname)", "refs/heads"]);
    assert_eq!(heads, "refs/heads/feat\nrefs/heads/main");
}

#[tokio::test]
async fn a_forced_push_leases_the_one_ref_it_pushes() {
    let mut r = rig();
    let w = r.work.clone();
    sh(&w, &["switch", "-q", "-c", "topic"]);
    commit(&w, "t.txt", "t\n", "topic v1");
    r.git(GitActionKind::Push, push("topic", None, false)).await.unwrap();
    // Configured to push every branch: an explicit ref still pushes that one alone.
    sh(&w, &["config", "remote.origin.push", "refs/heads/*:refs/heads/*"]);
    sh(&w, &["config", "push.default", "matching"]);
    sh(&w, &["switch", "-q", "main"]);
    commit(&w, "local.txt", "l\n", "main, local only");
    sh(&w, &["switch", "-q", "topic"]);
    sh(&w, &["commit", "-q", "--amend", "-m", "topic v2"]);
    let main = sh(&r.remote, &["rev-parse", "main"]);
    let output = r.git(GitActionKind::Push, push("topic", None, true)).await.unwrap();
    assert!(output.starts_with("origin/topic "), "{output}");
    assert_eq!(sh(&r.remote, &["log", "-1", "--format=%s", "topic"]), "topic v2");
    assert_eq!(sh(&r.remote, &["rev-parse", "main"]), main);

    // Someone else pushed meanwhile: the lease holds, theirs stays.
    sh(&r.other, &["fetch", "-q"]);
    sh(&r.other, &["switch", "-q", "topic"]);
    commit(&r.other, "o.txt", "o\n", "theirs");
    sh(&r.other, &["push", "-q", "origin", "topic"]);
    sh(&w, &["commit", "-q", "--amend", "-m", "topic v3"]);
    let error = r.git(GitActionKind::Push, push("topic", None, true)).await.unwrap_err();
    assert!(error.contains("stale info"), "{error}");
    assert_eq!(sh(&r.remote, &["log", "-1", "--format=%s", "topic"]), "theirs");

    // The lease is the target's: feat moved on the remote since this clone last saw it.
    commit(&r.other, "f.txt", "f\n", "feat moved");
    sh(&r.other, &["push", "-q", "-f", "origin", "topic:feat"]);
    let error = r.git(GitActionKind::Push, push("topic", Some("feat"), true)).await.unwrap_err();
    assert!(error.contains("stale info"), "{error}");
    assert_eq!(sh(&r.remote, &["log", "-1", "--format=%s", "feat"]), "feat moved");
    sh(&w, &["fetch", "-q"]);
    let output = r.git(GitActionKind::Push, push("topic", Some("feat"), true)).await.unwrap();
    assert!(output.starts_with("origin/feat "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "feat"]), r.head());
}

#[tokio::test]
async fn tags_and_branches_named_alike_stay_apart_on_the_remote() {
    let mut r = rig();
    let w = r.work.clone();
    let feat = sh(&r.remote, &["rev-parse", "refs/heads/feat"]);
    sh(&w, &["tag", "feat"]);
    let tag = |remote: Option<&str>| {
        let remote = remote.map(String::from);
        move |q: &mut GitAction| {
            q.remote = remote;
            q.args = Some(GitActionArgs { name: Some("feat".into()), ..a() });
        }
    };
    let output = r.git(GitActionKind::TagPush, tag(Some("origin"))).await.unwrap();
    assert!(output.starts_with("origin/feat "), "{output}");
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/tags/feat"]), r.head());
    assert_eq!(sh(&r.remote, &["rev-parse", "refs/heads/feat"]), feat);

    // Updating another branch fetches its upstream's branch, not the tag of that name.
    sh(&w, &["branch", "feat", "origin/feat"]);
    sh(&w, &["config", "branch.feat.merge", "feat"]);
    sh(&r.other, &["switch", "-q", "-c", "feat2", "origin/feat"]);
    commit(&r.other, "more.txt", "m\n", "feat more");
    sh(&r.other, &["push", "-q", "origin", "HEAD:refs/heads/feat"]);
    let pull = |q: &mut GitAction| q.branch = Some("feat".into());
    r.git(GitActionKind::Pull, pull).await.unwrap();
    assert_eq!(sh(&w, &["rev-parse", "refs/heads/feat"]), sh(&r.remote, &["rev-parse", "refs/heads/feat"]));

    let both = ["for-each-ref", "--format=%(refname)", "refs/heads/feat", "refs/tags/feat"];
    let delete = |q: &mut GitAction| q.branch = Some("origin/feat".into());
    let output = r.git(GitActionKind::BranchDelete, delete).await.unwrap();
    assert!(output.starts_with("origin/feat "), "{output}");
    assert_eq!(sh(&r.remote, &both), "refs/tags/feat");

    sh(&r.other, &["push", "-q", "origin", "HEAD:refs/heads/feat"]);
    r.git(GitActionKind::TagDelete, tag(Some("origin"))).await.unwrap();
    assert_eq!(sh(&r.remote, &both), "refs/heads/feat");
    assert_eq!(sh(&w, &["tag", "--list", "feat"]), "");
}

#[tokio::test]
async fn a_stash_is_restored_or_dropped_only_while_it_is_the_one_expected() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "README.md", "hello\none\n");
    sh(&w, &["stash", "push", "-q", "-m", "one"]);
    write(&w, "src/a.txt", "a1\ntwo\n");
    sh(&w, &["stash", "push", "-q", "-m", "two"]);
    let (two, one) = (sh(&w, &["rev-parse", "stash@{0}"]), sh(&w, &["rev-parse", "stash@{1}"]));
    let stash = |n: Option<u32>, expect: Option<&str>, pop: bool| {
        let expect = expect.map(String::from);
        move |q: &mut GitAction| q.args = Some(GitActionArgs { stash: n, expect, pop: Some(pop), ..a() })
    };
    let moved = "贮藏列表已变化，请刷新后重试";
    for (n, expect) in [(1, &two[..7]), (0, &one[..]), (5, &two[..])] {
        assert_eq!(r.git(GitActionKind::Unstash, stash(Some(n), Some(expect), false)).await.unwrap_err(), moved);
        assert_eq!(r.git(GitActionKind::StashDrop, stash(Some(n), Some(expect), false)).await.unwrap_err(), moved);
    }
    assert_eq!(sh(&w, &["status", "--porcelain"]), "", "nothing applied");
    // A guard naming one stash never clears them all.
    assert_eq!(
        r.git(GitActionKind::StashDrop, stash(None, Some(&two), false)).await.unwrap_err(),
        "缺少参数：args.stash"
    );
    assert_eq!(sh(&w, &["stash", "list", "--format=%H"]), format!("{two}\n{one}"));

    assert_eq!(r.git(GitActionKind::Unstash, stash(Some(1), Some(&one[..8]), true)).await.unwrap(), "已弹出 stash@{1}");
    assert_eq!(read(&w, "README.md").as_deref(), Some("hello\none\n"));
    let output = r.git(GitActionKind::StashDrop, stash(Some(0), Some(&two), false)).await.unwrap();
    assert!(output.contains("stash@{0}"), "{output}");
    assert_eq!(sh(&w, &["stash", "list"]), "");
}

#[tokio::test]
async fn discard_can_keep_added_files_on_disk_only_unstaged() {
    let mut r = rig();
    let w = r.work.clone();
    write(&w, "n/new.txt", "staged\n");
    sh(&w, &["add", "n/new.txt"]);
    write(&w, "README.md", "changed\n");
    write(&w, "u.txt", "untracked\n");
    sh(&w, &["mv", "src/a.txt", "src/c.txt"]);
    let keep = |list: &[&str]| {
        let list = paths(list);
        move |q: &mut GitAction| {
            q.paths = list;
            q.args = Some(GitActionArgs { keep_added: Some(true), ..a() });
        }
    };
    let output =
        r.git(GitActionKind::Discard, keep(&["n/new.txt", "README.md", "u.txt", "src/a.txt", "src/c.txt"])).await;
    assert_eq!(output.unwrap(), "已回滚 5 个文件");
    assert_eq!(sh(&w, &["status", "--porcelain", "--untracked-files=all"]), "?? n/new.txt\n?? src/c.txt");
    assert_eq!((read(&w, "n/new.txt"), read(&w, "src/c.txt")), (Some("staged\n".into()), Some("a1\n".into())));
    assert_eq!((read(&w, "README.md"), read(&w, "src/a.txt")), (Some("hello\n".into()), Some("a1\n".into())));
    assert!(!w.join("u.txt").exists());

    // Before the first commit, every file of the index is an added one.
    let fresh = w.join("fresh");
    fs::create_dir_all(&fresh).unwrap();
    sh(&fresh, &["init", "-q", "-b", "main"]);
    write(&fresh, "a.txt", "staged\n");
    sh(&fresh, &["add", "a.txt"]);
    write(&fresh, "b.txt", "untracked\n");
    r.git(GitActionKind::Discard, |q| {
        keep(&["a.txt", "b.txt"])(q);
        q.repo = Some("fresh".into());
    })
    .await
    .unwrap();
    assert_eq!((read(&fresh, "a.txt").as_deref(), fresh.join("b.txt").exists()), (Some("staged\n"), false));
    assert_eq!(sh(&fresh, &["ls-files"]), "");
}

#[tokio::test]
async fn add_stages_the_given_untracked_files_alone() {
    let mut r = rig();
    let w = r.work.clone();
    for file in ["notes/todo.md", "w*.txt", "wx.txt", ".gonggong/x"] {
        write(&w, file, "new\n");
    }
    let add = |list: &[&str]| {
        let list = paths(list);
        move |q: &mut GitAction| q.paths = list
    };
    let output = r.git(GitActionKind::Add, add(&["notes/todo.md", "w*.txt", ".gonggong/x"])).await.unwrap();
    assert_eq!(output, "已将 2 个文件加入版本控制");
    assert_eq!(sh(&w, &["diff", "--cached", "--name-only"]), "notes/todo.md\nw*.txt");
    assert_eq!(unignored(&w), [".gonggong/x", "wx.txt"]);
    assert!(r.git(GitActionKind::Add, add(&["../work/wx.txt"])).await.unwrap_err().contains("超出"));
    assert_eq!(r.git(GitActionKind::Add, add(&[".gonggong/x"])).await.unwrap_err(), "缺少参数：paths");
    assert!(r.git(GitActionKind::Add, add(&["nope.txt"])).await.is_err());
}

#[tokio::test]
async fn ignore_appends_each_path_escaped_once_to_the_root_gitignore() {
    let mut r = rig();
    let w = r.work.clone();
    let odd = ["a*b?.txt", "[x]\\y", "!bang", "#hash", " lead", "trail "];
    for file in ["dist/out.log", "dist/keep.log", "tmp/x.log", "axbz.txt", "x\\y", "lead", "trail"].iter().chain(&odd) {
        write(&w, file, "x\n");
    }
    let ignore = |list: &[&str]| {
        let list = paths(list);
        move |q: &mut GitAction| q.paths = list
    };
    let all: Vec<&str> = ["dist/out.log", "tmp"].iter().chain(&odd).copied().collect();
    assert_eq!(r.git(GitActionKind::Ignore, ignore(&all)).await.unwrap(), "已将 8 个路径加入 .gitignore");
    assert_eq!(
        read(&w, ".gitignore").unwrap(),
        "/dist/out.log\n/tmp\n/a\\*b\\?.txt\n/\\[x\\]\\\\y\n/\\!bang\n/\\#hash\n/\\ lead\n/trail\\ \n"
    );
    assert_eq!(unignored(&w), [".gitignore", "axbz.txt", "dist/keep.log", "lead", "trail", "x\\y"]);

    // Lines already there are skipped, a missing last line break is added first.
    fs::write(w.join(".gitignore"), "*.bak\n/tmp").unwrap();
    let output = r.git(GitActionKind::Ignore, ignore(&["tmp", "./lead", "lead"])).await.unwrap();
    assert_eq!(output, "已将 2 个路径加入 .gitignore");
    assert_eq!(read(&w, ".gitignore").unwrap(), "*.bak\n/tmp\n/lead\n");

    let before = read(&w, ".gitignore");
    assert!(r.git(GitActionKind::Ignore, ignore(&["tmp", "a\nb"])).await.unwrap_err().contains(".gitignore"));
    assert!(r.git(GitActionKind::Ignore, ignore(&["../x"])).await.unwrap_err().contains("超出"));
    assert_eq!(read(&w, ".gitignore"), before);

    // A link would have the line written wherever it points.
    #[cfg(unix)]
    {
        let outside = r.remote.parent().unwrap().join("outside.txt");
        fs::write(&outside, "keep\n").unwrap();
        fs::remove_file(w.join(".gitignore")).unwrap();
        std::os::unix::fs::symlink(&outside, w.join(".gitignore")).unwrap();
        assert_eq!(r.git(GitActionKind::Ignore, ignore(&["tmp"])).await.unwrap_err(), "不是文件：.gitignore");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep\n");
    }
}

#[tokio::test]
async fn the_new_actions_are_refused_while_a_turn_holds_the_directory() {
    let mut r = rig();
    write(&r.work, "new.txt", "x\n");
    r.send(ServerToDaemon::RunStart(Box::new(super::git_ops::slow_run(&r, "r1", "mock:slow"))));
    loop {
        if let DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. } = r.next().await {
            break;
        }
    }
    for action in [GitActionKind::Add, GitActionKind::Ignore] {
        let req = GitAction { paths: paths(&["new.txt"]), ..r.action_req(action) };
        r.send(ServerToDaemon::GitAction(Box::new(req)));
        let result = loop {
            if let msg @ DaemonToServer::GitActionResult { .. } = r.next().await {
                break msg;
            }
        };
        let DaemonToServer::GitActionResult { ok, busy, .. } = result else { unreachable!() };
        assert_eq!((ok, busy), (false, true), "{action:?}");
    }
    assert!(!r.work.join(".gitignore").exists());
    assert_eq!(sh(&r.work, &["diff", "--cached", "--name-only"]), "");
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
}
