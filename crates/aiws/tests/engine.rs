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
        prompt: RunPrompt {
            text: text.into(),
            triggered_by: "王磊".into(),
            context: vec![ContextMessage {
                seq: 3,
                author: "陈晨".into(),
                kind: "user".into(),
                body: "新上下文".into(),
                at: "2026-09-23T10:12:00Z".into(),
            }],
            fallback_context: vec![],
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

#[tokio::test]
async fn streams_a_turn_and_rejects_permissions_below_full_tier() {
    let mut r = rig(Duration::from_secs(60));
    r.run(start("r1", "写个文件"));
    let (events, done) = r.finish("r1").await;
    assert!(r.workspace().is_dir());
    assert_eq!(events.first(), Some(&RunEvent::Text { delta: "好的，".into() }));
    assert!(events.contains(&RunEvent::Thought { delta: "需要写一个文件".into() }));
    assert!(events.iter().any(
        |e| matches!(e, RunEvent::Tool { tool_kind, title, .. } if tool_kind == "edit" && title == "Write hello.txt")
    ));
    assert!(events.contains(&RunEvent::Status {
        status: RunStatus::Running,
        step: "权限请求已拒绝（审批流程将在 M3 提供）".into()
    }));
    assert!(events.iter().any(|e| matches!(e, RunEvent::Usage { .. })));
    assert_eq!(done.outcome, RunOutcome::Completed);
    assert_eq!(done.reply, "好的，权限被拒绝，未写入。");
    assert_eq!(done.files_changed, 1);
    assert_eq!(done.usage.as_ref().and_then(|u| u.cost_usd), Some(0.01));
    assert_eq!(done.new_session_reason.as_deref(), Some("first"));
    assert!(done.session_id.as_deref().unwrap().starts_with("mock-"));
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
