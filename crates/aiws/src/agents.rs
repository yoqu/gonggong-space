use crate::local::LocalSettings;
use crate::protocol::{AgentInfo, AgentKind};
use std::path::{Path, PathBuf};
use std::process::Command;

const EXTRA_DIRS: &[&str] = &["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "~/.npm-global/bin"];

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
    let home = std::env::var("HOME").unwrap_or_default();
    let exe = if cfg!(windows) { format!("{bin}.cmd") } else { bin.to_string() };
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(EXTRA_DIRS.iter().map(|d| PathBuf::from(d.replacen('~', &home, 1))))
        .flat_map(|dir| [dir.join(bin), dir.join(&exe)])
        .find(|p| p.is_file())
}

/// First semver-looking token of `<bin> --version`, e.g. "codex-cli 0.156.1" → "0.156.1".
fn version(path: &Path) -> Option<String> {
    let out = Command::new(path).arg("--version").output().ok()?;
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

pub fn parse_version(s: &str) -> Option<String> {
    s.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string())
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn parses_cli_version_lines() {
        assert_eq!(parse_version("2.1.280 (Claude Code)"), Some("2.1.280".into()));
        assert_eq!(parse_version("codex-cli 0.156.1"), Some("0.156.1".into()));
        assert_eq!(parse_version("no version here"), None);
    }
}
