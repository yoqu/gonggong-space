#![cfg(unix)]
//! Hosted sites (托管网页) against a stand-in server: preview_host opens the bot's site for the dir and uploads the
//! build over the machine routes; site.host does the same for the dir of a static preview.
use gonggong::config::Config;
use gonggong::engine::{Continuation, EngineConfig};
use gonggong::hosted::{Scope, Services};
use gonggong::protocol::{ArtifactSubmitReq, ArtifactSubmitSource, DaemonToServer, SiteHost};
use gonggong::service::Outbox;
use gonggong::sync::hash_bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::convert::Infallible;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

const TOKEN: &str = "mt_site";

#[derive(Default)]
struct Store {
    opened: Vec<Value>,
    blobs: HashMap<String, Vec<u8>>,
    submits: Vec<ArtifactSubmitReq>,
}

fn reply(status: StatusCode, v: Value) -> Response<Full<Bytes>> {
    let mut res = Response::new(Full::new(Bytes::from(v.to_string())));
    *res.status_mut() = status;
    res
}

async fn handle(store: Arc<Mutex<Store>>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let (method, path) = (req.method().to_string(), req.uri().path().to_string());
    assert_eq!(req.headers()["authorization"], format!("Bearer {TOKEN}").as_str());
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let mut s = store.lock().unwrap();
    let segs: Vec<&str> = path.trim_start_matches("/api/daemon/").split('/').collect();
    Ok(match (method.as_str(), segs.as_slice()) {
        ("POST", ["runs", "r1", "sites"]) => {
            s.opened.push(serde_json::from_slice(&body).unwrap());
            reply(StatusCode::OK, json!({ "artifactId": "s1" }))
        }
        ("POST", ["artifacts", "s1", "blobs", "missing"]) => {
            let req: Value = serde_json::from_slice(&body).unwrap();
            let missing: Vec<&Value> = req["hashes"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|h| !s.blobs.contains_key(h.as_str().unwrap()))
                .collect();
            reply(StatusCode::OK, json!({ "missing": missing }))
        }
        ("PUT", ["artifacts", "s1", "blobs", hash]) => {
            assert_eq!(hash_bytes(&body), *hash);
            s.blobs.insert(hash.to_string(), body.to_vec());
            reply(StatusCode::NO_CONTENT, json!({}))
        }
        ("POST", ["artifacts", "s1", "versions"]) => {
            let req: ArtifactSubmitReq = serde_json::from_slice(&body).unwrap();
            for f in &req.files {
                assert!(s.blobs.contains_key(&f.hash), "blob of {} not uploaded", f.path);
            }
            s.submits.push(req);
            let n = s.submits.len();
            reply(StatusCode::OK, json!({ "versionId": format!("v{n}"), "n": n, "head": true, "stale": false }))
        }
        ("PUT", ["artifacts", "s1", "versions", _, "thumbnail"]) => reply(StatusCode::NO_CONTENT, json!({})),
        _ => panic!("unexpected {method} {path}"),
    })
}

async fn server() -> (Arc<Mutex<Store>>, Config) {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let store = Arc::new(Mutex::new(Store::default()));
    let shared = store.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let store = shared.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(store.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    let api = Config {
        server: format!("http://127.0.0.1:{port}"),
        token: TOKEN.into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        tls_trust: None,
    };
    (store, api)
}

fn write(root: &Path, path: &str, body: &str) {
    let p = root.join(path);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

fn scope(root: &Path, out: &Outbox) -> Scope {
    Scope { group_id: "g1".into(), bot_id: "b1".into(), run_id: Some("r1".into()), root: root.into(), out: out.clone() }
}

#[tokio::test]
async fn preview_host_uploads_the_build_as_a_version_of_the_bots_site() {
    let (store, api) = server().await;
    let ws = tempfile::tempdir().unwrap();
    write(ws.path(), "web/dist/index.html", "<div id=app></div>");
    write(ws.path(), "web/dist/assets/app.js", "console.log(1)");
    write(ws.path(), "web/dist/assets/copy.js", "console.log(1)");
    write(ws.path(), "web/dist/.DS_Store", "junk");
    write(ws.path(), "web/dist/node_modules/x.js", "junk");
    let (out, _rx) = Outbox::channel();
    let args = json!({ "dir": "./web/dist/", "title": "活动官网" });
    let text = gonggong::artifacts::host_tool(Some(&api), &scope(ws.path(), &out), &args).await.unwrap();
    assert!(text.contains("「活动官网」第 1 版（web/dist 目录）"), "{text}");

    let s = store.lock().unwrap();
    assert_eq!(s.opened, vec![json!({ "dir": "web/dist", "title": "活动官网" })]);
    let submit = &s.submits[0];
    assert_eq!(submit.source, ArtifactSubmitSource::Host);
    let paths: Vec<&str> = submit.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["assets/app.js", "assets/copy.js", "index.html"]);
    // Same content goes up once.
    assert_eq!(s.blobs.len(), 2);
}

#[tokio::test]
async fn preview_host_refuses_a_dir_without_index_html_or_outside_the_workspace() {
    let (store, api) = server().await;
    let ws = tempfile::tempdir().unwrap();
    write(ws.path(), "src/main.ts", "x");
    let (out, _rx) = Outbox::channel();
    let host = |dir: &str| {
        let (api, scope, args) = (api.clone(), scope(ws.path(), &out), json!({ "dir": dir, "title": "官网" }));
        async move { gonggong::artifacts::host_tool(Some(&api), &scope, &args).await }
    };
    assert!(host("src").await.unwrap_err().contains("index.html"));
    assert!(host("..").await.is_err());
    assert!(store.lock().unwrap().submits.is_empty());
}

#[tokio::test]
async fn site_host_uploads_the_dir_of_a_static_preview() {
    let (store, api) = server().await;
    let ws = tempfile::tempdir().unwrap();
    write(ws.path(), "dist/index.html", "<h1>hi</h1>");
    let home = tempfile::tempdir().unwrap();
    let services = Services::new(home.path());
    let (out, mut rx) = Outbox::channel();
    services.start_static(scope(ws.path(), &out), "static-dist", "dist").await.unwrap();
    let DaemonToServer::ServiceState { service } = rx.recv().await.unwrap() else { panic!("no service.state") };
    let config = EngineConfig {
        home: home.path().into(),
        user_home: home.path().into(),
        adapter_cmd: None,
        idle: Duration::from_secs(60),
        reap: Duration::from_secs(60),
        cancel_grace: Duration::from_secs(5),
        continuation: Continuation::default(),
        api: Some(api),
    };
    let ask = |service_id: &str| SiteHost {
        request_id: "q1".into(),
        service_id: service_id.into(),
        artifact_id: "s1".into(),
    };
    let answer = async |rx: &mut gonggong::service::OutboxRx| loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.unwrap().unwrap();
        if let DaemonToServer::SiteHostResult { error, .. } = msg {
            return error;
        }
    };
    gonggong::artifacts::site_host(&config, &services, ask(&service.id), &out);
    assert_eq!(answer(&mut rx).await, None);
    let paths: Vec<String> = store.lock().unwrap().submits[0].files.iter().map(|f| f.path.clone()).collect();
    assert_eq!(paths, ["index.html"]);

    gonggong::artifacts::site_host(&config, &services, ask("nope"), &out);
    assert!(answer(&mut rx).await.unwrap().contains("启动记录"));
    services.stop_all().await;
}
