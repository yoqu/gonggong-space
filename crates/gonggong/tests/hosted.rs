#![cfg(unix)]
use gonggong::hosted::{Scope, Services, StartArgs};
use gonggong::protocol::{DaemonToServer, ServiceInfo, ServiceStatus};
use gonggong::service::Outbox;
use std::path::Path;
use std::time::Duration;
use tokio::sync::mpsc::UnboundedReceiver;

fn scope(root: &Path, bot: &str, out: &Outbox) -> Scope {
    Scope { group_id: "g1".into(), bot_id: bot.into(), run_id: Some("r1".into()), root: root.into(), out: out.clone() }
}

fn args(name: &str, command: &str, port: Option<u16>) -> StartArgs {
    StartArgs { name: name.into(), command: command.into(), cwd: None, port, env: Default::default() }
}

async fn next_state(rx: &mut UnboundedReceiver<DaemonToServer>) -> ServiceInfo {
    let msg = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("no service.state").unwrap();
    match msg {
        DaemonToServer::ServiceState { service } => service,
        other => panic!("unexpected {other:?}"),
    }
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap()
        .success()
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

#[tokio::test]
async fn starts_waits_for_the_port_and_keeps_logs() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let port = free_port();
    // Listens only after a moment, so readiness has to wait for it.
    let cmd = format!("echo booting; echo oops >&2; sleep 0.5; exec python3 -m http.server {port} --bind 127.0.0.1");
    let text = services.start(scope(root.path(), "b1", &out), args("web", &cmd, Some(port))).await.unwrap();
    assert!(text.contains("web") && text.contains(&port.to_string()), "{text}");
    assert!(text.contains("booting") && text.contains("oops"), "{text}");

    let starting = next_state(&mut rx).await;
    assert_eq!((starting.status, starting.name.as_str(), starting.port), (ServiceStatus::Starting, "web", Some(port)));
    assert_eq!((starting.group_id.as_str(), starting.bot_id.as_str()), ("g1", "b1"));
    assert_eq!(starting.run_id.as_deref(), Some("r1"));
    let running = next_state(&mut rx).await;
    assert_eq!((running.status, running.id.clone()), (ServiceStatus::Running, starting.id.clone()));

    let list = services.list("g1", "b1");
    assert!(list.contains("web") && list.contains("运行中"), "{list}");
    let logs = services.logs("g1", "b1", "web", None).unwrap();
    assert!(logs.contains("booting") && logs.contains("oops"), "{logs}");
    let log = std::fs::read_to_string(root.path().join(".gonggong/services/web.log")).unwrap();
    assert!(log.contains("booting") && log.contains("oops"), "{log}");

    services.stop("g1", "b1", "web").await.unwrap();
    let stopped = next_state(&mut rx).await;
    assert_eq!(stopped.status, ServiceStatus::Exited);
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
}

#[tokio::test]
async fn a_command_that_dies_before_its_port_opens_fails_with_its_output() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let err = services
        .start(scope(root.path(), "b1", &out), args("api", "echo 'no such script' >&2; exit 3", Some(free_port())))
        .await
        .unwrap_err();
    assert!(err.contains("退出码 3") && err.contains("no such script"), "{err}");
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Starting);
    let failed = next_state(&mut rx).await;
    assert_eq!((failed.status, failed.exit_code), (ServiceStatus::Failed, Some(3)));
}

#[tokio::test]
async fn stop_ends_the_whole_process_group() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let services = Services::new(home.path());
    let pidfile = root.path().join("child.pid");
    let cmd = format!("sleep 300 & echo $! > {}; wait", pidfile.display());
    services.start(scope(root.path(), "b1", &out), args("worker", &cmd, None)).await.unwrap();
    let child = wait_for_pid(&pidfile).await;
    assert!(alive(child));
    assert_eq!(services.live().iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["worker"]);
    services.stop("g1", "b1", "worker").await.unwrap();
    assert!(services.live().is_empty());
    assert!(!alive(child));
    assert!(services.stop("g1", "b1", "worker").await.is_err(), "already stopped");
}

#[tokio::test]
async fn restarting_a_name_replaces_it_and_the_server_can_stop_by_id() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    services.start(scope(root.path(), "b1", &out), args("w", "sleep 300", None)).await.unwrap();
    let first = next_state(&mut rx).await;
    next_state(&mut rx).await;
    services.start(scope(root.path(), "b1", &out), args("w", "sleep 300", None)).await.unwrap();
    let mut seen = vec![];
    for _ in 0..3 {
        let s = next_state(&mut rx).await;
        seen.push((s.id == first.id, s.status));
    }
    assert!(seen.contains(&(true, ServiceStatus::Exited)), "{seen:?}");
    assert!(seen.contains(&(false, ServiceStatus::Running)), "{seen:?}");
    let second = services.list_infos("g1", "b1").into_iter().find(|s| s.status == ServiceStatus::Running).unwrap();
    services.stop_id(&second.id).await;
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Exited);
}

#[tokio::test]
async fn rejects_dirs_outside_the_workspace_and_more_than_five_per_bot() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let services = Services::new(home.path());
    let mut escape = args("x", "true", None);
    escape.cwd = Some("../".into());
    let err = services.start(scope(root.path(), "b1", &out), escape).await.unwrap_err();
    assert!(err.contains("工作区"), "{err}");
    let err = services.start(scope(root.path(), "b1", &out), args("../x", "true", None)).await.unwrap_err();
    assert!(err.contains("name"), "{err}");

    for i in 0..5 {
        services.start(scope(root.path(), "b1", &out), args(&format!("s{i}"), "sleep 300", None)).await.unwrap();
    }
    let err = services.start(scope(root.path(), "b1", &out), args("s5", "sleep 300", None)).await.unwrap_err();
    assert!(err.contains("5"), "{err}");
    services.start(scope(root.path(), "b2", &out), args("s0", "sleep 300", None)).await.unwrap();
    for i in 0..5 {
        services.stop("g1", "b1", &format!("s{i}")).await.unwrap();
    }
    services.stop("g1", "b2", "s0").await.unwrap();
}

#[tokio::test]
async fn a_new_daemon_ends_services_left_by_the_previous_one() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let pidfile = root.path().join("child.pid");
    let services = Services::new(home.path());
    let cmd = format!("sleep 300 & echo $! > {}; wait", pidfile.display());
    services.start(scope(root.path(), "b1", &out), args("left", &cmd, None)).await.unwrap();
    let child = wait_for_pid(&pidfile).await;
    std::mem::forget(services);
    let _restarted = Services::new(home.path());
    assert!(!alive(child));
}

async fn wait_for_pid(file: &Path) -> u32 {
    for _ in 0..100 {
        if let Ok(s) = std::fs::read_to_string(file)
            && let Ok(pid) = s.trim().parse()
        {
            return pid;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("no pid written");
}

#[tokio::test]
async fn serves_a_workspace_dir_as_a_static_site() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let site = root.path().join("dist");
    std::fs::create_dir_all(site.join("css")).unwrap();
    std::fs::write(site.join("index.html"), "<h1>报告</h1>").unwrap();
    std::fs::write(site.join("css/a.css"), "h1{}").unwrap();
    std::fs::write(root.path().join("secret.txt"), "no").unwrap();
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let port = services.start_static(scope(root.path(), "b1", &out), "static-dist", "dist").await.unwrap();
    let state = next_state(&mut rx).await;
    assert_eq!((state.status, state.port, state.name.as_str()), (ServiceStatus::Running, Some(port), "static-dist"));

    let get = |path: &str| {
        let url = format!("http://127.0.0.1:{port}{path}");
        async move {
            let res = reqwest::get(url).await.unwrap();
            let kind = res.headers().get("content-type").map(|v| v.to_str().unwrap().to_string());
            (res.status().as_u16(), kind, res.text().await.unwrap())
        }
    };
    let (status, kind, body) = get("/").await;
    assert_eq!((status, kind.as_deref(), body.as_str()), (200, Some("text/html; charset=utf-8"), "<h1>报告</h1>"));
    assert_eq!(get("/css/a.css").await.1.as_deref(), Some("text/css; charset=utf-8"));
    assert_eq!(get("/../secret.txt").await.0, 404);
    assert_eq!(get("/%2e%2e/secret.txt").await.0, 404);
    assert_eq!(get("/nope.html").await.0, 404);

    assert!(services.list("g1", "b1").contains("static-dist · 运行中"));
    services.stop("g1", "b1", "static-dist").await.unwrap();
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Exited);
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    let err = services.start_static(scope(root.path(), "b1", &out), "static-x", "../").await.unwrap_err();
    assert!(err.contains("工作区"), "{err}");
}

#[tokio::test]
async fn refuses_a_port_something_else_already_listens_on() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let err = Services::new(home.path())
        .start(scope(root.path(), "b1", &out), args("web", "sleep 30", Some(port)))
        .await
        .unwrap_err();
    assert!(err.contains("已被占用"), "{err}");
}

#[tokio::test]
async fn stop_all_ends_every_service_when_the_daemon_exits() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let services = Services::new(home.path());
    let pidfile = root.path().join("child.pid");
    let cmd = format!("sleep 300 & echo $! > {}; wait", pidfile.display());
    services.start(scope(root.path(), "b1", &out), args("w", &cmd, None)).await.unwrap();
    std::fs::create_dir_all(root.path().join("site")).unwrap();
    let port = services.start_static(scope(root.path(), "b1", &out), "static-site", "site").await.unwrap();
    let child = wait_for_pid(&pidfile).await;
    services.stop_all().await;
    assert!(!alive(child));
    assert!(std::net::TcpStream::connect(("127.0.0.1", port)).is_err());
    assert!(services.live().is_empty());
}
