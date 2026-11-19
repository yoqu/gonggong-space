#[test]
fn codebuddys_failed_model_request_is_a_session_failure() {
    let error = r#"{"code":-32000,"message":"Authentication required","data":{"details":"401 Authentication required. Please use /login\n\nNote: …"}}"#;
    let meta = serde_json::json!({ "codebuddy.ai/errorMessage": error });
    assert_eq!(
        super::session_failure(meta.as_object()).as_deref(),
        Some("401 Authentication required. Please use /login")
    );
    let bare = serde_json::json!({ "codebuddy.ai/errorMessage": r#"{"message":"quota"}"# });
    assert_eq!(super::session_failure(bare.as_object()).as_deref(), Some("quota"));
}

use super::*;
use crate::protocol::{Approval, McpCall};
use agent_client_protocol::schema::v1::{
    ContentChunk, Cost, SessionInfoUpdate, TextContent, ToolCall, ToolCallLocation, ToolCallUpdateFields, UsageUpdate,
};

fn ctx(author: &str, body: &str) -> ContextMessage {
    ContextMessage {
        seq: 1,
        author: author.into(),
        kind: "user".into(),
        body: body.into(),
        at: "2026-09-23T10:12:00.123Z".into(),
        attachments: vec![],
    }
}

fn prompt() -> RunPrompt {
    RunPrompt {
        text: "@小王 写个脚本".into(),
        triggered_by: "王磊".into(),
        context: vec![],
        omitted: 0,
        fallback_context: vec![],
        attachments: vec![],
        quote: None,
    }
}

#[test]
fn composes_context_then_trigger() {
    assert_eq!(
        compose_prompt(&prompt(), &[ctx("陈晨", "退款 v1 下线"), ctx("小李的 Codex", "接口已改好")], 0),
        "群聊上下文：\n[#1 2026-09-23 10:12 UTC] 陈晨: 退款 v1 下线\n[#1 2026-09-23 10:12 UTC] 小李的 Codex: 接口已改好\n\n王磊 说：@小王 写个脚本"
    );
    assert_eq!(compose_prompt(&prompt(), &[], 0), "王磊 说：@小王 写个脚本");
}

#[test]
fn sync_hint_lists_what_changed_since_the_last_turn() {
    let sync = |last, changed: &[&str], total| RunSyncStart {
        head_version: 17,
        last_version: last,
        changed: changed.iter().map(|s| s.to_string()).collect(),
        changed_total: total,
        resolve: None,
    };
    assert_eq!(
        sync_hint(&sync(Some(12), &["a.ts", "b/c.ts"], 25), None).as_deref(),
        Some("强制同步：自你上次工作后权威版本 v12→v17，改动文件：a.ts、b/c.ts（共 25 个）")
    );
    assert_eq!(sync_hint(&sync(Some(17), &[], 0), None), None);
    assert_eq!(sync_hint(&sync(None, &[], 0), None), None);
    assert_eq!(
        sync_hint(&sync(Some(12), &["a.ts"], 1), Some(12)).as_deref(),
        Some("强制同步：工作区未能更新，仍停在 v12（权威版本已到 v17），以下改动不在工作区中：a.ts（共 1 个）")
    );
    assert_eq!(
        sync_hint(&sync(None, &[], 0), Some(3)).as_deref(),
        Some("强制同步：工作区未能更新，仍停在 v3（权威版本已到 v17）")
    );
}

#[test]
fn points_the_agent_at_the_gonggong_tools_for_omitted_context() {
    assert_eq!(
        compose_prompt(&prompt(), &[ctx("陈晨", "hi")], 12),
        "群聊上下文（此前还有 12 条未展示，需要时用 gonggong 的 list_messages(before=1) 或 search_messages 查看）：\n[#1 2026-09-23 10:12 UTC] 陈晨: hi\n\n王磊 说：@小王 写个脚本"
    );
}

#[test]
fn system_prompt_appends_bot_instructions() {
    let bot = RunBot {
        id: "b".into(),
        name: "小王".into(),
        agent_kind: AgentKind::Claude,
        system_prompt: "只改 server/".into(),
        tier: Tier::Workspace,
        model: None,
        effort: None,
        approval: Approval::Ask,
        allowlist: vec![],
        always_allow: vec![],
        ai_review: false,
        git: None,
        agent_settings: Default::default(),
    };
    let s = system_prompt(&bot);
    assert!(s.starts_with("You are the bot \"小王\" in a team group chat."));
    assert!(s.contains("in the language of the message you answer"));
    assert!(s.contains("mcp__gonggong__<tool>"));
    assert!(s.contains("look them up with the tools; do not guess"));
    assert!(s.contains("ask_group_members and wait"));
    assert!(s.contains("Work for another bot: hand_off"));
    assert!(s.contains("service_start + preview_expose; a static site: preview_static"));
    assert!(s.ends_with("\n\n只改 server/"));
}

#[test]
fn maps_tiers_to_modes() {
    assert_eq!(mode_for(AgentKind::Claude, Tier::Full), Some("bypassPermissions"));
    assert_eq!(mode_for(AgentKind::Claude, Tier::Workspace), Some("acceptEdits"));
    assert_eq!(mode_for(AgentKind::Claude, Tier::ReadOnly), Some("default"));
    assert_eq!(mode_for(AgentKind::Codex, Tier::Full), Some("agent-full-access"));
    assert_eq!(mode_for(AgentKind::Codex, Tier::ReadOnly), Some("read-only"));
    // codex-acp's `agent` mode sends approvals to Codex's own reviewer model instead of the owner.
    assert_eq!(mode_for(AgentKind::Codex, Tier::Workspace), Some("workspace-write"));
    assert_eq!(mode_for(AgentKind::Gemini, Tier::Full), Some("yolo"));
    assert_eq!(mode_for(AgentKind::Gemini, Tier::Workspace), Some("autoEdit"));
    assert_eq!(mode_for(AgentKind::Gemini, Tier::ReadOnly), Some("default"));
    assert_eq!(mode_for(AgentKind::Codebuddy, Tier::Workspace), Some("acceptEdits"));
    assert_eq!(mode_for(AgentKind::Pi, Tier::Full), None);
    assert_eq!(mode_for(AgentKind::Deepseek, Tier::ReadOnly), None);
}

#[test]
fn hands_review_to_the_agent_only_for_review_in_the_workspace_tier() {
    let review = |kind, official| builtin_mode(kind, Tier::Workspace, true, official);
    assert_eq!(review(AgentKind::Claude, true), Some("auto"));
    assert_eq!(review(AgentKind::Codex, true), Some("agent"));
    // Through a gateway Claude's `auto` refuses what it should check; Codex's reviewer fails.
    assert_eq!(review(AgentKind::Claude, false), None);
    assert_eq!(review(AgentKind::Codex, false), None);
    assert_eq!(review(AgentKind::Gemini, true), None);
    assert_eq!(review(AgentKind::Codebuddy, true), None);
    // 每次问我, 完全允许 and the legacy read-only tier keep their modes.
    assert_eq!(builtin_mode(AgentKind::Claude, Tier::Workspace, false, true), None);
    assert_eq!(builtin_mode(AgentKind::Claude, Tier::Full, true, true), None);
    assert_eq!(builtin_mode(AgentKind::Codex, Tier::ReadOnly, true, true), None);
}

#[test]
fn reports_failed_codex_auto_reviews() {
    let review = |status| {
        let text = "Status: Denied\nAction: MCP ask_group_members on gonggong\nRationale: 403 Forbidden";
        SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
            "guardian_assessment:r1",
            ToolCallUpdateFields::new()
                .status(status)
                .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new(text)))]),
        ))
    };
    assert_eq!(
        auto_review_failure(&review(ToolCallStatus::Failed)).as_deref(),
        Some("Status: Denied\nAction: MCP ask_group_members on gonggong\nRationale: 403 Forbidden")
    );
    assert_eq!(auto_review_failure(&review(ToolCallStatus::Completed)), None);
    let call = ToolCall::new("guardian_assessment:r2", "Guardian Review").status(ToolCallStatus::Failed);
    assert_eq!(auto_review_failure(&SessionUpdate::ToolCall(call)).as_deref(), Some("Guardian Review"));
    let other = ToolCall::new("c1", "ls").status(ToolCallStatus::Failed);
    assert_eq!(auto_review_failure(&SessionUpdate::ToolCall(other)), None);
}

#[test]
fn full_tier_allows_and_options_go_on_the_wire() {
    let opts = vec![
        PermissionOption::new("r", "Reject", PermissionOptionKind::RejectOnce),
        PermissionOption::new("aa", "Always", PermissionOptionKind::AllowAlways),
        PermissionOption::new("a", "Allow", PermissionOptionKind::AllowOnce),
    ];
    assert_eq!(auto_allow(&opts).unwrap().0.as_ref(), "a");
    assert!(auto_allow(&opts[..1]).is_none());
    assert_eq!(
        wire_options(&opts[..1]),
        vec![protocol::PermissionOption {
            option_id: "r".into(),
            name: "Reject".into(),
            kind: protocol::PermissionKind::RejectOnce
        }]
    );
}

#[test]
fn maps_updates_and_accumulates_reply_files_usage() {
    let mut t = Turn::default();
    let chunk = |s: &str| ContentChunk::new(ContentBlock::Text(TextContent::new(s)));
    assert_eq!(
        t.apply("s", SessionUpdate::AgentMessageChunk(chunk("好的，"))),
        Some(RunEvent::Text { delta: "好的，".into(), agent_id: None })
    );
    assert_eq!(
        t.apply("s", SessionUpdate::AgentThoughtChunk(chunk("想"))),
        Some(RunEvent::Thought { delta: "想".into(), agent_id: None })
    );
    t.apply("s", SessionUpdate::AgentMessageChunk(chunk("完成")));
    assert_eq!(t.reply(), "好的，完成");

    let read = ToolCall::new("r1", "Read a").kind(ToolKind::Read).locations(vec![ToolCallLocation::new("/w/a.rs")]);
    t.apply("s", SessionUpdate::ToolCall(read));
    let edit = ToolCall::new("e1", "Edit b")
        .kind(ToolKind::Edit)
        .status(ToolCallStatus::InProgress)
        .locations(vec![ToolCallLocation::new("/w/b.rs").line(3)]);
    assert_eq!(
        t.apply("s", SessionUpdate::ToolCall(edit)),
        Some(RunEvent::Tool {
            agent_id: None,
            tool_call_id: "e1".into(),
            title: "Edit b".into(),
            tool_kind: "edit".into(),
            status: ToolStatus::InProgress,
            detail: Some("/w/b.rs:3".into()),
            mcp: None,
            web: None
        })
    );
    let done = ToolCallUpdate::new(
        "e1",
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed).locations(vec![ToolCallLocation::new("/w/c.rs")]),
    );
    assert_eq!(
        t.apply("s", SessionUpdate::ToolCallUpdate(done)),
        Some(RunEvent::Tool {
            agent_id: None,
            tool_call_id: "e1".into(),
            title: "Edit b".into(),
            tool_kind: "edit".into(),
            status: ToolStatus::Completed,
            detail: Some("/w/c.rs".into()),
            mcp: None,
            web: None
        })
    );
    assert_eq!(t.files.iter().cloned().collect::<Vec<_>>(), vec!["/w/b.rs", "/w/c.rs"]);

    let usage = t.apply("s", SessionUpdate::UsageUpdate(UsageUpdate::new(1200, 200000).cost(Cost::new(0.5, "USD"))));
    assert_eq!(t.usage, Some(Usage { cost_usd: Some(0.5), ..Default::default() }), "occupancy is not usage");
    assert!(matches!(
        usage,
        Some(RunEvent::Usage {
            context: Some(ContextUsage { used: 1200, size: 200000, compact_at: None, block_at: None }),
            ..
        })
    ));
    t.compact = Some(CompactPolicy { window: Some(180000), ..policy() });
    let usage = t.apply("s", SessionUpdate::UsageUpdate(UsageUpdate::new(1300, 150000)));
    assert!(matches!(
        usage,
        Some(RunEvent::Usage { context: Some(ContextUsage { compact_at: Some(117000), block_at: None, .. }), .. })
    ));
}

fn policy() -> CompactPolicy {
    CompactPolicy { window: None, max_output: None, pct: None, enabled: true }
}

#[test]
fn compacts_where_claude_code_does() {
    assert_eq!(policy().point(200000), (Some(167000), None), "window − 20000 output reserve − 13000 buffer");
    assert_eq!(CompactPolicy { window: Some(180000), ..policy() }.point(200000), (Some(147000), None));
    assert_eq!(CompactPolicy { window: Some(50000), ..policy() }.point(200000), (Some(67000), None), "at least 100k");
    assert_eq!(CompactPolicy { window: Some(300000), ..policy() }.point(200000), (Some(167000), None));
    assert_eq!(CompactPolicy { max_output: Some(8000), ..policy() }.point(200000), (Some(179000), None));
    assert_eq!(CompactPolicy { max_output: Some(64000), ..policy() }.point(200000), (Some(167000), None));
    assert_eq!(CompactPolicy { pct: Some(50.0), ..policy() }.point(200000), (Some(90000), None));
    assert_eq!(CompactPolicy { pct: Some(99.0), ..policy() }.point(200000), (Some(167000), None), "never later");
    assert_eq!(CompactPolicy { enabled: false, ..policy() }.point(200000), (None, Some(197000)));
}

#[test]
fn maps_compactions_with_their_summary() {
    use agent_client_protocol::schema::v1::{CompactionStatus as Acp, CompactionSummaryChunk, CompactionUpdate};
    let mut t = Turn::default();
    let event = |status, trigger, pre, post, summary: Option<&str>, error: Option<&str>| {
        Some(RunEvent::Compaction {
            compaction_id: "c1".into(),
            status,
            trigger,
            pre_tokens: pre,
            post_tokens: post,
            summary: summary.map(Into::into),
            error: error.map(Into::into),
        })
    };
    assert_eq!(
        t.apply("s", SessionUpdate::CompactionUpdate(CompactionUpdate::new("c1", Acp::InProgress))),
        event(CompactionStatus::Running, None, None, None, None, None)
    );
    let chunk = |s: &str| CompactionSummaryChunk::new("c1", ContentBlock::Text(TextContent::new(s)));
    assert_eq!(t.apply("s", SessionUpdate::CompactionSummaryChunk(chunk("Working on "))), None);
    t.apply("s", SessionUpdate::CompactionSummaryChunk(chunk("the meter.")));
    let meta = serde_json::json!({ "contextCompaction": { "version": 1, "trigger": "automatic", "preTokens": 167000, "postTokens": 12000, "durationMs": 900 } });
    let done = CompactionUpdate::new("c1", Acp::Completed).meta(meta.as_object().cloned().unwrap());
    assert_eq!(
        t.apply("s", SessionUpdate::CompactionUpdate(done)),
        event(
            CompactionStatus::Completed,
            Some(CompactionTrigger::Auto),
            Some(167000),
            Some(12000),
            Some("Working on the meter."),
            None
        )
    );

    let mut t = Turn::default();
    let summary = vec![ContentBlock::Text(TextContent::new("界".repeat(9000)))];
    let meta = serde_json::json!({ "contextCompaction": { "trigger": "manual" } });
    let done = CompactionUpdate::new("c2", Acp::Completed).summary(summary).meta(meta.as_object().cloned().unwrap());
    let Some(RunEvent::Compaction { summary: Some(s), trigger, .. }) =
        t.apply("s", SessionUpdate::CompactionUpdate(done))
    else {
        panic!("a completed compaction")
    };
    assert_eq!(
        (s.chars().count(), trigger),
        (SUMMARY_MAX, Some(CompactionTrigger::Manual)),
        "the summary patch wins, clipped"
    );
    let failed = CompactionUpdate::new("c3", Acp::Failed).error("prompt too long".to_string());
    assert!(matches!(
        t.apply("s", SessionUpdate::CompactionUpdate(failed)),
        Some(RunEvent::Compaction { status: CompactionStatus::Failed, error: Some(e), .. }) if e == "prompt too long"
    ));
    assert!(matches!(
        t.apply("s", SessionUpdate::CompactionUpdate(CompactionUpdate::new("c4", Acp::Cancelled))),
        Some(RunEvent::Compaction { status: CompactionStatus::Cancelled, summary: None, .. })
    ));
}

#[test]
fn advertises_compaction_updates() {
    let caps = serde_json::to_value(client_capabilities()).unwrap();
    assert_eq!(caps["session"]["compaction"], serde_json::json!({}));
    assert!(caps["_meta"]["jetbrains"]["air"]["capabilities"].is_array());
}

#[test]
fn records_typed_session_failures_but_not_warnings() {
    let mut t = Turn::default();
    let info = |severity: &str| {
        let meta = serde_json::json!({ "jetbrains": { "air": { "version": 1, "sessionFailure": { "severity": severity, "title": "model not supported" } } } });
        SessionUpdate::SessionInfoUpdate(SessionInfoUpdate::new().meta(meta.as_object().cloned().unwrap()))
    };
    t.apply("s", info("warning"));
    assert_eq!(t.failure, None);
    t.apply("s", info("error"));
    assert_eq!(t.failure.as_deref(), Some("model not supported"));
}

#[test]
fn unwraps_provider_json_error_titles() {
    let title =
        r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"model not supported"}}"#;
    let meta =
        serde_json::json!({ "jetbrains": { "air": { "sessionFailure": { "severity": "error", "title": title } } } });
    assert_eq!(session_failure(meta.as_object()).as_deref(), Some("model not supported"));
}

#[test]
fn shell_command_and_its_output_tail_are_the_detail_without_locations() {
    let mut t = Turn::default();
    let exec = ToolCall::new("x", "Run").kind(ToolKind::Execute).raw_input(serde_json::json!({ "command": "ls -la" }));
    let Some(RunEvent::Tool { detail, .. }) = t.apply("s", SessionUpdate::ToolCall(exec)) else { panic!() };
    assert_eq!(detail.as_deref(), Some("$ ls -la"));

    let lines: Vec<String> = (1..=30).map(|i| format!("line {i}")).collect();
    let output = format!("```console\n{}\n```", lines.join("\n"));
    let done = ToolCallUpdate::new(
        "x",
        ToolCallUpdateFields::new()
            .status(ToolCallStatus::Completed)
            .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new(output)))]),
    );
    let Some(RunEvent::Tool { detail, .. }) = t.apply("s", SessionUpdate::ToolCallUpdate(done)) else { panic!() };
    let expected = format!("$ ls -la\n{}", lines[30 - OUTPUT_LINES..].join("\n"));
    assert_eq!(detail.as_deref(), Some(expected.as_str()));
}

#[test]
fn long_locations_keep_the_file_name() {
    let mut t = Turn::default();
    let deep = format!("/{}/README.md", "d".repeat(300));
    let read = ToolCall::new("r", "Read").kind(ToolKind::Read).locations(vec![ToolCallLocation::new(&deep)]);
    let Some(RunEvent::Tool { detail: Some(d), .. }) = t.apply("s", SessionUpdate::ToolCall(read)) else { panic!() };
    assert!(d.starts_with('…') && d.ends_with("/README.md"), "{d}");
    assert_eq!(d.chars().count(), DETAIL_MAX);
}

#[test]
fn read_results_are_not_output() {
    let mut t = Turn::default();
    let read = ToolCall::new("r", "Read a")
        .kind(ToolKind::Read)
        .locations(vec![ToolCallLocation::new("/w/a.rs")])
        .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new("fn main() {}")))]);
    let Some(RunEvent::Tool { detail, .. }) = t.apply("s", SessionUpdate::ToolCall(read)) else { panic!() };
    assert_eq!(detail.as_deref(), Some("/w/a.rs"));
}

#[test]
fn mcp_calls_carry_their_arguments_and_result() {
    let mut t = Turn::default();
    let call = ToolCall::new("m", "mcp__gonggong__list_messages")
        .kind(ToolKind::Other)
        .raw_input(serde_json::json!({ "limit": 20 }));
    let Some(RunEvent::Tool { detail, mcp, .. }) = t.apply("s", SessionUpdate::ToolCall(call)) else { panic!() };
    let call = |output: Option<&str>| McpCall {
        server: "gonggong".into(),
        tool: "list_messages".into(),
        input: Some(r#"{"limit":20}"#.into()),
        output: output.map(String::from),
    };
    assert_eq!((detail, mcp), (None, Some(call(None))));
    let done = ToolCallUpdate::new(
        "m",
        ToolCallUpdateFields::new()
            .status(ToolCallStatus::Completed)
            .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new("#1 王磊: hi")))]),
    );
    let Some(RunEvent::Tool { mcp, .. }) = t.apply("s", SessionUpdate::ToolCallUpdate(done)) else { panic!() };
    assert_eq!(mcp, Some(call(Some("#1 王磊: hi"))));
}

#[test]
fn codex_mcp_calls_unwrap_their_raw_input_and_output() {
    let mut t = Turn::default();
    let call = ToolCall::new("c", "mcp.gonggong.search_messages")
        .kind(ToolKind::Execute)
        .raw_input(
            serde_json::json!({ "server": "gonggong", "tool": "search_messages", "arguments": { "query": "登录" } }),
        )
        .raw_output(
            serde_json::json!({ "result": { "content": [{ "type": "text", "text": "无结果" }] }, "error": null }),
        );
    let Some(RunEvent::Tool { mcp: Some(m), .. }) = t.apply("s", SessionUpdate::ToolCall(call)) else { panic!() };
    assert_eq!((m.input.as_deref(), m.output.as_deref()), (Some(r#"{"query":"登录"}"#), Some("无结果")));
}

#[test]
fn antigravity_mcp_calls_split_on_the_runs_own_server_names() {
    let mut t = Turn::with_mcp(vec!["gonggong".into(), "my-srv.x".into()]);
    // As agy 1.5.10 sends it: the server's `.` became `_`, and agy adds its own `toolSummary` to the arguments.
    let call = ToolCall::new("a", "Run mcp_my-srv_x_echo_text")
        .kind(ToolKind::Other)
        .raw_input(serde_json::json!({ "text": "hi", "toolSummary": "Echo text" }));
    let Some(RunEvent::Tool { mcp, .. }) = t.apply("s", SessionUpdate::ToolCall(call)) else { panic!() };
    let mcp = mcp.unwrap();
    assert_eq!((mcp.server.as_str(), mcp.tool.as_str()), ("my-srv.x", "echo_text"));
    assert_eq!(mcp.input.as_deref(), Some(r#"{"text":"hi"}"#));

    let call = ToolCall::new("b", "Run mcp_gonggong_list_messages").kind(ToolKind::Other);
    let Some(RunEvent::Tool { mcp, .. }) = t.apply("s", SessionUpdate::ToolCall(call)) else { panic!() };
    assert_eq!(mcp.map(|m| m.tool), Some("list_messages".into()));

    let builtin = ToolCall::new("c", "Run invoke_subagent").kind(ToolKind::Other);
    let Some(RunEvent::Tool { mcp, .. }) = t.apply("s", SessionUpdate::ToolCall(builtin)) else { panic!() };
    assert_eq!(mcp, None);
}

#[test]
fn codex_edits_name_their_files_from_the_diffs() {
    use agent_client_protocol::schema::v1::Diff;
    let mut t = Turn::default();
    // codex-acp 2.2.2's apply_patch: no locations, the paths are only in the diffs.
    let edit = ToolCall::new("e", "Editing files").kind(ToolKind::Edit).content(vec![
        ToolCallContent::Diff(Diff::new("/w/a.txt", "world\n").old_text("hello\n")),
        ToolCallContent::Diff(Diff::new("/w/b.txt", "z\n")),
    ]);
    let Some(RunEvent::Tool { detail, .. }) = t.apply("s", SessionUpdate::ToolCall(edit)) else { panic!() };
    assert_eq!(detail.as_deref(), Some("/w/a.txt +1"));
    assert_eq!(t.files.iter().map(String::as_str).collect::<Vec<_>>(), ["/w/a.txt", "/w/b.txt"]);
}

#[test]
fn web_searches_carry_their_query_and_hits() {
    let mut t = Turn::default();
    let search = ToolCall::new("w", "Search \"fastify 5\"")
        .kind(ToolKind::Fetch)
        .raw_input(serde_json::json!({ "query": "fastify 5" }));
    let Some(RunEvent::Tool { web, .. }) = t.apply("s", SessionUpdate::ToolCall(search)) else { panic!() };
    assert_eq!(web, Some(WebCall { query: Some("fastify 5".into()), ..WebCall::default() }));
    let done = ToolCallUpdate::new(
        "w",
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed).content(vec![ToolCallContent::from(
            ContentBlock::Text(TextContent::new("Migration Guide (https://fastify.dev/v5)")),
        )]),
    );
    let Some(RunEvent::Tool { web: Some(w), detail, .. }) = t.apply("s", SessionUpdate::ToolCallUpdate(done)) else {
        panic!()
    };
    assert_eq!(detail, None);
    assert_eq!(
        (w.query.as_deref(), w.hits.len(), w.hits[0].url.as_str()),
        (Some("fastify 5"), 1, "https://fastify.dev/v5")
    );

    let fetch = ToolCall::new("f", "Fetch https://fastify.dev/v5")
        .kind(ToolKind::Fetch)
        .raw_input(serde_json::json!({ "url": "https://fastify.dev/v5", "prompt": "Summary (https://x.dev)" }))
        .content(vec![ToolCallContent::from(ContentBlock::Text(TextContent::new("Summary (https://x.dev)")))]);
    let Some(RunEvent::Tool { web, .. }) = t.apply("s", SessionUpdate::ToolCall(fetch)) else { panic!() };
    assert_eq!(web, Some(WebCall { url: Some("https://fastify.dev/v5".into()), ..WebCall::default() }));

    let codex = ToolCall::new("c", "Web search: rust 2024").kind(ToolKind::Search).raw_input(
        serde_json::json!({ "type": "webSearch", "id": "c", "query": "rust 2024", "action": { "type": "search", "query": "rust 2024" } }),
    );
    let Some(RunEvent::Tool { web, .. }) = t.apply("s", SessionUpdate::ToolCall(codex)) else { panic!() };
    assert_eq!(web.and_then(|w| w.query).as_deref(), Some("rust 2024"));

    let grep = ToolCall::new("g", "grep x").kind(ToolKind::Search).raw_input(serde_json::json!({ "pattern": "x" }));
    let Some(RunEvent::Tool { web, .. }) = t.apply("s", SessionUpdate::ToolCall(grep)) else { panic!() };
    assert_eq!(web, None);
}

fn ext(v: serde_json::Value) -> ExtUpdate {
    assert!(ExtUpdate::is_ext(v["sessionUpdate"].as_str().unwrap()));
    serde_json::from_value(v).unwrap()
}

#[test]
fn standard_updates_are_not_taken_for_extensions() {
    for tag in ["agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan"] {
        assert!(!ExtUpdate::is_ext(tag), "{tag}");
    }
}

#[test]
fn reply_keeps_only_text_after_the_last_main_tool_call() {
    let mut t = Turn::default();
    let chunk = |s: &str| SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(s))));
    let call = |id: &str| SessionUpdate::ToolCall(ToolCall::new(id.to_string(), "Read").kind(ToolKind::Read));
    t.apply("root", chunk("Now adapt the script."));
    t.apply("root", call("c1"));
    t.apply("root", chunk("Saving to the knowledge base."));
    t.apply("root", call("c2"));
    t.apply("root", chunk("会员营业额"));
    assert_eq!(t.apply("root", chunk("查完了")), Some(RunEvent::Text { delta: "查完了".into(), agent_id: None }));
    assert_eq!(t.reply(), "会员营业额查完了");

    t.apply("root", call("c3"));
    assert_eq!(t.reply(), "Now adapt the script.Saving to the knowledge base.会员营业额查完了");

    t.clear_reply();
    t.apply("root", chunk("下一轮"));
    assert_eq!(t.reply(), "下一轮");
}

#[test]
fn subagent_tool_calls_do_not_cut_the_main_reply() {
    let mut t = Turn::default();
    let chunk = |s: &str| SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(s))));
    t.subagent(
        "root",
        ext(serde_json::json!({
            "sessionUpdate": "subagent_spawned", "subagentSessionId": "task-1", "name": "Explore",
            "task": "t", "capabilities": {}
        })),
    );
    t.apply("root", chunk("开头"));
    t.apply("task-1", SessionUpdate::ToolCall(ToolCall::new("s1", "Read").kind(ToolKind::Read)));
    t.apply("root", chunk("结论"));
    assert_eq!(t.reply(), "开头结论");
}

#[test]
fn subagent_updates_carry_their_agent_and_stay_out_of_the_reply() {
    let mut t = Turn::default();
    let chunk = |s: &str| SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(s))));
    let spawned = ext(serde_json::json!({
        "sessionUpdate": "subagent_spawned", "subagentSessionId": "task-1", "name": "Explore",
        "task": "找调用方", "capabilities": {}
    }));
    assert_eq!(
        t.subagent("root", spawned),
        Some(RunEvent::Subagent {
            agent_id: "task-1".into(),
            parent_id: None,
            name: "Explore".into(),
            task: "找调用方".into(),
            state: SubagentState::Running
        })
    );
    assert_eq!(
        t.apply("task-1", chunk("子报告")),
        Some(RunEvent::Text { delta: "子报告".into(), agent_id: Some("task-1".into()) })
    );
    t.apply("root", chunk("主回复"));
    assert_eq!(t.reply(), "主回复");

    let same_id = |s| ToolCall::new("x", "Read").kind(ToolKind::Read).locations(vec![ToolCallLocation::new(s)]);
    t.apply("root", SessionUpdate::ToolCall(same_id("/w/a")));
    let Some(RunEvent::Tool { agent_id, detail, .. }) = t.apply("task-1", SessionUpdate::ToolCall(same_id("/w/b")))
    else {
        panic!()
    };
    assert_eq!((agent_id.as_deref(), detail.as_deref()), (Some("task-1"), Some("/w/b")));

    let nested = ext(serde_json::json!({
        "sessionUpdate": "subagent_spawned", "subagentSessionId": "task-2", "name": "Plan", "task": "t", "capabilities": {}
    }));
    let Some(RunEvent::Subagent { parent_id, .. }) = t.subagent("task-1", nested) else { panic!() };
    assert_eq!(parent_id.as_deref(), Some("task-1"));
    let done = ext(
        serde_json::json!({ "sessionUpdate": "subagent_state_update", "subagentSessionId": "task-1", "state": "completed" }),
    );
    let Some(RunEvent::Subagent { state, name, .. }) = t.subagent("root", done) else { panic!() };
    assert_eq!((state, name.as_str()), (SubagentState::Completed, "Explore"));
}

#[test]
fn task_snapshots_merge_spawn_progress_and_state() {
    let ExtUpdate::AsyncTaskSpawned(p) = ext(serde_json::json!({
        "sessionUpdate": "async_task_spawned", "asyncTaskId": "b1", "name": "pnpm dev", "taskType": "shell",
        "showInTranscript": false, "canStop": true, "toolCallId": "tc9"
    })) else {
        panic!()
    };
    let mut snap = TaskSnap::new(Some("task-1".into()));
    snap.patch(p);
    let ExtUpdate::AsyncTaskProgress(p) = ext(serde_json::json!({
        "sessionUpdate": "async_task_progress", "asyncTaskId": "b1", "outputFilePath": "/tmp/b1.log"
    })) else {
        panic!()
    };
    snap.patch(p);
    assert!(!snap.ended());
    let ExtUpdate::AsyncTaskStateUpdate(p) = ext(serde_json::json!({
        "sessionUpdate": "async_task_state_update", "asyncTaskId": "b1", "state": "completed", "summary": "exit 0"
    })) else {
        panic!()
    };
    assert_eq!(
        snap.patch(p),
        RunEvent::Task {
            task_id: "b1".into(),
            agent_id: Some("task-1".into()),
            tool_call_id: Some("tc9".into()),
            name: "pnpm dev".into(),
            task_type: "shell".into(),
            state: TaskState::Completed,
            summary: Some("exit 0".into()),
            output_path: Some("/tmp/b1.log".into()),
            can_stop: false,
        }
    );
    assert!(snap.ended());
    let ExtUpdate::AsyncTaskSpawned(p) = ext(serde_json::json!({
        "sessionUpdate": "async_task_spawned", "asyncTaskId": "b1", "name": "", "taskType": "task",
        "showInTranscript": false, "canStop": false
    })) else {
        panic!()
    };
    let RunEvent::Task { name, task_type, .. } = snap.patch(p) else { panic!() };
    assert_eq!((name.as_str(), task_type.as_str()), ("pnpm dev", "shell"));
}

#[test]
fn maps_the_main_agents_plan_once_per_change() {
    use agent_client_protocol::schema::v1::{Plan, PlanEntry, PlanEntryPriority as P, PlanEntryStatus as S};
    let plan = |entries: Vec<(&str, S)>| {
        SessionUpdate::Plan(Plan::new(entries.into_iter().map(|(c, s)| PlanEntry::new(c, P::Medium, s)).collect()))
    };
    let item = |content: &str, status| PlanItem { content: content.into(), status };
    let mut t = Turn::default();
    assert_eq!(
        t.apply("s", plan(vec![("读代码", S::InProgress), ("写测试", S::Pending)])),
        Some(RunEvent::Plan {
            entries: vec![item("读代码", PlanStatus::InProgress), item("写测试", PlanStatus::Pending)]
        })
    );
    assert_eq!(t.apply("s", plan(vec![("读代码", S::InProgress), ("写测试", S::Pending)])), None);
    assert_eq!(
        t.apply("s", plan(vec![("读代码", S::Completed)])),
        Some(RunEvent::Plan { entries: vec![item("读代码", PlanStatus::Completed)] })
    );
    assert_eq!(t.apply("s", plan(vec![])), Some(RunEvent::Plan { entries: vec![] }));

    let long = "界".repeat(600);
    let many: Vec<(&str, S)> = (0..120).map(|_| (long.as_str(), S::Pending)).collect();
    let Some(RunEvent::Plan { entries }) = t.apply("s", plan(many)) else { panic!() };
    assert_eq!((entries.len(), entries[0].content.chars().count()), (100, 500));

    let spawned = serde_json::from_value(serde_json::json!({
        "sessionUpdate": "subagent_spawned", "subagentSessionId": "task-1", "name": "Explore",
        "task": "t", "capabilities": {}
    }))
    .unwrap();
    t.subagent("root", spawned);
    assert_eq!(t.apply("task-1", plan(vec![("子任务", S::Pending)])), None);
}
