use aiws::protocol::UpgradeInfo;
use aiws::upgrade::{CURRENT, StageError, Upgrader, install, is_newer, restart_command, stage};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Serves `body` for every request; returns the server base URL.
async fn serve(body: &'static [u8]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let _ = s.read(&mut buf).await;
            let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
            s.write_all(head.as_bytes()).await.unwrap();
            s.write_all(body).await.unwrap();
        }
    });
    format!("http://127.0.0.1:{port}")
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn info(version: &str, url: &str, sha256: String) -> UpgradeInfo {
    UpgradeInfo { version: version.into(), url: url.into(), sha256 }
}

#[test]
fn only_strictly_newer_versions_count() {
    assert!(is_newer("0.2.0", "0.1.9"));
    assert!(is_newer("0.10.0", "0.9.0"));
    assert!(!is_newer("0.1.0", "0.1.0"));
    assert!(!is_newer("0.1", "0.1.0"));
    assert!(!is_newer("0.0.9", "0.1.0"));
    assert!(!is_newer("0.1.0-rc1", "0.1.0"));
}

#[tokio::test]
async fn stages_a_verified_build_from_a_server_relative_url() {
    let home = tempfile::tempdir().unwrap();
    let server = serve(b"new-build").await;
    let path = stage(home.path(), &server, &info("9.0.0", "/downloads/aiws", sha(b"new-build"))).await.unwrap();
    assert!(path.starts_with(home.path().join("updates")));
    assert_eq!(std::fs::read(&path).unwrap(), b"new-build");
}

#[tokio::test]
async fn refuses_a_build_whose_sha256_does_not_match() {
    let home = tempfile::tempdir().unwrap();
    let server = serve(b"tampered").await;
    let err = stage(home.path(), &server, &info("9.0.0", "/downloads/aiws", sha(b"genuine"))).await.unwrap_err();
    assert!(matches!(err, StageError::Mismatch { .. }));
    let left = std::fs::read_dir(home.path().join("updates")).map(|d| d.count()).unwrap_or(0);
    assert_eq!(left, 0, "nothing unverified is kept");

    // A refused version is never downloaded again by this process.
    let up = Upgrader::new(home.path().into(), server, "/nonexistent".into(), vec![]);
    let bad = info("9.0.0", "/downloads/aiws", sha(b"genuine"));
    assert!(up.offer(bad.clone()));
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(up.staged().is_none());
    assert!(!up.offer(bad));
}

#[tokio::test]
async fn ignores_offers_that_are_not_newer() {
    let home = tempfile::tempdir().unwrap();
    let up = Upgrader::new(home.path().into(), "http://127.0.0.1:1".into(), "/nonexistent".into(), vec![]);
    assert!(!up.offer(info(CURRENT, "/downloads/aiws", sha(b"x"))));
    assert!(!up.offer(info("0.0.1", "/downloads/aiws", sha(b"x"))));
    assert!(up.staged().is_none());
}

#[tokio::test]
async fn an_offer_stages_once() {
    let home = tempfile::tempdir().unwrap();
    let server = serve(b"new-build").await;
    let up = Upgrader::new(home.path().into(), server, "/nonexistent".into(), vec![]);
    let offer = info("9.0.0", "/downloads/aiws", sha(b"new-build"));
    assert!(up.offer(offer.clone()));
    assert!(!up.offer(offer.clone()), "already downloading");
    tokio::time::timeout(Duration::from_secs(5), async {
        while up.staged().is_none() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert!(!up.offer(offer), "already staged");
}

#[cfg(unix)]
#[test]
fn replaces_the_executable_and_restarts_it_with_the_same_arguments() {
    let dir = tempfile::tempdir().unwrap();
    let script = |p: &Path, tag: &str| {
        std::fs::write(p, format!("#!/bin/sh\necho \"{tag} $@\" > \"$(dirname \"$0\")/ran\"\n")).unwrap();
    };
    let exe = dir.path().join("aiws");
    script(&exe, "old");
    let staged = dir.path().join("aiws-9.0.0");
    script(&staged, "new");

    install(&staged, &exe).unwrap();
    let status = restart_command(&exe, &["run".into(), "--flag".into()]).status().unwrap();
    assert!(status.success());
    assert_eq!(std::fs::read_to_string(dir.path().join("ran")).unwrap(), "new run --flag\n");
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 3, "no temp file left behind: {names:?}");
}
