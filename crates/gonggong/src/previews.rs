//! This machine's preview tunnels and hosted services as the server lists them, for the desktop app to manage.
use crate::bots::{Client, ok};
use crate::protocol::{DevtoolsBlocker, Permission};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Subset of the server's `PreviewDto`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    /// http / static tunnel; gui / miniprogram are watched live through gg-cast.
    pub kind: String,
    pub title: String,
    pub group_name: String,
    pub bot_name: String,
    pub port: Option<u16>,
    pub path: String,
    pub service_id: Option<String>,
    pub service_name: Option<String>,
    pub status: String,
    /// This machine's gg-cast while someone watches.
    #[serde(default)]
    pub live: Option<Live>,
    #[serde(default)]
    pub control: Option<Control>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub state: String,
    pub error: Option<String>,
    pub missing: Vec<Permission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub devtools: Option<DevtoolsBlocker>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Control {
    pub controller: Option<Member>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub name: String,
}

/// Subset of the server's `ServiceDto`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub id: String,
    pub name: String,
    pub group_name: String,
    pub bot_name: String,
    pub command: String,
    pub cwd: String,
    pub port: Option<u16>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnels {
    pub previews: Vec<Preview>,
    pub services: Vec<Service>,
}

impl Client {
    pub async fn tunnels(&self) -> Result<Tunnels> {
        let res = self.http.get(format!("{}/api/daemon/previews", self.base)).bearer_auth(&self.token).send().await?;
        Ok(ok(res).await?.json().await?)
    }

    /// Closes the tunnel and, with `stop_service`, stops the service behind it.
    pub async fn close_preview(&self, id: &str, stop_service: bool) -> Result<()> {
        let url = format!("{}/api/daemon/previews/{id}/close", self.base);
        let body = serde_json::json!({ "stopService": stop_service });
        ok(self.http.post(url).bearer_auth(&self.token).json(&body).send().await?).await.map(drop)
    }

    /// 立即重试 of a live preview this machine publishes.
    pub async fn retry_cast(&self, id: &str) -> Result<()> {
        let url = format!("{}/api/daemon/previews/{id}/live/retry", self.base);
        ok(self.http.post(url).bearer_auth(&self.token).send().await?).await.map(drop)
    }

    pub async fn stop_service(&self, id: &str) -> Result<()> {
        let url = format!("{}/api/daemon/services/{id}/stop", self.base);
        ok(self.http.post(url).bearer_auth(&self.token).send().await?).await.map(drop)
    }
}
