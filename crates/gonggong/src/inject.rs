//! Puts a run's third-party provider into its adapter process (design §4.4, S0 findings §10). Claude: a flag-settings
//! file named in `_meta` (process env loses to `~/.claude/settings.json`; an inline object would land on argv). Codex:
//! the adapter's env only. The official login injects nothing. Keys go to the 0600 file or the child's env, never to
//! argv, logs or errors.
use crate::providers::{self, API_KEY, AUTH_TOKEN, EXTRA_ENV, Provider, Store};
use anyhow::{Result, bail};
use serde_json::{Map, Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};

/// The env var codex reads the key from (`model_providers.gg.env_key`).
pub const CODEX_KEY_ENV: &str = "GG_PROVIDER_KEY";
const CODEX_PROVIDER: &str = "gg";
const SETTINGS_PREFIX: &str = "claude-";

/// Connection settings a user-level config may carry that must not reach a third party (S0 §10.1 #7), unless the
/// provider sets them.
const CLAUDE_RESET: [(&str, &str); 7] = [
    ("ANTHROPIC_SMALL_FAST_MODEL", ""),
    ("CLAUDE_CODE_OAUTH_TOKEN", ""),
    ("ANTHROPIC_CUSTOM_HEADERS", ""),
    ("ANTHROPIC_BEDROCK_BASE_URL", ""),
    ("ANTHROPIC_VERTEX_BASE_URL", ""),
    ("CLAUDE_CODE_USE_BEDROCK", "0"),
    ("CLAUDE_CODE_USE_VERTEX", "0"),
];

pub fn claude_settings_path(home: &Path, provider_id: &str) -> PathBuf {
    home.join("run").join(format!("{SETTINGS_PREFIX}{provider_id}.json"))
}

/// Claude Code flag settings routing every request to `p`.
pub fn claude_settings(p: &Provider) -> Result<Value> {
    let key_field = p.api_key_field.as_deref().unwrap_or(AUTH_TOKEN);
    let other = match key_field {
        AUTH_TOKEN => API_KEY,
        API_KEY => AUTH_TOKEN,
        _ => bail!("供应商 {} 的 Key 字段 {key_field} 不受支持", p.name),
    };
    let models = p.models.clone().unwrap_or_default();
    let or_blank = |v: &Option<String>| v.clone().unwrap_or_default();
    let mut env: Map<String, Value> = [
        ("ANTHROPIC_BASE_URL", p.base_url.clone()),
        (key_field, p.api_key.clone()),
        (other, String::new()),
        ("ANTHROPIC_MODEL", or_blank(&p.model)),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", or_blank(&models.haiku)),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", or_blank(&models.sonnet)),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", or_blank(&models.opus)),
    ]
    .into_iter()
    .chain(CLAUDE_RESET.map(|(k, v)| (k, v.to_string())))
    .map(|(k, v)| (k.to_string(), Value::String(v)))
    .collect();
    for (k, v) in p.env.iter().filter(|(k, _)| EXTRA_ENV.contains(&k.as_str())) {
        env.insert(k.clone(), Value::String(v.clone()));
    }
    Ok(json!({ "apiKeyHelper": "", "env": env }))
}

/// Writes `p`'s settings file ([`claude_settings_path`], 0600, atomic) unless it is current.
pub fn write_claude_settings(home: &Path, p: &Provider) -> Result<()> {
    let path = claude_settings_path(home, &p.id);
    let bytes = serde_json::to_vec_pretty(&claude_settings(p)?)?;
    if std::fs::read(&path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    let dir = path.parent().expect("under <home>/run");
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let written = (|| {
        let mut file = options.open(&tmp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        std::fs::rename(&tmp, &path)?;
        anyhow::Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// Deletes the settings files (and keys) of providers no longer stored.
pub fn prune(home: &Path, store: &Store) {
    let Ok(entries) = std::fs::read_dir(home.join("run")) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_prefix(SETTINGS_PREFIX)?.strip_suffix(".json")) else {
            continue;
        };
        if store.get(id).is_none()
            && let Err(e) = std::fs::remove_file(entry.path())
        {
            tracing::warn!("removing {} failed: {e}", entry.path().display());
        }
    }
}

/// Merges `p` into the adapter's `CODEX_CONFIG`; the key itself goes in [`CODEX_KEY_ENV`].
pub fn codex_config(config: &mut Map<String, Value>, p: &Provider) {
    let wire_api = p.wire_api.as_deref().unwrap_or(providers::WIRE_RESPONSES);
    let provider = json!({ "name": p.name, "base_url": p.base_url, "wire_api": wire_api, "env_key": CODEX_KEY_ENV });
    config.insert("model_provider".into(), CODEX_PROVIDER.into());
    config.insert("model_providers".into(), json!({ CODEX_PROVIDER: provider }));
    if let Some(model) = &p.model {
        config.insert("model".into(), model.as_str().into());
    }
    if let Some(effort) = &p.effort {
        config.insert("model_reasoning_effort".into(), effort.as_str().into());
    }
}

/// Env for the codex adapter: `MODEL_PROVIDER` too, or resuming uses `~/.codex/config.toml`'s provider (S0 §10.2 #4).
pub fn codex_env(p: &Provider) -> [(&'static str, String); 2] {
    [("MODEL_PROVIDER", CODEX_PROVIDER.into()), (CODEX_KEY_ENV, p.api_key.clone())]
}

/// The model a bot runs on `p`: its own pick when the provider serves it, else the provider's default.
pub fn model(p: &Provider, wanted: Option<&str>) -> Option<String> {
    let preset = p.preset_id.as_deref().and_then(|id| providers::preset(p.agent, id));
    let models = p.models.iter().flat_map(|m| [&m.haiku, &m.sonnet, &m.opus]).flatten();
    let mut options = p.model.iter().chain(models).chain(preset.into_iter().flat_map(|p| &p.model_options));
    wanted.filter(|w| options.any(|o| o.as_str() == *w)).map(String::from).or_else(|| p.model.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AgentKind::{Claude, Codex};

    fn custom() -> Provider {
        let mut p = Provider::custom(Claude, "X".into(), "https://x.test".into(), "sk-x-0123456789".into());
        p.id = "x-1".into();
        p
    }

    #[test]
    fn api_key_field_carries_the_key_and_blanks_the_other() {
        let mut p = custom();
        p.api_key_field = Some(API_KEY.into());
        p.env.insert("ANTHROPIC_BASE_URL".into(), "https://evil.test".into());
        p.env.insert("ENABLE_TOOL_SEARCH".into(), "1".into());
        let env = claude_settings(&p).unwrap()["env"].clone();
        assert_eq!((env[API_KEY].as_str(), env[AUTH_TOKEN].as_str()), (Some("sk-x-0123456789"), Some("")));
        assert_eq!(env["ANTHROPIC_BASE_URL"], "https://x.test", "extra env never overrides the connection");
        assert_eq!((env["ENABLE_TOOL_SEARCH"].as_str(), env["ANTHROPIC_MODEL"].as_str()), (Some("1"), Some("")));
        p.api_key_field = Some("OTHER".into());
        assert!(!claude_settings(&p).unwrap_err().to_string().contains("sk-x"));
    }

    #[test]
    fn prune_keeps_only_stored_providers() {
        let home = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        let kept = store.add(custom()).unwrap();
        let mut gone = custom();
        gone.id = "gone-1".into();
        for p in [store.get(&kept).unwrap(), &gone] {
            write_claude_settings(home.path(), p).unwrap();
        }
        std::fs::write(home.path().join("run/other.json"), "{}").unwrap();
        prune(home.path(), &store);
        assert!(claude_settings_path(home.path(), &kept).exists());
        assert!(!claude_settings_path(home.path(), "gone-1").exists());
        assert!(home.path().join("run/other.json").exists());
    }

    #[test]
    fn model_prefers_the_bots_pick_among_the_providers_models() {
        let p = Provider::from_preset(providers::preset(Codex, "zhipu").unwrap(), "k".into());
        assert_eq!(model(&p, Some("glm-5.3-flash")).as_deref(), Some("glm-5.3-flash"), "from the preset's options");
        assert_eq!(model(&p, Some("gpt-5")).as_deref(), Some("glm-5.3"));
        assert_eq!(model(&p, None).as_deref(), Some("glm-5.3"));
        assert_eq!(model(&custom(), Some("opus")), None);
    }
}
