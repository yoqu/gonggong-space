//! CLI connectors driven by fake `lark-cli` / `meegle` scripts: never the real CLIs, whose logins belong to the
//! machine's owner.
use gonggong::connectors::{Connectors, run_path};
use gonggong::protocol::{
    ConnectorCliState, ConnectorDriver, ConnectorProfile, ConnectorSpec, ConnectorsAction, ConnectorsAuthStep,
    ConnectorsCmd, ConnectorsResult, DaemonToServer, RunCliProfile,
};
use gonggong::service::{Outbox, OutboxRx};
use std::path::{Path, PathBuf};
use std::time::Duration;

const MEMBER: &str = "gg-11111111-2222-4333-8444-555555555555";

fn member() -> ConnectorProfile {
    ConnectorProfile::try_from(MEMBER.to_string()).unwrap()
}

/// A fake lark-cli: state lives in files beside it (`inited-<profile>`, `logged-<profile>`), `approve` stands for
/// the person approving in the browser, every call is appended to `calls`.
const LARK: &str = r#"#!/bin/sh
S="$(dirname "$0")"
echo "$*" >> "$S/calls"
P=default; prev=
for a in "$@"; do case "$prev" in --profile|--name) P="$a" ;; esac; prev="$a"; done
case "$1 $2" in
"--version ") echo "lark-cli version 1.0.96" ;;
"auth status")
  if [ -f "$S/logged-$P" ]; then
    echo '{"identities":{"user":{"status":"ready","userName":"姜维川","openId":"ou_1","expiresAt":"2026-11-24T12:00:00+08:00","refreshExpiresAt":"2026-12-01T10:00:00+08:00"}}}'
  elif [ -f "$S/inited-$P" ]; then
    echo '{"identities":{"user":{"status":"missing","message":"User identity: missing (no user logged in)"}}}'
  else
    echo '{"ok":false,"error":{"type":"config","subtype":"not_configured","message":"not configured"}}'; exit 3
  fi ;;
"config init")
  echo "████ ▄▄▄▄▄ ████" >&2
  echo "打开以下链接配置应用:" >&2
  echo "  https://open.feishu.cn/page/cli?user_code=AAAA-BBBB&from=cli" >&2
  while [ ! -f "$S/approve" ]; do sleep 0.05; done
  touch "$S/inited-$P" ;;
"auth login")
  case "$*" in
  *--no-wait*) echo '{"verification_url":"https://accounts.feishu.cn/oauth/v1/device/verify?user_code=ABCD-EFGH","device_code":"dev-1","user_code":"ABCD-EFGH","expires_in":600}' ;;
  *) while [ ! -f "$S/approve" ]; do sleep 0.05; done; touch "$S/logged-$P"; echo "授权成功" ;;
  esac ;;
"auth logout") rm -f "$S/logged-$P" ;;
"api GET") echo '{"data":{"name":"姜维川","open_id":"ou_1","user_id":"a1b2c3d4"}}' ;;
"profile list") echo '[{"name":"cli_owner","active":true}]' ;;
esac
"#;

/// A fake meegle: the first poll is still pending, the next one logs in.
const MEEGLE: &str = r#"#!/bin/sh
S="$(dirname "$0")"
echo "$*" >> "$S/calls"
P=default; prev=
for a in "$@"; do [ "$prev" = "--profile" ] && P="$a"; prev="$a"; done
case "$*" in
--version) echo "1.0.27" ;;
"auth status"*)
  if [ -f "$S/logged-$P" ]; then echo '{"authenticated":true,"expires_in_minutes":96,"host":"project.feishu.cn"}'
  else echo '{"authenticated":false,"host":null,"reason":"no local token"}'; exit 1; fi ;;
*"--phase init"*) echo '{"client_id":"cli_x","device_code":"dc-1","expires_in":1800,"interval":1,"user_code":"XYFJJ-7WRV6","verification_uri":"https://project.feishu.cn/b/auth/mcp","verification_uri_complete":"https://project.feishu.cn/b/auth/mcp?usercode=XYFJJ-7WRV6"}' ;;
*"--phase poll"*)
  if [ -f "$S/polled" ]; then touch "$S/logged-$P"; echo '{"status":"ok"}'
  else touch "$S/polled"; echo '{"status":"authorization_pending"}'; fi ;;
"user me"*) echo '{"name_cn":"姜维川","user_key":"7386"}' ;;
"auth logout"*) rm -f "$S/logged-$P" ;;
esac
"#;

fn fake(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn lark() -> ConnectorSpec {
    ConnectorSpec { connector: "feishu".into(), driver: ConnectorDriver::LarkCli, npm: "@larksuite/cli".into() }
}

fn meegle() -> ConnectorSpec {
    ConnectorSpec { connector: "meegle".into(), driver: ConnectorDriver::Meegle, npm: "@lark-project/meegle".into() }
}

fn cmd(id: &str, action: ConnectorsAction, spec: ConnectorSpec, profile: ConnectorProfile) -> ConnectorsCmd {
    ConnectorsCmd { request_id: id.into(), action, spec, profile, domains: vec![] }
}

async fn next(rx: &mut OutboxRx) -> DaemonToServer {
    tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.expect("no message").unwrap()
}

/// Skips progress lines; the next auth link or result.
async fn next_event(rx: &mut OutboxRx) -> DaemonToServer {
    loop {
        match next(rx).await {
            DaemonToServer::ConnectorsProgress { .. } => continue,
            other => return other,
        }
    }
}

async fn result(rx: &mut OutboxRx) -> ConnectorsResult {
    match next_event(rx).await {
        DaemonToServer::ConnectorsResult(r) => r,
        other => panic!("unexpected {other:?}"),
    }
}

fn setup() -> (tempfile::TempDir, tempfile::TempDir, Connectors) {
    let (home, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let c = Connectors::with_search_path(home.path().into(), bin.path().into());
    (home, bin, c)
}

#[tokio::test]
async fn probes_what_the_cli_says() {
    let (_home, bin, c) = setup();
    let p = c.probe(&lark(), &ConnectorProfile::default_profile(), false).await;
    assert_eq!(p.state, ConnectorCliState::NotInstalled);

    fake(bin.path(), "lark-cli", LARK);
    let p = c.probe(&lark(), &ConnectorProfile::default_profile(), false).await;
    assert_eq!((p.state, p.version.as_deref()), (ConnectorCliState::NeedsInit, Some("1.0.96")));
    std::fs::write(bin.path().join("inited-default"), "").unwrap();
    assert_eq!(
        c.probe(&lark(), &ConnectorProfile::default_profile(), false).await.state,
        ConnectorCliState::NeedsLogin
    );

    std::fs::write(bin.path().join("logged-default"), "").unwrap();
    let p = c.probe(&lark(), &ConnectorProfile::default_profile(), false).await;
    assert_eq!((p.state, p.account.as_deref()), (ConnectorCliState::Ready, Some("姜维川")));
    assert_eq!(p.refresh_expires_at.as_deref(), Some("2026-12-01T10:00:00+08:00"));
    // The user's token is valid as is: reading who it is leaves it untouched.
    assert_eq!(p.feishu_user_id.as_deref(), Some("a1b2c3d4"));
    let calls = std::fs::read_to_string(bin.path().join("calls")).unwrap();
    assert!(calls.contains("auth status --json\n") && !calls.contains("--profile"), "{calls}");

    // A member's profile is asked for by name.
    assert_eq!(c.probe(&lark(), &member(), false).await.state, ConnectorCliState::NeedsInit);
    let calls = std::fs::read_to_string(bin.path().join("calls")).unwrap();
    assert!(calls.contains(&format!("auth status --json --profile {MEMBER}")), "{calls}");
}

#[tokio::test]
async fn connects_a_member_binding_an_app_then_logging_in() {
    let (home, bin, c) = setup();
    fake(bin.path(), "lark-cli", LARK);
    let (out, mut rx) = Outbox::channel();
    let mut connect = cmd("r1", ConnectorsAction::Connect, lark(), member());
    connect.domains = vec!["calendar".into(), "mail".into()];
    c.cmd(connect, &out);

    let DaemonToServer::ConnectorsAuth(init) = next_event(&mut rx).await else { panic!() };
    assert_eq!(
        (init.step, init.url.as_str()),
        (ConnectorsAuthStep::Init, "https://open.feishu.cn/page/cli?user_code=AAAA-BBBB&from=cli")
    );
    std::fs::write(bin.path().join("approve"), "").unwrap();
    let DaemonToServer::ConnectorsAuth(login) = next_event(&mut rx).await else { panic!() };
    assert_eq!((login.step, login.user_code.as_deref()), (ConnectorsAuthStep::Login, Some("ABCD-EFGH")));
    assert!(login.url.starts_with("https://accounts.feishu.cn/") && login.expires_at.is_some());

    let r = result(&mut rx).await;
    assert!(r.ok, "{:?}", r.error);
    let probe = r.probe.unwrap();
    assert_eq!((probe.state, probe.profile.as_str()), (ConnectorCliState::Ready, MEMBER));
    assert_eq!(probe.feishu_user_id.as_deref(), Some("a1b2c3d4"));
    let calls = std::fs::read_to_string(bin.path().join("calls")).unwrap();
    assert!(calls.contains(&format!("config init --new --name {MEMBER}")), "{calls}");
    assert!(
        calls.contains(&format!("auth login --no-wait --json --profile {MEMBER} --domain calendar,mail")),
        "{calls}"
    );
    assert!(calls.contains(&format!("auth login --device-code dev-1 --profile {MEMBER}")), "{calls}");

    // The member profile is remembered and reported beside the default one.
    let saved = std::fs::read_to_string(home.path().join("connectors.json")).unwrap();
    assert!(saved.contains(MEMBER), "{saved}");
    c.sync(vec![lark()], &out);
    let probes = loop {
        if let DaemonToServer::ConnectorsUpdate { probes } = next(&mut rx).await
            && probes.len() == 2
        {
            break probes;
        }
    };
    assert_eq!(probes[0].profile.as_str(), "default");
    assert_eq!((probes[1].profile.as_str(), probes[1].state), (MEMBER, ConnectorCliState::Ready));

    // Logging out forgets it.
    c.cmd(cmd("r2", ConnectorsAction::Logout, lark(), member()), &out);
    let r = loop {
        if let DaemonToServer::ConnectorsResult(r) = next(&mut rx).await {
            break r;
        }
    };
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(r.probe.unwrap().state, ConnectorCliState::NeedsLogin);
    assert!(!std::fs::read_to_string(home.path().join("connectors.json")).unwrap().contains(MEMBER));
}

#[tokio::test]
async fn cancel_stops_a_login_waiting_for_the_person() {
    let (_home, bin, c) = setup();
    fake(bin.path(), "lark-cli", LARK);
    std::fs::write(bin.path().join("inited-default"), "").unwrap();
    let (out, mut rx) = Outbox::channel();
    c.cmd(cmd("r1", ConnectorsAction::Connect, lark(), ConnectorProfile::default_profile()), &out);
    let DaemonToServer::ConnectorsAuth(login) = next_event(&mut rx).await else { panic!() };
    assert_eq!(login.step, ConnectorsAuthStep::Login);
    c.cmd(cmd("r1", ConnectorsAction::Cancel, lark(), ConnectorProfile::default_profile()), &out);
    let r = result(&mut rx).await;
    assert_eq!((r.ok, r.error.as_deref()), (false, Some("已取消连接")));
    assert_eq!(r.probe.unwrap().state, ConnectorCliState::NeedsLogin);
}

#[tokio::test]
async fn connects_meegle_by_polling() {
    let (_home, bin, c) = setup();
    fake(bin.path(), "meegle", MEEGLE);
    let (out, mut rx) = Outbox::channel();
    c.cmd(cmd("r1", ConnectorsAction::Connect, meegle(), member()), &out);
    let DaemonToServer::ConnectorsAuth(login) = next_event(&mut rx).await else { panic!() };
    assert_eq!(login.url, "https://project.feishu.cn/b/auth/mcp?usercode=XYFJJ-7WRV6");
    let r = result(&mut rx).await;
    assert!(r.ok, "{:?}", r.error);
    let probe = r.probe.unwrap();
    assert_eq!((probe.state, probe.account.as_deref()), (ConnectorCliState::Ready, Some("姜维川")));
    let calls = std::fs::read_to_string(bin.path().join("calls")).unwrap();
    let poll = format!(
        "auth login --host project.feishu.cn --device-code --phase poll --once --device-code-value dc-1 --client-id cli_x --format json --profile {MEMBER}"
    );
    assert_eq!(calls.matches(&poll).count(), 2, "{calls}");
}

#[tokio::test]
async fn installs_only_the_driver_package_and_plain_names() {
    let (_home, bin, c) = setup();
    fake(bin.path(), "lark-cli", LARK);
    let (out, mut rx) = Outbox::channel();
    let mut evil = cmd("r1", ConnectorsAction::Connect, lark(), member());
    evil.spec.npm = "evil-package".into();
    c.cmd(evil, &out);
    let r = result(&mut rx).await;
    assert!(!r.ok && r.error.unwrap().contains("@larksuite/cli"));
    let mut evil = cmd("r2", ConnectorsAction::Connect, lark(), member());
    evil.spec.connector = "../x".into();
    c.cmd(evil, &out);
    assert!(!result(&mut rx).await.ok);
    assert!(
        !bin.path().join("calls").exists()
            || !std::fs::read_to_string(bin.path().join("calls")).unwrap().contains("login")
    );
}

#[test]
fn shims_add_the_profile_and_managed_clis_go_last() {
    let (home, bin) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let real = fake(bin.path(), "lark-cli", "#!/bin/sh\necho \"real $*\"\n");
    let managed = home.path().join("tools/connectors/meegle/node_modules/.bin");
    std::fs::create_dir_all(&managed).unwrap();
    let profiles = [
        RunCliProfile { driver: ConnectorDriver::LarkCli, profile: member() },
        RunCliProfile { driver: ConnectorDriver::Meegle, profile: ConnectorProfile::default_profile() },
    ];
    let path = run_path(home.path(), "/usr/bin:/bin".as_ref(), &profiles, |d| {
        (d == ConnectorDriver::LarkCli).then(|| real.clone())
    })
    .unwrap();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    assert_eq!(dirs.len(), 4, "{dirs:?}");
    assert_eq!(dirs[1..], [PathBuf::from("/usr/bin"), PathBuf::from("/bin"), managed]);
    let out = std::process::Command::new(dirs[0].join("lark-cli")).args(["calendar", "+agenda"]).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&out.stdout), format!("real calendar +agenda --profile {MEMBER}\n"));

    // The owner's own profile needs no shim.
    let path = run_path(home.path(), "/bin".as_ref(), &profiles[1..], |_| Some(real.clone())).unwrap();
    assert_eq!(std::env::split_paths(&path).next(), Some(PathBuf::from("/bin")));
}
