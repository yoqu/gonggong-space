use super::*;
use crate::agent_settings::AgentSettings;
use crate::protocol::{ApiProtocol, RunBot, Tier};
use crate::providers::{ModelMap, Official, Provider};
use agent_client_protocol::schema::v1::SessionConfigSelect;

fn make_model_option(
    current: &str,
    choices: &[(&str, &str, Option<&str>, Option<Value>)],
) -> SessionConfigOption {
    let items: Vec<SessionConfigSelectOption> = choices
        .iter()
        .map(|(value, name, desc, meta)| {
            let mut opt = SessionConfigSelectOption::new((*value).to_string(), (*name).to_string());
            if let Some(d) = desc {
                opt = opt.description((*d).to_string());
            }
            if let Some(Value::Object(map)) = meta {
                opt = opt.meta(map.clone());
            }
            opt
        })
        .collect();
    let select = SessionConfigSelect::new(current.to_string(), SessionConfigSelectOptions::Ungrouped(items));
    SessionConfigOption::new("model", "Model", SessionConfigKind::Select(select))
        .category(SessionConfigOptionCategory::Model)
}

fn test_bot(kind: AgentKind, model: Option<&str>) -> RunBot {
    RunBot {
        id: "b1".into(),
        name: "Bot".into(),
        agent_kind: kind,
        system_prompt: String::new(),
        tier: Tier::Workspace,
        model: model.map(Into::into),
        effort: None,
        approval: Default::default(),
        allowlist: vec![],
        always_allow: vec![],
        ai_review: false,
        git: None,
        agent_settings: Default::default(),
    }
}

#[test]
fn claude_transcript_tail_extracts_latest_concrete_model_and_skips_synthetic() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("sess1.jsonl");
    let content = [
        r#"{"type":"user","message":{"role":"user","content":"Fix login"}}"#,
        r#"{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-6","content":[{"type":"thinking","thinking":"hmm"}]}}"#,
        r#"{"type":"assistant","message":{"role":"assistant","model":"glm-5.2","content":[{"type":"text","text":"Fixed."}]}}"#,
        r#"{"type":"user","message":{"role":"user","content":"Again"}}"#,
        r#"{"type":"assistant","message":{"role":"assistant","model":"<synthetic>","content":[{"type":"text","text":"API Error: 529"}]}}"#,
    ]
    .join("\n");
    std::fs::write(&file, content).unwrap();
    assert_eq!(parse_claude_transcript_tail(&file).as_deref(), Some("glm-5.2"));
}

#[test]
fn claude_transcript_tail_handles_large_files_beyond_64kb() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("big.jsonl");
    let mut lines = vec![
        r#"{"type":"assistant","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"early"}]}}"#.to_string(),
    ];
    // Push the assistant line well past the 64KB tail boundary with big tool results.
    let big_payload = "x".repeat(20_000);
    for i in 0..5 {
        lines.push(format!(
            r#"{{"type":"user","message":{{"role":"user","content":"tool result {i}: {big_payload}"}}}}"#
        ));
    }
    std::fs::write(&file, lines.join("\n")).unwrap();
    assert_eq!(parse_claude_transcript_tail(&file).as_deref(), Some("claude-sonnet-4-6"));
}

#[test]
fn codex_rollout_tail_extracts_latest_turn_context_model() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("rollout-2026-11-26T10-00-00-sess-codex.jsonl");
    let content = [
        r#"{"type":"session_meta","payload":{"id":"sess-codex"}}"#,
        r#"{"type":"turn_context","payload":{"turn_id":"a","model":"gpt-5.4","effort":"high"}}"#,
        r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"First."}]}}"#,
        r#"{"type":"turn_context","payload":{"turn_id":"b","model":"gpt-5.4-mini","effort":"low"}}"#,
        r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Second."}]}}"#,
    ]
    .join("\n");
    std::fs::write(&file, content).unwrap();
    assert_eq!(parse_codex_rollout_tail(&file).as_deref(), Some("gpt-5.4-mini"));
}

#[test]
fn codex_post_turn_probe_finds_rollout_or_falls_back_to_config_toml() {
    let dir = tempfile::tempdir().unwrap();
    let codex_home = dir.path().join(".codex");
    let day_dir = codex_home.join("sessions/2026/11/26");
    std::fs::create_dir_all(&day_dir).unwrap();
    std::fs::write(codex_home.join("config.toml"), "model = \"gpt-5.4\"\n").unwrap();

    // Fallback to config.toml when no rollout matches session_id.
    let probe_missing = PostTurnProbe {
        agent_kind: AgentKind::Codex,
        cwd: dir.path().to_path_buf(),
        session_id: "missing-session".into(),
        claude_dirs: vec![],
        codex_home: codex_home.clone(),
        pi_dir: dir.path().join(".pi/agent"),
        pi_session_dir: None,
    };
    assert_eq!(probe_missing.discover().as_deref(), Some("gpt-5.4"));

    // Rollout turn_context wins over config.toml when present.
    let rollout = day_dir.join("rollout-2026-11-26T12-30-00-thread-abc.jsonl");
    std::fs::write(&rollout, r#"{"type":"turn_context","payload":{"turn_id":"t1","model":"o4-mini"}}"#)
        .unwrap();
    let probe_found = PostTurnProbe { session_id: "thread-abc".into(), ..probe_missing };
    assert_eq!(probe_found.discover().as_deref(), Some("o4-mini"));
}

#[test]
fn pi_transcript_tail_extracts_latest_assistant_model() {
    let dir = tempfile::tempdir().unwrap();
    let pi_dir = dir.path().join(".pi/agent");
    let sess_dir = pi_dir.join("sessions/proj-a");
    std::fs::create_dir_all(&sess_dir).unwrap();
    let file = sess_dir.join("2026-11-26T10-00-00_pi-sess-1.jsonl");
    let content = [
        r#"{"type":"session","version":3,"id":"pi-sess-1","cwd":"/w"}"#,
        r#"{"type":"message","id":"e1","message":{"role":"assistant","model":"deepseek-v4","content":[]}}"#,
        r#"{"type":"message","id":"e2","message":{"role":"assistant","model":"claude-opus-4-6","content":[]}}"#,
    ]
    .join("\n");
    std::fs::write(&file, content).unwrap();
    let probe = PostTurnProbe {
        agent_kind: AgentKind::Pi,
        cwd: PathBuf::from("/w"),
        session_id: "pi-sess-1".into(),
        claude_dirs: vec![],
        codex_home: dir.path().join(".codex"),
        pi_dir,
        pi_session_dir: None,
    };
    assert_eq!(probe.discover().as_deref(), Some("claude-opus-4-6"));
}

#[test]
fn claude_settings_and_alias_resolution_work_across_launch_profile_and_cli() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().join("gg-home");
    let user_home = dir.path().join("user-home");
    std::fs::create_dir_all(user_home.join(".claude")).unwrap();
    std::fs::write(
        user_home.join(".claude/settings.json"),
        serde_json::json!({
            "model": "opus",
            "env": {
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-6-20260205",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6"
            }
        })
        .to_string(),
    )
    .unwrap();

    let official = Selection::Official(Official::default());
    let launch =
        inject::ClaudeLaunch::new(&home, &official, &AgentSettings::default(), &test_bot(AgentKind::Claude, None), None)
            .unwrap();

    // When adapter reports "default", CLI settings "model": "opus" expands via ANTHROPIC_DEFAULT_OPUS_MODEL!
    let default_opts = vec![make_model_option("default", &[("default", "Default", None, None)])];
    let resolved = resolve_pre_turn_model(
        AgentKind::Claude,
        &official,
        Some(&launch),
        &user_home,
        None,
        None,
        &default_opts,
        &HashMap::new(),
        None,
    );
    assert_eq!(resolved.as_deref(), Some("claude-opus-4-6-20260205"));

    // When adapter reports alias "sonnet" (and with [1m] suffix), resolve via ANTHROPIC_DEFAULT_SONNET_MODEL.
    let sonnet_opts = vec![make_model_option("sonnet[1m]", &[("sonnet[1m]", "Sonnet 1M", None, None)])];
    let resolved = resolve_pre_turn_model(
        AgentKind::Claude,
        &official,
        Some(&launch),
        &user_home,
        None,
        None,
        &sonnet_opts,
        &HashMap::new(),
        None,
    );
    assert_eq!(resolved.as_deref(), Some("claude-sonnet-4-6[1m]"));

    // When inherit_cli is false, CLI settings.json is ignored (never leaks user model).
    let isolated_defaults = AgentSettings { values: Default::default(), inherit_cli: false };
    let isolated =
        inject::ClaudeLaunch::new(&home, &official, &isolated_defaults, &test_bot(AgentKind::Claude, None), None)
            .unwrap();
    let resolved = resolve_pre_turn_model(
        AgentKind::Claude,
        &official,
        Some(&isolated),
        &user_home,
        None,
        None,
        &default_opts,
        &HashMap::new(),
        None,
    );
    assert_eq!(resolved, None);

    // Provider ANTHROPIC_MODEL + ANTHROPIC_DEFAULT_OPUS_MODEL in launch overrides CLI settings.
    let mut p = Provider::custom(ApiProtocol::Anthropic, "Relay".into(), "https://r.test".into(), "sk-1234567890".into());
    p.id = "relay-1".into();
    p.endpoints[0].model = Some("deepseek-r1".into());
    p.endpoints[0].models = Some(ModelMap {
        opus: Some("deepseek-v3.2".into()),
        sonnet: None,
        haiku: None,
    });
    let sel = Selection::of(&p, AgentKind::Claude).unwrap();
    let p_launch =
        inject::ClaudeLaunch::new(&home, &sel, &AgentSettings::default(), &test_bot(AgentKind::Claude, None), None)
            .unwrap();
    let resolved_default = resolve_pre_turn_model(
        AgentKind::Claude,
        &sel,
        Some(&p_launch),
        &user_home,
        None,
        None,
        &default_opts,
        &HashMap::new(),
        None,
    );
    assert_eq!(resolved_default.as_deref(), Some("deepseek-r1"));
    let opus_opts = vec![make_model_option("opus", &[("opus", "Opus", None, None)])];
    let resolved_opus = resolve_pre_turn_model(
        AgentKind::Claude,
        &sel,
        Some(&p_launch),
        &user_home,
        None,
        None,
        &opus_opts,
        &HashMap::new(),
        None,
    );
    assert_eq!(resolved_opus.as_deref(), Some("deepseek-v3.2"));
}

#[test]
fn default_choice_metadata_extracts_only_unambiguous_concrete_ids() {
    let dir = tempfile::tempdir().unwrap();
    let official = Selection::Official(Official::default());
    let isolated = AgentSettings { values: Default::default(), inherit_cli: false };
    let launch =
        inject::ClaudeLaunch::new(dir.path(), &official, &isolated, &test_bot(AgentKind::Claude, None), None)
            .unwrap();

    // Ambiguous marketing prose is NOT invented into a model ID.
    let prose_opts = vec![make_model_option(
        "default",
        &[("default", "Default (recommended)", Some("Opus 4.6 · Most capable"), None)],
    )];
    assert_eq!(
        resolve_pre_turn_model(
            AgentKind::Claude,
            &official,
            Some(&launch),
            dir.path(),
            None,
            None,
            &prose_opts,
            &HashMap::new(),
            None,
        ),
        None
    );

    // Explicit model ID in parenthesized label or meta IS extracted.
    let explicit_opts = vec![make_model_option(
        "default",
        &[("default", "Default (claude-sonnet-4-5-20250929)", None, None)],
    )];
    assert_eq!(
        resolve_pre_turn_model(
            AgentKind::Claude,
            &official,
            Some(&launch),
            dir.path(),
            None,
            None,
            &explicit_opts,
            &HashMap::new(),
            None,
        )
        .as_deref(),
        Some("claude-sonnet-4-5-20250929")
    );

    let meta_opts = vec![make_model_option(
        "default",
        &[("default", "Default", None, Some(serde_json::json!({ "modelId": "claude-opus-4-6" })))],
    )];
    assert_eq!(
        resolve_pre_turn_model(
            AgentKind::Claude,
            &official,
            Some(&launch),
            dir.path(),
            None,
            None,
            &meta_opts,
            &HashMap::new(),
            None,
        )
        .as_deref(),
        Some("claude-opus-4-6")
    );
}

#[test]
fn claude_profile_post_turn_probe_encodes_cwd_and_reads_session_jsonl() {
    let dir = tempfile::tempdir().unwrap();
    let profile = dir.path().join("claude-work");
    let cwd = dir.path().join("ws/my_project.v1");
    std::fs::create_dir_all(&cwd).unwrap();
    let encoded = encode_claude_cwd(&cwd);
    assert!(!encoded.contains('/') && !encoded.contains('_') && !encoded.contains('.'));
    let sess_dir = profile.join("projects").join(&encoded);
    std::fs::create_dir_all(&sess_dir).unwrap();
    std::fs::write(
        sess_dir.join("sess-99.jsonl"),
        r#"{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-6","content":[]}}"#,
    )
    .unwrap();

    let probe = PostTurnProbe {
        agent_kind: AgentKind::Claude,
        cwd,
        session_id: "sess-99".into(),
        claude_dirs: vec![profile],
        codex_home: dir.path().join(".codex"),
        pi_dir: dir.path().join(".pi/agent"),
        pi_session_dir: None,
    };
    assert_eq!(probe.discover().as_deref(), Some("claude-opus-4-6"));
}

#[test]
fn acp_usage_forwards_cached_read_and_write_tokens() {
    let acp = AcpUsage::new(1500, 1200, 300).cached_read_tokens(Some(800)).cached_write_tokens(Some(120));
    let usage = usage_from_acp(Some(acp), Some(0.012)).unwrap();
    assert_eq!(
        usage,
        Usage {
            input_tokens: Some(1200),
            output_tokens: Some(300),
            total_tokens: Some(1500),
            cached_read_tokens: Some(800),
            cached_write_tokens: Some(120),
            cost_usd: Some(0.012),
        }
    );

    // Zero-token cancelled reports stay None.
    let zero = AcpUsage::new(0, 0, 0).cached_read_tokens(Some(0));
    assert_eq!(usage_from_acp(Some(zero), None), None);
}

#[test]
fn combine_done_model_prefers_post_turn_over_config_update_over_pre_turn() {
    assert_eq!(
        combine_done_model(
            Some("opus".into()),
            Some("sonnet".into()),
            Some("claude-opus-4-6".into()),
        )
        .as_deref(),
        Some("claude-opus-4-6")
    );
    assert_eq!(
        combine_done_model(Some("opus".into()), Some("claude-sonnet-4-6".into()), Some("<synthetic>".into()))
            .as_deref(),
        Some("claude-sonnet-4-6")
    );
    assert_eq!(
        combine_done_model(Some("claude-haiku-4-5".into()), Some("default".into()), None).as_deref(),
        Some("claude-haiku-4-5")
    );
    assert_eq!(combine_done_model(Some("default".into()), None, None), None);
}

#[test]
fn config_option_update_extracts_updated_model_with_alias_expansion() {
    let dir = tempfile::tempdir().unwrap();
    let user_home = dir.path().join("user");
    std::fs::create_dir_all(user_home.join(".claude")).unwrap();
    std::fs::write(
        user_home.join(".claude/settings.json"),
        r#"{"env":{"ANTHROPIC_DEFAULT_HAIKU_MODEL":"claude-haiku-4-5-20251001"}}"#,
    )
    .unwrap();
    let official = Selection::Official(Official::default());
    let opts = vec![make_model_option("haiku", &[("haiku", "Haiku", None, None)])];
    assert_eq!(
        model_from_config_options(AgentKind::Claude, &official, None, &user_home, &opts).as_deref(),
        Some("claude-haiku-4-5-20251001")
    );
}
