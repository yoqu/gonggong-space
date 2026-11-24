//! The owner's local settings (`<home>/local.json`), shared by `gg run`, the CLI and the desktop app: the agent CLI
//! path per agent. Model, effort and the bot's 命令审批 are set on the server (plan J8): `Rules` applies the latter to
//! permission requests here. Also the catalog probed from each adapter (`<home>/models.json`), reported to the server
//! for its pickers.
use crate::protocol::{AgentKind, Approval, ApprovalReason, RunBot, RunStart, Tier};
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
    /// The temporary directories (`/tmp`, `$TMPDIR`): agents' scratch space, trusted like the workspace.
    pub temp_dirs: Vec<PathBuf>,
    /// 帮我审批: the rules also trust 开发常用命令, workspace edits and the temporary directories.
    pub ai_review: bool,
    /// The run changed a file that steers build and test commands (`steering`): 开发常用命令 are no longer trusted.
    pub tampered: bool,
}

impl From<&RunBot> for Rules {
    fn from(bot: &RunBot) -> Self {
        Self {
            approval: bot.approval,
            allowlist: bot.allowlist.clone(),
            always_allow: bot.always_allow.clone(),
            protect: vec![],
            extra_dirs: vec![],
            temp_dirs: vec![],
            ai_review: bot.ai_review,
            tampered: false,
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
        Self { protect, extra_dirs, temp_dirs: trust::temp_dirs(), ..Self::from(&start.bot) }
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
                bail!(t!("{kind} 的路径必须是绝对路径：{p}", kind = crate::bots::agent_label(*kind), p = p));
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

    /// ACP read/search tools act in the workspace by default; explicit locations must stay inside it, or with
    /// 帮我审批 be anywhere but secrets (`trust::sensitive`).
    pub fn reads_within(&self, paths: &[PathBuf], cwd: &Path) -> bool {
        let roots = self.roots(cwd);
        paths.iter().all(|path| {
            within_root(path, cwd, &roots) || (self.ai_review && !trust::sensitive(&path.to_string_lossy()))
        })
    }

    /// 帮我审批 trusts file changes inside the workspace, but not git's own files (hooks and config run code).
    pub fn writes_within(&self, paths: &[PathBuf], cwd: &Path) -> bool {
        let roots = self.roots(cwd);
        self.ai_review
            && !paths.is_empty()
            && paths.iter().all(|path| within_root(path, cwd, &roots))
            && paths.iter().all(|p| !p.components().any(|c| c.as_os_str() == ".git"))
    }

    /// Paths a command names that lie outside the workspace.
    pub fn outside_paths(&self, command: &str, cwd: &Path) -> Vec<String> {
        let roots = self.roots(cwd);
        let mut out: Vec<String> = Vec::new();
        for Segment { words, writes, .. } in segments(command).unwrap_or_default() {
            let written = writes.into_iter().filter(|w| !within_root(Path::new(w), cwd, &roots));
            for w in outside_words(&words, &roots).into_iter().chain(written) {
                if !out.contains(&w) {
                    out.push(w);
                }
            }
        }
        out
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
        let own = 1 + self.extra_dirs.len();
        let trust = Trust { dev: self.ai_review && !self.tampered, help: self.ai_review, protect: &self.protect, own };
        let local = match self.approval {
            Approval::All => true,
            Approval::Allowlist => allowed(self.allowlist.iter().chain(trusted), command, title, &roots, trust),
            Approval::Ask => allowed(trusted, command, title, &roots, trust),
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

    /// `remember_session` that also never trusts a push to the protected base branch.
    pub fn remember_session(&self, command: Option<&str>, title: &str, cwd: &Path) -> Vec<String> {
        if command.is_some_and(|c| self.pushes_base(c, cwd)) {
            vec![]
        } else {
            remember_session(command, title, &self.roots(cwd))
        }
    }

    /// The directories a `cd` may go to: the workspace, the additional ones and the temporary ones.
    fn roots<'a>(&'a self, cwd: &'a Path) -> Vec<&'a Path> {
        std::iter::once(cwd).chain(self.extra_dirs.iter().chain(&self.temp_dirs).map(PathBuf::as_path)).collect()
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

/// What the bot's 审批方式 trusts besides the owner's rules (帮我审批 only).
#[derive(Clone, Copy, Default)]
struct Trust<'a> {
    /// 开发常用命令 (`dev_command`); off once the run changed a file that steers them (`Rules::tampered`).
    dev: bool,
    /// 帮我审批 itself: file changes inside the workspace (`cat > src/a.ts <<'EOF'`), reading outside it and the
    /// rest of `trust::helped`.
    help: bool,
    /// The protected base branches (`Rules::protect`): never pushed to without asking.
    protect: &'a [String],
    /// How many of the roots are the workspace and its additional directories (the rest are temporary ones, where
    /// nothing is the repository the owner trusts).
    own: usize,
}

fn allowed<'a>(
    rules: impl Iterator<Item = &'a String>,
    command: Option<&str>,
    title: &str,
    roots: &[&Path],
    trust: Trust,
) -> bool {
    let (tools, prefixes): (Vec<&String>, Vec<&String>) = rules.partition(|r| r.starts_with(TOOL));
    match command {
        Some(c) => allowlisted(prefixes, c, roots, trust),
        None => tools.iter().any(|r| r[TOOL.len()..] == *title),
    }
}

const TOOL: &str = "tool:";

fn normalize(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Commands that only read, trusted without being listed (as long as they read inside the workspace).
const READ_ONLY: &[&str] = &[
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "ls",
    "pwd",
    "echo",
    "printf",
    "git status",
    "git diff",
    "git log",
    "git show",
    "git rev-parse",
    "git ls-files",
    "git blame",
    "git describe",
    "git shortlog",
    "git merge-base",
    "git cat-file",
    "git branch --show-current",
    "git remote -v",
    "git remote get-url",
    "git stash list",
    "git config --get",
    "git config --list",
    "git config -l",
    "git grep",
    "git rev-list",
    "git ls-remote",
    "git ls-tree",
    "git reflog",
    "git for-each-ref",
    "git show-ref",
    "git name-rev",
    "git check-ignore",
    "git cherry",
    "git range-diff",
    "git whatchanged",
    "git count-objects",
    "git worktree list",
    "git stash show",
    "git branch -a",
    "git branch -r",
    "git branch -v",
    "git branch -vv",
    "git branch --list",
    "git branch --contains",
    "git branch --merged",
    "git branch --no-merged",
    "git tag -l",
    "git tag --list",
    "git tag --contains",
    "git remote show",
    "git version",
    "git --version",
];

/// Git options that run a program of their choice.
const GIT_RUNS: &[&str] = &["-O", "--open-files-in-pager", "--upload-pack", "--exec", "--ext-diff"];

/// Read-only programs that open no files, whatever paths they print.
const NO_FILES: &[&str] =
    &["echo", "printf", "pwd", "which", "date", "whoami", "uname", "true", "false", "basename", "dirname", "ps"];

/// Every command of a chain or pipeline (past its wrappers, see `unwrapped`) starts with a trusted prefix at a word
/// boundary, matches a session rule (`session_rule`), is a 开发常用命令 the bot trusts (`dev_command`), something else
/// 帮我审批 trusts (`trust::helped`) or is harmless on its own: a read-only command reading inside the workspace (with
/// 帮我审批: anywhere but secrets), a shell statement (`shell::Shell::statement`: `cd`, assignments, loops). Variables
/// set literally on the line are substituted first, a `for` loop's once per value. A command substituted by `$(…)`
/// must be harmless itself. Output may only be redirected into workspace files, and only when the bot trusts file
/// changes. Anything else the shell could substitute or write is never allowed (see `segments`).
fn allowlisted<'a>(
    prefixes: impl IntoIterator<Item = &'a String>,
    command: &str,
    roots: &[&Path],
    trust: Trust,
) -> bool {
    let prefixes: Vec<String> = prefixes.into_iter().map(|p| normalize(p)).collect();
    line_allowed(&prefixes, command, roots, trust, 0)
}

/// How deep `bash -c`, `source` and script files are followed.
const DEPTH: usize = 3;

fn line_allowed(prefixes: &[String], command: &str, roots: &[&Path], trust: Trust, depth: usize) -> bool {
    let Some(all) = segments(command) else { return false };
    let mut sh = shell::Shell::default();
    all.iter().all(|seg| {
        if seg.nested {
            let words = unwrapped(&seg.words);
            return seg.writes.is_empty() && harmless_in(&words.join(" "), words, roots, trust.help);
        }
        let Some(variants) = sh.expand(&seg.words) else { return false };
        variants.iter().all(|words| {
            if let Some(ok) = sh.statement(words, seg, roots, trust, &|line| {
                depth < DEPTH && line_allowed(prefixes, line, roots, trust, depth + 1)
            }) {
                return ok;
            }
            let words = sh.past_assignments(unwrapped(words), roots, trust.help);
            if words.is_empty() {
                return false;
            }
            // Relative paths are relative to where `cd` went, when that is inside the roots.
            let here: Vec<&Path> = sh.dir().into_iter().chain(roots.iter().copied()).collect();
            let roots = &here[..];
            let own = &roots[..trust.own + usize::from(sh.dir().is_some())];
            let line = words.join(" ");
            let writes_ok = seg.writes.is_empty()
                || (trust.help && !sh.away && seg.writes.iter().all(|w| writable(w, roots) && sh.relative_ok(w)));
            let follow = |line: &str| depth < DEPTH && line_allowed(prefixes, line, roots, trust, depth + 1);
            let trusted = starts_with_any(&line, prefixes.iter().map(String::as_str))
                || prefixes.iter().any(|r| session_rule(r, words, roots))
                || (trust.dev && !sh.away && !sh.scratch && dev_command(words, own))
                || (trust.help && trust::helped(words, seg, roots, trust, &sh, &follow));
            let ok = writes_ok && (trusted || harmless_in(&line, words, roots, trust.help));
            #[cfg(test)]
            if !ok && depth == 0 {
                tests::BLOCKED.with(|b| b.borrow_mut().push(line.clone()));
            }
            ok
        })
    })
}

fn harmless(line: &str, words: &[String], roots: &[&Path]) -> bool {
    harmless_in(line, words, roots, false)
}

/// A read-only command reading inside `roots` (or, `outside`, anywhere but secrets), a `cd` within them or plain
/// variable assignments.
fn harmless_in(line: &str, words: &[String], roots: &[&Path], outside: bool) -> bool {
    let reads = || {
        !words.iter().any(|w| trust::sensitive(w))
            && (NO_FILES.contains(&base(&words[0])) || outside || outside_words(words, roots).is_empty())
    };
    (read_only(line, words) && reads()) || cd_within(words, roots) || words.iter().all(|w| assignment(w))
}

/// A file a command may write into: inside the workspace, not git's own.
fn writable(path: &str, roots: &[&Path]) -> bool {
    let home = path.starts_with('~') || path.starts_with("$HOME");
    let path = Path::new(path);
    !home && within_root(path, roots[0], roots) && !path.components().any(|c| c.as_os_str() == ".git")
}

/// The words of a command naming a path outside `roots` (the first is the workspace): absolute or `..` paths that
/// resolve elsewhere, anything under `~` or `$HOME`, also as `--opt=path`, `-opath` or curl's `@file`. A grep's
/// pattern is not a path.
fn outside_words(words: &[String], roots: &[&Path]) -> Vec<String> {
    let skip_pattern = matches!(base(&words[0]), "grep" | "egrep" | "fgrep" | "rg")
        && !words.iter().any(|w| matches!(unquote(w), "-e" | "-f" | "--regexp" | "--file"));
    let pattern = skip_pattern.then(|| words.iter().skip(1).position(|w| !unquote(w).starts_with('-'))).flatten();
    let mut out = Vec::new();
    for (i, w) in words.iter().enumerate().skip(1) {
        if Some(i - 1) == pattern {
            continue;
        }
        let w = unquote(w);
        let v = w.split_once('=').map_or(w, |(_, v)| v);
        let v = unquote(v.strip_prefix('@').unwrap_or(v));
        let v = match v.strip_prefix('-') {
            Some(rest) if !rest.starts_with('-') && rest.len() > 1 => &rest[1..],
            _ => v,
        };
        let home = v.starts_with('~') || v.starts_with("$HOME") || v.starts_with("${HOME");
        let path = v.starts_with('/') || v.starts_with("../") || v == "..";
        if (home || (path && v != "/dev/null" && !within_root(Path::new(v), roots[0], roots)))
            && !out.iter().any(|o| o == w)
        {
            out.push(w.to_string());
        }
    }
    out
}

/// A command past the wrappers that only run the rest of it (`rtk`, `timeout 30`, `nice -n 5`, `env [-u NAME]`, …)
/// and the environment variables set for it, so `rtk git status` is judged as `git status`. Stops at anything it
/// does not know, leaving that to be judged as written: variables not known to only configure output or locale,
/// other `env` options.
fn unwrapped(words: &[String]) -> &[String] {
    let mut w = words;
    loop {
        let Some(first) = w.first() else { return words };
        let rest = &w[1..];
        let at = |i: usize| rest.get(i).map(|a| unquote(a));
        let skip = match unquote(first) {
            // Compound-command keywords before the command they run (`do rm x`, `then sudo …`).
            "do" | "then" | "else" | "elif" | "if" | "while" | "until" | "!" | "{" => 1,
            "xargs" => {
                let mut i = 0;
                while let Some(a) = at(i).filter(|a| a.starts_with('-')) {
                    i += match a {
                        "-0" | "-r" | "-t" | "-x" | "--null" | "--no-run-if-empty" | "--verbose" => 1,
                        "-n" | "-L" | "-P" | "-I" | "-d" | "-s" => 2,
                        _ if a.len() > 2 && ["-n", "-L", "-P", "-I"].iter().any(|f| a.starts_with(f)) => 1,
                        _ => return w,
                    };
                }
                i + 1
            }
            "rtk" => 1 + usize::from(at(0) == Some("proxy")),
            "time" => 1 + usize::from(at(0) == Some("-p")),
            "nohup" => 1,
            "nice" => match at(0) {
                Some("-n") => 3,
                Some(a) if a.starts_with('-') && a[1..].parse::<i32>().is_ok() => 2,
                _ => 1,
            },
            "timeout" => {
                let mut i = 0;
                while let Some(a) = at(i).filter(|a| a.starts_with('-')) {
                    i += if matches!(a, "-s" | "-k" | "--signal" | "--kill-after") { 2 } else { 1 };
                }
                let duration = at(i).is_some_and(|d| {
                    let n = d.trim_end_matches(['s', 'm', 'h', 'd']);
                    !n.is_empty() && n.parse::<f64>().is_ok()
                });
                if !duration {
                    return w;
                }
                i + 2
            }
            "env" => {
                // Unsetting a variable only takes away; any other option is judged as written.
                let mut i = 0;
                while at(i) == Some("-u") {
                    i += 2;
                }
                if at(i).is_some_and(|a| a.starts_with('-')) {
                    return w;
                }
                i + 1
            }
            a if env_assignment(a) => 1,
            _ => return if w.is_empty() { words } else { w },
        };
        if skip >= w.len() {
            return words;
        }
        w = &w[skip..];
    }
}

/// `NAME=value` for an environment variable known to only configure output, locale or the target platform (`CI=1`,
/// `LANG=C`); any other may change what runs (`RUSTC_WRAPPER`, `GOFLAGS`, `NODE_OPTIONS`, …).
fn env_assignment(w: &str) -> bool {
    const SAFE: &[&str] = &[
        "CI",
        "NODE_ENV",
        "RUST_BACKTRACE",
        "RUST_LOG",
        "LANG",
        "LANGUAGE",
        "TZ",
        "TERM",
        "COLUMNS",
        "LINES",
        "FORCE_COLOR",
        "NO_COLOR",
        "CLICOLOR",
        "DEBUG",
        "VERBOSE",
        "PYTHONUNBUFFERED",
        "PYTHONDONTWRITEBYTECODE",
        "PYTHONIOENCODING",
        "NODE_NO_WARNINGS",
        "CARGO_TERM_COLOR",
        "CARGO_INCREMENTAL",
        "GOOS",
        "GOARCH",
        "CGO_ENABLED",
        "GIT_TERMINAL_PROMPT",
        "PORT",
    ];
    let Some((name, _)) = w.split_once('=') else { return false };
    SAFE.contains(&name)
        || name.strip_prefix("LC_").is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_uppercase()))
}

/// Script and target names that ship rather than build or check.
fn ships(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["publish", "deploy", "release", "ship", "push", "upload", "install", "prod"].iter().any(|k| name.contains(k))
}

/// Tools that build, check, test or format the project.
const DEV_TOOLS: &[&str] = &[
    "tsc",
    "vitest",
    "jest",
    "mocha",
    "eslint",
    "prettier",
    "biome",
    "playwright",
    "ruff",
    "mypy",
    "black",
    "isort",
    "pytest",
    "rustfmt",
    "gofmt",
    "turbo",
    "nx",
    "vue-tsc",
    "vite",
    "webpack",
    "rollup",
    "stencil",
    "svelte-check",
];
/// Package scripts a package manager runs by name without `run`.
const DEV_SCRIPTS: &[&str] =
    &["build", "test", "lint", "typecheck", "check", "format", "fmt", "e2e", "coverage", "compile", "dev"];

/// The first operand past the leading options, and what follows it: `flags` stand alone, `values` take the next word
/// (or `=value`). Any other option is unknown: `None`.
fn lead<'a>(args: &'a [&'a str], flags: &[&str], values: &[&str]) -> Option<(&'a str, &'a [&'a str])> {
    let mut i = 0;
    while let Some(a) = args.get(i) {
        if values.contains(a) {
            i += 2;
        } else if flags.contains(a) || values.iter().any(|v| a.strip_prefix(v).is_some_and(|r| r.starts_with('='))) {
            i += 1;
        } else if a.starts_with('-') {
            return None;
        } else {
            return Some((a, &args[i + 1..]));
        }
    }
    None
}

/// 开发常用命令 trusted by 帮我审批: building, checking, testing and formatting the project and local git work. They run
/// the repository's own scripts, so this trusts the repository — not code brought in from elsewhere: paths outside
/// the workspace, options that load configs, plugins, hooks or wrappers, or any option not known here.
fn dev_command(words: &[String], roots: &[&Path]) -> bool {
    let Some(first) = words.first() else { return false };
    if !outside_words(words, roots).is_empty() {
        return false;
    }
    let args: Vec<&str> = words[1..].iter().map(|a| unquote(a)).collect();
    let tool = |name: &str, rest: &[&str]| match name {
        "playwright" => rest.first() == Some(&"test"),
        _ => DEV_TOOLS.contains(&name),
    };
    match base(first) {
        pm @ ("npm" | "pnpm" | "yarn" | "bun") => {
            let flags = ["-r", "--recursive", "-s", "--silent", "-w", "--workspace-root", "--parallel", "--if-present"];
            let flags =
                [&flags[..], &["--stream", "--aggregate-output", "--color", "--no-color", "-q", "--quiet"]].concat();
            let values = ["--filter", "-F", "-C", "--dir", "--prefix", "--workspace", "--cwd", "--reporter"];
            let Some((sub, rest)) = lead(&args, &flags, &values) else { return false };
            match sub {
                "run" | "run-script" | "rr" => rest.first().is_some_and(|s| !s.starts_with('-') && !ships(s)),
                "test" | "t" | "tst" => true,
                "exec" => rest.first().is_some_and(|t| tool(t, &rest[1..])),
                _ => pm != "npm" && DEV_SCRIPTS.contains(&sub),
            }
        }
        "npx" | "bunx" => lead(&args, &["--yes", "-y", "--no-install", "--no", "-q", "--quiet"], &[])
            .is_some_and(|(t, rest)| tool(t, rest)),
        "cargo" => {
            let args = match args.first() {
                Some(t) if t.starts_with('+') => &args[1..],
                _ => &args[..],
            };
            if args.iter().any(|a| a.starts_with("--config") || a.starts_with("-Z")) {
                return false;
            }
            let flags = ["-q", "--quiet", "-v", "-vv", "--verbose", "--offline", "--locked", "--frozen"];
            lead(args, &flags, &["--manifest-path", "--color"]).is_some_and(|(sub, _)| {
                [
                    "build", "b", "check", "c", "test", "t", "clippy", "fmt", "doc", "bench", "run", "r", "tree",
                    "metadata",
                ]
                .contains(&sub)
                    || sub == "nextest"
            })
        }
        "go" => {
            let risky = ["-exec", "-toolexec", "-overlay", "-modfile", "-w", "-u"];
            if args
                .iter()
                .any(|a| risky.iter().any(|r| a == r || a.strip_prefix(r).is_some_and(|x| x.starts_with('='))))
            {
                return false;
            }
            lead(&args, &[], &[]).is_some_and(|(sub, rest)| match sub {
                "build" | "test" | "vet" | "fmt" | "run" | "list" | "version" | "env" => true,
                "mod" => rest.first().is_some_and(|m| matches!(*m, "tidy" | "download" | "why" | "graph" | "verify")),
                _ => false,
            })
        }
        "make" => {
            let mut targets = vec![];
            let mut i = 0;
            while let Some(a) = args.get(i) {
                match *a {
                    "-C" | "-f" | "--directory" | "--file" | "-j" => i += 1,
                    "-k" | "-s" | "--silent" | "-B" | "--always-make" | "-n" | "--no-print-directory" => {}
                    _ if a.starts_with("-j") && a[2..].parse::<u32>().is_ok() => {}
                    _ if a.starts_with('-') || a.contains('=') => return false,
                    _ => targets.push(*a),
                }
                i += 1;
            }
            targets.iter().all(|t| !ships(t))
        }
        name if name.starts_with("python") => {
            let modules = ["pytest", "unittest", "mypy", "ruff", "black", "isort"];
            args.iter().position(|a| *a == "-m").is_some_and(|i| {
                args[..i].iter().all(|a| matches!(*a, "-u" | "-B"))
                    && args.get(i + 1).is_some_and(|m| modules.contains(m))
            })
        }
        "mvn" | "mvnw" => {
            const SKIPS: &[&str] =
                &["skipTests", "maven.test.skip", "maven.javadoc.skip", "checkstyle.skip", "spotbugs.skip"];
            let mut phases = vec![];
            let mut i = 0;
            while let Some(a) = args.get(i) {
                match *a {
                    "-pl" | "--projects" | "-T" | "--threads" => i += 1,
                    "-q"
                    | "-B"
                    | "--batch-mode"
                    | "-o"
                    | "--offline"
                    | "-U"
                    | "-e"
                    | "-X"
                    | "-am"
                    | "-amd"
                    | "-ntp"
                    | "--no-transfer-progress" => {}
                    _ if a.strip_prefix("-D").is_some_and(|d| SKIPS.contains(&d.split('=').next().unwrap_or(d))) => {}
                    _ if a.starts_with('-') => return false,
                    _ => phases.push(*a),
                }
                i += 1;
            }
            !phases.is_empty()
                && phases.iter().all(|p| ["clean", "validate", "compile", "test", "package", "verify"].contains(p))
        }
        "gradle" | "gradlew" => {
            let mut tasks = vec![];
            let mut i = 0;
            while let Some(a) = args.get(i) {
                match *a {
                    "-x" | "--exclude-task" => i += 1,
                    "-q" | "--quiet" | "--offline" | "--no-daemon" | "--info" | "--stacktrace" | "--parallel"
                    | "--console=plain" => {}
                    _ if a.starts_with('-') => return false,
                    _ => tasks.push(*a),
                }
                i += 1;
            }
            !tasks.is_empty()
                && tasks.iter().all(|t| {
                    ["build", "test", "check", "assemble", "lint", "clean"].contains(&t.rsplit(':').next().unwrap_or(t))
                })
        }
        "git" => {
            let Some((sub, rest)) = lead(&args, &["--no-pager", "-P"], &["-C"]) else { return false };
            let has = |xs: &[&str]| rest.iter().any(|a| xs.contains(a));
            match sub {
                "add" | "commit" => true,
                "fetch" | "pull" => !rest.iter().any(|a| a.contains("upload-pack") || a.starts_with("--exec")),
                "switch" => !has(&["-f", "--force", "--discard-changes", "-C", "--force-create"]),
                "checkout" => {
                    if has(&[".", "--", "-f", "--force", "-p", "--patch", "--ours", "--theirs", "-B", "-m", "--merge"])
                    {
                        return false;
                    }
                    // A branch to switch to, or `-b <new> [<start>]`: never a commit and files to overwrite.
                    let (mut new, mut positional, mut i) = (false, 0, 0);
                    while let Some(a) = rest.get(i) {
                        match *a {
                            "-b" => {
                                new = true;
                                i += 1;
                            }
                            "-q" | "--quiet" | "-t" | "--track" => {}
                            _ if a.starts_with('-') => return false,
                            _ => positional += 1,
                        }
                        i += 1;
                    }
                    if new { positional <= 1 } else { positional == 1 }
                }
                "branch" => !has(&["-D", "-f", "--force", "-M", "-C"]),
                "stash" => !has(&["drop", "clear"]),
                _ => false,
            }
        }
        "mkdir" | "touch" => {
            let paths: Vec<&&str> = args.iter().filter(|a| !a.starts_with('-')).collect();
            !paths.is_empty()
                && paths.iter().all(|p| {
                    let path = Path::new(p);
                    !p.contains(['~', '$', '*', '?', '[', '{'])
                        && path.components().all(|c| c != std::path::Component::ParentDir && c.as_os_str() != ".git")
                        && (path.is_relative() || roots.iter().any(|r| path.starts_with(r)))
                })
        }
        // A tool the project installed, run by its path (`node_modules/.bin/vite build`).
        _ if unquote(first).contains("node_modules/.bin/") => tool(base(first), &args),
        name => tool(name, &args),
    }
}

/// Files whose content decides what build, test and package-manager commands run (manifests, build and test
/// configs, git hooks, agent settings): once a run changed one, the 开发常用命令 it then runs are no longer the
/// repository's as the owner trusted it.
pub fn steering(path: &Path) -> bool {
    const NAMES: &[&str] = &[
        "package.json",
        "Makefile",
        "makefile",
        "GNUmakefile",
        "Cargo.toml",
        "build.rs",
        "go.mod",
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "tox.ini",
        "conftest.py",
        "pytest.ini",
        ".npmrc",
        ".yarnrc",
        ".yarnrc.yml",
        "pnpm-workspace.yaml",
        ".pnpmfile.cjs",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "settings.gradle",
        "settings.gradle.kts",
        "gradle.properties",
        "justfile",
        "Justfile",
        "Taskfile.yml",
        ".envrc",
        "rust-toolchain",
        "rust-toolchain.toml",
        ".babelrc",
        "biome.json",
        "biome.jsonc",
        "deno.json",
        "bunfig.toml",
        "turbo.json",
        "nx.json",
    ];
    const PREFIXES: &[&str] = &[
        "vite.config.",
        "vitest.config.",
        "vitest.workspace.",
        "jest.config.",
        "jest.setup",
        "vitest.setup",
        "webpack.config.",
        "rollup.config.",
        "babel.config.",
        "eslint.config.",
        ".eslintrc",
        "prettier.config.",
        ".prettierrc",
        "playwright.config.",
        "tsup.config.",
        "next.config.",
        "nuxt.config.",
        "svelte.config.",
        "astro.config.",
        "postcss.config.",
        "tailwind.config.",
        "karma.conf",
        ".mocharc",
    ];
    const DIRS: &[&str] = &[".git", ".husky", ".githooks", ".cargo", ".mvn", ".claude", ".codex"];
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let steers = |c: &str| DIRS.contains(&c) || crate::adapters::steering_dirs().any(|d| d == c);
    NAMES.contains(&name)
        || PREFIXES.iter().any(|p| name.starts_with(p))
        || path.components().any(|c| c.as_os_str().to_str().is_some_and(steers))
}

/// Whether a command (run or about to run) may change a `steering` file: it writes one, or names one and is not
/// read-only. A line too complex to parse counts if it names one at all.
pub fn steers(command: &str) -> bool {
    fn names<'a>(mut words: impl Iterator<Item = &'a str>) -> bool {
        words.any(|w| {
            let w = unquote(w);
            steering(Path::new(w.split_once('=').map_or(w, |(_, v)| v)))
        })
    }
    match segments(command) {
        Some(all) => all.iter().any(|Segment { words, writes, .. }| {
            writes.iter().any(|w| steering(Path::new(w)))
                || (!read_only(&words.join(" "), words) && names(words.iter().skip(1).map(String::as_str)))
        }),
        None => names(command.split_whitespace()),
    }
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

/// Whether the shell expands something in a word: a `$` outside single quotes.
fn expands(word: &str) -> bool {
    let mut single = false;
    word.chars().any(|c| {
        if c == '\'' {
            single = !single;
        }
        c == '$' && !single
    })
}

/// Git's global options that only pick the repository or the pager: `git -C dir log` is judged as `git log` (the
/// directory is a path like any other).
fn git_plain(words: &[String]) -> Option<Vec<String>> {
    let mut out = vec![words[0].clone()];
    let mut i = 1;
    while let Some(w) = words.get(i) {
        match unquote(w) {
            "--no-pager" | "-P" => i += 1,
            "-C" => i += 2,
            _ => break,
        }
    }
    out.extend(words.get(i..)?.iter().cloned());
    Some(out)
}

/// Read-only programs whose arguments cannot write or execute. Reject expanded words: an expansion can become an
/// option with side effects. Keep this allowlist narrow; a parser for one program must not be applied to another.
fn read_only(line: &str, words: &[String]) -> bool {
    if unquote(&words[0]) == "git"
        && words.get(1).is_some_and(|w| matches!(unquote(w), "--no-pager" | "-P" | "-C"))
        && let Some(plain) = git_plain(words)
    {
        return plain.len() > 1 && read_only(&plain.join(" "), &plain);
    }
    if starts_with_any(line, READ_ONLY.iter().copied()) {
        return !words.iter().any(|w| {
            let w = unquote(w);
            w.starts_with("--output")
                || (words[0] == "git"
                    && (expands(w) || GIT_RUNS.iter().any(|o| w == *o || w.starts_with(&format!("{o}=")))))
        }) && trust::git_read_only(words);
    }
    let Some((name, args)) = program(words) else { return false };
    // `<tool> --version` of a program found on PATH.
    if let [only] = args
        && matches!(unquote(only), "--version" | "--help")
        && plain_word(&words[0])
        && !words[0].contains('/')
    {
        return true;
    }
    if matches!(name, "[" | "test" | "[[") {
        return true;
    }
    if name == "java" && matches!(args, [v] if matches!(unquote(v), "-version" | "--version")) {
        return true;
    }
    if !matches!(
        name,
        "rg" | "sed"
            | "awk"
            | "column"
            | "comm"
            | "paste"
            | "fold"
            | "rev"
            | "tac"
            | "seq"
            | "md5"
            | "md5sum"
            | "shasum"
            | "sha256sum"
            | "cksum"
            | "base64"
            | "xxd"
            | "od"
            | "hexdump"
            | "strings"
            | "cmp"
            | "sleep"
            | "lsof"
            | "pgrep"
            | "uptime"
            | "df"
            | "vm_stat"
            | "sw_vers"
            | "hostname"
            | "javap"
            | "zipinfo"
            | "ffprobe"
            | "java_home"
            | "top"
            | "memory_pressure"
            | "nproc"
            | "find"
            | "ps"
            | "jq"
            | "diff"
            | "stat"
            | "du"
            | "which"
            | "sort"
            | "cut"
            | "tr"
            | "nl"
            | "basename"
            | "dirname"
            | "realpath"
            | "readlink"
            | "file"
            | "tree"
            | "date"
            | "whoami"
            | "uname"
            | "true"
            | "false"
            | "uniq"
            // `rtk read` (rtk's cat); the shell builtin only sets variables.
            | "read"
    ) {
        return false;
    }
    if args.iter().any(|word| expands(word)) {
        return false;
    }
    match name {
        "sed" => sed_read_only(args),
        "awk" => trust::awk_read_only(args),
        // A second operand is the file it writes.
        "xxd" => !args.iter().any(|w| w.starts_with("-r")) && args.iter().filter(|w| !w.starts_with('-')).count() <= 1,
        "base64" => !args.iter().any(|w| matches!(unquote(w), "-o" | "--output") || w.starts_with("--output=")),
        "top" => args.iter().any(|w| w.starts_with("-l") || w == "-b" || w == "-bn1"),
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
        // `uniq in out` writes its second operand.
        "uniq" => args.iter().filter(|w| !w.starts_with('-')).count() <= 1,
        "sort" | "tree" => !args.iter().any(|w| {
            let w = unquote(w);
            w.starts_with("--output") || (w.starts_with("-o") || short_has(w, "o") && !w.starts_with("--"))
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
        if expands(&words[i]) {
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
        let words = unwrapped(&words);
        let line = words.join(" ");
        if harmless(&line, words, roots) {
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

/// Interpreters a 本次会话不再问 answer trusts for any script inside the workspace (`node <工作区内脚本>`).
const INTERPRETERS: &[&str] = &["python", "python3", "node", "deno", "bun", "perl", "ruby", "php"];
/// The session rule for an interpreter running a workspace script.
const SCRIPT_RULE: &str = "<工作区内脚本>";

/// What a 本次会话不再问 answer trusts until the session ends: like `remember`, but an interpreter running a script
/// inside the workspace trusts that interpreter for any such script, and curl or wget fetching from one host trusts
/// that host. Everything else (rm, mv, chmod, kill, `-c`/`-e` code, …) stays the exact command.
pub fn remember_session(command: Option<&str>, title: &str, roots: &[&Path]) -> Vec<String> {
    let Some(c) = command else { return remember(None, title, roots) };
    if floor_hit(c) {
        return vec![];
    }
    let mut rules: Vec<String> = Vec::new();
    for Segment { nested, words, .. } in segments(c).unwrap_or_default() {
        let words = unwrapped(&words);
        if nested || harmless(&words.join(" "), words, roots) {
            continue;
        }
        let name = base(&words[0]);
        let rule = if INTERPRETERS.contains(&name) && runs_script(words, roots) {
            format!("{name} {SCRIPT_RULE}")
        } else if let Some(host) = fetch_host(words, roots) {
            format!("{name} {host}")
        } else {
            let Some(rule) = remembered(&words.join(" "), roots).into_iter().next() else { continue };
            rule
        };
        if !rules.contains(&rule) {
            rules.push(rule);
        }
    }
    rules
}

/// Whether a session rule (`remember_session`) allows a command: `<interpreter> <工作区内脚本>` or `curl|wget <host>`.
fn session_rule(rule: &str, words: &[String], roots: &[&Path]) -> bool {
    let Some((name, what)) = rule.split_once(' ') else { return false };
    let program = base(&words[0]);
    program == name
        && match what {
            SCRIPT_RULE => INTERPRETERS.contains(&name) && runs_script(words, roots),
            host => fetch_host(words, roots).is_some_and(|h| h == host),
        }
}

/// An interpreter running a script file inside the workspace: no code given inline (`-c`, `-e`, `-m`, …), no other
/// options.
fn runs_script(words: &[String], roots: &[&Path]) -> bool {
    let args: Vec<&str> = words[1..].iter().map(|a| unquote(a)).collect();
    let Some((script, _)) = lead(&args, &["-u", "-B", "--no-warnings", "--enable-source-maps"], &[]) else {
        return false;
    };
    let path = Path::new(script);
    !script.contains(['~', '$', '*', '?'])
        && path.components().all(|c| c != std::path::Component::ParentDir)
        && within_root(path, roots[0], roots)
        && outside_words(words, roots).is_empty()
}

/// The one host a curl or wget command fetches from, when it reads and writes nothing outside the workspace and takes
/// no config or upload option that could send something else.
fn fetch_host(words: &[String], roots: &[&Path]) -> Option<String> {
    if !matches!(base(&words[0]), "curl" | "wget") || !outside_words(words, roots).is_empty() {
        return None;
    }
    let risky = ["-K", "--config", "-T", "--upload-file", "--post-file", "--body-file", "-e", "--execute"];
    let mut hosts = vec![];
    for w in &words[1..] {
        let w = unquote(w);
        if risky.iter().any(|r| w == *r || w.starts_with(&format!("{r}="))) {
            return None;
        }
        if let Some((_, rest)) = w.split_once("://") {
            let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
            let host = host.rsplit('@').next().unwrap_or(host).to_ascii_lowercase();
            if host.is_empty() || host.contains(['$', '*', '{']) {
                return None;
            }
            hosts.push(host);
        }
    }
    let first = hosts.first()?.clone();
    hosts.iter().all(|h| *h == first).then_some(first)
}

/// A command as the agent passed it, without one layer of quotes around all of it (Codex sends `"cd /w && ls"`).
pub fn unwrap_quoted(command: &str) -> String {
    let c = command.trim();
    let whole =
        segments(c).is_some_and(|all| matches!(&all[..], [Segment { words, .. }] if words.len() == 1 && words[0] == c));
    let (Some(q @ ('"' | '\'')), true) = (c.chars().next(), whole && c.len() >= 2) else { return command.to_string() };
    let inner = &c[1..c.len() - 1];
    if q == '"' { inner.replace("\\\"", "\"").replace("\\\\", "\\") } else { inner.to_string() }
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
    let words = unwrapped(words);
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
        // Only a script read from the pipe: not one given inline or as a file.
        "sh" | "bash" | "zsh" | "node" => piped && reads_stdin(&args),
        _ if name.starts_with("python") => piped && reads_stdin(&args),
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

/// An interpreter's arguments leave its program to stdin: options only (up to `--`), none giving code inline.
fn reads_stdin(args: &[&str]) -> bool {
    args.iter()
        .take_while(|a| **a != "--")
        .all(|a| (a.starts_with('-') || *a == "-") && !matches!(*a, "-c" | "-e" | "--eval" | "-p" | "--print" | "-m"))
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
/// through `|`, whether it runs inside a `$(…)` of another, the files it redirects its output to and the text of the
/// heredoc it reads.
#[derive(Debug, Default)]
struct Segment {
    piped: bool,
    nested: bool,
    words: Vec<String>,
    writes: Vec<String>,
    stdin: Option<String>,
}

/// Splits a shell line into its simple commands at `&&`, `||`, `;`, `|` and newlines, dropping redirections to a file
/// descriptor or /dev/null and recording those to a literal file (`writes`). Heredocs are read past: their text is
/// data, unless an unquoted delimiter lets the shell substitute into it. A `$(…)` stays one word of its command and
/// adds its own commands as nested. `None` if the shell could run or write anything else: backticks, `$((…))` other
/// than plain numbers and operators, subshells, process and here-string input, redirections to expanded targets,
/// background jobs, unterminated quotes or heredocs. `( … )` groups are read as their commands (a `cd` inside one is
/// taken to last, which only ever judges more strictly), comments are skipped.
fn segments(line: &str) -> Option<Vec<Segment>> {
    let (mut all, mut nested, mut words, mut word) = (Vec::new(), Vec::new(), Vec::<String>::new(), String::new());
    let mut writes: Vec<String> = Vec::new();
    // Heredocs started on this line: (delimiter, quoted, `<<-`, the segment reading it), read once it ends.
    let mut heredocs: Vec<(String, bool, bool, usize)> = Vec::new();
    let mut piped = false;
    let (mut single, mut double, mut chars) = (false, false, line.chars().peekable());
    let end_word = |words: &mut Vec<String>, word: &mut String| {
        if !word.is_empty() {
            words.push(std::mem::take(word));
        }
    };
    let target = |chars: &mut std::iter::Peekable<std::str::Chars>| -> String {
        while chars.next_if(|c| *c == ' ' || *c == '\t').is_some() {}
        std::iter::from_fn(|| chars.next_if(|c| !" \t\n;&|<>()".contains(*c))).collect()
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
                    let words = std::mem::take(&mut words);
                    all.push(Segment { piped, words, writes: std::mem::take(&mut writes), ..Default::default() });
                } else if !writes.is_empty() {
                    return None;
                }
                if c == '\n' {
                    for (delimiter, quoted, tabs, at) in heredocs.drain(..) {
                        let mut body = String::new();
                        loop {
                            let mut text = String::new();
                            let ended = loop {
                                match chars.next() {
                                    Some('\n') => break false,
                                    Some(ch) => text.push(ch),
                                    None => break true,
                                }
                            };
                            let text = if tabs { text.trim_start_matches('\t') } else { &text };
                            if text == delimiter {
                                break;
                            }
                            if ended || (!quoted && (text.contains("$(") || text.contains('`'))) {
                                return None;
                            }
                            body.push_str(text);
                            body.push('\n');
                        }
                        if let Some(seg) = all.get_mut(at) {
                            seg.stdin = Some(body);
                        }
                    }
                }
            }
            '<' if chars.peek() == Some(&'<') => {
                chars.next();
                if chars.peek() == Some(&'<') {
                    return None;
                }
                let tabs = chars.next_if_eq(&'-').is_some();
                let raw = target(&mut chars);
                let quoted = raw.contains(['\'', '"', '\\']);
                let delimiter: String = raw.chars().filter(|c| !"'\"\\".contains(*c)).collect();
                if delimiter.is_empty() {
                    return None;
                }
                heredocs.push((delimiter, quoted, tabs, all.len()));
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
                    let to = target(&mut chars);
                    let to = unquote(&to);
                    if to.is_empty() || to.contains(['$', '*', '?', '[', '{', '`', '\'', '"']) {
                        return None;
                    }
                    if to != "/dev/null" {
                        writes.push(to.to_string());
                    }
                }
            }
            '#' if word.is_empty() => while chars.next_if(|c| *c != '\n').is_some() {},
            '(' if word.is_empty() && words.is_empty() => {}
            ')' => {
                end_word(&mut words, &mut word);
                if !words.is_empty() {
                    let piped = std::mem::replace(&mut piped, false);
                    let words = std::mem::take(&mut words);
                    all.push(Segment { piped, words, writes: std::mem::take(&mut writes), ..Default::default() });
                }
                // A redirection of the whole group (`( … ) > f`) would write what no command shows.
                while chars.next_if(|c| *c == ' ' || *c == '\t').is_some() {}
                if matches!(chars.peek(), Some('>' | '<')) || !writes.is_empty() {
                    return None;
                }
            }
            '<' | '(' => return None,
            _ => word.push(c),
        }
    }
    if single || double || !heredocs.is_empty() {
        return None;
    }
    end_word(&mut words, &mut word);
    if !words.is_empty() {
        all.push(Segment { piped, words, writes, ..Default::default() });
    } else if !writes.is_empty() {
        return None;
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

mod catalogs;
pub use catalogs::*;
mod shell;
mod trust;

#[cfg(test)]
mod tests;
