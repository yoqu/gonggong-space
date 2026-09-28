//! A workspace directory served as a static site on loopback (built-in `preview_static`), inside the daemon process
//! so it works the same when the desktop app hosts the daemon.
use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

/// Serves `root` (canonical) until the task is aborted.
pub async fn serve(listener: TcpListener, root: PathBuf) {
    let root = Arc::new(root);
    loop {
        let Ok((stream, _)) = listener.accept().await else { continue };
        let root = root.clone();
        tokio::spawn(async move {
            let service = hyper::service::service_fn(move |req| file(root.clone(), req));
            let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
        });
    }
}

async fn file(root: Arc<PathBuf>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return Ok(reply(StatusCode::METHOD_NOT_ALLOWED, "text/plain; charset=utf-8", "只读".into()));
    }
    let Some(path) = resolve(&root, req.uri().path()) else {
        return Ok(reply(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", "404".into()));
    };
    Ok(match tokio::fs::read(&path).await {
        Ok(bytes) => reply(StatusCode::OK, mime(&path), bytes.into()),
        Err(_) => reply(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", "404".into()),
    })
}

/// The file a URL path names under `root` (a directory means its index.html); None outside `root` or missing.
fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let decoded = percent_decode(url_path)?;
    let mut path = root.join(decoded.trim_start_matches('/')).canonicalize().ok()?;
    if path.is_dir() {
        path = path.join("index.html").canonicalize().ok()?;
    }
    (path.starts_with(root) && path.is_file()).then_some(path)
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

fn mime(path: &Path) -> &'static str {
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
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "woff2" => "font/woff2",
        "txt" | "md" => "text/plain; charset=utf-8",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn reply(status: StatusCode, kind: &'static str, body: Bytes) -> Response<Full<Bytes>> {
    let mut res = Response::new(Full::new(body));
    *res.status_mut() = status;
    res.headers_mut().insert("content-type", kind.parse().unwrap());
    res.headers_mut().insert("cache-control", "no-cache".parse().unwrap());
    res
}
