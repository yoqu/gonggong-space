#![cfg(unix)]
//! After a turn the daemon screenshots the shell as the version's thumbnail, then every screen of gg-artifact.json in
//! its device's window (G01). The browser comes from a process-wide env var: one test in its own binary.
use gonggong::artifacts::Artifacts;
use gonggong::config::Config;
use gonggong::protocol::DaemonArtifactRef;
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

type Puts = Arc<Mutex<Vec<(String, String)>>>;

async fn record(puts: Puts, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path().to_string();
    let body = req.into_body().collect().await.unwrap().to_bytes();
    puts.lock().unwrap().push((path, String::from_utf8_lossy(&body).into_owned()));
    Ok(Response::builder().status(204).body(Full::new(Bytes::new())).unwrap())
}

#[tokio::test]
async fn uploads_the_shell_thumbnail_then_one_png_per_screen_in_its_device_window() {
    let tmp = tempfile::tempdir().unwrap();
    let fake = tmp.path().join("chrome");
    std::fs::write(
        &fake,
        "#!/bin/sh\nfor a; do case $a in --window-size=*) size=${a#--window-size=};; esac; last=$a; done\n\
         printf 'PNG %s %s' \"$size\" \"${last#http://localhost:*/}\" > screenshot.png\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    unsafe { std::env::set_var("GONGGONG_BROWSER", &fake) };

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let puts: Puts = Arc::default();
    let shared = puts.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let puts = shared.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| record(puts.clone(), req));
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
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let dir = cwd.path().join("design/app");
    std::fs::create_dir_all(dir.join("screens")).unwrap();
    std::fs::write(
        dir.join("gg-artifact.json"),
        r#"{"title":"t","device":"mobile","entry":"home","screens":[
            {"id":"home","title":"首页","file":"screens/home.html"},
            {"id":"done","title":"完成","file":"screens/done.html"}]}"#,
    )
    .unwrap();
    std::fs::write(dir.join("screens/home.html"), "<p>首页").unwrap();
    std::fs::write(dir.join("screens/done.html"), "<p>完成").unwrap();
    let r = DaemonArtifactRef { id: "a1".into(), dir: "design/app".into(), head_version_id: None, digest: None };

    let artifacts = Artifacts::new(&api, home.path()).unwrap();
    assert_eq!(artifacts.thumbnail("r1", cwd.path(), &r, "v2", None).await, Ok(true));
    let base = "/api/daemon/runs/r1/artifacts/a1/versions/v2";
    assert_eq!(
        *puts.lock().unwrap(),
        vec![
            (format!("{base}/thumbnail"), "PNG 1280,800 ".into()),
            (format!("{base}/screens/home/thumbnail"), "PNG 390,844 screens/home.html".into()),
            (format!("{base}/screens/done/thumbnail"), "PNG 390,844 screens/done.html".into()),
        ]
    );
}
