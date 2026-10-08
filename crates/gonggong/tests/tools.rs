#![cfg(unix)]
//! Managed tools against a fake npm registry and Node mirror (design §4.1).
use gonggong::config::{Mirror, Proxy, Settings};
use gonggong::local::LocalSettings;
use gonggong::tools::{self, ToolKind};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

type Routes = Arc<Mutex<HashMap<String, Vec<u8>>>>;

/// Serves `routes` by exact path (404 otherwise), counting requests; returns the base URL.
async fn serve(routes: Routes, hits: Arc<AtomicUsize>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = s.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).into_owned();
            let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
            hits.fetch_add(1, Ordering::SeqCst);
            let body = routes.lock().unwrap().get(&path).cloned();
            let (status, body) = match body {
                Some(b) => ("200 OK", b),
                None => ("404 Not Found", b"not found".to_vec()),
            };
            let head = format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
            let _ = s.write_all(head.as_bytes()).await;
            let _ = s.write_all(&body).await;
        }
    });
    format!("http://127.0.0.1:{port}")
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// A Node archive whose `bin/node` is a script printing its version.
fn node_archive(root: &str, version: &str) -> Vec<u8> {
    let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
    let script = format!("#!/bin/sh\necho v{version}\n");
    let mut header = tar::Header::new_gnu();
    header.set_size(script.len() as u64);
    header.set_mode(0o755);
    tar.append_data(&mut header, format!("{root}/bin/node"), script.as_bytes()).unwrap();
    tar.into_inner().unwrap().finish().unwrap()
}

fn with_mirror(home: &Path, base: &str) {
    let mirror = Mirror::Custom { registry: format!("{base}/npm"), node: format!("{base}/node/") };
    Settings { mirror, ..Settings::default() }.save(home).unwrap();
}

const INDEX: &str = r#"[
  {"version":"v25.1.0","lts":false},
  {"version":"v24.2.0","lts":"Krypton"},
  {"version":"v22.20.0","lts":"Jod"},
  {"version":"v20.19.0","lts":"Iron"}
]"#;

async fn node_mirror(tamper: bool) -> (String, Routes) {
    let file = tools::node_archive_name("24.2.0", tools::node_platform().unwrap());
    let root = file.trim_end_matches(".tar.gz").to_string();
    let archive = node_archive(&root, "24.2.0");
    let sum = if tamper { sha(b"something else") } else { sha(&archive) };
    let routes: Routes = Arc::default();
    {
        let mut r = routes.lock().unwrap();
        r.insert("/node/index.json".into(), INDEX.into());
        r.insert("/node/v24.2.0/SHASUMS256.txt".into(), format!("{}  other.tar.gz\n{sum}  {file}\n", sha(b"x")).into());
        r.insert(format!("/node/v24.2.0/{file}"), archive);
    }
    (serve(routes.clone(), Arc::default()).await, routes)
}

#[tokio::test]
async fn installs_the_latest_lts_node_from_the_mirror_and_switches_to_it() {
    let home = tempfile::tempdir().unwrap();
    let (base, _) = node_mirror(false).await;
    with_mirror(home.path(), &base);
    let lines = Mutex::new(vec![]);
    let status =
        tools::install(home.path(), ToolKind::Node, None, &|l: &str| lines.lock().unwrap().push(l.to_string()))
            .await
            .unwrap();
    assert_eq!(status.version.as_deref(), Some("24.2.0"));
    assert!(status.installed && status.managed);
    assert!(home.path().join("runtime/node-v24.2.0/bin/node").is_file());
    let node = tools::node(home.path()).unwrap();
    assert!(node.managed);
    assert!(node.path.starts_with(home.path().join("runtime").canonicalize().unwrap()));
    assert!(!lines.lock().unwrap().is_empty(), "progress is reported");
}

#[tokio::test]
async fn refuses_a_node_archive_whose_checksum_does_not_match() {
    let home = tempfile::tempdir().unwrap();
    let (base, _) = node_mirror(true).await;
    with_mirror(home.path(), &base);
    let err = tools::install(home.path(), ToolKind::Node, None, &|_: &str| {}).await.unwrap_err();
    assert!(format!("{err:#}").contains("SHA256"), "{err:#}");
    assert!(!home.path().join("runtime/current").exists());
    assert!(!home.path().join("runtime/node-v24.2.0").exists());
}

#[tokio::test]
async fn rejects_node_older_than_22_and_malformed_versions_before_any_download() {
    let home = tempfile::tempdir().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let base = serve(Arc::default(), hits.clone()).await;
    with_mirror(home.path(), &base);
    assert!(tools::install(home.path(), ToolKind::Node, Some("20.19.0"), &|_: &str| {}).await.is_err());
    assert!(tools::install(home.path(), ToolKind::Claude, Some("1.0; rm -rf /"), &|_: &str| {}).await.is_err());
    assert!(tools::install(home.path(), ToolKind::Codex, Some("--registry=evil"), &|_: &str| {}).await.is_err());
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

/// A managed Node whose `node` records its arguments instead of running npm.
fn fake_managed_node(home: &Path) -> std::path::PathBuf {
    let dir = home.join("runtime/node-v24.2.0/bin");
    std::fs::create_dir_all(&dir).unwrap();
    let log = home.join("npm-args.txt");
    let script = format!(
        "#!/bin/sh\ncase \"$1\" in\n  --version) echo v24.2.0 ;;\n  *npm-cli.js) echo \"$@\" > '{}'; env > '{}'; echo added 1 package ;;\nesac\n",
        log.display(),
        home.join("npm-env.txt").display()
    );
    std::fs::write(dir.join("node"), script).unwrap();
    std::fs::set_permissions(dir.join("node"), std::fs::Permissions::from_mode(0o755)).unwrap();
    std::os::unix::fs::symlink("node-v24.2.0", home.join("runtime/current")).unwrap();
    log
}

#[tokio::test]
async fn installs_agent_clis_into_the_managed_prefix_from_the_configured_registry() {
    let home = tempfile::tempdir().unwrap();
    with_mirror(home.path(), "http://127.0.0.1:9");
    let log = fake_managed_node(home.path());
    let lines = Mutex::new(vec![]);
    // The fake npm installs nothing, so the CLI stays undetected under the managed prefix.
    let _ = tools::install(home.path(), ToolKind::Codex, Some("0.159.2"), &|l: &str| {
        lines.lock().unwrap().push(l.to_string())
    })
    .await;
    let args = std::fs::read_to_string(log).unwrap();
    let prefix = home.path().join("tools");
    assert!(args.contains("npm-cli.js i -g --prefix"), "{args}");
    assert!(args.contains(&prefix.to_string_lossy().into_owned()), "{args}");
    assert!(args.contains("--registry http://127.0.0.1:9/npm"), "{args}");
    assert!(args.trim_end().ends_with("@openai/codex@0.159.2"), "{args}");
    assert!(lines.lock().unwrap().iter().any(|l| l.contains("added 1 package")), "npm output is streamed");
}

#[tokio::test]
async fn npm_runs_with_the_proxy_and_the_user_env() {
    let home = tempfile::tempdir().unwrap();
    let mirror = Mirror::Custom { registry: "http://127.0.0.1:9/npm".into(), node: "http://127.0.0.1:9/node".into() };
    let proxy = Some(Proxy { url: "http://proxy.test:3128".into(), no_proxy: String::new() });
    let env = [("GG_EXTRA".to_string(), "1".to_string())].into();
    Settings { mirror, proxy, env, ..Settings::default() }.save(home.path()).unwrap();
    fake_managed_node(home.path());
    let _ = tools::install(home.path(), ToolKind::Codex, Some("0.159.2"), &|_: &str| {}).await;
    let env = std::fs::read_to_string(home.path().join("npm-env.txt")).unwrap();
    assert!(env.lines().any(|l| l == "HTTPS_PROXY=http://proxy.test:3128"), "{env}");
    assert!(env.lines().any(|l| l == "GG_EXTRA=1"), "{env}");
}

#[tokio::test]
async fn downloads_go_through_the_configured_proxy() {
    let home = tempfile::tempdir().unwrap();
    let routes: Routes = Arc::default();
    routes.lock().unwrap().insert("http://mirror.invalid/node/index.json".into(), INDEX.into());
    let proxy = serve(routes, Arc::default()).await;
    let mirror =
        Mirror::Custom { registry: "http://mirror.invalid/npm".into(), node: "http://mirror.invalid/node".into() };
    let proxy = Some(Proxy { url: proxy, no_proxy: String::new() });
    Settings { mirror, proxy, ..Settings::default() }.save(home.path()).unwrap();
    assert_eq!(tools::latest(home.path(), ToolKind::Node, true).await.unwrap(), "24.2.0");
}

#[tokio::test]
async fn caches_the_latest_versions_for_six_hours() {
    let home = tempfile::tempdir().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let routes: Routes = Arc::default();
    routes.lock().unwrap().insert("/npm/@anthropic-ai/claude-code/latest".into(), br#"{"version":"2.1.285"}"#.to_vec());
    routes.lock().unwrap().insert("/node/index.json".into(), INDEX.into());
    let base = serve(routes, hits.clone()).await;
    with_mirror(home.path(), &base);

    assert_eq!(tools::latest(home.path(), ToolKind::Claude, false).await.unwrap(), "2.1.285");
    assert_eq!(tools::latest(home.path(), ToolKind::Node, false).await.unwrap(), "24.2.0");
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert_eq!(tools::latest(home.path(), ToolKind::Claude, false).await.unwrap(), "2.1.285");
    assert_eq!(hits.load(Ordering::SeqCst), 2, "served from the cache");
    tools::latest(home.path(), ToolKind::Claude, true).await.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 3, "a forced check skips the cache");

    // Seven hours later the entry is stale.
    let path = home.path().join("tools-latest.json");
    let mut cache: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let at = cache["claude"]["checkedAt"].as_u64().unwrap();
    cache["claude"]["checkedAt"] = (at - 7 * 3600).into();
    std::fs::write(&path, cache.to_string()).unwrap();
    tools::latest(home.path(), ToolKind::Claude, false).await.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 4);

    // A trailing slash is the same registry; another registry is another source.
    let mirror =
        |registry: String| Settings { mirror: Mirror::Custom { registry, node: base.clone() }, ..Settings::default() };
    mirror(format!("{base}/npm/")).save(home.path()).unwrap();
    tools::latest(home.path(), ToolKind::Claude, false).await.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 4);
    mirror(format!("{base}/other")).save(home.path()).unwrap();
    assert!(tools::latest(home.path(), ToolKind::Claude, false).await.is_err());
    assert_eq!(hits.load(Ordering::SeqCst), 5);
}

#[tokio::test]
async fn status_marks_tools_under_the_gonggong_home_as_managed() {
    let home = tempfile::tempdir().unwrap();
    with_mirror(home.path(), "http://127.0.0.1:9");
    fake_managed_node(home.path());
    let bin = home.path().join("tools/bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("claude"), "#!/bin/sh\necho '2.1.4 (Claude Code)'\n").unwrap();
    std::fs::set_permissions(bin.join("claude"), std::fs::Permissions::from_mode(0o755)).unwrap();

    let all = tools::status(home.path(), &LocalSettings::default()).await;
    let get = |k| all.iter().find(|s| s.kind == k).unwrap();
    let node = get(ToolKind::Node);
    assert!(node.installed && node.managed);
    assert_eq!(node.version.as_deref(), Some("24.2.0"));
    let claude = get(ToolKind::Claude);
    assert!(claude.installed && claude.managed);
    assert_eq!(claude.version.as_deref(), Some("2.1.4"));
    assert_eq!(claude.latest, None, "the unreachable mirror only loses the update hint");
}
