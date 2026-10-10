//! Team skills reach the agent: a Claude plugin folder per (group, bot), Codex links in the workspace kept out of
//! git, repo skills of the same name win, and a changed skill list restarts the adapter on the same session.
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOKEN: &str = "mt_secret";

type Versions = Arc<Mutex<HashMap<String, String>>>;

/// Serves `GET /api/daemon/skills/<versionId>` from `versions` (JSON bodies); records every requested id.
async fn skill_server(versions: Versions) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let hits = Arc::new(Mutex::new(vec![]));
    let log = hits.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let (versions, log) = (versions.clone(), log.clone());
            tokio::spawn(async move {
                let mut buf = vec![0; 8192];
                let n = sock.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or_default().to_string();
                let id = path.trim_start_matches("/api/daemon/skills/").to_string();
                log.lock().unwrap().push(id.clone());
                let authed = req.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {TOKEN}")));
                let body = versions.lock().unwrap().get(&id).cloned().filter(|_| authed);
                let (status, body) = match body {
                    Some(b) => ("200 OK", b),
                    None => ("404 Not Found", String::new()),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                sock.write_all(head.as_bytes()).await.unwrap();
                sock.write_all(body.as_bytes()).await.unwrap();
            });
        }
    });
    (url, hits)
}

struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    home: tempfile::TempDir,
    versions: Versions,
    hits: Arc<Mutex<Vec<String>>>,
}

async fn rig() -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let versions: Versions = Arc::default();
    let (server, hits) = skill_server(versions.clone()).await;
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        api: Some(Config { server, token: TOKEN.into(), machine_id: "mc1".into(), owner_name: "王磊".into() }),
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, home, versions, hits }
}

impl Rig {
    /// Publishes a version of `name` whose SKILL.md says `body`; returns its ref.
    fn publish(&self, name: &str, version: &str, body: &str) -> SkillRef {
        let files = serde_json::json!({ "files": [
            { "path": "SKILL.md", "content": format!("---\nname: {name}\ndescription: d\n---\n{body}\n"), "encoding": "utf8" },
            { "path": "assets/x.bin", "content": "AAE=", "encoding": "base64" },
        ]});
        self.versions.lock().unwrap().insert(version.into(), files.to_string());
        SkillRef { name: name.into(), version_id: version.into(), digest: format!("d-{version}") }
    }

    async fn run(&mut self, s: RunStart) -> (Vec<RunEvent>, RunDone) {
        let run_id = s.run_id.clone();
        self.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &self.out);
        let mut events = vec![];
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv()).await.unwrap().unwrap();
            match msg {
                DaemonToServer::RunEvent { run_id: r, event } if r == run_id => events.push(event),
                DaemonToServer::RunDone(d) if d.run_id == run_id => return (events, d),
                _ => {}
            }
        }
    }

    fn set(&self) -> PathBuf {
        self.home.path().join("skill-sets/g1-b1")
    }

    fn hits(&self) -> Vec<String> {
        self.hits.lock().unwrap().clone()
    }
}

fn start(run_id: &str, kind: AgentKind, cwd: &Path, skills: Vec<SkillRef>, resume: Option<&RunDone>) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: kind,
            system_prompt: String::new(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            git: None,
        },
        workspace: WorkspaceSpec { repo: None, cd_path: Some(cwd.to_string_lossy().into_owned()) },
        resume_session_id: resume.and_then(|d| d.session_id.clone()),
        new_session_reason: None,
        mcp_servers: vec![],
        skills,
        command: None,
        sync: None,
        prompt: RunPrompt {
            text: "mock:echo".into(),
            triggered_by: "王磊".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![],
            attachments: vec![],
            quote: None,
        },
    }
}

fn echo(done: &RunDone) -> serde_json::Value {
    assert_eq!(done.outcome, RunOutcome::Completed, "{}", done.error.clone().unwrap_or_default());
    serde_json::from_str(&done.reply).unwrap()
}

fn repo() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let ok = std::process::Command::new("git").args(["init", "-q"]).current_dir(dir.path()).status().unwrap();
    assert!(ok.success());
    dir
}

fn git_status(dir: &Path) -> String {
    let out = std::process::Command::new("git").args(["status", "--porcelain"]).current_dir(dir).output().unwrap();
    String::from_utf8(out.stdout).unwrap()
}

fn skill_md(dir: &Path, name: &str) -> String {
    std::fs::read_to_string(dir.join("skills").join(name).join("SKILL.md")).unwrap()
}

#[tokio::test]
async fn claude_loads_the_plugin_folder_and_restarts_only_when_the_skill_list_changes() {
    let mut r = rig().await;
    let cwd = repo();
    let review1 = r.publish("review", "v1", "one");
    let (_, d1) = r.run(start("r1", AgentKind::Claude, cwd.path(), vec![review1], None)).await;
    let e1 = echo(&d1);
    assert_eq!(e1["plugins"], serde_json::json!([{ "type": "local", "path": r.set() }]));
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(r.set().join(".claude-plugin/plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["name"], "gonggong-team");
    assert!(skill_md(&r.set(), "review").contains("one"));
    assert_eq!(std::fs::read(r.set().join("skills/review/assets/x.bin")).unwrap(), vec![0, 1]);
    assert_eq!(git_status(cwd.path()), "");

    // New content under the same name: swapped in place, same process.
    let review2 = r.publish("review", "v2", "two");
    let (_, d2) = r.run(start("r2", AgentKind::Claude, cwd.path(), vec![review2.clone()], Some(&d1))).await;
    assert_eq!(echo(&d2)["pid"], e1["pid"]);
    assert!(skill_md(&r.set(), "review").contains("two"));
    let (_, d3) = r.run(start("r3", AgentKind::Claude, cwd.path(), vec![review2.clone()], Some(&d2))).await;
    assert_eq!(echo(&d3)["pid"], e1["pid"]);
    assert_eq!(r.hits(), ["v1", "v2"]);

    // Another skill: a new process resumes the same session with the plugin listing both.
    let lint = r.publish("lint", "v3", "lint");
    let (_, d4) = r.run(start("r4", AgentKind::Claude, cwd.path(), vec![lint, review2], Some(&d3))).await;
    let e4 = echo(&d4);
    assert_ne!(e4["pid"], e1["pid"]);
    assert_eq!(d4.session_id, d1.session_id);
    assert_eq!(d4.new_session_reason, None);
    assert!(skill_md(&r.set(), "lint").contains("lint"));

    let (_, d5) = r.run(start("r5", AgentKind::Claude, cwd.path(), vec![], Some(&d4))).await;
    let e5 = echo(&d5);
    assert_ne!(e5["pid"], e4["pid"]);
    assert_eq!(e5["plugins"], serde_json::Value::Null);
    assert_eq!(std::fs::read_dir(r.set().join("skills")).unwrap().count(), 0);
}

#[tokio::test]
async fn a_repo_skill_of_the_same_name_wins_and_the_run_says_so() {
    let mut r = rig().await;
    let cwd = repo();
    std::fs::create_dir_all(cwd.path().join(".claude/skills/review")).unwrap();
    let skills = vec![r.publish("lint", "v3", "lint"), r.publish("review", "v1", "one")];
    let (events, done) = r.run(start("r1", AgentKind::Claude, cwd.path(), skills, None)).await;
    echo(&done);
    assert!(events.contains(&RunEvent::Status {
        status: RunStatus::Running,
        step: "已跳过团队 skill review：仓库里已有同名 skill".into()
    }));
    assert!(r.set().join("skills/lint").is_dir());
    assert!(!r.set().join("skills/review").exists());
    assert_eq!(r.hits(), ["v3"]);
}

#[tokio::test]
async fn codex_finds_linked_skills_in_the_workspace_kept_out_of_git() {
    let mut r = rig().await;
    let cwd = repo();
    std::fs::create_dir_all(cwd.path().join(".agents/skills/mine")).unwrap();
    std::fs::write(cwd.path().join(".agents/skills/mine/SKILL.md"), "repo skill").unwrap();
    let skills = vec![r.publish("review", "v1", "one"), r.publish("mine", "v2", "team")];
    let (events, d1) = r.run(start("r1", AgentKind::Codex, cwd.path(), skills, None)).await;
    echo(&d1);
    assert!(events.iter().any(|e| matches!(e, RunEvent::Status { step, .. } if step.contains("mine"))));
    let link = cwd.path().join(".agents/skills/review");
    assert!(std::fs::read_to_string(link.join("SKILL.md")).unwrap().contains("one"));
    #[cfg(unix)]
    assert_eq!(std::fs::read_link(&link).unwrap(), r.set().join("skills/review"));
    assert_eq!(std::fs::read_to_string(cwd.path().join(".agents/skills/mine/SKILL.md")).unwrap(), "repo skill");
    let exclude = std::fs::read_to_string(cwd.path().join(".git/info/exclude")).unwrap();
    assert!(exclude.lines().any(|l| l == "/.agents/skills/review"));
    // Only the repo's own skill is untracked; the team link is not.
    assert_eq!(git_status(cwd.path()), "?? .agents/\n");
    std::fs::remove_dir_all(cwd.path().join(".agents/skills/mine")).unwrap();
    assert_eq!(git_status(cwd.path()), "");

    let (_, d2) = r.run(start("r2", AgentKind::Codex, cwd.path(), vec![], Some(&d1))).await;
    echo(&d2);
    assert!(link.symlink_metadata().is_err());
}
