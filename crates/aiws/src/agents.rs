use crate::local::LocalSettings;
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

/// Detects installed agent CLIs: the owner's configured paths, else PATH and common install dirs.
pub fn detect(local: &LocalSettings) -> Vec<AgentInfo> {
    [AgentKind::Claude, AgentKind::Codex].into_iter().map(|kind| detect_one(kind, local)).collect()
}

fn detect_one(kind: AgentKind, local: &LocalSettings) -> AgentInfo {
    let path = locate(kind, local);
    let available = path.as_deref().is_some_and(Path::is_file);
    AgentInfo {
        kind,
        available,
        version: path.as_deref().filter(|_| available).and_then(version),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        min_version: Some(min_version(kind).into()),
    }
}

/// The agent CLI to run: the configured path (even if it no longer exists, so the error names it), else a search.
pub fn locate(kind: AgentKind, local: &LocalSettings) -> Option<PathBuf> {
    local.agent(kind).path.map(PathBuf::from).or_else(|| find(binary(kind)))
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
fn file_names(bin: &str) -> Vec<String> {
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

/// First semver-looking token of `<bin> --version`, e.g. "codex-cli 0.156.1" → "0.156.1".
fn version(path: &Path) -> Option<String> {
    let out = Command::new(path).arg("--version").output().ok()?;
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
    use super::{file_names, parse_version};

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

    #[test]
    fn windows_runs_exe_or_npm_cmd_shims_never_the_extensionless_sh_script() {
        let want: Vec<String> = if cfg!(windows) { vec!["node.exe".into(), "node.cmd".into()] } else { vec!["node".into()] };
        assert_eq!(file_names("node"), want);
    }
}
