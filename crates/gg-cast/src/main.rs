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
use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoding};
use livekit::prelude::*;
use livekit::track::{LocalTrack, LocalVideoTrack, TrackSource};
use livekit::webrtc::desktop_capturer::{
    CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions, DesktopFrame,
};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, RtcVideoSource, VideoBuffer, VideoFrame, VideoResolution, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

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

fn require_screen_recording() -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    // SAFETY: no arguments; only reads the TCC state of this process's responsible app.
    if !unsafe { CGPreflightScreenCaptureAccess() } {
        bail!(
            "本机没有授予「屏幕录制」权限：请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许运行 gg 的程序（终端或共工桌面端）"
        );
    }
    Ok(())
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

/// BGRA (libyuv "ARGB") → I420 → the track.
fn push(slot: &Slot, f: &DesktopFrame) {
    let (w, h) = (f.width() as u32, f.height() as u32);
    let mut guard = slot.lock().unwrap();
    let (source, frame) = &mut *guard;
    if frame.buffer.width() != w || frame.buffer.height() != h {
        frame.buffer = I420Buffer::new(w, h);
    }
    let (sy, su, sv) = frame.buffer.strides();
    let (y, u, v) = frame.buffer.data_mut();
    yuv_helper::argb_to_i420(f.data(), f.stride(), y, sy, u, su, v, sv, w as i32, h as i32);
    source.capture_frame(frame);
}

/// The native capturer (macOS: ScreenCaptureKit, B0: far cheaper than screenshots) on the window found by pid, or on
/// the screen without one; sends why capturing ended.
fn capture(window_id: Option<u32>, fps: u32, slot: Slot, ended: mpsc::UnboundedSender<String>) -> anyhow::Result<()> {
    let (ready, started) = std::sync::mpsc::channel::<anyhow::Result<()>>();
    std::thread::spawn(move || {
        let kind =
            if window_id.is_some() { DesktopCaptureSourceType::Window } else { DesktopCaptureSourceType::Screen };
        let mut options = DesktopCapturerOptions::new(kind);
        #[cfg(target_os = "macos")]
        options.set_sck_system_picker(false);
        options.set_include_cursor(true);
        let Some(mut capturer) = DesktopCapturer::new(options) else {
            let _ = ready.send(Err(anyhow::anyhow!("无法创建窗口采集器")));
            return;
        };
        let sources = capturer.get_source_list();
        let Some(source) = sources.into_iter().find(|s| window_id.is_none_or(|id| s.id() == id as u64)) else {
            let _ = ready.send(Err(anyhow::anyhow!("采集器里没有要推送的画面（{window_id:?}）")));
            return;
        };
        let _ = ready.send(Ok(()));
        capturer.start_capture(Some(source), move |r: Result<DesktopFrame, CaptureError>| match r {
            Ok(f) => push(&slot, &f),
            Err(CaptureError::Permanent) => {
                let _ = ended.send("窗口已关闭".into());
            }
            Err(CaptureError::Temporary) => {}
        });
        let period = Duration::from_secs_f64(1.0 / fps as f64);
        loop {
            let t = Instant::now();
            capturer.capture_frame();
            std::thread::sleep(period.saturating_sub(t.elapsed()));
        }
    });
    started.recv()?
}

async fn run(a: Args) -> anyhow::Result<()> {
    let token = std::env::var("GG_CAST_TOKEN").context("缺少 GG_CAST_TOKEN")?;
    require_screen_recording()?;
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
    let options = TrackPublishOptions {
        source: TrackSource::Screenshare,
        video_codec: CODEC,
        video_encoding: Some(VideoEncoding { max_bitrate: MAX_BITRATE, max_framerate: a.fps as f64 }),
        simulcast: false,
        ..Default::default()
    };
    room.local_participant().publish_track(LocalTrack::Video(track), options).await.context("无法发布画面")?;

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
