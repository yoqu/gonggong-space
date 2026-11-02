//! Agent settings offered as controls instead of raw variables (design §4.2.2). The daemon's copy of
//! `packages/protocol/src/agent-settings.ts` (checked against `fixtures/data.agent-setting-fields.json`): `provider`
//! fields live in a provider's (or the official login's) env, `agent` fields are this machine's default per agent kind
//! and the `bot_override` ones may be overridden per bot.
use crate::protocol::AgentKind;
use crate::t;
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Provider,
    Agent,
}

/// A Claude Code flag-settings top-level key or an env var.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Settings,
    Env,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// A positive integer.
    Tokens,
    /// A positive integer.
    Ms,
    /// '1' (or 'true') or absent.
    Flag,
    /// 'true' | 'false' or absent.
    Bool,
    Text,
    Enum,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    pub id: &'static str,
    pub agent: AgentKind,
    pub layer: Layer,
    pub target: Target,
    pub key: &'static str,
    #[serde(rename = "type")]
    pub kind: Kind,
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    pub options: &'static [&'static str],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<u64>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub bot_override: bool,
}

const fn field(id: &'static str, layer: Layer, target: Target, key: &'static str, kind: Kind) -> Field {
    Field {
        id,
        agent: AgentKind::Claude,
        layer,
        target,
        key,
        kind,
        options: &[],
        min: None,
        max: None,
        bot_override: false,
    }
}

use Kind::*;
use Layer::{Agent, Provider};
use Target::{Env, Settings};

pub const FIELDS: &[Field] = &[
    Field {
        options: &["200000", "262144", "1000000"],
        ..field("contextWindow", Provider, Env, CONTEXT_WINDOW, Tokens)
    },
    Field {
        min: Some(100_000),
        max: Some(1_000_000),
        ..field("autoCompactWindow", Provider, Env, AUTO_COMPACT, Tokens)
    },
    field("maxOutputTokens", Provider, Env, MAX_OUTPUT, Tokens),
    field("disableThinking", Provider, Env, "CLAUDE_CODE_DISABLE_THINKING", Flag),
    field("disableBetas", Provider, Env, "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS", Flag),
    field("toolSearch", Provider, Env, "ENABLE_TOOL_SEARCH", Bool),
    field("apiTimeout", Provider, Env, "API_TIMEOUT_MS", Ms),
    Field { bot_override: true, ..field("language", Agent, Settings, "language", Text) },
    Field { bot_override: true, ..field("thinking", Agent, Settings, "alwaysThinkingEnabled", Bool) },
    Field {
        options: &[ATTRIBUTION_NONE],
        bot_override: true,
        ..field("attribution", Agent, Settings, "attribution", Enum)
    },
    field("gitInstructions", Agent, Settings, "includeGitInstructions", Bool),
    field("autoMemory", Agent, Settings, "autoMemoryEnabled", Bool),
    field("autoCompact", Agent, Settings, "autoCompactEnabled", Bool),
    field("bashTimeout", Agent, Env, "BASH_DEFAULT_TIMEOUT_MS", Ms),
    field("bashMaxTimeout", Agent, Env, "BASH_MAX_TIMEOUT_MS", Ms),
    field("nonessentialTraffic", Agent, Env, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", Flag),
];

pub const CONTEXT_WINDOW: &str = "CLAUDE_CODE_MAX_CONTEXT_TOKENS";
pub const AUTO_COMPACT: &str = "CLAUDE_CODE_AUTO_COMPACT_WINDOW";
pub const MAX_OUTPUT: &str = "CLAUDE_CODE_MAX_OUTPUT_TOKENS";
const ATTRIBUTION_NONE: &str = "none";

/// Claude Code settings gonggong owns (permission tier, model, MCP, skills, key): never set from agent settings.
pub const LOCKED_CLAUDE_SETTINGS: [&str; 5] = ["permissions", "model", "mcpServers", "enabledPlugins", "apiKeyHelper"];

/// CLI env vars that silently beat what gonggong sets (e.g. the bot's effort): reported as conflicts.
pub const CLAUDE_CONFLICT_ENV: [&str; 4] =
    ["CLAUDE_CODE_EFFORT_LEVEL", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL", "MAX_THINKING_TOKENS"];

/// CLI env vars that move Claude Code's compaction thresholds; read for the context meter, never reported.
pub const CLAUDE_COMPACT_ENV: [&str; 3] =
    ["DISABLE_AUTO_COMPACT", "DISABLE_COMPACT", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE"];

/// Env names whose values leave the machine masked, like the API key. Known setting fields (`*_MAX_*_TOKENS`) are
/// sizes, not secrets.
pub fn secret_env(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    ["KEY", "TOKEN", "SECRET", "PASSWORD"].iter().any(|s| upper.contains(s))
        && !FIELDS.iter().any(|f| f.target == Env && f.key == name)
}

pub fn fields(agent: AgentKind, layer: Option<Layer>) -> impl Iterator<Item = &'static Field> {
    FIELDS.iter().filter(move |f| f.agent == agent && layer.is_none_or(|l| f.layer == l))
}

pub fn by_id(id: &str) -> Option<&'static Field> {
    FIELDS.iter().find(|f| f.id == id)
}

/// A machine's defaults for one agent kind. `inherit_cli`: also load the CLI's user-level config (~/.claude).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    /// Field id → value; absent = Claude Code's default.
    #[serde(default)]
    pub values: BTreeMap<String, String>,
    #[serde(default = "inherit")]
    pub inherit_cli: bool,
}

fn inherit() -> bool {
    true
}

impl Default for AgentSettings {
    fn default() -> Self {
        AgentSettings { values: BTreeMap::new(), inherit_cli: true }
    }
}

impl AgentSettings {
    /// Only `agent`-layer fields of `agent`, each valid for its type.
    pub fn validate(&self, agent: AgentKind) -> Result<()> {
        let mut checked = vec![];
        for (id, value) in &self.values {
            let f = fields(agent, Some(Agent))
                .find(|f| f.id == id)
                .ok_or_else(|| anyhow::anyhow!(t!("{id} 不是可设置的 Agent 项", id = id)))?;
            checked.push((f, value.as_str()));
        }
        check(&checked)
    }
}

/// The `provider`-layer fields among a provider's (or the official login's) variables, each valid for its type.
/// `before`: the stored variables; then only the fields changed from them are checked, so an old value that is no
/// longer accepted does not block other edits.
pub fn validate_env(
    agent: AgentKind,
    env: &BTreeMap<String, String>,
    before: Option<&BTreeMap<String, String>>,
) -> Result<()> {
    let changed = |key: &str| before.is_none_or(|b| b.get(key) != env.get(key));
    let checked: Vec<_> = fields(agent, Some(Provider))
        .filter(|f| changed(f.key))
        .filter_map(|f| Some((f, env.get(f.key)?.as_str())))
        .collect();
    check(&checked)?;
    let number = |key: &str| env.get(key).and_then(|v| v.parse::<u64>().ok());
    if agent == AgentKind::Claude
        && (changed(AUTO_COMPACT) || changed(CONTEXT_WINDOW))
        && let (Some(compact), Some(window)) = (number(AUTO_COMPACT), number(CONTEXT_WINDOW))
        && compact > window
    {
        bail!(t!("自动压缩窗口不能大于上下文窗口"));
    }
    Ok(())
}

/// Whether `v` is a valid value of `f`.
pub fn valid(f: &Field, v: &str) -> bool {
    match f.kind {
        Tokens | Ms => {
            v.parse::<u64>().is_ok_and(|n| n > 0 && f.min.is_none_or(|m| n >= m) && f.max.is_none_or(|m| n <= m))
        }
        Flag => matches!(v, "1" | "true"),
        // Claude Code also takes `auto` and `auto:<percent>` for tool search.
        Bool if f.id == "toolSearch" => {
            matches!(v, "true" | "false" | "auto")
                || v.strip_prefix("auto:").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        }
        Bool => matches!(v, "true" | "false"),
        Enum => f.options.contains(&v),
        Text => true,
    }
}

fn check(values: &[(&Field, &str)]) -> Result<()> {
    if let Some((f, v)) = values.iter().find(|(f, v)| !valid(f, v)) {
        bail!(t!("{id} 的值 {value} 不合法", id = f.id, value = v));
    }
    Ok(())
}

/// The flag-settings value of a `settings` field.
pub fn settings_value(f: &Field, v: &str) -> Value {
    match (f.kind, v) {
        (Bool, _) => Value::Bool(v == "true"),
        (Tokens | Ms, _) => v.parse::<u64>().map_or_else(|_| v.into(), Value::from),
        (Enum, ATTRIBUTION_NONE) if f.id == "attribution" => serde_json::json!({ "commit": "", "pr": "" }),
        _ => v.into(),
    }
}

/// A flag-settings value read back as a field value; None when it has another shape.
fn field_value(f: &Field, v: &Value) -> Option<String> {
    match (f.kind, v) {
        (Enum, Value::Object(o)) if f.id == "attribution" => {
            o.values().all(|v| v.as_str() == Some("")).then(|| ATTRIBUTION_NONE.into())
        }
        (_, Value::String(s)) => Some(s.clone()),
        (_, Value::Bool(b)) => Some(b.to_string()),
        (_, Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// What the machine's own CLI config sets, for 生效值来源; known fields only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliSettingsSnapshot {
    pub values: BTreeMap<String, String>,
    /// [`CLAUDE_CONFLICT_ENV`] names it sets.
    pub conflicts: Vec<String>,
    pub hooks: u32,
    pub permission_rules: u32,
    /// Claude Code version the adapter runs; None = unknown.
    pub version: Option<String>,
    /// [`CLAUDE_COMPACT_ENV`] values it sets; daemon-local.
    #[serde(skip)]
    pub compact_env: BTreeMap<String, String>,
}

/// Claude's `<user_home>/.claude/settings.json`, reduced to the known fields, conflicting variables and the number
/// of hooks and permission rules; None when there is none (or it is unreadable).
pub fn read_cli(user_home: &Path, version: Option<String>) -> Option<CliSettingsSnapshot> {
    read_claude_dir(&user_home.join(".claude"), version)
}

pub fn read_claude_dir(dir: &Path, version: Option<String>) -> Option<CliSettingsSnapshot> {
    let raw = std::fs::read_to_string(dir.join("settings.json")).ok()?;
    let doc: Value = serde_json::from_str(&raw).ok()?;
    let env = doc.get("env").and_then(Value::as_object);
    let values = fields(AgentKind::Claude, None)
        .filter_map(|f| {
            let v = match f.target {
                Settings => doc.get(f.key)?,
                Env => env?.get(f.key)?,
            };
            Some((f.id.to_string(), field_value(f, v)?))
        })
        .collect();
    let conflicts = CLAUDE_CONFLICT_ENV
        .iter()
        .filter(|k| env.is_some_and(|e| e.contains_key(**k)))
        .map(|k| k.to_string())
        .collect();
    let compact_env = CLAUDE_COMPACT_ENV
        .iter()
        .filter_map(|k| {
            let v = match env?.get(*k)? {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            Some((k.to_string(), v))
        })
        .collect();
    let len = |v: Option<&Value>| v.and_then(Value::as_array).map_or(0, |a| a.len() as u32);
    let hooks = doc
        .get("hooks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|events| events.values())
        .filter_map(Value::as_array)
        .flatten()
        .map(|matcher| len(matcher.get("hooks")))
        .sum();
    let permissions = doc.get("permissions");
    let permission_rules = ["allow", "ask", "deny"].iter().map(|k| len(permissions.and_then(|p| p.get(k)))).sum();
    Some(CliSettingsSnapshot { values, conflicts, hooks, permission_rules, version, compact_env })
}

/// The Claude Code version the catalog in `<home>/models.json` was probed with (`<cli>+<adapter>`).
pub fn claude_version(home: &Path) -> Option<String> {
    let cached = crate::local::load_catalogs(home);
    let cli = cached.get(&AgentKind::Claude)?.key.split('+').next()?.to_string();
    (cli != "?").then_some(cli)
}

/// [`read_cli`] per agent kind, for the providers view.
pub fn cli_snapshots(home: &Path, user_home: &Path) -> BTreeMap<AgentKind, CliSettingsSnapshot> {
    read_cli(user_home, claude_version(home)).map(|s| (AgentKind::Claude, s)).into_iter().collect()
}

/// What a run's agent settings came from (`session.config`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSettingsSnapshot {
    pub provider: Option<String>,
    pub context_window: Option<u64>,
    pub auto_compact_window: Option<u64>,
    pub inherit_cli: bool,
    /// Field ids and conflict env names whose value came from the CLI's own config.
    pub from_cli: Vec<String>,
    /// Bot override field ids applied.
    pub from_bot: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use AgentKind::Claude;

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn agent_settings_take_only_valid_agent_fields() {
        let ok = |pairs: &[(&str, &str)]| AgentSettings { values: values(pairs), inherit_cli: true }.validate(Claude);
        ok(&[("language", "chinese"), ("bashTimeout", "300000"), ("attribution", "none"), ("thinking", "false")])
            .unwrap();
        ok(&[("nonessentialTraffic", "1"), ("autoMemory", "true")]).unwrap();
        ok(&[("nonessentialTraffic", "true")]).unwrap();
        for bad in [
            ("contextWindow", "200000"),
            ("nope", "1"),
            ("bashTimeout", "0"),
            ("bashTimeout", "-5"),
            ("bashTimeout", "1.5"),
            ("nonessentialTraffic", "0"),
            ("nonessentialTraffic", "yes"),
            ("thinking", "yes"),
            ("attribution", "co-authored"),
        ] {
            assert!(ok(&[bad]).is_err(), "{bad:?}");
        }
        assert!(
            AgentSettings { values: values(&[("language", "x")]), inherit_cli: true }
                .validate(AgentKind::Codex)
                .is_err()
        );
    }

    #[test]
    fn provider_env_fields_are_checked_by_key() {
        let check = |pairs: &[(&str, &str)]| validate_env(Claude, &values(pairs), None);
        check(&[(CONTEXT_WINDOW, "262144"), (AUTO_COMPACT, "262144"), ("ANYTHING", "x")]).unwrap();
        check(&[("ENABLE_TOOL_SEARCH", "true"), ("API_TIMEOUT_MS", "600000")]).unwrap();
        check(&[(AUTO_COMPACT, "1000000")]).unwrap();
        assert!(check(&[(AUTO_COMPACT, "99999")]).is_err(), "below the minimum");
        assert!(check(&[(AUTO_COMPACT, "1000001")]).is_err(), "above the maximum");
        assert!(check(&[(CONTEXT_WINDOW, "200000"), (AUTO_COMPACT, "262144")]).is_err(), "beyond the window");
        for ok in ["1", "true"] {
            check(&[("CLAUDE_CODE_DISABLE_THINKING", ok)]).unwrap();
        }
        assert!(check(&[("CLAUDE_CODE_DISABLE_THINKING", "0")]).is_err());
        for ok in ["true", "false", "auto", "auto:5", "auto:50"] {
            check(&[("ENABLE_TOOL_SEARCH", ok)]).unwrap();
        }
        for bad in ["1", "auto:", "auto:x", "auto:-1", "on"] {
            assert!(check(&[("ENABLE_TOOL_SEARCH", bad)]).is_err(), "{bad}");
        }
        validate_env(AgentKind::Codex, &values(&[(AUTO_COMPACT, "1")]), None).unwrap();
    }

    #[test]
    fn only_changed_provider_fields_are_checked_against_what_is_stored() {
        let before = values(&[("ENABLE_TOOL_SEARCH", "on"), (CONTEXT_WINDOW, "262144"), (AUTO_COMPACT, "200000")]);
        let after = |pairs: &[(&str, &str)]| {
            let mut env = before.clone();
            env.extend(values(pairs));
            validate_env(Claude, &env, Some(&before))
        };
        after(&[("API_TIMEOUT_MS", "600000")]).unwrap();
        assert!(after(&[("API_TIMEOUT_MS", "0")]).is_err());
        assert!(after(&[("ENABLE_TOOL_SEARCH", "off")]).is_err(), "a changed value is checked");
        assert!(after(&[(CONTEXT_WINDOW, "200000"), (AUTO_COMPACT, "262144")]).is_err());
        assert!(after(&[(CONTEXT_WINDOW, "100000")]).is_err(), "the window shrank below the stored compact window");
    }

    #[test]
    fn settings_values_get_their_json_shape() {
        let v = |id: &str, raw: &str| settings_value(by_id(id).unwrap(), raw);
        assert_eq!(v("thinking", "false"), Value::Bool(false));
        assert_eq!(v("attribution", "none"), serde_json::json!({ "commit": "", "pr": "" }));
        assert_eq!(v("language", "english"), Value::from("english"));
    }

    #[test]
    fn no_field_touches_what_gonggong_owns() {
        assert!(FIELDS.iter().all(|f| !LOCKED_CLAUDE_SETTINGS.contains(&f.key)));
        assert!(fields(Claude, None).all(|f| !(f.target == Settings && f.layer == Provider)));
    }

    #[test]
    fn secret_names_match_like_the_contract() {
        for name in ["GITHUB_TOKEN", "api_key", "MY_SECRET", "db_password", "ANTHROPIC_API_KEY"] {
            assert!(secret_env(name), "{name}");
        }
        assert!(!secret_env("HTTPS_PROXY") && !secret_env("API_TIMEOUT_MS"));
        assert!(!secret_env(CONTEXT_WINDOW) && !secret_env("CLAUDE_CODE_MAX_OUTPUT_TOKENS"), "sizes, not secrets");
    }

    #[test]
    fn reads_only_known_fields_of_the_cli_config() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(read_cli(home.path(), None), None, "no config");
        std::fs::create_dir(home.path().join(".claude")).unwrap();
        let config = serde_json::json!({
            "language": "english",
            "alwaysThinkingEnabled": true,
            "attribution": { "commit": "", "pr": "" },
            "model": "opus",
            "apiKeyHelper": "/bin/secret",
            "env": {
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "200000",
                "BASH_MAX_TIMEOUT_MS": 600000,
                "CLAUDE_CODE_EFFORT_LEVEL": "high",
                "ANTHROPIC_AUTH_TOKEN": "sk-very-secret",
                "DISABLE_AUTO_COMPACT": 1,
                "OTHER": "x"
            },
            "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command" }, { "type": "command" }] }],
                "Stop": [{ "hooks": [{ "type": "command" }] }]
            },
            "permissions": { "allow": ["Bash(ls)", "Read"], "deny": ["Bash(rm)"], "defaultMode": "plan" }
        });
        std::fs::write(home.path().join(".claude/settings.json"), config.to_string()).unwrap();
        let s = read_cli(home.path(), Some("2.1.296".into())).unwrap();
        assert_eq!(
            s.values,
            values(&[
                ("language", "english"),
                ("thinking", "true"),
                ("attribution", "none"),
                ("contextWindow", "200000"),
                ("bashMaxTimeout", "600000"),
            ])
        );
        assert_eq!(s.conflicts, vec!["CLAUDE_CODE_EFFORT_LEVEL".to_string()]);
        assert_eq!((s.hooks, s.permission_rules, s.version.as_deref()), (3, 3, Some("2.1.296")));
        assert_eq!(s.compact_env, values(&[("DISABLE_AUTO_COMPACT", "1")]));
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("sk-very-secret") && !json.contains("/bin/secret") && !json.contains("OTHER"));
        assert!(!json.contains("DISABLE_AUTO_COMPACT"), "daemon-local");
    }

    #[test]
    fn the_version_is_the_cli_build_the_catalog_was_probed_with() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(claude_version(home.path()), None);
        let catalog =
            r#"{"claude":{"key":"2.1.296+0.81.0","catalog":{"models":[],"current":null,"efforts":[],"effort":null}}}"#;
        std::fs::write(home.path().join("models.json"), catalog).unwrap();
        assert_eq!(claude_version(home.path()).as_deref(), Some("2.1.296"));
    }
}
