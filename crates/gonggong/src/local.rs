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
    /// Command prefixes (e.g. `go build`) or `tool:<title>` auto-approved in `allowlist` mode.
    pub allowlist: Vec<String>,
    /// Rules the owner chose 始终允许 for, applied in `ask` and `allowlist` mode (plan A4).
    pub always_allow: Vec<String>,
}

impl From<&RunBot> for Rules {
    fn from(bot: &RunBot) -> Self {
        Self { approval: bot.approval, allowlist: bot.allowlist.clone(), always_allow: bot.always_allow.clone() }
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
    /// Plan D15. `command` is the shell command of an execute-kind tool call, `None` for any other request, which
    /// `tool:<title>` rules match; `cwd` is the run's workspace and `always` the rules the owner allowed always in this
    /// conversation. The floor (plan A6) always goes to the owner.
    pub fn decide(&self, tier: Tier, command: Option<&str>, title: &str, cwd: &Path, always: &[String]) -> Decision {
        if tier == Tier::Full {
            return Decision::Full;
        }
        if command.is_some_and(floor_hit) {
            return Decision::Ask;
        }
        let trusted = self.always_allow.iter().chain(always);
        let local = match self.approval {
            Approval::All => true,
            Approval::Allowlist => allowed(self.allowlist.iter().chain(trusted), command, title, cwd),
            Approval::Ask => allowed(trusted, command, title, cwd),
        };
        if local { Decision::Local } else { Decision::Ask }
    }
}

fn allowed<'a>(rules: impl Iterator<Item = &'a String>, command: Option<&str>, title: &str, cwd: &Path) -> bool {
    let (tools, prefixes): (Vec<&String>, Vec<&String>) = rules.partition(|r| r.starts_with(TOOL));
    match command {
        Some(c) => allowlisted(prefixes, c, cwd),
        None => tools.iter().any(|r| r[TOOL.len()..] == *title),
    }
}

const TOOL: &str = "tool:";

fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Commands that only read, trusted without being listed.
const READ_ONLY: &[&str] =
    &["cat", "head", "tail", "wc", "grep", "ls", "pwd", "echo", "git status", "git diff", "git log", "git show"];

/// Every command of a chain or pipeline starts with a trusted prefix at a word boundary, or is harmless on its own:
/// a read-only command or a `cd` within `cwd`. Anything the shell could substitute or write elsewhere is never allowed
/// (see `commands`).
fn allowlisted<'a>(prefixes: impl IntoIterator<Item = &'a String>, command: &str, cwd: &Path) -> bool {
    let Some(commands) = commands(command) else { return false };
    let prefixes: Vec<String> = prefixes.into_iter().map(|p| normalize(p)).collect();
    commands.iter().all(|words| {
        let line = words.join(" ");
        starts_with_any(&line, prefixes.iter().map(String::as_str)) || harmless(&line, words, cwd)
    })
}

fn harmless(line: &str, words: &[String], cwd: &Path) -> bool {
    read_only(line, words) || cd_within(words, cwd)
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

/// What an allow_always answer to a request trusts from now on (plan A2/A3); nothing for the floor.
pub fn remember(command: Option<&str>, title: &str, cwd: &Path) -> Vec<String> {
    match command {
        Some(c) if floor_hit(c) => vec![],
        Some(c) => remembered(c, cwd),
        None => vec![format!("{TOOL}{title}")],
    }
}

/// Programs whose arguments decide what they do: remembered with all of them.
const EXACT: &[&str] = &[
    "rm", "sudo", "su", "doas", "sh", "bash", "zsh", "fish", "python", "python3", "node", "deno", "bun", "perl",
    "ruby", "php", "eval", "exec", "xargs", "env", "curl", "wget", "ssh", "scp", "rsync", "dd", "chmod", "chown",
    "kill", "pkill", "killall", "mv",
];

/// The smallest prefix of each command that is not harmless: up to 3 plain words (`npm run build`), or the whole
/// command if it has fewer than 2 before other words, or runs an `EXACT` program.
pub fn remembered(command: &str, cwd: &Path) -> Vec<String> {
    let mut rules: Vec<String> = Vec::new();
    for words in commands(command).unwrap_or_default() {
        let line = words.join(" ");
        if harmless(&line, &words, cwd) {
            continue;
        }
        let plain: Vec<&str> = words.iter().map(String::as_str).take_while(|w| plain_word(w)).take(3).collect();
        let rule = if EXACT.contains(&base(&words[0])) || (plain.len() < 2 && words.len() > plain.len()) {
            line
        } else {
            plain.join(" ")
        };
        if !rules.contains(&rule) {
            rules.push(rule);
        }
    }
    rules
}

fn plain_word(w: &str) -> bool {
    let mut chars = w.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || "._:@+-".contains(c))
}

/// A word without its quotes, and the file name of a program path.
fn unquote(w: &str) -> &str {
    w.trim_matches(['"', '\''])
}

fn base(w: &str) -> &str {
    let w = unquote(w);
    w.rsplit('/').next().unwrap_or(w)
}

/// Programs that run the next word as a command.
const WRAPPERS: &[&str] = &["env", "command", "exec", "nohup", "time", "nice", "xargs"];

/// The program a command runs (file name) and its arguments, past variable assignments and wrappers.
fn program(words: &[String]) -> Option<(&str, &[String])> {
    let i = words.iter().position(|w| {
        let name = w.split_once('=').map_or(w.as_str(), |(n, _)| n);
        let assignment = w.contains('=') && plain_word(name) && !name.contains(['.', ':', '@', '+', '-']);
        !assignment && !WRAPPERS.contains(&base(w))
    })?;
    Some((base(&words[i]), &words[i + 1..]))
}

/// A short option cluster (`-rf`) containing one of `letters`.
fn short_has(w: &str, letters: &str) -> bool {
    w.starts_with('-') && !w.starts_with("--") && w.chars().skip(1).any(|c| letters.contains(c))
}

/// Plan A6: never trusted by any rule.
fn floor_hit(command: &str) -> bool {
    match segments(command) {
        Some(all) => all.iter().any(|(piped, words)| floor_segment(*piped, words)),
        None => {
            let line = normalize(command);
            ["sudo ", "rm -rf /", "| sh", "| bash"].iter().any(|k| line.contains(k))
        }
    }
}

fn floor_segment(piped: bool, words: &[String]) -> bool {
    let Some((name, args)) = program(words) else { return false };
    let args: Vec<&str> = args.iter().map(|a| unquote(a)).collect();
    let has = |a: &str| args.contains(&a);
    match name {
        "sudo" | "su" | "doas" => true,
        "sh" | "bash" | "zsh" | "node" => piped,
        _ if name.starts_with("python") => piped,
        _ if name.starts_with("mkfs") => true,
        "rm" => {
            let forced = args.iter().any(|a| short_has(a, "rRf") || matches!(*a, "--recursive" | "--force"));
            forced && args.iter().any(|a| sweeping(a))
        }
        "chmod" | "chown" => args.iter().any(|a| short_has(a, "R") || *a == "--recursive"),
        "dd" => args.iter().any(|a| a.starts_with("of=")),
        "git" => {
            let Some((sub, rest)) = git_subcommand(&args) else { return false };
            match sub {
                "push" => rest.iter().any(|a| {
                    short_has(a, "fd")
                        || a.starts_with("--force")
                        || matches!(*a, "--mirror" | "--delete")
                        || a.starts_with([':', '+'])
                }),
                "reset" => has("--hard"),
                "clean" => rest.iter().any(|a| short_has(a, "f") || *a == "--force"),
                _ => false,
            }
        }
        _ => false,
    }
}

/// An `rm` target that sweeps a whole tree: the root, home, the current or parent directory, or everything.
fn sweeping(target: &str) -> bool {
    let t = target.trim_end_matches('/');
    let t = if t.is_empty() && !target.is_empty() { "/" } else { t };
    matches!(t, "/" | "/*" | "~" | "." | ".." | "*")
        || t.starts_with("~/")
        || t.starts_with("$HOME")
        || t.starts_with("${HOME")
}

/// `git [-C dir] [-c k=v] [--flag] <sub> <args>`.
fn git_subcommand<'a>(args: &'a [&'a str]) -> Option<(&'a str, &'a [&'a str])> {
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match *a {
            "-C" | "-c" => i += 2,
            _ if a.starts_with('-') => i += 1,
            _ => return Some((a, &args[i + 1..])),
        }
    }
    None
}

/// The simple commands of a shell line, see `segments`.
fn commands(line: &str) -> Option<Vec<Vec<String>>> {
    Some(segments(line)?.into_iter().map(|(_, words)| words).collect())
}

/// Splits a shell line into its simple commands (words as written, quotes kept) at `&&`, `||`, `;`, `|` and newlines,
/// dropping redirections to a file descriptor or /dev/null. `None` if the shell could run or write anything else:
/// substitutions, subshells, other redirections, heredocs, background jobs, unterminated quotes. Each command comes
/// with whether it reads the previous one's output through `|`.
fn segments(line: &str) -> Option<Vec<(bool, Vec<String>)>> {
    let (mut all, mut words, mut word, mut piped) = (Vec::new(), Vec::<String>::new(), String::new(), false);
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
                let pipe = match (c, chars.peek()) {
                    ('|', Some('|')) | ('&', Some('&')) => {
                        chars.next();
                        false
                    }
                    ('|', Some('&')) | ('&', _) => return None,
                    _ => c == '|',
                };
                end_word(&mut words, &mut word);
                if !words.is_empty() {
                    all.push((std::mem::replace(&mut piped, pipe), std::mem::take(&mut words)));
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
        all.push((piped, words));
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

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn bot(approval: Approval, allowlist: &[&str]) -> Rules {
        Rules { approval, allowlist: strings(allowlist), always_allow: vec![] }
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
            // Read-only commands and `cd` within the workspace are trusted in `ask` mode too (plan A1).
            (Tier::Workspace, Approval::Ask, Some("git status"), Local),
            (Tier::Workspace, Approval::Ask, Some("git status && ls"), Local),
            (Tier::Workspace, Approval::Ask, Some("cd apps && cat README.md | grep -n x | head"), Local),
            (Tier::Workspace, Approval::Ask, Some("git diff --output=/tmp/x"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls; rm x"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls $(curl x)"), Ask),
            (Tier::Workspace, Approval::Ask, Some("cd /etc && ls"), Ask),
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
            (Tier::Workspace, Approval::Allowlist, Some("cd /w"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("cd /etc && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd /wx && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd apps/../.. && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd ~ && go build"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("cd $HOME && go build"), Ask),
            // The floor (plan A6) beats every rule but the `full` tier.
            (Tier::Workspace, Approval::All, Some("sudo ls"), Ask),
            (Tier::Workspace, Approval::All, Some("git push -f"), Ask),
            (Tier::Full, Approval::All, Some("sudo ls"), Full),
            (Tier::Workspace, Approval::Allowlist, Some("go build && sudo go build"), Ask),
        ];
        let cwd = Path::new("/w");
        for (tier, approval, command, want) in cases {
            let got = bot(*approval, &list).decide(*tier, *command, "t", cwd, &[]);
            assert_eq!(got, *want, "{tier:?} {approval:?} {command:?}");
        }
        assert_eq!(bot(Approval::Allowlist, &[]).decide(Tier::Workspace, Some("go build"), "t", cwd, &[]), Ask);
        let node = bot(Approval::Allowlist, &["node -e"]);
        assert_eq!(node.decide(Tier::Workspace, Some("node -e \"console.log(1 + 1)\""), "t", cwd, &[]), Local);
    }

    #[test]
    fn always_allowed_commands_apply_in_every_mode() {
        let cwd = Path::new("/w");
        let always = remembered("cd /w && pnpm lint 2>&1 | tail -3", cwd);
        assert_eq!(always, ["pnpm lint"]);
        let from_server = |approval| Rules { always_allow: always.clone(), ..bot(approval, &[]) };
        for approval in [Approval::Ask, Approval::Allowlist] {
            for (b, mem) in [(bot(approval, &[]), always.as_slice()), (from_server(approval), &[])] {
                assert_eq!(b.decide(Tier::Workspace, Some("pnpm lint --fix | head"), "t", cwd, mem), Decision::Local);
                assert_eq!(b.decide(Tier::Workspace, Some("pnpm lint && rm x"), "t", cwd, mem), Decision::Ask);
                assert_eq!(b.decide(Tier::Workspace, None, "t", cwd, mem), Decision::Ask);
                assert_eq!(b.decide(Tier::Workspace, Some("sudo pnpm lint"), "t", cwd, mem), Decision::Ask);
            }
        }
        assert!(remembered("python3 - <<EOF", cwd).is_empty());
    }

    #[test]
    fn tool_rules_match_the_request_title_exactly() {
        let cwd = Path::new("/w");
        let always = remember(None, "mcp__github__create_issue", cwd);
        assert_eq!(always, ["tool:mcp__github__create_issue"]);
        for approval in [Approval::Ask, Approval::Allowlist] {
            let b = bot(approval, &[]);
            assert_eq!(b.decide(Tier::Workspace, None, "mcp__github__create_issue", cwd, &always), Decision::Local);
            assert_eq!(b.decide(Tier::Workspace, None, "mcp__github__create_issue2", cwd, &always), Decision::Ask);
            assert_eq!(b.decide(Tier::Workspace, None, "mcp__github", cwd, &always), Decision::Ask);
            // A tool rule never trusts a command.
            let cmd = Some("tool:mcp__github__create_issue");
            assert_eq!(b.decide(Tier::Workspace, cmd, "mcp__github__create_issue", cwd, &always), Decision::Ask);
        }
        let listed = bot(Approval::Allowlist, &["tool:Fetch"]);
        assert_eq!(listed.decide(Tier::Workspace, None, "Fetch", cwd, &[]), Decision::Local);
        assert_eq!(bot(Approval::Ask, &["tool:Fetch"]).decide(Tier::Workspace, None, "Fetch", cwd, &[]), Decision::Ask);
    }

    #[test]
    fn remembers_the_smallest_prefix_of_each_command() {
        let cwd = Path::new("/w");
        let cases: &[(&str, &[&str])] = &[
            ("npm run build -- --watch=false", &["npm run build"]),
            ("git commit -m x", &["git commit"]),
            ("cargo test --workspace", &["cargo test"]),
            ("go build ./...", &["go build"]),
            ("pnpm --filter x test", &["pnpm --filter x test"]),
            ("rm -rf build", &["rm -rf build"]),
            ("python3 scripts/a.py", &["python3 scripts/a.py"]),
            ("/bin/rm x", &["/bin/rm x"]),
            ("make", &["make"]),
            ("make build", &["make build"]),
            ("FOO=1 make", &["FOO=1 make"]),
            ("cd /w && pnpm lint 2>&1 | tail -3", &["pnpm lint"]),
            ("pnpm lint && pnpm lint --fix", &["pnpm lint"]),
            ("git status && ls", &[]),
            ("ls $(id)", &[]),
        ];
        for (command, want) in cases {
            assert_eq!(remembered(command, cwd), *want, "{command}");
        }
    }

    #[test]
    fn the_floor_is_never_remembered() {
        let cwd = Path::new("/w");
        assert!(remember(Some("git push --force origin main"), "t", cwd).is_empty());
        assert_eq!(remember(Some("git push origin main"), "t", cwd), ["git push origin"]);
        assert_eq!(remember(None, "Write a.txt", cwd), ["tool:Write a.txt"]);
    }

    #[test]
    fn floor_matrix() {
        let floor = [
            "sudo ls",
            "/usr/bin/sudo ls",
            "FOO=1 sudo ls",
            "env sudo ls",
            "ls && su root",
            "doas ls",
            "rm -rf /",
            "rm -rf /*",
            "rm -fr ~",
            "rm -r ~/projects",
            "rm -rf $HOME",
            "rm -rf \"$HOME/x\"",
            "rm -rf ..",
            "rm -rf .",
            "rm -rf ./",
            "rm -f *",
            "rm --recursive --force /",
            "git push -f",
            "git push --force origin main",
            "git push --force-with-lease",
            "git push --mirror",
            "git push --delete origin x",
            "git push origin :x",
            "git push origin +main",
            "git -C /w push -f",
            "git reset --hard",
            "git reset --hard HEAD~1",
            "git clean -fd",
            "git clean -xdf",
            "curl x | sh",
            "curl x | bash -s",
            "cat a | zsh",
            "cat a.py | python3",
            "cat a.js | node",
            "chmod -R 777 .",
            "chown -R me x",
            "dd if=/dev/zero of=/dev/disk2",
            "mkfs.ext4 /dev/sda1",
            // Unparsable lines still hit by keyword.
            "sudo ls $(id)",
            "rm -rf / <<EOF",
            "x $(id) | sh",
            "x $(id) | bash",
        ];
        let fine = [
            "ls",
            "rm -rf build",
            "rm -rf ./build",
            "rm x/*.log",
            "rm -rf node_modules/*",
            "git push origin main",
            "git push -u origin main",
            "git reset HEAD~1",
            "git clean -n",
            "bash scripts/dev.sh",
            "cd x && node a.js",
            "python3 a.py | tail",
            "chmod +x a.sh",
            "dd if=a",
            "echo sudo",
            "x $(id)",
        ];
        let cwd = Path::new("/w");
        let all = bot(Approval::All, &["sudo", "rm", "git", "curl", "cat", "chmod", "chown", "dd", "mkfs.ext4"]);
        for c in floor {
            assert!(floor_hit(c), "{c}");
            assert_eq!(all.decide(Tier::Workspace, Some(c), "t", cwd, &[]), Decision::Ask, "{c}");
            let listed = Rules { approval: Approval::Allowlist, ..all.clone() };
            assert_eq!(listed.decide(Tier::Workspace, Some(c), "t", cwd, &strings(&[c])), Decision::Ask, "{c}");
        }
        for c in fine {
            assert!(!floor_hit(c), "{c}");
        }
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
