//! Daemon updates from GitHub Releases when the server publishes none, against a local stand-in for the GitHub API.
use gonggong::upgrade::{CheckError, GithubSource, Upgrader, platform};
use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

const BUILD: &[u8] = b"new-build";

struct Fake {
    /// Status of `/repos/<repo>/releases/latest`.
    status: StatusCode,
    tag: &'static str,
    /// Platforms the release manifest has builds for.
    platforms: Vec<String>,
    requests: Vec<String>,
    user_agent: Option<String>,
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

async fn handle(
    base: String,
    fake: Arc<Mutex<Fake>>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let mut f = fake.lock().unwrap();
    f.requests.push(req.uri().path().to_string());
    let (status, body) = match req.uri().path() {
        "/repos/team/app/releases/latest" => {
            f.user_agent = req.headers().get("user-agent").map(|v| v.to_str().unwrap().to_string());
            let body = serde_json::json!({
                "tag_name": f.tag,
                "assets": [
                    { "name": "SHA256SUMS", "browser_download_url": format!("{base}/dl/SHA256SUMS") },
                    { "name": "manifest.json", "browser_download_url": format!("{base}/dl/manifest.json") },
                ],
            });
            (f.status, body.to_string().into())
        }
        "/dl/manifest.json" => {
            let builds: serde_json::Map<_, _> = f
                .platforms
                .iter()
                .map(|p| (p.clone(), serde_json::json!({ "url": format!("{base}/dl/gg"), "sha256": sha(BUILD) })))
                .collect();
            let version = f.tag.trim_start_matches('v');
            (StatusCode::OK, serde_json::json!({ "version": version, "builds": builds }).to_string().into())
        }
        "/dl/gg" => (StatusCode::OK, Bytes::from_static(BUILD)),
        _ => (StatusCode::NOT_FOUND, Bytes::new()),
    };
    let mut res = Response::new(Full::new(body));
    *res.status_mut() = status;
    Ok(res)
}

async fn serve(tag: &'static str, status: StatusCode) -> (String, Arc<Mutex<Fake>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let fake =
        Arc::new(Mutex::new(Fake { status, tag, platforms: vec![platform()], requests: vec![], user_agent: None }));
    let (state, url) = (fake.clone(), base.clone());
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (state, url) = (state.clone(), url.clone());
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(url.clone(), state.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    (base, fake)
}

fn upgrader(home: &std::path::Path) -> Upgrader {
    Upgrader::new(home.into(), "http://127.0.0.1:1".into(), reqwest::Client::new(), "/nonexistent".into(), vec![])
}

#[tokio::test]
async fn finds_the_build_for_this_platform_in_a_newer_release() {
    let (base, fake) = serve("v9.0.0", StatusCode::OK).await;
    let source = GithubSource::new(&base, "team/app").unwrap();
    let info = source.latest("0.2.0").await.unwrap().unwrap();
    assert_eq!((info.version.as_str(), info.sha256.as_str()), ("9.0.0", sha(BUILD).as_str()));
    assert_eq!(info.url, format!("{base}/dl/gg"));
    let f = fake.lock().unwrap();
    assert!(f.user_agent.as_deref().is_some_and(|ua| ua.starts_with("gonggong/")), "{:?}", f.user_agent);
}

#[tokio::test]
async fn nothing_when_not_newer_or_no_build_for_this_platform() {
    let (base, fake) = serve("v0.2.0", StatusCode::OK).await;
    let source = GithubSource::new(&base, "team/app").unwrap();
    assert_eq!(source.latest("0.2.0").await.unwrap(), None);
    assert_eq!(fake.lock().unwrap().requests, ["/repos/team/app/releases/latest"], "manifest not fetched");

    let (base, fake) = serve("v9.0.0", StatusCode::OK).await;
    fake.lock().unwrap().platforms = vec!["plan9-mips".into()];
    let source = GithubSource::new(&base, "team/app").unwrap();
    assert_eq!(source.latest("0.2.0").await.unwrap(), None);
}

#[tokio::test]
async fn rate_limits_and_missing_releases() {
    for status in [StatusCode::FORBIDDEN, StatusCode::TOO_MANY_REQUESTS] {
        let (base, _) = serve("v9.0.0", status).await;
        let err = GithubSource::new(&base, "team/app").unwrap().latest("0.2.0").await.unwrap_err();
        assert!(matches!(err, CheckError::RateLimited), "{status}: {err}");
    }
    let (base, _) = serve("v9.0.0", StatusCode::NOT_FOUND).await;
    assert_eq!(GithubSource::new(&base, "team/app").unwrap().latest("0.2.0").await.unwrap(), None);
    let err = GithubSource::new("http://127.0.0.1:1", "team/app").unwrap().latest("0.2.0").await.unwrap_err();
    assert!(matches!(err, CheckError::Other(_)));
}

#[tokio::test]
async fn checks_github_only_when_the_server_publishes_no_build() {
    let (base, fake) = serve("v9.0.0", StatusCode::OK).await;
    let home = tempfile::tempdir().unwrap();
    let up = upgrader(home.path());
    tokio::spawn(up.clone().watch_github(GithubSource::new(&base, "team/app").unwrap()));
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(fake.lock().unwrap().requests.is_empty(), "waits for the server's welcome");

    up.server_release(true);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(fake.lock().unwrap().requests.is_empty(), "the server's release takes precedence");

    let home = tempfile::tempdir().unwrap();
    let up = upgrader(home.path());
    up.server_release(false);
    tokio::spawn(up.clone().watch_github(GithubSource::new(&base, "team/app").unwrap()));
    tokio::time::timeout(Duration::from_secs(5), async {
        while up.staged().is_none() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(std::fs::read(up.staged().unwrap()).unwrap(), BUILD);
}

#[test]
fn configured_from_the_environment() {
    // SAFETY: the only test in this binary that touches the environment.
    unsafe {
        std::env::set_var("GONGGONG_UPDATE", "off");
    }
    assert!(GithubSource::from_env().is_none());
    unsafe {
        std::env::remove_var("GONGGONG_UPDATE");
        std::env::set_var("GONGGONG_UPDATE_REPO", "someone/fork");
    }
    assert_eq!(GithubSource::from_env().unwrap().repo(), "someone/fork");
    unsafe { std::env::remove_var("GONGGONG_UPDATE_REPO") };
    assert_eq!(GithubSource::from_env().unwrap().repo(), "yoqu/gonggong-space");
}
