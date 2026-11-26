//! Answering the agent's permission requests: the bot's tier and rules, then its owner (plan D15).
use super::*;

/// A permission request of the active turn.
pub(super) fn permission_in(shared: &Arc<Shared>, s: &mut State, mut req: RequestPermissionRequest) -> Permission {
    s.requests += 1;
    let n = s.requests;
    let Some(a) = s.active.as_mut() else { return Permission::Now(None) };
    // Answered again as it is once the gate opens.
    let original = a.gate.as_ref().filter(|g| !g.open).map(|_| req.clone());
    name_mcp_call(&mut req);
    crate::adapters::own_request(&mut req.tool_call);
    // The built-in gonggong tools only ask or read the group: never an owner decision (spec §8.8).
    if req.tool_call.fields.title.as_deref().is_some_and(ask::is_builtin) {
        return Permission::Now(auto_allow(&req.options));
    }
    // Without raw input (Gemini's), an execute call's title is its command.
    let command = match &req.tool_call.fields.raw_input {
        Some(raw) => command_of(Some(raw)),
        None => req.tool_call.fields.title.clone(),
    }
    .map(|c| local::unwrap_quoted(&c));
    let read_paths = read_paths(&req);
    let raw_input = req.tool_call.fields.raw_input.clone();
    let edits_steering = changes_steering(&SessionUpdate::ToolCallUpdate(req.tool_call.clone()), &a.cwd);
    let release = req
        .tool_call
        .fields
        .title
        .as_deref()
        .and_then(|title| ask::release_approval(title, req.tool_call.fields.raw_input.as_ref(), &a.cwd));
    let Some(RunEvent::Tool { title, tool_kind, detail, mcp, .. }) =
        a.turn.apply(&req.session_id.0, SessionUpdate::ToolCallUpdate(req.tool_call))
    else {
        unreachable!("tool call updates always map to tool events")
    };
    for event in a.turn.take_extra() {
        a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
    }
    // Codex asks for MCP calls without a title of their own: the tool call's (`mcp.gonggong.<tool>`) tells.
    if ask::is_builtin(&title) {
        return Permission::Now(auto_allow(&req.options));
    }
    let command = command.filter(|_| tool_kind == "execute");
    if let Some(original) = original
        && gate::may_write(&tool_kind, command.as_deref(), mcp.is_some(), &a.cwd)
    {
        let target = gate::target(&tool_kind, &read_paths, &a.cwd);
        return gate::hold(shared, s, original, target);
    }
    let read_only_tool = command.is_none()
        && matches!(tool_kind.as_str(), "read" | "search")
        && a.rules.reads_within(&read_paths, &a.cwd);
    let workspace_write = command.is_none()
        && matches!(tool_kind.as_str(), "edit" | "delete" | "move")
        && a.rules.writes_within(&read_paths, &a.cwd);
    // A turn sharing its directory runs in the read-only tier's mode: what the bot's own mode changes without asking
    // goes on without a word, also before the agent took the switch back (Codex only does at its next prompt).
    let own_edit = a.gate.is_some()
        && a.tier == Tier::Workspace
        && command.is_none()
        && matches!(tool_kind.as_str(), "edit" | "delete" | "move")
        && local::trust::edits_within(&a.rules, &read_paths, &a.cwd);
    let decision = a.rules.decide(a.tier, command.as_deref(), &title, &a.cwd, &s.always);
    // What this command changes steers the build and test commands run after it.
    if edits_steering || command.as_deref().is_some_and(local::steers) {
        a.rules.tampered = true;
    }
    if decision == Decision::Full || read_only_tool || own_edit {
        return Permission::Now(auto_allow(&req.options));
    }
    if (decision == Decision::Local || workspace_write)
        && let Some(allow) = auto_allow(&req.options)
    {
        let shown = command.clone().unwrap_or_else(|| title.clone());
        let step = t!("已按命令审批规则自动批准：{command}", command = shown);
        let action = command.clone().or_else(|| detail.clone()).unwrap_or(shown);
        let event = RunEvent::Status { status: RunStatus::Running, step };
        a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
        a.out.send(DaemonToServer::ApprovalAiApproved(ApprovalAiApproved {
            run_id: a.run_id.clone(),
            title,
            tool_kind,
            detail: action,
            source: AutoSource::Rule,
        }));
        return Permission::Now(Some(allow));
    }
    let request_id = format!("{}/{n}", a.run_id);
    let remember = a.rules.remember(command.as_deref(), &title, &a.cwd);
    let remember_session = a.rules.remember_session(command.as_deref(), &title, &a.cwd);
    let reason = a.rules.reason(command.as_deref(), &tool_kind, &a.cwd);
    // The whole command, not the run timeline's clipped line: the owner approves what runs.
    let detail = match (release, &command) {
        (Some(r), _) => r,
        (None, Some(c)) => {
            let note = detail.as_deref().and_then(|d| d.split_once('\n')).map(|(_, rest)| format!("\n{rest}"));
            clip_detail(format!("$ {c}{}", note.unwrap_or_default()))
        }
        (None, None) => detail.unwrap_or_else(|| title.clone()),
    };
    let wire = ApprovalRequest {
        run_id: a.run_id.clone(),
        request_id: request_id.clone(),
        detail,
        reason,
        title: title.clone(),
        tool_kind,
        options: wire_options(&req.options),
        remember: remember.clone(),
        remember_session: remember_session.clone(),
        mcp: mcp.map(|m| approval_mcp(&a.mcp, m, raw_input.as_ref())),
    };
    let (tx, rx) = oneshot::channel();
    s.approvals.insert(request_id, Approval { title, remember, remember_session, options: req.options, tx });
    ask_owner(&a.out, wire);
    Permission::Ask(rx)
}

/// An agent may title an MCP call by its tool alone and name the server in `_meta` (its manifest's
/// `permission.mcpMeta`): named the Claude way (`mcp__<server>__<tool>`), the built-in gonggong tools are told apart
/// and the card says which server asks.
pub(super) fn name_mcp_call(req: &mut RequestPermissionRequest) {
    let meta = req.tool_call.meta.as_ref();
    let mcp = meta.and_then(|m| crate::adapters::mcp_meta_keys().find_map(|k| m.get(k))).map(|g| &g["mcp"]);
    if let Some((server, tool)) = mcp.and_then(|m| Some((m["server_name"].as_str()?, m["tool_name"].as_str()?))) {
        req.tool_call.fields.title = Some(format!("mcp__{server}__{tool}"));
    }
}

/// The MCP call of a request with its whole arguments (the run timeline's are clipped) and what the tool declares.
fn approval_mcp(servers: &[McpServer], call: McpCall, raw_input: Option<&serde_json::Value>) -> ApprovalMcp {
    let args = raw_input.map(crate::mcp_call::arguments).filter(|a| !a.is_null());
    let input = args.map(|a| clip_detail(a.to_string())).or(call.input);
    let info = crate::mcp_tools::lookup(servers, &call.server, &call.tool).unwrap_or_default();
    ApprovalMcp { server: call.server, tool: call.tool, input, info }
}

/// Long enough for any command an agent writes; past it, the card says so.
const APPROVAL_DETAIL_MAX: usize = 20_000;

fn clip_detail(s: String) -> String {
    match s.char_indices().nth(APPROVAL_DETAIL_MAX) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s,
    }
}
