use crate::engine::ADAPTERS;
use crate::local::{LocalSettings, load_catalogs};
use crate::protocol::{AgentInfo, AgentKind};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn binary(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
    }
}

/// Oldest CLI the pinned ACP adapter (engine::ADAPTERS) supports; older ones get a warning on the bot.
pub fn min_version(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "2.0.0",
        AgentKind::Codex => "0.40.0",
    }
}

/// Detects installed agent CLIs (the owner's configured paths, else PATH and common install dirs), with the catalog
/// probed for the same builds.
pub fn detect(home: &Path, local: &LocalSettings) -> Vec<AgentInfo> {
    let cached = load_catalogs(home);
    [AgentKind::Claude, AgentKind::Codex]
        .into_iter()
        .map(|kind| {
            let mut info = detect_one(home, kind, local);
            let key = catalog_key(kind, info.version.as_deref());
            info.catalog = cached.get(&kind).filter(|c| info.available && c.key == key).map(|c| c.catalog.clone());
            info
        })
        .collect()
}

/// The CLI and adapter builds a catalog is probed from: upgrading either may change what is offered.
pub fn catalog_key(kind: AgentKind, version: Option<&str>) -> String {
    let adapter = ADAPTERS.iter().find(|(k, ..)| *k == kind).map_or("", |(.., v)| v);
    format!("{}+{adapter}", version.unwrap_or("?"))
}

fn detect_one(home: &Path, kind: AgentKind, local: &LocalSettings) -> AgentInfo {
    let path = locate(home, kind, local);
    let available = path.as_deref().is_some_and(Path::is_file);
    let tool = match kind {
        AgentKind::Claude => crate::tools::ToolKind::Claude,
        AgentKind::Codex => crate::tools::ToolKind::Codex,
    };
    AgentInfo {
        kind,
        available,
        version: path.as_deref().filter(|_| available).and_then(|p| version(home, p)),
        managed: path.as_deref().filter(|_| available).is_some_and(|p| crate::tools::is_managed(home, p)),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        min_version: Some(min_version(kind).into()),
        catalog: None,
        latest: crate::tools::cached_latest(home, tool),
    }
}

/// The agent CLI to run: the configured path (even if it no longer exists, so the error names it), else the
/// Gonggong-managed install, else a search.
pub fn locate(home: &Path, kind: AgentKind, local: &LocalSettings) -> Option<PathBuf> {
    let managed =
        || file_names(binary(kind)).into_iter().map(|n| crate::tools::tools_bin(home).join(n)).find(|p| p.is_file());
    local.agent(kind).path.map(PathBuf::from).or_else(managed).or_else(|| find(binary(kind)))
}

pub fn find(bin: &str) -> Option<PathBuf> {
    let names = file_names(bin);
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(extra_dirs())
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

/// Windows can only run `.exe` files and (via cmd.exe) the `.cmd` shims npm installs; the extensionless file npm
/// puts next to them is a sh script.
pub(crate) fn file_names(bin: &str) -> Vec<String> {
    if cfg!(windows) { vec![format!("{bin}.exe"), format!("{bin}.cmd")] } else { vec![bin.into()] }
}

/// Common install dirs missing from the PATH of GUI apps and services.
fn extra_dirs() -> Vec<PathBuf> {
    let home = crate::config::user_home();
    let mut dirs = vec![home.join(".local/bin")];
    if cfg!(windows) {
        dirs.extend(std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("npm")));
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    dirs.push(home.join(".npm-global/bin"));
    dirs
}

const PATH_MARK: &str = "__GONGGONG_PATH__";

/// PATH as the user's interactive login shell builds it (nvm, volta, asdf…). Apps opened from Finder/Dock only get
/// launchd's minimal PATH, so neither the agent CLIs nor the `node` their shebang needs would be found.
#[cfg(unix)]
pub fn login_shell_path() -> Option<String> {
    use std::process::Stdio;
    use std::time::Duration;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let script = format!("printf '{PATH_MARK}%s{PATH_MARK}' \"$PATH\"");
    let child = Command::new(shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || tx.send(child.wait_with_output()));
    // A broken rc file must not hang startup.
    let out = rx.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    marked_path(&String::from_utf8_lossy(&out.stdout))
}

/// The PATH between the markers, ignoring whatever the rc files print around it.
fn marked_path(out: &str) -> Option<String> {
    let rest = &out[out.find(PATH_MARK)? + PATH_MARK.len()..];
    Some(rest[..rest.find(PATH_MARK)?].to_string()).filter(|p| !p.is_empty())
}

/// First semver-looking token of `<bin> --version`, e.g. "codex-cli 0.156.1" → "0.156.1". npm installs the CLIs as
/// node scripts, so the managed Node goes first on PATH.
fn version(home: &Path, path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    if let Some(bin) = crate::tools::runtime_bin(home) {
        cmd.env("PATH", crate::tools::prepend_path(&bin));
    }
    let out = cmd.arg("--version").output().ok()?;
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

/// 登录 state as the agent CLI reports it (`claude auth status`, `codex login status`); `None` if it cannot tell.
pub fn login_status(kind: AgentKind, cli: &Path) -> Option<String> {
    let args = match kind {
        AgentKind::Claude => ["auth", "status"],
        AgentKind::Codex => ["login", "status"],
    };
    let out = Command::new(cli).args(args).output().ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    login_label(kind, &text)
}

pub fn login_label(kind: AgentKind, out: &str) -> Option<String> {
    match kind {
        AgentKind::Claude => {
            let v: serde_json::Value = serde_json::from_str(out.trim()).ok()?;
            if !v["loggedIn"].as_bool()? {
                return Some("未登录".into());
            }
            let how = match v["subscriptionType"].as_str() {
                Some(plan) => {
                    let mut c = plan.chars();
                    format!(
                        "Claude {}",
                        c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default()
                    )
                }
                None => v["authMethod"].as_str().unwrap_or("未知方式").to_string(),
            };
            Some(format!("已登录 · {how}"))
        }
        AgentKind::Codex => {
            let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
            if line.starts_with("Not logged in") {
                return Some("未登录".into());
            }
            let how = line.strip_prefix("Logged in using ")?;
            Some(format!("已登录 · {}", how.trim_start_matches("an ").trim_start_matches("a ")))
        }
    }
}

pub fn parse_version(s: &str) -> Option<String> {
    s.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string())
}

#[cfg(test)]
mod tests {
    use super::{file_names, marked_path, parse_version};

    #[test]
    fn extracts_the_path_from_noisy_shell_output() {
        let out = "Welcome!\n__GONGGONG_PATH__/a/bin:/usr/bin__GONGGONG_PATH__\nbye";
        assert_eq!(marked_path(out).as_deref(), Some("/a/bin:/usr/bin"));
        assert_eq!(marked_path("__GONGGONG_PATH____GONGGONG_PATH__"), None);
        assert_eq!(marked_path("no marker"), None);
    }

    #[test]
    fn labels_the_login_state() {
        use super::login_label;
        use crate::protocol::AgentKind::{Claude, Codex};
        let max = r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}"#;
        assert_eq!(login_label(Claude, max).as_deref(), Some("已登录 · Claude Max"));
        let key = r#"{"loggedIn":true,"authMethod":"api_key"}"#;
        assert_eq!(login_label(Claude, key).as_deref(), Some("已登录 · api_key"));
        assert_eq!(login_label(Claude, r#"{"loggedIn":false}"#).as_deref(), Some("未登录"));
        assert_eq!(login_label(Claude, "command not found"), None);
        assert_eq!(login_label(Codex, "Logged in using ChatGPT\n").as_deref(), Some("已登录 · ChatGPT"));
        assert_eq!(
            login_label(Codex, "Logged in using an API key - sk-***").as_deref(),
            Some("已登录 · API key - sk-***")
        );
        assert_eq!(login_label(Codex, "Not logged in\n").as_deref(), Some("未登录"));
        assert_eq!(login_label(Codex, "error: unknown"), None);
    }

    #[test]
    fn parses_cli_version_lines() {
        assert_eq!(parse_version("2.1.280 (Claude Code)"), Some("2.1.280".into()));
        assert_eq!(parse_version("codex-cli 0.156.1"), Some("0.156.1".into()));
        assert_eq!(parse_version("no version here"), None);
    }

    #[cfg(unix)]
    #[test]
    fn detection_carries_the_catalog_probed_for_the_same_builds() {
        use super::{catalog_key, detect};
        use crate::local::{AgentSettings, CachedCatalog, LocalSettings, save_catalog};
        use crate::protocol::{AgentCatalog, AgentKind};
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let cli = home.path().join("claude");
        std::fs::write(&cli, "#!/bin/sh\necho '2.1.4 (Claude Code)'\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut local = LocalSettings::default();
        local.agents.insert(AgentKind::Claude, AgentSettings { path: Some(cli.to_string_lossy().into()) });
        let catalog = AgentCatalog { current: Some("opus".into()), ..Default::default() };
        let claude = |home| detect(home, &local).into_iter().find(|a| a.kind == AgentKind::Claude).unwrap();

        assert_eq!(claude(home.path()).catalog, None);
        let stale = CachedCatalog { key: catalog_key(AgentKind::Claude, Some("2.0.0")), catalog: catalog.clone() };
        save_catalog(home.path(), AgentKind::Claude, stale).unwrap();
        assert_eq!(claude(home.path()).catalog, None);
        let fresh = CachedCatalog { key: catalog_key(AgentKind::Claude, Some("2.1.4")), catalog: catalog.clone() };
        save_catalog(home.path(), AgentKind::Claude, fresh).unwrap();
        assert_eq!(claude(home.path()).catalog, Some(catalog));
    }

    #[test]
    fn prefers_the_configured_path_then_the_managed_install_then_the_search() {
        use super::locate;
        use crate::local::{AgentSettings, LocalSettings};
        use crate::protocol::AgentKind;
        let home = tempfile::tempdir().unwrap();
        let bin = crate::tools::tools_bin(home.path());
        std::fs::create_dir_all(&bin).unwrap();
        for name in file_names("codex") {
            std::fs::write(bin.join(name), "").unwrap();
        }
        let managed = bin.join(&file_names("codex")[0]);
        let mut local = LocalSettings::default();
        assert_eq!(locate(home.path(), AgentKind::Codex, &local), Some(managed));
        let manual = std::env::current_exe().unwrap();
        local.agents.insert(AgentKind::Codex, AgentSettings { path: Some(manual.to_string_lossy().into()) });
        assert_eq!(locate(home.path(), AgentKind::Codex, &local), Some(manual));
    }

    #[test]
    fn windows_runs_exe_or_npm_cmd_shims_never_the_extensionless_sh_script() {
        let want: Vec<String> =
            if cfg!(windows) { vec!["node.exe".into(), "node.cmd".into()] } else { vec!["node".into()] };
        assert_eq!(file_names("node"), want);
    }
}
