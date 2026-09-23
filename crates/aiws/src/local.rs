//! The owner's local settings (`<home>/local.json`), shared by `aiws run`, the CLI and the desktop app: agent CLI
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
    /// Plan D15. `command` is the shell command of an execute-kind tool call, `None` for any other request.
    pub fn decide(&self, tier: Tier, command: Option<&str>) -> Decision {
        let local = match self.approval {
            Approval::All => true,
            Approval::Allowlist => command.is_some_and(|c| allowlisted(&self.allowlist, c)),
            Approval::Ask => false,
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

/// A single command starting with an allowlisted prefix at a word boundary. Anything the shell could chain or
/// substitute (`go build && rm -rf ~`, `$(…)`) is never allowlisted, since the prefix would vouch for the rest.
pub fn allowlisted(prefixes: &[String], command: &str) -> bool {
    // Checked before normalizing, which would turn a newline (a command separator) into a space.
    if !single_command(command) {
        return false;
    }
    let command = normalize(command);
    prefixes
        .iter()
        .map(|p| normalize(p))
        .any(|p| !p.is_empty() && command.strip_prefix(&p).is_some_and(|rest| rest.is_empty() || rest.starts_with(' ')))
}

/// No unquoted control operators, redirections, subshells or substitutions (double quotes still substitute).
fn single_command(command: &str) -> bool {
    let (mut single, mut double, mut chars) = (false, false, command.chars().peekable());
    while let Some(c) = chars.next() {
        match c {
            '\'' if !double => single = !single,
            _ if single => {}
            '\\' => {
                chars.next();
            }
            '"' => double = !double,
            '`' => return false,
            '$' if chars.peek() == Some(&'(') => return false,
            _ if double => {}
            ';' | '&' | '|' | '<' | '>' | '(' | ')' | '\n' => return false,
            _ => {}
        }
    }
    !single && !double
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
            (Tier::Workspace, Approval::Allowlist, Some("go build $(curl x)"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"`id`\""), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"$(id)\""), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build 'a;b|c $(x)'"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build \"a;b\""), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build 'unterminated"), Ask),
        ];
        for (tier, approval, command, want) in cases {
            assert_eq!(bot(*approval, &list).decide(*tier, *command), *want, "{tier:?} {approval:?} {command:?}");
        }
        assert_eq!(bot(Approval::Allowlist, &[]).decide(Tier::Workspace, Some("go build")), Ask);
        let node = bot(Approval::Allowlist, &["node -e"]);
        assert_eq!(node.decide(Tier::Workspace, Some("node -e \"console.log(1 + 1)\"")), Local);
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
