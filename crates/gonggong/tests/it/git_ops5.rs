use super::git_ops::{commit, rig};
use gonggong::protocol::*;
use std::fs;

#[tokio::test]
async fn writes_record_each_real_git_command_in_order_on_success_and_failure() {
    let mut r = rig();
    fs::write(r.work.join("console.txt"), "one\n").unwrap();
    r.git(GitActionKind::Commit, |q| q.message = Some("console".into())).await.unwrap();
    let commands = r.detail.take().unwrap().commands.unwrap();
    let names: Vec<_> = commands.iter().map(|c| c.command.as_str()).collect();
    let add = names.iter().position(|c| c.contains(" add -A --")).unwrap();
    let commit = names.iter().rposition(|c| c.contains(" commit -m console")).unwrap();
    assert!(add < commit, "{names:?}");
    assert!(commands.iter().all(|c| c.exit_code.is_some() && !c.truncated));
    assert!(commands.iter().filter(|c| c.command.contains(" check-ignore ")).all(|c| c.exit_code == Some(1)));
    assert!(commands.iter().all(|c| c.started_at.ends_with('Z')));
    assert!(commands.last().unwrap().stdout.contains("console"));

    let error = r.git(GitActionKind::Commit, |q| q.message = Some("nothing".into())).await.unwrap_err();
    assert_eq!(error, "没有可提交的改动");
    let commands = r.detail.take().unwrap().commands.unwrap();
    assert!(commands.len() >= 2);
    assert!(commands.iter().any(|c| c.command.contains(" add -A --") && c.exit_code == Some(0)));
    assert!(commands.iter().any(|c| c.command.contains(" diff --cached --quiet") && c.exit_code == Some(0)));
}

#[tokio::test]
async fn remote_writes_record_stdout_stderr_and_a_failing_exit() {
    let mut r = rig();
    commit(&r.work, "console.txt", "one\n", "console");
    let req = |q: &mut GitAction| {
        q.branch = Some("main".into());
        q.remote = Some("origin".into());
    };
    r.git(GitActionKind::Push, req).await.unwrap();
    let commands = r.detail.take().unwrap().commands.unwrap();
    let push = commands.iter().find(|c| c.command.contains(" push --porcelain")).unwrap();
    assert_eq!(push.exit_code, Some(0));
    assert!(!push.stdout.is_empty() || !push.stderr.is_empty());

    fs::write(r.work.join("console.txt"), "rewritten\n").unwrap();
    r.git(GitActionKind::Commit, |q| {
        q.message = Some("rewrite".into());
        q.args = Some(GitActionArgs { amend: Some(true), ..Default::default() });
    })
    .await
    .unwrap();
    r.git(GitActionKind::Push, req).await.unwrap_err();
    let commands = r.detail.take().unwrap().commands.unwrap();
    let push = commands.iter().find(|c| c.command.contains(" push --porcelain")).unwrap();
    assert_eq!(push.exit_code, Some(1));
    assert!(push.stderr.contains("rejected") || push.stdout.contains("rejected"), "{push:?}");
}
