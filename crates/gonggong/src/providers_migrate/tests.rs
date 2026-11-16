use super::*;
use crate::protocol::AgentKind::{Claude, Codex, Deepseek, Pi};
use crate::providers::{API_KEY, AUTH_TOKEN, RunPlan, Selection};
use serde_json::json;

const KIMI_KEY: &str = "sk-kimi-0123456789abcd";
const DEEPSEEK_KEY: &str = "sk-deepseek-0123456789wxyz";

/// A v1 providers.json as daemons up to 0.4.21 wrote it: Kimi For Coding added for Claude Code and again for Codex
/// (same key, `/coding/` and `/coding/v1` on one host), DeepSeek added for Claude Code and for DeepSeek Harness (the
/// same URL, once with a trailing slash), a relay on Kimi's host for Claude, two local Claude profiles and a pi
/// provider from before pi kept its own login.
fn v1(profile: &Path) -> serde_json::Value {
    json!({
        "machine": { "claude": "kimi-coding-1a2b", "codex": "kimi-coding-3c4d", "deepseek": "deepseek-9f00", "pi": "pi-7a7a" },
        "official": { "claude": { "env": { "DISABLE_TELEMETRY": "1" } } },
        "bots": { "b1": "kimi-coding-3c4d", "b2": "deepseek-5e6f", "b3": "pi-7a7a", "b4": "official", "b5": "work-0a1b" },
        "providers": [
            {
                "id": "kimi-coding-1a2b", "agent": "claude", "name": "Kimi For Coding", "presetId": "kimi-coding",
                "revision": 2, "baseUrl": "https://api.kimi.com/coding/", "apiKey": KIMI_KEY,
                "apiKeyField": AUTH_TOKEN, "model": "kimi-for-coding",
                "models": { "haiku": "kimi-for-coding", "sonnet": "kimi-for-coding" },
                "env": { "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "262144" },
                "source": { "kind": "cc-switch", "id": "d1f0" }
            },
            {
                "id": "kimi-coding-3c4d", "agent": "codex", "name": "Kimi For Coding (Codex)", "presetId": "kimi-coding",
                "revision": 5, "baseUrl": "https://api.kimi.com/coding/v1", "apiKey": KIMI_KEY,
                "model": "kimi-for-coding", "wireApi": "responses", "effort": "high"
            },
            {
                "id": "deepseek-5e6f", "agent": "claude", "name": "DeepSeek", "presetId": "deepseek", "revision": 1,
                "baseUrl": "https://api.deepseek.com/anthropic", "apiKey": DEEPSEEK_KEY, "apiKeyField": AUTH_TOKEN,
                "model": "deepseek-v4-pro", "env": { "API_TIMEOUT_MS": "300000", "ENABLE_TOOL_SEARCH": "1" }
            },
            {
                "id": "deepseek-9f00", "agent": "deepseek", "name": "DeepSeek Harness", "presetId": "deepseek",
                "revision": 3, "baseUrl": "https://api.deepseek.com/anthropic/", "apiKey": DEEPSEEK_KEY,
                "env": { "API_TIMEOUT_MS": "600000" }
            },
            {
                "id": "work-0a1b", "agent": "claude", "name": "Work Claude", "revision": 1, "baseUrl": "",
                "apiKey": "", "configDir": profile.display().to_string(), "args": ["--debug"]
            },
            {
                "id": "home-0c0d", "agent": "claude", "name": "Home Claude", "revision": 1, "baseUrl": "",
                "apiKey": "", "configDir": profile.display().to_string()
            },
            {
                "id": "pi-7a7a", "agent": "pi", "name": "pi relay", "revision": 1,
                "baseUrl": "https://api.kimi.com/coding/", "apiKey": KIMI_KEY
            },
            {
                "id": "relay-7777", "agent": "claude", "name": "Kimi relay", "revision": 4,
                "baseUrl": "https://api.kimi.com/anthropic", "apiKey": KIMI_KEY, "apiKeyField": API_KEY
            }
        ],
        "agentSettings": { "claude": { "values": { "language": "chinese" }, "inheritCli": false } },
        "sessions": {
            "s1": { "provider": "kimi-coding-1a2b", "agent": "claude", "groupId": "g1", "botId": "b0", "pinnedAt": 1 },
            "s2": { "provider": "deepseek-5e6f", "agent": "claude", "groupId": "g1", "botId": "b2", "pinnedAt": 2 },
            "s3": { "provider": "pi-7a7a", "agent": "pi", "groupId": "g1", "botId": "b3", "pinnedAt": 3 },
            "s4": { "provider": "official", "agent": "codex", "groupId": "g2", "botId": "b4", "pinnedAt": 4 }
        }
    })
}

fn legacy(profile: &Path) -> LegacyStore {
    serde_json::from_value(v1(profile)).unwrap()
}

#[test]
fn copies_of_one_vendor_merge_into_endpoints_per_protocol() {
    let profile = tempfile::tempdir().unwrap();
    let (store, report) = migrate(legacy(profile.path()));
    let ids: Vec<_> = store.providers.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["kimi-coding-3c4d", "relay-7777", "deepseek-9f00", "work-0a1b", "home-0c0d"]);

    // Both Kimi copies are machine defaults: the newer revision wins, the other one's endpoint joins it.
    let kimi = store.get("kimi-coding-3c4d").unwrap();
    assert_eq!((kimi.name.as_str(), kimi.revision, kimi.api_key.as_str()), ("Kimi For Coding (Codex)", 6, KIMI_KEY));
    assert_eq!(kimi.preset_id.as_deref(), Some("kimi-coding"));
    let protocols: Vec<_> = kimi.endpoints.iter().map(|e| e.protocol).collect();
    assert_eq!(protocols, [ApiProtocol::Openai, ApiProtocol::Anthropic]);
    let anthropic = kimi.endpoint(ApiProtocol::Anthropic).unwrap();
    assert_eq!(
        (anthropic.base_url.as_str(), anthropic.api_key_field.as_deref()),
        ("https://api.kimi.com/coding/", Some(AUTH_TOKEN))
    );
    assert_eq!(anthropic.env["CLAUDE_CODE_MAX_CONTEXT_TOKENS"], "262144");
    assert_eq!(kimi.endpoint(ApiProtocol::Openai).unwrap().effort.as_deref(), Some("high"));
    assert_eq!(kimi.source, None, "provider fields come from the winner");

    // Same host and key, but another URL for a protocol already taken: kept on its own, under its id.
    let relay = store.get("relay-7777").unwrap();
    assert_eq!((relay.revision, relay.endpoints.len()), (5, 1));
    assert_eq!(relay.endpoints[0].api_key_field.as_deref(), Some(API_KEY));

    // DeepSeek Harness is the machine default, Claude's copy only a bot's: the same URL, so the loser fills in.
    let deepseek = store.get("deepseek-9f00").unwrap();
    assert_eq!((deepseek.name.as_str(), deepseek.revision, deepseek.endpoints.len()), ("DeepSeek Harness", 4, 1));
    let e = &deepseek.endpoints[0];
    assert_eq!((e.model.as_deref(), e.api_key_field.as_deref()), (Some("deepseek-v4-pro"), Some(AUTH_TOKEN)));
    assert_eq!(e.env["API_TIMEOUT_MS"], "600000", "the winner's value stays");
    assert_eq!(e.env["ENABLE_TOOL_SEARCH"], "1", "missing keys are filled");
    assert!(deepseek.endpoint_for(Claude).is_some() && deepseek.endpoint_for(Deepseek).is_some());

    // Local profiles never merge, even with the same (empty) key.
    let work = store.get("work-0a1b").unwrap();
    assert_eq!(work.endpoints[0].config_dir.as_deref(), profile.path().to_str());
    assert_eq!(work.endpoints[0].args, ["--debug"]);
    assert_eq!(work.revision, 2);

    assert_eq!(
        report,
        Report {
            backup: None,
            merged: vec![
                ("kimi-coding-1a2b".into(), "kimi-coding-3c4d".into()),
                ("deepseek-5e6f".into(), "deepseek-9f00".into())
            ],
            split: vec!["relay-7777".into()],
            dropped: vec!["pi-7a7a".into()],
        }
    );
}

#[test]
fn references_to_merged_providers_follow_the_winner() {
    let profile = tempfile::tempdir().unwrap();
    let (store, _) = migrate(legacy(profile.path()));
    let default = |provider: &str| AgentDefault { provider: provider.into(), model: None };
    assert_eq!(
        store.machine,
        BTreeMap::from([
            (Claude, default("kimi-coding-3c4d")),
            (Codex, default("kimi-coding-3c4d")),
            (Deepseek, default("deepseek-9f00"))
        ]),
        "pi's default dropped with its provider: back to its own login"
    );
    let bots: Vec<_> = store.bots.iter().map(|(b, p)| (b.as_str(), p.as_str())).collect();
    assert_eq!(
        bots,
        [("b1", "kimi-coding-3c4d"), ("b2", "deepseek-9f00"), ("b4", OFFICIAL), ("b5", "work-0a1b")],
        "a bot on a dropped provider inherits again"
    );
    let pinned = |s: &str| store.sessions[s].provider.as_str();
    assert_eq!(
        (pinned("s1"), pinned("s2"), pinned("s3"), pinned("s4")),
        ("kimi-coding-3c4d", "deepseek-9f00", "pi-7a7a", OFFICIAL)
    );
    assert_eq!(store.official[&Claude].env["DISABLE_TELEMETRY"], "1");
    assert!(!store.agent_settings[&Claude].inherit_cli);

    // The runs go on: resumed sessions with the merged provider, a pi session pinned to a dropped one starts anew.
    let RunPlan::Resume(Selection::Provider { provider, endpoint }) =
        store.resolve_run(Claude, "b0", Some("s1")).unwrap()
    else {
        panic!("resumes on the merged provider")
    };
    assert_eq!((provider.id.as_str(), endpoint.protocol), ("kimi-coding-3c4d", ApiProtocol::Anthropic));
    assert!(matches!(store.resolve_run(Pi, "b3", Some("s3")).unwrap(), RunPlan::New { provider_removed: true, .. }));
    assert_eq!(store.effective(Codex, "b1").unwrap().provider().unwrap().1.protocol, ApiProtocol::Openai);
    assert!(store.stale().is_ok());
}

#[test]
fn the_file_is_upgraded_in_place_after_a_byte_for_byte_backup() {
    let home = tempfile::tempdir().unwrap();
    let raw = serde_json::to_vec_pretty(&v1(home.path())).unwrap();
    std::fs::write(Store::path(home.path()), &raw).unwrap();

    // Reading migrates in memory only.
    let loaded = Store::load(home.path()).unwrap();
    assert_eq!(std::fs::read(Store::path(home.path())).unwrap(), raw);
    assert!(!home.path().join("providers.v1.json").exists());

    let report = Store::migrate_file(home.path()).unwrap().expect("a v1 file");
    let backup = home.path().join("providers.v1.json");
    assert_eq!(report.backup.as_deref(), Some(backup.as_path()));
    assert_eq!(std::fs::read(&backup).unwrap(), raw, "byte for byte");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&backup).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let written: serde_json::Value = serde_json::from_slice(&std::fs::read(Store::path(home.path())).unwrap()).unwrap();
    assert_eq!(written["version"], 2);
    assert_eq!(written["machine"]["claude"], json!({ "provider": "kimi-coding-3c4d", "model": null }));
    assert_eq!(Store::load(home.path()).unwrap(), loaded, "what was read before is what is now stored");

    // Idempotent: a v2 file is left alone.
    let v2 = std::fs::read(Store::path(home.path())).unwrap();
    assert_eq!(Store::migrate_file(home.path()).unwrap(), None);
    assert_eq!(std::fs::read(Store::path(home.path())).unwrap(), v2);
    let names = |dir: &Path| {
        let mut n: Vec<_> =
            std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        n.sort();
        n
    };
    assert_eq!(names(home.path()), ["providers.json", "providers.lock", "providers.v1.json"]);
}

#[test]
fn an_existing_backup_is_never_overwritten() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("providers.v1.json"), "an older backup").unwrap();
    let raw = serde_json::to_vec(&v1(home.path())).unwrap();
    std::fs::write(Store::path(home.path()), &raw).unwrap();
    let report = Store::migrate_file(home.path()).unwrap().unwrap();
    assert_eq!(std::fs::read_to_string(home.path().join("providers.v1.json")).unwrap(), "an older backup");
    let backup = report.backup.unwrap();
    let name = backup.file_name().unwrap().to_str().unwrap();
    let ms = name.strip_prefix("providers.v1.").and_then(|n| n.strip_suffix(".json")).unwrap();
    assert!(ms.parse::<i64>().unwrap() > 1_700_000_000_000, "{name}");
    assert_eq!(std::fs::read(&backup).unwrap(), raw);
}

#[test]
fn the_first_write_of_a_v1_file_backs_it_up() {
    let home = tempfile::tempdir().unwrap();
    let raw = serde_json::to_vec(&v1(home.path())).unwrap();
    std::fs::write(Store::path(home.path()), &raw).unwrap();
    Store::update(home.path(), |s| s.use_bot("b9", Claude, OFFICIAL)).unwrap();
    assert_eq!(std::fs::read(home.path().join("providers.v1.json")).unwrap(), raw);
    let store = Store::load(home.path()).unwrap();
    assert_eq!((store.bots["b9"].as_str(), store.providers.len()), (OFFICIAL, 5));
}

#[test]
fn nothing_to_migrate_without_a_file_and_a_newer_one_is_refused() {
    let home = tempfile::tempdir().unwrap();
    assert_eq!(Store::migrate_file(home.path()).unwrap(), None);
    assert!(!Store::path(home.path()).exists());
    std::fs::write(Store::path(home.path()), r#"{"version":3,"providers":[]}"#).unwrap();
    assert!(Store::load(home.path()).unwrap_err().to_string().contains('3'));
    assert!(Store::migrate_file(home.path()).is_err());
    std::fs::write(Store::path(home.path()), "{}").unwrap();
    assert_eq!(Store::load(home.path()).unwrap(), Store::default(), "an empty v1 file");
}
