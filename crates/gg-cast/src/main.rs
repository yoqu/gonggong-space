//! gg-cast (plan 结果预览 B2): publishes one app window to a preview's LiveKit room for the daemon.
//!
//! `gg-cast --url <signaling url> (--pids <pid,pid,…> [--title <title>]… | --screen) [--fps 30]`, the publisher token
//! in `GG_CAST_TOKEN`. Publishes a visible window of those processes (see `pick`), or with `--screen` the whole screen
//! of `$DISPLAY` (Linux: a service's own virtual display, plan B3), prints `live` once it is published, and runs until
//! the window closes,
//! the room drops it, or stdin closes (the daemon that started it is gone). Failures go to stderr, the last line being
//! the reason shown to users, and exit 1. The member granted control sends input on the data channel (topic `input`,
//! see `input.rs`); LiveKit only lets that member publish data.
mod input;
mod window;

use anyhow::{Context, bail};
use input::{Injector, Input};
use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoding, VideoPreset};
use livekit::prelude::*;
use livekit::track::{LocalTrack, LocalVideoTrack, TrackSource};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, RtcVideoSource, VideoBuffer, VideoFrame, VideoResolution, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use webrtc_sys::desktop_capturer::ffi::{self as capture_ffi, DesktopFrame, SourceType};
use webrtc_sys::desktop_capturer::{CaptureError, DesktopCapturerCallback, DesktopCapturerCallbackWrapper};

/// B0: H264 is hardware-encoded on macOS, about a quarter of VP8's CPU. A Linux virtual display has no encoder
/// hardware to use and is small; VP8 there is decoded by every browser build, including Chromium without H264.
const CODEC: VideoCodec = if cfg!(target_os = "linux") { VideoCodec::VP8 } else { VideoCodec::H264 };
const MAX_BITRATE: u64 = 3_000_000;
/// `CAST_INPUT_TOPIC` in packages/protocol.
const INPUT_TOPIC: &str = "input";

#[derive(Debug, PartialEq)]
struct Args {
    url: String,
    pids: Vec<u32>,
    /// A mini program's simulator: the devtools own many windows, the project's is titled after it.
    titles: Vec<String>,
    fps: u32,
    screen: bool,
}

fn parse(args: impl IntoIterator<Item = String>) -> anyhow::Result<Args> {
    let (mut url, mut pids, mut titles, mut fps, mut screen) = (None, vec![], vec![], 30, false);
    let mut it = args.into_iter();
    while let Some(k) = it.next() {
        if k == "--screen" {
            screen = true;
            continue;
        }
        let v = it.next().with_context(|| format!("{k} 缺少取值"))?;
        match k.as_str() {
            "--url" => url = Some(v),
            "--pids" => {
                pids = v.split(',').map(str::parse).collect::<Result<_, _>>().context("--pids 应为逗号分隔的进程号")?
            }
            "--title" => titles.push(v),
            "--fps" => fps = v.parse().context("--fps 应为整数")?,
            _ => bail!("未知参数 {k}"),
        }
    }
    // Linux publishes a service's own virtual display, never windows on the owner's desktop (plan P15); elsewhere the
    // screen would be the owner's own.
    if cfg!(target_os = "linux") != screen || screen == !pids.is_empty() {
        bail!(
            "Linux 上只能推送虚拟显示里的桌面应用：请用 service_start 的 display: \"virtual\" 重新启动服务（其他系统推送窗口，用 --pids）"
        );
    }
    Ok(Args { url: url.context("缺少 --url")?, pids, titles, fps, screen })
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

/// Why capture failed when this process is refused screen recording. Only a hint: preflight is unreliable in a child
/// process (it said no for gg-cast spawned by the granted 共工.app), so the daemon's own check in the responsible
/// process decides whether to start gg-cast at all, and capture itself is tried regardless.
fn screen_recording_hint() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    // SAFETY: no arguments; only reads the TCC state.
    if !unsafe { CGPreflightScreenCaptureAccess() } {
        return Some(
            "本机没有授予「屏幕录制」权限：请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许运行 gg 的程序（终端或共工桌面端）",
        );
    }
    None
}

/// A visible window that may be published.
#[cfg(not(target_os = "linux"))]
#[derive(Debug, Clone)]
struct Candidate {
    id: u32,
    pid: u32,
    title: String,
    width: u32,
    height: u32,
    /// Above normal windows: the devtools keep a liteMode (simulator only) window always on top.
    floating: bool,
}

/// The window of `pids` to publish: the largest (apps own helper windows too), or with `titles` (a mini program's
/// simulator, titled after its project) the earliest title matched, always-on-top before others: another project's
/// full IDE window may carry the same directory name and be larger.
#[cfg(not(target_os = "linux"))]
fn pick(windows: Vec<Candidate>, pids: &[u32], titles: &[String]) -> Option<Candidate> {
    windows
        .into_iter()
        .filter(|w| pids.contains(&w.pid))
        .filter_map(|w| Some((if titles.is_empty() { 0 } else { titles.iter().position(|t| *t == w.title)? }, w)))
        .min_by_key(|(rank, w)| {
            (*rank, titles.is_empty() || !w.floating, std::cmp::Reverse(w.width as u64 * w.height as u64))
        })
        .map(|(_, w)| w)
}

/// What to publish: its capture source (a window id, or none for the screen), size and input target.
#[cfg(not(target_os = "linux"))]
fn shown(a: &Args) -> anyhow::Result<(Option<u32>, (u32, u32), window::Shown)> {
    let w = find_window(&a.pids, &a.titles)?;
    Ok((Some(w.id), (w.width, w.height), window::Shown::Window { id: w.id, pid: w.pid, title: w.title }))
}

#[cfg(target_os = "linux")]
fn shown(_: &Args) -> anyhow::Result<(Option<u32>, (u32, u32), window::Shown)> {
    let f = window::screen()?;
    Ok((None, (f.width, f.height), window::Shown::Screen))
}

#[cfg(not(target_os = "linux"))]
fn find_window(pids: &[u32], titles: &[String]) -> anyhow::Result<Candidate> {
    let floating = window::floating();
    let visible = xcap::Window::all()?.into_iter().filter(|w| !w.is_minimized().unwrap_or(true)).filter_map(|w| {
        let id = w.id().ok()?;
        Some(Candidate {
            id,
            pid: w.pid().ok()?,
            title: w.title().unwrap_or_default(),
            width: w.width().ok()?,
            height: w.height().ok()?,
            floating: floating.contains(&id),
        })
    });
    pick(visible.collect(), pids, titles).context("应用还没有可见窗口（或窗口已最小化）")
}

type Slot = Arc<Mutex<(NativeVideoSource, VideoFrame<I420Buffer>)>>;

/// Where a floating window sits on its display, in points: libwebrtc lists only normal-layer windows (its
/// `only_zero_layer`), so an always-on-top one (the devtools' liteMode simulator) is cut out of its display's frames,
/// where nothing covers it.
#[derive(Clone, Copy)]
struct Region {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
    display_width: u32,
    /// macOS: the `CGDirectDisplayID` ScreenCaptureKit selects the display by.
    display: u32,
    primary: bool,
}

/// Where window `id` is, on which display.
#[cfg(not(target_os = "linux"))]
fn region(id: u32) -> anyhow::Result<Region> {
    let w = xcap::Window::all()?.into_iter().find(|w| w.id().ok() == Some(id)).context("窗口已关闭")?;
    let m = w.current_monitor()?;
    Ok(Region {
        left: w.x()? - m.x()?,
        top: w.y()? - m.y()?,
        width: w.width()?,
        height: w.height()?,
        display_width: m.width()?,
        display: m.id()?,
        primary: m.is_primary()?,
    })
}

#[cfg(target_os = "linux")]
fn region(_: u32) -> anyhow::Result<Region> {
    bail!("Linux 只推送虚拟屏")
}

/// The part of a `fw`×`fh` frame to publish, as x, y, width, height in pixels: `region` of it
/// when given; none when the window is off the display.
fn crop(fw: u32, fh: u32, region: Option<Region>) -> Option<(u32, u32, u32, u32)> {
    let Some(r) = region else { return Some((0, 0, fw, fh)) };
    let scale = fw as f64 / r.display_width as f64;
    let px = |v: f64| (v.max(0.0) * scale) as u32;
    let (x, y) = (px(r.left as f64), px(r.top as f64));
    if x >= fw || y >= fh {
        return None;
    }
    // libyuv's wrapper asserts `stride` bytes for every row from the first pixel on, which the frame's last row lacks
    // past `x`; a panic in the capture callback aborts gg-cast, and the window at the bottom edge fails every restart.
    let rows = fh - y - u32::from(x > 0);
    let (w, h) = (px(r.width as f64).min(fw - x), px(r.height as f64).min(rows));
    (w > 0 && h > 0).then_some((x, y, w, h))
}

/// BGRA (libyuv "ARGB") → I420 → the track; only `region` of the frame when given.
fn push(slot: &Slot, f: &DesktopFrame, region: Option<Region>) {
    let (fw, fh, stride) = (f.width() as u32, f.height() as u32, f.stride() as u32);
    let Some((x, y, w, h)) = crop(fw, fh, region) else { return };
    // SAFETY: a frame holds `stride` bytes for each of its rows.
    let pixels = unsafe { std::slice::from_raw_parts(f.data(), (stride * fh) as usize) };
    let data = &pixels[(y * stride + x * 4) as usize..];
    let mut guard = slot.lock().unwrap();
    let (source, frame) = &mut *guard;
    if frame.buffer.width() != w || frame.buffer.height() != h {
        frame.buffer = I420Buffer::new(w, h);
    }
    let (sy, su, sv) = frame.buffer.strides();
    let (dy, du, dv) = frame.buffer.data_mut();
    yuv_helper::argb_to_i420(data, stride, dy, sy, du, su, dv, sv, w as i32, h as i32);
    source.capture_frame(frame);
}

type Capturer = cxx::UniquePtr<capture_ffi::DesktopCapturer>;

fn capturer(source_type: SourceType) -> anyhow::Result<Capturer> {
    let c = capture_ffi::new_desktop_capturer(capture_ffi::DesktopCapturerOptions {
        source_type,
        include_cursor: true,
        allow_sck_system_picker: false,
    });
    if c.is_null() {
        bail!("无法创建窗口采集器");
    }
    Ok(c)
}

/// A floating window cut out of its display: its id, to follow it, and where it is now.
type Cut = (u32, Arc<Mutex<Region>>);

/// Frames into the track (cut to `region` when set); a lost source ends publishing.
struct OnFrame {
    slot: Slot,
    region: Option<Arc<Mutex<Region>>>,
    ended: mpsc::UnboundedSender<String>,
}

impl DesktopCapturerCallback for OnFrame {
    fn on_capture_result(&mut self, r: Result<cxx::UniquePtr<DesktopFrame>, CaptureError>) {
        match r {
            Ok(f) => push(&self.slot, &f, self.region.as_ref().map(|r| *r.lock().unwrap())),
            Err(CaptureError::Permanent) => {
                let _ = self.ended.send("窗口已关闭".into());
            }
            Err(CaptureError::Temporary) => {}
        }
    }
}

/// The capturer started on the window (or the screen without one); a floating window's display, cut to the window.
fn start(
    window_id: Option<u32>,
    slot: &Slot,
    ended: &mpsc::UnboundedSender<String>,
) -> anyhow::Result<(Capturer, Option<Cut>)> {
    let begin = |mut c: Capturer, source: Option<u64>, region: Option<Arc<Mutex<Region>>>| {
        if let Some(id) = source {
            c.select_source(id);
        }
        let frames = OnFrame { slot: slot.clone(), region, ended: ended.clone() };
        c.pin_mut().start(Box::new(DesktopCapturerCallbackWrapper::new(Box::new(frames))));
        c
    };
    let Some(id) = window_id else {
        let c = capturer(SourceType::Screen)?;
        let s = c.get_source_list().first().ok_or_else(|| no_source(window_id))?.id;
        return Ok((begin(c, Some(s), None), None));
    };
    let c = capturer(SourceType::Window)?;
    if c.get_source_list().iter().any(|s| s.id == id as u64) {
        return Ok((begin(c, Some(id as u64), None), None));
    }
    let r = region(id)?;
    // Windows captures the main display unselected; ScreenCaptureKit lists no displays but selects one by its id.
    if cfg!(windows) && !r.primary {
        bail!("要推送的窗口是置顶窗口，只能在主显示器上推送：请把它移到主显示器");
    }
    let region = Arc::new(Mutex::new(r));
    let display = cfg!(target_os = "macos").then_some(r.display as u64);
    Ok((begin(capturer(SourceType::Screen)?, display, Some(region.clone())), Some((id, region))))
}

fn no_source(window_id: Option<u32>) -> anyhow::Error {
    let hint = screen_recording_hint().map(String::from);
    anyhow::anyhow!(hint.unwrap_or_else(|| format!("采集器里没有要推送的画面（{window_id:?}）")))
}

/// The native capturer (macOS: ScreenCaptureKit, B0: far cheaper than screenshots) on the window found by pid, or on
/// the screen without one; sends why capturing ended.
fn capture(window_id: Option<u32>, fps: u32, slot: Slot, ended: mpsc::UnboundedSender<String>) -> anyhow::Result<()> {
    let (ready, started) = std::sync::mpsc::channel::<anyhow::Result<()>>();
    std::thread::spawn(move || {
        let (capturer, cut) = match start(window_id, &slot, &ended) {
            Ok(v) => v,
            Err(e) => {
                let _ = ready.send(Err(e));
                return;
            }
        };
        let _ = ready.send(Ok(()));
        let period = Duration::from_secs_f64(1.0 / fps as f64);
        let mut moved_at = Instant::now();
        loop {
            let t = Instant::now();
            capturer.capture_frame();
            // A cut-out window may be moved or closed; its display's capture would not say.
            if let Some((id, at)) = &cut
                && moved_at.elapsed() >= Duration::from_millis(500)
            {
                moved_at = Instant::now();
                match region(*id) {
                    Ok(r) => {
                        let mut at = at.lock().unwrap();
                        // Moved to another display: follow it there.
                        if cfg!(target_os = "macos") && r.display != at.display {
                            capturer.select_source(r.display as u64);
                        }
                        *at = r;
                    }
                    Err(e) => {
                        let _ = ended.send(e.to_string());
                        return;
                    }
                }
            }
            std::thread::sleep(period.saturating_sub(t.elapsed()));
        }
    });
    started.recv()?
}

/// Simulcast, so each viewer's quality (their pick, or LiveKit's per-viewer bandwidth estimate) leaves the others'
/// alone. The lower layers stay at half size, where text is still legible, and save mostly by frame rate. LiveKit
/// sends all three from 960 px up, two from 480 px.
fn publish_options(width: u32, height: u32, fps: u32) -> TrackPublishOptions {
    let (w, h) = (width / 2, height / 2);
    TrackPublishOptions {
        source: TrackSource::Screenshare,
        video_codec: CODEC,
        video_encoding: Some(VideoEncoding { max_bitrate: MAX_BITRATE, max_framerate: fps as f64 }),
        simulcast: true,
        simulcast_layers: Some(vec![VideoPreset::new(w, h, 300_000, 5.0), VideoPreset::new(w, h, 800_000, 15.0)]),
        ..Default::default()
    }
}

async fn run(a: Args) -> anyhow::Result<()> {
    let token = std::env::var("GG_CAST_TOKEN").context("缺少 GG_CAST_TOKEN")?;
    let (window, (width, height), target) = shown(&a)?;
    let (room, mut events) =
        Room::connect(&a.url, &token, RoomOptions::default()).await.context("无法连接实时画面服务（LiveKit）")?;
    let source = NativeVideoSource::new(VideoResolution { width, height }, true);
    let frame = VideoFrame {
        rotation: VideoRotation::VideoRotation0,
        timestamp_us: 0,
        frame_metadata: None,
        buffer: I420Buffer::new(width, height),
    };
    let slot: Slot = Arc::new(Mutex::new((source.clone(), frame)));
    let track = LocalVideoTrack::create_video_track("window", RtcVideoSource::Native(source));
    room.local_participant()
        .publish_track(LocalTrack::Video(track), publish_options(width, height, a.fps))
        .await
        .context("无法发布画面")?;

    let (ended_tx, mut ended) = mpsc::unbounded_channel();
    capture(window, a.fps, slot, ended_tx)?;
    // Created on the first input: on macOS it needs the accessibility permission, which viewing alone does not.
    let mut injector = None;
    let (gone_tx, mut gone) = mpsc::unbounded_channel::<()>();
    std::thread::spawn(move || {
        let _ = std::io::stdin().read_to_end(&mut Vec::new());
        let _ = gone_tx.send(());
    });
    println!("live");
    loop {
        tokio::select! {
            Some(reason) = ended.recv() => bail!(reason),
            _ = gone.recv() => return Ok(()),
            ev = events.recv() => match ev {
                Some(RoomEvent::Disconnected { reason }) => bail!("与实时画面服务断开（{reason:?}）"),
                Some(RoomEvent::DataReceived { payload, topic, .. }) if topic.as_deref() == Some(INPUT_TOPIC) => {
                    if let Err(e) = replay(&mut injector, &target, &payload).await {
                        eprintln!("input: {e:#}");
                    }
                }
                None => bail!("与实时画面服务断开"),
                Some(_) => {}
            },
        }
    }
}

async fn replay(
    injector: &mut Option<Injector<window::Shown>>,
    target: &window::Shown,
    payload: &[u8],
) -> anyhow::Result<()> {
    let input = Input::parse(payload)?;
    let injector = match injector {
        Some(i) => i,
        None => injector.insert(Injector::new(target.clone())?),
    };
    injector.apply(input).await
}

#[tokio::main]
async fn main() {
    let result = match parse(std::env::args().skip(1)) {
        Ok(a) => run(a).await,
        Err(e) => Err(e),
    };
    if let Err(e) = result {
        eprintln!("{e:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(s: &str) -> anyhow::Result<Args> {
        parse(s.split_whitespace().map(String::from))
    }

    #[test]
    fn publishes_quality_layers_for_viewers_to_pick() {
        let layers = |w, h| {
            livekit::options::compute_video_encodings(w, h, &publish_options(w, h, 30))
                .iter()
                .map(|e| (e.rid.clone(), e.scale_resolution_down_by, e.max_framerate))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            layers(1920, 1080),
            [
                ("f".into(), Some(1.0), Some(30.0)),
                ("h".into(), Some(2.0), Some(15.0)),
                ("q".into(), Some(2.0), Some(5.0))
            ]
        );
        // A phone-sized simulator window gets two.
        assert_eq!(layers(390, 844), [("h".into(), Some(1.0), Some(30.0)), ("q".into(), Some(2.0), Some(15.0))]);
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn parses_the_daemons_arguments() {
        assert_eq!(
            args("--url ws://127.0.0.1:5000 --pids 10,11,12").unwrap(),
            Args { url: "ws://127.0.0.1:5000".into(), pids: vec![10, 11, 12], titles: vec![], fps: 30, screen: false }
        );
        let mini = args("--url ws://x --pids 7 --title 商城 --title shop").unwrap();
        assert_eq!(mini.titles, ["商城", "shop"]);
        assert_eq!(args("--pids 1 --url wss://x --fps 15").unwrap().fps, 15);
        assert!(args("--url ws://x").is_err());
        assert!(args("--pids 1").is_err());
        assert!(args("--pids a --url ws://x").is_err());
        assert!(args("--pids 1 --url ws://x --codec vp8").is_err());
    }

    #[test]
    fn publishes_a_whole_virtual_screen_only_on_linux() {
        let screen = args("--url ws://x --screen");
        if cfg!(target_os = "linux") {
            assert_eq!(
                screen.unwrap(),
                Args { url: "ws://x".into(), pids: vec![], titles: vec![], fps: 30, screen: true }
            );
            assert!(args("--url ws://x --pids 1").is_err());
        } else {
            // Elsewhere the screen would be the owner's own.
            assert!(screen.unwrap_err().to_string().contains("Linux"));
        }
        assert!(args("--url ws://x --screen --pids 1").is_err());
    }

    #[test]
    fn crops_a_window_at_the_displays_edges_within_the_frame() {
        let (fw, fh, stride) = (2880, 1800, 2880 * 4 + 64);
        let at =
            |left, top| Region { left, top, width: 420, height: 904, display_width: 1440, display: 1, primary: true };
        let fits = |(x, y, w, h): (u32, u32, u32, u32)| {
            (stride * fh - (y * stride + x * 4)) >= stride * h && x + w <= fw && y + h <= fh
        };
        assert_eq!(crop(fw, fh, None), Some((0, 0, fw, fh)));
        assert_eq!(crop(fw, fh, Some(at(100, 50))), Some((200, 100, 840, 1699)));
        // Observed: dragged towards the bottom edge, the last row lacked `x * 4` bytes and gg-cast aborted.
        for (left, top) in [(100, 600), (1200, 895), (-50, 899), (0, 600), (1439, 0)] {
            assert!(fits(crop(fw, fh, Some(at(left, top))).unwrap()), "{left},{top}");
        }
        assert_eq!(crop(fw, fh, Some(at(1500, 10))), None);
        assert_eq!(crop(fw, fh, Some(at(10, 900))), None);
    }

    #[cfg(not(target_os = "linux"))]
    fn window(id: u32, pid: u32, title: &str, (width, height): (u32, u32), floating: bool) -> Candidate {
        Candidate { id, pid, title: title.into(), width, height, floating }
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn picks_the_largest_window_of_the_processes() {
        let all = vec![
            window(1, 7, "helper", (1, 10), true),
            window(2, 7, "main", (30, 30), false),
            window(3, 8, "other", (99, 99), false),
        ];
        assert_eq!(pick(all, &[7], &[]).map(|w| w.id), Some(2));
        assert!(pick(vec![window(3, 8, "other", (1, 1), false)], &[7], &[]).is_none());
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn picks_a_mini_programs_simulator_over_other_projects_windows() {
        // Observed: this project's liteMode simulator (always on top) titled after its project name, and another
        // project's full IDE titled after the same directory name.
        let titles = ["luhu+".to_string(), "luke-plus-miniprogram".to_string()];
        let all =
            vec![window(1, 7, "luke-plus-miniprogram", (1250, 1000), false), window(2, 7, "luhu+", (420, 904), true)];
        assert_eq!(pick(all, &[7], &titles).map(|w| w.id), Some(2));
        // Only the directory name to go by: the always-on-top liteMode window before a larger one.
        let titles = ["shop".to_string()];
        let all = vec![window(1, 7, "shop", (1250, 1000), false), window(2, 7, "shop", (420, 904), true)];
        assert_eq!(pick(all, &[7], &titles).map(|w| w.id), Some(2));
        assert!(pick(vec![window(1, 7, "项目列表", (711, 700), false)], &[7], &titles).is_none());
    }
}
