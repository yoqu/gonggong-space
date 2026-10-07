//! The sync blob client against a local stand-in for `/api/daemon/sync/:groupId/…`.
use gonggong::config::Config;
use gonggong::protocol::SYNC_MISSING_MAX;
use gonggong::sync::{Client, hash_bytes};
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

#[derive(Default)]
struct Server {
    requests: Vec<String>,
    blobs: HashMap<String, Vec<u8>>,
}

async fn handle(state: Arc<Mutex<Server>>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let (method, path, query) =
        (req.method().clone(), req.uri().path().to_string(), req.uri().query().map(String::from));
    let auth = req.headers().get("authorization").map(|v| v.to_str().unwrap().to_string());
    state.lock().unwrap().requests.push(format!("{method} {path}"));
    let reply = |status: StatusCode, body: Vec<u8>| {
        let mut res = Response::new(Full::new(Bytes::from(body)));
        *res.status_mut() = status;
        Ok(res)
    };
    if auth.as_deref() != Some("Bearer mt_1") {
        return reply(StatusCode::UNAUTHORIZED, br#"{"message":"unauthorized"}"#.to_vec());
    }
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let mut s = state.lock().unwrap();
    let rest = path.strip_prefix("/api/daemon/sync/g1/").unwrap();
    match (method.as_str(), rest) {
        ("POST", "blobs/missing") => {
            let req: serde_json::Value = serde_json::from_slice(&body).unwrap();
            let hashes = req["hashes"].as_array().unwrap();
            assert!(hashes.len() <= SYNC_MISSING_MAX);
            let missing: Vec<_> = hashes.iter().filter(|h| !s.blobs.contains_key(h.as_str().unwrap())).collect();
            reply(StatusCode::OK, serde_json::to_vec(&serde_json::json!({ "missing": missing })).unwrap())
        }
        ("PUT", r) => {
            let hash = r.strip_prefix("blobs/").unwrap();
            if hash_bytes(&body) != hash {
                return reply(StatusCode::BAD_REQUEST, br#"{"message":"hash mismatch"}"#.to_vec());
            }
            s.blobs.insert(hash.into(), body.to_vec());
            reply(StatusCode::NO_CONTENT, vec![])
        }
        ("GET", "changes") => {
            assert_eq!(query.as_deref(), Some("from=3"));
            let body =
                serde_json::json!({ "headVersion": 5, "entries": [{ "path": "a", "hash": null, "exec": false }] });
            reply(StatusCode::OK, serde_json::to_vec(&body).unwrap())
        }
        ("GET", r) => match s.blobs.get(r.strip_prefix("blobs/").unwrap()) {
            Some(b) => reply(StatusCode::OK, b.clone()),
            None => reply(StatusCode::NOT_FOUND, br#"{"message":"no blob"}"#.to_vec()),
        },
        _ => unreachable!("{method} {path}"),
    }
}

async fn serve(token: &str) -> (Client, Arc<Mutex<Server>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let state = Arc::new(Mutex::new(Server::default()));
    let shared = state.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let state = shared.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(state.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    let config = Config {
        server: format!("http://127.0.0.1:{port}/"),
        token: token.into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
    };
    (Client::new(&config).unwrap(), state)
}

#[tokio::test]
async fn uploads_only_missing_blobs_and_downloads_them_back() {
    let (client, state) = serve("mt_1").await;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.txt");
    std::fs::write(&file, "hello").unwrap();
    let hash = hash_bytes(b"hello");

    let mut hashes: Vec<String> = (0..SYNC_MISSING_MAX + 1).map(|i| hash_bytes(i.to_string().as_bytes())).collect();
    hashes.push(hash.clone());
    assert_eq!(client.missing("g1", &hashes).await.unwrap().len(), hashes.len());
    client.upload("g1", &hash, &file).await.unwrap();
    assert_eq!(client.missing("g1", std::slice::from_ref(&hash)).await.unwrap(), Vec::<String>::new());
    assert_eq!(client.download("g1", &hash).await.unwrap(), b"hello");

    let err = client.download("g1", &hash_bytes(b"nope")).await.unwrap_err().to_string();
    assert!(err.contains("404") && err.contains("no blob"), "{err}");
    let err = client.upload("g1", &hash_bytes(b"other"), &file).await.unwrap_err().to_string();
    assert!(err.contains("hash mismatch"), "{err}");

    let changes = client.changes("g1", 3).await.unwrap();
    assert_eq!((changes.head_version, changes.entries.len()), (5, 1));

    let requests = state.lock().unwrap().requests.clone();
    let posts = requests.iter().filter(|r| *r == "POST /api/daemon/sync/g1/blobs/missing").count();
    assert_eq!(posts, 3, "{SYNC_MISSING_MAX} hashes per request");
}

#[tokio::test]
async fn sends_the_machine_token() {
    let (client, _) = serve("wrong").await;
    let err = client.changes("g1", 3).await.unwrap_err().to_string();
    assert!(err.contains("401"), "{err}");
}
