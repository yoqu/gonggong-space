//! Write confirmation with real agents (docs/plan/工作区并行-写时确认.md): a turn joining a busy directory runs in
//! the read-only tier's mode, asks before its first change, and is switched back to its own mode mid-prompt.
use super::engine::start;
use gonggong::engine::{Continuation, Engine, EngineConfig};
use gonggong::local::LocalSettings;
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn run_in(run_id: &str, group: &str, kind: AgentKind, tier: Tier, text: &str, dir: &Path) -> RunStart {
    let mut s = start(run_id, text);
    (s.group_id, s.group_name) = (group.into(), group.into());
    s.workspace.cd_path = Some(dir.to_string_lossy().into());
    s.bot.agent_kind = kind;
    s.bot.tier = tier;
    s.bot.system_prompt.clear();
    s.prompt.context.clear();
    s
}

/// Runs a writer, then a workspace-tier turn editing two files beside it: asked once before its first change, its
/// edits then go on without the owner, as in the bot's own mode.
async fn verify(kind: AgentKind, adapter: &str, cli: Option<PathBuf>) {
    let home = tempfile::tempdir().unwrap();
    let user_home = PathBuf::from(std::env::var("HOME").unwrap());
    let mut settings = LocalSettings::default();
    if let Some(cli) = cli {
        settings.agents.insert(kind, gonggong::local::AgentSettings { path: Some(cli.display().to_string()) });
    }
    settings.save(home.path()).unwrap();
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: user_home.clone(),
        adapter_cmd: Some(format!("node {}", user_home.join(adapter).display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Continuation::default(),
        api: None,
    });
    let (out, mut rx) = Outbox::channel();
    let tmp = tempfile::tempdir().unwrap();
    // Agents name files by the real path (/private/var/... on macOS): outside a symlinked cwd they would ask the owner.
    let dir = tmp.path().canonicalize().unwrap();
    let dir = dir.as_path();
    let mut writer = run_in(
        "w1",
        "g1",
        kind,
        Tier::Full,
        "Run exactly this shell command in the foreground and wait for it: ping -c 100 127.0.0.1 > /dev/null. Then reply DONE.",
        dir,
    );
    writer.bot.approval = Approval::All;
    engine.handle(ServerToDaemon::RunStart(Box::new(writer)), &out);
    // The writer holds the directory once it runs its command.
    tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            match rx.recv().await {
                Some(DaemonToServer::RunEvent { run_id, event: RunEvent::Tool { .. } }) if run_id == "w1" => return,
                Some(DaemonToServer::RunDone(d)) => panic!("the writer ended: {d:?}"),
                msg => eprintln!("writer: {msg:?}"),
            }
        }
    })
    .await
    .expect("the writer never ran its command");

    let text = "Using your file editing tool (not the shell), create probe1.txt containing the line one. Then, \
        again with the file editing tool, create probe2.txt containing the line two. Run no shell commands. Reply DONE.";
    engine.handle(ServerToDaemon::RunStart(Box::new(run_in("g2r", "g2", kind, Tier::Workspace, text, dir))), &out);
    let (mut asked, mut approved, mut owner) = (false, 0, 0);
    tokio::time::timeout(Duration::from_secs(240), async {
        while let Some(msg) = rx.recv().await {
            match msg {
                DaemonToServer::QuestionAsk { run_id, request_id, questions } if run_id == "g2r" => {
                    assert!(questions[0].options.iter().any(|o| o == "现在就改"), "{questions:?}");
                    assert!(!dir.join("probe1.txt").exists(), "changed before the confirmation");
                    asked = true;
                    let answers = vec![Answer { question_id: "q1".into(), choices: vec![0], text: None }];
                    let (run_id, answered_by) = (run_id, Some("王磊".into()));
                    engine.handle(
                        ServerToDaemon::QuestionAnswer {
                            run_id,
                            request_id,
                            answers: Some(answers),
                            attachments: vec![],
                            answered_by,
                        },
                        &out,
                    );
                }
                DaemonToServer::ApprovalAiApproved(a) if a.run_id == "g2r" && a.tool_kind == "edit" => approved += 1,
                DaemonToServer::ApprovalRequest(a) if a.run_id == "g2r" => {
                    eprintln!("owner asked: {} {:?}", a.title, a.detail);
                    owner += 1;
                    let allow =
                        a.options.iter().find(|o| o.kind == PermissionKind::AllowOnce).map(|o| o.option_id.clone());
                    let (run_id, request_id) = (a.run_id, a.request_id);
                    engine.handle(
                        ServerToDaemon::ApprovalDecision { run_id, request_id, option_id: allow, session: false },
                        &out,
                    );
                }
                DaemonToServer::RunDone(d) if d.run_id == "w1" => {
                    eprintln!("writer ended: {:?} {:?}", d.outcome, d.error)
                }
                DaemonToServer::RunEvent { run_id, event: RunEvent::Status { step, .. } } => {
                    eprintln!("{run_id}: {step}")
                }
                DaemonToServer::RunEvent { run_id, event: RunEvent::Tool { title, tool_kind, status, .. } } => {
                    eprintln!("{run_id}: tool {tool_kind} {status:?} {title}")
                }
                DaemonToServer::RunDone(d) if d.run_id == "g2r" => {
                    assert_eq!(d.outcome, RunOutcome::Completed, "{} {:?}", d.reply, d.error);
                    return;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("the guarded turn timed out");
    engine.handle(ServerToDaemon::RunCancel { run_id: "w1".into() }, &out);
    assert!(asked, "never asked before changing files beside the writer");
    assert!(dir.join("probe1.txt").exists() && dir.join("probe2.txt").exists());
    eprintln!("{kind:?}: edits auto-approved {approved}, asked of the owner {owner}");
    assert_eq!((approved, owner), (0, 0), "edits the bot's own mode makes unasked");
}

#[tokio::test]
#[ignore = "requires the real Claude ACP adapter and an authenticated Claude Code"]
async fn real_claude_asks_before_its_first_change_beside_a_writer() {
    verify(
        AgentKind::Claude,
        ".gonggong/adapters/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
        None,
    )
    .await;
}

#[tokio::test]
#[ignore = "requires the real Codex ACP adapter, Codex CLI and an authenticated account"]
async fn real_codex_asks_before_its_first_change_beside_a_writer() {
    let home = PathBuf::from(std::env::var("HOME").unwrap());
    let cli = home.join(".gonggong/adapters/node_modules/@openai/codex/bin/codex.js");
    verify(AgentKind::Codex, ".gonggong/adapters/node_modules/@agentclientprotocol/codex-acp/dist/index.js", Some(cli))
        .await;
}
