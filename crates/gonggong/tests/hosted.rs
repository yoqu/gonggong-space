#![cfg(unix)]
use gonggong::hosted::{Display, Scope, Services, StartArgs};
use gonggong::protocol::{DaemonToServer, ServiceInfo, ServiceStatus};
use gonggong::service::{Outbox, OutboxRx};
use std::path::Path;
use std::time::Duration;

fn scope(root: &Path, bot: &str, out: &Outbox) -> Scope {
    gonggong::i18n::set_locale(gonggong::i18n::Locale::Zh);
    Scope { group_id: "g1".into(), bot_id: bot.into(), run_id: Some("r1".into()), root: root.into(), out: out.clone() }
}

fn args(name: &str, command: &str, port: Option<u16>) -> StartArgs {
    StartArgs { name: name.into(), command: command.into(), cwd: None, port, env: Default::default(), display: None }
}

async fn next_state(rx: &mut OutboxRx) -> ServiceInfo {
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

#[tokio::test]
async fn the_server_can_restart_a_service_by_id_as_it_was_started() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let services = Services::new(home.path());
    let port = free_port();
    let mut web =
        args("web", &format!("echo \"$GREETING\"; exec python3 -m http.server {port} --bind 127.0.0.1"), Some(port));
    web.env.insert("GREETING".into(), "hi-from-env".into());
    services.start(scope(root.path(), "b1", &out), web).await.unwrap();
    let first = next_state(&mut rx).await;
    next_state(&mut rx).await;
    services.stop("g1", "b1", "web").await.unwrap();
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Exited);

    let text = services.restart_id(&first.id, &out).await.unwrap();
    assert!(text.contains("hi-from-env"), "{text}");
    let again = next_state(&mut rx).await;
    assert_ne!(again.id, first.id);
    assert_eq!((again.name.as_str(), again.port, again.run_id.as_deref()), ("web", Some(port), Some("r1")));
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Running);

    std::fs::create_dir_all(root.path().join("dist")).unwrap();
    services.start_static(scope(root.path(), "b1", &out), "site", "dist").await.unwrap();
    let site = next_state(&mut rx).await;
    services.restart_id(&site.id, &out).await.unwrap();
    assert_eq!(next_state(&mut rx).await.status, ServiceStatus::Exited);
    let reopened = next_state(&mut rx).await;
    assert_eq!((reopened.name.as_str(), reopened.status), ("site", ServiceStatus::Running));

    assert!(services.restart_id("nope", &out).await.unwrap_err().contains("重新启动"));
    services.stop_all().await;
}

#[cfg(not(target_os = "linux"))]
#[tokio::test]
async fn a_virtual_display_is_linux_only() {
    let (home, root) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, _rx) = Outbox::channel();
    let gui = StartArgs { display: Some(Display::Virtual), ..args("app", "sleep 30", None) };
    let err = Services::new(home.path()).start(scope(root.path(), "b1", &out), gui).await.unwrap_err();
    assert!(err.contains("Linux"), "{err}");
}

/// Xvfb stand-in: announces display 42 on the `-displayfd` descriptor (stdout), records its arguments and pid.
#[cfg(target_os = "linux")]
fn fake_xvfb(dir: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let (bin, seen) = (dir.join("Xvfb"), dir.join("seen"));
    std::fs::write(
        &bin,
        format!("#!/bin/sh\necho \"$@\" > {0}\necho $$ >> {0}\necho 42\nexec sleep 30\n", seen.display()),
    )
    .unwrap();
    std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    (bin, seen)
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn runs_a_gui_on_its_own_virtual_display_that_ends_with_it() {
    let (home, root, bins) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (out, mut rx) = Outbox::channel();
    let (xvfb, seen) = fake_xvfb(bins.path());
    let services = Services::new(home.path()).xvfb(xvfb);
    let cmd = "echo display=$DISPLAY wayland=${WAYLAND_DISPLAY:-none} session=$XDG_SESSION_TYPE; exec sleep 30";
    let gui = StartArgs { display: Some(Display::Virtual), ..args("app", cmd, None) };
    services.start(scope(root.path(), "b1", &out), gui).await.unwrap();
    let id = next_state(&mut rx).await.id;
    let seen = std::fs::read_to_string(&seen).unwrap();
    let (xvfb_args, xvfb_pid) = seen.split_once('\n').unwrap();
    assert!(xvfb_args.starts_with("-displayfd 1 ") && xvfb_args.contains("-nolisten tcp"), "{xvfb_args}");
    let xvfb_pid: u32 = xvfb_pid.trim().parse().unwrap();
    assert!(alive(xvfb_pid));
    assert_eq!(services.display(&id).as_deref(), Some(":42"));
    tokio::time::sleep(Duration::from_millis(200)).await;
    let logs = services.logs("g1", "b1", "app", None).unwrap();
    // GTK and Electron pick Wayland over X11 when they see it: the app must land on the virtual display.
    assert!(logs.contains("display=:42 wayland=none session=x11"), "{logs}");

    services.stop("g1", "b1", "app").await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while alive(xvfb_pid) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("Xvfb outlived its service");
    assert_eq!(services.display(&id), None);

    let missing = Services::new(home.path()).xvfb(bins.path().join("nope"));
    let gui = StartArgs { display: Some(Display::Virtual), ..args("app", "sleep 30", None) };
    let err = missing.start(scope(root.path(), "b1", &out), gui).await.unwrap_err();
    assert!(err.contains("apt install xvfb"), "{err}");
}
