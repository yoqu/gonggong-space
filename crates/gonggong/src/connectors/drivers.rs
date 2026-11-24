//! What each built-in driver runs and how its output reads (verified on lark-cli 1.0.96 and meegle 1.0.27).
use crate::protocol::{ConnectorCliState, ConnectorDriver, ConnectorProfile};
use serde_json::Value;

pub const MEEGLE_HOST: &str = "project.feishu.cn";

/// The npm package behind each driver: the server's `spec.npm` must name it, nothing else gets installed.
pub fn npm_package(driver: ConnectorDriver) -> &'static str {
    match driver {
        ConnectorDriver::LarkCli => "@larksuite/cli",
        ConnectorDriver::Meegle => "@lark-project/meegle",
    }
}

/// `args` for `profile`: the default one is the CLI's own current profile, so it takes no flag.
pub fn with_profile(args: &[&str], profile: &ConnectorProfile) -> Vec<String> {
    let mut v: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    if !profile.is_default() {
        v.extend(["--profile".into(), profile.to_string()]);
    }
    v
}

pub fn status_args(driver: ConnectorDriver, profile: &ConnectorProfile) -> Vec<String> {
    match driver {
        ConnectorDriver::LarkCli => with_profile(&["auth", "status", "--json"], profile),
        ConnectorDriver::Meegle => with_profile(&["auth", "status", "--format", "json"], profile),
    }
}

/// A light call as the user: it reads who they are and, when the access token is due, refreshes it.
pub fn whoami_args(driver: ConnectorDriver, profile: &ConnectorProfile) -> Vec<String> {
    match driver {
        ConnectorDriver::LarkCli => {
            with_profile(&["api", "GET", "/open-apis/authen/v1/user_info", "--as", "user"], profile)
        }
        ConnectorDriver::Meegle => with_profile(&["user", "me", "--format", "json"], profile),
    }
}

pub fn logout_args(profile: &ConnectorProfile) -> Vec<String> {
    with_profile(&["auth", "logout"], profile)
}

pub fn lark_init_args(profile: &ConnectorProfile) -> Vec<String> {
    let mut v = vec!["config".to_string(), "init".into(), "--new".into()];
    if !profile.is_default() {
        v.extend(["--name".into(), profile.to_string()]);
    }
    v
}

pub fn lark_login_args(profile: &ConnectorProfile, domains: &[String]) -> Vec<String> {
    let mut v = with_profile(&["auth", "login", "--no-wait", "--json"], profile);
    if domains.is_empty() {
        v.push("--recommend".into());
    } else {
        v.extend(["--domain".into(), domains.join(",")]);
    }
    v
}

pub fn lark_wait_args(profile: &ConnectorProfile, device_code: &str) -> Vec<String> {
    with_profile(&["auth", "login", "--device-code", device_code], profile)
}

pub fn meegle_init_args(profile: &ConnectorProfile) -> Vec<String> {
    with_profile(
        &["auth", "login", "--host", MEEGLE_HOST, "--device-code", "--phase", "init", "--format", "json"],
        profile,
    )
}

pub fn meegle_poll_args(profile: &ConnectorProfile, device_code: &str, client_id: &str) -> Vec<String> {
    with_profile(
        &[
            "auth",
            "login",
            "--host",
            MEEGLE_HOST,
            "--device-code",
            "--phase",
            "poll",
            "--once",
            "--device-code-value",
            device_code,
            "--client-id",
            client_id,
            "--format",
            "json",
        ],
        profile,
    )
}

/// What `auth status` told.
#[derive(Debug, Default, PartialEq)]
pub struct Status {
    pub state: Option<ConnectorCliState>,
    pub account: Option<String>,
    /// lark-cli's open_id: user ids read before are kept per account.
    pub account_id: Option<String>,
    pub expires_at: Option<String>,
    pub refresh_expires_at: Option<String>,
    /// The user's token is valid as is: reading the user leaves it untouched.
    pub fresh: bool,
    pub detail: Option<String>,
}

/// The first JSON object in a CLI's output (some print a notice line before it).
pub fn json_of(out: &str) -> Option<Value> {
    let start = out.find('{')?;
    serde_json::Deserializer::from_str(&out[start..]).into_iter::<Value>().next()?.ok().filter(Value::is_object)
}

fn text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

/// `lark-cli auth status --json`: `identities.user.status` is `ready` / `needs_refresh` when logged in (the latter
/// refreshes on the next call), `missing` when not; `error.subtype = not_configured` when no app is bound to the
/// profile (or the profile does not exist).
pub fn lark_status(out: &str) -> Status {
    let Some(v) = json_of(out) else { return Status::default() };
    if v["ok"] == Value::Bool(false) {
        let e = &v["error"];
        if e["subtype"] == "not_configured" {
            return Status { state: Some(ConnectorCliState::NeedsInit), ..Status::default() };
        }
        return Status {
            state: Some(ConnectorCliState::Error),
            detail: text(&e["message"]).or_else(|| text(&e["type"])),
            ..Status::default()
        };
    }
    let user = &v["identities"]["user"];
    let status = user["status"].as_str().unwrap_or_default();
    let (state, detail) = match status {
        "ready" | "needs_refresh" => (ConnectorCliState::Ready, None),
        "error" => (ConnectorCliState::Error, text(&user["message"])),
        "not_configured" => (ConnectorCliState::NeedsInit, None),
        _ => (ConnectorCliState::NeedsLogin, None),
    };
    let ready = state == ConnectorCliState::Ready;
    Status {
        state: Some(state),
        account: text(&user["userName"]).filter(|_| ready),
        account_id: text(&user["openId"]).filter(|_| ready),
        expires_at: text(&user["expiresAt"]).filter(|_| ready),
        refresh_expires_at: text(&user["refreshExpiresAt"]).filter(|_| ready),
        fresh: status == "ready",
        detail,
    }
}

/// `meegle auth status --format json`: `{authenticated, expires_in_minutes, host}` (exit 1 and a `reason` when not).
pub fn meegle_status(out: &str, now: chrono::DateTime<chrono::Utc>) -> Status {
    let Some(v) = json_of(out) else { return Status::default() };
    let Some(authenticated) = v["authenticated"].as_bool() else { return Status::default() };
    if !authenticated {
        return Status { state: Some(ConnectorCliState::NeedsLogin), ..Status::default() };
    }
    let minutes = v["expires_in_minutes"].as_i64();
    let expires_at =
        minutes.map(|m| (now + chrono::Duration::minutes(m)).to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    // Well before it lapses, a call as the user does not need to refresh it.
    let fresh = minutes.is_some_and(|m| m > 5);
    Status { state: Some(ConnectorCliState::Ready), expires_at, fresh, ..Status::default() }
}

/// The user's display name and tenant-wide user_id from [`whoami_args`]: lark-cli prints the API's `data` (user_id
/// only when the app was granted it), meegle `user me` the user (`name_cn`).
pub fn whoami(driver: ConnectorDriver, out: &str) -> (Option<String>, Option<String>) {
    let Some(v) = json_of(out) else { return (None, None) };
    match driver {
        ConnectorDriver::LarkCli => {
            let d = if v["data"].is_object() { &v["data"] } else { &v };
            (text(&d["name"]), text(&d["user_id"]))
        }
        ConnectorDriver::Meegle => (text(&v["name_cn"]).or_else(|| text(&v["name_en"])), None),
    }
}

/// A device login to show the person: lark-cli `auth login --no-wait --json` and meegle `--phase init`.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceLogin {
    pub url: String,
    pub device_code: String,
    pub user_code: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<u64>,
    pub client_id: Option<String>,
}

pub fn device_login(out: &str) -> Option<DeviceLogin> {
    let v = json_of(out)?;
    let d = if v["data"].is_object() { &v["data"] } else { &v };
    let url = ["verification_uri_complete", "verification_url", "verification_uri"]
        .iter()
        .find_map(|k| text(&d[k]))
        .filter(|u| u.starts_with("https://"))?;
    Some(DeviceLogin {
        url,
        device_code: text(&d["device_code"]).filter(|c| !c.starts_with('-'))?,
        user_code: text(&d["user_code"]),
        expires_in: d["expires_in"].as_i64(),
        interval: d["interval"].as_u64(),
        client_id: text(&d["client_id"]).filter(|c| !c.starts_with('-')),
    })
}

/// meegle `--phase poll --once`: still waiting for the person (`authorization_pending` / `slow_down`).
pub fn meegle_pending(out: &str) -> bool {
    json_of(out).is_some_and(|v| matches!(v["status"].as_str(), Some("authorization_pending" | "slow_down")))
}

/// meegle `--phase poll --once` status other than pending (`expired_token`, `access_denied`…), when it said one.
pub fn meegle_poll_status(out: &str) -> Option<String> {
    json_of(out).and_then(|v| text(&v["status"]))
}

/// The link `lark-cli config init --new` prints (after a QR code) for creating the app.
pub fn init_url(line: &str) -> Option<String> {
    let start = line.find("https://")?;
    let url = line[start..].split_whitespace().next()?;
    url::Url::parse(url).ok().map(|_| url.to_string())
}

/// QR code rows are noise in a progress log.
pub fn is_qr_row(line: &str) -> bool {
    line.chars().any(|c| matches!(c, '█' | '▀' | '▄'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member() -> ConnectorProfile {
        ConnectorProfile::try_from("gg-11111111-2222-4333-8444-555555555555".to_string()).unwrap()
    }

    #[test]
    fn profile_flag_only_for_members() {
        let d = ConnectorProfile::default_profile();
        assert_eq!(status_args(ConnectorDriver::LarkCli, &d), ["auth", "status", "--json"]);
        assert_eq!(
            lark_login_args(&member(), &["calendar".into(), "mail".into()]),
            [
                "auth",
                "login",
                "--no-wait",
                "--json",
                "--profile",
                "gg-11111111-2222-4333-8444-555555555555",
                "--domain",
                "calendar,mail"
            ]
        );
        assert_eq!(lark_login_args(&d, &[]).last().unwrap(), "--recommend");
        assert_eq!(lark_init_args(&d), ["config", "init", "--new"]);
        assert_eq!(lark_init_args(&member())[3..], ["--name".to_string(), member().to_string()]);
    }

    #[test]
    fn reads_lark_status() {
        let ready = r#"{"identities":{"user":{"status":"needs_refresh","userName":"姜维川","openId":"ou_1",
            "expiresAt":"2026-11-23T19:49:43+08:00","refreshExpiresAt":"2026-11-30T17:49:43+08:00"}},"identity":"user"}"#;
        let s = lark_status(ready);
        assert_eq!(s.state, Some(ConnectorCliState::Ready));
        assert_eq!(s.account.as_deref(), Some("姜维川"));
        assert_eq!(s.refresh_expires_at.as_deref(), Some("2026-11-30T17:49:43+08:00"));
        assert!(!s.fresh);
        let missing =
            r#"{"identities":{"user":{"status":"missing","message":"User identity: missing (no user logged in)"}}}"#;
        assert_eq!(lark_status(missing).state, Some(ConnectorCliState::NeedsLogin));
        let none = r#"{"ok":false,"error":{"type":"config","subtype":"not_configured","message":"not configured"}}"#;
        assert_eq!(lark_status(none).state, Some(ConnectorCliState::NeedsInit));
        assert_eq!(lark_status("garbage").state, None);
    }

    #[test]
    fn reads_meegle_status() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-24T10:00:00Z").unwrap().to_utc();
        let s = meegle_status(r#"{"authenticated":true,"expires_in_minutes":96,"host":"project.feishu.cn"}"#, now);
        assert_eq!((s.state, s.expires_at.as_deref()), (Some(ConnectorCliState::Ready), Some("2026-11-24T11:36:00Z")));
        let out = r#"{"authenticated":false,"host":null,"reason":"no local token"}"#;
        assert_eq!(meegle_status(out, now).state, Some(ConnectorCliState::NeedsLogin));
    }

    #[test]
    fn reads_device_logins() {
        let meegle = r#"{"client_id":"cli_x","device_code":"158c","expires_in":1800,"interval":5,"user_code":"XYFJJ-7WRV6",
            "verification_uri":"https://project.feishu.cn/b/auth/mcp",
            "verification_uri_complete":"https://project.feishu.cn/b/auth/mcp?usercode=XYFJJ-7WRV6"}"#;
        let d = device_login(meegle).unwrap();
        assert_eq!(d.url, "https://project.feishu.cn/b/auth/mcp?usercode=XYFJJ-7WRV6");
        assert_eq!((d.client_id.as_deref(), d.interval), (Some("cli_x"), Some(5)));
        let lark = r#"{"verification_url":"https://accounts.feishu.cn/x","device_code":"dc","user_code":"AB","expires_in":600}"#;
        assert_eq!(device_login(lark).unwrap().device_code, "dc");
        assert!(device_login(r#"{"verification_url":"http://evil","device_code":"dc"}"#).is_none());
        assert!(meegle_pending(r#"{"status":"authorization_pending"}"#));
        assert!(!meegle_pending(r#"{"status":"expired_token"}"#));
    }

    #[test]
    fn finds_the_init_link() {
        let line = "  https://open.feishu.cn/page/cli?user_code=R3KW-8B6H&lpv=1.0.96&from=cli";
        assert_eq!(init_url(line).unwrap(), "https://open.feishu.cn/page/cli?user_code=R3KW-8B6H&lpv=1.0.96&from=cli");
        assert!(is_qr_row("████ ▄▄▄▄▄ ████"));
        assert_eq!(init_url("等待配置应用..."), None);
    }

    #[test]
    fn reads_whoami() {
        let lark = r#"{"data":{"name":"姜维川","open_id":"ou_1","user_id":"a1b2"}}"#;
        assert_eq!(whoami(ConnectorDriver::LarkCli, lark), (Some("姜维川".into()), Some("a1b2".into())));
        let meegle = r#"{"name_cn":"姜维川","user_key":"7386"}"#;
        assert_eq!(whoami(ConnectorDriver::Meegle, meegle), (Some("姜维川".into()), None));
    }
}
