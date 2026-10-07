//! `gg net` against a local stand-in for the server's health, probe and report endpoints.
use gonggong::config::Config;
use gonggong::net;
use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

#[derive(Default)]
struct Seen {
    requests: Vec<String>,
    report: Option<(String, serde_json::Value)>,
}

async fn handle(seen: Arc<Mutex<Seen>>, req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    let target = format!("{} {}", req.method(), req.uri());
    seen.lock().unwrap().requests.push(target.clone());
    let auth = req.headers().get("authorization").map(|v| v.to_str().unwrap().to_string()).unwrap_or_default();
    let body = match req.uri().path() {
        "/api/health" => {
            tokio::time::sleep(Duration::from_millis(15)).await;
            Bytes::from_static(br#"{"ok":true,"protocol":1}"#)
        }
        "/api/daemon/net/probe" => {
            let n: usize = req.uri().query().and_then(|q| q.strip_prefix("bytes=")).unwrap().parse().unwrap();
            Bytes::from(vec![7u8; n])
        }
        "/api/daemon/net" => {
            let bytes = req.into_body().collect().await.unwrap().to_bytes();
            seen.lock().unwrap().report = Some((auth, serde_json::from_slice(&bytes).unwrap()));
            let mut res = Response::new(Full::new(Bytes::new()));
            *res.status_mut() = hyper::StatusCode::NO_CONTENT;
            return Ok(res);
        }
        _ => unreachable!("{target}"),
    };
    Ok(Response::new(Full::new(body)))
}

async fn serve() -> (Config, Arc<Mutex<Seen>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Seen::default()));
    let state = seen.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let state = state.clone();
            tokio::spawn(async move {
                let service = service_fn(move |req| handle(state.clone(), req));
                let _ = http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    let config = Config {
        server: format!("http://127.0.0.1:{port}"),
        token: "mt_1".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
    };
    (config, seen)
}

#[tokio::test]
async fn measures_median_latency_and_probe_throughput_then_reports_them() {
    let (config, seen) = serve().await;
    let result = net::run(&config).await.unwrap();
    assert!(result.latency_ms >= 15.0 && result.latency_ms < 1000.0, "{result:?}");
    assert!(result.bandwidth_mbps > 1.0, "{result:?}");

    let seen = seen.lock().unwrap();
    let health = seen.requests.iter().filter(|r| *r == "GET /api/health").count();
    assert_eq!(health, 5);
    assert!(seen.requests.contains(&format!("GET /api/daemon/net/probe?bytes={}", net::PROBE_BYTES)));
    let (auth, body) = seen.report.clone().unwrap();
    assert_eq!(auth, "Bearer mt_1");
    assert_eq!(body["latencyMs"].as_f64().unwrap(), result.latency_ms);
    assert_eq!(body["bandwidthMbps"].as_f64().unwrap(), result.bandwidth_mbps);
}

#[test]
fn median_of_samples() {
    assert_eq!(net::median(&mut [30.0, 10.0, 500.0, 20.0, 25.0]), 25.0);
    assert_eq!(net::median(&mut [4.0, 2.0]), 3.0);
}
