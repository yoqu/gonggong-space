//! Live previews (plan 结果预览 B2, B6-2): one gg-cast per watched preview, publishing a hosted service's window or a
//! mini program's simulator to the preview's LiveKit room for as long as the server asks for it (`cast.sync`);
//! restarted after a failure, stopped when nobody watches. gg-cast bundles libwebrtc, so `gg` does not: the desktop
//! app ships it beside its executable, the CLI downloads the server's build on first use.
use crate::config::Config;
use crate::hosted::Services;
use crate::permission::{self, Permission};
use crate::protocol::{CastPhase, CastSource, CastTarget, DaemonToServer, DevtoolsBlocker};
use crate::service::Outbox;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::sync::{Notify, watch};
use tokio::task::{AbortHandle, JoinHandle};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

const FIRST_RETRY: Duration = Duration::from_secs(2);
const MAX_RETRY: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct Casts(Arc<Inner>);

/// A preview's gg-cast: what it publishes, its frame rate, which reaches it without a restart, and the nudge that
/// retries it now.
type Run = (CastSource, AbortHandle, watch::Sender<u32>, Arc<Notify>);

struct Inner {
    api: Option<Config>,
    home: PathBuf,
    services: Services,
    /// `local_bin`: used instead of the server's build.
    bin: Option<PathBuf>,
    devtools: &'static crate::wechatide::Shared,
    /// The permissions this machine lacks, checked before each run (`permission::missing`).
    missing: fn() -> Vec<Permission>,
    running: Mutex<HashMap<String, Run>>,
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

    /// Runs exactly the `wanted` casts: new ones start, dropped ones stop (their gg-cast is killed), a changed frame
    /// rate is passed on.
    pub fn sync(&self, wanted: Vec<CastTarget>, out: &Outbox) {
        let mut running = self.0.running.lock().unwrap();
        running.retain(|id, (source, task, _, _)| {
            let keep = wanted.iter().any(|w| &w.preview_id == id && &w.source == source);
            if !keep {
                task.abort();
            }
            keep
        });
        for target in wanted {
            if let Some((_, _, fps, _)) = running.get(&target.preview_id) {
                fps.send_replace(target.fps);
                continue;
            }
            let (fps, rx) = watch::channel(target.fps);
            let nudge = Arc::new(Notify::new());
            let task = tokio::spawn(supervise(self.0.clone(), target.clone(), rx, nudge.clone(), out.clone()));
            running.insert(target.preview_id, (target.source, task.abort_handle(), fps, nudge));
        }
    }

    /// Tries a failed cast again now (立即重试), starting over from the shortest wait; one running is left alone.
    pub fn retry(&self, preview_id: &str) {
        if let Some((_, _, _, nudge)) = self.0.running.lock().unwrap().get(preview_id) {
            nudge.notify_one();
        }
    }
}

/// The gg-cast to run instead of the server's: GG_CAST_BIN (a local build), else the one beside this executable.
pub fn local_bin() -> Option<PathBuf> {
    std::env::var_os("GG_CAST_BIN").map(PathBuf::from).or_else(bundled)
}

/// The desktop app's own gg-cast (Tauri `externalBin`: next to the app executable, same build), run in place. macOS
/// judges an executable inside the bundle as the app: signed with the app's Developer ID it has the app's screen
/// recording grant; in an ad-hoc signed app the grant is keyed to the main executable's cdhash and gg-cast is refused.
pub fn bundled() -> Option<PathBuf> {
    beside(&std::env::current_exe().ok()?)
}

fn beside(exe: &Path) -> Option<PathBuf> {
    Some(exe.parent()?.join(format!("gg-cast{}", std::env::consts::EXE_SUFFIX))).filter(|p| p.is_file())
}

/// Every state carries the missing permissions: without accessibility the window shows, but control does nothing.
fn report(out: &Outbox, target: &CastTarget, missing: &[Permission], state: CastPhase) {
    let preview_id = target.preview_id.clone();
    let missing = missing.to_vec();
    out.send(DaemonToServer::CastState { preview_id, state, error: None, missing, devtools: None, retry_in: None });
}

/// A failed run, and when it is tried again.
fn report_stop(out: &Outbox, target: &CastTarget, missing: &[Permission], stop: Stop, retry: Duration) {
    out.send(DaemonToServer::CastState {
        preview_id: target.preview_id.clone(),
        state: CastPhase::Failed,
        error: Some(stop.reason),
        missing: missing.to_vec(),
        devtools: stop.devtools,
        retry_in: Some(retry.as_secs()),
    });
}

/// Why a run ended; `devtools` when it waits on the owner in the WeChat devtools, `owner` when the owner fixes it on
/// the machine (shows the window, starts the service, grants a permission) and it is worth trying again soon.
struct Stop {
    reason: String,
    devtools: Option<DevtoolsBlocker>,
    owner: bool,
}

impl Stop {
    fn owner(reason: impl Into<String>) -> Self {
        Stop { reason: reason.into(), devtools: None, owner: true }
    }
}

impl From<String> for Stop {
    fn from(reason: String) -> Self {
        Stop { reason, devtools: None, owner: false }
    }
}

impl From<&str> for Stop {
    fn from(reason: &str) -> Self {
        reason.to_string().into()
    }
}

impl From<crate::wechatide::Error> for Stop {
    fn from(e: crate::wechatide::Error) -> Self {
        let devtools = e.blocker();
        Stop { owner: devtools.is_some(), devtools, reason: crate::wechatide::explain(e) }
    }
}

/// Runs are retried with a growing wait, except what waits on the owner on the machine: that is retried every
/// `FIRST_RETRY`, without reporting each start, so what they do there shows at once and the reason stays up meanwhile.
/// A nudge (立即重试) retries at once, reporting the start.
async fn supervise(
    inner: Arc<Inner>,
    target: CastTarget,
    mut fps: watch::Receiver<u32>,
    nudge: Arc<Notify>,
    out: Outbox,
) {
    let mut retry = FIRST_RETRY;
    let mut quiet = false;
    loop {
        let missing = (inner.missing)();
        if !quiet {
            report(&out, &target, &missing, CastPhase::Starting);
        }
        let mut went_live = false;
        let (Ok(stop) | Err(stop)) = publish(&inner, &target, &mut fps, &out, &missing, quiet, &mut went_live).await;
        quiet = stop.owner;
        if went_live || quiet {
            retry = FIRST_RETRY;
        }
        report_stop(&out, &target, &missing, stop, retry);
        tokio::select! {
            _ = tokio::time::sleep(retry) => {
                if !quiet {
                    retry = (retry * 2).min(MAX_RETRY);
                }
            }
            _ = nudge.notified() => {
                quiet = false;
                retry = FIRST_RETRY;
            }
        }
    }
}

/// One gg-cast run; why it ended. After a `quiet` run a mini program reports starting only once its devtools answer.
async fn publish(
    inner: &Inner,
    target: &CastTarget,
    fps: &mut watch::Receiver<u32>,
    out: &Outbox,
    missing: &[Permission],
    quiet: bool,
    went_live: &mut bool,
) -> Result<Stop, Stop> {
    let api = inner.api.as_ref().ok_or("未连接服务器")?;
    if missing.contains(&Permission::ScreenRecording) {
        return Err(Stop::owner(permission::SCREEN_RECORDING_DENIED));
    }
    if matches!(target.source, CastSource::Miniprogram { .. }) {
        inner.devtools.ping().await?;
        if quiet {
            report(out, target, missing, CastPhase::Starting);
        }
    }
    let (window, display) = window_args(inner, &target.source).await?;
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
    let mut cmd = Command::new(&bin);
    if let Some(display) = display {
        cmd.env("DISPLAY", display).env("XDG_SESSION_TYPE", "x11").env_remove("WAYLAND_DISPLAY");
    }
    let mut child = cmd
        .args(["--url", &url])
        .args(window)
        .args(["--fps", &fps.borrow_and_update().to_string()])
        .env("GG_CAST_TOKEN", &token.token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("无法启动 gg-cast：{e}"))?;
    // gg-cast exits once this closes: when this task is stopped, or the daemon is gone without killing it.
    let mut stdin = child.stdin.take().expect("piped");
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
    loop {
        tokio::select! {
            line = stdout.next_line() => match line {
                Ok(Some(line)) if line.trim() == "live" => {
                    *went_live = true;
                    report(out, target, missing, CastPhase::Live);
                }
                Ok(Some(_)) => {}
                _ => break,
            },
            Ok(()) = fps.changed() => {
                let line = format!("fps {}\n", *fps.borrow_and_update());
                let _ = stdin.write_all(line.as_bytes()).await;
            }
        }
    }
    let status = child.wait().await.map_err(|e| format!("gg-cast：{e}"))?;
    let last = last_error.await.unwrap_or_default();
    let reason = if last.is_empty() { format!("gg-cast 已退出（{status}）") } else { last };
    // gg-cast exits 2 on what the owner fixes on the machine: no visible window, a closed or misplaced one.
    Ok(if status.code() == Some(2) { Stop::owner(reason) } else { reason.into() })
}

/// gg-cast's window arguments: the processes that may own it and, for a mini program, the titles it may have; or the
/// whole screen of the service's own virtual display, which gg-cast then runs on.
async fn window_args(inner: &Inner, source: &CastSource) -> Result<(Vec<String>, Option<String>), Stop> {
    let join = |pids: Vec<u32>| pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
    match source {
        CastSource::Service { service } => {
            let pid = inner.services.pid(service).ok_or_else(|| Stop::owner("服务已停止，请重新启动服务后再看"))?;
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
            crate::wechatide::require_project(project)?;
            match inner.devtools.open(project, None).await {
                Ok(()) => {}
                Err(crate::wechatide::Error::NeedsLogin(_)) => {
                    return Err("微信开发者工具未登录：请 Bot 主人在卡片上扫码登录后再看".into());
                }
                Err(e) => return Err(e.into()),
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
        casts.sync(
            vec![CastTarget { preview_id: "p1".into(), source: CastSource::Miniprogram { miniprogram }, fps: 30 }],
            &out,
        );

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

    #[tokio::test]
    async fn a_mini_program_keeps_the_port_guide_up_until_the_devtools_answer() {
        let (home, project, data) =
            (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(project.path().join("project.config.json"), "{}").unwrap();
        let devtools = Box::leak(Box::new(crate::wechatide::Shared::new(
            vec![data.path().into()],
            Arc::new(|_: &Path| false),
            Arc::new(|| crate::wechatide::Launched::Already),
        )));
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
        casts.sync(
            vec![CastTarget { preview_id: "p1".into(), source: CastSource::Miniprogram { miniprogram }, fps: 30 }],
            &out,
        );
        let mut next = async || loop {
            if let Some(DaemonToServer::CastState { state, devtools, .. }) = rx.recv().await {
                break (state, devtools);
            }
        };

        assert_eq!(next().await, (CastPhase::Starting, None));
        assert_eq!(next().await, (CastPhase::Failed, Some(DevtoolsBlocker::Port)));
        assert_eq!(next().await, (CastPhase::Failed, Some(DevtoolsBlocker::Port)), "retried without a loading flash");

        let f = fake::fake(false, fake::standard()).await;
        fake::port_file(data.path(), "h", f.port);
        let (state, _) = next().await;
        let state = if state == CastPhase::Failed { next().await.0 } else { state };
        assert_eq!(state, CastPhase::Starting, "the devtools answer: loading again");
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
}
