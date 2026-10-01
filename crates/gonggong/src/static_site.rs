//! A workspace directory served as a static site on loopback (built-in `preview_static`), inside the daemon process
//! so it works the same when the desktop app hosts the daemon. The files browser's raw bytes (through the preview
//! tunnel) are served by the same code.
use crate::t;
use futures_util::stream;
use http_body_util::combinators::BoxBody;
use http_body_util::{BodyExt, Empty, Full, StreamBody};
use hyper::body::{Bytes, Frame};
use hyper::header::{HeaderValue, IF_NONE_MATCH, IF_RANGE, RANGE};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;

pub type Body = BoxBody<Bytes, std::io::Error>;

const CHUNK: usize = 64 * 1024;

/// Serves `root` (canonical) until the task is aborted.
pub async fn serve(listener: TcpListener, root: PathBuf) {
    let root = Arc::new(root);
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let root = root.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req| {
                let root = root.clone();
                async move { Ok::<_, Infallible>(answer(&root, &req, true).await) }
            });
            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
        });
    }
}

/// GET / HEAD of the file the URL path names under `root` (a directory means its index.html when `index`), with
/// ETag revalidation and one byte range (206 / 416) so media can seek. Never writes.
pub async fn answer<B>(root: &Path, req: &Request<B>, index: bool) -> Response<Body> {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return text(StatusCode::METHOD_NOT_ALLOWED, t!("只读").into());
    }
    let path = match locate(root, req.uri().path(), index) {
        Ok(path) => path,
        Err(e) => return text(StatusCode::NOT_FOUND, e),
    };
    let (Ok(mut file), Ok(meta)) = (tokio::fs::File::open(&path).await, tokio::fs::metadata(&path).await) else {
        return text(StatusCode::NOT_FOUND, t!("文件不存在").into());
    };
    let len = meta.len();
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis());
    let etag = format!("\"{len:x}-{mtime:x}\"");
    let header = |name| req.headers().get(name).and_then(|v: &HeaderValue| v.to_str().ok());
    let mut res = Response::builder()
        .header("content-type", mime(&path))
        .header("cache-control", "no-cache")
        .header("accept-ranges", "bytes")
        .header("etag", &etag);
    if header(IF_NONE_MATCH).is_some_and(|v| v.split(',').any(|t| t.trim() == etag || t.trim() == "*")) {
        return res.status(StatusCode::NOT_MODIFIED).body(empty()).unwrap();
    }
    let wanted = header(RANGE).filter(|_| header(IF_RANGE).is_none_or(|v| v == etag));
    let (start, end) = match wanted.and_then(|spec| byte_range(spec, len)) {
        None => (0, len),
        Some(Ok((first, last))) => {
            res =
                res.status(StatusCode::PARTIAL_CONTENT).header("content-range", format!("bytes {first}-{last}/{len}"));
            (first, last + 1)
        }
        Some(Err(())) => {
            return res
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("content-range", format!("bytes */{len}"))
                .body(empty())
                .unwrap();
        }
    };
    res = res.header("content-length", end - start);
    if req.method() == Method::HEAD {
        return res.body(empty()).unwrap();
    }
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return text(StatusCode::INTERNAL_SERVER_ERROR, t!("读取文件失败").into());
    }
    res.body(file_body(file.take(end - start))).unwrap()
}

/// A percent-encoded URL path under `root`, through the workspace path check.
fn locate(root: &Path, url_path: &str, index: bool) -> Result<PathBuf, String> {
    let decoded = percent_decode(url_path).ok_or(t!("路径无效"))?;
    let (_, mut path) = crate::explorer::resolve(root, decoded.trim_start_matches('/'))?;
    if path.is_dir() && index {
        path = path.join("index.html");
    }
    if path.is_file() { Ok(path) } else { Err(t!("文件不存在").into()) }
}

/// One `bytes=` range as (first, last) inclusive; None = serve the whole file (absent, malformed or several
/// ranges), Err = unsatisfiable (416).
fn byte_range(spec: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let (first, last) = spec.trim().strip_prefix("bytes=")?.split_once('-')?;
    if spec.contains(',') {
        return None;
    }
    let (first, last) = (first.trim(), last.trim());
    if first.is_empty() {
        let n: u64 = last.parse().ok()?;
        return Some(if n == 0 || len == 0 { Err(()) } else { Ok((len.saturating_sub(n), len - 1)) });
    }
    let first: u64 = first.parse().ok()?;
    let last = if last.is_empty() { u64::MAX } else { last.parse().ok()? };
    if last < first {
        return None;
    }
    Some(if first >= len { Err(()) } else { Ok((first, last.min(len - 1))) })
}

fn file_body(reader: tokio::io::Take<tokio::fs::File>) -> Body {
    let chunks = stream::unfold(Some(reader), |reader| async move {
        let mut reader = reader?;
        let mut buf = vec![0u8; CHUNK];
        match reader.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok(Frame::data(Bytes::from(buf))), Some(reader)))
            }
            Err(e) => Some((Err(e), None)),
        }
    });
    BodyExt::boxed(StreamBody::new(chunks))
}

fn empty() -> Body {
    Empty::new().map_err(|never| match never {}).boxed()
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "txt" | "md" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn text(status: StatusCode, body: String) -> Response<Body> {
    let mut res = Response::new(Full::new(Bytes::from(body)).map_err(|never| match never {}).boxed());
    *res.status_mut() = status;
    res.headers_mut().insert("content-type", HeaderValue::from_static("text/plain; charset=utf-8"));
    res.headers_mut().insert("cache-control", HeaderValue::from_static("no-cache"));
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    async fn get(
        root: &Path,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
    ) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let mut req = Request::builder().method(method).uri(path);
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let res = answer(root, &req.body(()).unwrap(), false).await;
        let status = res.status().as_u16();
        let head = res.headers().iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap().to_string())).collect();
        (status, head, res.into_body().collect().await.unwrap().to_bytes().to_vec())
    }

    fn h<'a>(head: &'a [(String, String)], name: &str) -> Option<&'a str> {
        head.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    #[tokio::test]
    async fn serves_byte_ranges_for_seeking() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("media")).unwrap();
        fs::write(root.join("media/clip one.mp4"), b"0123456789").unwrap();
        let url = "/media/clip%20one.mp4";

        let (status, head, body) = get(&root, "GET", url, &[]).await;
        assert_eq!((status, body.as_slice()), (200, &b"0123456789"[..]));
        assert_eq!(h(&head, "content-type"), Some("video/mp4"));
        assert_eq!(h(&head, "accept-ranges"), Some("bytes"));
        assert_eq!(h(&head, "content-length"), Some("10"));

        let (status, head, body) = get(&root, "GET", url, &[("range", "bytes=2-5")]).await;
        assert_eq!((status, body.as_slice()), (206, &b"2345"[..]));
        assert_eq!(h(&head, "content-range"), Some("bytes 2-5/10"));
        assert_eq!(h(&head, "content-length"), Some("4"));
        assert_eq!(get(&root, "GET", url, &[("range", "bytes=7-")]).await.2, b"789");
        assert_eq!(get(&root, "GET", url, &[("range", "bytes=-3")]).await.2, b"789");
        let (status, head, body) = get(&root, "GET", url, &[("range", "bytes=8-100")]).await;
        assert_eq!((status, h(&head, "content-range"), body.as_slice()), (206, Some("bytes 8-9/10"), &b"89"[..]));

        let (status, head, _) = get(&root, "GET", url, &[("range", "bytes=10-")]).await;
        assert_eq!((status, h(&head, "content-range")), (416, Some("bytes */10")));
        assert_eq!(get(&root, "GET", url, &[("range", "bytes=-0")]).await.0, 416);
        assert_eq!(get(&root, "GET", url, &[("range", "bytes=0-1,4-5")]).await.0, 200, "multi-range → whole file");
        assert_eq!(get(&root, "GET", url, &[("range", "items=0-1")]).await.0, 200);

        let (status, head, body) = get(&root, "HEAD", url, &[("range", "bytes=0-1")]).await;
        assert_eq!((status, h(&head, "content-length"), body.len()), (206, Some("2"), 0));
    }

    #[tokio::test]
    async fn revalidates_with_etags_and_stays_read_only_inside_the_root() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(root.join("dir")).unwrap();
        fs::write(root.join("a.pdf"), b"%PDF").unwrap();
        fs::write(outer.path().join("secret.txt"), b"s").unwrap();

        let (_, head, _) = get(&root, "GET", "/a.pdf", &[]).await;
        let etag = h(&head, "etag").unwrap().to_string();
        assert_eq!(get(&root, "GET", "/a.pdf", &[("if-none-match", &etag)]).await.0, 304);
        assert_eq!(get(&root, "GET", "/a.pdf", &[("range", "bytes=0-0"), ("if-range", &etag)]).await.0, 206);
        assert_eq!(get(&root, "GET", "/a.pdf", &[("range", "bytes=0-0"), ("if-range", "\"old\"")]).await.0, 200);

        assert_eq!(get(&root, "PUT", "/a.pdf", &[]).await.0, 405);
        assert_eq!(get(&root, "GET", "/dir", &[]).await.0, 404, "no directory listing or index here");
        for bad in ["/../secret.txt", "/%2e%2e/secret.txt", "/nope.pdf", "/.git/config"] {
            assert_eq!(get(&root, "GET", bad, &[]).await.0, 404, "{bad}");
        }
    }
}
