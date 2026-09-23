//! Drives the Engine against the scriptable mock ACP agent (tools/mock-agent) without a server.
use aiws::engine::{Engine, EngineConfig};
use aiws::protocol::*;
use aiws::service::{Handler, Outbox};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: UnboundedReceiver<DaemonToServer>,
    home: tempfile::TempDir,
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
    Rig { engine, out, rx, home }
}

/// The follow-up turn as the server sends it: carrying the session id stored from the previous run.done.
fn follow_up(run_id: &str, text: &str, prev: &RunDone) -> RunStart {
    RunStart { resume_session_id: prev.session_id.clone(), ..start(run_id, text) }
}

fn start(run_id: &str, text: &str) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: AgentKind::Claude,
            system_prompt: "只改 server/".into(),
            tier: Tier::Workspace,
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
        tokio::time::timeout(Duration::from_secs(20), self.rx.recv()).await.expect("engine went quiet").unwrap()
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
    assert_eq!(events.first(), Some(&RunEvent::Text { delta: "好的，".into() }));
    assert!(events.contains(&RunEvent::Thought { delta: "需要写一个文件".into() }));
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
async fn injects_cwd_mode_system_prompt_and_context_then_reuses_the_session() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "mock:echo"));
    let (_, first) = r.finish("r1").await;
    let e = echo(&first);
    assert_eq!(Path::new(e["cwd"].as_str().unwrap()).canonicalize().unwrap(), r.workspace().canonicalize().unwrap());
    assert_eq!(e["mode"], "acceptEdits");
    assert!(e["systemPrompt"].as_str().unwrap().contains("小王的 Claude"));
    assert_eq!(e["prompt"], "群聊上下文：\n[2026-09-23 10:12] 陈晨: 新上下文\n\n王磊 说：mock:echo");

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
    assert!(echo(&done)["prompt"].as_str().unwrap().starts_with("群聊上下文：\n[2026-09-23 09:00] 王磊: 旧消息\n"));
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

#[tokio::test]
async fn injects_global_mcp_servers_into_new_and_resumed_sessions() {
    let mut r = rig(Duration::from_millis(200));
    let mut s = start("r1", "mock:echo");
    s.new_session_reason = Some("config_changed".into());
    s.mcp_servers = vec![
        McpServer::Stdio {
            name: "aiws-echo".into(),
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
        { "name": "aiws-echo", "command": "node", "args": ["server.js"], "env": [{ "name": "TOKEN", "value": "t" }] },
        { "type": "http", "name": "wiki", "url": "https://mcp.corp/wiki",
          "headers": [{ "name": "Authorization", "value": "Bearer x" }] },
    ]);
    r.run(s.clone());
    let (_, first) = r.finish("r1").await;
    assert_eq!(first.new_session_reason.as_deref(), Some("config_changed"));
    assert_eq!(echo(&first)["mcpServers"], wire);

    // After the adapter is reaped, session/resume in a fresh process carries the servers too.
    tokio::time::sleep(Duration::from_millis(600)).await;
    r.run(RunStart { new_session_reason: None, mcp_servers: s.mcp_servers, ..follow_up("r2", "mock:echo", &first) });
    let (_, second) = r.finish("r2").await;
    assert_eq!(second.session_id, first.session_id);
    assert_eq!(echo(&second)["mcpServers"], wire);
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
