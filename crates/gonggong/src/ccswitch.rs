//! Read-only import from this machine's CC Switch (`~/.cc-switch`, design §4.5) and its
//! `ccswitch://v1/import?resource=provider…` links. Only claude and codex providers that talk to their endpoint
//! directly are taken; CC Switch itself is never written to.
use crate::protocol::AgentKind;
use crate::providers::{
    API_KEY, AUTH_TOKEN, EXTRA_ENV, ModelMap, Provider, Source, SourceKind, Store, WIRE_RESPONSES, mask_key,
};
use crate::t;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// One importable provider; `key` (`<agent>:<CC Switch id>`) is what [`apply`] takes.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub key: String,
    /// CC Switch's current provider for that agent.
    pub current: bool,
    pub provider: Provider,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateView {
    pub key: String,
    pub agent: AgentKind,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: Option<String>,
    pub current: bool,
    /// The local provider an import would update instead of adding one.
    pub existing: Option<String>,
}

/// A provider row as CC Switch stores it (database or config.json).
struct Row {
    id: String,
    app: String,
    name: String,
    settings: Value,
    category: Option<String>,
    meta: Value,
    current: bool,
}

/// Database first, then the v2 `config.json`, then its archived `config.json.migrated`.
pub fn read(dir: &Path) -> Result<Vec<Candidate>> {
    let db = dir.join("cc-switch.db");
    let rows = if db.is_file() {
        read_db(&db)?
    } else {
        match ["config.json", "config.json.migrated"].iter().find_map(|f| read_json(&dir.join(f)).transpose()) {
            Some(rows) => rows?,
            None => bail!(t!("没有找到 CC Switch 配置（{path}）", path = dir.display())),
        }
    };
    let settings: Value = match std::fs::read_to_string(dir.join("settings.json")) {
        Ok(s) => serde_json::from_str(&s).context(t!("CC Switch settings.json 已损坏"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(e) => return Err(e.into()),
    };
    let mut out = vec![];
    for row in rows {
        let agent = match row.app.as_str() {
            "claude" => AgentKind::Claude,
            "codex" => AgentKind::Codex,
            _ => continue,
        };
        let current_key = match agent {
            AgentKind::Claude => "currentProviderClaude",
            AgentKind::Codex => "currentProviderCodex",
        };
        let current = match settings[current_key].as_str() {
            Some(id) => id == row.id,
            None => row.current,
        };
        if let Some(mut provider) = to_provider(agent, &row)? {
            provider.source = Some(Source { kind: SourceKind::CcSwitch, id: Some(row.id.clone()) });
            out.push(Candidate { key: format!("{}:{}", row.app, row.id), current, provider });
        }
    }
    Ok(out)
}

fn read_db(path: &Path) -> Result<Vec<Row>> {
    use rusqlite::{Connection, OpenFlags};
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .context(t!("无法只读打开 CC Switch 数据库"))?;
    // Older CC Switch schemas lack the columns added by later migrations.
    let columns: HashSet<String> = conn
        .prepare("PRAGMA table_info(providers)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;
    if columns.is_empty() {
        bail!(t!("CC Switch 数据库里没有 providers 表"));
    }
    let column =
        |name: &str, fallback: &str| if columns.contains(name) { name.to_string() } else { fallback.to_string() };
    let sql = format!(
        "SELECT id, app_type, name, settings_config, {}, {}, {} FROM providers \
         WHERE app_type IN ('claude', 'codex') ORDER BY rowid",
        column("category", "NULL"),
        column("meta", "'{}'"),
        column("is_current", "0"),
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        let settings: String = r.get(3)?;
        let meta: String = r.get(5)?;
        Ok(Row {
            id: r.get(0)?,
            app: r.get(1)?,
            name: r.get(2)?,
            settings: serde_json::from_str(&settings).unwrap_or(Value::Null),
            category: r.get(4)?,
            meta: serde_json::from_str(&meta).unwrap_or(Value::Null),
            current: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// `None` when the file is absent or not the v2 layout (`{ "claude": { "providers": {…}, "current": "…" }, … }`).
fn read_json(path: &Path) -> Result<Option<Vec<Row>>> {
    let text = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let doc: Value = serde_json::from_str(&text).with_context(|| t!("{path} 已损坏", path = path.display()))?;
    let apps: Vec<_> = ["claude", "codex"].into_iter().filter(|a| doc[a]["providers"].is_object()).collect();
    if apps.is_empty() {
        return Ok(None);
    }
    let mut rows = vec![];
    for app in apps {
        let current = doc[app]["current"].as_str();
        for (id, p) in doc[app]["providers"].as_object().unwrap() {
            rows.push(Row {
                id: id.clone(),
                app: app.into(),
                name: p["name"].as_str().unwrap_or(id).into(),
                settings: p["settingsConfig"].clone(),
                category: p["category"].as_str().map(Into::into),
                meta: p["meta"].clone(),
                current: current == Some(id.as_str()),
            });
        }
    }
    Ok(Some(rows))
}

/// `None` for what Gonggong cannot use directly: the official login, formats that need CC Switch's local proxy, and
/// entries without an endpoint or key.
fn to_provider(agent: AgentKind, row: &Row) -> Result<Option<Provider>> {
    if row.category.as_deref() == Some("official") {
        return Ok(None);
    }
    let direct = match agent {
        AgentKind::Claude => "anthropic",
        AgentKind::Codex => "openai_responses",
    };
    if row.meta["apiFormat"].as_str().is_some_and(|f| f != direct) {
        return Ok(None);
    }
    match agent {
        AgentKind::Claude => {
            let empty = Map::new();
            let env = row.settings["env"].as_object().unwrap_or(&empty);
            Ok(claude(&row.name, env, row.meta["apiKeyField"].as_str()))
        }
        AgentKind::Codex => {
            let Some(config) = row.settings["config"].as_str() else { return Ok(None) };
            let parts = codex_parts(row.settings.get("auth"), config)?;
            Ok(parts.into_provider(&row.name, None, None, None))
        }
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(Into::into)
}

/// From Claude Code `settings.json`-style env: only the connection keys and [`EXTRA_ENV`].
fn claude(name: &str, env: &Map<String, Value>, key_field: Option<&str>) -> Option<Provider> {
    let get = |k: &str| text(env.get(k));
    let base_url = get("ANTHROPIC_BASE_URL")?;
    let field = [key_field, Some(AUTH_TOKEN), Some(API_KEY)]
        .into_iter()
        .flatten()
        .find(|f| [AUTH_TOKEN, API_KEY].contains(f) && get(f).is_some())?;
    let models = ModelMap {
        haiku: get("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
        sonnet: get("ANTHROPIC_DEFAULT_SONNET_MODEL"),
        opus: get("ANTHROPIC_DEFAULT_OPUS_MODEL"),
    };
    Some(Provider {
        api_key_field: Some(field.into()),
        model: get("ANTHROPIC_MODEL"),
        models: (models != ModelMap::default()).then_some(models),
        env: EXTRA_ENV.iter().filter_map(|k| Some((k.to_string(), get(k)?))).collect(),
        ..Provider::custom(AgentKind::Claude, name.into(), base_url, get(field)?)
    })
}

/// Connection fields of a Codex `config.toml` (+ `auth.json`) as CC Switch stores them.
#[derive(Default)]
struct CodexParts {
    key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    wire_api: Option<String>,
}

impl CodexParts {
    /// Arguments override what the config says (link parameters win over the attached config).
    fn into_provider(
        self,
        name: &str,
        key: Option<String>,
        base_url: Option<String>,
        model: Option<String>,
    ) -> Option<Provider> {
        if self.wire_api.as_deref().is_some_and(|w| w != WIRE_RESPONSES) {
            return None;
        }
        Some(Provider {
            model: model.or(self.model),
            effort: self.effort,
            ..Provider::custom(AgentKind::Codex, name.into(), base_url.or(self.base_url)?, key.or(self.key)?)
        })
    }
}

/// Key: `auth.OPENAI_API_KEY` → `[model_providers.<current>].experimental_bearer_token` → top level.
/// Base URL: `[model_providers.<current>].base_url` → top-level `base_url` / `openai_base_url`.
fn codex_parts(auth: Option<&Value>, config: &str) -> Result<CodexParts> {
    if config.trim().is_empty() {
        return Ok(CodexParts { key: text(auth.and_then(|a| a.get("OPENAI_API_KEY"))), ..Default::default() });
    }
    let doc: toml::Table = toml::from_str(config).context(t!("CC Switch 的 Codex 配置不是合法的 TOML"))?;
    let get = |t: Option<&toml::Table>, k: &str| {
        t.and_then(|t| t.get(k)).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
    };
    let top = Some(&doc);
    let section = get(top, "model_provider").and_then(|id| {
        doc.get("model_providers").and_then(|v| v.as_table()).and_then(|t| t.get(&id)).and_then(|v| v.as_table())
    });
    Ok(CodexParts {
        key: text(auth.and_then(|a| a.get("OPENAI_API_KEY")))
            .or_else(|| get(section, "experimental_bearer_token"))
            .or_else(|| get(top, "experimental_bearer_token")),
        base_url: get(section, "base_url").or_else(|| get(top, "base_url")).or_else(|| get(top, "openai_base_url")),
        model: get(top, "model"),
        effort: get(top, "model_reasoning_effort"),
        wire_api: get(section, "wire_api"),
    })
}

/// Masked, with the local provider each would update.
pub fn preview(candidates: &[Candidate], store: &Store) -> Vec<CandidateView> {
    candidates
        .iter()
        .map(|c| CandidateView {
            key: c.key.clone(),
            agent: c.provider.agent,
            name: c.provider.name.clone(),
            base_url: c.provider.base_url.clone(),
            api_key: mask_key(&c.provider.api_key),
            model: c.provider.model.clone(),
            current: c.current,
            existing: store.duplicate_of(&c.provider).map(|p| p.id.clone()),
        })
        .collect()
}

/// Imports the chosen candidates (deduplicated, §4.5); `set_default` also makes CC Switch's current provider of
/// each agent the machine default when it is among them. Returns the local ids.
pub fn apply(candidates: &[Candidate], keys: &[String], set_default: bool, store: &mut Store) -> Result<Vec<String>> {
    let by_key: HashMap<_, _> = candidates.iter().map(|c| (c.key.as_str(), c)).collect();
    let mut ids = vec![];
    for key in keys {
        let c = by_key.get(key.as_str()).with_context(|| t!("CC Switch 里没有可导入的 {key}", key = key))?;
        let id = store.upsert(c.provider.clone())?;
        if set_default && c.current {
            store.use_machine(c.provider.agent, &id)?;
        }
        ids.push(id);
    }
    Ok(ids)
}

/// `ccswitch://v1/import?resource=provider&app=claude|codex&name=…&endpoint=a,b&apiKey=…&model=…` plus optional
/// `haikuModel`/`sonnetModel`/`opusModel` and a base64 `config` (`configFormat` json|toml) whose values the explicit
/// parameters override. Returns a provider without an id, for [`Store::upsert`].
pub fn parse_link(link: &str) -> Result<Provider> {
    let url = url::Url::parse(link.trim()).context(t!("不是合法的链接"))?;
    if url.scheme() != "ccswitch" || url.host_str() != Some("v1") || url.path() != "/import" {
        bail!(t!("不是 CC Switch 导入链接（ccswitch://v1/import?…）"));
    }
    let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let param = |k: &str| q.get(k).map(|v| v.trim()).filter(|v| !v.is_empty()).map(String::from);
    if param("resource").as_deref() != Some("provider") {
        bail!(t!("只能导入供应商（resource=provider）"));
    }
    let agent = match param("app").as_deref() {
        Some("claude") => AgentKind::Claude,
        Some("codex") => AgentKind::Codex,
        other => bail!(t!("只支持 claude 与 codex 的供应商，链接里是 {app}", app = other.unwrap_or(t!("（空）")))),
    };
    let name = param("name").context(t!("链接缺少 name"))?;
    let endpoints: Vec<&str> = q.get("endpoint").map_or(vec![], |e| e.split(',').map(str::trim).collect());
    for e in endpoints.iter().filter(|e| !e.is_empty()) {
        if !matches!(url::Url::parse(e).map(|u| u.scheme().to_string()).as_deref(), Ok("http" | "https")) {
            bail!(t!("endpoint 不是 http(s) 地址：{e}", e = e));
        }
    }
    let endpoint = endpoints.into_iter().find(|e| !e.is_empty()).map(String::from);
    let config = match param("config") {
        Some(b64) => Some(decode_config(&b64, param("configFormat").as_deref().unwrap_or("json"))?),
        None => None,
    };
    let provider = match agent {
        AgentKind::Claude => {
            let mut env = config.as_ref().and_then(|c| c["env"].as_object()).cloned().unwrap_or_default();
            let overrides = [
                ("ANTHROPIC_AUTH_TOKEN", param("apiKey")),
                ("ANTHROPIC_BASE_URL", endpoint),
                ("ANTHROPIC_MODEL", param("model")),
                ("ANTHROPIC_DEFAULT_HAIKU_MODEL", param("haikuModel")),
                ("ANTHROPIC_DEFAULT_SONNET_MODEL", param("sonnetModel")),
                ("ANTHROPIC_DEFAULT_OPUS_MODEL", param("opusModel")),
            ];
            for (k, v) in overrides {
                if let Some(v) = v {
                    env.insert(k.into(), Value::String(v));
                }
            }
            claude(&name, &env, None)
        }
        AgentKind::Codex => {
            let parts = match config.as_ref().and_then(|c| c["config"].as_str()) {
                Some(toml) => codex_parts(config.as_ref().and_then(|c| c.get("auth")), toml)?,
                None => CodexParts {
                    key: text(config.as_ref().and_then(|c| c.get("auth")).and_then(|a| a.get("OPENAI_API_KEY"))),
                    ..Default::default()
                },
            };
            parts.into_provider(&name, param("apiKey"), endpoint, param("model"))
        }
    };
    let mut provider = provider.context(t!("链接缺少 API Key 或 endpoint，或不是直连格式"))?;
    provider.source = Some(Source { kind: SourceKind::Link, id: None });
    Ok(provider)
}

/// Tolerates what links do to base64: `+` turned into a space, missing padding, URL-safe alphabet.
fn decode_config(b64: &str, format: &str) -> Result<Value> {
    use base64::Engine;
    use base64::engine::general_purpose::{STANDARD_PAD_INDIFFERENT, URL_SAFE_PAD_INDIFFERENT};
    let b64 = b64.replace(' ', "+");
    let bytes = STANDARD_PAD_INDIFFERENT
        .decode(&b64)
        .or_else(|_| URL_SAFE_PAD_INDIFFERENT.decode(&b64))
        .context(t!("config 参数不是合法的 Base64"))?;
    let text = String::from_utf8(bytes).context(t!("config 参数不是 UTF-8 文本"))?;
    match format {
        "json" => serde_json::from_str(&text).context(t!("config 不是合法的 JSON")),
        "toml" => {
            Ok(serde_json::to_value(toml::from_str::<toml::Table>(&text).context(t!("config 不是合法的 TOML"))?)?)
        }
        other => bail!(t!("不支持的 configFormat：{format}", format = other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::Selection;
    use base64::Engine;
    use serde_json::json;

    const CLAUDE_KEY: &str = "sk-claude-secret-111122223333";
    const CODEX_KEY: &str = "sk-codex-secret-444455556666";

    /// `providers` as created by CC Switch 36d9504 (`src-tauri/src/database/schema.rs`).
    const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS providers (
        id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL,
        website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, icon TEXT,
        icon_color TEXT, meta TEXT NOT NULL DEFAULT '{}', is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0, PRIMARY KEY (id, app_type))";
    /// Before the v0 → v1 migration added category, meta, is_current and friends.
    const SCHEMA_V0: &str = "CREATE TABLE providers (
        id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL,
        website_url TEXT, PRIMARY KEY (id, app_type))";

    fn kimi_settings(model: &str) -> Value {
        json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://api.moonshot.cn/anthropic",
                "ANTHROPIC_AUTH_TOKEN": CLAUDE_KEY,
                "ANTHROPIC_MODEL": model,
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "kimi-k2.7-code",
                "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "262144",
                "HTTP_PROXY": "http://127.0.0.1:7890"
            },
            "hooks": { "Stop": [] }
        })
    }

    fn glm_settings() -> Value {
        json!({
            "auth": { "OPENAI_API_KEY": CODEX_KEY },
            "config": "model_provider = \"custom\"\nmodel = \"glm-5.3\"\nmodel_reasoning_effort = \"high\"\n\n\
                       [model_providers.custom]\nname = \"zhipu\"\nbase_url = \"https://open.bigmodel.cn/api/v1\"\n\
                       wire_api = \"responses\"\nrequires_openai_auth = true\n"
        })
    }

    fn db(dir: &Path, model: &str) {
        let conn = rusqlite::Connection::open(dir.join("cc-switch.db")).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let bearer = json!({
            "auth": {},
            "config": "model_provider = \"relay\"\nmodel = \"gpt-5\"\nopenai_base_url = \"https://relay.test/v1\"\n\
                       [model_providers.relay]\nexperimental_bearer_token = \"sk-bearer-777788889999\"\n"
        });
        let rows = [
            ("kimi", "claude", "Kimi", kimi_settings(model), Some("cn_official"), json!({}), true),
            ("claude-official", "claude", "Claude Official", json!({"env": {}}), Some("official"), json!({}), false),
            (
                "copilot",
                "claude",
                "Copilot",
                json!({"env": {"ANTHROPIC_BASE_URL": "https://api.githubcopilot.com", "ANTHROPIC_AUTH_TOKEN": "x"}}),
                None,
                json!({"apiFormat": "openai_chat"}),
                false,
            ),
            (
                "aihub",
                "claude",
                "AiHubMix",
                json!({"env": {"ANTHROPIC_BASE_URL": "https://aihubmix.com", "ANTHROPIC_API_KEY": "sk-aihub-000011112222"}}),
                Some("aggregator"),
                json!({"apiKeyField": "ANTHROPIC_API_KEY"}),
                false,
            ),
            ("glm", "codex", "Zhipu GLM", glm_settings(), Some("cn_official"), json!({}), true),
            ("relay", "codex", "Relay", bearer, None, json!({}), false),
            ("gem", "gemini", "Gemini", json!({"env": {}}), None, json!({}), true),
        ];
        for (id, app, name, settings, category, meta, current) in rows {
            conn.execute(
                "INSERT INTO providers (id, app_type, name, settings_config, category, meta, is_current) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, app, name, settings.to_string(), category, meta.to_string(), current],
            )
            .unwrap();
        }
    }

    fn keys(candidates: &[Candidate]) -> Vec<&str> {
        candidates.iter().map(|c| c.key.as_str()).collect()
    }

    #[test]
    fn reads_the_database_keeping_only_direct_claude_and_codex_providers() {
        let dir = tempfile::tempdir().unwrap();
        db(dir.path(), "kimi-k2.7-code");
        std::fs::write(dir.path().join("settings.json"), r#"{"currentProviderCodex":"relay"}"#).unwrap();
        let c = read(dir.path()).unwrap();
        assert_eq!(keys(&c), ["claude:kimi", "claude:aihub", "codex:glm", "codex:relay"]);

        let kimi = &c[0].provider;
        assert!(c[0].current, "no settings.json entry for claude: is_current decides");
        assert_eq!((kimi.base_url.as_str(), kimi.api_key.as_str()), ("https://api.moonshot.cn/anthropic", CLAUDE_KEY));
        assert_eq!(kimi.api_key_field.as_deref(), Some(AUTH_TOKEN));
        assert_eq!(kimi.models.as_ref().unwrap().sonnet.as_deref(), Some("kimi-k2.7-code"));
        assert_eq!(kimi.env.keys().collect::<Vec<_>>(), ["CLAUDE_CODE_MAX_CONTEXT_TOKENS"], "proxy/hooks dropped");
        assert_eq!(kimi.source, Some(Source { kind: SourceKind::CcSwitch, id: Some("kimi".into()) }));
        assert_eq!(c[1].provider.api_key_field.as_deref(), Some(API_KEY));

        let glm = &c[2].provider;
        assert!(!c[2].current, "settings.json overrides is_current");
        assert_eq!((glm.base_url.as_str(), glm.api_key.as_str()), ("https://open.bigmodel.cn/api/v1", CODEX_KEY));
        assert_eq!((glm.model.as_deref(), glm.effort.as_deref()), (Some("glm-5.3"), Some("high")));
        let relay = &c[3].provider;
        assert!(c[3].current);
        assert_eq!(
            (relay.base_url.as_str(), relay.api_key.as_str()),
            ("https://relay.test/v1", "sk-bearer-777788889999")
        );
    }

    #[test]
    fn reads_an_older_schema_without_the_later_columns() {
        let dir = tempfile::tempdir().unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("cc-switch.db")).unwrap();
        conn.execute_batch(SCHEMA_V0).unwrap();
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES ('kimi', 'claude', 'Kimi', ?1)",
            [kimi_settings("kimi-k2.7-code").to_string()],
        )
        .unwrap();
        std::fs::write(dir.path().join("settings.json"), r#"{"currentProviderClaude":"kimi"}"#).unwrap();
        let c = read(dir.path()).unwrap();
        assert_eq!(keys(&c), ["claude:kimi"]);
        assert!(c[0].current);
    }

    #[test]
    fn falls_back_to_config_json_v2_then_migrated() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read(dir.path()).is_err(), "nothing to read");
        let config = json!({
            "version": 2,
            "claude": { "providers": {
                "kimi": { "id": "kimi", "name": "Kimi", "settingsConfig": kimi_settings("kimi-k2.7-code"), "category": "cn_official" },
                "official": { "id": "official", "name": "Claude Official", "settingsConfig": {"env": {}}, "category": "official" }
            }, "current": "kimi" },
            "codex": { "providers": { "glm": { "id": "glm", "name": "Zhipu GLM", "settingsConfig": glm_settings() } }, "current": "" },
            "mcp": {}
        });
        std::fs::write(dir.path().join("config.json.migrated"), config.to_string()).unwrap();
        let c = read(dir.path()).unwrap();
        assert_eq!(keys(&c), ["claude:kimi", "codex:glm"]);
        assert!(c[0].current && !c[1].current);
        // A v1 config.json (no per-app managers) is skipped in favour of the archive.
        std::fs::write(dir.path().join("config.json"), r#"{"providers":{},"current":""}"#).unwrap();
        assert_eq!(keys(&read(dir.path()).unwrap()), ["claude:kimi", "codex:glm"]);
    }

    #[test]
    fn preview_is_masked_and_apply_dedupes_updating_the_revision() {
        let dir = tempfile::tempdir().unwrap();
        db(dir.path(), "kimi-k2.7-code");
        let c = read(dir.path()).unwrap();
        let mut store = Store::default();
        let manual = Provider::custom(
            AgentKind::Codex,
            "我的智谱".into(),
            "https://open.bigmodel.cn/api/v1/".into(),
            CODEX_KEY.into(),
        );
        let manual = store.add(manual).unwrap();

        let view = preview(&c, &store);
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains(CLAUDE_KEY) && !json.contains(CODEX_KEY) && !json.contains("bearer-7777"));
        assert_eq!(view[2].existing.as_deref(), Some(manual.as_str()), "same base URL + key as a local provider");
        assert_eq!(view[0].existing, None);

        let all: Vec<_> = c.iter().map(|c| c.key.clone()).collect();
        let ids = apply(&c, &all, true, &mut store).unwrap();
        assert_eq!(ids[2], manual);
        assert_eq!(store.providers.len(), 4);
        assert_eq!(store.get(&manual).unwrap().revision, 2);
        assert_eq!(store.machine_default(AgentKind::Claude).unwrap().key(), ids[0], "CC Switch current → default");
        assert_eq!(store.machine_default(AgentKind::Codex).unwrap().key(), ids[2]);

        assert_eq!(apply(&c, &all, false, &mut store).unwrap(), ids, "re-import matches by source id");
        assert_eq!(store.get(&ids[0]).unwrap().revision, 1);

        let changed = tempfile::tempdir().unwrap();
        db(changed.path(), "kimi-k3");
        let c = read(changed.path()).unwrap();
        apply(&c, &["claude:kimi".into()], false, &mut store).unwrap();
        let kimi = store.get(&ids[0]).unwrap();
        assert_eq!((kimi.revision, kimi.model.as_deref()), (2, Some("kimi-k3")));
        assert_eq!(store.providers.len(), 4);
        assert!(apply(&c, &["claude:nope".into()], false, &mut store).is_err());
        assert!(matches!(store.effective(AgentKind::Claude, "b").unwrap(), Selection::Provider(_)));
    }

    fn b64(v: &Value) -> String {
        base64::engine::general_purpose::STANDARD.encode(v.to_string())
    }

    #[test]
    fn parses_claude_links_with_params_over_config() {
        let config = json!({"env": {
            "ANTHROPIC_BASE_URL": "https://ignored.test",
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "o-from-config",
            "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "32000",
            "HTTP_PROXY": "http://proxy"
        }});
        let link = url::Url::parse_with_params(
            "ccswitch://v1/import",
            [
                ("resource", "provider"),
                ("app", "claude"),
                ("name", "My Kimi"),
                ("endpoint", "https://api.kimi.com/coding/, https://backup.test"),
                ("apiKey", CLAUDE_KEY),
                ("model", "kimi-for-coding"),
                ("haikuModel", "h"),
                ("config", &b64(&config)),
            ],
        )
        .unwrap();
        let p = parse_link(link.as_str()).unwrap();
        assert_eq!((p.agent, p.name.as_str()), (AgentKind::Claude, "My Kimi"));
        assert_eq!((p.base_url.as_str(), p.api_key.as_str()), ("https://api.kimi.com/coding/", CLAUDE_KEY));
        assert_eq!(p.model.as_deref(), Some("kimi-for-coding"));
        let models = p.models.unwrap();
        assert_eq!((models.haiku.as_deref(), models.opus.as_deref()), (Some("h"), Some("o-from-config")));
        assert_eq!(p.env.keys().collect::<Vec<_>>(), ["CLAUDE_CODE_MAX_OUTPUT_TOKENS"]);
        assert_eq!(p.source, Some(Source { kind: SourceKind::Link, id: None }));
    }

    #[test]
    fn parses_codex_links_from_the_attached_config() {
        let config = json!({
            "auth": {"OPENAI_API_KEY": CODEX_KEY},
            "config": "model_provider = \"c\"\nmodel = \"glm-5.3\"\n[model_providers.c]\nbase_url = \"https://open.bigmodel.cn/api/v1\"\n"
        });
        // URL-safe, unpadded, `+` mangled into a space: all tolerated.
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(config.to_string());
        let link = format!("ccswitch://v1/import?resource=provider&app=codex&name=GLM&config={encoded}");
        let p = parse_link(&link).unwrap();
        assert_eq!(
            (p.agent, p.base_url.as_str(), p.api_key.as_str()),
            (AgentKind::Codex, "https://open.bigmodel.cn/api/v1", CODEX_KEY)
        );
        assert_eq!((p.model.as_deref(), p.wire_api.as_deref()), (Some("glm-5.3"), Some(WIRE_RESPONSES)));

        let plain = "ccswitch://v1/import?resource=provider&app=codex&name=X&endpoint=https%3A%2F%2Fx.test%2Fv1&apiKey=sk-x-000011112222&model=m";
        let p = parse_link(plain).unwrap();
        assert_eq!((p.base_url.as_str(), p.model.as_deref()), ("https://x.test/v1", Some("m")));

        for bad in [
            "https://v1/import?resource=provider&app=codex&name=X",
            "ccswitch://v1/import?resource=mcp&app=codex&name=X",
            "ccswitch://v1/import?resource=provider&app=gemini&name=X&endpoint=https://x.test&apiKey=k",
            "ccswitch://v1/import?resource=provider&app=codex&name=X&endpoint=https://x.test",
            "ccswitch://v1/import?resource=provider&app=codex&name=X&endpoint=ftp://x.test&apiKey=k",
            "ccswitch://v1/import?resource=provider&app=claude&endpoint=https://x.test&apiKey=k",
        ] {
            assert!(parse_link(bad).is_err(), "{bad}");
        }
    }
}
