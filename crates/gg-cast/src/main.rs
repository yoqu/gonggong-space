//! B0 spike (plan 结果预览): publish one app window (found by pid) to a LiveKit room and apply remote clicks.
//!
//! gg-cast --pid <pid> [--title <substring>] [--capture xcap|native] [--fps 30] [--codec vp8|h264|vp9]
//! env LIVEKIT_URL (ws://127.0.0.1:7880), LIVEKIT_API_KEY (devkey), LIVEKIT_API_SECRET (secret), LIVEKIT_ROOM (b0)
use anyhow::{Context, bail};
use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use livekit::options::{TrackPublishOptions, VideoCodec, VideoEncoding};
use livekit::prelude::*;
use livekit::track::{LocalTrack, LocalVideoTrack, TrackSource};
use livekit::webrtc::desktop_capturer::{
    CaptureError, DesktopCaptureSourceType, DesktopCapturer, DesktopCapturerOptions, DesktopFrame,
};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::prelude::{I420Buffer, RtcVideoSource, VideoBuffer, VideoFrame, VideoResolution, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit_api::access_token::{AccessToken, VideoGrants};
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Args {
    pid: u32,
    title: Option<String>,
    capture: String,
    fps: u32,
    codec: VideoCodec,
}

fn args() -> anyhow::Result<Args> {
    let mut a = Args { pid: 0, title: None, capture: "native".into(), fps: 30, codec: VideoCodec::VP8 };
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let v = it.next().context("missing value")?;
        match k.as_str() {
            "--pid" => a.pid = v.parse()?,
            "--title" => a.title = Some(v),
            "--capture" => a.capture = v,
            "--fps" => a.fps = v.parse()?,
            "--codec" => {
                a.codec = match v.as_str() {
                    "h264" => VideoCodec::H264,
                    "vp9" => VideoCodec::VP9,
                    _ => VideoCodec::VP8,
                }
            }
            _ => bail!("unknown {k}"),
        }
    }
    if a.pid == 0 {
        bail!("--pid required");
    }
    Ok(a)
}

fn env(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.into())
}

fn token(identity: &str, publish: bool) -> anyhow::Result<String> {
    let t = AccessToken::with_api_key(&env("LIVEKIT_API_KEY", "devkey"), &env("LIVEKIT_API_SECRET", "secret"))
        .with_identity(identity)
        .with_grants(VideoGrants {
            room_join: true,
            room: env("LIVEKIT_ROOM", "b0"),
            can_publish: Some(publish),
            can_subscribe: Some(true),
            can_publish_data: Some(true),
            ..Default::default()
        })
        .to_jwt()?;
    Ok(t)
}

/// The largest visible window of `pid` (apps often own helper windows), optionally narrowed by title.
fn find_window(pid: u32, title: Option<&str>) -> anyhow::Result<xcap::Window> {
    let mut hits: Vec<_> = xcap::Window::all()?
        .into_iter()
        .filter(|w| w.pid().ok() == Some(pid) && !w.is_minimized().unwrap_or(true))
        .filter(|w| title.is_none_or(|t| w.title().is_ok_and(|n| n.contains(t))))
        .collect();
    hits.sort_by_key(|w| std::cmp::Reverse(w.width().unwrap_or(0) * w.height().unwrap_or(0)));
    hits.into_iter().next().with_context(|| format!("进程 {pid} 没有可见窗口"))
}

#[derive(Default)]
struct Stats {
    frames: AtomicU64,
    capture_us: AtomicU64,
    convert_us: AtomicU64,
}

type Slot = Arc<Mutex<Option<(NativeVideoSource, VideoFrame<I420Buffer>)>>>;

/// RGBA (xcap) or BGRA (native capturer, libyuv "ARGB") → I420 → the track.
fn push(slot: &Slot, stats: &Stats, data: &[u8], stride: u32, w: u32, h: u32, rgba: bool) {
    let mut guard = slot.lock().unwrap();
    let Some((source, frame)) = guard.as_mut() else { return };
    let t = Instant::now();
    if frame.buffer.width() != w || frame.buffer.height() != h {
        frame.buffer = I420Buffer::new(w, h);
    }
    let (sy, su, sv) = frame.buffer.strides();
    let (y, u, v) = frame.buffer.data_mut();
    let convert = if rgba { yuv_helper::abgr_to_i420 } else { yuv_helper::argb_to_i420 };
    convert(data, stride, y, sy, u, su, v, sv, w as i32, h as i32);
    stats.convert_us.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
    source.capture_frame(frame);
    stats.frames.fetch_add(1, Ordering::Relaxed);
}

fn capture_xcap(window: xcap::Window, fps: u32, slot: Slot, stats: Arc<Stats>) {
    std::thread::spawn(move || {
        let period = Duration::from_secs_f64(1.0 / fps as f64);
        loop {
            let t = Instant::now();
            match window.capture_image() {
                Ok(img) => {
                    stats.capture_us.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
                    let (w, h) = img.dimensions();
                    push(&slot, &stats, img.as_raw(), w * 4, w, h, true);
                }
                Err(e) => eprintln!("capture: {e}"),
            }
            std::thread::sleep(period.saturating_sub(t.elapsed()));
        }
    });
}

fn capture_native(window_id: u32, fps: u32, slot: Slot, stats: Arc<Stats>) -> anyhow::Result<()> {
    let (tx, rx) = std::sync::mpsc::channel::<anyhow::Result<()>>();
    std::thread::spawn(move || {
        let mut options = DesktopCapturerOptions::new(DesktopCaptureSourceType::Window);
        #[cfg(target_os = "macos")]
        options.set_sck_system_picker(false);
        options.set_include_cursor(true);
        let Some(mut capturer) = DesktopCapturer::new(options) else {
            let _ = tx.send(Err(anyhow::anyhow!("无法创建 native 采集器")));
            return;
        };
        let sources = capturer.get_source_list();
        let ids: Vec<_> = sources.iter().map(|s| (s.id(), s.title())).collect();
        let Some(source) = sources.into_iter().find(|s| s.id() == window_id as u64) else {
            let _ = tx.send(Err(anyhow::anyhow!("native 采集器里没有窗口 {window_id}，可选：{ids:?}")));
            return;
        };
        let _ = tx.send(Ok(()));
        let cb_stats = stats.clone();
        capturer.start_capture(Some(source), move |r: Result<DesktopFrame, CaptureError>| {
            let Ok(f) = r else { return };
            push(&slot, &cb_stats, f.data(), f.stride(), f.width() as u32, f.height() as u32, false);
        });
        let period = Duration::from_secs_f64(1.0 / fps as f64);
        loop {
            let t = Instant::now();
            capturer.capture_frame();
            stats.capture_us.fetch_add(t.elapsed().as_micros() as u64, Ordering::Relaxed);
            std::thread::sleep(period.saturating_sub(t.elapsed()));
        }
    });
    rx.recv()?
}

/// Viewer input: coordinates relative to the video (0..1).
#[derive(Deserialize, Debug)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Input {
    Click { x: f64, y: f64 },
}

/// macOS only delivers a click to an app in front: the first one merely activates it.
fn activate(pid: u32) {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"System Events\" to set frontmost of (first process whose unix id is {pid}) to true"
        );
        let _ = std::process::Command::new("osascript").args(["-e", &script]).status();
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let a = args()?;
    let window = find_window(a.pid, a.title.as_deref())?;
    let (wx, wy, ww, wh) = (window.x()?, window.y()?, window.width()?, window.height()?);
    println!("window id={} title={:?} at {wx},{wy} {ww}x{wh}", window.id()?, window.title()?);
    let url = env("LIVEKIT_URL", "ws://127.0.0.1:7880");
    println!("viewer token: {}", token("viewer", false)?);

    let started = Instant::now();
    let (room, mut events) = Room::connect(&url, &token("gg-cast", true)?, RoomOptions::default()).await?;
    println!("connected in {:?}", started.elapsed());

    let source = NativeVideoSource::new(VideoResolution { width: ww, height: wh }, true);
    let frame = VideoFrame {
        rotation: VideoRotation::VideoRotation0,
        timestamp_us: 0,
        frame_metadata: None,
        buffer: I420Buffer::new(ww, wh),
    };
    let slot: Slot = Arc::new(Mutex::new(Some((source.clone(), frame))));
    let track = LocalVideoTrack::create_video_track("window", RtcVideoSource::Native(source));
    let options = TrackPublishOptions {
        source: TrackSource::Screenshare,
        video_codec: a.codec,
        video_encoding: Some(VideoEncoding { max_bitrate: 3_000_000, max_framerate: a.fps as f64 }),
        simulcast: false,
        ..Default::default()
    };
    room.local_participant().publish_track(LocalTrack::Video(track), options).await?;

    let stats = Arc::new(Stats::default());
    match a.capture.as_str() {
        "xcap" => capture_xcap(window, a.fps, slot, stats.clone()),
        _ => capture_native(window.id()?, a.fps, slot, stats.clone())?,
    }

    let mut enigo = Enigo::new(&Settings::default())?;
    let mut tick = tokio::time::interval(Duration::from_secs(5));
    let mut last = 0u64;
    loop {
        tokio::select! {
            _ = tick.tick() => {
                let n = stats.frames.load(Ordering::Relaxed);
                let d = (n - last).max(1);
                println!(
                    "fps {:.1} · capture {:.1} ms · convert {:.1} ms",
                    (n - last) as f64 / 5.0,
                    stats.capture_us.swap(0, Ordering::Relaxed) as f64 / d as f64 / 1000.0,
                    stats.convert_us.swap(0, Ordering::Relaxed) as f64 / d as f64 / 1000.0,
                );
                last = n;
            }
            Some(ev) = events.recv() => {
                if let RoomEvent::DataReceived { payload, .. } = ev {
                    match serde_json::from_slice::<Input>(&payload) {
                        Ok(Input::Click { x, y }) => {
                            // xcap reports points on macOS; enigo takes the same space (checked in B0).
                            let (px, py) = (wx + (x * ww as f64) as i32, wy + (y * wh as f64) as i32);
                            let t = Instant::now();
                            // Always-on-top windows (the mini program simulator) take clicks without activation.
                            if std::env::var_os("GG_NO_ACTIVATE").is_none() {
                                activate(a.pid);
                            }
                            let activated = t.elapsed();
                            enigo.move_mouse(px, py, Coordinate::Abs)?;
                            // B0: clicked right after the move, macOS still reports the old cursor position.
                            tokio::time::sleep(Duration::from_millis(20)).await;
                            enigo.button(Button::Left, Direction::Click)?;
                            println!("click at {px},{py} in {:?} (activate {activated:?})", t.elapsed());
                        }
                        Err(e) => eprintln!("input: {e}"),
                    }
                }
            }
        }
    }
}
