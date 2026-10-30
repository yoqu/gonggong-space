//! The owner's local settings (`<home>/local.json`), shared by `gg run`, the CLI and the desktop app: the agent CLI
//! path per agent. Model, effort and the bot's 命令审批 are set on the server (plan J8): `Rules` applies the latter to
//! permission requests here. Also the catalog probed from each adapter (`<home>/models.json`), reported to the server
//! for its pickers.
use crate::protocol::{AgentCatalog, AgentKind, Approval, ApprovalReason, RunBot, RunStart, Tier};
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
    /// The base branches of the group's repos when its 禁止直推基准分支 policy is on: pushing to one always asks.
    pub protect: Vec<String>,
    /// The session's additional directories: within the workspace too, like `cwd`.
    pub extra_dirs: Vec<PathBuf>,
}

impl From<&RunBot> for Rules {
    fn from(bot: &RunBot) -> Self {
        Self {
            approval: bot.approval,
            allowlist: bot.allowlist.clone(),
            always_allow: bot.always_allow.clone(),
            protect: vec![],
            extra_dirs: vec![],
        }
    }
}

impl From<&RunStart> for Rules {
    fn from(start: &RunStart) -> Self {
        let w = &start.workspace;
        let protect = match w.protect_base {
            true => w.repo.iter().chain(&w.extra_repos).map(|r| r.branch.clone()).collect(),
            false => vec![],
        };
        let extra_dirs = start.workspace.extra_dirs.iter().map(PathBuf::from).collect();
        Self { protect, extra_dirs, ..Self::from(&start.bot) }
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
    pub fn reason(&self, command: Option<&str>, tool_kind: &str, cwd: &Path) -> ApprovalReason {
        if command.is_some_and(floor_hit) {
            ApprovalReason::HighRisk
        } else if command.is_some_and(|c| self.pushes_base(c, cwd)) {
            ApprovalReason::ProtectedBase
        } else if tool_kind == "fetch" {
            ApprovalReason::Network
        } else if matches!(tool_kind, "edit" | "delete" | "move") {
            ApprovalReason::Write
        } else if command.is_some_and(|c| segments(c).is_none()) {
            ApprovalReason::Unparsed
        } else {
            ApprovalReason::NotAllowed
        }
    }

    /// ACP read/search tools act in the workspace by default; explicit locations must stay inside it.
    pub fn reads_within(&self, paths: &[PathBuf], cwd: &Path) -> bool {
        paths.iter().all(|path| within_root(path, cwd, &self.roots(cwd)))
    }

    /// Plan D15. `command` is the shell command of an execute-kind tool call, `None` for any other request, which
    /// `tool:<title>` rules match; `cwd` is the run's workspace and `always` the rules the owner allowed always in this
    /// conversation. The floor (plan A6) always goes to the owner.
    pub fn decide(&self, tier: Tier, command: Option<&str>, title: &str, cwd: &Path, always: &[String]) -> Decision {
        if tier == Tier::Full {
            return Decision::Full;
        }
        if command.is_some_and(|c| floor_hit(c) || self.pushes_base(c, cwd)) {
            return Decision::Ask;
        }
        let trusted = self.always_allow.iter().chain(always);
        let roots = self.roots(cwd);
        let local = match self.approval {
            Approval::All => true,
            Approval::Allowlist => allowed(self.allowlist.iter().chain(trusted), command, title, &roots),
            Approval::Ask => allowed(trusted, command, title, &roots),
        };
        if local { Decision::Local } else { Decision::Ask }
    }
}

fn within_root(path: &Path, cwd: &Path, roots: &[&Path]) -> bool {
    let absolute = if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) };
    match std::fs::canonicalize(&absolute) {
        Ok(path) => roots.iter().any(|root| {
            let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
            path.starts_with(root)
        }),
        Err(_) => {
            if let Some(parent) = absolute.parent()
                && let Ok(parent) = std::fs::canonicalize(parent)
            {
                let path = parent.join(absolute.file_name().unwrap_or_default());
                return roots.iter().any(|root| {
                    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
                    path.starts_with(root)
                });
            }
            let mut clean = PathBuf::new();
            for part in absolute.components() {
                match part {
                    std::path::Component::ParentDir => {
                        clean.pop();
                    }
                    std::path::Component::CurDir => {}
                    other => clean.push(other),
                }
            }
            roots.iter().any(|root| clean.starts_with(root))
        }
    }
}

impl Rules {
    /// `remember` that also never trusts a push to the protected base branch.
    pub fn remember(&self, command: Option<&str>, title: &str, cwd: &Path) -> Vec<String> {
        if command.is_some_and(|c| self.pushes_base(c, cwd)) {
            vec![]
        } else {
            remember(command, title, &self.roots(cwd))
        }
    }

    /// The directories a `cd` may go to: the workspace and the additional ones.
    fn roots<'a>(&'a self, cwd: &'a Path) -> Vec<&'a Path> {
        std::iter::once(cwd).chain(self.extra_dirs.iter().map(PathBuf::as_path)).collect()
    }

    /// A `git push` that may update the protected base branch: named as a destination, `--all`/`--mirror`, or a
    /// bare / `HEAD` push while the workspace is on it. Lines too complex to parse count if they push at all.
    fn pushes_base(&self, command: &str, cwd: &Path) -> bool {
        if self.protect.is_empty() {
            return false;
        }
        let protected = |b: &str| self.protect.iter().any(|p| p == b);
        let Some(all) = segments(command) else { return normalize(command).contains("git push") };
        let current = || current_branch(cwd);
        all.iter().any(|Segment { words, .. }| {
            let Some(("git", args)) = program(words) else { return false };
            let args: Vec<&str> = args.iter().map(|a| unquote(a)).collect();
            let Some(("push", rest)) = git_subcommand(&args) else { return false };
            if rest.iter().any(|a| matches!(*a, "--all" | "--mirror")) {
                return true;
            }
            let mut positional = vec![];
            let mut words = rest.iter();
            while let Some(a) = words.next() {
                match *a {
                    "-o" | "--push-option" | "--repo" | "--receive-pack" | "--exec" => {
                        words.next();
                    }
                    _ if a.starts_with('-') => {}
                    _ => positional.push(*a),
                }
            }
            let is_base = |dst: &str| match dst {
                "HEAD" => current().is_none_or(|c| protected(&c)),
                _ => protected(dst.strip_prefix("refs/heads/").unwrap_or(dst)),
            };
            match positional.get(1..).filter(|specs| !specs.is_empty()) {
                None => is_base("HEAD"),
                Some(specs) => specs.iter().any(|spec| {
                    let spec = spec.trim_start_matches('+');
                    is_base(spec.split_once(':').map_or(spec, |(_, dst)| dst))
                }),
            }
        })
    }
}

/// The branch checked out in `cwd`, from `.git/HEAD` (cheap enough to read on every request).
fn current_branch(cwd: &Path) -> Option<String> {
    let head = std::fs::read_to_string(cwd.join(".git/HEAD")).ok()?;
    head.trim().strip_prefix("ref: refs/heads/").map(String::from)
}

fn allowed<'a>(rules: impl Iterator<Item = &'a String>, command: Option<&str>, title: &str, roots: &[&Path]) -> bool {
    let (tools, prefixes): (Vec<&String>, Vec<&String>) = rules.partition(|r| r.starts_with(TOOL));
    match command {
        Some(c) => allowlisted(prefixes, c, roots),
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
/// a read-only command, a `cd` within one of `roots` or plain variable assignments. A command substituted by `$(…)`
/// must be harmless itself. Anything else the shell could substitute or write elsewhere is never allowed (see
/// `segments`).
fn allowlisted<'a>(prefixes: impl IntoIterator<Item = &'a String>, command: &str, roots: &[&Path]) -> bool {
    let Some(all) = segments(command) else { return false };
    let prefixes: Vec<String> = prefixes.into_iter().map(|p| normalize(p)).collect();
    all.iter().all(|Segment { nested, words, .. }| {
        let line = words.join(" ");
        (!nested && starts_with_any(&line, prefixes.iter().map(String::as_str))) || harmless(&line, words, roots)
    })
}

fn harmless(line: &str, words: &[String], roots: &[&Path]) -> bool {
    read_only(line, words) || cd_within(words, roots) || words.iter().all(|w| assignment(w))
}

/// Shell variables that change where commands, functions or `cd` are looked up (zsh ties `path` to `PATH`).
const LOOKUP_VARS: &[&str] = &["path", "cdpath", "fpath", "manpath", "module_path", "mailpath"];

/// `name=value` setting a lowercase shell variable; environment variables (uppercase) can change what later commands do.
fn assignment(w: &str) -> bool {
    let Some((name, _)) = w.split_once('=') else { return false };
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase() || c == '_')
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !LOOKUP_VARS.contains(&name)
}

fn starts_with_any<'a>(line: &str, prefixes: impl IntoIterator<Item = &'a str>) -> bool {
    prefixes
        .into_iter()
        .any(|p| !p.is_empty() && line.strip_prefix(p).is_some_and(|rest| rest.is_empty() || rest.starts_with(' ')))
}

/// Read-only programs whose arguments cannot write or execute. Reject expanded words: an expansion can become an
/// option with side effects. Keep this allowlist narrow; a parser for one program must not be applied to another.
fn read_only(line: &str, words: &[String]) -> bool {
    if starts_with_any(line, READ_ONLY.iter().copied()) {
        return !words.iter().any(|w| w.starts_with("--output") || (words[0] == "git" && w.contains('$')));
    }
    let Some((name, args)) = program(words) else { return false };
    if !matches!(name, "rg" | "sed" | "find" | "ps" | "jq" | "diff" | "stat" | "du" | "which") {
        return false;
    }
    if args.iter().any(|word| unquote(word).contains('$')) {
        return false;
    }
    match name {
        "sed" => sed_read_only(args),
        "find" => !args.iter().any(|w| {
            matches!(
                unquote(w),
                "-delete" | "-exec" | "-execdir" | "-ok" | "-okdir" | "-fls" | "-fprint" | "-fprintf" | "-fprint0"
            )
        }),
        "rg" => !args.iter().any(|w| {
            let w = unquote(w);
            matches!(w, "--pre" | "--pre-glob" | "--hostname-bin")
                || ["--pre=", "--pre-glob=", "--hostname-bin="].iter().any(|p| w.starts_with(p))
        }),
        _ => !args.iter().any(|word| unquote(word).starts_with("--output")),
    }
}

/// Parse the option portion and inline sed scripts. Script files are not trusted: their contents can write or run.
fn sed_read_only(words: &[String]) -> bool {
    let mut scripts = Vec::new();
    let mut i = 0;
    let mut operands = false;
    while i < words.len() {
        let word = unquote(&words[i]);
        if word.contains('$') {
            return false;
        }
        if operands {
            i += 1;
            continue;
        }
        match word {
            "--" => operands = true,
            "-n" | "--quiet" | "--silent" | "-s" | "--separate" | "-u" | "--unbuffered" | "-z" | "--null-data"
            | "-l" | "--line-length" | "--posix" | "-r" | "-E" | "--regexp-extended" => {}
            "-e" | "--expression" => {
                i += 1;
                let Some(script) = words.get(i) else { return false };
                scripts.push(script.as_str());
            }
            "-f" | "--file" | "-i" | "--in-place" => return false,
            _ if word.starts_with("--expression=") => scripts.push(&words[i]),
            _ if word.starts_with("--file=") || word.starts_with("--in-place") => return false,
            _ if word.starts_with("-i") || short_has(word, "if") => return false,
            _ if word.starts_with('-') && word.len() > 1 => {
                // `-ne 'script'` is the common compact form. Once `e` appears, the rest is its script.
                let flags = &word[1..];
                if let Some(at) = flags.find('e') {
                    if !flags[..at].chars().all(|c| "nEsulzr".contains(c)) {
                        return false;
                    }
                    if flags[at + 1..].is_empty() {
                        i += 1;
                        let Some(script) = words.get(i) else { return false };
                        scripts.push(script.as_str());
                    } else {
                        scripts.push(&flags[at + 1..]);
                    }
                } else if !flags.chars().all(|c| "nEsulzr".contains(c)) {
                    return false;
                }
            }
            _ => {
                scripts.push(&words[i]);
                operands = true;
            }
        }
        i += 1;
    }
    !scripts.is_empty() && scripts.iter().all(|word| sed_script_read_only(word))
}

/// Sed `w` writes files; GNU sed `e` runs shell commands. Both are refused conservatively.
fn sed_script_read_only(word: &str) -> bool {
    let script = word.split_once('=').map_or_else(|| unquote(word), |(_, script)| unquote(script));
    let bytes = script.as_bytes();
    let mut command_start = true;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b';' | b'\n' => {
                command_start = true;
                i += 1;
            }
            b'{' | b'}' => {
                command_start = true;
                i += 1;
            }
            b' ' | b'\t' | b'0'..=b'9' | b'$' | b'+' | b'~' | b',' | b'!' if command_start => i += 1,
            b'/' | b'\\' if command_start => {
                let Some(&delimiter) = (if bytes[i] == b'/' { Some(&b'/') } else { bytes.get(i + 1) }) else {
                    return false;
                };
                i += if bytes[i] == b'/' { 1 } else { 2 };
                while i < bytes.len() && bytes[i] != delimiter {
                    i += if bytes[i] == b'\\' { 2 } else { 1 };
                }
                i += 1;
            }
            b'\\' => i += 2,
            b'e' | b'w' | b'W' if command_start => return false,
            b's' | b'y' if command_start && i + 1 < bytes.len() => {
                let substitute = bytes[i] == b's';
                let delimiter = bytes[i + 1];
                let mut fields = 1;
                i += 2;
                while i < bytes.len() && fields < 3 {
                    match bytes[i] {
                        b'\\' => i += 2,
                        b if b == delimiter => {
                            fields += 1;
                            i += 1;
                        }
                        _ => i += 1,
                    }
                }
                while substitute && i < bytes.len() && !matches!(bytes[i], b';' | b'\n') {
                    if matches!(bytes[i], b'e' | b'w' | b'W') {
                        return false;
                    }
                    i += 1;
                }
                command_start = false;
            }
            _ => {
                command_start = false;
                i += 1;
            }
        }
    }
    true
}

/// `cd <dir>` with a literal path inside one of `roots`.
fn cd_within(words: &[String], roots: &[&Path]) -> bool {
    let [cd, dir] = words else { return false };
    let path = Path::new(dir);
    cd == "cd"
        && !dir.contains(['~', '$', '"', '\'', '\\', '*', '?', '[', '{'])
        && !dir.starts_with('-')
        && path.components().all(|c| c != std::path::Component::ParentDir)
        && (path.is_relative() || roots.iter().any(|r| path.starts_with(r)))
}

/// What an allow_always answer to a request trusts from now on (plan A2/A3); nothing for the floor.
pub fn remember(command: Option<&str>, title: &str, roots: &[&Path]) -> Vec<String> {
    match command {
        Some(c) if floor_hit(c) => vec![],
        Some(c) => remembered(c, roots),
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
pub fn remembered(command: &str, roots: &[&Path]) -> Vec<String> {
    let mut rules: Vec<String> = Vec::new();
    for Segment { nested, words, .. } in segments(command).unwrap_or_default() {
        if nested {
            continue;
        }
        let line = words.join(" ");
        if harmless(&line, &words, roots) {
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
        Some(all) => all.iter().any(|s| floor_segment(s.piped, &s.words)),
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

/// A simple command of a shell line: its words as written (quotes kept), whether it reads the previous one's output
/// through `|`, and whether it runs inside a `$(…)` of another.
#[derive(Debug)]
struct Segment {
    piped: bool,
    nested: bool,
    words: Vec<String>,
}

/// Splits a shell line into its simple commands at `&&`, `||`, `;`, `|` and newlines, dropping redirections to a file
/// descriptor or /dev/null. A `$(…)` stays one word of its command and adds its own commands as nested. `None` if the
/// shell could run or write anything else: backticks, `$((…))` other than plain numbers and operators, subshells, process substitution, other redirections,
/// heredocs, background jobs, unterminated quotes.
fn segments(line: &str) -> Option<Vec<Segment>> {
    let (mut all, mut nested, mut words, mut word) = (Vec::new(), Vec::new(), Vec::<String>::new(), String::new());
    let mut piped = false;
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
            '$' if chars.next_if_eq(&'(').is_some() => {
                if chars.next_if_eq(&'(').is_some() {
                    word.push_str(&format!("$(({}))", arithmetic(&mut chars)?));
                    continue;
                }
                let inner = substitution(&mut chars)?;
                nested.extend(segments(&inner)?.into_iter().map(|s| Segment { nested: true, ..s }));
                word.push_str(&format!("$({inner})"));
            }
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
                    let piped = std::mem::replace(&mut piped, pipe);
                    all.push(Segment { piped, nested: false, words: std::mem::take(&mut words) });
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
        all.push(Segment { piped, nested: false, words });
    }
    all.extend(nested);
    (!all.is_empty()).then_some(all)
}

/// The text of a `$(…)` whose `$(` was just read, up to its closing parenthesis. Parentheses inside double quotes are
/// refused rather than matched, so the text is never cut where the shell would not cut it.
fn substitution(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    let (mut inner, mut depth, mut single, mut double) = (String::new(), 0usize, false, false);
    while let Some(c) = chars.next() {
        match c {
            _ if single => single = c != '\'',
            '\'' if !double => single = true,
            '"' => double = !double,
            '\\' => {
                inner.push(c);
                inner.push(chars.next()?);
                continue;
            }
            '(' | ')' if double => return None,
            '(' => depth += 1,
            ')' if depth == 0 => return Some(inner),
            ')' => depth -= 1,
            _ => {}
        }
        inner.push(c);
    }
    None
}

/// The text of a `$((…))` whose `$((` was just read, up to its closing `))`, if it holds only numbers and operators.
/// Names are refused too: the shell evaluates a variable's value as an expression, and `a[$(id)]` there runs `id`.
fn arithmetic(chars: &mut std::iter::Peekable<std::str::Chars>) -> Option<String> {
    let (mut inner, mut depth) = (String::new(), 0usize);
    while let Some(c) = chars.next() {
        match c {
            ')' if depth == 0 => return chars.next_if_eq(&')').map(|_| inner),
            ')' => depth -= 1,
            '(' => depth += 1,
            _ if c.is_ascii_digit() || " \t+-*/%<>=!&|^~?:,".contains(c) => {}
            _ => return None,
        }
        inner.push(c);
    }
    None
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

/// A probed catalog and the adapter + CLI build and CLI config it came from (`agents::catalog_key`); any change is probed
/// again.
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
        Rules { approval, allowlist: strings(allowlist), always_allow: vec![], protect: vec![], extra_dirs: vec![] }
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
            // A `$(…)` of harmless commands is one word; plain lowercase assignments are harmless.
            (Tier::Workspace, Approval::Ask, Some("f=$(grep -rl x src | head -3); echo $f"), Local),
            (Tier::Workspace, Approval::Ask, Some("ls $(cat a)"), Local),
            (Tier::Workspace, Approval::Ask, Some("ls \"$(cat 'a)')\""), Local),
            (Tier::Workspace, Approval::Ask, Some("ls $(ls $(cat a))"), Local),
            (Tier::Workspace, Approval::Ask, Some("cd /w/apps; f=$(grep -rl x features | head -3); echo $f"), Local),
            (Tier::Workspace, Approval::Ask, Some("x=$(rm a)"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls $(ls $(curl x))"), Ask),
            (Tier::Workspace, Approval::Ask, Some("PATH=/tmp ls"), Ask),
            (Tier::Workspace, Approval::Ask, Some("PATH=/tmp; ls"), Ask),
            (Tier::Workspace, Approval::Ask, Some("path=/tmp; ls"), Ask),
            (Tier::Workspace, Approval::Ask, Some("x=--output=/tmp/y; git diff $x"), Ask),
            (Tier::Workspace, Approval::Ask, Some("git diff $(cat a)"), Ask),
            // `$((…))` of numbers and operators expands to a number; names or substitutions in it are not trusted.
            (Tier::Workspace, Approval::Ask, Some("echo $((1+2))"), Local),
            (Tier::Workspace, Approval::Ask, Some("echo \"$(( (7 - 2) * 3 % 4 ))\" && ls"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("go build -p $((2*2))"), Local),
            (Tier::Workspace, Approval::Ask, Some("echo $(( $(curl x) ))"), Ask),
            (Tier::Workspace, Approval::Ask, Some("x='a[$(id)]'; echo $((x))"), Ask),
            (Tier::Workspace, Approval::Ask, Some("echo $((`id`))"), Ask),
            (Tier::Workspace, Approval::Ask, Some("echo $((1+2)"), Ask),
            (Tier::Workspace, Approval::Ask, Some("echo $((1) )"), Ask),
            (Tier::Workspace, Approval::Ask, Some("git log -n $((1+2))"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls $( (cat a) )"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls <(cat a)"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls `cat a`"), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls \"$(echo \")\"; rm x)\""), Ask),
            (Tier::Workspace, Approval::Ask, Some("ls $(cat a"), Ask),
            (Tier::Workspace, Approval::All, Some("ls $(curl x | sh)"), Ask),
            (Tier::Workspace, Approval::Allowlist, Some("go build $(cat a)"), Local),
            (Tier::Workspace, Approval::Allowlist, Some("ls $(go build)"), Ask),
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
    fn additional_directories_count_as_the_workspace() {
        let cwd = Path::new("/w");
        let rules = Rules { extra_dirs: vec!["/sdk".into()], ..bot(Approval::Allowlist, &["go build"]) };
        assert_eq!(rules.decide(Tier::Workspace, Some("cd /sdk/src && go build"), "t", cwd, &[]), Decision::Local);
        assert_eq!(rules.decide(Tier::Workspace, Some("cd /w && go build"), "t", cwd, &[]), Decision::Local);
        assert_eq!(rules.decide(Tier::Workspace, Some("cd /sdkx && go build"), "t", cwd, &[]), Decision::Ask);
        assert_eq!(rules.remember(Some("cd /sdk && pnpm lint"), "t", cwd), ["pnpm lint"]);
        assert_eq!(bot(Approval::Ask, &[]).remember(Some("cd /sdk && pnpm lint"), "t", cwd), ["cd /sdk", "pnpm lint"]);
    }

    #[test]
    fn read_tools_stay_inside_the_workspace_and_follow_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        let outside = dir.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let rules = Rules { extra_dirs: vec![outside.clone()], ..bot(Approval::Ask, &[]) };
        assert!(rules.reads_within(&[], &root));
        assert!(rules.reads_within(&["src/lib.rs".into()], &root));
        assert!(rules.reads_within(&["../outside/report.txt".into()], &root));
        assert!(!rules.reads_within(&["../../secret".into()], &root));
        assert!(!rules.reads_within(&[dir.path().join("secret").into()], &root));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path(), root.join("escape")).unwrap();
            assert!(!rules.reads_within(&[root.join("escape/secret")], &root));
        }
    }

    #[test]
    fn common_read_only_commands_are_allowed_without_a_rule() {
        let commands = [
            "rg -n \"TODO|FIXME\" crates",
            "rg --hidden --glob '!target' pattern .",
            "sed -n '1,120p' src/main.rs",
            "sed 's/old/new/g' README.md",
            "find crates -type f -name '*.rs'",
            "find . -maxdepth 2 -print",
            "find . -maxdepth 2 -printf '%p\\n'",
            "ps aux",
            "ps -p 123 -o pid,command",
            "jq '.dependencies' package.json",
            "jq -r '.scripts[]' package.json",
            "diff -u before.txt after.txt",
            "stat -f '%N %z' Cargo.toml",
            "du -sh target",
            "which cargo rustc",
            "rg TODO . | sed -n '1,20p' && find src -type f -name '*.rs'",
        ];
        for command in commands {
            assert!(read_only(command, &segments(command).unwrap()[0].words), "{command}");
            assert_eq!(
                bot(Approval::Ask, &[]).decide(Tier::Workspace, Some(command), "t", Path::new("/w"), &[]),
                Decision::Local,
                "{command}",
            );
        }
    }

    #[test]
    fn read_only_commands_reject_writing_execution_and_expanded_options() {
        let commands = [
            "sed -i.bak 's/a/b/' file",
            "sed --in-place 's/a/b/' file",
            "sed -e '1w /tmp/out' file",
            "sed -n -f script.sed file",
            "find . -delete",
            "find . -exec rm {} +",
            "find . -execdir rm {} +",
            "find . -ok rm {} ;",
            "find . -okdir rm {} ;",
            "find . -fprint /tmp/out",
            "find . -fprintf /tmp/out '%p'",
            "find . -fls /tmp/out",
            "rg --pre 'cat' pattern .",
            "rg --pre=cat pattern .",
            "rg --hostname-bin cat pattern .",
            "diff --output=/tmp/out before after",
            "sed '1w /tmp/out' file",
            "sed '/pattern/w /tmp/out' file",
            "sed '1,5w /tmp/out' file",
            "sed 's/a/b/e' file",
            "sed 's/a/b/ge' file",
            "sed 's/a/b/w /tmp/out' file",
            "sed 's/a/b/gw /tmp/out' file",
            "sed 'e id' file",
            "sed -ne 's/a/b/e' file",
            "sed --expression='1w /tmp/out' file",
            "sed -n '1e id' file",
            "sed -n '1 { w /tmp/out }' file",
            "sed -n '1 { e id }' file",
            "sed --sandbox 's/a/b/' file",
            "sed $(echo -n) 's/a/b/' file",
            "ps --format $(cat args)",
            "sed $(echo -i) 's/a/b/' file",
            "find . $(echo -delete)",
        ];
        for command in commands {
            assert_eq!(
                bot(Approval::Ask, &[]).decide(Tier::Workspace, Some(command), "t", Path::new("/w"), &[]),
                Decision::Ask,
                "{command}",
            );
        }
        assert!(sed_read_only(&segments("sed -ne '1,20p' src/main.rs").unwrap()[0].words[1..]));
    }

    #[test]
    fn read_tools_reject_a_symlink_to_a_missing_outside_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        let outside = dir.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let rules = bot(Approval::Ask, &[]);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
            assert!(!rules.reads_within(&[root.join("escape/not-created-yet")], &root));
        }
    }

    #[test]
    fn pushing_to_a_protected_base_branch_always_asks() {
        use Decision::*;
        let on = |branch: &str| {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(dir.path().join(".git")).unwrap();
            std::fs::write(dir.path().join(".git/HEAD"), format!("ref: refs/heads/{branch}\n")).unwrap();
            dir
        };
        let rules = Rules { protect: vec!["main".into(), "develop".into()], ..bot(Approval::All, &[]) };
        let (main, feat) = (on("main"), on("feat/x"));
        let cases: &[(&Path, &str, Decision)] = &[
            (feat.path(), "git push -u origin feat/x", Local),
            (feat.path(), "git push", Local),
            (feat.path(), "git push origin HEAD", Local),
            (feat.path(), "git push origin main", Ask),
            // An extra repo's base branch is protected as well.
            (feat.path(), "git push origin develop", Ask),
            (feat.path(), "git push origin HEAD:main", Ask),
            (feat.path(), "git push origin feat/x:refs/heads/main", Ask),
            (feat.path(), "git push --all origin", Ask),
            (feat.path(), "git add . && git commit -m x && git push origin main", Ask),
            (main.path(), "git push", Ask),
            (main.path(), "git push origin HEAD", Ask),
            (main.path(), "git push -u origin feat/y", Local),
        ];
        for (cwd, command, want) in cases {
            assert_eq!(rules.decide(Tier::Workspace, Some(command), "t", cwd, &[]), *want, "{command}");
            if *want == Ask {
                assert!(rules.remember(Some(command), "t", cwd).is_empty(), "{command}");
            }
        }
        // Without the policy pushing anywhere follows the bot's rules; `full` is never asked.
        let open = bot(Approval::All, &[]);
        assert_eq!(open.decide(Tier::Workspace, Some("git push origin main"), "t", main.path(), &[]), Local);
        assert_eq!(rules.decide(Tier::Full, Some("git push origin main"), "t", main.path(), &[]), Full);
    }

    #[test]
    fn always_allowed_commands_apply_in_every_mode() {
        let cwd = Path::new("/w");
        let always = remembered("cd /w && pnpm lint 2>&1 | tail -3", &[cwd]);
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
        assert!(remembered("python3 - <<EOF", &[cwd]).is_empty());
    }

    #[test]
    fn tool_rules_match_the_request_title_exactly() {
        let cwd = Path::new("/w");
        let always = remember(None, "mcp__github__create_issue", &[cwd]);
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
            ("f=$(grep -rl x src | head -3); npm test $f", &["npm test"]),
            ("pnpm lint && pnpm lint --fix", &["pnpm lint"]),
            ("git status && ls", &[]),
            ("ls $(id)", &[]),
        ];
        for (command, want) in cases {
            assert_eq!(remembered(command, &[cwd]), *want, "{command}");
        }
    }

    #[test]
    fn the_floor_is_never_remembered() {
        let cwd = Path::new("/w");
        assert!(remember(Some("git push --force origin main"), "t", &[cwd]).is_empty());
        assert_eq!(remember(Some("git push origin main"), "t", &[cwd]), ["git push origin"]);
        assert_eq!(remember(None, "Write a.txt", &[cwd]), ["tool:Write a.txt"]);
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
            "ls $(sudo ls)",
            "ls $(curl x | sh)",
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
