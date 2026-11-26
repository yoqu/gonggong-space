//! Concrete model resolution (pre-turn config/settings, mid-turn updates, post-turn transcript tail)
//! and ACP usage forwarding (including prompt cache token counts).
use crate::inject;
use crate::protocol::{AgentKind, Usage};
use crate::providers::Selection;
use agent_client_protocol::schema::v1::{
    SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory, SessionConfigSelectOption,
    SessionConfigSelectOptions, Usage as AcpUsage,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// The adapters' "use your own default" sentinel; never reported as a concrete model.
pub(super) const ADAPTER_DEFAULT: &str = "default";
const SYNTHETIC_MODEL: &str = "<synthetic>";
const TAIL_BYTES: u64 = 64 * 1024;
const MAX_TAIL_BYTES: u64 = 512 * 1024;
const MAX_WALK_ENTRIES: usize = 5_000;

/// Returns a trimmed concrete model id, dropping empty strings, `"default"`, and `"<synthetic>"`.
pub(super) fn concrete_model(raw: Option<&str>) -> Option<String> {
    let s = raw?.trim();
    if s.is_empty() || s.eq_ignore_ascii_case(ADAPTER_DEFAULT) || s == SYNTHETIC_MODEL {
        return None;
    }
    Some(s.to_string())
}

/// Converts ACP end-of-turn token usage (including cache read/write counts) to protocol `Usage`.
/// Drops all-zero reports (Claude emits total_tokens == 0 for cancelled turns).
pub(super) fn usage_from_acp(resp: Option<AcpUsage>, cost_usd: Option<f64>) -> Option<Usage> {
    resp.filter(|u| u.total_tokens > 0).map(|u| Usage {
        input_tokens: Some(u.input_tokens),
        output_tokens: Some(u.output_tokens),
        total_tokens: Some(u.total_tokens),
        cached_read_tokens: u.cached_read_tokens,
        cached_write_tokens: u.cached_write_tokens,
        cost_usd,
    })
}

/// Model-related configuration merged from Claude launch settings, provider/profile settings, and CLI settings.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct ClaudeModelHints {
    pub anthropic_model: Option<String>,
    pub settings_model: Option<String>,
    pub opus: Option<String>,
    pub sonnet: Option<String>,
    pub haiku: Option<String>,
}

impl ClaudeModelHints {
    pub(super) fn collect(
        selection: &Selection,
        launch: Option<&inject::ClaudeLaunch>,
        user_home: &Path,
    ) -> Self {
        let mut hints = Self::default();
        // 1. Flag settings file written for this launch (highest precedence).
        if let Some((_, doc)) = launch.and_then(|l| l.file.as_ref()) {
            hints.merge_settings_value(doc);
        }
        // 2. Process env from selection (official extras or provider endpoint env).
        let proc_env = selection.process_env();
        hints.merge_env_map(&proc_env);
        // 3. Third-party provider endpoint explicit model & model tier mappings.
        if let Some((_, e)) = selection.provider() {
            if hints.anthropic_model.is_none() {
                hints.anthropic_model = concrete_model(e.model.as_deref());
            }
            if let Some(m) = &e.models {
                if hints.opus.is_none() {
                    hints.opus = concrete_model(m.opus.as_deref());
                }
                if hints.sonnet.is_none() {
                    hints.sonnet = concrete_model(m.sonnet.as_deref());
                }
                if hints.haiku.is_none() {
                    hints.haiku = concrete_model(m.haiku.as_deref());
                }
            }
            hints.merge_env_map(&e.env);
        }
        // 4. Local Claude profile's settings.json, else user CLI settings.json when inherited.
        if let Some(dir) = selection.claude_profile() {
            hints.merge_settings_file(&dir.join("settings.json"));
        } else if launch.is_none_or(|l| l.inherit_cli) {
            let dir = claude_cli_dir(selection, user_home);
            hints.merge_settings_file(&dir.join("settings.json"));
        }
        hints
    }

    fn merge_settings_file(&mut self, path: &Path) {
        let Ok(raw) = std::fs::read_to_string(path) else { return };
        let Ok(doc) = serde_json::from_str::<Value>(&raw) else { return };
        self.merge_settings_value(&doc);
    }

    fn merge_settings_value(&mut self, doc: &Value) {
        if let Some(env) = doc.get("env").and_then(Value::as_object) {
            let get = |k: &str| concrete_model(env.get(k).and_then(Value::as_str));
            if self.anthropic_model.is_none() {
                self.anthropic_model = get("ANTHROPIC_MODEL");
            }
            if self.opus.is_none() {
                self.opus = get("ANTHROPIC_DEFAULT_OPUS_MODEL");
            }
            if self.sonnet.is_none() {
                self.sonnet = get("ANTHROPIC_DEFAULT_SONNET_MODEL");
            }
            if self.haiku.is_none() {
                self.haiku = get("ANTHROPIC_DEFAULT_HAIKU_MODEL");
            }
        }
        if self.settings_model.is_none() {
            self.settings_model = concrete_model(doc.get("model").and_then(Value::as_str));
        }
    }

    fn merge_env_map(&mut self, env: &std::collections::BTreeMap<String, String>) {
        let get = |k: &str| concrete_model(env.get(k).map(String::as_str));
        if self.anthropic_model.is_none() {
            self.anthropic_model = get("ANTHROPIC_MODEL");
        }
        if self.opus.is_none() {
            self.opus = get("ANTHROPIC_DEFAULT_OPUS_MODEL");
        }
        if self.sonnet.is_none() {
            self.sonnet = get("ANTHROPIC_DEFAULT_SONNET_MODEL");
        }
        if self.haiku.is_none() {
            self.haiku = get("ANTHROPIC_DEFAULT_HAIKU_MODEL");
        }
    }

    /// Expands Claude short aliases (`opus`, `sonnet`, `haiku`, with optional `[1m]` suffix)
    /// when the corresponding `ANTHROPIC_DEFAULT_*_MODEL` mapping is configured.
    pub(super) fn resolve_alias(&self, model: &str) -> String {
        let trimmed = model.trim();
        let Some((target, suffix)) = alias_target(self, trimmed) else {
            return trimmed.to_string();
        };
        if !suffix.is_empty() && !target.contains('[') {
            format!("{target}{suffix}")
        } else {
            target.to_string()
        }
    }

    /// Default concrete model configured in `ANTHROPIC_MODEL` or top-level `"model"`.
    pub(super) fn default_model(&self) -> Option<String> {
        let raw = self.anthropic_model.as_deref().or(self.settings_model.as_deref())?;
        concrete_model(Some(&self.resolve_alias(raw)))
    }
}

fn alias_target<'a>(hints: &'a ClaudeModelHints, model: &'a str) -> Option<(&'a str, &'a str)> {
    let (base, suffix) = match model.find('[') {
        Some(idx) => (&model[..idx], &model[idx..]),
        None => (model, ""),
    };
    let target = match base.to_ascii_lowercase().as_str() {
        "opus" => hints.opus.as_deref()?,
        "sonnet" => hints.sonnet.as_deref()?,
        "haiku" => hints.haiku.as_deref()?,
        _ => return None,
    };
    Some((target, suffix))
}

/// Resolves the best known concrete model before a turn starts (`Conversation::configure`).
#[allow(clippy::too_many_arguments)]
pub(super) fn resolve_pre_turn_model(
    agent_kind: AgentKind,
    selection: &Selection,
    launch: Option<&inject::ClaudeLaunch>,
    user_home: &Path,
    bot_model: Option<&str>,
    unlisted: Option<String>,
    options: &[SessionConfigOption],
    applied: &HashMap<String, String>,
    models_current: Option<&str>,
) -> Option<String> {
    let hints = (agent_kind == AgentKind::Claude).then(|| ClaudeModelHints::collect(selection, launch, user_home));
    let expand = |m: String| match &hints {
        Some(h) => h.resolve_alias(&m),
        None => m,
    };
    // a) Third-party provider injected model not listed in adapter's options.
    if let Some(m) = concrete_model(unlisted.as_deref()) {
        return Some(expand(m));
    }
    // b) Non-"default" Model config option value (preferring what we just applied).
    let model_opt = find_model_option(options);
    if let Some((id, current, _)) = &model_opt {
        let chosen = applied.get(id).map(String::as_str).unwrap_or(current.as_str());
        if let Some(m) = concrete_model(Some(chosen)) {
            return Some(expand(m));
        }
    }
    // c) When Model config option is "default" (or absent): concrete settings/provider/bot/choice metadata.
    if let Some(m) = hints.as_ref().and_then(ClaudeModelHints::default_model) {
        return Some(m);
    }
    if let Some((p, e)) = selection.provider().filter(|(_, e)| e.claude_profile().is_none())
        && let Some(m) = concrete_model(inject::model(p, e, bot_model).or_else(|| e.model.clone()).as_deref())
    {
        return Some(expand(m));
    }
    if let Some(m) = concrete_model(bot_model) {
        return Some(expand(m));
    }
    if let Some((_, _, default_choice)) = &model_opt
        && let Some(choice) = default_choice.as_ref()
        && let Some(m) = model_from_choice_meta(choice)
    {
        return Some(expand(m));
    }
    if agent_kind == AgentKind::Codex {
        let codex_home = codex_home_dir(selection, user_home);
        if let Some(m) = read_codex_config_model(&codex_home.join("config.toml")) {
            return Some(m);
        }
    }
    // d) Older ACP `models` object (`current` when concrete).
    concrete_model(models_current).map(expand)
}

/// Extracts a concrete model from a mid-turn `SessionUpdate::ConfigOptionUpdate`.
pub(super) fn model_from_config_options(
    agent_kind: AgentKind,
    selection: &Selection,
    launch: Option<&inject::ClaudeLaunch>,
    user_home: &Path,
    options: &[SessionConfigOption],
) -> Option<String> {
    let (_, current, default_choice) = find_model_option(options)?;
    let hints = (agent_kind == AgentKind::Claude).then(|| ClaudeModelHints::collect(selection, launch, user_home));
    let expand = |m: String| match &hints {
        Some(h) => h.resolve_alias(&m),
        None => m,
    };
    if let Some(m) = concrete_model(Some(&current)) {
        return Some(expand(m));
    }
    default_choice.as_ref().and_then(model_from_choice_meta).map(expand)
}

/// Combines pre-turn, mid-turn config update, and post-turn served transcript models for `RunDone.model`.
/// Post-turn served model takes highest precedence (replacing `None` or short aliases like `opus`/`sonnet`/`haiku`).
pub(super) fn combine_done_model(
    pre_turn: Option<String>,
    updated: Option<String>,
    post_turn: Option<String>,
) -> Option<String> {
    concrete_model(post_turn.as_deref())
        .or_else(|| concrete_model(updated.as_deref()))
        .or_else(|| concrete_model(pre_turn.as_deref()))
}

fn find_model_option(
    options: &[SessionConfigOption],
) -> Option<(String, String, Option<SessionConfigSelectOption>)> {
    options.iter().filter(|o| o.category.as_ref() == Some(&SessionConfigOptionCategory::Model)).find_map(|o| {
        let SessionConfigKind::Select(sel) = &o.kind else { return None };
        let list: Vec<&SessionConfigSelectOption> = match &sel.options {
            SessionConfigSelectOptions::Ungrouped(items) => items.iter().collect(),
            SessionConfigSelectOptions::Grouped(groups) => groups.iter().flat_map(|g| &g.options).collect(),
            _ => vec![],
        };
        let default_choice = list.into_iter().find(|c| c.value.0.eq_ignore_ascii_case(ADAPTER_DEFAULT)).cloned();
        Some((o.id.0.to_string(), sel.current_value.0.to_string(), default_choice))
    })
}

/// Extracts an unambiguous concrete model ID from a `"default"` choice's metadata, name, or description.
/// Never invents a model ID from free-form prose.
fn model_from_choice_meta(choice: &SessionConfigSelectOption) -> Option<String> {
    if let Some(meta) = &choice.meta {
        for key in ["model", "modelId", "model_id", "defaultModel"] {
            if let Some(m) = concrete_model(meta.get(key).and_then(Value::as_str)) {
                return Some(m);
            }
        }
    }
    extract_unambiguous_model_id(&choice.name)
        .or_else(|| choice.description.as_deref().and_then(extract_unambiguous_model_id))
}

fn extract_unambiguous_model_id(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if looks_like_model_id(trimmed) {
        return concrete_model(Some(trimmed));
    }
    for segment in trimmed.split('(').skip(1) {
        if let Some((inside, _)) = segment.split_once(')') {
            let candidate = inside.trim();
            if looks_like_model_id(candidate) {
                return concrete_model(Some(candidate));
            }
        }
    }
    None
}

fn looks_like_model_id(s: &str) -> bool {
    if s.is_empty() || s.len() > 128 || s.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    let prefixes = [
        "claude-",
        "gpt-",
        "o1-",
        "o3-",
        "o4-",
        "gemini-",
        "deepseek-",
        "glm-",
        "kimi-",
        "qwen",
        "minimax-",
        "grok-",
        "llama-",
        "mistral-",
        "codex-",
    ];
    let bare = lower.rsplit_once('/').map_or(lower.as_str(), |(_, right)| right);
    prefixes.iter().any(|p| bare.starts_with(p))
        && bare.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':' | b'[' | b']'))
        && bare.bytes().any(|b| b.is_ascii_digit())
}

fn env_dir(selection: &Selection, key: &str, user_home: &Path) -> Option<PathBuf> {
    selection
        .process_env()
        .get(key)
        .cloned()
        .or_else(|| {
            // Only consult ambient process env when running against the real user home,
            // so tests using a temporary user_home stay isolated from the host environment.
            (user_home == crate::config::user_home())
                .then(|| std::env::var_os(key).map(|v| v.to_string_lossy().into_owned()))
                .flatten()
        })
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
}

fn claude_cli_dir(selection: &Selection, user_home: &Path) -> PathBuf {
    env_dir(selection, "CLAUDE_CONFIG_DIR", user_home).unwrap_or_else(|| user_home.join(".claude"))
}

fn codex_home_dir(selection: &Selection, user_home: &Path) -> PathBuf {
    env_dir(selection, "CODEX_HOME", user_home).unwrap_or_else(|| user_home.join(".codex"))
}

fn pi_home_dir(selection: &Selection, user_home: &Path) -> PathBuf {
    env_dir(selection, "PI_CODING_AGENT_DIR", user_home)
        .map(|p| expand_tilde(&p, user_home))
        .unwrap_or_else(|| user_home.join(".pi").join("agent"))
}

fn pi_session_dir(selection: &Selection, pi_dir: &Path, user_home: &Path) -> Option<PathBuf> {
    if let Some(dir) = env_dir(selection, "PI_CODING_AGENT_SESSION_DIR", user_home) {
        return Some(expand_tilde(&dir, user_home));
    }
    let raw = std::fs::read_to_string(pi_dir.join("settings.json")).ok()?;
    let doc: Value = serde_json::from_str(&raw).ok()?;
    let dir = doc.get("sessionDir")?.as_str()?.trim();
    (!dir.is_empty()).then(|| expand_tilde(Path::new(dir), user_home))
}

fn expand_tilde(path: &Path, user_home: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s == "~" {
        return user_home.to_path_buf();
    }
    if let Some(rest) = s.strip_prefix("~/").or_else(|| s.strip_prefix("~\\")) {
        return user_home.join(rest);
    }
    path.to_path_buf()
}

/// Parameters for fast post-turn served model discovery from the agent's own local session transcript.
#[derive(Debug, Clone)]
pub(super) struct PostTurnProbe {
    pub agent_kind: AgentKind,
    pub cwd: PathBuf,
    pub session_id: String,
    pub claude_dirs: Vec<PathBuf>,
    pub codex_home: PathBuf,
    pub pi_dir: PathBuf,
    pub pi_session_dir: Option<PathBuf>,
}

impl PostTurnProbe {
    pub(super) fn new(
        agent_kind: AgentKind,
        cwd: PathBuf,
        session_id: String,
        selection: &Selection,
        user_home: &Path,
    ) -> Self {
        let mut claude_dirs = Vec::new();
        if let Some(profile) = selection.claude_profile() {
            claude_dirs.push(profile.to_path_buf());
        }
        let default_claude = claude_cli_dir(selection, user_home);
        if !claude_dirs.iter().any(|d| d == &default_claude) {
            claude_dirs.push(default_claude);
        }
        let user_dot_claude = user_home.join(".claude");
        if !claude_dirs.iter().any(|d| d == &user_dot_claude) {
            claude_dirs.push(user_dot_claude);
        }
        let codex_home = codex_home_dir(selection, user_home);
        let pi_dir = pi_home_dir(selection, user_home);
        let pi_session_dir = (agent_kind == AgentKind::Pi)
            .then(|| pi_session_dir(selection, &pi_dir, user_home))
            .flatten();
        Self { agent_kind, cwd, session_id, claude_dirs, codex_home, pi_dir, pi_session_dir }
    }

    pub(super) fn discover(&self) -> Option<String> {
        if self.session_id.trim().is_empty() {
            return None;
        }
        match self.agent_kind {
            AgentKind::Claude => self.discover_claude(),
            AgentKind::Codex => self.discover_codex(),
            AgentKind::Pi => self.discover_pi(),
            _ => None,
        }
    }

    fn discover_claude(&self) -> Option<String> {
        let file = find_claude_session_file(&self.claude_dirs, &self.cwd, &self.session_id)?;
        parse_claude_transcript_tail(&file)
    }

    fn discover_codex(&self) -> Option<String> {
        if let Some(file) = find_codex_rollout_file(&self.codex_home, &self.session_id)
            && let Some(model) = parse_codex_rollout_tail(&file)
        {
            return Some(model);
        }
        read_codex_config_model(&self.codex_home.join("config.toml"))
    }

    fn discover_pi(&self) -> Option<String> {
        let file = find_pi_session_file(&self.pi_dir, self.pi_session_dir.as_deref(), &self.session_id)?;
        parse_pi_transcript_tail(&file)
    }
}

/// Runs post-turn transcript model discovery off the async executor; never fails a turn.
pub(super) async fn discover_served_model(probe: PostTurnProbe) -> Option<String> {
    tokio::task::spawn_blocking(move || probe.discover()).await.ok().flatten()
}

/// Encodes a workspace path into Claude Code's project folder name (non-alphanumeric characters become `-`).
pub(super) fn encode_claude_cwd(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect()
}

fn find_claude_session_file(claude_dirs: &[PathBuf], cwd: &Path, session_id: &str) -> Option<PathBuf> {
    let filename = format!("{session_id}.jsonl");
    let mut encoded = vec![encode_claude_cwd(cwd)];
    if let Ok(canon) = cwd.canonicalize() {
        let e = encode_claude_cwd(&canon);
        if !encoded.contains(&e) {
            encoded.push(e);
        }
    }
    // Fast path: direct O(1) lookup under <claude_dir>/projects/<encoded_cwd>/<session_id>.jsonl.
    for dir in claude_dirs {
        let projects = dir.join("projects");
        for slug in &encoded {
            let candidate = projects.join(slug).join(&filename);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    // Fallback: shallow scan of <claude_dir>/projects/*/<session_id>.jsonl for symlink/encoding edge cases.
    for dir in claude_dirs {
        let Ok(entries) = std::fs::read_dir(dir.join("projects")) else { continue };
        for entry in entries.flatten().take(MAX_WALK_ENTRIES) {
            let candidate = entry.path().join(&filename);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_codex_rollout_file(codex_home: &Path, session_id: &str) -> Option<PathBuf> {
    let matches_session = |name: &str| -> bool {
        if !name.ends_with(".jsonl") {
            return false;
        }
        let stem = &name[..name.len() - ".jsonl".len()];
        stem == session_id
            || stem.ends_with(&format!("-{session_id}"))
            || stem.contains(&format!("-{session_id}_"))
    };
    let sessions_root = codex_home.join("sessions");
    // Fast path: check today and yesterday (local & UTC) date folders first.
    let now_local = chrono::Local::now().date_naive();
    let now_utc = chrono::Utc::now().date_naive();
    let mut dates = vec![
        now_local,
        now_local.pred_opt().unwrap_or(now_local),
        now_utc,
        now_utc.pred_opt().unwrap_or(now_utc),
    ];
    dates.dedup();
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for d in dates {
        let day_dir = sessions_root
            .join(d.format("%Y").to_string())
            .join(d.format("%m").to_string())
            .join(d.format("%d").to_string());
        scan_dir_for_match(&day_dir, &matches_session, &mut best);
    }
    if let Some((_, path)) = best {
        return Some(path);
    }
    // Fallback: reverse-chronological bounded walk across sessions/ and archived_sessions/.
    let mut visited = 0usize;
    for folder in ["sessions", "archived_sessions"] {
        walk_newest_first(&codex_home.join(folder), &matches_session, &mut best, &mut visited);
        if best.is_some() {
            break;
        }
    }
    best.map(|(_, path)| path)
}

fn scan_dir_for_match(
    dir: &Path,
    matches: &impl Fn(&str) -> bool,
    best: &mut Option<(SystemTime, PathBuf)>,
) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if !matches(name_str) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(prev, _)| mtime >= *prev) {
            *best = Some((mtime, path));
        }
    }
}

fn walk_newest_first(
    dir: &Path,
    matches: &impl Fn(&str) -> bool,
    best: &mut Option<(SystemTime, PathBuf)>,
    visited: &mut usize,
) {
    if *visited >= MAX_WALK_ENTRIES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        if *visited >= MAX_WALK_ENTRIES {
            break;
        }
        *visited += 1;
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            subdirs.push(path);
        } else if ft.is_file()
            && entry.file_name().to_str().is_some_and(matches)
            && let Ok(meta) = entry.metadata()
        {
            let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if best.as_ref().is_none_or(|(prev, _)| mtime >= *prev) {
                *best = Some((mtime, path));
            }
        }
    }
    // Descending lexical order visits newest YYYY/MM/DD directories first.
    subdirs.sort_by(|a, b| b.cmp(a));
    for sub in subdirs {
        walk_newest_first(&sub, matches, best, visited);
        if *visited >= MAX_WALK_ENTRIES {
            break;
        }
    }
}

fn find_pi_session_file(pi_dir: &Path, session_dir: Option<&Path>, session_id: &str) -> Option<PathBuf> {
    let matches_session = |name: &str| -> bool {
        if !name.ends_with(".jsonl") {
            return false;
        }
        let stem = &name[..name.len() - ".jsonl".len()];
        stem == session_id || stem.ends_with(&format!("_{session_id}"))
    };
    let mut best: Option<(SystemTime, PathBuf)> = None;
    if let Some(dir) = session_dir {
        scan_dir_for_match(dir, &matches_session, &mut best);
    }
    let sessions = pi_dir.join("sessions");
    scan_dir_for_match(&sessions, &matches_session, &mut best);
    if let Ok(entries) = std::fs::read_dir(&sessions) {
        for entry in entries.flatten().take(MAX_WALK_ENTRIES) {
            if entry.file_type().is_ok_and(|t| t.is_dir()) {
                scan_dir_for_match(&entry.path(), &matches_session, &mut best);
            }
        }
    }
    best.map(|(_, path)| path)
}

/// Reads at most `max_bytes` from the tail of `path`. Returns `(text, truncated)`.
/// When truncated, drops the leading partial line up to the first `\n`.
fn read_tail(path: &Path, max_bytes: u64) -> Option<(String, bool)> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let (start, truncated) = if len > max_bytes { (len - max_bytes, true) } else { (0, false) };
    if start > 0 {
        file.seek(SeekFrom::Start(start)).ok()?;
    }
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut buf).ok()?;
    let slice = if truncated {
        match buf.iter().position(|&b| b == b'\n') {
            Some(nl) => &buf[nl + 1..],
            None => &buf[..],
        }
    } else {
        &buf[..]
    };
    Some((String::from_utf8_lossy(slice).into_owned(), truncated))
}

fn scan_tail<F>(path: &Path, mut parse_chunk: F) -> Option<String>
where
    F: FnMut(&str) -> Option<String>,
{
    let (tail, truncated) = read_tail(path, TAIL_BYTES)?;
    if let Some(found) = parse_chunk(&tail) {
        return Some(found);
    }
    if truncated {
        let (larger, _) = read_tail(path, MAX_TAIL_BYTES)?;
        return parse_chunk(&larger);
    }
    None
}

#[derive(Deserialize)]
struct ClaudeTranscriptLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    message: Option<ClaudeTranscriptMessage>,
}

#[derive(Deserialize)]
struct ClaudeTranscriptMessage {
    role: Option<String>,
    model: Option<String>,
}

/// Extracts the latest concrete assistant `message.model` from a Claude Code JSONL transcript tail,
/// skipping `"<synthetic>"`, `"default"`, and non-assistant lines.
pub(super) fn parse_claude_transcript_tail(path: &Path) -> Option<String> {
    scan_tail(path, |chunk| {
        for line in chunk.lines().rev() {
            if !line.contains("\"model\"") {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<ClaudeTranscriptLine>(line) else { continue };
            let Some(msg) = entry.message else { continue };
            let is_assistant =
                entry.kind.as_deref() == Some("assistant") || msg.role.as_deref() == Some("assistant");
            if !is_assistant {
                continue;
            }
            if let Some(model) = concrete_model(msg.model.as_deref()) {
                return Some(model);
            }
        }
        None
    })
}

#[derive(Deserialize)]
struct CodexRolloutLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<CodexRolloutPayload>,
}

#[derive(Deserialize)]
struct CodexRolloutPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    model: Option<String>,
    thread_settings: Option<CodexThreadSettings>,
}

#[derive(Deserialize)]
struct CodexThreadSettings {
    model: Option<String>,
}

/// Extracts the latest concrete `turn_context.payload.model` (or `thread_settings_applied`)
/// from a Codex rollout JSONL tail.
pub(super) fn parse_codex_rollout_tail(path: &Path) -> Option<String> {
    scan_tail(path, |chunk| {
        for line in chunk.lines().rev() {
            if !line.contains("turn_context") && !line.contains("thread_settings_applied") {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<CodexRolloutLine>(line) else { continue };
            let Some(payload) = entry.payload else { continue };
            if entry.kind.as_deref() == Some("turn_context")
                && let Some(model) = concrete_model(payload.model.as_deref())
            {
                return Some(model);
            }
            if entry.kind.as_deref() == Some("event_msg")
                && payload.kind.as_deref() == Some("thread_settings_applied")
                && let Some(model) =
                    concrete_model(payload.thread_settings.as_ref().and_then(|s| s.model.as_deref()))
            {
                return Some(model);
            }
        }
        None
    })
}

/// Reads top-level `model = "..."` from a Codex `config.toml` when present and concrete.
pub(super) fn read_codex_config_model(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let doc = toml::from_str::<toml::Table>(&raw).ok()?;
    concrete_model(doc.get("model")?.as_str())
}

#[derive(Deserialize)]
struct PiTranscriptLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(rename = "modelId")]
    model_id: Option<String>,
    model: Option<String>,
    message: Option<PiTranscriptMessage>,
}

#[derive(Deserialize)]
struct PiTranscriptMessage {
    role: Option<String>,
    model: Option<String>,
}

/// Extracts the latest concrete assistant `message.model` (falling back to `model_change`) from a Pi JSONL tail.
pub(super) fn parse_pi_transcript_tail(path: &Path) -> Option<String> {
    scan_tail(path, |chunk| {
        let mut fallback: Option<String> = None;
        for line in chunk.lines().rev() {
            if !line.contains("\"model\"") && !line.contains("model_change") {
                continue;
            }
            let Ok(entry) = serde_json::from_str::<PiTranscriptLine>(line) else { continue };
            if entry.kind.as_deref() == Some("message")
                && let Some(msg) = entry.message
                && msg.role.as_deref() == Some("assistant")
                && let Some(model) = concrete_model(msg.model.as_deref())
            {
                return Some(model);
            }
            if fallback.is_none() && entry.kind.as_deref() == Some("model_change") {
                let candidate = entry.model_id.as_deref().or_else(|| {
                    entry.model.as_deref().and_then(|m| m.split_once('/').map(|(_, id)| id).or(Some(m)))
                });
                fallback = concrete_model(candidate);
            }
        }
        fallback
    })
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
