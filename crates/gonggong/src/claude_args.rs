//! Extra Claude Code command-line arguments of the official login (官方登录设置 · 命令行参数): one per line, passed to
//! the CLI through the adapter's `extraArgs`. `--settings` is not passed on (which of two `--settings` wins is not
//! defined): its file or inline JSON is merged under the settings file 共工 writes, see [`ClaudeArgs::settings`].
use crate::config::user_home;
use crate::t;
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Flags 共工 or the adapter set themselves: permissions, model, session, MCP, plugins, directories, prompts, I/O.
const MANAGED: &[&str] = &[
    "permission-mode",
    "dangerously-skip-permissions",
    "allow-dangerously-skip-permissions",
    "permission-prompt-tool",
    "model",
    "fallback-model",
    "resume",
    "continue",
    "session-id",
    "fork-session",
    "mcp-config",
    "strict-mcp-config",
    "plugin-dir",
    "add-dir",
    "setting-sources",
    "input-format",
    "output-format",
    "print",
    "replay-user-messages",
    "include-partial-messages",
    "system-prompt",
    "system-prompt-file",
    "append-system-prompt",
    "append-system-prompt-file",
    "tools",
    "allowed-tools",
    "allowedTools",
    "disallowed-tools",
    "disallowedTools",
];

const SETTINGS: &str = "settings";

/// Parsed lines: flag (without `--`) → value, `None` for a bare switch.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeArgs(BTreeMap<String, Option<String>>);

impl ClaudeArgs {
    /// Parses the lines, refusing what is malformed, repeated or managed by 共工.
    pub fn parse(lines: &[String]) -> Result<ClaudeArgs> {
        let mut out = BTreeMap::new();
        for line in lines.iter().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            let Some(rest) = line.strip_prefix("--") else {
                bail!(t!("命令行参数须以 -- 开头：{line}", line = line));
            };
            let (flag, value) = match rest.split_once(|c: char| c == '=' || c.is_whitespace()) {
                Some((flag, value)) => (flag, Some(unquote(value.trim()).to_string())),
                None => (rest, None),
            };
            if flag.is_empty() || !flag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                bail!(t!("命令行参数不合法：{line}", line = line));
            }
            if MANAGED.contains(&flag) {
                bail!(t!("--{flag} 由共工管理，不能在这里设置", flag = flag));
            }
            if flag == SETTINGS && value.as_deref().is_none_or(str::is_empty) {
                bail!(t!("--settings 需要文件路径或 JSON"));
            }
            if out.insert(flag.to_string(), value).is_some() {
                bail!(t!("命令行参数重复：--{flag}", flag = flag));
            }
        }
        Ok(ClaudeArgs(out))
    }

    /// What goes to the adapter's `extraArgs`: every flag but `--settings`.
    pub fn extra_args(&self) -> Map<String, Value> {
        self.0
            .iter()
            .filter(|(flag, _)| flag.as_str() != SETTINGS)
            .map(|(flag, value)| (flag.clone(), value.clone().map_or(Value::Null, Value::String)))
            .collect()
    }

    /// The `--settings` value read now: inline JSON, or a file (`~` = the user's home). An object, or an error naming
    /// the file.
    pub fn settings(&self) -> Result<Option<Map<String, Value>>> {
        let Some(Some(value)) = self.0.get(SETTINGS) else { return Ok(None) };
        let text = if value.trim_start().starts_with('{') {
            value.clone()
        } else {
            let path = match value.strip_prefix("~/") {
                Some(rest) => user_home().join(rest),
                None => PathBuf::from(value),
            };
            std::fs::read_to_string(&path)
                .with_context(|| t!("无法读取 --settings 指定的文件 {path}", path = path.display()))?
        };
        match serde_json::from_str(&text) {
            Ok(Value::Object(map)) => Ok(Some(map)),
            _ => bail!(t!("--settings 的内容不是 JSON 对象：{value}", value = value)),
        }
    }
}

fn unquote(v: &str) -> &str {
    ['"', '\''].iter().find_map(|q| v.strip_prefix(*q)?.strip_suffix(*q)).unwrap_or(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(lines: &[&str]) -> Result<ClaudeArgs> {
        ClaudeArgs::parse(&lines.iter().map(|l| l.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_flags_with_and_without_values_and_refuses_what_is_managed_or_malformed() {
        let args = parse(&["--debug", "  --max-turns 30 ", "--betas=a,b", "--agent \"my agent\"", ""]).unwrap();
        assert_eq!(
            Value::Object(args.extra_args()),
            serde_json::json!({ "debug": null, "max-turns": "30", "betas": "a,b", "agent": "my agent" })
        );
        for bad in ["-p", "debug", "--", "--bad!flag", "--permission-mode bypassPermissions", "--model opus"] {
            assert!(parse(&[bad]).is_err(), "{bad}");
        }
        assert!(parse(&["--debug", "--debug"]).is_err());
        assert!(parse(&["--settings"]).is_err());
    }

    #[test]
    fn reads_settings_from_a_file_or_inline_json_and_keeps_them_out_of_the_extra_args() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("team.json");
        std::fs::write(&file, r#"{"includeCoAuthoredBy":false,"env":{"A":"1"}}"#).unwrap();
        let args = parse(&[&format!("--settings {}", file.display()), "--verbose"]).unwrap();
        assert_eq!(Value::Object(args.extra_args()), serde_json::json!({ "verbose": null }));
        let settings = args.settings().unwrap().unwrap();
        assert_eq!(settings["includeCoAuthoredBy"], false);

        let inline = parse(&[r#"--settings {"cleanupPeriodDays": 7}"#]).unwrap();
        assert_eq!(inline.settings().unwrap().unwrap()["cleanupPeriodDays"], 7);
        assert!(parse(&["--settings /nope.json"]).unwrap().settings().is_err());
        std::fs::write(&file, "[1]").unwrap();
        assert!(parse(&[&format!("--settings={}", file.display())]).unwrap().settings().is_err());
        assert_eq!(parse(&["--debug"]).unwrap().settings().unwrap(), None);
    }
}
