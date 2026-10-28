//! Drives the Engine against the scriptable mock ACP agent (tools/mock-agent) without a server.
use gonggong::engine::{Continuation, Engine, EngineConfig};
use gonggong::local::LocalSettings;
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use std::path::{Path, PathBuf};
use std::time::Duration;

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    home: tempfile::TempDir,
    /// session.config reports (run id, model, effort), set aside by `next`.
    configs: Vec<(String, Option<String>, Option<String>)>,
}

fn rig(idle: Duration) -> Rig {
    rig_reaping(idle, Duration::from_secs(600))
}

fn rig_reaping(idle: Duration, reap: Duration) -> Rig {
    rig_with(idle, reap, Duration::from_secs(30))
}

fn rig_with(idle: Duration, reap: Duration, cancel_grace: Duration) -> Rig {
    rig_full(
        idle,
        reap,
        cancel_grace,
        Continuation { adopt_wait: Duration::from_secs(10), quiet: Duration::from_secs(20) },
    )
}

fn rig_continuing(continuation: Continuation) -> Rig {
    rig_full(Duration::from_secs(60), Duration::from_secs(600), Duration::from_secs(30), continuation)
}

fn rig_full(idle: Duration, reap: Duration, cancel_grace: Duration, continuation: Continuation) -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle,
        reap,
        cancel_grace,
        continuation,
        api: None,
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, home, configs: vec![] }
}

/// The follow-up turn as the server sends it: carrying the session id stored from the previous run.done.
fn follow_up(run_id: &str, text: &str, prev: &RunDone) -> RunStart {
    RunStart { resume_session_id: prev.session_id.clone(), ..start(run_id, text) }
}

fn start(run_id: &str, text: &str) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: "只改 server/".into(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            git: None,
            agent_settings: Default::default(),
        },
        workspace: WorkspaceSpec { repo: None, cd_path: None, protect_base: false, extra_dirs: vec![] },
        resume_session_id: None,
        new_session_reason: None,
        mcp_servers: vec![],
        skills: vec![],
        plugins: vec![],
        command: None,
        sync: None,
        env: Default::default(),
        prompt: RunPrompt {
            text: text.into(),
            triggered_by: "王磊".into(),
            context: vec![ContextMessage {
                seq: 3,
                author: "陈晨".into(),
                kind: "user".into(),
                body: "新上下文".into(),
                at: "2026-09-23T10:12:00Z".into(),
                attachments: vec![],
            }],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
    }
}

impl Rig {
    fn send(&self, msg: ServerToDaemon) {
        self.engine.handle(msg, &self.out);
    }

    fn run(&self, s: RunStart) {
        self.send(ServerToDaemon::RunStart(Box::new(s)));
    }

    async fn next(&mut self) -> DaemonToServer {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv())
                .await
                .expect("engine went quiet")
                .unwrap();
            match msg {
                DaemonToServer::SessionConfig { run_id, model, effort, .. } => {
                    self.configs.push((run_id, model, effort))
                }
                msg => return msg,
            }
        }
    }

    /// Events of `run_id` up to its run.done.
    async fn finish(&mut self, run_id: &str) -> (Vec<RunEvent>, RunDone) {
        let mut events = vec![];
        loop {
            match self.next().await {
                DaemonToServer::RunEvent { run_id: r, event } if r == run_id => events.push(event),
                DaemonToServer::RunDone(d) if d.run_id == run_id => return (events, d),
                other => panic!("unexpected {other:?}"),
            }
        }
    }

    fn workspace(&self) -> PathBuf {
        self.home.path().join("workspaces/g1/b1/_empty")
    }
}

fn echo(done: &RunDone) -> serde_json::Value {
    serde_json::from_str(&done.reply).unwrap()
}

/// Events of the turn up to its approval request.
async fn until_approval(r: &mut Rig) -> (Vec<RunEvent>, ApprovalRequest) {
    let mut events = vec![];
    loop {
        match r.next().await {
            DaemonToServer::RunEvent { event, .. } => events.push(event),
            DaemonToServer::ApprovalRequest(a) => return (events, a),
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn decide(r: &Rig, a: &ApprovalRequest, option_id: Option<&str>) {
    r.send(ServerToDaemon::ApprovalDecision {
        run_id: a.run_id.clone(),
        request_id: a.request_id.clone(),
        option_id: option_id.map(String::from),
    });
}

#[tokio::test]
async fn streams_a_turn_and_asks_the_owner_beyond_the_tier() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "写个文件"));
    let (events, approval) = until_approval(&mut r).await;
    assert!(r.workspace().is_dir());
    assert_eq!(events.first(), Some(&RunEvent::Text { delta: "好的，".into(), agent_id: None }));
    assert!(events.contains(&RunEvent::Thought { delta: "需要写一个文件".into(), agent_id: None }));
    assert!(events.iter().any(
        |e| matches!(e, RunEvent::Tool { tool_kind, title, .. } if tool_kind == "edit" && title == "Write hello.txt")
    ));
    assert_eq!(
        events.last(),
        Some(&RunEvent::Status { status: RunStatus::AwaitingApproval, step: "等待审批：Write hello.txt".into() })
    );
    let file = r.workspace().join("hello.txt");
    assert_eq!(
        approval,
        ApprovalRequest {
            run_id: "r1".into(),
            request_id: approval.request_id.clone(),
            title: "Write hello.txt".into(),
            tool_kind: "edit".into(),
            detail: file.display().to_string(),
            reason: ApprovalReason::Write,
            options: vec![
                PermissionOption { option_id: "allow".into(), name: "Allow".into(), kind: PermissionKind::AllowOnce },
                PermissionOption {
                    option_id: "reject".into(),
                    name: "Reject".into(),
                    kind: PermissionKind::RejectOnce
                },
            ],
            remember: vec!["tool:Write hello.txt".into()],
        }
    );
    // Decisions for unknown requests are ignored.
    r.send(ServerToDaemon::ApprovalDecision {
        run_id: "r1".into(),
        request_id: "nope".into(),
        option_id: Some("reject".into()),
    });
    decide(&r, &approval, Some("allow"));
    let (events, done) = r.finish("r1").await;
    assert_eq!(
        events.first(),
        Some(&RunEvent::Status { status: RunStatus::Running, step: "已批准：Write hello.txt".into() })
    );
    assert!(events.iter().any(|e| matches!(e, RunEvent::Usage { .. })));
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert_eq!(done.reply, "好的，已写入 hello.txt。");
    assert_eq!(done.files_changed, 1);
    assert_eq!(done.git, None);
    assert_eq!(done.usage.as_ref().and_then(|u| u.cost_usd), Some(0.01));
    assert_eq!(done.new_session_reason.as_deref(), Some("first"));
    assert!(done.session_id.as_deref().unwrap().starts_with("mock-"));
}

#[tokio::test]
async fn session_fork_copies_a_turns_session_into_a_new_one() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:echo"));
    let (_, done) = r.finish("r1").await;
    let parent = done.session_id.expect("the turn reports its session");

    r.send(ServerToDaemon::SessionFork(SessionFork {
        request_id: "f1".into(),
        agent: AgentKind::Claude,
        group_id: "g1".into(),
        bot_id: "b1".into(),
        workspace: WorkspaceSpec {
            repo: None,
            cd_path: Some(r.workspace().display().to_string()),
            protect_base: false,
            extra_dirs: vec![],
        },
        session_id: parent.clone(),
    }));
    let DaemonToServer::SessionForkResult { request_id, session_id, error } = r.next().await else {
        panic!("expected session.fork.result");
    };
    assert_eq!(request_id, "f1");
    assert_eq!(error, None);
    let forked = session_id.expect("the fork reports the new session");
    assert_ne!(forked, parent);

    r.run(RunStart { resume_session_id: Some(forked.clone()), ..start("r2", "mock:echo") });
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.session_id.as_deref(), Some(forked.as_str()));
}

#[tokio::test]
async fn a_rejected_or_timed_out_request_lets_the_agent_carry_on() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "写个文件"));
    let (_, approval) = until_approval(&mut r).await;
    decide(&r, &approval, Some("reject"));
    let (events, done) = r.finish("r1").await;
    assert_eq!(
        events.first(),
        Some(&RunEvent::Status { status: RunStatus::Running, step: "请求被拒绝，agent 自行绕路".into() })
    );
    assert_eq!((done.outcome, done.reply.as_str()), (RunOutcome::Completed, "好的，权限被拒绝，未写入。"));

    // No option (timeout without a reject option) answers `cancelled`.
    r.run(follow_up("r2", "写个文件", &done));
    let (_, approval) = until_approval(&mut r).await;
    decide(&r, &approval, None);
    let (_, done) = r.finish("r2").await;
    assert_eq!((done.outcome, done.reply.as_str()), (RunOutcome::Completed, "好的，权限被拒绝，未写入。"));
}

#[tokio::test]
async fn cancel_answers_a_pending_request_and_interrupts() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "写个文件"));
    let (_, approval) = until_approval(&mut r).await;
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);
    // A late decision for the finished turn is ignored.
    decide(&r, &approval, Some("allow"));
    r.run(follow_up("r2", "mock:echo", &done));
    assert_eq!(r.finish("r2").await.1.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn full_tier_approves_permissions() {
    let mut r = rig(Duration::from_secs(60));
    let mut s = start("r1", "写个文件");
    s.bot.tier = Tier::Full;
    r.run(s);
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.reply, "好的，已写入 hello.txt。");
}

#[tokio::test]
async fn raising_the_tier_to_full_mid_run_approves_pending_requests() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "写个文件"));
    until_approval(&mut r).await;
    r.send(ServerToDaemon::RunTier { run_id: "r1".into(), tier: Tier::Full });
    let (events, done) = r.finish("r1").await;
    assert!(events.contains(&RunEvent::Status {
        status: RunStatus::Running,
        step: "档位已切换为「完全访问」，自动批准：Write hello.txt".into()
    }));
    assert_eq!(done.reply, "好的，已写入 hello.txt。");
}

#[tokio::test]
async fn injects_cwd_mode_system_prompt_and_context_then_reuses_the_session() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:echo"));
    let (_, first) = r.finish("r1").await;
    let e = echo(&first);
    assert_eq!(Path::new(e["cwd"].as_str().unwrap()).canonicalize().unwrap(), r.workspace().canonicalize().unwrap());
    assert_eq!(e["mode"], "acceptEdits");
    assert!(e["systemPrompt"].as_str().unwrap().contains("小王的 Claude"));
    assert_eq!(e["prompt"], "群聊上下文：\n[#3 2026-09-23 10:12] 陈晨: 新上下文\n\n王磊 说：mock:echo");

    r.run(follow_up("r2", "mock:echo again", &first));
    let (_, second) = r.finish("r2").await;
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(second.new_session_reason, None);
    assert_eq!(echo(&second)["pid"], e["pid"]);
}

#[tokio::test]
async fn an_agent_command_is_sent_verbatim_without_the_group_context() {
    let mut r = rig(Duration::from_secs(60));
    r.run(RunStart {
        command: Some("/mock:echo 保留接口约定".into()),
        ..start("r1", "/mock:echo @小王的 Claude 保留接口约定")
    });
    let (_, done) = r.finish("r1").await;
    assert_eq!(echo(&done)["prompt"], "/mock:echo 保留接口约定");
}

#[tokio::test]
async fn slash_new_drops_the_live_session_and_reports_the_reason() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:echo"));
    let (_, first) = r.finish("r1").await;
    r.run(RunStart { new_session_reason: Some("requested".into()), ..start("r2", "mock:echo") });
    let (_, second) = r.finish("r2").await;
    assert_ne!(second.session_id, first.session_id);
    assert_eq!(second.new_session_reason.as_deref(), Some("requested"));
}

#[tokio::test]
async fn falls_back_to_a_new_session_with_recent_history_when_resume_fails() {
    let mut r = rig(Duration::from_secs(60));
    let mut s = start("r1", "mock:echo");
    s.resume_session_id = Some("gone".into());
    // Counts messages left out of `context`, which the fallback replaces.
    s.prompt.omitted = 5;
    s.prompt.fallback_context = vec![ContextMessage {
        seq: 1,
        author: "王磊".into(),
        kind: "user".into(),
        body: "旧消息".into(),
        at: "2026-09-23T09:00:00Z".into(),
        attachments: vec![],
    }];
    r.run(s);
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.new_session_reason.as_deref(), Some("resume_failed"));
    assert!(echo(&done)["prompt"].as_str().unwrap().starts_with("群聊上下文：\n[#1 2026-09-23 09:00] 王磊: 旧消息\n"));
}

#[tokio::test]
async fn resumes_a_known_session_in_a_fresh_adapter_after_idle_reap() {
    let mut r = rig(Duration::from_millis(200));
    r.run(start("r1", "mock:echo"));
    let (_, first) = r.finish("r1").await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    r.run(follow_up("r2", "mock:echo", &first));
    let (_, second) = r.finish("r2").await;
    assert_ne!(echo(&second)["pid"], echo(&first)["pid"]);
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(second.new_session_reason, None);
}

#[tokio::test]
async fn cancel_interrupts_and_the_session_continues() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:slow"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);

    r.run(follow_up("r2", "mock:echo", &done));
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
    assert_eq!(next.session_id, done.session_id);
}

#[tokio::test]
async fn a_turn_whose_agent_ignores_the_cancel_ends_after_the_grace_and_the_next_one_runs() {
    let mut r = rig_with(Duration::from_secs(60), Duration::from_secs(600), Duration::from_millis(500));
    r.run(start("r1", "mock:hang"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);

    r.run(follow_up("r2", "mock:echo", &done));
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn reports_runs_in_flight_as_active_until_they_end() {
    let mut r = rig(Duration::from_secs(60));
    assert!(r.engine.active_runs().is_empty());
    r.run(start("r1", "mock:slow"));
    // Active from receipt on, while the workspace is still being prepared (hello reconciliation must not drop it).
    assert_eq!(r.engine.active_runs(), vec!["r1".to_string()]);
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    assert_eq!(r.engine.active_runs(), vec!["r1".to_string()]);
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    r.finish("r1").await;
    assert!(r.engine.active_runs().is_empty());
}

#[tokio::test]
async fn a_repeated_run_start_does_not_start_the_run_twice() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:slow"));
    r.run(start("r1", "mock:slow"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    r.run(start("r1", "mock:slow"));
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    r.finish("r1").await;
    assert!(tokio::time::timeout(Duration::from_millis(500), r.rx.recv()).await.is_err());
}

#[tokio::test]
async fn adapter_crash_fails_the_run_and_the_next_turn_recovers() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:crash"));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert!(done.error.is_some());

    r.run(follow_up("r2", "mock:echo", &done));
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
}

fn git(dir: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

/// Clones a fresh bare remote into the bot's workspace, then pushes one more commit it does not have yet.
fn repo_workspace(r: &Rig) -> tempfile::TempDir {
    let remote = tempfile::tempdir().unwrap();
    let root = remote.path();
    git(root, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
    git(root, &["clone", "-q", "remote.git", "seed"]);
    let seed = root.join("seed");
    let push = |file: &str| {
        std::fs::write(seed.join(file), "x\n").unwrap();
        git(&seed, &["add", "-A"]);
        git(&seed, &["commit", "-q", "-m", file]);
        git(&seed, &["push", "-q", "origin", "HEAD:main"]);
    };
    push("README.md");
    std::fs::create_dir_all(r.workspace().parent().unwrap()).unwrap();
    git(root, &["clone", "-q", "remote.git", r.workspace().to_str().unwrap()]);
    push("later.txt");
    remote
}

#[tokio::test]
async fn repo_workspace_is_left_alone_before_the_turn_and_reports_git_changes() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    r.run(start("r1", "mock:echo"));
    let (events, done) = r.finish("r1").await;
    assert!(!events.iter().any(|e| matches!(e, RunEvent::Status { step, .. } if step.starts_with("git "))));
    assert!(!r.workspace().join("later.txt").exists());
    assert!(echo(&done)["prompt"].as_str().unwrap().starts_with("群聊上下文："));
    let clean = GitStatus {
        branch: Some("main".into()),
        ahead: Some(0),
        behind: Some(0),
        dirty: false,
        dirty_count: Some(0),
        additions: Some(0),
        deletions: Some(0),
        checked_at: None,
        workspace: WorkspaceKind::Managed,
        repos: vec![],
        head: None,
        ongoing: None,
        conflicts: Some(0),
        stashes: Some(0),
    };
    let unstamped = |git: Option<GitStatus>| git.map(|g| GitStatus { checked_at: None, head: None, ..g });
    assert_eq!(unstamped(done.git.clone()), Some(clean.clone()));
    assert_eq!(done.files_changed, 0);

    // Shell edits and commits (as Codex does) are counted through git, not tool locations.
    let sh = "mock:sh echo a > a.txt && echo b > README.md && git add README.md && git -c user.name=t -c user.email=t@t commit -qm edit && echo c > c.txt";
    r.run(follow_up("r2", sh, &done));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    assert_eq!(done.files_changed, 3);
    assert_eq!(
        unstamped(done.git),
        Some(GitStatus { ahead: Some(1), dirty: true, dirty_count: Some(2), additions: Some(2), ..clean })
    );
    let repos: Vec<_> = done.repos.iter().map(|r| (r.path.as_str(), r.branch.as_deref())).collect();
    assert_eq!(repos, [("", Some("main"))]);
}

#[tokio::test]
async fn additional_directories_reach_the_session_and_their_changes_are_reported() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    let extra = tempfile::tempdir().unwrap();
    let sdk = extra.path().join("sdk");
    git(extra.path(), &["init", "-q", "-b", "main", sdk.to_str().unwrap()]);
    let sdk_path = sdk.to_string_lossy().into_owned();
    let with_extra = |s: RunStart| RunStart {
        workspace: WorkspaceSpec { extra_dirs: vec![sdk_path.clone()], ..s.workspace.clone() },
        ..s
    };
    r.run(with_extra(start("r1", "mock:echo")));
    let (_, done) = r.finish("r1").await;
    assert_eq!(echo(&done)["additionalDirectories"], serde_json::json!([sdk_path]));

    let sh = format!("mock:sh echo a > a.txt && echo s > {sdk_path}/s.txt");
    r.run(with_extra(follow_up("r2", &sh, &done)));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    assert_eq!(done.files_changed, 2);
    let repos: Vec<_> = done.repos.iter().map(|r| (r.path.as_str(), r.kind)).collect();
    assert_eq!(repos, [("", RepoKind::Root), (sdk_path.as_str(), RepoKind::Extra)]);
    let patch = done.patch.unwrap();
    assert!(patch.contains(&format!("b/{sdk_path}/s.txt")), "{patch}");
    assert_eq!(done.git.unwrap().repos.iter().map(|r| r.kind).collect::<Vec<_>>(), [RepoKind::Extra]);

    // A directory that is gone fails the run before the agent starts.
    let gone = extra.path().join("gone").to_string_lossy().into_owned();
    let mut s = start("r3", "mock:echo");
    s.workspace.extra_dirs = vec![gone.clone()];
    r.run(s);
    let (_, done) = r.finish("r3").await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert_eq!(done.error.as_deref(), Some(format!("附加目录不存在或不是目录：{gone}").as_str()));
}

#[tokio::test]
async fn reports_the_live_turns_diff_and_the_workspaces_uncommitted_changes() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    let diff = |scope: DiffScope, run_id: Option<&str>| {
        ServerToDaemon::WorkspaceDiff(WorkspaceDiff {
            request_id: format!("{scope:?}"),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: WorkspaceSpec { repo: None, cd_path: None, protect_base: false, extra_dirs: vec![] },
            scope,
            run_id: run_id.map(String::from),
        })
    };
    let answer = async |r: &mut Rig| loop {
        if let DaemonToServer::WorkspaceDiffResult { patch, base, branch, error, .. } = r.next().await {
            return (patch, base, branch, error);
        }
    };
    r.run(start("r1", "mock:slow"));
    // Streaming has begun, so the turn's snapshot is taken; then the "agent" edits a file.
    while !matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }) {}
    std::fs::write(r.workspace().join("edited.txt"), "mid-turn\n").unwrap();
    r.send(diff(DiffScope::Turn, Some("r1")));
    let (patch, _, branch, error) = answer(&mut r).await;
    assert_eq!((error, branch.as_deref()), (None, Some("main")));
    assert!(patch.unwrap().contains("+mid-turn"));

    r.send(diff(DiffScope::Turn, Some("gone")));
    assert_eq!(answer(&mut r).await.3.as_deref(), Some("该轮已结束或不在本机运行"));
    r.send(diff(DiffScope::Uncommitted, None));
    assert!(answer(&mut r).await.0.unwrap().contains("b/edited.txt"));
    r.send(diff(DiffScope::Base, None));
    assert_eq!(answer(&mut r).await.1, None);
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
}

/// Runs a `mock:slow` turn and stops it once it streams, after `edit` changed the workspace meanwhile.
async fn stopped(r: &mut Rig, s: RunStart, edit: impl FnOnce(&Path)) -> RunDone {
    let run_id = s.run_id.clone();
    r.run(s);
    while !matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }) {}
    edit(&r.workspace());
    r.send(ServerToDaemon::RunCancel { run_id: run_id.clone() });
    let (_, done) = r.finish(&run_id).await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);
    done
}

#[tokio::test]
async fn discard_restores_the_interrupted_turn_until_the_next_turn_starts() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    let ws = r.workspace();
    r.run(start("r0", "mock:echo"));
    let (_, first) = r.finish("r0").await;
    git(&ws, &["pull", "-q", "--ff-only"]);
    std::fs::write(ws.join("README.md"), "local wip\n").unwrap();

    let done = stopped(&mut r, follow_up("r1", "mock:slow", &first), |ws| {
        std::fs::write(ws.join("turn.txt"), "x\n").unwrap();
        std::fs::write(ws.join("later.txt"), "y\n").unwrap();
    })
    .await;
    assert_eq!(done.files_changed, 2);
    r.send(ServerToDaemon::RunDiscard { run_id: "r1".into() });
    assert_eq!(r.next().await, DaemonToServer::RunDiscarded { run_id: "r1".into(), ok: true, files: 2, error: None });
    assert!(!ws.join("turn.txt").exists());
    assert_eq!(std::fs::read_to_string(ws.join("later.txt")).unwrap(), "x\n");
    assert_eq!(std::fs::read_to_string(ws.join("README.md")).unwrap(), "local wip\n");

    // Once discarded, or once the next turn has started, the snapshot is gone.
    r.send(ServerToDaemon::RunDiscard { run_id: "r1".into() });
    assert!(matches!(r.next().await, DaemonToServer::RunDiscarded { ok: false, error: Some(_), .. }));
    let next =
        stopped(&mut r, follow_up("r2", "mock:slow", &done), |ws| std::fs::write(ws.join("z.txt"), "z\n").unwrap())
            .await;
    r.run(follow_up("r3", "mock:sh echo w > w.txt", &next));
    assert_eq!(r.finish("r3").await.1.outcome, RunOutcome::Completed);
    r.send(ServerToDaemon::RunDiscard { run_id: "r2".into() });
    assert!(matches!(r.next().await, DaemonToServer::RunDiscarded { ok: false, .. }));
    assert!(ws.join("z.txt").exists());
    // A completed turn keeps none: the server offers to discard a stopped turn's changes only.
    r.send(ServerToDaemon::RunDiscard { run_id: "r3".into() });
    assert!(matches!(r.next().await, DaemonToServer::RunDiscarded { ok: false, .. }));
    assert!(ws.join("w.txt").exists());
}

/// The conversation's built-in ask tool URL, as the agent got it.
fn ask_url(done: &RunDone) -> String {
    echo(done)["mcpServers"].as_array().unwrap().last().unwrap()["url"].as_str().unwrap().into()
}

/// A plain GET on the ask tool URL: 405 while the conversation is routed, 404 once it is dropped.
async fn ask_status(url: &str) -> u16 {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    client.get(url).send().await.unwrap().status().as_u16()
}

async fn until_dropped(url: &str) {
    for _ in 0..200 {
        if ask_status(url).await == 404 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("the conversation was never dropped");
}

#[tokio::test]
async fn an_idle_conversation_is_dropped_and_the_next_run_opens_a_new_one() {
    let mut r = rig_reaping(Duration::from_millis(300), Duration::from_millis(300));
    r.run(start("r1", "mock:echo"));
    let (_, first) = r.finish("r1").await;
    let url = ask_url(&first);
    assert_eq!(ask_status(&url).await, 405);
    until_dropped(&url).await;

    r.run(follow_up("r2", "mock:echo", &first));
    let (_, second) = r.finish("r2").await;
    assert_eq!((second.outcome, &second.session_id), (RunOutcome::Completed, &first.session_id));
    let again = ask_url(&second);
    assert_ne!(again, url);
    assert_eq!(ask_status(&again).await, 405);
}

#[tokio::test]
async fn a_stopped_turns_conversation_is_kept_until_its_changes_are_settled() {
    let mut r = rig_reaping(Duration::from_millis(300), Duration::from_millis(300));
    let _remote = repo_workspace(&r);
    r.run(start("r0", "mock:echo"));
    let (_, first) = r.finish("r0").await;
    let url = ask_url(&first);
    stopped(&mut r, follow_up("r1", "mock:slow", &first), |ws| std::fs::write(ws.join("turn.txt"), "x\n").unwrap())
        .await;
    // Long past the adapter's and the conversation's idle time.
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(ask_status(&url).await, 405);
    r.send(ServerToDaemon::RunDiscard { run_id: "r1".into() });
    assert_eq!(r.next().await, DaemonToServer::RunDiscarded { run_id: "r1".into(), ok: true, files: 1, error: None });
    assert!(!r.workspace().join("turn.txt").exists());
    until_dropped(&url).await;
}

const ASK: &str =
    r#"mock:ask {"questions":[{"type":"single","title":"用哪种语言？","options":["Python","Go"],"recommended":0}]}"#;

/// Events of the turn up to its question card.
async fn until_question(r: &mut Rig) -> (Vec<RunEvent>, String, Vec<Question>) {
    let mut events = vec![];
    loop {
        match r.next().await {
            DaemonToServer::RunEvent { event, .. } => events.push(event),
            DaemonToServer::QuestionAsk { request_id, questions, .. } => return (events, request_id, questions),
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn answer(r: &Rig, run_id: &str, request_id: &str, answers: Option<Vec<Answer>>) {
    r.send(ServerToDaemon::QuestionAnswer {
        run_id: run_id.into(),
        request_id: request_id.into(),
        answers,
        attachments: vec![],
        answered_by: Some("王磊".into()),
    });
}

#[tokio::test]
async fn the_injected_ask_tool_waits_for_the_answer_without_an_approval() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", ASK));
    let (events, request_id, questions) = until_question(&mut r).await;
    assert_eq!(
        events.last(),
        Some(&RunEvent::Status { status: RunStatus::AwaitingAnswer, step: "等待回答：1 个问题".into() })
    );
    assert_eq!(
        questions,
        vec![Question {
            id: "q1".into(),
            kind: QuestionType::Single,
            title: "用哪种语言？".into(),
            options: vec!["Python".into(), "Go".into()],
            recommended: Some(0),
            option_meta: vec![],
        }]
    );
    // Answers for other runs or requests are ignored.
    answer(&r, "r9", &request_id, Some(vec![]));
    answer(&r, "r1", "nope", Some(vec![]));
    answer(&r, "r1", &request_id, Some(vec![Answer { question_id: "q1".into(), choices: vec![1], text: None }]));
    let (events, done) = r.finish("r1").await;
    assert_eq!(events.first(), Some(&RunEvent::Status { status: RunStatus::Running, step: "王磊 已回答".into() }));
    assert_eq!(
        (done.outcome, done.reply.as_str()),
        (RunOutcome::Completed, "王磊 的回答：\n1. 用哪种语言？（单选）→ Go")
    );

    // Nobody answered in time: the agent is told to go on with its best judgement.
    r.run(follow_up("r2", ASK, &done));
    let (_, request_id, _) = until_question(&mut r).await;
    answer(&r, "r2", &request_id, None);
    let (events, done) = r.finish("r2").await;
    assert_eq!(
        events.first(),
        Some(&RunEvent::Status { status: RunStatus::Running, step: "无人回答，agent 按推荐项继续".into() })
    );
    assert_eq!(done.reply, gonggong::ask::NO_ANSWER);
}

fn append(r: &Rig, run_id: &str, text: &str) {
    r.send(ServerToDaemon::RunAppend {
        run_id: run_id.into(),
        text: text.into(),
        from: "王磊".into(),
        attachments: vec![],
    });
}

#[tokio::test]
async fn append_cancels_the_prompt_and_continues_the_same_run_in_the_same_session() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:slow"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    append(&r, "r9", "mock:echo");
    append(&r, "r1", "mock:echo");
    let (events, done) = r.finish("r1").await;
    assert!(events.contains(&RunEvent::Status { status: RunStatus::Running, step: "王磊 打断并追加".into() }));
    assert_eq!(done.outcome, RunOutcome::Completed);
    // The final reply is what the agent said after the append.
    assert_eq!(echo(&done)["prompt"], "王磊 追加：mock:echo");
    assert_eq!(done.appends_applied, 1);

    // A pending question is withdrawn by an append; the run still ends once, completed.
    r.run(follow_up("r2", ASK, &done));
    let (_, request_id, _) = until_question(&mut r).await;
    append(&r, "r2", "mock:echo");
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
    assert_eq!(next.session_id, done.session_id);
    assert_eq!(echo(&next)["prompt"], "王磊 追加：mock:echo");
    // A late answer to the withdrawn question and a late append are ignored.
    answer(&r, "r2", &request_id, None);
    append(&r, "r2", "mock:echo");
    r.run(follow_up("r3", "mock:echo", &next));
    assert_eq!(r.finish("r3").await.1.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn appended_attachments_are_named_by_their_workspace_path() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:slow"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    let file = Attachment {
        id: "a1".into(),
        name: "log.txt".into(),
        size: 3,
        mime: "text/plain".into(),
        message_id: "m2".into(),
    };
    r.send(ServerToDaemon::RunAppend {
        run_id: "r1".into(),
        text: "mock:echo".into(),
        from: "王磊".into(),
        attachments: vec![file],
    });
    let (_, done) = r.finish("r1").await;
    assert_eq!(
        echo(&done)["prompt"],
        "王磊 追加：mock:echo\n\n附件（已放入工作区）：\n- .gonggong/attachments/m2/log.txt\n"
    );
}

#[tokio::test]
async fn stop_wins_over_a_pending_append() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:slow"));
    assert!(matches!(r.next().await, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. }));
    append(&r, "r1", "mock:echo");
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);
    assert_eq!(done.appends_applied, 0);
}

#[tokio::test]
async fn injects_global_mcp_servers_into_new_and_resumed_sessions() {
    let mut r = rig(Duration::from_millis(200));
    let mut s = start("r1", "mock:echo");
    s.new_session_reason = Some("config_changed".into());
    s.mcp_servers = vec![
        McpServer::Stdio {
            name: "gonggong-echo".into(),
            command: "node".into(),
            args: vec!["server.js".into()],
            env: [("TOKEN".to_string(), "t".to_string())].into(),
        },
        McpServer::Http {
            name: "wiki".into(),
            url: "https://mcp.corp/wiki".into(),
            headers: [("Authorization".to_string(), "Bearer x".to_string())].into(),
        },
    ];
    let wire = serde_json::json!([
        { "name": "gonggong-echo", "command": "node", "args": ["server.js"], "env": [{ "name": "TOKEN", "value": "t" }] },
        { "type": "http", "name": "wiki", "url": "https://mcp.corp/wiki",
          "headers": [{ "name": "Authorization", "value": "Bearer x" }] },
    ]);
    r.run(s.clone());
    let (_, first) = r.finish("r1").await;
    assert_eq!(first.new_session_reason.as_deref(), Some("config_changed"));
    // The built-in ask tool always comes last, on a per-session loopback URL.
    let servers = |done: &RunDone| {
        let mut all = echo(done)["mcpServers"].as_array().unwrap().clone();
        let ask = all.pop().unwrap();
        assert_eq!((ask["type"].as_str(), ask["name"].as_str()), (Some("http"), Some("gonggong")));
        assert!(ask["url"].as_str().unwrap().starts_with("http://127.0.0.1:"));
        (serde_json::Value::Array(all), ask["url"].clone())
    };
    let (globals, url) = servers(&first);
    assert_eq!(globals, wire);

    // After the adapter is reaped, session/resume in a fresh process carries the servers too.
    tokio::time::sleep(Duration::from_millis(600)).await;
    r.run(RunStart { new_session_reason: None, mcp_servers: s.mcp_servers, ..follow_up("r2", "mock:echo", &first) });
    let (_, second) = r.finish("r2").await;
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(servers(&second), (wire, url));
}

#[tokio::test]
async fn forwards_the_agents_available_commands() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:commands"));
    let commands = loop {
        match r.next().await {
            DaemonToServer::CommandsUpdate { group_id, bot_id, commands } => {
                assert_eq!((group_id.as_str(), bot_id.as_str()), ("g1", "b1"));
                break commands;
            }
            DaemonToServer::RunEvent { .. } => {}
            other => panic!("unexpected {other:?}"),
        }
    };
    let names: Vec<_> = commands.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["compact", "new"]);
    assert_eq!(commands[0].description, "Compact the conversation");
    assert_eq!(r.finish("r1").await.1.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn reports_a_failed_codex_auto_review() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:auto-review"));
    let (events, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert!(events.iter().any(|e| matches!(e,
        RunEvent::Status { status: RunStatus::Running, step }
            if step == "Codex 自动审查失败，操作被拒绝：Status: Denied\nRationale: 403 Forbidden")));
}

#[tokio::test]
async fn lists_files_of_the_bot_workspace() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    std::fs::write(r.workspace().join("notes.md"), "x").unwrap();
    let list = |request_id: &str, cd_path: Option<String>| {
        ServerToDaemon::FilesList(FilesList {
            request_id: request_id.into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: WorkspaceSpec { repo: None, cd_path, protect_base: false, extra_dirs: vec![] },
            query: "".into(),
            limit: 10,
        })
    };
    r.send(list("f1", None));
    match r.next().await {
        DaemonToServer::FilesResult { request_id, entries, error } => {
            assert_eq!((request_id.as_str(), error), ("f1", None));
            let got: Vec<_> = entries.iter().map(|e| (e.path.as_str(), e.uncommitted)).collect();
            assert_eq!(got, [("README.md", false), ("notes.md", true)]);
        }
        other => panic!("unexpected {other:?}"),
    }
    r.send(list("f2", Some("/definitely/not/here".into())));
    match r.next().await {
        DaemonToServer::FilesResult { request_id, entries, error } => {
            assert_eq!(request_id, "f2");
            assert!(entries.is_empty() && error.is_some());
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test]
async fn browses_and_reads_the_bot_workspace_read_only() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    std::fs::write(r.workspace().join("notes.md"), "# 笔记\n").unwrap();
    let workspace = WorkspaceSpec { repo: None, cd_path: None, protect_base: false, extra_dirs: vec![] };
    r.send(ServerToDaemon::FilesTree(FilesTree {
        request_id: "t1".into(),
        group_id: "g1".into(),
        bot_id: "b1".into(),
        workspace: workspace.clone(),
        path: "".into(),
        show_ignored: false,
    }));
    match r.next().await {
        DaemonToServer::FilesTreeResult { request_id, entries, truncated, error } => {
            assert_eq!((request_id.as_str(), truncated, error), ("t1", false, None));
            let got: Vec<_> = entries.iter().map(|e| (e.name.as_str(), e.uncommitted)).collect();
            assert_eq!(got, [("notes.md", true), ("README.md", false)]);
        }
        other => panic!("unexpected {other:?}"),
    }
    let read = |request_id: &str, path: &str| {
        ServerToDaemon::FilesRead(FilesRead {
            request_id: request_id.into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: workspace.clone(),
            path: path.into(),
            max_bytes: 2 * 1024 * 1024,
        })
    };
    r.send(read("r1", "notes.md"));
    match r.next().await {
        DaemonToServer::FilesReadResult { request_id, size, binary, text, error, .. } => {
            assert_eq!((request_id.as_str(), size, binary, error), ("r1", 9, false, None));
            assert_eq!(text.as_deref(), Some("# 笔记\n"));
        }
        other => panic!("unexpected {other:?}"),
    }
    r.send(read("r2", "../../x"));
    match r.next().await {
        DaemonToServer::FilesReadResult { request_id, text, error, .. } => {
            assert_eq!((request_id.as_str(), text), ("r2", None));
            assert!(error.unwrap().contains("超出工作区"));
        }
        other => panic!("unexpected {other:?}"),
    }
}

fn running(step: &str) -> RunEvent {
    RunEvent::Status { status: RunStatus::Running, step: step.into() }
}

fn configured(r: &mut Rig, run_id: &str) -> (Option<String>, Option<String>) {
    let i = r.configs.iter().position(|(id, ..)| id == run_id).expect("session.config reported");
    let (_, model, effort) = r.configs.remove(i);
    (model, effort)
}

fn with_config(s: RunStart, model: Option<&str>, effort: Option<&str>) -> RunStart {
    let bot = RunBot { model: model.map(Into::into), effort: effort.map(Into::into), ..s.bot.clone() };
    RunStart { bot, ..s }
}

#[tokio::test]
async fn applies_the_requested_model_and_effort_once_per_session() {
    let mut r = rig(Duration::from_secs(60));
    r.run(with_config(start("r1", "mock:echo"), Some("opus"), Some("max")));
    let (events, done) = r.finish("r1").await;
    let e = echo(&done);
    assert_eq!((e["model"].as_str(), e["effort"].as_str()), (Some("opus"), Some("max")));
    assert_eq!(e["configSets"], serde_json::json!(["model=opus", "effort=max"]));
    assert!(events.contains(&running("已切换模型：Opus")));
    assert!(events.contains(&running("已切换推理强度：Max")));
    assert_eq!(configured(&mut r, "r1"), (Some("opus".into()), Some("max".into())));

    // Same request, same session: nothing to switch.
    r.run(with_config(follow_up("r2", "mock:echo", &done), Some("opus"), Some("max")));
    let (events, done) = r.finish("r2").await;
    assert_eq!(echo(&done)["configSets"].as_array().unwrap().len(), 2);
    assert!(!events.iter().any(|e| matches!(e, RunEvent::Status { step, .. } if step.starts_with("已切换"))));

    // A model without thought levels.
    r.run(with_config(follow_up("r3", "mock:echo", &done), Some("haiku"), None));
    let (_, done) = r.finish("r3").await;
    assert_eq!(configured(&mut r, "r3"), (Some("haiku".into()), None));

    // Nothing requested: back to the session's initial values; the adapter's "default" reads as none.
    r.run(follow_up("r4", "mock:echo", &done));
    let (_, done) = r.finish("r4").await;
    let e = echo(&done);
    assert_eq!((e["model"].as_str(), e["effort"].as_str()), (Some("default"), Some("medium")));
    assert_eq!(configured(&mut r, "r4"), (None, Some("medium".into())));

    // A model the adapter does not offer is reported, and the run goes on with the current one.
    r.run(with_config(follow_up("r5", "mock:echo", &done), Some("gpt-x"), None));
    let (events, done) = r.finish("r5").await;
    assert_eq!((done.outcome, echo(&done)["model"].as_str()), (RunOutcome::Completed, Some("default")));
    assert!(events.iter().any(|e| matches!(e, RunEvent::Status { step, .. } if step.starts_with("模型 gpt-x 不可用"))));

    // Switching models reset the effort in between: an effort set before is applied again.
    r.run(with_config(follow_up("r6", "mock:echo", &done), Some("opus"), Some("max")));
    let (_, done) = r.finish("r6").await;
    assert_eq!(echo(&done)["effort"], "max");
    assert_eq!(configured(&mut r, "r6"), (Some("opus".into()), Some("max".into())));
}

#[tokio::test]
async fn probes_models_and_their_thought_levels() {
    let r = rig(Duration::from_secs(60));
    let catalog = r.engine.probe(AgentKind::Claude).await.unwrap();
    let choice = |value: &str, name: &str| Choice { value: value.into(), name: name.into(), description: None };
    let levels = |names: &[&str]| names.iter().map(|n| choice(&n.to_lowercase(), n)).collect::<Vec<_>>();
    assert_eq!(catalog.current, None);
    assert_eq!((catalog.efforts, catalog.effort.as_deref()), (levels(&["Low", "Medium", "High"]), Some("medium")));
    assert_eq!(
        catalog.models,
        [
            ModelChoice {
                choice: Choice { description: Some("Fastest".into()), ..choice("haiku", "Haiku") },
                efforts: vec![],
                effort: None,
            },
            ModelChoice {
                choice: choice("opus", "Opus"),
                efforts: levels(&["Low", "Medium", "High", "Max"]),
                effort: Some("medium".into()),
            },
        ]
    );
}

/// `start` with the bot's 命令审批 as the server sends it (plan J8).
fn with_rules(s: RunStart, approval: Approval, allowlist: &[&str]) -> RunStart {
    let allowlist = allowlist.iter().map(|c| c.to_string()).collect();
    RunStart { bot: RunBot { approval, allowlist, ..s.bot.clone() }, ..s }
}

#[tokio::test]
async fn server_sent_approval_rules_answer_permissions_without_the_owner() {
    let mut r = rig(Duration::from_secs(60));
    // `finish` panics on an approval.request: none may be sent.
    r.run(with_rules(start("r1", "mock:exec node   -e 1"), Approval::Allowlist, &["node -e"]));
    let (events, done) = r.finish("r1").await;
    assert!(events.contains(&running("已按命令审批规则自动批准：node   -e 1")));
    assert_eq!(done.reply, "ran");

    let s = with_rules(follow_up("r2", "mock:exec node -e 1; rm -rf x", &done), Approval::Allowlist, &["node -e"]);
    r.run(s);
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!(approval.tool_kind, "execute");
    decide(&r, &approval, Some("reject"));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.reply, "denied");

    r.run(with_rules(follow_up("r3", "写个文件", &done), Approval::All, &[]));
    let (events, done) = r.finish("r3").await;
    assert!(events.contains(&running("已按命令审批规则自动批准：Write hello.txt")));
    assert_eq!(done.reply, "好的，已写入 hello.txt。");
}

#[tokio::test]
async fn server_sent_ask_goes_to_the_owner_whatever_the_old_local_file_says() {
    let mut r = rig(Duration::from_secs(60));
    // Plan J10: rules of older versions in local.json are ignored.
    let old = r#"{"bots":{"b1":{"approval":"all","allowlist":["node -e"]}}}"#;
    std::fs::write(LocalSettings::path(r.home.path()), old).unwrap();
    r.run(with_rules(start("r1", "mock:exec node -e 1"), Approval::Ask, &["node -e"]));
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!(approval.tool_kind, "execute");
    decide(&r, &approval, Some("allow"));
    assert_eq!(r.finish("r1").await.1.reply, "ran");
}

#[tokio::test]
async fn read_tools_are_auto_allowed_only_inside_the_workspace() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:exec rg -n TODO ."));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r2", "mock:read src/lib.rs", &done));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.reply, "read");

    r.run(follow_up("r3", "mock:search src", &done));
    let (_, done) = r.finish("r3").await;
    assert_eq!(done.reply, "read");

    r.run(follow_up("r4", "mock:read /etc/passwd", &done));
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!(approval.reason, ApprovalReason::NotAllowed);
    decide(&r, &approval, Some("reject"));
    assert_eq!(r.finish("r4").await.1.reply, "denied");
}

#[tokio::test]
async fn always_allowing_a_command_trusts_it_for_the_conversation() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:exec pnpm lint --fix"));
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!(approval.remember, ["pnpm lint"]);
    decide(&r, &approval, Some("always"));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r2", "mock:exec pnpm lint 2>&1 | tail -3", &done));
    let (events, done) = r.finish("r2").await;
    assert!(events.contains(&running("已按命令审批规则自动批准：pnpm lint 2>&1 | tail -3")));
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r3", "mock:exec pnpm lint && rm -rf x", &done));
    let (_, approval) = until_approval(&mut r).await;
    decide(&r, &approval, Some("reject"));
    assert_eq!(r.finish("r3").await.1.reply, "denied");
}

#[tokio::test]
async fn the_bots_always_allow_rules_apply_and_the_floor_still_asks() {
    let mut r = rig(Duration::from_secs(60));
    let s = start("r1", "mock:exec pnpm lint --fix");
    let rules = |s: RunStart| RunStart { bot: RunBot { always_allow: vec!["pnpm lint".into()], ..s.bot.clone() }, ..s };
    r.run(rules(s));
    let (events, done) = r.finish("r1").await;
    assert!(events.contains(&running("已按命令审批规则自动批准：pnpm lint --fix")));

    r.run(rules(follow_up("r2", "mock:exec git status && ls", &done)));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.reply, "ran");

    r.run(with_rules(follow_up("r3", "mock:exec sudo ls", &done), Approval::All, &[]));
    let (_, approval) = until_approval(&mut r).await;
    assert!(approval.remember.is_empty());
    decide(&r, &approval, Some("reject"));
    assert_eq!(r.finish("r3").await.1.reply, "denied");
}

#[tokio::test]
async fn a_corrupt_local_settings_file_fails_the_run() {
    let mut r = rig(Duration::from_secs(60));
    std::fs::write(LocalSettings::path(r.home.path()), "{").unwrap();
    r.run(start("r1", "mock:echo"));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert!(done.error.unwrap().contains("local.json"), "error names the file");
}

#[tokio::test]
async fn attributes_subagent_work_and_reports_background_tasks_after_the_run() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:subagent"));
    let (events, done) = r.finish("r1").await;
    assert_eq!(done.reply, "完成");
    let child = events
        .iter()
        .find_map(|e| match e {
            RunEvent::Subagent { agent_id, name, state: SubagentState::Running, .. } if name == "Explore" => {
                Some(agent_id.clone())
            }
            _ => None,
        })
        .expect("subagent spawned");
    let sub = Some(child.clone());
    assert!(events.contains(&RunEvent::Text { delta: "子 agent 报告".into(), agent_id: sub.clone() }));
    assert!(
        events
            .iter()
            .any(|e| matches!(e, RunEvent::Tool { agent_id, title, .. } if *agent_id == sub && title == "Read a.rs"))
    );
    assert!(events.iter().any(|e| matches!(e, RunEvent::Subagent { state: SubagentState::Completed, .. })));
    assert!(events.iter().any(|e| matches!(e,
        RunEvent::Task { task_id, agent_id, state: TaskState::Running, .. } if task_id == "bg1" && *agent_id == sub)));

    let DaemonToServer::RunEvent { run_id, event } = r.next().await else { panic!("expected the task's end") };
    assert_eq!(run_id, "r1");
    assert!(
        matches!(event, RunEvent::Task { state: TaskState::Completed, summary: Some(s), name, .. } if s == "exit 0" && name == "pnpm dev")
    );
}

#[tokio::test]
#[ignore = "requires a real Codex ACP adapter, Codex CLI and authenticated account"]
async fn real_codex_streams_subagent_work() {
    let home = tempfile::tempdir().unwrap();
    let user_home = PathBuf::from(std::env::var("HOME").unwrap());
    let adapter = user_home.join(".gonggong/adapters/node_modules/@agentclientprotocol/codex-acp/dist/index.js");
    let cli = user_home.join(".gonggong/adapters/node_modules/@openai/codex/bin/codex.js");
    let mut settings = LocalSettings::default();
    settings.agents.insert(AgentKind::Codex, gonggong::local::AgentSettings { path: Some(cli.display().to_string()) });
    settings.save(home.path()).unwrap();
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home,
        adapter_cmd: Some(format!("node {}", adapter.display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Continuation::default(),
        api: None,
    });
    let (out, mut rx) = Outbox::channel();
    let mut request = start(
        "real-codex",
        "Spawn exactly one subagent. Ask it to execute printf SUBAGENT_PROBE_OK and report its output. Wait for it to finish.",
    );
    request.bot.agent_kind = AgentKind::Codex;
    request.bot.system_prompt.clear();
    request.bot.tier = Tier::Full;
    request.bot.approval = Approval::All;
    request.prompt.context.clear();
    engine.handle(ServerToDaemon::RunStart(Box::new(request)), &out);
    let mut spawned = None;
    let mut child_tool = false;
    let mut child_text = String::new();
    let mut finished = false;
    tokio::time::timeout(Duration::from_secs(180), async {
        while let Some(message) = rx.recv().await {
            match message {
                DaemonToServer::RunEvent { event: RunEvent::Subagent { agent_id, state, .. }, .. } => {
                    if state == SubagentState::Running {
                        spawned = Some(agent_id);
                    } else if Some(&agent_id) == spawned.as_ref() && state == SubagentState::Completed {
                        finished = true;
                    }
                }
                DaemonToServer::RunEvent {
                    event: RunEvent::Tool { agent_id: Some(id), title, detail, .. }, ..
                } => {
                    child_tool |= Some(&id) == spawned.as_ref()
                        && (title.contains("SUBAGENT_PROBE_OK")
                            || detail.is_some_and(|d| d.contains("SUBAGENT_PROBE_OK")));
                }
                DaemonToServer::RunEvent { event: RunEvent::Text { agent_id: Some(id), delta }, .. } => {
                    if Some(&id) == spawned.as_ref() {
                        child_text.push_str(&delta);
                    }
                }
                DaemonToServer::RunDone(done) => {
                    assert_eq!(done.outcome, RunOutcome::Completed, "{}", done.reply);
                    return;
                }
                _ => {}
            }
        }
        panic!("outbox closed before the run finished");
    })
    .await
    .expect("real Codex run timed out");
    assert!(
        spawned.is_some() && child_tool && child_text.contains("SUBAGENT_PROBE_OK") && finished,
        "spawned={spawned:?}, child_tool={child_tool}, child_text={child_text:?}, finished={finished}"
    );
}

#[tokio::test]
async fn stops_a_background_task_that_outlived_its_run() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:bgtask"));
    let (events, _) = r.finish("r1").await;
    assert!(events.iter().any(|e| matches!(e, RunEvent::Task { task_id, can_stop: true, .. } if task_id == "bg2")));

    r.send(ServerToDaemon::TaskStop { run_id: "r1".into(), task_id: "bg2".into() });
    let DaemonToServer::RunEvent { run_id, event } = r.next().await else { panic!("expected the task's end") };
    assert_eq!(run_id, "r1");
    assert!(matches!(event, RunEvent::Task { state: TaskState::Stopped, can_stop: false, .. }));
}

/// Skips the background task reports of the ended turn up to the daemon asking for a continuation run:
/// (request id, the run continued).
async fn until_continue(r: &mut Rig) -> (String, String) {
    loop {
        match r.next().await {
            DaemonToServer::RunContinue { request_id, run_id } => return (request_id, run_id),
            DaemonToServer::RunEvent { event: RunEvent::Task { .. }, .. } => {}
            other => panic!("unexpected {other:?}"),
        }
    }
}

/// Runs `text` (a `mock:later` turn) as r1, then opens the continuation c1 the daemon asks for.
async fn continued(r: &mut Rig, text: &str) -> RunDone {
    r.run(start("r1", text));
    let (_, first) = r.finish("r1").await;
    assert_eq!(first.reply, "等它跑完我再继续");
    let (request_id, run_id) = until_continue(r).await;
    assert_eq!(run_id, "r1");
    r.send(ServerToDaemon::RunContinued { request_id, run_id: Some("c1".into()) });
    first
}

#[tokio::test]
async fn reports_what_the_agent_does_after_a_background_task_under_a_new_run() {
    let mut r = rig(Duration::from_secs(60));
    let first = continued(&mut r, "mock:later").await;
    let (events, done) = r.finish("c1").await;
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert_eq!(done.reply, "后台任务跑完了，继续收尾。");
    assert_eq!(done.session_id, first.session_id);
    assert_eq!(events.first(), Some(&RunEvent::Text { delta: "后台任务跑完了，".into(), agent_id: None }));
    assert!(events.iter().any(|e| matches!(e, RunEvent::Tool { title, .. } if title == "Read log.txt")));
    assert_eq!(done.usage.as_ref().and_then(|u| u.cost_usd), Some(0.02));

    // The conversation goes on as usual.
    r.run(follow_up("r2", "mock:echo", &done));
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn a_continuation_asks_the_owner_for_approval_under_its_run() {
    let mut r = rig(Duration::from_secs(60));
    continued(&mut r, "mock:later-exec").await;
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!((approval.run_id.as_str(), approval.title.as_str()), ("c1", "rm -rf dist"));
    decide(&r, &approval, Some("allow"));
    let (_, done) = r.finish("c1").await;
    assert_eq!(done.reply, "后台任务跑完了，ran");
}

#[tokio::test]
async fn a_new_turn_ends_the_continuation_first() {
    let mut r = rig(Duration::from_secs(60));
    let first = continued(&mut r, "mock:later-open").await;
    until_of(
        &mut r,
        "c1",
        |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { delta, .. }, .. } if delta == "继续收尾。"),
    )
    .await;
    r.run(follow_up("r2", "mock:echo", &first));
    let DaemonToServer::RunDone(done) = r.next().await else { panic!("the continuation ends before r2 starts") };
    assert_eq!((done.run_id.as_str(), done.outcome), ("c1", RunOutcome::Completed));
    assert_eq!(done.reply, "后台任务跑完了，继续收尾。");
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn a_silent_continuation_ends_after_the_quiet_period_and_one_can_stop_it() {
    let mut r = rig_continuing(Continuation { adopt_wait: Duration::from_secs(10), quiet: Duration::from_secs(1) });
    continued(&mut r, "mock:later-open").await;
    let (_, done) = r.finish("c1").await;
    assert_eq!(done.outcome, RunOutcome::Completed);

    r.run(follow_up("r2", "mock:later-open", &done));
    r.finish("r2").await;
    let (request_id, _) = until_continue(&mut r).await;
    r.send(ServerToDaemon::RunContinued { request_id, run_id: Some("c2".into()) });
    until_of(&mut r, "c2", |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).await;
    r.send(ServerToDaemon::RunCancel { run_id: "c2".into() });
    let (_, done) = done_of(&mut r, "c2").await;
    assert_eq!(done.outcome, RunOutcome::Interrupted);
}

#[tokio::test]
async fn without_a_run_from_the_server_the_continuation_is_dropped() {
    let mut r = rig_continuing(Continuation { adopt_wait: Duration::from_millis(500), quiet: Duration::from_secs(20) });
    r.run(start("r1", "mock:later"));
    let (_, first) = r.finish("r1").await;
    // An older server ignores the request.
    let (request_id, _) = until_continue(&mut r).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    // A run opened too late is ended at once.
    r.send(ServerToDaemon::RunContinued { request_id, run_id: Some("c1".into()) });
    let DaemonToServer::RunDone(done) = r.next().await else { panic!("expected the late run to end") };
    assert_eq!((done.run_id.as_str(), done.outcome, done.reply.as_str()), ("c1", RunOutcome::Completed, ""));

    r.run(follow_up("r2", "mock:echo", &first));
    let (_, next) = r.finish("r2").await;
    assert_eq!(next.outcome, RunOutcome::Completed);
}

/// A run of another group bound (/cd) to the shared directory `dir`.
fn in_dir(run_id: &str, group: &str, text: &str, dir: &Path) -> RunStart {
    let mut s = start(run_id, text);
    s.group_id = group.into();
    s.group_name = group.into();
    s.workspace.cd_path = Some(dir.to_string_lossy().into());
    s
}

fn run_of(msg: &DaemonToServer) -> Option<&str> {
    match msg {
        DaemonToServer::RunEvent { run_id, .. }
        | DaemonToServer::QuestionAsk { run_id, .. }
        | DaemonToServer::QuestionWithdraw { run_id, .. } => Some(run_id),
        DaemonToServer::RunDone(d) => Some(&d.run_id),
        _ => None,
    }
}

/// Messages of `run_id` up to (and including) the first one `stop` accepts; other runs' messages are skipped.
async fn until_of(r: &mut Rig, run_id: &str, stop: impl Fn(&DaemonToServer) -> bool) -> Vec<DaemonToServer> {
    let mut seen = vec![];
    loop {
        let msg = r.next().await;
        if run_of(&msg) != Some(run_id) {
            continue;
        }
        let last = stop(&msg);
        seen.push(msg);
        if last {
            return seen;
        }
    }
}

async fn dir_question(r: &mut Rig, run_id: &str) -> (String, Question) {
    let seen = until_of(r, run_id, |m| matches!(m, DaemonToServer::QuestionAsk { .. })).await;
    let Some(DaemonToServer::QuestionAsk { request_id, mut questions, .. }) = seen.into_iter().last() else {
        unreachable!()
    };
    (request_id, questions.remove(0))
}

async fn done_of(r: &mut Rig, run_id: &str) -> (Vec<DaemonToServer>, RunDone) {
    let mut seen = until_of(r, run_id, |m| matches!(m, DaemonToServer::RunDone(_))).await;
    let Some(DaemonToServer::RunDone(done)) = seen.pop() else { unreachable!() };
    (seen, done)
}

fn choose(r: &Rig, run_id: &str, request_id: &str, choice: u32) {
    answer(r, run_id, request_id, Some(vec![Answer { question_id: "q1".into(), choices: vec![choice], text: None }]));
}

#[tokio::test]
async fn a_busy_directory_runs_in_parallel_only_after_confirmation() {
    let mut r = rig(Duration::from_secs(60));
    let dir = tempfile::tempdir().unwrap();
    r.run(in_dir("r1", "g1", "mock:slow", dir.path()));
    until_of(&mut r, "r1", |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).await;

    r.run(in_dir("r2", "g2", "mock:echo", dir.path()));
    let (request_id, q) = dir_question(&mut r, "r2").await;
    assert!(request_id.starts_with("r2/"), "{request_id}");
    assert_eq!(
        (q.kind, q.options.as_slice(), q.recommended),
        (QuestionType::Single, &["并行开始".to_string(), "排队等待".to_string()][..], Some(1))
    );
    assert!(q.title.contains("小王的 Claude（群「g1」）"), "{}", q.title);
    choose(&r, "r2", &request_id, 0);
    let (seen, done) = done_of(&mut r, "r2").await;
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert!(
        seen.iter()
            .any(|m| matches!(m, DaemonToServer::RunEvent { event, .. } if *event == running("王磊 确认并行运行")))
    );

    // Choosing to queue waits for the directory to be free.
    r.run(in_dir("r3", "g3", "mock:echo", dir.path()));
    let (request_id, _) = dir_question(&mut r, "r3").await;
    choose(&r, "r3", &request_id, 1);
    until_of(
        &mut r,
        "r3",
        |m| matches!(m, DaemonToServer::RunEvent { event, .. } if *event == running("王磊 选择排队，等待工作区空闲")),
    )
    .await;
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let mut order = vec![];
    while order.len() < 2 {
        if let DaemonToServer::RunDone(d) = r.next().await {
            order.push((d.run_id, d.outcome));
        }
    }
    assert_eq!(order, [("r1".into(), RunOutcome::Interrupted), ("r3".into(), RunOutcome::Completed)]);
}

#[tokio::test]
async fn the_confirmation_is_withdrawn_once_the_directory_frees_up() {
    let mut r = rig(Duration::from_secs(60));
    let dir = tempfile::tempdir().unwrap();
    r.run(in_dir("r1", "g1", "mock:slow", dir.path()));
    until_of(&mut r, "r1", |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).await;
    r.run(in_dir("r2", "g2", "mock:echo", dir.path()));
    let (request_id, _) = dir_question(&mut r, "r2").await;
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    let seen = until_of(&mut r, "r2", |m| matches!(m, DaemonToServer::QuestionWithdraw { .. })).await;
    assert!(matches!(seen.last(), Some(DaemonToServer::QuestionWithdraw { request_id: id, .. }) if *id == request_id));
    // A late answer to the withdrawn card changes nothing.
    choose(&r, "r2", &request_id, 0);
    assert_eq!(done_of(&mut r, "r2").await.1.outcome, RunOutcome::Completed);
}

#[tokio::test]
async fn cancelling_a_turn_asking_about_a_busy_directory_interrupts_it_at_once() {
    let mut r = rig(Duration::from_secs(60));
    let dir = tempfile::tempdir().unwrap();
    r.run(in_dir("r1", "g1", "mock:slow", dir.path()));
    until_of(&mut r, "r1", |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).await;
    r.run(in_dir("r2", "g2", "mock:echo", dir.path()));
    let (request_id, _) = dir_question(&mut r, "r2").await;

    r.send(ServerToDaemon::RunCancel { run_id: "r2".into() });
    let mut seen = vec![];
    let done = loop {
        match r.next().await {
            DaemonToServer::RunDone(d) if d.run_id == "r2" => break d,
            DaemonToServer::RunDone(d) => panic!("the holder must not end: {d:?}"),
            msg => seen.push(msg),
        }
    };
    assert_eq!(done.outcome, RunOutcome::Interrupted);
    assert!(
        seen.iter().any(|m| matches!(m, DaemonToServer::QuestionWithdraw { request_id: id, .. } if *id == request_id))
    );

    // The holder keeps the directory and is only stopped by its own cancel.
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    assert_eq!(r.finish("r1").await.1.outcome, RunOutcome::Interrupted);
}

#[tokio::test]
async fn cancelling_a_queued_turn_interrupts_it_while_the_directory_is_busy() {
    let mut r = rig(Duration::from_secs(60));
    let dir = tempfile::tempdir().unwrap();
    r.run(in_dir("r1", "g1", "mock:slow", dir.path()));
    until_of(&mut r, "r1", |m| matches!(m, DaemonToServer::RunEvent { event: RunEvent::Text { .. }, .. })).await;
    r.run(in_dir("r2", "g2", "mock:echo", dir.path()));
    let (request_id, _) = dir_question(&mut r, "r2").await;
    choose(&r, "r2", &request_id, 1);
    until_of(
        &mut r,
        "r2",
        |m| matches!(m, DaemonToServer::RunEvent { event, .. } if *event == running("王磊 选择排队，等待工作区空闲")),
    )
    .await;

    r.send(ServerToDaemon::RunCancel { run_id: "r2".into() });
    let done = loop {
        match r.next().await {
            DaemonToServer::RunDone(d) if d.run_id == "r2" => break d,
            DaemonToServer::RunDone(d) => panic!("the holder must not end: {d:?}"),
            _ => {}
        }
    };
    assert_eq!(done.outcome, RunOutcome::Interrupted);
    r.send(ServerToDaemon::RunCancel { run_id: "r1".into() });
    assert_eq!(r.finish("r1").await.1.outcome, RunOutcome::Interrupted);
}
