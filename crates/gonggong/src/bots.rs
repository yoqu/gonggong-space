//! `gg bots`: the bots bound to this machine via the server's machine-token REST API, read-only: they are managed on
//! the Web (plan J11).
use crate::config::Config;
use crate::protocol::{AgentKind, Approval};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

/// Subset of the server's `BotDto` that the CLI and the desktop app need.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub name: String,
    pub agent_kind: AgentKind,
    pub binding: Binding,
    pub presence: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub concurrency: u32,
    /// Older servers send neither.
    #[serde(default)]
    pub approval: Approval,
    #[serde(default)]
    pub allowlist: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Binding {
    PendingBind,
    PendingConfirm,
    Bound,
}

pub struct Client {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl Client {
    pub fn new(config: &Config) -> Result<Self> {
        Ok(Self {
            http: crate::tls::client(config)?,
            base: config.server.trim_end_matches('/').to_owned(),
            token: config.token.clone(),
        })
    }

    pub async fn list(&self) -> Result<Vec<Bot>> {
        let res = self.http.get(format!("{}/api/daemon/bots", self.base)).bearer_auth(&self.token).send().await?;
        Ok(ok(res).await?.json().await?)
    }
}

/// Turns a non-2xx response into an error carrying the server's `{ message }`.
pub(crate) async fn ok(res: reqwest::Response) -> Result<reqwest::Response> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    bail!("服务器返回 {status}: {}", body["message"].as_str().unwrap_or("未知错误"))
}

/// Where the bot is managed: the Web opens its settings from `?bot=<id>`.
pub fn web_url(server: &str, id: &str) -> String {
    format!("{}/?bot={id}", server.trim_end_matches('/'))
}

pub fn agent_label(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "Claude Code",
        AgentKind::Codex => "Codex",
    }
}

pub fn state_label(bot: &Bot) -> String {
    match bot.binding {
        Binding::PendingBind => "待绑定".into(),
        Binding::PendingConfirm => "待确认 · 请在 Web 中确认".into(),
        Binding::Bound => match bot.presence.as_str() {
            "online" => "在线",
            "running" => "运行中",
            "agent_missing" => "本机未安装该 agent",
            _ => "离线",
        }
        .into(),
    }
}

pub async fn list(config: &Config) -> Result<()> {
    let bots = Client::new(config)?.list().await?;
    if bots.is_empty() {
        println!("本机还没有 Bot");
    }
    for b in &bots {
        println!("{}\t{}\t{}\t命令审批 {}", b.name, agent_label(b.agent_kind), state_label(b), b.approval.label());
        println!("\t在 Web 中管理：{}", web_url(&config.server, &b.id));
    }
    Ok(())
}
