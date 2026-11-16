use super::*;
use crate::agent_settings::RunSettingsSnapshot;

fn launch(inherit_cli: bool, settings: Option<&str>) -> inject::ClaudeLaunch {
    inject::ClaudeLaunch {
        file: settings.map(|p| (PathBuf::from(p), serde_json::json!({}))),
        inherit_cli,
        args: Default::default(),
        snapshot: RunSettingsSnapshot {
            provider: None,
            context_window: None,
            auto_compact_window: None,
            inherit_cli,
            from_cli: vec![],
            from_bot: vec![],
        },
        compact: crate::turn::CompactPolicy { window: None, max_output: None, pct: None, enabled: true },
    }
}

#[test]
fn claude_options_leave_out_the_user_config_only_when_asked() {
    let (none, no) = (skills::Installed::default(), plugins::Installed::default());
    assert!(claude_options(None, &none, &no).is_empty());
    assert!(claude_options(Some(&launch(true, None)), &none, &no).is_empty(), "the adapter's default sources");
    let isolated = claude_options(Some(&launch(false, Some("/h/run/claude-x.json"))), &none, &no);
    assert_eq!(isolated["settingSources"], serde_json::json!(["project", "local"]));
    assert_eq!(isolated["settings"], "/h/run/claude-x.json");
    let mut with_args = launch(true, None);
    with_args.args.insert("debug".into(), serde_json::Value::Null);
    let options = claude_options(Some(&with_args), &none, &no);
    assert_eq!(options["extraArgs"], serde_json::json!({ "debug": null }));
}

#[test]
fn reads_models_offered_the_older_way() {
    let raw = serde_json::json!({
        "sessionId": "s",
        "models": {
            "availableModels": [
                { "modelId": "auto", "name": "Auto", "description": "Let Gemini CLI decide" },
                { "modelId": "gemini-2.5-pro" },
            ],
            "currentModelId": "gemini-2.5-pro",
        },
    });
    let models = Models::of(&raw).unwrap();
    assert_eq!((models.current.as_str(), models.initial.as_str()), ("gemini-2.5-pro", "gemini-2.5-pro"));
    assert_eq!(models.choices[1].name, "gemini-2.5-pro", "no name: its id");
    let catalog = models.catalog();
    assert_eq!(catalog.models.len(), 2);
    assert_eq!(catalog.current.as_deref(), Some("gemini-2.5-pro"));
    assert_eq!(Models::of(&serde_json::json!({ "sessionId": "s" })), None);
}

#[test]
fn names_gemini_mcp_calls_by_the_server_in_meta() {
    let call = |meta: Option<serde_json::Value>| {
        let mut tool = acp::ToolCallUpdate::new("t1", acp::ToolCallUpdateFields::new().title("get_group_info"));
        tool.meta = meta.and_then(|m| m.as_object().cloned());
        let mut req = RequestPermissionRequest::new("s", tool, vec![]);
        name_mcp_call(&mut req);
        req.tool_call.fields.title.unwrap()
    };
    let meta =
        serde_json::json!({ "gemini-cli": { "mcp": { "server_name": "gonggong", "tool_name": "get_group_info" } } });
    assert_eq!(call(Some(meta)), "mcp__gonggong__get_group_info");
    assert_eq!(call(None), "get_group_info");
}
