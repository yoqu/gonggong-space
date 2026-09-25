//! 日志与诊断 (spec §14): machine self-checks for `gg doctor` / the desktop app, and the redacted diagnostics bundle.
use crate::config::Config;
use crate::logs::{self, redact};
use crate::protocol::{AgentInfo, PROTOCOL_VERSION};
use crate::workspace::{self, Entry, EntryKind, human_size};
use anyhow::Context;
use serde::Serialize;
use serde_json::{Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

const GIT_TIMEOUT: Duration = Duration::from_secs(20);
/// Below this, clones and agent runs start failing in odd ways.
const DISK_LOW: u64 = 5_000_000_000;
/// Tail of each log file that goes into a bundle.
const BUNDLE_LOG_MAX: usize = 4 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckKind {
    Server,
    Agent,
    Git,
    Disk,
    Eol,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Warn,
    Error,
    /// Nothing to check (e.g. no managed clone yet).
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Check {
    pub kind: CheckKind,
    pub label: &'static str,
    pub status: Status,
    pub detail: String,
}

fn check(kind: CheckKind, status: Status, detail: impl Into<String>) -> Check {
    let label = match kind {
        CheckKind::Server => "服务器连接",
        CheckKind::Agent => "Agent",
        CheckKind::Git => "git 凭据",
        CheckKind::Disk => "磁盘",
        CheckKind::Eol => "换行符",
    };
    Check { kind, label, status, detail: detail.into() }
}

/// All checks, in the page's order. Without the server, workspaces are judged from disk alone.
pub async fn run(home: &Path, config: Option<&Config>) -> Vec<Check> {
    let server = server(config).await;
    let pairs = match config {
        Some(c) if server.status == Status::Ok => workspace::fetch_pairs(c).await.unwrap_or_default(),
        _ => vec![],
    };
    let home_owned = home.to_path_buf();
    let entries = tokio::task::spawn_blocking(move || workspace::list(&home_owned, &pairs)).await.unwrap_or_default();
    vec![
        server,
        agents(&crate::agents::detect(&crate::local::LocalSettings::load(home).unwrap_or_default())),
        git_credentials(&entries).await,
        disk(home, &entries),
        eol(&entries).await,
    ]
}

/// Reaches the server over the pinned transport with the machine token (the same TLS setup as the daemon WebSocket).
pub async fn server(config: Option<&Config>) -> Check {
    let Some(config) = config else {
        return check(CheckKind::Server, Status::Error, "未绑定，请先执行 gg login");
    };
    let result = async { crate::bots::Client::new(config)?.list().await }.await;
    match result {
        Err(e) => check(CheckKind::Server, Status::Error, format!("{e:#}")),
        Ok(_) if !config.server.starts_with("https:") => {
            check(CheckKind::Server, Status::Ok, "HTTP 正常 · 本机回环（未加密）")
        }
        Ok(_) if std::env::var(crate::tls::INSECURE_ENV).is_ok_and(|v| v == "1") => check(
            CheckKind::Server,
            Status::Warn,
            format!("HTTPS 正常 · 证书固定已关闭（{}=1）", crate::tls::INSECURE_ENV),
        ),
        Ok(_) => check(CheckKind::Server, Status::Ok, "WSS 正常 · 证书固定通过"),
    }
}

pub fn agents(list: &[AgentInfo]) -> Check {
    let name = |a: &AgentInfo| crate::bots::agent_label(a.kind);
    let installed: Vec<_> = list.iter().filter(|a| a.available).collect();
    if installed.is_empty() {
        return check(CheckKind::Agent, Status::Error, "未检测到 Claude Code 或 Codex");
    }
    let old: Vec<String> = installed
        .iter()
        .filter_map(|a| {
            let (v, min) = (a.version.as_deref()?, a.min_version.as_deref()?);
            crate::upgrade::is_newer(min, v).then(|| format!("{} {v} 低于 {min}", name(a)))
        })
        .collect();
    let missing: Vec<String> = list.iter().filter(|a| !a.available).map(|a| format!("{} 未安装", name(a))).collect();
    let ok: Vec<String> = installed
        .iter()
        .map(|a| a.version.as_deref().map_or_else(|| name(a).to_string(), |v| format!("{} {v}", name(a))))
        .collect();
    match (old.is_empty(), missing.is_empty()) {
        (true, true) => check(CheckKind::Agent, Status::Ok, format!("{} 可用", ok.join(" · "))),
        _ => check(CheckKind::Agent, Status::Warn, [old, missing].concat().join(" · ")),
    }
}

/// Existing managed clones (active ones first), where git credentials and settings matter.
fn clones(entries: &[Entry]) -> Vec<&Entry> {
    let mut clones: Vec<&Entry> =
        entries.iter().filter(|e| e.kind == EntryKind::Managed && crate::git::is_repo(&e.path)).collect();
    clones.sort_by_key(|e| e.deletable());
    clones
}

fn describe(e: &Entry) -> String {
    match (&e.group_name, &e.bot_name) {
        (Some(g), Some(b)) => format!("{g} × {b}"),
        _ => e.path.display().to_string(),
    }
}

fn git_cmd(dir: &Path, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args).env("GIT_TERMINAL_PROMPT", "0").kill_on_drop(true);
    if std::env::var_os("GIT_SSH_COMMAND").is_none() {
        cmd.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
    cmd
}

/// Can this machine's git reach a group remote without prompting? `git ls-remote` of one managed clone's origin.
pub async fn git_credentials(entries: &[Entry]) -> Check {
    let Some(clone) = clones(entries).into_iter().next() else {
        return check(CheckKind::Git, Status::Skipped, "本机暂无托管仓库");
    };
    let url = git_cmd(&clone.path, &["remote", "get-url", "origin"]).output().await;
    let url = url.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let via = if url.starts_with("http") {
        "HTTPS"
    } else if url.contains("://") && !url.starts_with("ssh://") || Path::new(&url).is_absolute() {
        "本地"
    } else {
        "SSH"
    };
    let run = tokio::time::timeout(GIT_TIMEOUT, git_cmd(&clone.path, &["ls-remote", "--heads", "origin"]).output());
    let where_ = describe(clone);
    match run.await {
        Err(_) => check(CheckKind::Git, Status::Error, format!("{via} · 访问远端超时 · {where_}")),
        Ok(Err(e)) => check(CheckKind::Git, Status::Error, format!("无法执行 git：{e}")),
        Ok(Ok(out)) if out.status.success() => check(CheckKind::Git, Status::Ok, format!("{via} · 可访问 · {where_}")),
        Ok(Ok(out)) => {
            let err = String::from_utf8_lossy(&out.stderr);
            let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("ls-remote 失败").trim();
            check(CheckKind::Git, Status::Error, format!("{via} · {first} · {where_}"))
        }
    }
}

/// Space the managed workspaces take and what is left on the volume holding `<home>`.
pub fn disk(home: &Path, entries: &[Entry]) -> Check {
    let used: u64 = entries.iter().filter(|e| e.kind != EntryKind::Cd).filter_map(|e| e.size).sum();
    let volume = home.ancestors().find(|p| p.exists()).unwrap_or(home);
    match fs4::available_space(volume) {
        Err(e) => check(CheckKind::Disk, Status::Warn, format!("工作区 {} · 无法读取剩余空间：{e}", human_size(used))),
        Ok(free) => {
            let status = if free < DISK_LOW { Status::Warn } else { Status::Ok };
            check(CheckKind::Disk, status, format!("工作区 {} · 剩余 {}", human_size(used), human_size(free)))
        }
    }
}

/// Managed clones must keep `core.autocrlf` off (spec §12 risk 1); the effective value includes global config.
pub async fn eol(entries: &[Entry]) -> Check {
    let clones = clones(entries);
    if clones.is_empty() {
        return check(CheckKind::Eol, Status::Skipped, "本机暂无托管仓库");
    }
    let mut on = vec![];
    for c in &clones {
        let out = git_cmd(&c.path, &["config", "--get", "core.autocrlf"]).output().await;
        let value = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_lowercase()).unwrap_or_default();
        if matches!(value.as_str(), "true" | "input") {
            on.push(format!("{}（{value}）", describe(c)));
        }
    }
    if on.is_empty() {
        check(CheckKind::Eol, Status::Ok, "core.autocrlf 已关闭")
    } else {
        check(CheckKind::Eol, Status::Warn, format!("core.autocrlf 未关闭：{} · 下次运行时自动关闭", on.join("、")))
    }
}

/// Writes `dest` (.zip): redacted recent logs, the checks, versions, and config.json / local.json without
/// credentials. Returns the entry names written.
pub fn bundle(home: &Path, config: Option<&Config>, checks: &[Check], dest: &Path) -> anyhow::Result<Vec<String>> {
    let secrets: Vec<&str> = config.map(|c| c.token.as_str()).into_iter().collect();
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    for path in logs::files(home) {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let tail = &text[text.ceil_char_boundary(text.len().saturating_sub(BUNDLE_LOG_MAX))..];
        let name = path.file_name().unwrap().to_string_lossy();
        files.push((format!("logs/{name}"), redact(tail, &secrets).into_bytes()));
    }
    files.push(("diag.json".into(), serde_json::to_vec_pretty(checks)?));
    let machine = crate::bind::machine_info();
    let versions = json!({
        "gonggong": env!("CARGO_PKG_VERSION"),
        "protocol": PROTOCOL_VERSION,
        "os": machine.os,
        "arch": machine.arch,
        "agents": crate::agents::detect(&crate::local::LocalSettings::load(home).unwrap_or_default()),
    });
    files.push(("versions.json".into(), serde_json::to_vec_pretty(&versions)?));
    if let Some(c) = config {
        files.push(("config.json".into(), scrub_json(serde_json::to_value(c)?, &secrets)?));
    }
    if let Ok(text) = std::fs::read_to_string(home.join("local.json")) {
        let value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        files.push(("local.json".into(), scrub_json(value, &secrets)?));
    }

    let file = std::fs::File::create(dest).with_context(|| format!("无法写入 {}", dest.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::try_from(chrono::Local::now().naive_local())?);
    for (name, bytes) in &files {
        zip.start_file(name.as_str(), options)?;
        zip.write_all(bytes)?;
    }
    zip.finish()?;
    Ok(files.into_iter().map(|(n, _)| n).collect())
}

/// Drops credential-looking keys, then redacts what is left by shape.
fn scrub_json(mut value: Value, secrets: &[&str]) -> anyhow::Result<Vec<u8>> {
    fn strip(v: &mut Value) {
        match v {
            Value::Object(map) => {
                map.retain(|k, _| {
                    let k = k.to_lowercase().replace(['_', '-'], "");
                    !["token", "secret", "password", "apikey", "credential"].iter().any(|s| k.contains(s))
                });
                map.values_mut().for_each(strip);
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }
    strip(&mut value);
    Ok(redact(&serde_json::to_string_pretty(&value)?, secrets).into_bytes())
}

/// Default bundle location: `~/Desktop` (else home) / `gonggong-diag-<date-time>.zip`.
pub fn default_bundle_path() -> PathBuf {
    let home =
        std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default();
    let dir = Some(home.join("Desktop")).filter(|d| d.is_dir()).unwrap_or(home);
    dir.join(format!("gonggong-diag-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::testing::{Remote, run as git};
    use crate::protocol::AgentKind;
    use crate::workspace::EntryState;
    use std::io::Read;

    fn managed(path: PathBuf, state: EntryState) -> Entry {
        Entry {
            group_id: "g".into(),
            group_name: Some("支付服务重构".into()),
            dm: false,
            bot_id: "b".into(),
            bot_name: Some("小王的 Claude".into()),
            kind: EntryKind::Managed,
            path,
            size: Some(1_000_000),
            state,
        }
    }

    #[tokio::test]
    async fn eol_flags_clones_with_autocrlf_on() {
        let r = Remote::new();
        let a = r.clone_to("a");
        let b = r.clone_to("b");
        git(&a, &["config", "core.autocrlf", "false"]);
        let entries = vec![managed(a, EntryState::Idle), managed(b.clone(), EntryState::Idle)];
        assert_eq!(eol(&entries).await.status, Status::Ok);
        git(&b, &["config", "core.autocrlf", "true"]);
        let c = eol(&entries).await;
        assert_eq!((c.status, c.label), (Status::Warn, "换行符"));
        assert!(c.detail.contains("支付服务重构 × 小王的 Claude（true）"), "{}", c.detail);
        assert_eq!(eol(&[]).await.status, Status::Skipped);
    }

    #[tokio::test]
    async fn git_credentials_ls_remotes_a_managed_clone() {
        let r = Remote::new();
        let a = r.clone_to("a");
        let ok = git_credentials(&[managed(a.clone(), EntryState::Idle)]).await;
        assert_eq!(ok.status, Status::Ok, "{}", ok.detail);
        assert!(ok.detail.starts_with("本地 · 可访问"), "{}", ok.detail);

        git(&a, &["remote", "set-url", "origin", &r.root.path().join("gone.git").to_string_lossy()]);
        let bad = git_credentials(&[managed(a, EntryState::Idle)]).await;
        assert_eq!(bad.status, Status::Error);

        let plain = tempfile::tempdir().unwrap();
        let none = git_credentials(&[managed(plain.path().into(), EntryState::Idle)]).await;
        assert_eq!(none.status, Status::Skipped);
    }

    #[test]
    fn disk_sums_managed_workspaces_and_reads_free_space() {
        let home = tempfile::tempdir().unwrap();
        let mut cd = managed(home.path().into(), EntryState::Idle);
        cd.kind = EntryKind::Cd;
        cd.size = Some(9_000_000_000);
        let c = disk(&home.path().join("not-yet"), &[managed(home.path().into(), EntryState::Removed), cd]);
        assert!(c.detail.starts_with("工作区 1.0 MB · 剩余 "), "{}", c.detail);
        assert_ne!(c.status, Status::Error);
    }

    #[test]
    fn agent_check_reports_missing_and_outdated_clis() {
        let info = |kind, version: Option<&str>| AgentInfo {
            kind,
            available: version.is_some(),
            version: version.map(Into::into),
            path: None,
            min_version: Some(crate::agents::min_version(kind).into()),
        };
        let both = agents(&[info(AgentKind::Claude, Some("2.1.3")), info(AgentKind::Codex, Some("0.46.0"))]);
        assert_eq!((both.status, both.detail.as_str()), (Status::Ok, "Claude Code 2.1.3 · Codex 0.46.0 可用"));
        let partial = agents(&[info(AgentKind::Claude, Some("1.0.0")), info(AgentKind::Codex, None)]);
        assert_eq!(partial.status, Status::Warn);
        assert_eq!(partial.detail, "Claude Code 1.0.0 低于 2.0.0 · Codex 未安装");
        assert_eq!(agents(&[info(AgentKind::Claude, None)]).status, Status::Error);
    }

    #[tokio::test]
    async fn server_check_needs_a_binding() {
        let c = server(None).await;
        assert_eq!((c.status, c.label), (Status::Error, "服务器连接"));
    }

    #[test]
    fn the_bundle_holds_redacted_logs_checks_versions_and_config_without_the_token() {
        let home = tempfile::tempdir().unwrap();
        let token = "mt_Zq3v9Kx0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX";
        std::fs::create_dir_all(logs::dir(home.path())).unwrap();
        std::fs::write(
            logs::dir(home.path()).join("daemon.2026-09-23.log"),
            format!("2026-09-23 10:00:00 INFO  service connected with {token}\n2026-09-23 10:00:01 WARN  git     https://bob:pw@git.corp/x\n"),
        )
        .unwrap();
        std::fs::write(
            home.path().join("local.json"),
            r#"{"bots":{"b1":{"model":"opus","approval":"ask"}},"githubToken":"ghp_abcdefghijklmnopqrstuvwxyz","note":"password=hunter22"}"#,
        )
        .unwrap();
        let config = Config {
            server: "https://gonggong.corp".into(),
            token: token.into(),
            machine_id: "m1".into(),
            owner_name: "王磊".into(),
            cert_sha256: Some("AB:CD".into()),
        };
        let checks = vec![check(CheckKind::Disk, Status::Ok, "工作区 1.8 GB · 剩余 212 GB")];
        let dest = home.path().join("diag.zip");
        let names = bundle(home.path(), Some(&config), &checks, &dest).unwrap();
        assert_eq!(names, ["logs/daemon.2026-09-23.log", "diag.json", "versions.json", "config.json", "local.json"]);

        let mut zip = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        let mut read = |name: &str| {
            let mut s = String::new();
            zip.by_name(name).unwrap().read_to_string(&mut s).unwrap();
            s
        };
        let all: String = names.iter().map(|n| read(n)).collect();
        for leaked in [token, "bob:pw", "ghp_abc", "hunter22"] {
            assert!(!all.contains(leaked), "{leaked} leaked");
        }
        assert!(read("logs/daemon.2026-09-23.log").contains("WARN  git     https://[REDACTED]@git.corp/x"));
        let cfg: Value = serde_json::from_str(&read("config.json")).unwrap();
        assert_eq!(
            cfg,
            json!({"server": "https://gonggong.corp", "machineId": "m1", "ownerName": "王磊", "certSha256": "AB:CD"})
        );
        let local: Value = serde_json::from_str(&read("local.json")).unwrap();
        assert_eq!(local["bots"]["b1"]["model"], "opus");
        assert!(local.get("githubToken").is_none());
        let diag: Value = serde_json::from_str(&read("diag.json")).unwrap();
        assert_eq!(
            diag[0],
            json!({"kind": "disk", "label": "磁盘", "status": "ok", "detail": "工作区 1.8 GB · 剩余 212 GB"})
        );
        let versions: Value = serde_json::from_str(&read("versions.json")).unwrap();
        assert_eq!(versions["gonggong"], env!("CARGO_PKG_VERSION"));
    }
}
