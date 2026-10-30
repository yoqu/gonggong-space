//! Plugins reach the agent (plan 插件体系): one folder per (name, digest) shared by every run, loaded by Claude as a
//! plugin next to the team skills and linked for Codex as `<plugin>-<skill>`; a changed plugin list or digest restarts
//! the adapter on the same session, and removed plugins leave no link or exclude line behind.
use gonggong::config::Config;
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::service::{Handler, Outbox, OutboxRx};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const TOKEN: &str = "mt_secret";

type Bodies = Arc<Mutex<HashMap<String, String>>>;

/// Serves JSON bodies by request path; records every requested path.
async fn file_server(bodies: Bodies) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let hits = Arc::new(Mutex::new(vec![]));
    let log = hits.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let (bodies, log) = (bodies.clone(), log.clone());
            tokio::spawn(async move {
                let mut buf = vec![0; 8192];
                let n = sock.read(&mut buf).await.unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or_default().to_string();
                log.lock().unwrap().push(path.clone());
                let authed = req.lines().any(|l| l.eq_ignore_ascii_case(&format!("authorization: Bearer {TOKEN}")));
                let (status, body) = match bodies.lock().unwrap().get(&path).cloned().filter(|_| authed) {
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
    bodies: Bodies,
    hits: Arc<Mutex<Vec<String>>>,
}

async fn rig() -> Rig {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let bodies: Bodies = Arc::default();
    let (server, hits) = file_server(bodies.clone()).await;
    let home = tempfile::tempdir().unwrap();
    let agent = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/mock-agent/agent.js");
    let engine = Engine::new(EngineConfig {
        home: home.path().to_path_buf(),
        user_home: home.path().to_path_buf(),
        adapter_cmd: Some(format!("node {}", agent.display())),
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(600),
        cancel_grace: Duration::from_secs(30),
        continuation: Default::default(),
        api: Some(Config {
            server,
            token: TOKEN.into(),
            machine_id: "mc1".into(),
            owner_name: "王磊".into(),
            tls_trust: None,
        }),
    });
    let (out, rx) = Outbox::channel();
    Rig { engine, out, rx, home, bodies, hits }
}

impl Rig {
    /// Publishes a plugin version whose entry skills (by dir) say `body`.
    fn plugin(&self, name: &str, version: &str, skills: &[&str], body: &str) -> PluginRef {
        let mut files = vec![json!({ "path": "gonggong-plugin.json", "content": format!("{{\"name\":\"{name}\"}}") })];
        for s in skills {
            let md = format!("---\nname: {s}\ndescription: d\n---\n{body}\n");
            files.push(json!({ "path": format!("skills/{s}/SKILL.md"), "content": md, "encoding": "utf8" }));
        }
        files.push(json!({ "path": "previews/a.png", "content": "AAE=", "encoding": "base64" }));
        let res = json!({ "files": files }).to_string();
        self.bodies.lock().unwrap().insert(format!("/api/daemon/plugins/{version}"), res);
        PluginRef { name: name.into(), version_id: version.into(), digest: format!("d{version}") }
    }

    fn skill(&self, name: &str, version: &str) -> SkillRef {
        let md = format!("---\nname: {name}\ndescription: d\n---\n");
        let res = json!({ "files": [{ "path": "SKILL.md", "content": md }] }).to_string();
        self.bodies.lock().unwrap().insert(format!("/api/daemon/skills/{version}"), res);
        SkillRef { name: name.into(), version_id: version.into(), digest: format!("d{version}") }
    }

    async fn run(&mut self, s: RunStart) -> RunDone {
        let run_id = s.run_id.clone();
        self.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &self.out);
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv()).await.unwrap().unwrap();
            if let DaemonToServer::RunDone(d) = msg
                && d.run_id == run_id
            {
                return d;
            }
        }
    }

    fn set(&self, name: &str, digest: &str) -> PathBuf {
        self.home.path().join("plugin-sets").join(format!("{name}-{digest}"))
    }

    fn plugin_hits(&self) -> Vec<String> {
        self.hits
            .lock()
            .unwrap()
            .iter()
            .filter_map(|p| p.strip_prefix("/api/daemon/plugins/").map(String::from))
            .collect()
    }
}

struct Turn<'a> {
    run_id: &'a str,
    group: &'a str,
    kind: AgentKind,
    cwd: &'a Path,
    skills: Vec<SkillRef>,
    plugins: Vec<PluginRef>,
    resume: Option<&'a RunDone>,
}

fn start(t: Turn) -> RunStart {
    RunStart {
        run_id: t.run_id.into(),
        group_id: t.group.into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王的 Claude".into(),
            agent_kind: t.kind,
            system_prompt: String::new(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
            always_allow: vec![],
            git: None,
            agent_settings: Default::default(),
        },
        workspace: WorkspaceSpec {
            repo: None,
            cd_path: Some(t.cwd.to_string_lossy().into_owned()),
            protect_base: false,
            extra_dirs: vec![],
            extra_repos: vec![],
        },
        resume_session_id: t.resume.and_then(|d| d.session_id.clone()),
        new_session_reason: None,
        mcp_servers: vec![],
        skills: t.skills,
        plugins: t.plugins,
        hidden_tools: vec![],
        artifacts: vec![],
        artifact_exclude: vec![],
        command: None,
        sync: None,
        env: Default::default(),
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

fn exclude(dir: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(dir.join(".git/info/exclude")).unwrap_or_default();
    raw.lines().filter(|l| !l.starts_with('#') && !l.is_empty()).map(String::from).collect()
}

fn local(path: &Path) -> serde_json::Value {
    json!({ "type": "local", "path": path })
}

#[tokio::test]
async fn claude_loads_each_plugin_next_to_the_team_skills_and_restarts_when_the_list_or_a_digest_changes() {
    let mut r = rig().await;
    let cwd = repo();
    let review = r.skill("review", "s1");
    let web1 = r.plugin("web-prototype", "pv1", &["web-prototype"], "one");
    let turn = |run_id, plugins, resume| Turn {
        run_id,
        group: "g1",
        kind: AgentKind::Claude,
        cwd: cwd.path(),
        skills: vec![review.clone()],
        plugins,
        resume,
    };
    let d1 = r.run(start(turn("r1", vec![web1.clone()], None))).await;
    let e1 = echo(&d1);
    let team = r.home.path().join("skill-sets/g1-b1");
    let set1 = r.set("web-prototype", "dpv1");
    assert_eq!(e1["plugins"], json!([local(&team), local(&set1)]));
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(set1.join(".claude-plugin/plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["name"], "web-prototype");
    assert!(std::fs::read_to_string(set1.join("skills/web-prototype/SKILL.md")).unwrap().contains("one"));
    assert_eq!(std::fs::read(set1.join("previews/a.png")).unwrap(), vec![0, 1]);
    assert_eq!(git_status(cwd.path()), "");

    // Same plugins: same process, nothing fetched again.
    let d2 = r.run(start(turn("r2", vec![web1.clone()], Some(&d1)))).await;
    assert_eq!(echo(&d2)["pid"], e1["pid"]);
    assert_eq!(r.plugin_hits(), ["pv1"]);

    // A new digest: a new process resumes the same session with the new folder.
    let web2 = r.plugin("web-prototype", "pv2", &["web-prototype"], "two");
    let d3 = r.run(start(turn("r3", vec![web2.clone()], Some(&d2)))).await;
    let e3 = echo(&d3);
    assert_ne!(e3["pid"], e1["pid"]);
    assert_eq!(d3.session_id, d1.session_id);
    assert_eq!(d3.new_session_reason, None);
    let set2 = r.set("web-prototype", "dpv2");
    assert_eq!(e3["plugins"], json!([local(&team), local(&set2)]));
    assert!(std::fs::read_to_string(set2.join("skills/web-prototype/SKILL.md")).unwrap().contains("two"));

    // Another group with the same version reuses the cached folder.
    let other = Turn { run_id: "r4", group: "g2", ..turn("r4", vec![web2.clone()], None) };
    echo(&r.run(start(other)).await);
    assert_eq!(r.plugin_hits(), ["pv1", "pv2"]);

    // Plugin removed: a new process without it.
    let d5 = r.run(start(turn("r5", vec![], Some(&d3)))).await;
    let e5 = echo(&d5);
    assert_ne!(e5["pid"], e3["pid"]);
    assert_eq!(e5["plugins"], json!([local(&team)]));
}

#[tokio::test]
async fn codex_links_plugin_skills_as_plugin_dash_skill_and_removes_them_with_their_exclude_lines() {
    let mut r = rig().await;
    let cwd = repo();
    std::fs::write(cwd.path().join(".git/info/exclude"), "# keep\n/build\n").unwrap();
    // The repo's own folder under a plugin link's name is left alone.
    std::fs::create_dir_all(cwd.path().join(".agents/skills/web-prototype-extra")).unwrap();
    std::fs::write(cwd.path().join(".agents/skills/web-prototype-extra/SKILL.md"), "repo skill").unwrap();
    let web1 = r.plugin("web-prototype", "pv1", &["web-prototype", "extra"], "one");
    let turn = |run_id, plugins, resume| Turn {
        run_id,
        group: "g1",
        kind: AgentKind::Codex,
        cwd: cwd.path(),
        skills: vec![],
        plugins,
        resume,
    };
    let d1 = r.run(start(turn("r1", vec![web1], None))).await;
    let e1 = echo(&d1);
    let link = cwd.path().join(".agents/skills/web-prototype-web-prototype");
    assert!(std::fs::read_to_string(link.join("SKILL.md")).unwrap().contains("one"));
    #[cfg(unix)]
    assert_eq!(std::fs::read_link(&link).unwrap(), r.set("web-prototype", "dpv1").join("skills/web-prototype"));
    let extra = cwd.path().join(".agents/skills/web-prototype-extra/SKILL.md");
    assert_eq!(std::fs::read_to_string(&extra).unwrap(), "repo skill");
    assert_eq!(exclude(cwd.path()), ["/build", "/.agents/skills/web-prototype-web-prototype"]);
    assert_eq!(git_status(cwd.path()), "?? .agents/\n");
    std::fs::remove_dir_all(cwd.path().join(".agents/skills/web-prototype-extra")).unwrap();
    assert_eq!(git_status(cwd.path()), "");

    // A new digest re-points the links (and restarts the adapter).
    let web2 = r.plugin("web-prototype", "pv2", &["web-prototype", "extra"], "two");
    let d2 = r.run(start(turn("r2", vec![web2], Some(&d1)))).await;
    assert_ne!(echo(&d2)["pid"], e1["pid"]);
    assert!(std::fs::read_to_string(link.join("SKILL.md")).unwrap().contains("two"));
    assert!(
        std::fs::read_to_string(cwd.path().join(".agents/skills/web-prototype-extra/SKILL.md"))
            .unwrap()
            .contains("two")
    );
    assert_eq!(
        exclude(cwd.path()),
        ["/build", "/.agents/skills/web-prototype-web-prototype", "/.agents/skills/web-prototype-extra"]
    );
    assert_eq!(git_status(cwd.path()), "");

    // Removed: links and their exclude lines go, the repo's own lines stay.
    let d3 = r.run(start(turn("r3", vec![], Some(&d2)))).await;
    echo(&d3);
    assert!(link.symlink_metadata().is_err());
    assert!(cwd.path().join(".agents/skills/web-prototype-extra").symlink_metadata().is_err());
    assert_eq!(exclude(cwd.path()), ["/build"]);
    assert!(std::fs::read_to_string(cwd.path().join(".git/info/exclude")).unwrap().starts_with("# keep\n"));
}

#[tokio::test]
async fn a_plugin_name_or_digest_that_is_not_a_plain_name_fails_the_run() {
    let mut r = rig().await;
    let cwd = repo();
    let mut bad = r.plugin("web-prototype", "pv1", &["web-prototype"], "one");
    bad.name = "../evil".into();
    let t = Turn {
        run_id: "r1",
        group: "g1",
        kind: AgentKind::Claude,
        cwd: cwd.path(),
        skills: vec![],
        plugins: vec![bad],
        resume: None,
    };
    let done = r.run(start(t)).await;
    assert_eq!(done.outcome, RunOutcome::Failed);
    assert!(!r.home.path().join("evil-dpv1").exists());
    assert!(r.plugin_hits().is_empty());
}

#[test]
fn ask_option_meta_is_aligned_with_the_options_trimmed_and_checked() {
    use gonggong::ask::parse;
    let long = "长".repeat(200);
    let qs = parse(&json!({ "questions": [
        { "type": "single", "title": "选哪个方向？", "options": ["A", "B", "C"], "option_meta": [
            { "description": long, "image": "design/x/directions/a.png" },
            { "swatch": ["#0071e3", "#FF8D28", "#000000", "#111111", "#222222", "#333333", "#444444"] },
            { "description": "  " },
            { "description": "extra" },
        ]},
        { "type": "single", "title": "无增强", "options": ["A", "B"] },
        { "type": "multi", "title": "短", "options": ["A", "B", "C"], "option_meta": [{ "description": "a" }] },
    ]}))
    .unwrap();
    let meta = &qs[0].option_meta;
    assert_eq!(meta.len(), 3);
    assert_eq!(meta[0].description.as_deref().unwrap().chars().count(), 120);
    assert_eq!(meta[0].image.as_deref(), Some("design/x/directions/a.png"));
    assert_eq!(meta[1].swatch, ["#0071e3", "#FF8D28", "#000000", "#111111", "#222222", "#333333"]);
    assert_eq!((meta[2].description.clone(), meta[2].swatch.len(), meta[2].image.clone()), (None, 0, None));
    assert!(qs[1].option_meta.is_empty());
    assert!(serde_json::to_value(&qs[1]).unwrap().get("optionMeta").is_none(), "absent on the wire as before");
    assert_eq!(qs[2].option_meta.len(), 3, "padded to the options");
    assert_eq!(qs[2].option_meta[1], OptionMeta::default());
    assert_eq!(serde_json::to_value(&qs[0]).unwrap()["optionMeta"][1]["swatch"][0], "#0071e3");

    let one = |meta: serde_json::Value| {
        parse(
            &json!({ "questions": [{ "type": "single", "title": "x", "options": ["A", "B"], "option_meta": [meta] }] }),
        )
    };
    assert!(one(json!({ "swatch": ["blue"] })).unwrap_err().contains("swatch"));
    assert!(one(json!({ "swatch": ["#12345"] })).is_err());
    assert!(one(json!({ "image": "/etc/passwd" })).unwrap_err().contains("image"));
    assert!(one(json!({ "image": "../secret.png" })).is_err());
    assert!(one(json!({ "image": "a".repeat(501) })).is_err());
}
