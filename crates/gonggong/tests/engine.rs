//! Drives the Engine against the scriptable mock ACP agent (tools/mock-agent) without a server.
use gonggong::engine::{Engine, EngineConfig};
use gonggong::local::{Approval, BotSettings, LocalSettings};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: UnboundedReceiver<DaemonToServer>,
    home: tempfile::TempDir,
    /// session.config reports (run id, model, effort), set aside by `next`.
    configs: Vec<(String, Option<String>, Option<String>)>,
}

fn rig(idle: Duration) -> Rig {
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle,
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
        },
        workspace: WorkspaceSpec { repo: None, cd_path: None },
        resume_session_id: None,
        new_session_reason: None,
        mcp_servers: vec![],
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
                DaemonToServer::SessionConfig { run_id, model, effort } => self.configs.push((run_id, model, effort)),
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
            options: vec![
                PermissionOption { option_id: "allow".into(), name: "Allow".into(), kind: PermissionKind::AllowOnce },
                PermissionOption {
                    option_id: "reject".into(),
                    name: "Reject".into(),
                    kind: PermissionKind::RejectOnce
                },
            ],
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
async fn repo_workspace_fetches_fast_forwards_and_reports_git_changes() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    r.run(start("r1", "mock:echo"));
    let (events, done) = r.finish("r1").await;
    assert_eq!(
        events.first(),
        Some(&RunEvent::Status {
            status: RunStatus::Running,
            step: "git fetch 完成，当前分支 main，已自动快进 1 个 commit 到 origin/main，落后 origin/main 0 个 commit，领先 0 个"
                .into()
        })
    );
    assert!(r.workspace().join("later.txt").exists());
    assert!(
        echo(&done)["prompt"].as_str().unwrap().starts_with(
            "git 默认动作：fetch 完成；当前分支 main；已自动快进 1 个 commit 到 origin/main；落后 origin/main 0 个 commit，领先 0 个。\n\n群聊上下文："
        )
    );
    let clean = GitStatus {
        branch: Some("main".into()),
        ahead: Some(0),
        behind: Some(0),
        dirty: false,
        workspace: WorkspaceKind::Managed,
    };
    assert_eq!(done.git, Some(clean.clone()));
    assert_eq!(done.files_changed, 0);

    // Shell edits and commits (as Codex does) are counted through git, not tool locations.
    let sh = "mock:sh echo a > a.txt && echo b > README.md && git add README.md && git -c user.name=t -c user.email=t@t commit -qm edit && echo c > c.txt";
    r.run(follow_up("r2", sh, &done));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    assert_eq!(done.files_changed, 3);
    assert_eq!(done.git, Some(GitStatus { ahead: Some(1), dirty: true, ..clean }));
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
            workspace: WorkspaceSpec { repo: None, cd_path: None },
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

#[tokio::test]
async fn discard_restores_the_interrupted_turn_until_the_next_turn_starts() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    let ws = r.workspace();
    r.run(start("r0", "mock:echo"));
    let (_, first) = r.finish("r0").await;
    std::fs::write(ws.join("README.md"), "local wip\n").unwrap();

    r.run(follow_up("r1", "mock:sh echo x > turn.txt && echo y > later.txt", &first));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.files_changed, 2);
    r.send(ServerToDaemon::RunDiscard { run_id: "r1".into() });
    assert_eq!(r.next().await, DaemonToServer::RunDiscarded { run_id: "r1".into(), ok: true, files: 2, error: None });
    assert!(!ws.join("turn.txt").exists());
    assert_eq!(std::fs::read_to_string(ws.join("later.txt")).unwrap(), "x\n");
    assert_eq!(std::fs::read_to_string(ws.join("README.md")).unwrap(), "local wip\n");

    // Once discarded, or once the next turn has started, the snapshot is gone.
    r.send(ServerToDaemon::RunDiscard { run_id: "r1".into() });
    assert!(matches!(r.next().await, DaemonToServer::RunDiscarded { ok: false, error: Some(_), .. }));
    r.run(follow_up("r2", "mock:sh echo z > z.txt", &done));
    let (_, next) = r.finish("r2").await;
    r.run(follow_up("r3", "mock:echo", &next));
    r.finish("r3").await;
    r.send(ServerToDaemon::RunDiscard { run_id: "r2".into() });
    assert!(matches!(r.next().await, DaemonToServer::RunDiscarded { ok: false, .. }));
    assert!(ws.join("z.txt").exists());
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
async fn lists_files_of_the_bot_workspace() {
    let mut r = rig(Duration::from_secs(60));
    let _remote = repo_workspace(&r);
    std::fs::write(r.workspace().join("notes.md"), "x").unwrap();
    let list = |request_id: &str, cd_path: Option<String>| {
        ServerToDaemon::FilesList(FilesList {
            request_id: request_id.into(),
            group_id: "g1".into(),
            bot_id: "b1".into(),
            workspace: WorkspaceSpec { repo: None, cd_path },
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

fn save_local(r: &Rig, edit: impl FnOnce(&mut LocalSettings)) {
    let mut local = LocalSettings::default();
    edit(&mut local);
    local.save(r.home.path()).unwrap();
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

#[tokio::test]
async fn local_approval_rules_answer_permissions_without_the_owner() {
    let mut r = rig(Duration::from_secs(60));
    save_local(&r, |l| {
        let bot = BotSettings { approval: Approval::Allowlist, allowlist: vec!["node -e".into()] };
        l.bots.insert("b1".into(), bot);
    });
    // `finish` panics on an approval.request: none may be sent.
    r.run(start("r1", "mock:exec node   -e 1"));
    let (events, done) = r.finish("r1").await;
    assert!(events.contains(&running("已按本机规则自动批准：node   -e 1")));
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r2", "mock:exec node -e 1; rm -rf x", &done));
    let (_, approval) = until_approval(&mut r).await;
    assert_eq!(approval.tool_kind, "execute");
    decide(&r, &approval, Some("reject"));
    let (_, done) = r.finish("r2").await;
    assert_eq!(done.reply, "denied");

    save_local(&r, |l| {
        l.bots.insert("b1".into(), BotSettings { approval: Approval::All, ..Default::default() });
    });
    r.run(follow_up("r3", "写个文件", &done));
    let (events, done) = r.finish("r3").await;
    assert!(events.contains(&running("已按本机规则自动批准：Write hello.txt")));
    assert_eq!(done.reply, "好的，已写入 hello.txt。");
}

#[tokio::test]
async fn always_allowing_a_command_trusts_it_for_the_conversation() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:exec pnpm lint"));
    let (_, approval) = until_approval(&mut r).await;
    decide(&r, &approval, Some("always"));
    let (_, done) = r.finish("r1").await;
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r2", "mock:exec pnpm lint 2>&1 | tail -3", &done));
    let (events, done) = r.finish("r2").await;
    assert!(events.contains(&running("已按本机规则自动批准：pnpm lint 2>&1 | tail -3")));
    assert_eq!(done.reply, "ran");

    r.run(follow_up("r3", "mock:exec pnpm lint && rm -rf x", &done));
    let (_, approval) = until_approval(&mut r).await;
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
