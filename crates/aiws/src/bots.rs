//! `aiws bots`: list and confirm the bots bound to this machine via the server's machine-token REST API.
use crate::config::Config;
use crate::protocol::AgentKind;
use anyhow::{Result, anyhow, bail};
use serde::Deserialize;

/// Subset of the server's `BotDto` that the CLI needs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub name: String,
    pub agent_kind: AgentKind,
    pub binding: Binding,
    pub presence: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
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
    pub fn new(config: &Config) -> Self {
        Self { http: crate::bind::http().expect("tls backend"), base: config.server.trim_end_matches('/').to_owned(), token: config.token.clone() }
    }

    pub async fn list(&self) -> Result<Vec<Bot>> {
        let res = self.http.get(format!("{}/api/daemon/bots", self.base)).bearer_auth(&self.token).send().await?;
        Ok(ok(res).await?.json().await?)
    }

    pub async fn confirm(&self, id: &str) -> Result<Bot> {
        let res = self.http.post(format!("{}/api/daemon/bots/{id}/confirm", self.base)).bearer_auth(&self.token).send().await?;
        Ok(ok(res).await?.json().await?)
    }
}

/// Turns a non-2xx response into an error carrying the server's `{ message }`.
async fn ok(res: reqwest::Response) -> Result<reqwest::Response> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    bail!("服务器返回 {status}: {}", body["message"].as_str().unwrap_or("未知错误"))
}

/// Finds a bot by exact id or name.
pub fn find<'a>(bots: &'a [Bot], target: &str) -> Result<&'a Bot> {
    bots.iter().find(|b| b.id == target || b.name == target).ok_or_else(|| anyhow!("本机没有名为「{target}」的 bot"))
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
        Binding::PendingConfirm => format!("待确认 · 运行 aiws bots confirm {}", bot.name),
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
    let bots = Client::new(config).list().await?;
    if bots.is_empty() {
        println!("本机还没有 bot");
    }
    for b in &bots {
        println!("{}\t{}\t{}", b.name, agent_label(b.agent_kind), state_label(b));
    }
    Ok(())
}

pub async fn confirm(config: &Config, target: &str) -> Result<()> {
    let client = Client::new(config);
    let bots = client.list().await?;
    let bot = find(&bots, target)?;
    if bot.binding != Binding::PendingConfirm {
        bail!("「{}」无需确认", bot.name);
    }
    let bot = client.confirm(&bot.id).await?;
    println!("已确认 {}，现在可以被触发", bot.name);
    Ok(())
}
