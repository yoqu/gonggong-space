//! Inline HTML pages for the built-in `html_preview` and `html_render` tools, after t3code's HtmlRender: page checks,
//! local images inlined as data URIs, and a headless Chrome (over CDP) that screenshots a page and measures its
//! height. Errors are agent-facing, so they are not translated.

use base64::Engine;
use futures_util::{SinkExt, StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::{Semaphore, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

/// `HTML_RENDER_MEASURE_WIDTHS` in `packages/protocol/src/html-render.ts`.
pub const MEASURE_WIDTHS: [u32; 9] = [320, 375, 430, 520, 640, 720, 860, 1000, 1144];
/// `HTML_RENDER_COLUMN_WIDTH` in `packages/protocol/src/html-render.ts`.
pub const COLUMN_WIDTH: u32 = 720;
const MIN_WIDTH: u32 = 240;
const MAX_WIDTH: u32 = 1600;

const MIB: usize = 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 10 * MIB;
const MAX_PAGE_BYTES: usize = 25 * MIB;

const MAX_CONSOLE_MESSAGES: usize = 20;
const MAX_CONSOLE_CHARS: usize = 500;
const VIEWPORT_HEIGHT: u32 = 800;
const MAX_CAPTURE_HEIGHT: u32 = 4000;
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(20);
const MEASURE_TIMEOUT: Duration = Duration::from_secs(6);
const MEASURE_CONCURRENCY: usize = 3;
const MAX_BROWSERS: usize = 2;
const STDERR_TAIL: usize = 2048;
// Chrome blocks file access, so images arrive inlined; a .localhost origin is a secure context that may load http.
const PAGE_ORIGIN: &str = "http://gg-page.localhost";
const PAGE_URL: &str = "http://gg-page.localhost/page.html";
const PAGE_NAME: &str = "page.html";
const FAVICON_URL: &str = "http://gg-page.localhost/favicon.ico";

// Wait for fonts and two paint frames to capture late layout.
const SETTLE_EXPRESSION: &str = "document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))";
// scrollHeight is at least the viewport height; use the root box for shorter pages.
const MEASURE_EXPRESSION: &str = "(() => { const root = document.documentElement; return root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height; })()";

const NO_BROWSER: &str = "本机没有找到 Chrome 系浏览器（Chrome、Edge、Chromium、Brave），无法预览。可以安装一个，或用环境变量 GONGGONG_BROWSER 指定浏览器可执行文件路径；也可以跳过预览直接调用 html_render。";

static BROWSERS: Semaphore = Semaphore::const_new(MAX_BROWSERS);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    Light,
    Dark,
}

impl Appearance {
    fn name(self) -> &'static str {
        match self {
            Appearance::Light => "light",
            Appearance::Dark => "dark",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConsoleMessage {
    pub level: &'static str,
    pub text: String,
}

/// What `html_preview` returns: the PNG (base64) and what the page reported.
#[derive(Debug)]
pub struct Preview {
    pub png: String,
    pub width: u32,
    pub content_height: u32,
    pub captured_height: u32,
    pub console_messages: Vec<ConsoleMessage>,
    pub missing_images: Vec<String>,
}

/// The page as `html_render` publishes it: checked, with its local images inlined (all must exist).
pub async fn prepare(html: String) -> Result<String, String> {
    reject_viewport_height(&html)?;
    let (html, missing) = inline(html).await?;
    if !missing.is_empty() {
        return Err(format!(
            "These local images could not be read: {}. Use absolute paths to existing image files, or remove them.",
            missing.join(", ")
        ));
    }
    Ok(html)
}

/// A screenshot of the page at `width` in one appearance, with the theme sheet a published page gets.
pub async fn preview(html: String, width: Option<i64>, appearance: Appearance) -> Result<Preview, String> {
    let width = width.map_or(COLUMN_WIDTH, |w| w.clamp(MIN_WIDTH.into(), MAX_WIDTH.into()) as u32);
    reject_viewport_height(&html)?;
    let bin = crate::snapshot::browser().ok_or(NO_BROWSER)?;
    let (html, missing_images) = inline(inject_preview_style(&html, appearance)).await?;
    let _permit = BROWSERS.acquire().await.map_err(|e| e.to_string())?;
    let shot = tokio::time::timeout(CAPTURE_TIMEOUT, capture(&bin, &html, width, appearance))
        .await
        .map_err(|_| browser_error(&format!("the page did not finish loading within {}s", CAPTURE_TIMEOUT.as_secs())))?
        .map_err(|e| browser_error(&e))?;
    Ok(Preview {
        png: shot.png,
        width,
        content_height: shot.content_height,
        captured_height: shot.captured_height,
        console_messages: shot.console_messages,
        missing_images,
    })
}

/// The prepared page's height at each of `MEASURE_WIDTHS`, so its frame opens at the right height; None (logged)
/// without a browser or when measuring fails: the page is published without them.
pub async fn heights(html: &str) -> Option<Vec<(u32, u32)>> {
    let bin = crate::snapshot::browser()?;
    let html = inject_preview_style(html, Appearance::Light);
    let _permit = BROWSERS.acquire().await.ok()?;
    match tokio::time::timeout(MEASURE_TIMEOUT, measure(&bin, &html)).await {
        Ok(Ok(heights)) => Some(heights),
        Ok(Err(e)) => {
            tracing::warn!("could not measure an HTML render, publishing it without heights: {e}");
            None
        }
        Err(_) => {
            tracing::warn!(
                "measuring an HTML render took longer than {}s, publishing it without heights",
                MEASURE_TIMEOUT.as_secs()
            );
            None
        }
    }
}

fn browser_error(reason: &str) -> String {
    format!("Headless Chrome could not render the page: {reason}.")
}

async fn inline(html: String) -> Result<(String, Vec<String>), String> {
    tokio::task::spawn_blocking(move || inline_local_images(&html)).await.map_err(|e| e.to_string())?
}

// ── Viewport height ────────────────────────────────────────────────────────────────────────────────────────────

// Only stylesheets and style attributes, even inside scripts; comments are skipped whole. Unclosed comments, tags or
// quotes run to the end.
static CSS_SOURCE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r#"(?i)<!--[\s\S]*?(?:-->|$)|<style\b[^>]*(?:>|$)([\s\S]*?)(?:</style\s*>|$)|\sstyle\s*=\s*(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s>]+))"#,
    )
    .unwrap()
});
static VIEWPORT_HEIGHT_UNIT: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(?i)(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[sld]?vh").unwrap());

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// A frame that grows to fit its page loops on a size that follows the viewport.
pub fn reject_viewport_height(html: &str) -> Result<(), String> {
    for caps in CSS_SOURCE.captures_iter(html) {
        let Some(css) = (1..=4).find_map(|i| caps.get(i)).map(|m| m.as_str()) else { continue };
        let b = css.as_bytes();
        // The neighbour checks stand in for t3code's lookarounds: they skip base64 runs (an inlined image that
        // happens to contain "1vh") and longer identifiers.
        let found = VIEWPORT_HEIGHT_UNIT.find_iter(css).find(|m| {
            let before = m.start().checked_sub(1).map(|i| b[i]);
            let after = b.get(m.end()).copied();
            !before.is_some_and(|c| is_word(c) || matches!(c, b'.' | b'+' | b'/'))
                && !after.is_some_and(|c| is_word(c) || c == b'-')
        });
        if let Some(found) = found {
            return Err(format!(
                "The page uses a viewport height unit ({}). The frame grows to fit the page, so a size that follows the viewport makes it grow again and again. Let content set the height, or use fixed pixel heights.",
                found.as_str()
            ));
        }
    }
    Ok(())
}

// ── Local images ───────────────────────────────────────────────────────────────────────────────────────────────

const IMAGE_TYPES: [(&str, &str); 9] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("avif", "image/avif"),
    ("svg", "image/svg+xml"),
    ("bmp", "image/bmp"),
    ("ico", "image/x-icon"),
];
const MAX_PATH_CHARS: usize = 2048;

fn image_mime(path: &str) -> Option<&'static str> {
    let (_, ext) = path.rsplit_once('.')?;
    IMAGE_TYPES.iter().find(|(e, _)| e.eq_ignore_ascii_case(ext)).map(|(_, mime)| *mime)
}

/// Bytes of an absolute path's root at `at`: `/` (not `//`) or a drive like `C:\`.
fn absolute_prefix(b: &[u8], at: usize) -> Option<usize> {
    match b.get(at..) {
        Some([b'/', next, ..]) if *next != b'/' => Some(1),
        Some([b'/']) => Some(1),
        Some([drive, b':', b'\\' | b'/', ..]) if drive.is_ascii_alphabetic() => Some(3),
        _ => None,
    }
}

/// A path run of at most `MAX_PATH_CHARS` characters after its root, ending in an image extension.
fn is_image_reference(path: &str, prefix: usize) -> bool {
    let Some((stem, ext)) = path.rsplit_once('.') else { return false };
    stem.len() >= prefix
        && IMAGE_TYPES.iter().any(|(e, _)| e.eq_ignore_ascii_case(ext))
        && stem[prefix..].chars().count() <= MAX_PATH_CHARS
}

fn is_css_space(b: u8) -> bool {
    b.is_ascii_whitespace() || b == 0x0b
}

/// Byte spans of absolute image paths in quotes (`"`, `'`, `` ` ``) or `url(…)`, like t3code's LOCAL_IMAGE_PATTERN.
fn find_local_images(html: &str) -> Vec<(usize, usize)> {
    let b = html.as_bytes();
    let mut spans = vec![];
    let mut i = 0;
    while i < b.len() {
        if matches!(b[i], b'"' | b'\'' | b'`')
            && let Some(prefix) = absolute_prefix(b, i + 1)
        {
            let (quote, start) = (b[i], i + 1);
            let end = (start + prefix..b.len()).find(|&j| matches!(b[j], b'\r' | b'\n') || b[j] == quote);
            if let Some(end) = end.filter(|&j| b[j] == quote)
                && is_image_reference(&html[start..end], prefix)
            {
                spans.push((start, end));
                i = end + 1;
                continue;
            }
        }
        if b.len() - i >= 4 && b[i..i + 4].eq_ignore_ascii_case(b"url(") {
            let mut start = i + 4;
            while start < b.len() && is_css_space(b[start]) {
                start += 1;
            }
            if let Some(prefix) = absolute_prefix(b, start) {
                let end = (start + prefix..b.len())
                    .find(|&j| is_css_space(b[j]) || matches!(b[j], b'"' | b'\'' | b'`' | b'(' | b')'))
                    .unwrap_or(b.len());
                let mut close = end;
                while close < b.len() && is_css_space(b[close]) {
                    close += 1;
                }
                if b.get(close) == Some(&b')') && is_image_reference(&html[start..end], prefix) {
                    spans.push((start, end));
                    i = close + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    spans
}

// Inside a JS string literal a Windows path's backslashes are escaped.
fn file_path_for(reference: &str) -> PathBuf {
    let drive = reference.as_bytes().get(..2).is_some_and(|d| d[0].is_ascii_alphabetic() && d[1] == b':');
    PathBuf::from(if drive { reference.replace("\\\\", "\\") } else { reference.to_string() })
}

fn mib(bytes: usize) -> String {
    format!("{:.1} MiB", bytes as f64 / MIB as f64)
}

fn base64_len(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

fn page_too_large(bytes: usize) -> String {
    format!(
        "With its images inlined the page is {}; the limit is {}. Use smaller images.",
        mib(bytes),
        mib(MAX_PAGE_BYTES)
    )
}

fn image_too_large(path: &str, bytes: usize) -> String {
    format!("{path} is {}; each local image must be at most {}.", mib(bytes), mib(MAX_IMAGE_BYTES))
}

/// `html` with its local images as data URIs, and the referenced paths that are not readable images. The bytes are
/// checked, not the names, so a renamed file or a symlink cannot inline a secret.
pub fn inline_local_images(html: &str) -> Result<(String, Vec<String>), String> {
    let references = find_local_images(html);
    let mut paths: Vec<&str> = vec![];
    for &(start, end) in &references {
        if !paths.contains(&&html[start..end]) {
            paths.push(&html[start..end]);
        }
    }
    let sizes: HashMap<&str, usize> = paths
        .iter()
        .filter_map(|p| {
            let meta = std::fs::metadata(file_path_for(p)).ok().filter(|m| m.is_file())?;
            Some((*p, usize::try_from(meta.len()).unwrap_or(usize::MAX)))
        })
        .collect();
    if let Some((path, size)) =
        paths.iter().find_map(|p| sizes.get(p).filter(|s| **s > MAX_IMAGE_BYTES).map(|s| (p, *s)))
    {
        return Err(image_too_large(path, size));
    }
    let estimate = references.iter().fold(html.len(), |total, &(start, end)| {
        let path = &html[start..end];
        sizes.get(path).map_or(total, |size| total + data_uri_prefix(path).len() + base64_len(*size) - path.len())
    });
    if estimate > MAX_PAGE_BYTES {
        return Err(page_too_large(estimate));
    }
    // Files can grow after the stat: each read is bounded.
    let mut data_uris: HashMap<&str, String> = HashMap::new();
    let mut read_bytes = 0;
    for path in paths.iter().filter(|p| sizes.contains_key(**p)) {
        let mut bytes = vec![];
        let read = std::fs::File::open(file_path_for(path))
            .and_then(|f| f.take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes));
        if read.is_err() || !is_image_bytes(&bytes) {
            continue;
        }
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(image_too_large(path, bytes.len()));
        }
        read_bytes += base64_len(bytes.len());
        if read_bytes > MAX_PAGE_BYTES {
            return Err(page_too_large(read_bytes));
        }
        let uri = data_uri_prefix(path) + &base64::engine::general_purpose::STANDARD.encode(&bytes);
        data_uris.insert(path, uri);
    }
    let mut out = String::with_capacity(html.len());
    let mut cursor = 0;
    for &(start, end) in &references {
        if let Some(uri) = data_uris.get(&html[start..end]) {
            out.push_str(&html[cursor..start]);
            out.push_str(uri);
            cursor = end;
        }
    }
    out.push_str(&html[cursor..]);
    if out.len() > MAX_PAGE_BYTES {
        return Err(page_too_large(out.len()));
    }
    let missing = paths.iter().filter(|p| !data_uris.contains_key(**p)).map(|p| p.to_string()).collect();
    Ok((out, missing))
}

fn data_uri_prefix(path: &str) -> String {
    format!("data:{};base64,", image_mime(path).unwrap_or("application/octet-stream"))
}

fn is_image_bytes(b: &[u8]) -> bool {
    let at = |range: std::ops::Range<usize>| b.get(range).unwrap_or_default();
    b.starts_with(b"\x89PNG")
        || b.starts_with(b"\xff\xd8\xff")
        || b.starts_with(b"GIF8")
        || b.starts_with(b"\0\0\x01\0")
        || (b.starts_with(b"BM") && at(6..10) == b"\0\0\0\0")
        || (b.starts_with(b"RIFF") && at(8..12) == b"WEBP")
        || matches!(at(4..12), b"ftypavif" | b"ftypavis" | b"ftypmif1")
        || has_svg_root(&b[..b.len().min(4096)])
}

fn after(text: &[u8], token: &[u8], from: usize) -> Option<usize> {
    text.get(from..)?.windows(token.len()).position(|w| w == token).map(|at| from + at + token.len())
}

/// Whether the first element, past an XML declaration, comments and a doctype, is `<svg`.
fn has_svg_root(text: &[u8]) -> bool {
    let text = text.strip_prefix(b"\xef\xbb\xbf").unwrap_or(text);
    let mut at = Some(0);
    while let Some(mut i) = at {
        while i < text.len() && is_css_space(text[i]) {
            i += 1;
        }
        let rest = &text[i..];
        at = if rest.starts_with(b"<?") {
            after(text, b"?>", i + 2)
        } else if rest.starts_with(b"<!--") {
            after(text, b"-->", i + 4)
        } else if rest.len() >= 9 && rest[..9].eq_ignore_ascii_case(b"<!doctype") {
            after_doctype(text, i + 9)
        } else {
            // XML names are case-sensitive, and only these characters can end one here.
            return rest.starts_with(b"<svg")
                && matches!(rest.get(4), Some(b' ' | b'\t' | b'\r' | b'\n' | b'/' | b'>'));
        };
    }
    false
}

fn after_doctype(text: &[u8], from: usize) -> Option<usize> {
    let (mut subset, mut at) = (false, from);
    while at < text.len() {
        let rest = &text[at..];
        match text[at] {
            q @ (b'"' | b'\'') => at = after(text, &[q], at + 1)?,
            _ if subset && rest.starts_with(b"<!--") => at = after(text, b"-->", at + 4)?,
            _ if subset && rest.starts_with(b"<?") => at = after(text, b"?>", at + 2)?,
            b'>' if !subset => return Some(at + 1),
            c => {
                if c == b'[' {
                    subset = true;
                } else if c == b']' {
                    subset = false;
                }
                at += 1;
            }
        }
    }
    None
}

// ── Theme sheet ────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PreviewStyles {
    light: String,
    dark: String,
}

/// The theme sheet per appearance, generated from `packages/protocol/src/html-render.ts`.
static PREVIEW_STYLES: LazyLock<PreviewStyles> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../packages/protocol/html-render-preview.json")).expect("preview styles")
});

const RAW_TEXT: [&str; 9] =
    ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"];

/// `html` with comments and raw-text elements blanked, offsets kept, so a `<head>` inside them is not taken.
fn blank_non_markup(html: &str) -> Vec<u8> {
    let mut b = html.as_bytes().to_vec();
    let lower = html.to_ascii_lowercase();
    let l = lower.as_bytes();
    let mut i = 0;
    while let Some(at) = l[i..].iter().position(|c| *c == b'<').map(|p| i + p) {
        let rest = &l[at..];
        let end = if rest.starts_with(b"<!--") {
            after(l, b"-->", at + 4).unwrap_or(l.len())
        } else if rest.starts_with(b"<plaintext") && !rest.get(10).is_some_and(|c| is_word(*c)) {
            l.len()
        } else if let Some(name) = RAW_TEXT.iter().find(|n| {
            rest.get(1..=n.len()) == Some(n.as_bytes()) && !rest.get(n.len() + 1).is_some_and(|c| is_word(*c))
        }) {
            let close = format!("</{name}");
            let mut from = at + 1 + name.len();
            loop {
                let Some(found) = after(l, close.as_bytes(), from) else { break l.len() };
                let mut k = found;
                while k < l.len() && is_css_space(l[k]) {
                    k += 1;
                }
                if l.get(k) == Some(&b'>') {
                    break k + 1;
                }
                from = found;
            }
        } else {
            i = at + 1;
            continue;
        };
        b[at..end].fill(b' ');
        i = end;
        if i >= l.len() {
            break;
        }
    }
    b
}

static HEAD: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r"(?i)<head(?:\s[^>]*)?>").unwrap());
static ROOT: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r"(?i)<html(?:\s[^>]*)?>").unwrap());
static DOCTYPE: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"(?i)^\s*<!doctype[^>]*>").unwrap());
static CHARSET: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r"(?i)<meta\s[^>]*charset").unwrap());
static VIEWPORT: LazyLock<regex::bytes::Regex> =
    LazyLock::new(|| regex::bytes::Regex::new(r#"(?i)<meta\s[^>]*name\s*=\s*["']?viewport"#).unwrap());

/// `html` with the theme sheet at the start of its head (made when missing), as the daemon previews and measures a
/// page; the server injects the published page's own bootstrap.
pub fn inject_preview_style(html: &str, appearance: Appearance) -> String {
    let scan = blank_non_markup(html);
    let style = match appearance {
        Appearance::Light => &PREVIEW_STYLES.light,
        Appearance::Dark => &PREVIEW_STYLES.dark,
    };
    let mut markup = String::new();
    if !CHARSET.is_match(&scan[..scan.len().min(4096)]) {
        markup.push_str(r#"<meta charset="utf-8">"#);
    }
    if !VIEWPORT.is_match(&scan) {
        markup.push_str(r#"<meta name="viewport" content="width=device-width, initial-scale=1">"#);
    }
    markup.push_str(style);
    if let Some(head) = HEAD.find(&scan) {
        return format!("{}{markup}{}", &html[..head.end()], &html[head.end()..]);
    }
    let at = ROOT.find(&scan).map(|m| m.end()).or_else(|| DOCTYPE.find(html).map(|m| m.end()));
    match at {
        Some(at) => format!("{}<head>{markup}</head>{}", &html[..at], &html[at..]),
        None => format!("<!doctype html><head>{markup}</head>{html}"),
    }
}

// ── Headless Chrome over CDP ───────────────────────────────────────────────────────────────────────────────────

struct Shot {
    png: String,
    content_height: u32,
    captured_height: u32,
    console_messages: Vec<ConsoleMessage>,
}

#[derive(Default)]
struct PageState {
    main_frame: String,
    body: Option<Arc<str>>,
    loaded: Option<oneshot::Sender<()>>,
    console: Vec<ConsoleMessage>,
    omitted: usize,
}

type Reply = Result<Value, String>;

struct Conn {
    out: mpsc::UnboundedSender<String>,
    next: AtomicU64,
    closed: AtomicBool,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    pages: Mutex<HashMap<String, PageState>>,
}

const GONE: &str = "the browser exited unexpectedly";

impl Conn {
    async fn send(&self, method: &str, params: Value, session: Option<&str>) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if self.closed.load(Ordering::SeqCst) {
            return Err(GONE.into());
        }
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(session) = session {
            msg["sessionId"] = session.into();
        }
        self.out.send(msg.to_string()).map_err(|_| GONE.to_string())?;
        rx.await.map_err(|_| GONE.to_string())?.map_err(|e| format!("{method} failed: {e}"))
    }

    fn post(&self, method: &str, params: Value, session: &str) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let _ =
            self.out.send(json!({ "id": id, "method": method, "params": params, "sessionId": session }).to_string());
    }

    fn receive(&self, raw: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(raw) else { return };
        if let Some(id) = msg["id"].as_u64() {
            if let Some(reply) = self.pending.lock().unwrap().remove(&id) {
                let result = match msg["error"]["message"].as_str() {
                    Some(e) => Err(e.to_string()),
                    None => Ok(msg["result"].clone()),
                };
                let _ = reply.send(result);
            }
            return;
        }
        let (Some(session), Some(method)) = (msg["sessionId"].as_str(), msg["method"].as_str()) else { return };
        let params = &msg["params"];
        let mut pages = self.pages.lock().unwrap();
        let Some(page) = pages.get_mut(session) else { return };
        match method {
            "Page.loadEventFired" => {
                if let Some(loaded) = page.loaded.take() {
                    let _ = loaded.send(());
                }
            }
            "Fetch.requestPaused" => {
                let request_id = params["requestId"].as_str().unwrap_or_default();
                let url = params["request"]["url"].as_str().unwrap_or_default();
                let url = url.split('#').next().unwrap_or_default();
                if url == PAGE_URL
                    && let Some(body) = &page.body
                {
                    // Built by hand: the body is up to 34 MB of base64, not worth a JSON tree.
                    let id = self.next.fetch_add(1, Ordering::Relaxed);
                    let _ = self.out.send(format!(
                        r#"{{"id":{id},"sessionId":{},"method":"Fetch.fulfillRequest","params":{{"requestId":{},"responseCode":200,"responseHeaders":[{{"name":"Content-Type","value":"text/html; charset=utf-8"}}],"body":"{body}"}}}}"#,
                        Value::from(session),
                        Value::from(request_id),
                    ));
                    return;
                }
                // Subframes may show other sites; the main frame stays on the page.
                let other_site_frame = params["resourceType"] == "Document"
                    && params["frameId"].as_str() != Some(page.main_frame.as_str())
                    && !url.starts_with(&format!("{PAGE_ORIGIN}/"));
                if other_site_frame {
                    self.post("Fetch.continueRequest", json!({ "requestId": request_id }), session);
                } else {
                    self.post(
                        "Fetch.failRequest",
                        json!({ "requestId": request_id, "errorReason": "AccessDenied" }),
                        session,
                    );
                }
            }
            _ => {
                let Some(message) = console_message(method, params) else { return };
                if page.console.len() >= MAX_CONSOLE_MESSAGES {
                    page.omitted += 1;
                    return;
                }
                let text = message.text.replace(PAGE_URL, PAGE_NAME);
                let text = match text.char_indices().nth(MAX_CONSOLE_CHARS) {
                    Some((cut, _)) => format!("{}…", &text[..cut]),
                    None => text,
                };
                page.console.push(ConsoleMessage { level: message.level, text });
            }
        }
    }

    fn disconnect(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.pending.lock().unwrap().clear();
        for page in self.pages.lock().unwrap().values_mut() {
            page.loaded = None;
        }
    }
}

fn remote_object_text(value: &Value) -> String {
    if let Some(text) = value["value"].as_str().or(value["description"].as_str()) {
        return text.to_string();
    }
    match value.get("value") {
        Some(v) => v.to_string(),
        None => value["type"].as_str().unwrap_or_default().to_string(),
    }
}

fn console_message(method: &str, params: &Value) -> Option<ConsoleMessage> {
    match method {
        "Runtime.consoleAPICalled" => {
            let level = match params["type"].as_str()? {
                "log" | "debug" | "dir" | "dirxml" | "table" | "trace" => "log",
                "info" => "info",
                "warning" => "warning",
                "error" | "assert" => "error",
                _ => return None,
            };
            let args = params["args"].as_array()?;
            Some(ConsoleMessage { level, text: args.iter().map(remote_object_text).collect::<Vec<_>>().join(" ") })
        }
        "Runtime.exceptionThrown" => {
            let details = &params["exceptionDetails"];
            let text = details["exception"]["description"].as_str().or(details["text"].as_str())?;
            Some(ConsoleMessage { level: "error", text: text.to_string() })
        }
        "Log.entryAdded" => {
            let entry = &params["entry"];
            let level = match entry["level"].as_str()? {
                "error" => "error",
                "warning" => "warning",
                _ => return None,
            };
            let text = entry["text"].as_str()?;
            // Chrome asks every page for one; it is not the page's fault.
            if entry["url"].as_str() == Some(FAVICON_URL) {
                return None;
            }
            let text = match entry["url"].as_str() {
                Some(url) => format!("{text} {url}"),
                None => text.to_string(),
            };
            Some(ConsoleMessage { level, text })
        }
        _ => None,
    }
}

/// A headless Chrome with its own profile directory; `close` (or drop) ends it and removes the directory.
struct Browser {
    child: Option<tokio::process::Child>,
    stderr: Arc<Mutex<String>>,
    dir: PathBuf,
    conn: Arc<Conn>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

async fn launch(bin: &Path) -> Result<Browser, String> {
    let dir = std::env::temp_dir().join(format!("gg-html-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("a temporary directory could not be created: {e}"))?;
    let mut cmd = crate::proc::async_command(bin);
    cmd.args([
        "--headless=new",
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--block-new-web-contents",
    ]);
    // Chrome refuses to run as root with its sandbox on.
    #[cfg(target_os = "linux")]
    if unsafe { libc::geteuid() } == 0 {
        cmd.arg("--no-sandbox");
    }
    cmd.arg(format!("--user-data-dir={}", dir.display()))
        .arg("about:blank")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(format!("the browser could not be started: {e}"));
        }
    };
    let (out, mut outgoing) = mpsc::unbounded_channel::<String>();
    let conn = Arc::new(Conn {
        out,
        next: AtomicU64::new(1),
        closed: AtomicBool::new(false),
        pending: Mutex::default(),
        pages: Mutex::default(),
    });
    // Its last output says why a browser that would not start quit.
    let stderr = Arc::new(Mutex::new(String::new()));
    let mut tasks = vec![];
    if let Some(mut pipe) = child.stderr.take() {
        let tail = stderr.clone();
        tasks.push(tokio::spawn(async move {
            let mut chunk = [0; 4096];
            while let Ok(n @ 1..) = tokio::io::AsyncReadExt::read(&mut pipe, &mut chunk).await {
                let mut tail = tail.lock().unwrap();
                tail.push_str(&String::from_utf8_lossy(&chunk[..n]));
                if tail.len() > STDERR_TAIL {
                    let cut = tail.ceil_char_boundary(tail.len() - STDERR_TAIL);
                    tail.drain(..cut);
                }
            }
        }));
    }
    let mut browser = Browser { child: Some(child), dir, conn: conn.clone(), stderr, tasks };
    let url = browser.devtools_url().await?;
    let config = WebSocketConfig::default().max_message_size(Some(256 * MIB)).max_frame_size(Some(256 * MIB));
    let (ws, _) = tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), true)
        .await
        .map_err(|e| format!("could not connect to the browser: {e}"))?;
    let (mut sink, mut source) = ws.split();
    browser.tasks.push(tokio::spawn(async move {
        while let Some(text) = outgoing.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    }));
    browser.tasks.push(tokio::spawn(async move {
        while let Some(Ok(msg)) = source.next().await {
            if let Message::Text(text) = msg {
                conn.receive(&text);
            }
        }
        conn.disconnect();
    }));
    Ok(browser)
}

impl Browser {
    /// Chrome writes its port and browser target path to `DevToolsActivePort` once it listens.
    async fn devtools_url(&mut self) -> Result<String, String> {
        let file = self.dir.join("DevToolsActivePort");
        loop {
            if let Ok(text) = tokio::fs::read_to_string(&file).await
                && let Some((port, path)) = text.split_once('\n')
                && path.trim().starts_with("/devtools/")
            {
                return Ok(format!("ws://127.0.0.1:{}{}", port.trim(), path.trim()));
            }
            if let Some(status) = self.child.as_mut().and_then(|c| c.try_wait().ok().flatten()) {
                // Let the pipe drain.
                tokio::time::sleep(Duration::from_millis(100)).await;
                let output = self.stderr.lock().unwrap().trim().to_string();
                let output = if output.is_empty() { output } else { format!(": {output}") };
                return Err(format!("{GONE} ({status}){output}"));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    async fn open_page(&self, width: u32, appearance: Appearance) -> Result<Page<'_>, String> {
        let conn = &*self.conn;
        let target = conn.send("Target.createTarget", json!({ "url": "about:blank" }), None).await?;
        let target = target["targetId"].as_str().ok_or("Target.createTarget returned no target")?.to_string();
        let attached = conn.send("Target.attachToTarget", json!({ "targetId": target, "flatten": true }), None).await?;
        let session = attached["sessionId"].as_str().ok_or("Target.attachToTarget returned no session")?.to_string();
        // A page target's id is its main frame's id.
        conn.pages
            .lock()
            .unwrap()
            .insert(session.clone(), PageState { main_frame: target.clone(), ..Default::default() });
        let page = Page { conn, session, target, width };
        let s = Some(page.session.as_str());
        conn.send("Page.enable", json!({}), s).await?;
        conn.send("Runtime.enable", json!({}), s).await?;
        conn.send("Log.enable", json!({}), s).await?;
        let media = json!({ "features": [{ "name": "prefers-color-scheme", "value": appearance.name() }] });
        conn.send("Emulation.setEmulatedMedia", media, s).await?;
        // The page and every document navigation are intercepted, which keeps the main frame on the page.
        let patterns = json!({ "patterns": [{ "urlPattern": format!("{PAGE_ORIGIN}/*") }, { "urlPattern": "*", "resourceType": "Document" }] });
        conn.send("Fetch.enable", patterns, s).await?;
        let metrics = json!({ "width": width, "height": VIEWPORT_HEIGHT, "deviceScaleFactor": 1, "mobile": false });
        conn.send("Emulation.setDeviceMetricsOverride", metrics, s).await?;
        Ok(page)
    }

    async fn close(mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(1), self.conn.send("Browser.close", json!({}), None)).await;
        if let Some(mut child) = self.child.take()
            && tokio::time::timeout(Duration::from_secs(2), child.wait()).await.is_err()
        {
            let _ = child.kill().await;
        }
        remove_profile(&self.dir).await;
    }
}

// Helpers may still be writing the profile just after the browser exits.
async fn remove_profile(dir: &Path) {
    if tokio::fs::remove_dir_all(dir).await.is_err() {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _ = tokio::fs::remove_dir_all(dir).await;
    }
}

impl Drop for Browser {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
        let Some(mut child) = self.child.take() else { return };
        let _ = child.start_kill();
        let dir = std::mem::take(&mut self.dir);
        match tokio::runtime::Handle::try_current() {
            Ok(runtime) => {
                runtime.spawn(async move {
                    let _ = child.wait().await;
                    remove_profile(&dir).await;
                });
            }
            Err(_) => {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    }
}

struct Page<'a> {
    conn: &'a Conn,
    session: String,
    target: String,
    width: u32,
}

impl Page<'_> {
    /// Loads `body` (the page's base64) and returns its content height.
    async fn load(&self, body: &Arc<str>) -> Result<u32, String> {
        let (tx, rx) = oneshot::channel();
        if let Some(page) = self.conn.pages.lock().unwrap().get_mut(&self.session) {
            page.body = Some(body.clone());
            page.loaded = Some(tx);
        }
        let s = Some(self.session.as_str());
        let navigation = self.conn.send("Page.navigate", json!({ "url": PAGE_URL }), s).await?;
        if navigation["errorText"].as_str().is_some_and(|e| !e.is_empty()) {
            return Err("the page could not be opened".into());
        }
        rx.await.map_err(|_| GONE.to_string())?;
        let settle = json!({ "expression": SETTLE_EXPRESSION, "awaitPromise": true });
        self.conn.send("Runtime.evaluate", settle, s).await?;
        let measure = json!({ "expression": MEASURE_EXPRESSION, "returnByValue": true });
        let measured = self.conn.send("Runtime.evaluate", measure, s).await?;
        let height = measured["result"]["value"].as_f64().ok_or("Runtime.evaluate returned an unexpected result")?;
        Ok(height.max(0.0).ceil() as u32)
    }

    async fn screenshot(&self, height: u32) -> Result<String, String> {
        let clip = json!({ "x": 0, "y": 0, "width": self.width, "height": height, "scale": 1 });
        let params = json!({ "format": "png", "captureBeyondViewport": true, "clip": clip });
        let shot = self.conn.send("Page.captureScreenshot", params, Some(&self.session)).await?;
        shot["data"].as_str().map(String::from).ok_or_else(|| "Page.captureScreenshot returned no image".into())
    }

    fn console_messages(&self) -> Vec<ConsoleMessage> {
        let pages = self.conn.pages.lock().unwrap();
        let Some(page) = pages.get(&self.session) else { return vec![] };
        let mut messages = page.console.clone();
        if page.omitted > 0 {
            messages.push(ConsoleMessage {
                level: "warning",
                text: format!("{} more console messages were omitted.", page.omitted),
            });
        }
        messages
    }

    async fn close(self) {
        let _ = self.conn.send("Target.closeTarget", json!({ "targetId": self.target }), None).await;
        self.conn.pages.lock().unwrap().remove(&self.session);
    }
}

fn page_body(html: &str) -> Arc<str> {
    base64::engine::general_purpose::STANDARD.encode(html).into()
}

async fn capture(bin: &Path, html: &str, width: u32, appearance: Appearance) -> Result<Shot, String> {
    let body = page_body(html);
    let browser = launch(bin).await?;
    let shot = async {
        let page = browser.open_page(width, appearance).await?;
        let content_height = page.load(&body).await?;
        let captured_height = content_height.clamp(1, MAX_CAPTURE_HEIGHT);
        let png = page.screenshot(captured_height).await?;
        Ok(Shot { png, content_height, captured_height, console_messages: page.console_messages() })
    }
    .await;
    browser.close().await;
    shot
}

/// A fresh load per width: pages may lay out only at load.
async fn measure(bin: &Path, html: &str) -> Result<Vec<(u32, u32)>, String> {
    let body = page_body(html);
    let browser = launch(bin).await?;
    let heights = stream::iter(MEASURE_WIDTHS)
        .map(|width| {
            let (browser, body) = (&browser, &body);
            async move {
                let page = browser.open_page(width, Appearance::Light).await?;
                let height = page.load(body).await;
                page.close().await;
                height.map(|h| (width, h))
            }
        })
        .buffer_unordered(MEASURE_CONCURRENCY)
        .try_collect::<Vec<_>>()
        .await;
    browser.close().await;
    let mut heights = heights?;
    heights.sort_unstable();
    Ok(heights)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn rejects_viewport_heights_in_stylesheets_and_style_attributes() {
        let rejected = [
            ("<style>.a{height:100vh}</style>", "100vh"),
            (r#"<div style="min-height: 50dvh">x</div>"#, "50dvh"),
            ("<div style='height:calc(.5svh + 2px)'>", ".5svh"),
            ("<div style=height:12.5lvh>", "12.5lvh"),
            (r#"<script>el.innerHTML = '<p style="height:10VH">'</script>"#, "10VH"),
            ("<STYLE media=screen>.a{height:3vh", "3vh"),
        ];
        for (html, found) in rejected {
            let err = reject_viewport_height(html).unwrap_err();
            assert!(err.contains(&format!("({found})")) && err.contains("fixed pixel heights"), "{html}: {err}");
        }
        let allowed = [
            "<style>.a{background:url(data:image/png;base64,AAA1vhBB+1vh/2vh.3vh)}</style>",
            "<!-- <style>.a{height:100vh}</style> --><style>.a{height:10px}</style>",
            "<style>.a{width:10vw;--x:1vh-ish;animation:a1vh 1s}</style>",
            "<script>const h = '100vh'</script><p>100vh</p>",
            r#"<div data-style="height:100vh">"#,
        ];
        for html in allowed {
            assert_eq!(reject_viewport_height(html), Ok(()), "{html}");
        }
    }

    #[test]
    fn inlines_local_images_by_their_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let file = |name: &str, bytes: &[u8]| {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path.to_string_lossy().to_string()
        };
        let png = file("chart.png", PNG);
        let svg = file(
            "logo.SVG",
            b"\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- c --><!DOCTYPE svg [<!ENTITY a \">\">]><svg xmlns=\"x\"/>",
        );
        let secret = file("key.png", b"SECRET=1");
        let missing = dir.path().join("gone.png").to_string_lossy().to_string();
        let html = format!(
            r#"<img src="{png}"><i style="background:url( {svg} )"></i><img src='{secret}'><img src=`{missing}`><img src="//cdn.example.com/a.png"><img src="{png}">"#
        );

        let (out, missing_paths) = inline_local_images(&html).unwrap();
        let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
        assert_eq!(out.matches(&format!("data:image/png;base64,{}", b64(PNG))).count(), 2);
        assert!(out.contains("url( data:image/svg+xml;base64,"), "{out}");
        assert!(out.contains(&format!("'{secret}'")) && !out.contains(&b64(b"SECRET=1")));
        assert!(out.contains("//cdn.example.com/a.png"));
        assert_eq!(missing_paths, vec![secret, missing]);

        let big = file("big.png", &[PNG, &vec![0; MAX_IMAGE_BYTES]].concat());
        let err = inline_local_images(&format!(r#"<img src="{big}">"#)).unwrap_err();
        assert!(err.contains("each local image must be at most 10.0 MiB"), "{err}");
        assert_eq!(inline_local_images("<p>no images</p>").unwrap(), ("<p>no images</p>".into(), vec![]));
    }

    #[test]
    fn finds_windows_paths_and_skips_unterminated_references() {
        let html = r#"a "C:\\img\\a.png" url(D:/b.jpeg) "/x.png
" url(/c.gif x) "/d.txt""#;
        let spans: Vec<&str> = find_local_images(html).into_iter().map(|(s, e)| &html[s..e]).collect();
        assert_eq!(spans, vec![r"C:\\img\\a.png", "D:/b.jpeg"]);
        assert_eq!(file_path_for(r"C:\\img\\a.png"), PathBuf::from(r"C:\img\a.png"));
    }

    #[test]
    fn injects_the_theme_sheet_at_the_start_of_the_head() {
        let style = &PREVIEW_STYLES.dark;
        assert!(style.starts_with(r#"<style id="gg-theme">"#) && style.contains("color-scheme:dark"));
        let metas = r#"<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">"#;
        let cases = [
            (
                "<!-- <head> --><script>'<head>'</script><HEAD lang=x><title>t</title></HEAD>",
                format!("<!-- <head> --><script>'<head>'</script><HEAD lang=x>{metas}{style}<title>t</title></HEAD>"),
            ),
            (
                r#"<html lang="zh"><body>x</body></html>"#,
                format!(r#"<html lang="zh"><head>{metas}{style}</head><body>x</body></html>"#),
            ),
            ("<!DOCTYPE html><p>x</p>", format!("<!DOCTYPE html><head>{metas}{style}</head><p>x</p>")),
            ("<p>x</p>", format!("<!doctype html><head>{metas}{style}</head><p>x</p>")),
            (
                r#"<head><meta charset=utf-8><meta name='viewport' content='width=400'></head>"#,
                format!(r#"<head>{style}<meta charset=utf-8><meta name='viewport' content='width=400'></head>"#),
            ),
        ];
        for (html, expected) in cases {
            assert_eq!(inject_preview_style(html, Appearance::Dark), expected, "{html}");
        }
        assert!(inject_preview_style("<p>", Appearance::Light).contains("color-scheme:light"));
    }

    #[test]
    fn reads_console_messages_from_cdp_events() {
        let call = json!({ "type": "warning", "args": [{ "type": "string", "value": "a" }, { "type": "number", "value": 2, "description": "2" }, { "type": "undefined" }] });
        assert_eq!(
            console_message("Runtime.consoleAPICalled", &call),
            Some(ConsoleMessage { level: "warning", text: "a 2 undefined".into() })
        );
        let thrown = json!({ "exceptionDetails": { "text": "Uncaught", "exception": { "type": "object", "description": "Error: boom" } } });
        assert_eq!(console_message("Runtime.exceptionThrown", &thrown).unwrap().text, "Error: boom");
        let log = json!({ "entry": { "level": "error", "text": "404", "url": "http://x/a.png" } });
        assert_eq!(console_message("Log.entryAdded", &log).unwrap().text, "404 http://x/a.png");
        assert_eq!(console_message("Log.entryAdded", &json!({ "entry": { "level": "info", "text": "x" } })), None);
        let favicon = json!({ "entry": { "level": "error", "text": "Failed to load resource", "url": FAVICON_URL } });
        assert_eq!(console_message("Log.entryAdded", &favicon), None);
    }

    fn chrome() -> bool {
        let found = crate::snapshot::browser().is_some();
        if !found {
            eprintln!("skipped: no Chrome-family browser on this machine (set GONGGONG_BROWSER)");
        }
        found
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn previews_and_measures_a_page_with_the_machine_browser() {
        if !chrome() {
            return;
        }
        let html = r#"<!doctype html><html><body><div style="height:600px;background:var(--accent)"></div>
            <script>console.error("boom"); for (let i = 0; i < 25; i++) console.log("line", i)</script></body></html>"#;
        let shot = preview(html.into(), Some(400), Appearance::Dark).await.unwrap();
        let png = base64::engine::general_purpose::STANDARD.decode(&shot.png).unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        assert_eq!((shot.width, shot.content_height, shot.captured_height), (400, 600, 600));
        assert_eq!(shot.console_messages[0], ConsoleMessage { level: "error", text: "boom".into() });
        assert_eq!(shot.console_messages.len(), MAX_CONSOLE_MESSAGES + 1, "{:?}", shot.console_messages);
        assert_eq!(shot.console_messages[20].text, "6 more console messages were omitted.");
        assert!(shot.missing_images.is_empty());

        let err = preview("<style>main{height:100vh}</style>".into(), None, Appearance::Light).await.unwrap_err();
        assert!(err.contains("(100vh)"), "{err}");

        let missing =
            preview(r#"<p>x</p><img src="/nowhere/gone.png">"#.into(), Some(10), Appearance::Light).await.unwrap();
        assert_eq!((missing.width, missing.missing_images), (MIN_WIDTH, vec!["/nowhere/gone.png".to_string()]));

        let wraps = r#"<div style="width:1000px;height:50px"></div><p style="margin:0;line-height:20px">"#.to_string()
            + &"word ".repeat(200)
            + "</p>";
        let heights = heights(&wraps).await.unwrap();
        assert_eq!(heights.iter().map(|h| h.0).collect::<Vec<_>>(), MEASURE_WIDTHS);
        assert!(heights.windows(2).all(|w| w[0].1 >= w[1].1), "{heights:?}");
        assert!(heights[0].1 > heights[8].1, "{heights:?}");
    }
}
