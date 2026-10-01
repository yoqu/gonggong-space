//! The owner's local settings (`<home>/local.json`), shared by `gg run`, the CLI and the desktop app: the agent CLI
//! path per agent. Model, effort and the bot's 命令审批 are set on the server (plan J8): `Rules` applies the latter to
//! permission requests here. Also the catalog probed from each adapter (`<home>/models.json`), reported to the server
//! for its pickers.
use crate::protocol::{AgentCatalog, AgentKind, Approval, RunBot, Tier};
use crate::t;
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
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettings {
    /// Absolute path of the agent CLI, replacing detection on PATH.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// A bot's 命令审批 as sent by the server with each run (plan J8).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rules {
    pub approval: Approval,
    /// Command prefixes auto-approved in `allowlist` mode, e.g. `go build`.
    pub allowlist: Vec<String>,
}

impl From<&RunBot> for Rules {
    fn from(bot: &RunBot) -> Self {
        Self { approval: bot.approval, allowlist: bot.allowlist.clone() }
    }
}

/// Who answers a permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The `full` tier allows by itself.
    Full,
    /// The bot's rules allow it here without asking.
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
                let settings: Self = serde_json::from_str(&s).context(t!("本机设置 local.json 格式错误"))?;
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
                bail!(t!("{kind} 的路径必须是绝对路径：{p}", kind = format!("{kind:?}"), p = p));
            }
        }
        Ok(())
    }

    pub fn agent(&self, kind: AgentKind) -> AgentSettings {
        self.agents.get(&kind).cloned().unwrap_or_default()
    }
}

impl Rules {
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

/// A probed catalog and the adapter + CLI build it came from (`agents::catalog_key`); another build is probed again.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedCatalog {
    pub key: String,
    pub catalog: AgentCatalog,
}

fn catalogs_path(home: &Path) -> PathBuf {
    home.join("models.json")
}

/// Empty until an adapter was probed here; a file in an older format reads as empty too.
pub fn load_catalogs(home: &Path) -> BTreeMap<AgentKind, CachedCatalog> {
    std::fs::read_to_string(catalogs_path(home)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// The daemon and the desktop app may probe concurrently; their read-modify-write must not interleave.
static CATALOGS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn save_catalog(home: &Path, kind: AgentKind, cached: CachedCatalog) -> Result<()> {
    let _guard = CATALOGS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load_catalogs(home);
    all.insert(kind, cached);
    std::fs::create_dir_all(home)?;
    let tmp = catalogs_path(home).with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&all)?)?;
    std::fs::rename(&tmp, catalogs_path(home))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bot(approval: Approval, allowlist: &[&str]) -> Rules {
        Rules { approval, allowlist: allowlist.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn concurrent_catalog_saves_neither_fail_nor_lose_updates() {
        let home = tempfile::tempdir().unwrap();
        let cached = |key: String| CachedCatalog { key, catalog: AgentCatalog::default() };
        std::thread::scope(|s| {
            for i in 0..16 {
                let home = home.path();
                s.spawn(move || {
                    let kind = if i % 2 == 0 { AgentKind::Claude } else { AgentKind::Codex };
                    save_catalog(home, kind, cached(format!("k{i}"))).unwrap();
                });
            }
        });
        let all = load_catalogs(home.path());
        assert!(all.contains_key(&AgentKind::Claude) && all.contains_key(&AgentKind::Codex));
    }

    #[test]
    fn a_catalog_file_in_the_old_format_reads_as_empty() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("models.json"), r#"{"claude":{"models":[],"efforts":[]}}"#).unwrap();
        assert!(load_catalogs(home.path()).is_empty());
    }

    #[test]
    fn round_trips_and_defaults_missing_fields() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap(), LocalSettings::default());
        let mut s = LocalSettings::default();
        s.agents.insert(AgentKind::Claude, AgentSettings { path: Some("/opt/claude".into()) });
        s.save(home.path()).unwrap();
        assert_eq!(LocalSettings::load(home.path()).unwrap(), s);
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(LocalSettings::path(home.path())).unwrap()).unwrap();
        assert_eq!(raw["agents"]["claude"]["path"], "/opt/claude");

        // Model settings and bot rules of older versions are ignored: the server owns them now (plan J10).
        let old = r#"{"agents":{"claude":{"defaultModel":"opus","effort":"high"}},
            "bots":{"b1":{"approval":"all","allowlist":["go build"]},"b2":{"model":"haiku","approval":"sometimes"}}}"#;
        std::fs::write(LocalSettings::path(home.path()), old).unwrap();
        let s = LocalSettings::load(home.path()).unwrap();
        assert_eq!(s.agent(AgentKind::Claude), AgentSettings::default());
        s.save(home.path()).unwrap();
        assert!(!std::fs::read_to_string(LocalSettings::path(home.path())).unwrap().contains("bots"));
    }

    #[test]
    fn rejects_invalid_settings() {
        let home = tempfile::tempdir().unwrap();
        let mut s = LocalSettings::default();
        s.agents.insert(AgentKind::Codex, AgentSettings { path: Some("codex".into()) });
        assert!(s.save(home.path()).is_err());
        std::fs::write(LocalSettings::path(home.path()), r#"{"agents":{"claude":{"path":"claude"}}}"#).unwrap();
        assert!(LocalSettings::load(home.path()).is_err());
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
        let path = |p: &str| AgentSettings { path: Some(p.into()) };
        store.update(|s| s.agents.entry(AgentKind::Claude).or_default().path = Some("/opt/claude".into())).unwrap();
        assert!(rx.has_changed().unwrap());
        assert_eq!(rx.borrow_and_update().agent(AgentKind::Claude), path("/opt/claude"));
        assert!(store.update(|s| s.agents.entry(AgentKind::Codex).or_default().path = Some("codex".into())).is_err());

        let mut edited = LocalSettings::load(home.path()).unwrap();
        edited.agents.insert(AgentKind::Claude, path("/usr/bin/claude"));
        edited.save(home.path()).unwrap();
        store.refresh().unwrap();
        assert_eq!(rx.borrow_and_update().agent(AgentKind::Claude), path("/usr/bin/claude"));
        store.refresh().unwrap();
        assert!(!rx.has_changed().unwrap());
    }

    #[test]
    fn caches_catalogs_per_agent() {
        let home = tempfile::tempdir().unwrap();
        assert!(load_catalogs(home.path()).is_empty());
        let c = CachedCatalog {
            key: "2.1.4+0.81.0".into(),
            catalog: AgentCatalog { current: Some("opus".into()), ..Default::default() },
        };
        save_catalog(home.path(), AgentKind::Claude, c.clone()).unwrap();
        assert_eq!(load_catalogs(home.path()).get(&AgentKind::Claude), Some(&c));
    }
}
