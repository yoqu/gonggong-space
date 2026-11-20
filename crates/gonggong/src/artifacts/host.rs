//! Hosted sites (托管网页): a static build in a workspace uploaded as a version of a site artifact over the machine
//! routes, so members open it from 作品 with this machine offline. Asked by the preview_host tool or by site.host
//! (托管到服务器 on a static preview's card).
use super::{Artifacts, Client, Scope, transfer, walk, within_limits};
use crate::config::Config;
use crate::engine::EngineConfig;
use crate::hosted::Services;
use crate::protocol::{
    ArtifactFile, ArtifactSubmitReq, ArtifactSubmitRes, ArtifactSubmitSource, DaemonToServer, SiteHost,
};
use crate::service::Outbox;
use crate::sync::TRANSFERS;
use crate::t;
use futures_util::{TryStreamExt, stream};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const ENTRY: &str = "index.html";

/// Uploads `dir` as the new head of site `id`, then screenshots it for the card in the background.
pub async fn host_site(api: &Config, id: &str, dir: &Path) -> Result<ArtifactSubmitRes, String> {
    let a = Artifacts { client: Client::new(api).map_err(|e| format!("{e:#}"))?, home: PathBuf::new() };
    let root = dir.to_path_buf();
    let scanned = tokio::task::spawn_blocking(move || {
        let mut out = BTreeMap::new();
        walk(&root, "", &BTreeMap::new(), &mut out).map(|_| out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| t!("无法读取目录 {dir}：{e}", dir = dir.display(), e = e))?;
    if !scanned.contains_key(ENTRY) {
        return Err(t!("目录里没有 index.html：请先构建，再托管构建输出目录（如 dist）").into());
    }
    let files: Vec<ArtifactFile> =
        scanned.into_iter().map(|(path, s)| ArtifactFile { path, hash: s.hash, size: s.size }).collect();
    within_limits(&files)?;
    let mut by_hash: BTreeMap<&str, &str> = BTreeMap::new();
    for file in &files {
        by_hash.entry(file.hash.as_str()).or_insert(file.path.as_str());
    }
    let hashes: Vec<String> = by_hash.keys().map(|h| h.to_string()).collect();
    let missing = a.client.missing(Scope::Machine, id, &hashes).await.map_err(|e| e.message)?;
    stream::iter(missing.iter().filter_map(|h| Some((h, by_hash.get(h.as_str())?))).map(Ok))
        .try_for_each_concurrent(TRANSFERS, |(hash, path)| {
            let (client, path) = (&a.client, dir.join(path));
            async move { client.upload(Scope::Machine, id, hash, &path).await }
        })
        .await
        .map_err(|e| e.message)?;
    let submit_key = uuid::Uuid::new_v4().to_string();
    let req = ArtifactSubmitReq { parent_version_id: None, source: ArtifactSubmitSource::Host, submit_key, files };
    let res = a.client.submit(Scope::Machine, id, &req).await.map_err(|e| e.message)?;
    let (id, dir, version) = (id.to_string(), dir.to_path_buf(), res.version_id.clone());
    tokio::spawn(async move {
        if let Err(e) = a.shoot_dir(Scope::Machine, &id, &dir, &version, None).await {
            tracing::warn!("screenshot of site {id} {version} failed: {e}");
        }
    });
    Ok(res)
}

#[derive(Deserialize)]
struct HostArgs {
    #[serde(default)]
    dir: String,
    title: String,
}

/// preview_host: hosts a dir of the run's workspace (`root`) as the bot's site for that dir.
pub async fn host_tool(api: Option<&Config>, scope: &crate::hosted::Scope, args: &Value) -> Result<String, String> {
    let (root, run) = (&scope.root, scope.run_id.as_deref());
    let (api, run) = (api.ok_or("未连接服务器")?, run.ok_or("当前不在运行中，无法托管")?);
    let a = HostArgs::deserialize(args).map_err(|e| format!("参数无效：{e}"))?;
    let dir = crate::hosted::inside(root, &a.dir)?;
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    let rel = dir.strip_prefix(&base).unwrap_or(Path::new("")).to_string_lossy().replace('\\', "/");
    let client = Client::new(api).map_err(|e| format!("{e:#}"))?;
    let url = format!("{}/api/daemon/runs/{run}/sites", client.server);
    let req = client.http.post(url).json(&json!({ "dir": rel, "title": a.title }));
    let opened: Value =
        client.send(req, transfer(0)).await.map_err(|e| e.message)?.json().await.map_err(|e| e.to_string())?;
    let id = opened["artifactId"].as_str().ok_or("服务器没有返回产物")?;
    let res = host_site(api, id, &dir).await?;
    Ok(format!(
        "已托管到服务器：「{}」第 {} 版（{} 目录）。成员可在左侧「作品」中打开，这台电脑离线也能访问；再次托管同一目录会生成新版本。",
        a.title,
        res.n,
        if rel.is_empty() { "." } else { &rel }
    ))
}

/// site.host: uploads the dir of a static service, answered by site.host.result.
pub fn site_host(config: &EngineConfig, services: &Services, r: SiteHost, out: &Outbox) {
    let (api, services, out) = (config.api.clone(), services.clone(), out.clone());
    tokio::spawn(async move {
        let hosted = async {
            let dir = services.static_dir(&r.service_id)?;
            host_site(api.as_ref().ok_or("未连接服务器")?, &r.artifact_id, &dir).await
        };
        let error = hosted.await.err();
        out.send(DaemonToServer::SiteHostResult { request_id: r.request_id, error });
    });
}
