//! Puts a run's third-party provider into its adapter process (design §4.4, S0 findings §10). Claude: a flag-settings
//! file named in `_meta` (process env loses to `~/.claude/settings.json`; an inline object would land on argv). Codex:
//! the adapter's env only. The official login gets only its extra variables and proxy, the same way. Keys go to the 0600 file or the child's env, never to
//! argv, logs or errors.
use crate::agent_settings::{
    self, AUTO_COMPACT, AgentSettings, CONTEXT_WINDOW, CliSettingsSnapshot, Layer, MAX_OUTPUT, RunSettingsSnapshot,
    Target,
};
use crate::protocol::{AgentKind, RunBot};
use crate::providers::{self, API_KEY, AUTH_TOKEN, OFFICIAL, Provider, Selection, Store};
use crate::t;
use crate::turn::CompactPolicy;
use anyhow::{Result, bail};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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

/// `selection`: a provider id or [`OFFICIAL`]; `overlay`: a hash of the agent settings layered on it, if any.
pub fn claude_settings_path(home: &Path, selection: &str, overlay: Option<&str>) -> PathBuf {
    let name = match overlay {
        Some(hash) => format!("{SETTINGS_PREFIX}{selection}.{hash}.json"),
        None => format!("{SETTINGS_PREFIX}{selection}.json"),
    };
    home.join("run").join(name)
}

/// What a Claude adapter process starts with besides its env: the flag-settings file, whether the CLI's user-level
/// config is loaded too, and where the run's settings came from. A change of the first two restarts the adapter for
/// the next turn.
#[derive(Debug, Clone)]
pub struct ClaudeLaunch {
    /// None: nothing to set (the official login without extras or agent settings).
    pub file: Option<(PathBuf, Value)>,
    pub inherit_cli: bool,
    /// The official login's or provider's command-line arguments for the adapter's `extraArgs` (`--settings` merged into `file`).
    pub args: Map<String, Value>,
    /// Display only: it follows the CLI's config, which the user may edit any time.
    pub snapshot: RunSettingsSnapshot,
    /// For the context meter; like the snapshot, a guess at what the CLI's config says.
    pub compact: CompactPolicy,
}

impl PartialEq for ClaudeLaunch {
    fn eq(&self, other: &Self) -> bool {
        self.file == other.file && self.inherit_cli == other.inherit_cli && self.args == other.args
    }
}

impl ClaudeLaunch {
    /// Composed lowest precedence first: the machine's agent defaults, the bot's overrides, the model's context window
    /// (unless the provider sets one), the provider's or official login's env, the connection.
    pub fn new(
        home: &Path,
        selection: &Selection,
        defaults: &AgentSettings,
        bot: &RunBot,
        cli: Option<&CliSettingsSnapshot>,
    ) -> Result<ClaudeLaunch> {
        let (mut top, mut env) = (Map::new(), Map::new());
        let mut put = |f: &agent_settings::Field, v: &str| match f.target {
            Target::Settings => top.insert(f.key.into(), agent_settings::settings_value(f, v)),
            Target::Env => env.insert(f.key.into(), v.into()),
        };
        for (id, v) in &defaults.values {
            if let Some(f) = agent_settings::by_id(id) {
                put(f, v);
            }
        }
        let mut from_bot = vec![];
        for f in agent_settings::fields(AgentKind::Claude, Some(Layer::Agent)).filter(|f| f.bot_override) {
            match bot.agent_settings.get(f.id) {
                Some(v) if agent_settings::valid(f, v) => {
                    put(f, v);
                    from_bot.push(f.id.to_string());
                }
                Some(v) => tracing::warn!(bot = bot.id, "ignoring invalid agent setting {}={v}", f.id),
                None => {}
            }
        }
        let base = match selection {
            Selection::Provider(p) if p.claude_profile().is_some() => json!({ "env": p.process_env() }),
            Selection::Provider(p) => {
                let preset = p.preset_id.as_deref().and_then(|id| providers::preset(p.agent, id));
                let window = model(p, bot.model.as_deref()).and_then(|m| preset?.model_context.get(&m).copied());
                if let Some(w) = window.filter(|_| !p.env.contains_key(CONTEXT_WINDOW)) {
                    env.insert(CONTEXT_WINDOW.into(), w.to_string().into());
                }
                claude_settings(p)?
            }
            Selection::Official(o) => json!({ "env": o.process_env() }),
        };
        let overlay = (!top.is_empty() || !env.is_empty()).then(|| {
            let digest = Sha256::digest(json!({ "settings": top, "env": env }).to_string());
            digest.iter().take(6).map(|b| format!("{b:02x}")).collect::<String>()
        });
        let Value::Object(mut base) = base else { unreachable!("settings are an object") };
        if let Some(Value::Object(e)) = base.remove("env") {
            env.extend(e);
        }
        top.extend(base);
        let file = match selection {
            Selection::Official(o) if o.is_empty() && overlay.is_none() => None,
            Selection::Provider(p)
                if p.claude_profile().is_some()
                    && p.process_env().is_empty()
                    && p.args.is_empty()
                    && overlay.is_none() =>
            {
                None
            }
            _ => Some(claude_settings_path(home, selection.key(), overlay.as_deref())),
        };
        let inherit_cli = defaults.inherit_cli || selection.claude_profile().is_some();
        let cli = cli.filter(|_| inherit_cli);
        let sets = |id: &str| {
            agent_settings::by_id(id).is_some_and(|f| match f.target {
                Target::Settings => top.contains_key(f.key),
                Target::Env => env.contains_key(f.key),
            })
        };
        let from_cli = cli.map_or(vec![], |c| {
            let fields = c.values.keys().filter(|id| !sets(id));
            fields.chain(c.conflicts.iter().filter(|k| !env.contains_key(*k))).cloned().collect()
        });
        let number = |key: &str, id: &str| {
            let ours = env.get(key).and_then(Value::as_str);
            ours.or_else(|| cli?.values.get(id).map(String::as_str)).and_then(|v| v.parse().ok())
        };
        let var = |key: &str| {
            let ours = env.get(key).and_then(Value::as_str).map(String::from);
            ours.or_else(|| cli?.compact_env.get(key).cloned())
        };
        let truthy = |key: &str| {
            var(key).is_some_and(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        };
        let setting = match top.get("autoCompactEnabled") {
            Some(v) => v.as_bool(),
            None => cli.and_then(|c| c.values.get("autoCompact")).map(|v| v == "true"),
        };
        let compact = CompactPolicy {
            window: number(AUTO_COMPACT, "autoCompactWindow"),
            max_output: number(MAX_OUTPUT, "maxOutputTokens"),
            pct: var("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE")
                .and_then(|v| v.trim().parse().ok())
                .filter(|p: &f64| *p > 0.0 && *p <= 100.0),
            enabled: setting != Some(false) && !truthy("DISABLE_AUTO_COMPACT") && !truthy("DISABLE_COMPACT"),
        };
        let snapshot = RunSettingsSnapshot {
            provider: match selection {
                Selection::Provider(p) => Some(p.name.clone()),
                Selection::Official(_) => None,
            },
            context_window: number(CONTEXT_WINDOW, "contextWindow"),
            auto_compact_window: number(AUTO_COMPACT, "autoCompactWindow"),
            inherit_cli,
            from_cli,
            from_bot,
        };
        // The user's own `--settings` go under everything 共工 sets.
        let args = match selection {
            Selection::Official(o) => o.claude_args()?,
            Selection::Provider(p) => p.claude_args()?,
        };
        if let Some(mut user) = args.settings()? {
            if let Some(Value::Object(e)) = user.remove("env") {
                for (k, v) in e {
                    env.entry(k).or_insert(v);
                }
            }
            for (k, v) in user {
                top.entry(k).or_insert(v);
            }
        }
        top.insert("env".into(), Value::Object(env));
        let file = file.map(|f| (f, Value::Object(top)));
        Ok(ClaudeLaunch { file, inherit_cli, args: args.extra_args(), snapshot, compact })
    }

    pub fn settings_path(&self) -> Option<&Path> {
        self.file.as_ref().map(|(path, _)| path.as_path())
    }

    /// Writes the settings file (0600, atomic) unless it is current; either way its mtime marks it in use for
    /// [`prune`].
    pub fn write(&self) -> Result<()> {
        match &self.file {
            Some((path, settings)) => write_settings(path, settings),
            None => Ok(()),
        }
    }
}

/// Claude Code flag settings routing every request to `p`.
pub fn claude_settings(p: &Provider) -> Result<Value> {
    let key_field = p.api_key_field.as_deref().unwrap_or(AUTH_TOKEN);
    let other = match key_field {
        AUTH_TOKEN => API_KEY,
        API_KEY => AUTH_TOKEN,
        _ => bail!(t!("供应商 {name} 的 Key 字段 {field} 不受支持", name = p.name, field = key_field)),
    };
    let models = p.models.clone().unwrap_or_default();
    let or_blank = |v: &Option<String>| v.clone().unwrap_or_default();
    let connection = [
        ("ANTHROPIC_BASE_URL", p.base_url.clone()),
        (key_field, p.api_key.clone()),
        (other, String::new()),
        ("ANTHROPIC_MODEL", or_blank(&p.model)),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", or_blank(&models.haiku)),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", or_blank(&models.sonnet)),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", or_blank(&models.opus)),
    ];
    // A later entry wins: the provider's env may set what the reset blanks, never the connection.
    let env: Map<String, Value> = CLAUDE_RESET
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .into_iter()
        .chain(p.process_env())
        .chain(connection.map(|(k, v)| (k.to_string(), v)))
        .map(|(k, v)| (k, Value::String(v)))
        .collect();
    Ok(json!({ "apiKeyHelper": "", "env": env }))
}

fn write_settings(path: &Path, settings: &Value) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(settings)?;
    if std::fs::read(path).is_ok_and(|current| current == bytes) {
        std::fs::File::options().write(true).open(path)?.set_modified(SystemTime::now())?;
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
        std::fs::rename(&tmp, path)?;
        anyhow::Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// How long an overlay file may go unused before [`prune`] deletes it: every turn rewrites (or touches) its file, and
/// a single turn may run for hours, so this is far beyond any turn while still bounding stale keys on disk.
pub const STALE_SETTINGS: Duration = Duration::from_secs(7 * 24 * 3600);

/// Deletes the settings files (and keys) of providers no longer stored and, given `stale`, the overlay files (one
/// per settings combination, official login included) not written for that long.
pub fn prune(home: &Path, store: &Store, stale: Option<Duration>) {
    let Ok(entries) = std::fs::read_dir(home.join("run")) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let stem = name.to_str().and_then(|n| n.strip_prefix(SETTINGS_PREFIX)?.strip_suffix(".json"));
        let Some((id, overlay)) = stem.map(|s| s.split_once('.').map_or((s, false), |(id, _)| (id, true))) else {
            continue;
        };
        let removed = id != OFFICIAL && store.get(id).is_none();
        let unused = || {
            let modified = entry.metadata().and_then(|m| m.modified());
            stale.zip(modified.ok()).is_some_and(|(age, at)| at.elapsed().is_ok_and(|e| e > age))
        };
        if (removed || (overlay && unused()))
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

/// CodeBuddy's own services, picked by `CODEBUDDY_INTERNET_ENVIRONMENT` (a preset's env), not by a base URL.
const CODEBUDDY_SERVICES: [&str; 2] = ["https://www.codebuddy.ai", "https://copilot.tencent.com"];

/// `CODEBUDDY_BASE_URL` for a CodeBuddy provider: only a third-party model service sets one.
pub fn codebuddy_base_url(p: &Provider) -> Option<&str> {
    let url = p.base_url.trim_end_matches('/');
    (!CODEBUDDY_SERVICES.contains(&url)).then_some(url)
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
    use crate::providers::Official;

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
    fn provider_extra_env_can_override_the_oauth_reset() {
        let mut p = custom();
        assert_eq!(claude_settings(&p).unwrap()["env"]["CLAUDE_CODE_OAUTH_TOKEN"], "");
        p.env.insert("CLAUDE_CODE_OAUTH_TOKEN".into(), "synthetic-token".into());
        assert_eq!(claude_settings(&p).unwrap()["env"]["CLAUDE_CODE_OAUTH_TOKEN"], "synthetic-token");
    }

    #[test]
    fn local_claude_profile_inherits_its_own_credentials() {
        let mut value = serde_json::to_value(custom()).unwrap();
        value["configDir"] = "/tmp/claude-profile".into();
        let p: Provider = serde_json::from_value(value).unwrap();
        let home = tempfile::tempdir().unwrap();
        let launch = ClaudeLaunch::new(
            home.path(),
            &Selection::Provider(Box::new(p)),
            &AgentSettings::default(),
            &bot(None, &[]),
            None,
        )
        .unwrap();
        assert!(launch.file.is_none(), "a local profile must not clear its OAuth credentials");
    }

    #[test]
    fn a_providers_arguments_go_to_the_cli_and_its_settings_under_ours() {
        let home = tempfile::tempdir().unwrap();
        let file = home.path().join("team.json");
        std::fs::write(&file, r#"{"language":"french","includeCoAuthoredBy":false}"#).unwrap();
        let mut p = custom();
        p.args = vec![format!("--settings {}", file.display()), "--debug".into()];
        let lang = defaults(&[("language", "english")], true);
        let l = launch(home.path(), &Selection::Provider(Box::new(p.clone())), &lang, &bot(None, &[]));
        let written = read(l.settings_path().unwrap());
        assert_eq!(
            (written["language"].as_str(), written["includeCoAuthoredBy"].as_bool()),
            (Some("english"), Some(false))
        );
        assert_eq!(written["env"]["ANTHROPIC_BASE_URL"], "https://x.test");
        assert_eq!(Value::Object(l.args), json!({ "debug": null }));

        // A local profile otherwise needs no settings file, but its `--settings` must still be written.
        p.base_url.clear();
        p.api_key.clear();
        p.config_dir = Some(home.path().display().to_string());
        let none = AgentSettings::default();
        let l = launch(home.path(), &Selection::Provider(Box::new(p)), &none, &bot(None, &[]));
        assert_eq!(read(l.settings_path().unwrap())["includeCoAuthoredBy"], false);
    }

    fn bot(model: Option<&str>, overrides: &[(&str, &str)]) -> RunBot {
        RunBot {
            id: "b1".into(),
            name: "小王".into(),
            agent_kind: Claude,
            system_prompt: String::new(),
            tier: crate::protocol::Tier::Workspace,
            model: model.map(Into::into),
            effort: None,
            approval: Default::default(),
            allowlist: vec![],
            always_allow: vec![],
            ai_review: false,
            git: None,
            agent_settings: overrides.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        }
    }

    fn defaults(pairs: &[(&str, &str)], inherit_cli: bool) -> AgentSettings {
        AgentSettings { values: pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(), inherit_cli }
    }

    fn launch(home: &Path, selection: &Selection, d: &AgentSettings, b: &RunBot) -> ClaudeLaunch {
        let l = ClaudeLaunch::new(home, selection, d, b, None).unwrap();
        l.write().unwrap();
        l
    }

    fn read(path: &Path) -> Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn prune_keeps_only_stored_providers() {
        let home = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        let kept = store.add(custom()).unwrap();
        let mut gone = custom();
        gone.id = "gone-1".into();
        let (none, language) = (defaults(&[], true), defaults(&[("language", "english")], true));
        let mut files = vec![];
        for p in [store.get(&kept).unwrap(), &gone] {
            for d in [&none, &language] {
                let l = launch(home.path(), &Selection::Provider(Box::new(p.clone())), d, &bot(None, &[]));
                files.push(l.settings_path().unwrap().to_path_buf());
            }
        }
        std::fs::write(home.path().join("run/other.json"), "{}").unwrap();
        let official = Official { proxy: Some("http://p.test:1".into()), ..Default::default() };
        let o = launch(home.path(), &Selection::Official(official), &none, &bot(None, &[]));
        prune(home.path(), &store, None);
        let official = read(o.settings_path().unwrap());
        assert_eq!(o.settings_path(), Some(claude_settings_path(home.path(), OFFICIAL, None).as_path()));
        assert_eq!(official, json!({ "env": official["env"].clone() }), "no apiKeyHelper: the login stays");
        assert_eq!(official["env"]["HTTPS_PROXY"], "http://p.test:1");
        assert_eq!(files[0], claude_settings_path(home.path(), &kept, None), "no overlay: the plain name");
        assert!(files[1].file_name().unwrap().to_str().unwrap().starts_with(&format!("claude-{kept}.")));
        assert!(files[0].exists() && files[1].exists());
        assert!(!files[2].exists() && !files[3].exists(), "both files of the removed provider");
        assert!(home.path().join("run/other.json").exists());
    }

    #[test]
    fn the_official_logins_settings_go_under_ours_and_its_other_arguments_to_the_cli() {
        let home = tempfile::tempdir().unwrap();
        let file = home.path().join("team.json");
        let team = r#"{"includeCoAuthoredBy":false,"language":"french","env":{"HTTPS_PROXY":"http://x:2","TEAM":"1"}}"#;
        std::fs::write(&file, team).unwrap();
        let official = Official {
            proxy: Some("http://p.test:1".into()),
            args: vec![format!("--settings {}", file.display()), "--debug".into()],
            ..Default::default()
        };
        let lang = defaults(&[("language", "english")], true);
        let l = launch(home.path(), &Selection::Official(official.clone()), &lang, &bot(None, &[]));
        let written = read(l.settings_path().unwrap());
        assert_eq!(written["includeCoAuthoredBy"], false);
        assert_eq!(written["language"], "english", "共工's own settings win");
        assert_eq!(written["env"]["HTTPS_PROXY"], "http://p.test:1");
        assert_eq!(written["env"]["TEAM"], "1");
        assert_eq!(Value::Object(l.args.clone()), json!({ "debug": null }));

        // A changed settings file is a changed launch: the adapter restarts with it.
        std::fs::write(&file, r#"{"includeCoAuthoredBy":true}"#).unwrap();
        let again = launch(home.path(), &Selection::Official(official.clone()), &lang, &bot(None, &[]));
        assert!(again != l);
        std::fs::remove_file(&file).unwrap();
        let gone = ClaudeLaunch::new(home.path(), &Selection::Official(official), &lang, &bot(None, &[]), None);
        assert!(gone.is_err(), "a missing file fails the run, naming it");
    }

    fn age(path: &Path, by: Duration) {
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - by).unwrap();
    }

    fn modified(path: &Path) -> SystemTime {
        std::fs::metadata(path).unwrap().modified().unwrap()
    }

    #[test]
    fn overlay_files_not_written_lately_are_pruned() {
        let home = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        let id = store.add(custom()).unwrap();
        let p = Selection::Provider(Box::new(store.get(&id).unwrap().clone()));
        let (none, lang) = (defaults(&[], true), defaults(&[("language", "english")], true));
        let plain = launch(home.path(), &p, &none, &bot(None, &[]));
        let used = launch(home.path(), &p, &lang, &bot(None, &[]));
        let old = launch(home.path(), &p, &lang, &bot(None, &[("language", "chinese")]));
        let official = launch(home.path(), &Selection::Official(Official::default()), &lang, &bot(None, &[]));
        let hour = Duration::from_secs(3600);
        for l in [&plain, &used, &old, &official] {
            age(l.settings_path().unwrap(), hour);
        }
        used.write().unwrap();
        assert!(modified(used.settings_path().unwrap()).elapsed().unwrap() < hour, "an unchanged write marks it used");
        prune(home.path(), &store, None);
        assert!(old.settings_path().unwrap().exists(), "no age given");
        prune(home.path(), &store, Some(Duration::from_secs(60)));
        assert!(plain.settings_path().unwrap().exists(), "the provider's own file stays while it is stored");
        assert!(used.settings_path().unwrap().exists());
        assert!(!old.settings_path().unwrap().exists() && !official.settings_path().unwrap().exists());
    }

    #[test]
    fn only_the_files_and_the_cli_flag_decide_a_restart() {
        let home = tempfile::tempdir().unwrap();
        let p = Selection::Provider(Box::new(custom()));
        let d = defaults(&[], true);
        let cli = |language: &str| CliSettingsSnapshot {
            values: [("language".to_string(), language.to_string())].into(),
            conflicts: vec![],
            hooks: 0,
            permission_rules: 0,
            version: None,
            compact_env: Default::default(),
        };
        let a = ClaudeLaunch::new(home.path(), &p, &d, &bot(None, &[]), Some(&cli("english"))).unwrap();
        let b = ClaudeLaunch::new(home.path(), &p, &d, &bot(None, &[]), None).unwrap();
        assert_ne!(a.snapshot, b.snapshot);
        assert_eq!(a, b, "the CLI's config only shows in the snapshot");
    }

    #[test]
    fn invalid_bot_overrides_are_skipped() {
        let home = tempfile::tempdir().unwrap();
        let p = Selection::Provider(Box::new(custom()));
        let b = bot(None, &[("thinking", "yes"), ("attribution", "co-authored"), ("language", "english")]);
        let l = launch(home.path(), &p, &defaults(&[("thinking", "true")], true), &b);
        let s = read(l.settings_path().unwrap());
        assert_eq!((s["alwaysThinkingEnabled"].clone(), s.get("attribution")), (json!(true), None));
        assert_eq!(s["language"], "english");
        assert_eq!(l.snapshot.from_bot, vec!["language".to_string()]);
    }

    #[test]
    fn agent_defaults_then_bot_overrides_then_the_provider_then_the_connection() {
        let home = tempfile::tempdir().unwrap();
        let mut p = custom();
        p.env.insert("BASH_DEFAULT_TIMEOUT_MS".into(), "9000".into());
        let d = defaults(
            &[
                ("language", "chinese"),
                ("thinking", "true"),
                ("autoMemory", "false"),
                ("bashTimeout", "300000"),
                ("bashMaxTimeout", "600000"),
                ("nonessentialTraffic", "1"),
            ],
            true,
        );
        let b = bot(None, &[("language", "english"), ("attribution", "none"), ("autoMemory", "true")]);
        let l = launch(home.path(), &Selection::Provider(Box::new(p)), &d, &b);
        let s = read(l.settings_path().unwrap());
        assert_eq!(s["language"], "english", "the bot's override");
        assert_eq!(s["alwaysThinkingEnabled"], true, "a JSON boolean");
        assert_eq!(s["autoMemoryEnabled"], false, "not a bot override field: the machine default stays");
        assert_eq!(s["attribution"], json!({ "commit": "", "pr": "" }));
        assert_eq!(s["apiKeyHelper"], "");
        let env = &s["env"];
        assert_eq!(env["BASH_DEFAULT_TIMEOUT_MS"], "9000", "the provider's env wins");
        assert_eq!(
            (env["BASH_MAX_TIMEOUT_MS"].as_str(), env["ANTHROPIC_BASE_URL"].as_str()),
            (Some("600000"), Some("https://x.test"))
        );
        assert_eq!(env["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"], "1");
        for locked in agent_settings::LOCKED_CLAUDE_SETTINGS.iter().filter(|k| **k != "apiKeyHelper") {
            assert!(s.get(locked).is_none(), "{locked}");
        }
        assert_eq!(
            (l.snapshot.from_bot.clone(), l.snapshot.provider.as_deref()),
            (vec!["language".to_string(), "attribution".into()], Some("X"))
        );
        assert!(l.inherit_cli);
    }

    #[test]
    fn the_official_login_gets_a_file_only_with_something_to_set() {
        let home = tempfile::tempdir().unwrap();
        let official = Selection::Official(Official::default());
        let plain = ClaudeLaunch::new(home.path(), &official, &defaults(&[], true), &bot(None, &[]), None).unwrap();
        assert_eq!(plain.file, None);
        plain.write().unwrap();
        assert!(!home.path().join("run").exists());
        let l = launch(home.path(), &official, &defaults(&[("autoCompact", "false")], false), &bot(None, &[]));
        let s = read(l.settings_path().unwrap());
        assert_eq!(s, json!({ "autoCompactEnabled": false, "env": {} }));
        assert!(!l.inherit_cli && l.snapshot.provider.is_none());
    }

    #[test]
    fn the_models_context_window_fills_in_unless_the_provider_sets_one() {
        let home = tempfile::tempdir().unwrap();
        let mut p = Provider::from_preset(providers::preset(Claude, "kimi-coding").unwrap(), "sk-k-0123456789".into());
        p.id = "kimi-1".into();
        let none = defaults(&[], true);
        let l = launch(home.path(), &Selection::Provider(Box::new(p.clone())), &none, &bot(None, &[]));
        assert_eq!(
            l.settings_path(),
            Some(claude_settings_path(home.path(), "kimi-1", None).as_path()),
            "set by the preset"
        );
        assert_eq!(l.snapshot.context_window, Some(262144));
        p.env.clear();
        let l =
            launch(home.path(), &Selection::Provider(Box::new(p.clone())), &none, &bot(Some("kimi-for-coding"), &[]));
        assert_eq!(read(l.settings_path().unwrap())["env"][CONTEXT_WINDOW], "262144", "from the preset's modelContext");
        assert_ne!(l.settings_path(), Some(claude_settings_path(home.path(), "kimi-1", None).as_path()));
        assert_eq!((l.snapshot.context_window, l.snapshot.auto_compact_window), (Some(262144), None));
        assert_eq!(l.compact.point(262144), (Some(229144), None), "compacts at the model's window by default");
        let other = launch(home.path(), &Selection::Provider(Box::new(p)), &none, &bot(Some("k3"), &[]));
        assert_eq!(other.snapshot.context_window, None, "no window known for that model");
        assert_ne!(other.settings_path(), l.settings_path(), "another model, another file");
    }

    #[test]
    fn the_snapshot_says_what_comes_from_the_cli() {
        let home = tempfile::tempdir().unwrap();
        let cli = CliSettingsSnapshot {
            values: [("language", "english"), ("thinking", "true"), ("autoCompactWindow", "180000")]
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            conflicts: vec!["CLAUDE_CODE_EFFORT_LEVEL".into(), "ANTHROPIC_BASE_URL".into()],
            hooks: 0,
            permission_rules: 0,
            version: None,
            compact_env: Default::default(),
        };
        let p = Selection::Provider(Box::new(custom()));
        let d = defaults(&[("thinking", "false")], true);
        let l = ClaudeLaunch::new(home.path(), &p, &d, &bot(None, &[]), Some(&cli)).unwrap();
        assert_eq!(l.snapshot.from_cli, vec!["autoCompactWindow", "language", "CLAUDE_CODE_EFFORT_LEVEL"]);
        assert_eq!(l.snapshot.auto_compact_window, Some(180000));
        assert_eq!((l.compact.point(150000).0, l.compact.point(262144).0), (Some(117000), Some(147000)));
        let isolated = ClaudeLaunch::new(home.path(), &p, &defaults(&[], false), &bot(None, &[]), Some(&cli)).unwrap();
        assert!(isolated.snapshot.from_cli.is_empty() && isolated.snapshot.auto_compact_window.is_none());
        assert_ne!(isolated, l);
    }

    #[test]
    fn the_compact_policy_follows_settings_env_and_the_cli() {
        let home = tempfile::tempdir().unwrap();
        let mut p = custom();
        let cli = |values: &[(&str, &str)], env: &[(&str, &str)]| CliSettingsSnapshot {
            values: values.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            conflicts: vec![],
            hooks: 0,
            permission_rules: 0,
            version: None,
            compact_env: env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        };
        let policy = |p: &Provider, d: &AgentSettings, c: Option<&CliSettingsSnapshot>| {
            ClaudeLaunch::new(home.path(), &Selection::Provider(Box::new(p.clone())), d, &bot(None, &[]), c)
                .unwrap()
                .compact
        };
        let none = defaults(&[], true);
        assert_eq!(policy(&p, &none, None), CompactPolicy { window: None, max_output: None, pct: None, enabled: true });
        assert!(!policy(&p, &defaults(&[("autoCompact", "false")], true), None).enabled, "the agent setting");
        assert!(!policy(&p, &none, Some(&cli(&[("autoCompact", "false")], &[]))).enabled, "inherited from the CLI");
        assert!(
            policy(&p, &defaults(&[("autoCompact", "true")], true), Some(&cli(&[("autoCompact", "false")], &[])))
                .enabled
        );
        assert!(!policy(&p, &none, Some(&cli(&[], &[("DISABLE_COMPACT", "true")]))).enabled, "the CLI's env");
        assert!(
            policy(&p, &defaults(&[], false), Some(&cli(&[], &[("DISABLE_COMPACT", "1")]))).enabled,
            "not inherited"
        );
        let pct =
            policy(&p, &none, Some(&cli(&[("maxOutputTokens", "8000")], &[("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "75")])));
        assert_eq!((pct.max_output, pct.pct), (Some(8000), Some(75.0)));
        p.env.insert("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE".into(), "150".into());
        p.env.insert("DISABLE_AUTO_COMPACT".into(), "0".into());
        p.env.insert(AUTO_COMPACT.into(), "180000".into());
        let from_provider = policy(&p, &none, None);
        assert_eq!((from_provider.window, from_provider.pct, from_provider.enabled), (Some(180000), None, true));
        p.env.insert("DISABLE_AUTO_COMPACT".into(), "1".into());
        assert!(!policy(&p, &none, None).enabled, "the provider's env");
    }

    #[test]
    fn model_prefers_the_bots_pick_among_the_providers_models() {
        let p = Provider::from_preset(providers::preset(Codex, "zhipu").unwrap(), "k".into());
        assert_eq!(model(&p, Some("glm-5.3-flash")).as_deref(), Some("glm-5.3-flash"), "from the preset's options");
        assert_eq!(model(&p, Some("gpt-5")).as_deref(), Some("glm-5.3"));
        assert_eq!(model(&p, None).as_deref(), Some("glm-5.3"));
        assert_eq!(model(&custom(), Some("opus")), None);
    }

    #[test]
    fn codebuddy_sets_a_base_url_only_for_a_third_party_service() {
        let p = |url: &str| Provider::custom(crate::protocol::AgentKind::Codebuddy, "C".into(), url.into(), "k".into());
        assert_eq!(codebuddy_base_url(&p("https://copilot.tencent.com/")), None);
        assert_eq!(codebuddy_base_url(&p("https://www.codebuddy.ai")), None);
        assert_eq!(codebuddy_base_url(&p("https://openrouter.ai/api/v1")), Some("https://openrouter.ai/api/v1"));
    }
}
