//! Rig for the provider tests: the engine against the mock ACP agent, with a providers store in its home.
#![allow(dead_code)]
use gonggong::engine::{Engine, EngineConfig};
use gonggong::protocol::*;
use gonggong::providers::{self, Provider, Store};
use gonggong::service::{Handler, Outbox, OutboxRx};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const KEY: &str = "sk-provider-secret-0123456789";

pub struct Rig {
    engine: Engine,
    out: Outbox,
    rx: OutboxRx,
    home: tempfile::TempDir,
    pub configs: Vec<(String, Option<String>)>,
}

pub fn rig(idle: Duration) -> Rig {
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

pub fn start(run_id: &str, kind: AgentKind) -> RunStart {
    RunStart {
        run_id: run_id.into(),
        group_id: "g1".into(),
        group_name: "支付服务重构".into(),
        bot: RunBot {
            id: "b1".into(),
            name: "小王".into(),
            agent_kind: kind,
            system_prompt: "只改 server/".into(),
            tier: Tier::Workspace,
            model: None,
            effort: None,
            approval: Approval::Ask,
            allowlist: vec![],
        },
        workspace: WorkspaceSpec { repo: None, cd_path: None },
        resume_session_id: None,
        new_session_reason: None,
        mcp_servers: vec![],
        command: None,
        prompt: RunPrompt {
            text: "mock:echo".into(),
            triggered_by: "王磊".into(),
            context: vec![],
            omitted: 0,
            fallback_context: vec![ContextMessage {
                seq: 1,
                author: "王磊".into(),
                kind: "user".into(),
                body: "旧消息".into(),
                at: "2026-09-23T09:00:00Z".into(),
                attachments: vec![],
            }],
            attachments: vec![],
            quote: None,
        },
    }
}

pub fn follow_up(run_id: &str, prev: &RunDone, kind: AgentKind) -> RunStart {
    RunStart { resume_session_id: prev.session_id.clone(), ..start(run_id, kind) }
}

impl Rig {
    pub fn run(&self, s: RunStart) {
        self.engine.handle(ServerToDaemon::RunStart(Box::new(s)), &self.out);
    }

    pub async fn finish(&mut self, run_id: &str) -> RunDone {
        loop {
            let msg = tokio::time::timeout(Duration::from_secs(20), self.rx.recv())
                .await
                .expect("engine went quiet")
                .unwrap();
            match msg {
                DaemonToServer::SessionConfig { run_id, model, .. } => self.configs.push((run_id, model)),
                DaemonToServer::RunDone(d) if d.run_id == run_id => return d,
                _ => {}
            }
        }
    }

    pub fn home(&self) -> &Path {
        self.home.path()
    }

    pub fn add(&self, agent: AgentKind, preset: &str, default: bool) -> String {
        Store::update(self.home(), |s| {
            let id = s.add(Provider::from_preset(providers::preset(agent, preset).unwrap(), KEY.into()))?;
            if default {
                s.use_machine(agent, &id)?;
            }
            Ok(id)
        })
        .unwrap()
    }

    pub fn settings_file(&self, id: &str) -> PathBuf {
        self.home().join(format!("run/claude-{id}.json"))
    }

    pub fn pinned(&self, session: &str) -> String {
        Store::load(self.home()).unwrap().sessions[session].provider.clone()
    }
}

pub fn echo(done: &RunDone) -> Value {
    assert_eq!(done.outcome, RunOutcome::Completed, "{:?}", done.error);
    serde_json::from_str(&done.reply).unwrap()
}
