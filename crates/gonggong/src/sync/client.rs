//! `/api/daemon/sync/:groupId/…` (F15): content-addressed blobs and a version's changes, over the pinned client.
use crate::bots::ok;
use crate::config::Config;
use crate::protocol::{SYNC_MISSING_MAX, SyncChangesRes, SyncMissingRes};
use crate::tls;
use anyhow::Result;
use std::path::Path;

pub struct Client {
    http: reqwest::Client,
    server: String,
    token: String,
}

impl Client {
    pub fn new(config: &Config) -> Result<Self> {
        Ok(Client {
            http: tls::client(config)?,
            server: config.server.trim_end_matches('/').into(),
            token: config.token.clone(),
        })
    }

    fn url(&self, group: &str, rest: &str) -> String {
        format!("{}/api/daemon/sync/{group}/{rest}", self.server)
    }

    /// Which of `hashes` the server lacks, asked SYNC_MISSING_MAX at a time.
    pub async fn missing(&self, group: &str, hashes: &[String]) -> Result<Vec<String>> {
        let mut out = vec![];
        for chunk in hashes.chunks(SYNC_MISSING_MAX) {
            let req = self.http.post(self.url(group, "blobs/missing")).bearer_auth(&self.token);
            let res = ok(req.json(&serde_json::json!({ "hashes": chunk })).send().await?).await?;
            out.extend(res.json::<SyncMissingRes>().await?.missing);
        }
        Ok(out)
    }

    pub async fn upload(&self, group: &str, hash: &str, path: &Path) -> Result<()> {
        let body = tokio::fs::read(path).await?;
        let req = self.http.put(self.url(group, &format!("blobs/{hash}"))).bearer_auth(&self.token);
        ok(req.header(reqwest::header::CONTENT_TYPE, "application/octet-stream").body(body).send().await?).await?;
        Ok(())
    }

    pub async fn download(&self, group: &str, hash: &str) -> Result<Vec<u8>> {
        let req = self.http.get(self.url(group, &format!("blobs/{hash}"))).bearer_auth(&self.token);
        Ok(ok(req.send().await?).await?.bytes().await?.to_vec())
    }

    /// The latest entry of each path changed after version `from` (0 = the whole head).
    pub async fn changes(&self, group: &str, from: u64) -> Result<SyncChangesRes> {
        let req = self.http.get(self.url(group, &format!("changes?from={from}"))).bearer_auth(&self.token);
        Ok(ok(req.send().await?).await?.json().await?)
    }
}
