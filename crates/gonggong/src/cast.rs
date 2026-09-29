//! Live previews (plan 结果预览 B2, B6-2): one gg-cast per watched preview, publishing a hosted service's window or a
//! mini program's simulator to the preview's LiveKit room for as long as the server asks for it (`cast.sync`);
//! restarted after a failure, stopped when nobody watches. gg-cast is downloaded from the server on first use (it
//! bundles libwebrtc, so `gg` does not).
use crate::config::Config;
use crate::hosted::Services;
use crate::permission::{self, Permission};
use crate::protocol::{CastPhase, CastSource, CastTarget, DaemonToServer};
use crate::service::Outbox;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::task::{AbortHandle, JoinHandle};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

const FIRST_RETRY: Duration = Duration::from_secs(2);
const MAX_RETRY: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct Casts(Arc<Inner>);

struct Inner {
    api: Option<Config>,
    home: PathBuf,
    services: Services,
    /// GG_CAST_BIN: a local gg-cast build instead of the published one.
    bin: Option<PathBuf>,
    devtools: &'static crate::wechatide::Shared,
    /// The permissions this machine lacks, checked before each run (`permission::missing`).
    missing: fn() -> Vec<Permission>,
    running: Mutex<HashMap<String, (CastTarget, AbortHandle)>>,
}

impl Casts {
    pub fn new(
        api: Option<Config>,
        home: PathBuf,
        services: Services,
        bin: Option<PathBuf>,
        devtools: &'static crate::wechatide::Shared,
    ) -> Self {
        Casts(Arc::new(Inner {
            api,
            home,
            services,
            bin,
            devtools,
            missing: permission::missing,
            running: Mutex::default(),
        }))
    }

    /// Replaces the permission check (tests), before the first `sync`.
    pub fn permissions(mut self, missing: fn() -> Vec<Permission>) -> Self {
        Arc::get_mut(&mut self.0).expect("not shared yet").missing = missing;
        self
    }

    /// Runs exactly the `wanted` casts: new ones start, dropped ones stop (their gg-cast is killed).
    pub fn sync(&self, wanted: Vec<CastTarget>, out: &Outbox) {
        let mut running = self.0.running.lock().unwrap();
        running.retain(|_, (target, task)| {
            let keep = wanted.contains(target);
            if !keep {
                task.abort();
            }
            keep
        });
        for target in wanted {
            if running.contains_key(&target.preview_id) {
                continue;
            }
            let task = tokio::spawn(supervise(self.0.clone(), target.clone(), out.clone()));
            running.insert(target.preview_id.clone(), (target, task.abort_handle()));
        }
    }
}

/// Every state carries the missing permissions: without accessibility the window shows, but control does nothing.
fn report(out: &Outbox, target: &CastTarget, missing: &[Permission], state: CastPhase, error: Option<String>) {
    let missing = missing.to_vec();
    out.send(DaemonToServer::CastState { preview_id: target.preview_id.clone(), state, error, missing });
}

async fn supervise(inner: Arc<Inner>, target: CastTarget, out: Outbox) {
    let mut retry = FIRST_RETRY;
    loop {
        let missing = (inner.missing)();
        report(&out, &target, &missing, CastPhase::Starting, None);
        let mut went_live = false;
        let reason = match publish(&inner, &target, &out, &missing, &mut went_live).await {
            Ok(reason) | Err(reason) => reason,
        };
        report(&out, &target, &missing, CastPhase::Failed, Some(reason));
        if went_live {
            retry = FIRST_RETRY;
        }
        tokio::time::sleep(retry).await;
        retry = (retry * 2).min(MAX_RETRY);
    }
}

/// One gg-cast run; returns why it ended.
async fn publish(
    inner: &Inner,
    target: &CastTarget,
    out: &Outbox,
    missing: &[Permission],
    went_live: &mut bool,
) -> Result<String, String> {
    let api = inner.api.as_ref().ok_or("未连接服务器")?;
    if missing.contains(&Permission::ScreenRecording) {
        return Err(permission::SCREEN_RECORDING_DENIED.into());
    }
    let window = window_args(inner, &target.source).await?;
    let bin = match &inner.bin {
        Some(bin) => bin.clone(),
        None => binary(api, &inner.home).await?,
    };
    let token = cast_token(api, &target.preview_id).await?;
    // The server's own LiveKit sits behind its (pinned) certificate, which gg-cast cannot check: relay through us.
    let relay = match token.url {
        Some(_) => None,
        None => Some(Relay::start(api.clone()).await?),
    };
    let url = relay.as_ref().map(Relay::url).or(token.url).unwrap_or_default();
    let mut child = Command::new(&bin)
        .args(["--url", &url])
        .args(window)
        .env("GG_CAST_TOKEN", &token.token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("无法启动 gg-cast：{e}"))?;
    // gg-cast exits once this closes: when this task is stopped, or the daemon is gone without killing it.
    let _stdin = child.stdin.take();
    let stderr = child.stderr.take().expect("piped");
    let last_error = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut last = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                last = line;
            }
        }
        last
    });
    let mut stdout = BufReader::new(child.stdout.take().expect("piped")).lines();
    while let Ok(Some(line)) = stdout.next_line().await {
        if line.trim() == "live" {
            *went_live = true;
            report(out, target, missing, CastPhase::Live, None);
        }
    }
    let status = child.wait().await.map_err(|e| format!("gg-cast：{e}"))?;
    let last = last_error.await.unwrap_or_default();
    Ok(if last.is_empty() { format!("gg-cast 已退出（{status}）") } else { last })
}

/// gg-cast's window arguments: the processes that may own it and, for a mini program, the titles it may have.
async fn window_args(inner: &Inner, source: &CastSource) -> Result<Vec<String>, String> {
    let join = |pids: Vec<u32>| pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    match source {
        CastSource::Service { service } => {
            let pid = inner.services.pid(service).ok_or("服务已停止，请重新启动服务后再看")?;
            Ok(vec!["--pids".into(), join(process_tree(pid))])
        }
        CastSource::Miniprogram { miniprogram } => {
            if !cfg!(target_os = "macos") {
                return Err("小程序实时画面目前只支持 macOS".into());
            }
            // Its window exists once the project is open (§12.2: the devtools keep rendering it behind other windows).
            let project = Path::new(miniprogram);
            if crate::wechatide::open(inner.devtools, project, None).await?.is_some() {
                return Err("微信开发者工具未登录：请 Bot 主人在卡片上扫码登录后再看".into());
            }
            let (pids, titles) = crate::wechatide::simulator_window(project)?;
            let mut args = vec!["--pids".into(), join(pids)];
            for title in titles {
                args.extend(["--title".into(), title]);
            }
            Ok(args)
        }
    }
}

/// The service's process and all its descendants: GUI apps usually run under the shell or package manager started.
fn process_tree(root: u32) -> Vec<u32> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut tree = vec![root];
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i];
        tree.extend(
            sys.processes()
                .values()
                .filter(|p| p.parent().map(|x| x.as_u32()) == Some(parent))
                .map(|p| p.pid().as_u32()),
        );
        i += 1;
    }
    tree
}

#[derive(Deserialize)]
struct CastToken {
    url: Option<String>,
    token: String,
}

async fn cast_token(api: &Config, preview_id: &str) -> Result<CastToken, String> {
    let fetch = async {
        let url = format!("{}/api/daemon/previews/{preview_id}/cast", api.server.trim_end_matches('/'));
        let res = crate::tls::client(api)?.post(url).bearer_auth(&api.token).send().await?;
        anyhow::Ok(crate::bots::ok(res).await?.json::<CastToken>().await?)
    };
    fetch.await.map_err(|e| format!("无法取得推流凭据：{e:#}"))
}

#[derive(Deserialize)]
struct CastBuild {
    version: String,
    url: String,
    sha256: String,
}

/// The server's published gg-cast for this platform, downloaded into `<home>/bin` once per build and verified.
pub async fn binary(api: &Config, home: &Path) -> Result<PathBuf, String> {
    let http = crate::tls::client(api).map_err(|e| format!("{e:#}"))?;
    let lookup = async {
        let url = format!("{}/api/daemon/cast-build", api.server.trim_end_matches('/'));
        let res = http.get(url).bearer_auth(&api.token).send().await?;
        anyhow::Ok(crate::bots::ok(res).await?.json::<CastBuild>().await?)
    };
    let build = lookup.await.map_err(|e| format!("无法取得 gg-cast：{e:#}"))?;
    let name = format!("gg-cast-{}-{}{}", build.version, &build.sha256[..12], std::env::consts::EXE_SUFFIX);
    let path = home.join("bin").join(name);
    if path.is_file() {
        return Ok(path);
    }
    let bytes = crate::upgrade::download(&api.server, &http, &build.url, &build.sha256)
        .await
        .map_err(|e| format!("下载 gg-cast 失败：{e}"))?;
    let install = async {
        tokio::fs::create_dir_all(path.parent().expect("in bin")).await?;
        let part = path.with_extension(format!("part{}", std::process::id()));
        tokio::fs::write(&part, &bytes).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).await?;
        }
        tokio::fs::rename(&part, &path).await
    };
    install.await.map_err(|e| format!("无法保存 gg-cast：{e}"))?;
    Ok(path)
}

/// A loopback WebSocket relay to the server's `/livekit` signaling, through the daemon's pinned TLS.
pub struct Relay {
    url: String,
    task: JoinHandle<()>,
}

impl Relay {
    pub async fn start(config: Config) -> Result<Relay, String> {
        let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("无法监听本机端口：{e}"))?;
        let url = format!("ws://{}", listener.local_addr().map_err(|e| e.to_string())?);
        let task = tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let config = config.clone();
                tokio::spawn(async move {
                    if let Err(e) = bridge(&config, tcp).await {
                        tracing::debug!("cast relay: {e:#}");
                    }
                });
            }
        });
        Ok(Relay { url, task })
    }

    pub fn url(&self) -> String {
        self.url.clone()
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.task.abort();
    }
}

// The handshake callback's error type is tungstenite's own.
#[allow(clippy::result_large_err)]
async fn bridge(config: &Config, tcp: TcpStream) -> anyhow::Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let local = tokio_tungstenite::accept_hdr_async(tcp, move |req: &Request, res: Response| {
        let _ = tx.send(req.uri().to_string());
        Ok(res)
    })
    .await?;
    let path = rx.recv()?;
    let url = format!("{}/livekit{path}", config.server.trim_end_matches('/').replacen("http", "ws", 1));
    let upstream = crate::tls::connect_url(config, &url).await?;
    let (mut local_tx, mut local_rx) = local.split();
    let (mut up_tx, mut up_rx) = upstream.split();
    let up = async {
        while let Some(m) = local_rx.next().await {
            up_tx.send(m?).await?;
        }
        anyhow::Ok(())
    };
    let down = async {
        while let Some(m) = up_rx.next().await {
            local_tx.send(m?).await?;
        }
        anyhow::Ok(())
    };
    tokio::select! {
        r = up => r,
        r = down => r,
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::wechatide::fake;

    #[tokio::test]
    async fn a_mini_program_waits_for_the_devtools_login_before_publishing() {
        let world = fake::World { trusted: Arc::new(true.into()), ..Default::default() };
        let (calls, devtools, _data) = fake::install(fake::answering(world)).await;
        let (home, project) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(project.path().join("project.config.json"), "{}").unwrap();
        let api = Config {
            server: "http://127.0.0.1:9".into(),
            token: "mt".into(),
            machine_id: "m".into(),
            owner_name: "王磊".into(),
            cert_sha256: None,
        };
        let casts =
            Casts::new(Some(api), home.path().into(), Services::new(home.path()), Some("gg-cast".into()), devtools)
                .permissions(Vec::new);
        let (out, mut rx) = Outbox::channel();
        let miniprogram = project.path().to_string_lossy().into_owned();
        casts.sync(vec![CastTarget { preview_id: "p1".into(), source: CastSource::Miniprogram { miniprogram } }], &out);

        let mut states = vec![];
        while states.len() < 2 {
            if let Some(DaemonToServer::CastState { state, error, .. }) = rx.recv().await {
                states.push((state, error));
            }
        }
        assert_eq!(states[0], (CastPhase::Starting, None));
        assert_eq!(states[1].0, CastPhase::Failed);
        assert!(states[1].1.as_deref().unwrap().contains("未登录"), "{:?}", states[1]);
        assert!(calls.lock().unwrap().iter().any(|c| c.0 == "login"));
        casts.sync(vec![], &out);
    }
}
