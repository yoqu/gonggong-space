//! Live previews (plan 结果预览 B2, B6-2): one gg-cast per watched preview, publishing a hosted service's window or a
//! mini program's simulator to the preview's LiveKit room for as long as the server asks for it (`cast.sync`);
//! restarted after a failure, stopped when nobody watches. gg-cast bundles libwebrtc, so `gg` does not: the desktop
//! app ships it beside its executable, the CLI downloads the server's build on first use.
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
    /// `local_bin`: used instead of the server's build.
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

/// The gg-cast to run instead of the server's: GG_CAST_BIN (a local build), else the one beside this executable.
pub fn local_bin() -> Option<PathBuf> {
    std::env::var_os("GG_CAST_BIN").map(PathBuf::from).or_else(bundled)
}

/// The desktop app's own gg-cast (Tauri `externalBin`: next to the app executable, same build).
pub fn bundled() -> Option<PathBuf> {
    beside(&std::env::current_exe().ok()?)
}

/// A copy of the bundled gg-cast outside the app, where it runs. macOS judges an executable inside an app bundle as
/// the app itself: gg-cast's ad-hoc signature is not the app's, so screen recording was refused (ScreenCaptureKit
/// -3801) although the app was granted; outside, it is the app's child and inherits the grant. One copy per build.
pub async fn staged(bundled: &Path, home: &Path) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    let stage = async {
        let bytes = tokio::fs::read(bundled).await?;
        let sha: String = Sha256::digest(&bytes).iter().take(6).map(|b| format!("{b:02x}")).collect();
        let dir = home.join("bin");
        let path = dir.join(format!("gg-cast-bundled-{sha}{}", std::env::consts::EXE_SUFFIX));
        if path.is_file() {
            return Ok(path);
        }
        tokio::fs::create_dir_all(&dir).await?;
        let part = path.with_extension(format!("part{}", std::process::id()));
        tokio::fs::copy(bundled, &part).await?;
        tokio::fs::rename(&part, &path).await?;
        let mut old = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = old.next_entry().await? {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with("gg-cast-bundled-") && entry.path() != path {
                let _ = tokio::fs::remove_file(entry.path()).await;
            }
        }
        std::io::Result::Ok(path)
    };
    stage.await.map_err(|e| format!("无法准备内置的 gg-cast：{e}"))
}

fn beside(exe: &Path) -> Option<PathBuf> {
    Some(exe.parent()?.join(format!("gg-cast{}", std::env::consts::EXE_SUFFIX))).filter(|p| p.is_file())
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
    let (window, display) = window_args(inner, &target.source).await?;
    let bin = match &inner.bin {
        Some(bin) if bundled().as_ref() == Some(bin) => staged(bin, &inner.home).await?,
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
    let mut cmd = Command::new(&bin);
    if let Some(display) = display {
        cmd.env("DISPLAY", display).env("XDG_SESSION_TYPE", "x11").env_remove("WAYLAND_DISPLAY");
    }
    let mut child = cmd
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

/// gg-cast's window arguments: the processes that may own it and, for a mini program, the titles it may have; or the
/// whole screen of the service's own virtual display, which gg-cast then runs on.
async fn window_args(inner: &Inner, source: &CastSource) -> Result<(Vec<String>, Option<String>), String> {
    let join = |pids: Vec<u32>| pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    match source {
        CastSource::Service { service } => {
            let pid = inner.services.pid(service).ok_or("服务已停止，请重新启动服务后再看")?;
            Ok(match inner.services.display(service) {
                Some(display) => (vec!["--screen".into()], Some(display)),
                None => (vec!["--pids".into(), join(process_tree(pid))], None),
            })
        }
        CastSource::Miniprogram { miniprogram } => {
            if !cfg!(any(target_os = "macos", windows)) {
                return Err("小程序实时画面目前只支持 macOS 和 Windows".into());
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
            Ok((args, None))
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
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let (tx, rx) = std::sync::mpsc::channel();
    // The SDK sends its token as `Authorization: Bearer`, which LiveKit needs as much as the path.
    let local = tokio_tungstenite::accept_hdr_async(tcp, move |req: &Request, res: Response| {
        let _ = tx.send((req.uri().to_string(), req.headers().get("authorization").cloned()));
        Ok(res)
    })
    .await?;
    let (path, auth) = rx.recv()?;
    let url = format!("{}/livekit{path}", config.server.trim_end_matches('/').replacen("http", "ws", 1));
    let mut request = url.into_client_request()?;
    if let Some(auth) = auth {
        request.headers_mut().insert("authorization", auth);
    }
    let upstream = crate::tls::connect_url(config, request).await?;
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

#[cfg(test)]
mod bin_tests {
    use super::*;

    #[test]
    fn a_bundled_gg_cast_sits_beside_the_executable() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("gonggong-desktop");
        assert_eq!(beside(&exe), None);
        let cast = dir.path().join(format!("gg-cast{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&cast, "").unwrap();
        assert_eq!(beside(&exe), Some(cast));
    }

    #[tokio::test]
    async fn the_bundled_gg_cast_runs_from_a_copy_outside_the_app() {
        let (app, home) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let bundled = app.path().join("gg-cast");
        std::fs::write(&bundled, "v1").unwrap();
        let first = staged(&bundled, home.path()).await.unwrap();
        assert!(first.starts_with(home.path().join("bin")));
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "v1");
        assert_eq!(staged(&bundled, home.path()).await.unwrap(), first);
        std::fs::write(&bundled, "v2").unwrap();
        let second = staged(&bundled, home.path()).await.unwrap();
        assert_ne!(second, first);
        assert!(!first.exists(), "the previous build's copy is removed");
    }
}
