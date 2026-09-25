//! The owner's local settings (`<home>/local.json`), shared by `gg run`, the CLI and the desktop app: agent CLI
//! path, default model and effort per agent; model override and command approval per bot (plan D15). Also the
//! model catalog each adapter reported (`<home>/models.json`) for pickers.
use crate::protocol::{AgentKind, Tier};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tokio::sync::watch;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettings {
    #[serde(default)]
    pub agents: BTreeMap<AgentKind, AgentSettings>,
    /// By bot id.
    #[serde(default)]
    pub bots: BTreeMap<String, BotSettings>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    /// Absolute path of the agent CLI, replacing detection on PATH.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Model for bots without their own; `None` = the adapter's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    /// The adapter's thought-level value (Claude `effort`, Codex `reasoning_effort`); `None` = the adapter's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BotSettings {
    /// `None` = follow the agent's default model.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub approval: Approval,
    /// Command prefixes auto-approved in `allowlist` mode, e.g. `go build`.
    #[serde(default)]
    pub allowlist: Vec<String>,
}

/// 命令审批: what happens to permission requests beyond the bot's tier.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Approval {
    /// 每次询问: every request goes to the bot owner.
    #[default]
    Ask,
    /// 白名单自动: commands starting with an allowlisted prefix are approved here.
    Allowlist,
    /// 全部自动: every request is approved here.
    All,
}

impl Approval {
    pub fn label(self) -> &'static str {
        match self {
            Approval::Ask => "每次询问",
            Approval::Allowlist => "白名单自动",
            Approval::All => "全部自动",
        }
    }
}

/// Who answers a permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The `full` tier allows by itself.
    Full,
    /// The owner's local rule allows it without asking.
    Local,
    /// Forward to the bot owner.
    Ask,
}

impl LocalSettings {
    pub fn path(home: &Path) -> PathBuf {
        home.join("local.json")
    }

    /// Missing file = defaults.
    pub fn load(home: &Path) -> Result<Self> {
        match std::fs::read_to_string(Self::path(home)) {
            Ok(s) => {
                let settings: Self = serde_json::from_str(&s).context("本机设置 local.json 格式错误")?;
                settings.validate()?;
                Ok(settings)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Validates and writes atomically, so a concurrent reader never sees a partial file.
    pub fn save(&self, home: &Path) -> Result<()> {
        self.validate()?;
        std::fs::create_dir_all(home)?;
        let path = Self::path(home);
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn validate(&self) -> Result<()> {
        for (kind, a) in &self.agents {
            if let Some(p) = &a.path
                && !Path::new(p).is_absolute()
            {
                bail!("{kind:?} 的路径必须是绝对路径：{p}");
            }
            non_blank(&a.default_model, "默认模型")?;
            non_blank(&a.effort, "推理强度")?;
        }
        for b in self.bots.values() {
            non_blank(&b.model, "模型")?;
            if b.allowlist.iter().any(|c| normalize(c).is_empty()) {
                bail!("白名单命令不能为空");
            }
        }
        Ok(())
    }

    pub fn agent(&self, kind: AgentKind) -> AgentSettings {
        self.agents.get(&kind).cloned().unwrap_or_default()
    }

    pub fn bot(&self, id: &str) -> BotSettings {
        self.bots.get(id).cloned().unwrap_or_default()
    }

    /// Bot override → agent default → `None` (the adapter's default).
    pub fn model_for(&self, kind: AgentKind, bot_id: &str) -> Option<String> {
        self.bot(bot_id).model.or(self.agent(kind).default_model)
    }
}

fn non_blank(v: &Option<String>, what: &str) -> Result<()> {
    if v.as_deref().is_some_and(|s| s.trim().is_empty()) {
        bail!("{what}不能为空");
    }
    Ok(())
}

impl BotSettings {
    /// Plan D15. `command` is the shell command of an execute-kind tool call, `None` for any other request; `cwd` is
    /// the run's workspace and `always` the commands the owner allowed always in this conversation.
    pub fn decide(&self, tier: Tier, command: Option<&str>, cwd: &Path, always: &[String]) -> Decision {
        let local = match self.approval {
            Approval::All => true,
            Approval::Allowlist => {
                command.is_some_and(|c| allowlisted(self.allowlist.iter().chain(always), c, cwd, true))
            }
            Approval::Ask => command.is_some_and(|c| allowlisted(always, c, cwd, false)),
        };
        match (tier, local) {
            (Tier::Full, _) => Decision::Full,
            (_, true) => Decision::Local,
            _ => Decision::Ask,
        }
    }
}

fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Commands that only read, allowed in `allowlist` mode without being listed.
const READ_ONLY: &[&str] =
    &["cat", "head", "tail", "wc", "grep", "ls", "pwd", "echo", "git status", "git diff", "git log", "git show"];

/// Every command of a chain or pipeline starts with a trusted prefix at a word boundary, or is harmless on its own:
/// a read-only command or a `cd` within `cwd`. At least one must be trusted, and read-only ones count as trusted only
/// if `read_only_trusted`. Anything the shell could substitute or write elsewhere is never allowed (see `commands`).
fn allowlisted<'a>(
    prefixes: impl IntoIterator<Item = &'a String>,
    command: &str,
    cwd: &Path,
    read_only_trusted: bool,
) -> bool {
    let Some(commands) = commands(command) else { return false };
    let prefixes: Vec<String> = prefixes.into_iter().map(|p| normalize(p)).collect();
    let mut trusted = false;
    for words in &commands {
        let line = words.join(" ");
        if starts_with_any(&line, prefixes.iter().map(String::as_str)) {
            trusted = true;
        } else if read_only(&line, words) {
            trusted |= read_only_trusted;
        } else if !cd_within(words, cwd) {
            return false;
        }
    }
    trusted
}

fn starts_with_any<'a>(line: &str, prefixes: impl IntoIterator<Item = &'a str>) -> bool {
    prefixes
        .into_iter()
        .any(|p| !p.is_empty() && line.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(' ')))
}

/// `git diff/log --output` writes a file.
fn read_only(line: &str, words: &[String]) -> bool {
    starts_with_any(line, READ_ONLY.iter().copied()) && !words.iter().any(|w| w.starts_with("--output"))
}

/// `cd <dir>` with a literal path inside `cwd`.
fn cd_within(words: &[String], cwd: &Path) -> bool {
    let [cd, dir] = words else { return false };
    let path = Path::new(dir);
    cd == "cd"
        && !dir.contains(['~', '$', '"', '\'', '\\', '*', '?', '[', '{'])
        && !dir.starts_with('-')
        && path.components().all(|c| c != std::path::Component::ParentDir)
        && (path.is_relative() || path.starts_with(cwd))
}

/// The commands the owner allowed by answering "always" to `command`, as trusted prefixes for the conversation.
pub fn remembered(command: &str) -> Vec<String> {
    commands(command).unwrap_or_default().iter().map(|words| words.join(" ")).collect()
}

/// Splits a shell line into its simple commands (words as written, quotes kept) at `&&`, `||`, `;`, `|` and newlines,
/// dropping redirections to a file descriptor or /dev/null. `None` if the shell could run or write anything else:
/// substitutions, subshells, other redirections, heredocs, background jobs, unterminated quotes.
fn commands(line: &str) -> Option<Vec<Vec<String>>> {
    let (mut all, mut words, mut word) = (Vec::new(), Vec::<String>::new(), String::new());
    let (mut single, mut double, mut chars) = (false, false, line.chars().peekable());
    let end_word = |words: &mut Vec<String>, word: &mut String| {
        if !word.is_empty() {
            words.push(std::mem::take(word));
        }
    };
    while let Some(c) = chars.next() {
        match c {
            _ if single => {
                single = c != '\'';
                word.push(c);
            }
            '\'' if !double => {
                single = true;
                word.push(c);
            }
            '"' => {
                double = !double;
                word.push(c);
            }
            '\\' => {
                word.push(c);
                word.extend(chars.next());
            }
            '`' => return None,
            '$' if chars.peek() == Some(&'(') => return None,
            _ if double => word.push(c),
            ' ' | '\t' => end_word(&mut words, &mut word),
            ';' | '\n' | '|' | '&' if !(c == '&' && chars.peek() == Some(&'>')) => {
                match (c, chars.peek()) {
                    ('|', Some('|')) | ('&', Some('&')) => {
                        chars.next();
                    }
                    ('|', Some('&')) | ('&', _) => return None,
                    _ => {}
                }
                end_word(&mut words, &mut word);
                if !words.is_empty() {
                    all.push(std::mem::take(&mut words));
                }
            }
            '>' | '&' => {
                // `N>…` redirects descriptor N: the digits are not a word.
                if word.chars().all(|d| d.is_ascii_digit()) {
                    word.clear();
                }
                end_word(&mut words, &mut word);
                if c == '&' {
                    chars.next();
                }
                chars.next_if_eq(&'>');
                if c == '>' && chars.next_if_eq(&'&').is_some() {
                    let fd: String = std::iter::from_fn(|| chars.next_if(char::is_ascii_digit)).collect();
                    if fd.is_empty() {
                        return None;
                    }
                } else {
                    while chars.next_if(|c| *c == ' ' || *c == '\t').is_some() {}
                    let target: String =
                        std::iter::from_fn(|| chars.next_if(|c| !" \t\n;&|<>()".contains(*c))).collect();
                    if target != "/dev/null" {
                        return None;
                    }
                }
            }
            '<' | '(' | ')' => return None,
            _ => word.push(c),
        }
    }
    if single || double {
        return None;
    }
    end_word(&mut words, &mut word);
    if !words.is_empty() {
        all.push(words);
    }
    (!all.is_empty()).then_some(all)
}

/// `LocalSettings` for a long-lived process (the desktop app): updates are saved and published to subscribers;
/// `refresh` picks up edits made by another process (the CLI).
pub struct LocalStore {
    home: PathBuf,
    tx: watch::Sender<LocalSettings>,
}

impl LocalStore {
    pub fn open(home: PathBuf) -> Result<Self> {
        let settings = LocalSettings::load(&home)?;
        Ok(Self { home, tx: watch::Sender::new(settings) })
    }

    pub fn get(&self) -> LocalSettings {
        self.tx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<LocalSettings> {
        self.tx.subscribe()
    }

    /// Applies `change` to the settings on disk (not a stale copy), saves and publishes them.
    pub fn update(&self, change: impl FnOnce(&mut LocalSettings)) -> Result<LocalSettings> {
        let mut settings = LocalSettings::load(&self.home)?;
        change(&mut settings);
        settings.save(&self.home)?;
        self.tx.send_replace(settings.clone());
        Ok(settings)
    }

    pub fn refresh(&self) -> Result<()> {
        let settings = LocalSettings::load(&self.home)?;
        self.tx.send_if_modified(|s| std::mem::replace(s, settings) != *s);
        Ok(())
    }
}

/// One entry of an adapter's select option.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    pub value: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// What an adapter offered in its latest new session: models, and thought levels of the model it started with.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModels {
    pub models: Vec<Choice>,
    /// The adapter's default model.
    pub current: Option<String>,
    pub efforts: Vec<Choice>,
    pub current_effort: Option<String>,
}

fn models_path(home: &Path) -> PathBuf {
    home.join("models.json")
}

/// Empty until the agent has run once on this machine.
pub fn load_models(home: &Path) -> BTreeMap<AgentKind, AgentModels> {
    std::fs::read_to_string(models_path(home)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// Sessions of several bots start concurrently; their read-modify-write of the shared catalog must not interleave.
static MODELS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn save_models(home: &Path, kind: AgentKind, models: AgentModels) -> Result<()> {
    let _guard = MODELS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load_models(home);
    if all.get(&kind) == Some(&models) {
        return Ok(());
    }
    all.insert(kind, models);
    std::fs::create_dir_all(home)?;
    let tmp = models_path(home).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&all)?)?;
    std::fs::rename(&tmp, models_path(home))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bot(approval: Approval, allowlist: &[&str]) -> BotSettings {
        BotSettings { model: None, approval, allowlist: allowlist.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn concurrent_catalog_saves_neither_fail_nor_lose_updates() {
        let home = tempfile::tempdir().unwrap();
        let catalog = |current: &str| AgentModels { current: Some(current.into()), ..AgentModels::default() };
        std::thread::scope(|s| {
            for i in 0..16 {
                let home = home.path();
                s.spawn(move || {
                    let kind = if i % 2 == 0 { AgentKind::Claude } else { AgentKind::Codex };
                    save_models(home, kind, catalog(&format!("m{i}"))).unwrap();
                });
            }
        });
        let all = load_models(home.path());
        assert!(all.contains_key(&AgentKind::Claude) && all.contains_key(&AgentKind::Codex));
    }

    #[test]
    fn round_trips_and_defaults_missing_fields() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap(), LocalSettings::default());
        let mut s = LocalSettings::default();
        s.agents.insert(
            AgentKind::Claude,
            AgentSettings { path: Some("/opt/claude".into()), default_model: Some("opus".into()), effort: None },
        );
        s.bots.insert("b1".into(), bot(Approval::Allowlist, &["go build"]));
        s.save(home.path()).unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap(), s);
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(LocalSettings::path(home.path())).unwrap()).unwrap();
        assert_eq!(raw["agents"]["claude"]["defaultModel"], "opus");
        assert_eq!(raw["bots"]["b1"]["approval"], "allowlist");

        std::fs::write(LocalSettings::path(home.path()), r#"{"bots":{"b2":{"model":"haiku"}}}"#).unwrap();
        let s = LocalSettings::load(home.path()).unwrap();
        assert_eq!(s.bot("b2"), BotSettings { model: Some("haiku".into()), ..Default::default() });
        assert_eq!(s.bot("nope").approval, Approval::Ask);
    }

    #[test]
    fn rejects_invalid_settings() {
        let home = tempfile::tempdir().unwrap();
        let mut s = LocalSettings::default();
        s.agents.insert(AgentKind::Codex, AgentSettings { path: Some("codex".into()), ..Default::default() });
        assert!(s.save(home.path()).is_err());
        let mut s = LocalSettings::default();
        s.bots.insert("b1".into(), bot(Approval::Allowlist, &["  "]));
        assert!(s.save(home.path()).is_err());
        let mut s = LocalSettings::default();
        s.bots.insert("b1".into(), BotSettings { model: Some(" ".into()), ..Default::default() });
        assert!(s.save(home.path()).is_err());
        std::fs::write(LocalSettings::path(home.path()), r#"{"bots":{"b1":{"approval":"sometimes"}}}"#).unwrap();
        assert!(LocalSettings::load(home.path()).is_err());
    }

    #[test]
    fn effective_model_prefers_the_bot_then_the_agent() {
        let mut s = LocalSettings::default();
        assert_eq!(s.model_for(AgentKind::Claude, "b1"), None);
        s.agents.insert(AgentKind::Claude, AgentSettings { default_model: Some("opus".into()), ..Default::default() });
        assert_eq!(s.model_for(AgentKind::Claude, "b1").as_deref(), Some("opus"));
        assert_eq!(s.model_for(AgentKind::Codex, "b1"), None);
        s.bots.insert("b1".into(), BotSettings { model: Some("haiku".into()), ..Default::default() });
        assert_eq!(s.model_for(AgentKind::Claude, "b1").as_deref(), Some("haiku"));
    }

    #[test]
    fn approval_decision_matrix() {
        use Decision::*;
        let list = ["go build", "npm  test"];
        let cases: &[(Tier, Approval, Option<&str>, Decision)] = &[
            (Tier::Full, Approval::Ask, None, Full),
            (Tier::Full, Approval::Allowlist, Some("rm -rf /"), Full),
            (Tier::Workspace, Approval::Ask, Some("go build ./..."), Ask),
            (Tier::Workspace, Approval::Ask, None, Ask),
            (Tier::Workspace, Approval::Ask, Some("git status"), Ask),
            (Tier::Workspace, Approval::All, None, Local),
            (Tier::ReadOnly, Approval::All, Some("rm -rf build"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build ./..."), Local),
            (Tier::ReadOnly, Approval::Allowlist, Some("go   build"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("npm test -- --watch=false"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go buildx"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go vet"), Ask),
            (Tier::Workspace, Approval::Allowlist, None, Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build && rm -rf ~"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build; curl x"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build\nrm -rf ~"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build | sh"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build > /etc/x"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build 2> err.log"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build < x"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build <<EOF"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build &"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("(go build)"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build $(curl x)"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"`id`\""), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"$(id)\""), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build 'a;b|c $(x)'"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"a;b\""), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build 'unterminated"), Ask),
            // Every command of a chain or pipeline must be allowed.
            (Tier::Workspace, Approval::Allowlist, Some("go build && npm test"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build 2>&1 | tail -3"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build >/dev/null 2>&1 || npm test"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build &>/dev/null"), Local),
            // Read-only commands are built in; `cd` stays within the workspace.
            (Tier::Workspace, Approval::Allowlist, Some("cat README.md | grep -n x | head"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("git diff --output=/tmp/x"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd /w/apps && go build"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("cd apps/web && go build"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("cd /w"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd /etc && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd /wx && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd apps/../.. && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd ~ && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd $HOME && go build"), Ask),
        ];
        let cwd = Path::new("/w");
        for (tier, approval, command, want) in cases {
            let got = bot(*approval, &list).decide(*tier, *command, cwd, &[]);
            assert_eq!(got, *want, "{tier:?} {approval:?} {command:?}");
        }
        assert_eq!(bot(Approval::Allowlist, &[]).decide(Tier::Workspace, Some("go build"), cwd, &[]), Ask);
        let node = bot(Approval::Allowlist, &["node -e"]);
        assert_eq!(node.decide(Tier::Workspace, Some("node -e \"console.log(1 + 1)\""), cwd, &[]), Local);
    }

    #[test]
    fn always_allowed_commands_apply_in_every_mode() {
        let cwd = Path::new("/w");
        let always = remembered("cd /w && pnpm lint 2>&1 | tail -3");
        assert_eq!(always, ["cd /w", "pnpm lint", "tail -3"]);
        for approval in [Approval::Ask, Approval::Allowlist] {
            let b = bot(approval, &[]);
            assert_eq!(b.decide(Tier::Workspace, Some("pnpm lint --fix | head"), cwd, &always), Decision::Local);
            assert_eq!(b.decide(Tier::Workspace, Some("pnpm lint && rm x"), cwd, &always), Decision::Ask);
            assert_eq!(b.decide(Tier::Workspace, None, cwd, &always), Decision::Ask);
        }
        assert!(remembered("python3 - <<EOF").is_empty());
    }

    #[tokio::test]
    async fn the_store_publishes_updates_and_external_edits() {
        let home = tempfile::tempdir().unwrap();
        let store = LocalStore::open(home.path().into()).unwrap();
        let mut rx = store.subscribe();
        store.update(|s| s.bots.entry("b1".into()).or_default().approval = Approval::All).unwrap();
        assert!(rx.has_changed().unwrap());
        assert_eq!(rx.borrow_and_update().bot("b1").approval, Approval::All);
        assert!(store.update(|s| s.bots.entry("b1".into()).or_default().model = Some("".into())).is_err());

        let mut edited = LocalSettings::load(home.path()).unwrap();
        edited.bots.entry("b1".into()).or_default().model = Some("haiku".into());
        edited.save(home.path()).unwrap();
        store.refresh().unwrap();
        assert_eq!(rx.borrow_and_update().bot("b1").model.as_deref(), Some("haiku"));
        store.refresh().unwrap();
        assert!(!rx.has_changed().unwrap());
    }

    #[test]
    fn caches_models_per_agent() {
        let home = tempfile::tempdir().unwrap();
        assert!(load_models(home.path()).is_empty());
        let m = AgentModels {
            models: vec![Choice { value: "haiku".into(), name: "Haiku".into(), description: None }],
            current: Some("default".into()),
            ..Default::default()
        };
        save_models(home.path(), AgentKind::Claude, m.clone()).unwrap();
        assert_eq!(load_models(home.path()).get(&AgentKind::Claude), Some(&m));
    }
}
