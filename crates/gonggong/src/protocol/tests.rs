use super::*;

#[test]
fn local_profile_fixture_round_trips() {
    let raw: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/protocol/fixtures/s2d.providers.cmd.local-profile.json"
    ))
    .unwrap();
    let parsed: ServerToDaemon = serde_json::from_value(raw.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
}

#[test]
fn files_find_fixtures_parse() {
    let ask: ServerToDaemon =
        serde_json::from_str(include_str!("../../../../packages/protocol/fixtures/s2d.files.find.json")).unwrap();
    assert!(matches!(ask, ServerToDaemon::FilesFind(ref f) if f.name == "Markdown.tsx" && f.limit == 20));
    let answer: DaemonToServer =
        serde_json::from_str(include_str!("../../../../packages/protocol/fixtures/d2s.files.find.result.json"))
            .unwrap();
    assert!(matches!(answer, DaemonToServer::FilesFindResult { ref paths, .. } if paths.len() == 2));
}

#[test]
fn git_diff_refresh_and_commit_paths_fixtures_parse() {
    let fixture = |raw: &str| serde_json::from_str::<ServerToDaemon>(raw).unwrap();
    let ServerToDaemon::GitDiff(diff) =
        fixture(include_str!("../../../../packages/protocol/fixtures/s2d.git.diff.json"))
    else {
        panic!()
    };
    assert_eq!((diff.from.as_str(), diff.to, diff.path.as_deref()), ("HEAD", None, Some("src/refund.ts")));
    assert_eq!(diff.max_bytes, 1_048_576);
    let refresh = fixture(include_str!("../../../../packages/protocol/fixtures/s2d.git.refresh.json"));
    assert!(matches!(refresh, ServerToDaemon::GitRefresh(ref r) if r.fetch));
    let commit = fixture(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.json"));
    assert!(matches!(commit, ServerToDaemon::GitAction(ref a) if a.paths.as_ref().is_some_and(|p| p.len() == 2)));
    // An older server never sends `paths`.
    let push = fixture(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.push.json"));
    assert!(matches!(push, ServerToDaemon::GitAction(ref a) if a.paths.is_none()));

    let answer = |raw: &str| serde_json::from_str::<DaemonToServer>(raw).unwrap();
    let result = answer(include_str!("../../../../packages/protocol/fixtures/d2s.git.diff.result.json"));
    assert!(
        matches!(result, DaemonToServer::GitDiffResult { ref patch, truncated: false, error: None, .. } if patch.as_ref().is_some_and(|p| p.starts_with("diff --git")))
    );
    let result = answer(include_str!("../../../../packages/protocol/fixtures/d2s.git.refresh.result.json"));
    assert!(matches!(result, DaemonToServer::GitRefreshResult { error: None, .. }));
}

#[test]
fn git_ops4_fixtures_parse() {
    let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
        ServerToDaemon::GitAction(a) => *a,
        other => panic!("unexpected {other:?}"),
    };
    let push = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.push.target.json"));
    assert_eq!((push.action, push.branch.as_deref()), (GitActionKind::Push, Some("feat/refund")));
    assert_eq!(push.args.unwrap().target.as_deref(), Some("feat/refund-v2"));
    let add = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.add.json"));
    assert_eq!((add.action, add.paths), (GitActionKind::Add, Some(vec!["notes/todo.md".to_string()])));
    let ignore = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.ignore.json"));
    assert_eq!((ignore.action, ignore.paths.map(|p| p.len())), (GitActionKind::Ignore, Some(2)));
    let discard = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.discard.keep.json"));
    assert_eq!((discard.action, discard.args.unwrap().keep_added), (GitActionKind::Discard, Some(true)));
    let drop = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.stash-drop.expect.json"));
    let args = drop.args.unwrap();
    assert_eq!(
        (drop.action, args.stash, args.expect.as_deref()),
        (GitActionKind::StashDrop, Some(1), Some("5f2c9e1a"))
    );
}

#[test]
fn git_ops4_detail_fixtures_parse() {
    let ServerToDaemon::GitDiff(diff) =
        serde_json::from_str(include_str!("../../../../packages/protocol/fixtures/s2d.git.diff.rename.json")).unwrap()
    else {
        panic!()
    };
    assert_eq!(
        (diff.path.as_deref(), diff.old_path.as_deref(), diff.whitespace),
        (Some("src/new.ts"), Some("src/old.ts"), Some(GitWhitespace::IgnoreBlank))
    );

    let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
        ServerToDaemon::GitAction(a) => (a.action, a.branch.clone(), a.args.unwrap()),
        other => panic!("unexpected {other:?}"),
    };
    let (kind, _, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.discard.patch.json"));
    assert_eq!(kind, GitActionKind::Discard);
    assert!(args.patch.unwrap().starts_with("diff --git a/src/a.ts b/src/a.ts\n"));
    let (kind, branch, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.checkout.drop.json"));
    assert_eq!(
        (kind, branch.as_deref(), args.local_commits),
        (GitActionKind::Checkout, Some("origin/feat"), Some(GitLocalCommits::Drop))
    );
    let (kind, _, args) = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.pull.from.json"));
    assert_eq!(
        (kind, args.mode.as_deref(), args.from.as_deref()),
        (GitActionKind::Pull, Some("rebase"), Some("origin/feat"))
    );
    let (kind, branch, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.branch-create.force.json"));
    assert_eq!(
        (kind, branch.as_deref(), args.from.as_deref(), args.checkout, args.force),
        (GitActionKind::BranchCreate, Some("feat/x"), Some("origin/feat/x"), Some(true), Some(true))
    );

    let detail = |raw: &str| match serde_json::from_str::<DaemonToServer>(raw).unwrap() {
        DaemonToServer::GitActionResult { ok, detail, .. } => (ok, detail.unwrap()),
        other => panic!("unexpected {other:?}"),
    };
    let (ok, overwritten) =
        detail(include_str!("../../../../packages/protocol/fixtures/d2s.git.action.result.overwritten.json"));
    assert!(!ok);
    assert_eq!(
        overwritten,
        GitActionDetail {
            code: Some(GitActionCode::Overwritten),
            paths: vec!["src/a.ts".into(), "README.md".into()],
            ..GitActionDetail::default()
        }
    );
    let (ok, updated) =
        detail(include_str!("../../../../packages/protocol/fixtures/d2s.git.action.result.updated.json"));
    assert!(ok);
    let to = GitUpdated { from: "1a2b3c4".into(), to: "5d6e7f8".into(), commits: 2, files: 3 };
    assert_eq!(updated, GitActionDetail { updated: Some(to), ..GitActionDetail::default() });

    // Every field goes out, null when unset; an older daemon's answer has no detail.
    let none = serde_json::to_value(GitActionDetail::default()).unwrap();
    assert_eq!(
        none,
        serde_json::json!({"code": null, "paths": [], "ahead": null, "behind": null, "updated": null, "commands": null})
    );
    let result = DaemonToServer::GitActionResult {
        request_id: "q1".into(),
        ok: true,
        busy: false,
        output: None,
        error: None,
        detail: None,
    };
    assert_eq!(serde_json::to_value(&result).unwrap()["detail"], serde_json::Value::Null);
    let older = r#"{"t":"git.action.result","requestId":"q1","ok":true,"busy":false,"output":"x","error":null}"#;
    assert!(matches!(serde_json::from_str(older).unwrap(), DaemonToServer::GitActionResult { detail: None, .. }));
}

#[test]
fn git_ops4_r4_fixtures_parse() {
    let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
        ServerToDaemon::GitAction(a) => (a.action, a.paths.clone(), a.args.unwrap()),
        other => panic!("unexpected {other:?}"),
    };
    let (kind, _, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.rebase.todo.json"));
    assert_eq!((kind, args.onto.as_deref()), (GitActionKind::Rebase, Some("0f1e2d3c")));
    let step = |action, commit: &str, message: Option<&str>| GitRebaseStep {
        action,
        commit: commit.into(),
        message: message.map(String::from),
    };
    assert_eq!(
        args.todo.unwrap(),
        [
            step(GitRebaseAction::Pick, "a1b2c3d4", None),
            step(GitRebaseAction::Reword, "b2c3d4e5", Some("修复退款金额")),
            step(GitRebaseAction::Fixup, "c3d4e5f6", None),
            step(GitRebaseAction::Drop, "d4e5f6a7", None),
        ]
    );
    let (kind, paths, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.resolve.paths.json"));
    assert_eq!(
        (kind, paths, args.path.as_deref(), args.side),
        (
            GitActionKind::Resolve,
            Some(vec!["src/a.ts".into(), "src/b.ts".into()]),
            Some("src/a.ts"),
            Some(GitConflictPick::Theirs)
        )
    );
    let (kind, paths, args) = action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.apply.json"));
    assert_eq!(
        (kind, paths, args.commit.as_deref(), args.reverse),
        (GitActionKind::Apply, Some(vec!["src/a.ts".into()]), Some("a1b2c3d4"), Some(true))
    );
    let (kind, paths, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.restore.json"));
    assert_eq!(
        (kind, paths, args.commit.as_deref(), args.reverse),
        (GitActionKind::Restore, Some(vec!["src/a.ts".into(), "README.md".into()]), Some("a1b2c3d4"), None)
    );
}

#[test]
fn git_ops4_up_to_and_expect_head_fixtures_parse() {
    let action = |raw: &str| match serde_json::from_str::<ServerToDaemon>(raw).unwrap() {
        ServerToDaemon::GitAction(a) => (a.action, a.branch.clone(), a.args.unwrap()),
        other => panic!("unexpected {other:?}"),
    };
    let (kind, branch, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.push.commit.json"));
    assert_eq!(
        (kind, branch.as_deref(), args.commit.as_deref(), args.target),
        (GitActionKind::Push, Some("feat/refund"), Some("a1b2c3d4e5f6"), None)
    );
    let (kind, _, args) =
        action(include_str!("../../../../packages/protocol/fixtures/s2d.git.action.reset.expect.json"));
    assert_eq!(
        (kind, args.commit.as_deref(), args.mode.as_deref(), args.expect.as_deref()),
        (GitActionKind::Reset, Some("0f1e2d3c4b5a"), Some("soft"), Some("a1b2c3d4e5f6"))
    );
}

#[test]
fn artifact_activity_fixture_round_trips() {
    let raw: serde_json::Value =
        serde_json::from_str(include_str!("../../../../packages/protocol/fixtures/d2s.artifact.activity.json"))
            .unwrap();
    let parsed: DaemonToServer = serde_json::from_value(raw.clone()).unwrap();
    assert!(
        matches!(parsed, DaemonToServer::ArtifactActivity { ref paths, .. } if paths == &["screens/home.html", "tokens.css"])
    );
    assert_eq!(serde_json::to_value(parsed).unwrap(), raw);
}

#[test]
fn run_start_takes_cli_profiles_and_refuses_odd_ones() {
    let mut raw: serde_json::Value =
        serde_json::from_str(include_str!("../../../../packages/protocol/fixtures/s2d.run.start.json")).unwrap();
    let member = "gg-11111111-2222-4333-8444-555555555555";
    raw["cliProfiles"] =
        serde_json::json!([{"driver": "lark-cli", "profile": member}, {"driver": "meegle", "profile": "default"}]);
    let ServerToDaemon::RunStart(start) = serde_json::from_value(raw.clone()).unwrap() else { panic!() };
    assert_eq!(start.cli_profiles[0].driver, ConnectorDriver::LarkCli);
    assert_eq!(start.cli_profiles[0].profile.as_str(), member);
    assert!(start.cli_profiles[1].profile.is_default());
    for odd in ["gg-../../etc", "--help", "Default", "gg-11111111-2222-4333-8444-55555555555Z"] {
        raw["cliProfiles"] = serde_json::json!([{"driver": "lark-cli", "profile": odd}]);
        assert!(serde_json::from_value::<ServerToDaemon>(raw.clone()).is_err(), "{odd}");
    }
}
