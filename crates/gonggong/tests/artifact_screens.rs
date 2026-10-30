#![cfg(unix)]
//! Screenshots of artifact versions (G01, P1-01): after a turn the daemon shoots every screen of gg-artifact.json in
//! its device's window, the entry screen also as the card's thumbnail; on artifact.snapshot it fetches a version made
//! elsewhere into a temporary folder and does the same. The browser comes from a process-wide env var: its own binary.
use gonggong::artifacts::Artifacts;
use gonggong::config::Config;
use gonggong::protocol::DaemonArtifactRef;
use gonggong::sync::hash_bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::convert::Infallible;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::net::TcpListener;

/// A fake browser shared by the tests: its "PNG" names the window, the path and what the page served.
fn fake_browser() {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    let dir = DIR.get_or_init(|| tempfile::tempdir().unwrap().keep());
    let fake = dir.join("chrome");
    if !fake.exists() {
        std::fs::write(
            &fake,
            "#!/bin/sh\nfor a; do case $a in --window-size=*) size=${a#--window-size=};; esac; last=$a; done\n\
             body=$(curl -s --noproxy '*' \"$last\")\n\
             printf 'PNG %s %s %s' \"$size\" \"${last#http://localhost:*/}\" \"$body\" > screenshot.png\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    unsafe { std::env::set_var("GONGGONG_BROWSER", &fake) };
}

type Puts = Arc<Mutex<Vec<(String, String)>>>;
/// Version id → its files (path, content).
type Versions = HashMap<String, Vec<(String, String)>>;

async fn handle(
    puts: Puts,
    versions: Arc<Versions>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let (method, path) = (req.method().clone(), req.uri().path().to_string());
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let ok = |b: String| Ok(Response::new(Full::new(Bytes::from(b))));
    if method == "GET" {
        if let Some(vid) = path.strip_prefix("/api/daemon/artifacts/a1/versions/") {
            let files: Vec<_> = versions[vid]
                .iter()
                .map(|(p, c)| serde_json::json!({ "path": p, "hash": hash_bytes(c.as_bytes()), "size": c.len() }))
                .collect();
            return ok(serde_json::json!({ "versionId": vid, "files": files }).to_string());
        }
        if let Some(hash) = path.strip_prefix("/api/daemon/artifacts/a1/blobs/") {
            let content = versions.values().flatten().find(|(_, c)| hash_bytes(c.as_bytes()) == hash);
            return ok(content.unwrap().1.clone());
        }
        panic!("unexpected GET {path}");
    }
    puts.lock().unwrap().push((path, String::from_utf8_lossy(&body).into_owned()));
    Ok(Response::builder().status(204).body(Full::new(Bytes::new())).unwrap())
}

async fn server(versions: Versions) -> (Config, Puts) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (puts, versions): (Puts, _) = (Arc::default(), Arc::new(versions));
    let shared = puts.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (puts, versions) = (shared.clone(), versions.clone());
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(puts.clone(), versions.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    let api = Config {
        server: format!("http://127.0.0.1:{port}"),
        token: "mt".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        tls_trust: None,
    };
    (api, puts)
}

const MANIFEST: &str = r#"{"title":"t","device":"mobile","entry":"done","screens":[
    {"id":"home","title":"首页","file":"screens/home.html"},
    {"id":"done","title":"完成","file":"screens/done.html"}]}"#;

#[tokio::test]
async fn after_a_turn_uploads_the_entry_screen_as_thumbnail_then_one_png_per_screen() {
    fake_browser();
    let (api, puts) = server(Versions::new()).await;
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let dir = cwd.path().join("design/app");
    std::fs::create_dir_all(dir.join("screens")).unwrap();
    std::fs::write(dir.join("gg-artifact.json"), MANIFEST).unwrap();
    std::fs::write(dir.join("screens/home.html"), "<p>首页").unwrap();
    std::fs::write(dir.join("screens/done.html"), "<p>完成").unwrap();
    let r = DaemonArtifactRef { id: "a1".into(), dir: "design/app".into(), head_version_id: None, digest: None };

    let artifacts = Artifacts::new(&api, home.path()).unwrap();
    assert_eq!(artifacts.thumbnail("r1", cwd.path(), &r, "v2", None).await, Ok(true));
    let base = "/api/daemon/runs/r1/artifacts/a1/versions/v2";
    let done = "PNG 390,844 screens/done.html <p>完成".to_string();
    assert_eq!(
        *puts.lock().unwrap(),
        vec![
            (format!("{base}/thumbnail"), done.clone()),
            (format!("{base}/screens/done/thumbnail"), done),
            (format!("{base}/screens/home/thumbnail"), "PNG 390,844 screens/home.html <p>首页".into()),
        ]
    );
}

#[tokio::test]
async fn a_snapshot_fetches_the_version_into_a_temporary_folder_and_shoots_it_there() {
    fake_browser();
    let files = |home: &str| {
        vec![
            ("gg-artifact.json".to_string(), MANIFEST.to_string()),
            ("screens/home.html".into(), home.to_string()),
            ("screens/done.html".into(), "<p>完成".into()),
        ]
    };
    let mut versions = Versions::from([("v3".into(), files("<p>改过的首页"))]);
    versions.insert("v4".into(), vec![("../escape.html".into(), "x".into())]);
    let (api, puts) = server(versions).await;
    let home = tempfile::tempdir().unwrap();
    let artifacts = Artifacts::new(&api, home.path()).unwrap();

    assert_eq!(artifacts.snapshot("a1", "v3", None).await, Ok(true));
    let base = "/api/daemon/artifacts/a1/versions/v3";
    assert_eq!(
        *puts.lock().unwrap(),
        vec![
            (format!("{base}/thumbnail"), "PNG 390,844 screens/done.html <p>完成".into()),
            (format!("{base}/screens/done/thumbnail"), "PNG 390,844 screens/done.html <p>完成".into()),
            (format!("{base}/screens/home/thumbnail"), "PNG 390,844 screens/home.html <p>改过的首页".into()),
        ]
    );

    puts.lock().unwrap().clear();
    assert!(artifacts.snapshot("a1", "v4", None).await.is_err());
    assert!(artifacts.snapshot("../a1", "v3", None).await.is_err());
    assert!(puts.lock().unwrap().is_empty());
}
