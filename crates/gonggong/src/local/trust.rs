//! What 帮我审批 trusts beyond 开发常用命令, from what owners approved in practice: the temporary directories as
//! scratch space, reading anywhere but secrets, cleaning up and copying inside the workspace, local git work and
//! pushes to non-base branches, the team CLIs' read-only commands, plain downloads, and scripts (inline or files)
//! whose code neither runs programs, reaches the network, deletes nor writes outside the workspace. Anything a rule
//! here cannot read for sure goes to the owner.
use super::shell::Shell;
use super::{
    Path, PathBuf, Segment, Trust, base, current_branch, expands, lead, outside_words, unquote, within_root, writable,
};

/// The temporary directories of this machine.
pub(super) fn temp_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = ["/tmp", "/private/tmp", "/var/tmp"].iter().map(PathBuf::from).collect();
    let tmp = std::env::temp_dir();
    if !dirs.contains(&tmp) {
        dirs.push(tmp);
    }
    dirs
}

/// Directories and files that hold credentials or the owner's private documents, by any path component.
const SECRET_PARTS: &[&str] = &[
    ".ssh",
    ".config",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".pgpass",
    ".git-credentials",
    ".claude.json",
    ".credentials.json",
    "credentials",
    "credentials.json",
    "Keychains",
    "Cookies",
    "Login Data",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
];
/// Files under the gonggong and agent homes that hold tokens or provider keys.
const SECRET_FILES: &[&str] = &[
    ".gonggong/config.json",
    ".gonggong/providers.json",
    ".gonggong/providers.v1.json",
    ".codex/auth.json",
    "/etc/shadow",
    "/etc/sudoers",
    "/etc/master.passwd",
];
/// The owner's personal folders in the home directory.
const PRIVATE_DIRS: &[&str] =
    &["Downloads", "Desktop", "Pictures", "Movies", "Music", "Library/Messages", "Library/Mail", "Library/Mobile Documents"];

/// Whether a word names a secret or a private file: credentials anywhere, `.env` files, keys and certificates, the
/// home's personal folders.
pub(super) fn sensitive(word: &str) -> bool {
    let w = unquote(word);
    let w = w.split_once('=').map_or(w, |(_, v)| v);
    let w = unquote(w.strip_prefix('@').unwrap_or(w));
    let path = Path::new(w);
    let parts = path.components().filter_map(|c| c.as_os_str().to_str());
    let secret = parts.into_iter().any(|p| {
        SECRET_PARTS.iter().any(|s| p == *s || (s.starts_with("id_") && p.starts_with(s)))
            || p == ".env"
            || (p.starts_with(".env.") && !p.ends_with(".example") && !p.ends_with(".sample") && !p.ends_with(".template"))
            || [".pem", ".key", ".p12", ".pfx", ".keystore", ".jks"].iter().any(|ext| p.ends_with(ext) && p.len() > ext.len())
    });
    let home = w
        .strip_prefix("~/")
        .or_else(|| w.strip_prefix("$HOME/"))
        .or_else(|| w.strip_prefix("${HOME}/"))
        .or_else(|| w.strip_prefix("/Users/").and_then(|r| r.split_once('/').map(|(_, r)| r)))
        .or_else(|| w.strip_prefix("/home/").and_then(|r| r.split_once('/').map(|(_, r)| r)));
    secret
        || SECRET_FILES.iter().any(|f| w.contains(f))
        || home.is_some_and(|h| PRIVATE_DIRS.iter().any(|d| h == *d || h.starts_with(&format!("{d}/"))))
}

/// Whether `name=value` may be set for later commands: not a variable that changes what programs run or load. `PATH`
/// and `JAVA_HOME` may name installed tools (outside the workspace, where nothing the agent wrote lives), Maven's
/// options only system properties. What reaches programs' environment (`exported`) is otherwise only what
/// `super::env_assignment` knows to be harmless; a shell variable may be anything else.
pub(super) fn assignable(name: &str, value: &str, roots: &[&Path], exported: bool) -> bool {
    let value = unquote(value);
    let installed = |dir: &str| {
        let temp = temp_dirs();
        let scratch: Vec<&Path> = roots.iter().copied().chain(temp.iter().map(PathBuf::as_path)).collect();
        Path::new(dir).is_absolute() && !expands(dir) && !within_root(Path::new(dir), roots[0], &scratch)
    };
    match name {
        "PATH" => value.split(':').all(|d| matches!(d, "$PATH" | "${PATH}") || installed(d)),
        "JAVA_HOME" => installed(value) || value.starts_with("$(/usr/libexec/java_home"),
        "MAVEN_OPTS" => !expands(value) && value.split_whitespace().all(|o| o.starts_with("-D")),
        _ if exported => super::env_assignment(&format!("{name}={value}")),
        _ if name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') => {
            !super::LOOKUP_VARS.contains(&name)
        }
        _ => {
            const DENY: &[&str] = &[
                "IFS", "HOME", "SHELL", "ENV", "BASH_ENV", "PS4", "PROMPT_COMMAND", "CDPATH", "FPATH", "EDITOR",
                "VISUAL", "PAGER", "BROWSER", "LESSOPEN", "LESSCLOSE", "TMPDIR", "SUDO_ASKPASS",
            ];
            const PREFIXES: &[&str] =
                &["LD_", "DYLD_", "PYTHON", "NODE_", "GIT_", "NPM_", "npm_config_", "RUSTC", "CARGO_", "GRADLE_", "MAVEN_", "JAVA_", "SSH_", "GO", "PERL", "RUBY"];
            !DENY.contains(&name)
                && !PREFIXES.iter().any(|p| name.starts_with(p))
                && !name.ends_with("_OPTIONS")
                && !name.ends_with("_OPTS")
        }
    }
}

/// The read-only git subcommands of `READ_ONLY` that also have writing forms: branch and tag deletion, reflog
/// expiry, `ls-remote`'s upload program.
pub(super) fn git_read_only(words: &[String]) -> bool {
    let args: Vec<&str> = words.iter().map(|w| unquote(w)).collect();
    match args.get(..2) {
        Some(["git", "branch" | "tag"]) => !args[2..].iter().any(|a| {
            matches!(
                *a,
                "-d" | "-D" | "-m" | "-M" | "-c" | "-C" | "-f" | "--force" | "--delete" | "--move" | "--copy" | "-u"
                    | "--set-upstream-to" | "--unset-upstream" | "--edit-description" | "-a" | "-s" | "--annotate"
            ) && !(args[1] == "branch" && *a == "-a")
                || a.starts_with("--set-upstream-to=")
        }),
        Some(["git", "reflog"]) => !args[2..].iter().any(|a| matches!(*a, "delete" | "expire")),
        Some(["git", "ls-remote"]) => !args[2..].iter().any(|a| *a == "-u" || a.starts_with("--upload-pack")),
        _ => true,
    }
}

/// An awk program that only prints to stdout: no `system`, no pipes or redirections from `print`, no `getline` from a
/// command or file, no program file.
pub(super) fn awk_read_only(args: &[String]) -> bool {
    let mut program = None;
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match a.as_str() {
            "-F" | "-v" => i += 1,
            "-f" => return false,
            a if a.starts_with("-F") || a.starts_with("-v") => {}
            a if a.starts_with('-') => return false,
            _ => {
                program = Some(unquote(a));
                break;
            }
        }
        i += 1;
    }
    let Some(program) = program else { return false };
    !program.contains("system")
        && !program.contains("getline")
        && !program.contains("fflush")
        && program
            .split([';', '{', '}', '\n'])
            .filter(|s| s.contains("print"))
            .all(|s| s.split_once("print").is_some_and(|(_, after)| !after.contains(['>', '|'])))
}

/// The text of a script file to judge, when it is small and readable and not a secret; relative to the workspace.
pub(super) fn script_text(file: &str, roots: &[&Path]) -> Option<String> {
    if sensitive(file) || expands(file) || file.contains(['`', '*', '?']) {
        return None;
    }
    let path = expand_home(file);
    let path = if path.is_absolute() { path } else { roots[0].join(path) };
    let meta = std::fs::metadata(&path).ok()?;
    (meta.is_file() && meta.len() <= 256 * 1024).then(|| std::fs::read_to_string(&path).ok()).flatten()
}

fn expand_home(file: &str) -> PathBuf {
    match (file.strip_prefix("~/").or_else(|| file.strip_prefix("$HOME/")), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(file),
    }
}

/// What 帮我审批 trusts on its own (see the module docs). `follow` judges a shell line a command runs (`bash -c`,
/// a shell script).
pub(super) fn helped(
    words: &[String],
    seg: &Segment,
    roots: &[&Path],
    trust: Trust,
    sh: &Shell,
    follow: &dyn Fn(&str) -> bool,
) -> bool {
    let Some(first) = words.first() else { return false };
    let args: Vec<&str> = words[1..].iter().map(|a| unquote(a)).collect();
    // The roots past the workspace, its additional directories and where `cd` went (`super::line_allowed`).
    let temp = &roots[(trust.own + usize::from(sh.dir().is_some())).min(roots.len())..];
    let place = Place { roots, sh, temp, dev: trust.dev };
    // Interpreters' code is judged by `code_ok`, which looks for secrets among the paths it names.
    let interpreter = matches!(base(first), "python" | "python3" | "node" | "bash" | "sh" | "zsh" | "perl")
        || base(first).starts_with("python3.");
    if !interpreter && words.iter().any(|w| sensitive(w)) {
        return false;
    }
    match base(first) {
        "rm" => remove(&args, &place),
        "sed" => sed_edit(&words[1..], &place),
        "cp" => copy(&args, &place),
        "mv" => {
            let ops: Vec<&&str> = args.iter().filter(|a| !a.starts_with('-')).collect();
            args.iter().all(|a| !a.starts_with('-') || matches!(*a, "-f" | "-n" | "-v" | "-i"))
                && ops.len() >= 2
                && ops.iter().all(|p| place.deletable(p))
        }
        "mkdir" | "touch" => {
            let ops: Vec<&&str> = args.iter().filter(|a| !a.starts_with('-')).collect();
            !ops.is_empty() && ops.iter().all(|p| place.writable(p))
        }
        "chmod" => match &args[..] {
            [mode, files @ ..] => {
                !files.is_empty()
                    // No setuid, setgid or sticky bits.
                    && ((mode.len() == 3 && mode.chars().all(|c| ('0'..='7').contains(&c)))
                        || mode.chars().all(|c| "ugoa+-=rwxX,".contains(c)))
                    && files.iter().all(|f| place.writable(f))
            }
            [] => false,
        },
        "unzip" | "tar" | "jar" => archive(base(first), &args, &place),
        "javac" => {
            let mut i = 0;
            while let Some(a) = args.get(i) {
                match *a {
                    "-d" | "-s" | "-h" => {
                        if !args.get(i + 1).is_some_and(|d| place.writable(d)) {
                            return false;
                        }
                        i += 1;
                    }
                    "-cp" | "-classpath" | "--class-path" | "-encoding" | "--release" | "-source" | "-target" => i += 1,
                    a if a.starts_with("-J") || a.starts_with("-Xplugin") || a == "-processorpath" => return false,
                    _ => {}
                }
                i += 1;
            }
            args.iter().any(|a| a.ends_with(".java")) && !sh.away
        }
        "curl" => curl(&args, &place),
        "wget" => wget(&args, &place),
        "git" => git(&args, roots, trust, sh),
        name if name.starts_with("python") && name[6..].chars().all(|c| c.is_ascii_digit() || c == '.') => {
            python(words, seg, &place)
        }
        "node" if matches!(args.first(), Some(&("--check" | "-c"))) => {
            args.len() > 1 && args[1..].iter().all(|f| place.readable(f))
        }
        "node" => node(words, seg, &place),
        "bash" | "sh" | "zsh" => shell(words, seg, &place, follow),
        "perl" => perl(&args, &place),
        _ if unquote(first).contains('/') => script_file(unquote(first), &args, &place, follow),
        name => cli_read(name, &args, &place),
    }
}

/// Where a command acts: the roots and how `cd` moved the shell.
struct Place<'a> {
    roots: &'a [&'a Path],
    sh: &'a Shell,
    /// The temporary directories: the agent's scratch space, whose scripts may reach the network.
    temp: &'a [&'a Path],
    /// The run changed nothing that steers commands (`Trust::dev`): the agents' skills are still the owner's.
    dev: bool,
}

impl Place<'_> {
    fn literal(path: &str) -> bool {
        !path.is_empty() && !path.contains(['~', '$', '`']) && !path.starts_with('-')
    }

    /// A file it may create or change: inside the roots, not git's own.
    fn writable(&self, path: &str) -> bool {
        Self::literal(path) && !self.sh.away && self.sh.relative_ok(path) && writable(path, self.roots)
    }

    /// A script file in the temporary directories (relative to where `cd` went).
    fn in_temp(&self, file: &str) -> bool {
        Self::literal(file)
            && !sensitive(file)
            && (Path::new(file).is_absolute() || !self.sh.away)
            && within_root(Path::new(file), self.roots[0], self.temp)
    }

    /// A file it may read: anywhere but secrets.
    fn readable(&self, path: &str) -> bool {
        !sensitive(path) && !expands(path)
    }

    /// A file or tree it may delete or move: strictly inside a root (never a root itself), without `..`, globs only
    /// below a directory inside one.
    fn deletable(&self, path: &str) -> bool {
        if !Self::literal(path) || self.sh.away {
            return false;
        }
        let p = Path::new(path);
        if p.components().any(|c| c == std::path::Component::ParentDir || c.as_os_str() == ".git") {
            return false;
        }
        let fixed: PathBuf = p.components().take_while(|c| !c.as_os_str().to_string_lossy().contains(['*', '?', '['])).collect();
        let fixed = if fixed.as_os_str().is_empty() { PathBuf::from(".") } else { fixed };
        let absolute = if fixed.is_absolute() { fixed.clone() } else { self.roots[0].join(&fixed) };
        let canon = |q: &Path| std::fs::canonicalize(q).unwrap_or_else(|_| q.to_path_buf());
        // The directory `cd` went to leads the roots (`line_allowed`) but is not one: cleaning inside it is fine.
        let real = if self.sh.dir().is_some() { &self.roots[1..] } else { self.roots };
        let is_root = real.iter().any(|r| canon(r) == canon(&absolute) || *r == absolute.as_path());
        within_root(&fixed, self.roots[0], self.roots) && !is_root
    }
}

/// `rm [-rfRdv] paths…`: paths inside the workspace or the temporary directories, never one of them as a whole.
fn remove(args: &[&str], place: &Place) -> bool {
    let mut ops = vec![];
    let mut options = true;
    for a in args {
        match *a {
            "--" if options => options = false,
            _ if options && a.starts_with('-') => {
                if !a[1..].chars().all(|c| "rRfdvi".contains(c)) && !matches!(*a, "--recursive" | "--force") {
                    return false;
                }
            }
            _ => ops.push(*a),
        }
    }
    !ops.is_empty() && ops.iter().all(|p| place.deletable(p))
}

/// `sed -i` editing files inside the roots with a script that only substitutes, prints or deletes lines
/// (`super::sed_read_only` refuses `w` and `e`).
fn sed_edit(args: &[String], place: &Place) -> bool {
    let mut rest: Vec<String> = vec![];
    let mut in_place = false;
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match unquote(a) {
            "-i" | "--in-place" => {
                in_place = true;
                // BSD sed takes the backup suffix as the next word (`-i ''`).
                if args.get(i + 1).is_some_and(|n| matches!(n.as_str(), "''" | "\"\"")) {
                    i += 1;
                }
            }
            u if u.starts_with("-i") || u.starts_with("--in-place=") => in_place = true,
            _ => rest.push(a.clone()),
        }
        i += 1;
    }
    if !in_place || !super::sed_read_only(&rest) {
        return false;
    }
    let explicit = rest.iter().any(|a| matches!(unquote(a), "-e" | "--expression") || a.starts_with("--expression="));
    let mut files = vec![];
    let mut script_seen = explicit;
    let mut j = 0;
    while let Some(a) = rest.get(j) {
        let u = unquote(a);
        if matches!(u, "-e" | "--expression") {
            j += 2;
            continue;
        }
        if !u.starts_with('-') {
            if script_seen {
                files.push(u.to_string());
            } else {
                script_seen = true;
            }
        }
        j += 1;
    }
    !files.is_empty() && files.iter().all(|f| place.writable(f))
}

/// `cp [-rRpfavn] sources… target`: sources readable, the target inside the roots.
fn copy(args: &[&str], place: &Place) -> bool {
    let mut ops = vec![];
    for a in args {
        if let Some(flags) = a.strip_prefix('-') {
            if !flags.chars().all(|c| "rRpfavnLPH".contains(c)) {
                return false;
            }
        } else {
            ops.push(*a);
        }
    }
    match ops.split_last() {
        Some((target, sources)) if !sources.is_empty() => {
            place.writable(target) && sources.iter().all(|s| place.readable(s))
        }
        _ => false,
    }
}

/// Listing or extracting an archive: listing reads it, extracting writes inside the roots.
fn archive(name: &str, args: &[&str], place: &Place) -> bool {
    match name {
        "jar" => matches!(args.first(), Some(&("tf" | "tvf" | "-tf" | "-tvf"))) && args[1..].iter().all(|a| place.readable(a)),
        "unzip" => {
            let listing = args.iter().any(|a| matches!(*a, "-l" | "-Z" | "-p" | "-t" | "-v" | "-lv"));
            let mut i = 0;
            while let Some(a) = args.get(i) {
                match *a {
                    "-d" => {
                        if !args.get(i + 1).is_some_and(|d| place.writable(d)) {
                            return false;
                        }
                        i += 1;
                    }
                    a if a.starts_with('-') => {
                        if !a[1..].chars().all(|c| "lZptvoqnj".contains(c)) {
                            return false;
                        }
                    }
                    a => {
                        if !place.readable(a) {
                            return false;
                        }
                    }
                }
                i += 1;
            }
            listing || args.contains(&"-d") || !place.sh.away
        }
        _ => {
            let Some(mode) = args.first().map(|m| m.trim_start_matches('-')) else { return false };
            if !mode.chars().all(|c| "txvzjJfC".contains(c)) {
                return false;
            }
            let into = args.iter().position(|a| *a == "-C").map(|i| args.get(i + 1));
            if mode.contains('t') {
                return args[1..].iter().all(|a| *a == "-C" || place.readable(a));
            }
            mode.contains('x')
                && match into {
                    Some(dir) => dir.is_some_and(|d| place.writable(d)),
                    None => !place.sh.away,
                }
                && args[1..].iter().filter(|a| **a != "-C").all(|a| place.readable(a))
        }
    }
}

/// A plain HTTP(S) GET: no request body, upload, config file or other scheme; whatever it saves goes inside the roots.
fn curl(args: &[&str], place: &Place) -> bool {
    // What the shell fills in may carry the workspace's files out (`?d=$(cat src/a.ts)`).
    if args.iter().any(|a| expands(a)) {
        return false;
    }
    let mut i = 0;
    let mut urls = 0;
    while let Some(a) = args.get(i) {
        let next = || args.get(i + 1).copied();
        match *a {
            "-X" | "--request" => {
                if !next().is_some_and(|m| matches!(m, "GET" | "HEAD")) {
                    return false;
                }
                i += 1;
            }
            "-o" | "--output" | "-D" | "--dump-header" | "-c" | "--cookie-jar" | "--output-dir" => {
                if !next().is_some_and(|p| p == "-" || place.writable(p)) {
                    return false;
                }
                i += 1;
            }
            "-H" | "--header" | "-m" | "--max-time" | "--connect-timeout" | "-A" | "--user-agent" | "-e" | "--referer"
            | "-u" | "--user" | "-x" | "--proxy" | "-w" | "--write-out" | "--retry" | "-b" | "--cookie" | "-r"
            | "--range" | "--resolve" | "--noproxy" => {
                if next().is_some_and(|v| v.starts_with('@') || sensitive(v)) {
                    return false;
                }
                i += 1;
            }
            "-O" | "--remote-name" | "-J" => {
                if place.sh.away {
                    return false;
                }
            }
            a if a.starts_with("http://") || a.starts_with("https://") => urls += 1,
            a if a.starts_with("--") => {
                const FLAGS: &[&str] = &[
                    "--silent", "--show-error", "--fail", "--location", "--insecure", "--include", "--head",
                    "--compressed", "--verbose", "--globoff", "--fail-with-body", "--no-progress-meter", "--http1.1",
                    "--http2", "--ipv4", "--max-time", "--retry-all-errors", "--get",
                ];
                if !FLAGS.contains(&a.split('=').next().unwrap_or(a)) {
                    return false;
                }
            }
            a if a.starts_with('-') => {
                if !a[1..].chars().all(|c| "sSfLkiIvgNG4#".contains(c)) {
                    return false;
                }
            }
            _ => return false,
        }
        i += 1;
    }
    urls > 0
}

fn wget(args: &[&str], place: &Place) -> bool {
    let mut i = 0;
    let mut urls = 0;
    while let Some(a) = args.get(i) {
        match *a {
            "-O" | "--output-document" | "-P" | "--directory-prefix" | "-o" | "--output-file" => {
                if !args.get(i + 1).is_some_and(|p| *p == "-" || place.writable(p)) {
                    return false;
                }
                i += 1;
            }
            "-T" | "--timeout" | "-t" | "--tries" | "--header" | "-U" | "--user-agent" => i += 1,
            "-q" | "--quiet" | "-nv" | "-c" | "--continue" | "--no-check-certificate" | "-S" | "--server-response" => {}
            a if a.starts_with("http://") || a.starts_with("https://") => urls += 1,
            _ => return false,
        }
        i += 1;
    }
    urls > 0 && !place.sh.away
}

/// Bases of a team's shared history, never pushed to without asking (besides the group's own `protect`).
const BASE_BRANCHES: &[&str] =
    &["main", "master", "develop", "development", "dev", "trunk", "staging", "uat", "pre", "test", "prod", "production"];

/// Local git work and pushes to a feature branch (the floor already took force pushes, deletions, `reset --hard`).
fn git(args: &[&str], roots: &[&Path], trust: Trust, sh: &Shell) -> bool {
    // Only the commit identity may be set for one command; other `-c` settings can run programs.
    let mut plain = vec![];
    let mut i = 0;
    while let Some(a) = args.get(i) {
        if *a == "-c" {
            if !args.get(i + 1).is_some_and(|kv| kv.starts_with("user.name=") || kv.starts_with("user.email=")) {
                return false;
            }
            i += 2;
            continue;
        }
        plain.push(*a);
        i += 1;
    }
    let args = &plain[..];
    let Some((sub, rest)) = lead(args, &["--no-pager", "-P"], &["-C"]) else { return false };
    let at = args.iter().position(|a| *a == "-C").map(|i| args.get(i + 1).copied());
    let Some(dir) = (match at {
        Some(dir) => dir.filter(|d| within_root(Path::new(d), roots[0], roots) && !expands(d)),
        None => (!sh.away).then_some("."),
    }) else {
        return false;
    };
    let has = |xs: &[&str]| rest.iter().any(|a| xs.contains(a) || xs.iter().any(|x| a.starts_with(&format!("{x}="))));
    // These run the repository's hooks (`.husky/`, `core.hooksPath`), which the run may have changed (`Rules::tampered`).
    let hooks = matches!(sub, "commit" | "merge" | "rebase" | "cherry-pick" | "revert" | "pull" | "push" | "am")
        || matches!(sub, "checkout" | "switch")
        || (sub == "worktree" && rest.first() == Some(&"add"));
    if hooks && !trust.dev {
        return false;
    }
    match sub {
        "add" | "commit" => true,
        "fetch" | "pull" => !has(&["--upload-pack", "--exec"]),
        "worktree" => match rest.first() {
            Some(&("list" | "prune")) => true,
            Some(&("add" | "remove" | "move")) => rest[1..]
                .iter()
                .filter(|a| !a.starts_with('-'))
                .take(if rest[0] == "add" { 1 } else { 2 })
                .all(|p| Place::literal(p) && within_root(Path::new(p), roots[0], roots)),
            _ => false,
        },
        "merge" | "rebase" | "cherry-pick" | "revert" => {
            !has(&["-i", "--interactive", "-x", "--exec", "-s", "--strategy", "-X", "--strategy-option"])
        }
        "reset" => !has(&["--hard", "--merge", "--keep"]),
        // As 开发常用命令 judges them: never discarding uncommitted work or resetting a branch.
        "checkout" | "switch" | "branch" | "stash" => {
            let words: Vec<String> = std::iter::once("git").chain(args.iter().copied()).map(String::from).collect();
            super::dev_command(&words, roots)
        }
        "restore" => has(&["--staged", "-S"]) && !has(&["--worktree", "-W"]),
        "rm" | "mv" => rest.iter().filter(|a| !a.starts_with('-')).all(|p| !p.contains("..")),
        "tag" => !has(&["-s", "--sign", "-u", "-f", "--force"]),
        "clean" => has(&["-n", "--dry-run"]),
        "apply" => !has(&["--unsafe-paths", "--directory"]),
        "push" => push(rest, Path::new(dir), roots[0], trust, at.is_some() || sh.away),
        _ => false,
    }
}

/// `git push [remote] [refspec…]` to branches that are not a base: named, or the current one.
fn push(rest: &[&str], dir: &Path, cwd: &Path, trust: Trust, elsewhere: bool) -> bool {
    let mut positional = vec![];
    for a in rest {
        match *a {
            "-u" | "--set-upstream" | "-q" | "--quiet" | "-v" | "--verbose" | "--no-verify" | "--porcelain" => {}
            _ if a.starts_with('-') => return false,
            _ => positional.push(*a),
        }
    }
    let base = |b: &str| {
        let b = b.strip_prefix("refs/heads/").unwrap_or(b);
        BASE_BRANCHES.contains(&b)
            || b.starts_with("release")
            || b.starts_with("prod")
            || b.starts_with("refs/")
            || trust.protect.iter().any(|p| p == b)
    };
    let current = || if elsewhere { None } else { current_branch(&cwd.join(dir)) };
    match positional.get(1..).filter(|s| !s.is_empty()) {
        None => current().is_some_and(|b| !base(&b)),
        Some(specs) => specs.iter().all(|spec| {
            let dst = spec.split_once(':').map_or(*spec, |(_, d)| d);
            let dst = if dst == "HEAD" { current() } else { Some(dst.to_string()) };
            dst.is_some_and(|d| !base(&d))
        }),
    }
}

/// Code a script language gives no reason to ask about: patterns that run programs, reach the network, delete or
/// move files, change directory or load code. Writes are judged with the paths the script names.
struct Lang {
    risky: &'static [&'static str],
    /// Running programs and reaching the network: allowed to code in the temporary directories.
    reach: &'static [&'static str],
    writes: &'static [&'static str],
}

const PYTHON: Lang = Lang {
    risky: &[
        "os.exec", "os.spawn", "os.fork", "os.kill", "shutil.rmtree",
        "shutil.move", "os.remove", "os.unlink", "os.rmdir", "os.removedirs", "os.rename", "os.replace", "os.chmod",
        "os.chown", "os.symlink", "os.link", ".unlink(", ".rmdir(", ".rename(", "rmtree", "eval(", "exec(",
        "__import__", "importlib", "ctypes", "import pty", "ftplib", "smtplib",
        "paramiko", "telnetlib", "webbrowser", "pickle", "marshal", "sys.modules", "os.chdir", "expanduser",
        "Path.home", "signal.", "setattr(os", "sys.path", "putenv", "keyring",
    ],
    reach: &[
        "subprocess", "os.system", "os.popen", "socket", "requests", "urllib", "http.client", "httpx", "aiohttp",
        "multiprocessing",
    ],
    writes: &[
        ".write_text(", ".write_bytes(", ".touch(", ".mkdir(", "os.makedirs", "os.mkdir", "shutil.copy", ".to_csv(",
        ".to_excel(", ".to_json(", ".savefig(", ".save(", "ZipFile(",
    ],
};

const NODE: Lang = Lang {
    risky: &[
        "eval(", "new Function", "process.binding", "vm'", "vm\"", "unlink", "rmSync", "rmdir", ".rm(", "rename", "chmod", "chown", "symlink", "homedir",
        "process.env.HOME", "import(", "worker_threads", "process.kill", "process.chdir", "process.dlopen",
    ],
    reach: &[
        "child_process", "require('http", "require(\"http", "from 'http", "from \"http", "net'", "net\"", "dgram",
        "fetch(", "XMLHttpRequest", "WebSocket",
    ],
    writes: &["writeFile", "appendFile", "mkdir", "createWriteStream", "copyFile", "cpSync", "cp(", "open("],
};

/// Whether code in `lang` may run: nothing risky (running programs and the network are fine `in_temp`), no secret
/// named, and when it writes, every absolute path it or its arguments name inside the roots.
fn code_ok(lang: &Lang, code: &str, args: &[&str], place: &Place, in_temp: bool) -> bool {
    if lang.risky.iter().any(|r| code.contains(r)) || (!in_temp && lang.reach.iter().any(|r| code.contains(r))) {
        return false;
    }
    let literals = path_literals(code);
    if literals.iter().map(String::as_str).chain(args.iter().copied()).any(sensitive) {
        return false;
    }
    let writes = lang.writes.iter().any(|w| code.contains(w)) || opens_for_writing(code);
    !writes
        || (!place.sh.away
            && literals.iter().map(String::as_str).chain(args.iter().copied().filter(|a| a.contains('/'))).all(|p| {
                !p.contains("..") && (!Path::new(p).is_absolute() && !p.starts_with('~') || place.writable(p))
            }))
}

/// Python's `open(…, 'w')` and the like: a mode with `w`, `a`, `x` or `+`.
fn opens_for_writing(code: &str) -> bool {
    code.match_indices("open(").any(|(i, _)| {
        let call: String = code[i..].chars().take_while(|c| *c != ')').collect();
        ["'w", "\"w", "'a", "\"a", "'x", "\"x", "+'", "+\"", "mode="].iter().any(|m| call.contains(m))
    })
}

/// Top-level directories a string must start in to be taken for a file path (`/api/v1` is a URL path).
const FS_TOPS: &[&str] = &[
    "Users", "home", "root", "tmp", "private", "var", "etc", "opt", "usr", "Library", "System", "Applications",
    "Volumes", "bin", "sbin", "dev", "srv", "mnt",
];

/// String literals in code that look like absolute or home file paths.
fn path_literals(code: &str) -> Vec<String> {
    let mut out = vec![];
    for quote in ['\'', '"', '`'] {
        for (i, part) in code.split(quote).enumerate() {
            let top = part.strip_prefix('/').map(|p| p.split('/').next().unwrap_or_default());
            let path = part.starts_with("~/") || top.is_some_and(|t| FS_TOPS.contains(&t));
            if i % 2 == 1 && path && !part.contains(char::is_whitespace) {
                out.push(part.to_string());
            }
        }
    }
    out
}

/// The text a word holds, without one layer of quotes; `None` when the shell would expand something in it.
fn literal_text(word: &str) -> Option<String> {
    if expands(word) {
        return None;
    }
    let inner = |q: char| word.strip_prefix(q).and_then(|w| w.strip_suffix(q));
    Some(match (inner('\''), inner('"')) {
        (Some(t), _) => t.to_string(),
        (_, Some(t)) => t.replace("\\\"", "\"").replace("\\\\", "\\"),
        _ => word.to_string(),
    })
}

/// Options of an interpreter: those standing alone, those taking the next word, those giving the code inline.
struct Options<'a> {
    flags: &'a [&'a str],
    values: &'a [&'a str],
    inline: &'a [&'a str],
}

/// The program an interpreter (`words[0]`) runs: inline (`-c`/`-e`), from a heredoc (`-` or nothing), or a script
/// file; its arguments; and whether it lives in the temporary directories (a file there, or inline after a `cd`
/// into them). `None` for any option not known here.
fn program_of(words: &[String], seg: &Segment, o: &Options, place: &Place) -> Option<(String, Vec<String>, bool)> {
    let args: Vec<&str> = words[1..].iter().map(|a| unquote(a)).collect();
    let mut i = 0;
    while let Some(a) = args.get(i) {
        if o.inline.contains(a) {
            let code = literal_text(words.get(i + 2)?)?;
            return Some((code, args[i + 2..].iter().map(|s| s.to_string()).collect(), place.sh.scratch));
        }
        if !a.starts_with('-') || *a == "-" {
            break;
        }
        if o.values.contains(a) {
            i += 1;
        } else if !o.flags.contains(a) {
            return None;
        }
        i += 1;
    }
    match args.get(i) {
        None | Some(&"-") if !seg.piped => {
            let rest = args.get(i + 1..).unwrap_or_default().iter().map(|s| s.to_string()).collect();
            Some((seg.stdin.clone()?, rest, place.sh.scratch))
        }
        Some(file) if *file != "-" => {
            let text = script_text(file, place.roots)?;
            Some((text, args[i + 1..].iter().map(|s| s.to_string()).collect(), place.in_temp(file)))
        }
        _ => None,
    }
}

fn python(words: &[String], seg: &Segment, place: &Place) -> bool {
    let args: Vec<&str> = words[1..].iter().map(|a| unquote(a)).collect();
    if let Some(at) = args.iter().position(|a| *a == "-m") {
        return args[..at].iter().all(|a| matches!(*a, "-I" | "-u" | "-B")) && args.get(at + 1) == Some(&"json.tool");
    }
    let o = Options { flags: &["-I", "-u", "-B", "-E", "-s", "-S", "-O", "-OO", "-q"], values: &["-X", "-W"], inline: &["-c"] };
    program_of(words, seg, &o, place).is_some_and(|(code, rest, temp)| {
        code_ok(&PYTHON, &code, &rest.iter().map(String::as_str).collect::<Vec<_>>(), place, temp)
    })
}

fn node(words: &[String], seg: &Segment, place: &Place) -> bool {
    let flags = ["--no-warnings", "--enable-source-maps", "--input-type=module", "--input-type=commonjs"];
    let o = Options { flags: &flags, values: &[], inline: &["-e", "--eval", "-p", "--print"] };
    program_of(words, seg, &o, place).is_some_and(|(code, rest, temp)| {
        code_ok(&NODE, &code, &rest.iter().map(String::as_str).collect::<Vec<_>>(), place, temp)
    })
}

/// `bash -c '…'`, `bash script.sh`, `bash <<EOF`: the commands it runs, judged like the line itself.
fn shell(words: &[String], seg: &Segment, place: &Place, follow: &dyn Fn(&str) -> bool) -> bool {
    let flags = ["-e", "-u", "-x", "-eu", "-ex", "-eux", "-euo", "-l", "--noprofile", "--norc"];
    let o = Options { flags: &flags, values: &["-o"], inline: &["-c", "-lc", "-ec"] };
    let file = words[1..].iter().map(|w| unquote(w)).find(|a| !a.starts_with('-'));
    if let Some(file) = file
        && (place.in_temp(file) || skill_query(file, &words[2..], place))
    {
        let rest: Vec<&str> = words[2..].iter().map(|a| unquote(a)).collect();
        return words[1..].iter().position(|w| unquote(w) == file) == Some(0) && args_ok(&rest, place);
    }
    !place.sh.away && program_of(words, seg, &o, place).is_some_and(|(text, _, _)| follow(&text))
}

/// Arguments handed to a script that runs on its own: nothing the shell fills in, no secret.
fn args_ok(args: &[&str], place: &Place) -> bool {
    args.iter().all(|a| place.readable(a))
}

/// A skill's script asked a read-only query: its subcommand reads (`READS`) and changes nothing (`CHANGES`), like a
/// team CLI's. Skills live in the agents' settings (`.claude/skills/…`, gonggong's `~/.gonggong/skill-sets/…`),
/// which a run changing sets `Rules::tampered` (`super::steering`).
fn skill_query(file: &str, args: &[String], place: &Place) -> bool {
    let parts: Vec<&str> = Path::new(file).components().filter_map(|c| c.as_os_str().to_str()).collect();
    let steered = parts.windows(2).any(|w| matches!(w, [".claude" | ".codex", "skills"]));
    // Elsewhere only where the run cannot write without asking: outside the workspace.
    let installed = parts.windows(2).any(|w| matches!(w, [".agents" | ".skillstack", "skills"] | [".gonggong", "skill-sets"]))
        && !within_root(&expand_home(file), place.roots[0], place.roots);
    let skill = steered || installed;
    let Some(sub) = args.first().map(|a| unquote(a)).filter(|a| !a.starts_with('-')) else { return false };
    let tokens = words_of(sub);
    skill
        && place.dev
        && !expands(file)
        && tokens.iter().any(|t| READS.contains(&t.as_str()))
        && !tokens.iter().any(|t| CHANGES.contains(&t.as_str()))
}

/// `perl -pi -e 's/…/…/' files…`: substitutions only, editing files inside the roots.
fn perl(args: &[&str], place: &Place) -> bool {
    let (mut code, mut in_place, mut files) = (None, false, vec![]);
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match *a {
            "-e" | "-E" => {
                code = args.get(i + 1).copied();
                i += 1;
            }
            a if a.starts_with('-') && a[1..].chars().all(|c| "pnilwa0".contains(c)) => in_place |= a.contains('i'),
            a if a.starts_with("-i") => in_place = true,
            a if a.starts_with('-') => return false,
            a => files.push(a),
        }
        i += 1;
    }
    let Some(code) = code else { return false };
    const RISKY: &[&str] = &[
        "system", "exec", "`", "qx", "open", "unlink", "rename", "eval", "require", "use ", "do ", "glob", "chdir",
        "mkdir", "rmdir", "kill", "fork", "socket", "sysopen", "link", "chmod", "chown", "truncate", "/e",
    ];
    let code = code.trim_end_matches(['g', 'i', 'm', 's', 'x']);
    !RISKY.iter().any(|r| code.contains(r))
        && !files.is_empty()
        && files.iter().all(|f| if in_place { place.writable(f) } else { place.readable(f) })
}

/// A script run by its path: a shell script judged line by line, a Python or Node one by its code.
fn script_file(file: &str, args: &[&str], place: &Place, follow: &dyn Fn(&str) -> bool) -> bool {
    let Some(text) = script_text(file, place.roots) else { return false };
    let shebang = text.lines().next().unwrap_or_default();
    let temp = place.in_temp(file);
    let owned: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    if file.ends_with(".py") || shebang.contains("python") {
        code_ok(&PYTHON, &text, args, place, temp)
    } else if file.ends_with(".js") || file.ends_with(".mjs") || shebang.contains("node") {
        code_ok(&NODE, &text, args, place, temp)
    } else if (file.ends_with(".sh") || shebang.contains("sh")) && (temp || skill_query(file, &owned, place)) {
        args_ok(args, place)
    } else if file.ends_with(".sh") || shebang.contains("sh") {
        !place.sh.away && args.iter().all(|a| place.readable(a) && !expands(a)) && follow(&text)
    } else {
        false
    }
}

/// Team CLIs whose subcommands say whether they read.
const CLIS: &[&str] =
    &["lark-cli", "meegle", "aliyun", "gh", "glab", "kubectl", "docker", "helm", "npm", "pnpm", "yarn", "pip", "pip3", "brew", "fd"];
/// Words in a subcommand that read.
const READS: &[&str] = &[
    "list", "get", "search", "query", "fetch", "view", "show", "status", "read", "describe", "inspect", "me", "info",
    "meta", "history", "diff", "log", "logs", "ps", "images", "top", "whoami", "version", "help", "tree", "ls",
    "checks", "watch", "outdated", "why", "freeze", "spaces", "resolve", "builds", "versions", "trace", "traces",
    "alerts", "metrics",
];
/// Words in a subcommand that change something.
const CHANGES: &[&str] = &[
    "create", "update", "upsert", "delete", "del", "remove", "rm", "batch", "set", "add", "upload", "login", "logout",
    "publish", "send", "move", "mv", "copy", "cp", "apply", "write", "edit", "patch", "post", "put", "merge", "close",
    "reopen", "approve", "comment", "transfer", "grant", "revoke", "run", "exec", "trigger", "build", "deploy",
    "restart", "attach", "port", "proxy", "cordon", "drain", "taint", "label", "annotate", "stop", "start", "kill", "scale", "rollout", "drop", "reset", "import", "export", "install",
    "uninstall", "enable", "disable", "download", "clone", "fork", "sync", "cancel", "rerun", "lock", "unlock", "pin",
];

/// A team CLI's read-only command: its subcommand words (before the first option) include one that reads and none
/// that changes; `api` calls only as GETs; output files inside the roots.
fn cli_read(name: &str, args: &[&str], place: &Place) -> bool {
    if !CLIS.contains(&name) {
        return false;
    }
    let sub: Vec<&str> = args.iter().take_while(|a| !a.starts_with('-')).take(3).copied().collect();
    // `build:status` is about a build: only its last part says what it does.
    let tokens: Vec<String> = sub.iter().flat_map(|s| words_of(s.rsplit(':').next().unwrap_or(s))).collect();
    let api = sub.first() == Some(&"api");
    let help = args.iter().any(|a| matches!(*a, "--help" | "-h")) || sub.last() == Some(&"help");
    if help {
        return true;
    }
    if api {
        let method = args.iter().position(|a| matches!(*a, "-X" | "--method")).and_then(|i| args.get(i + 1));
        let get = sub.get(1) == Some(&"GET") || method.is_none_or(|m| *m == "GET");
        let body = args.iter().any(|a| matches!(*a, "-f" | "-F" | "--field" | "--raw-field" | "--input" | "--data" | "-d"));
        if !get || body || sub.get(1).is_some_and(|m| matches!(*m, "POST" | "PUT" | "PATCH" | "DELETE")) {
            return false;
        }
    } else if !tokens.iter().any(|t| READS.contains(&t.as_str())) || tokens.iter().any(|t| CHANGES.contains(&t.as_str())) {
        return false;
    }
    let outputs_ok = args.windows(2).all(|w| match w[0] {
        "--output" | "--out" | "--output-dir" | "--output-file" => {
            matches!(w[1], "json" | "yaml" | "table" | "text" | "csv" | "wide" | "ndjson") || place.writable(w[1])
        }
        _ => true,
    }) && !args.iter().any(|a| a.starts_with("--output=") && !place.writable(&a[9..]));
    let paths_ok = args.iter().all(|a| !expands(a)) && outside_words(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>(), place.roots).iter().all(|o| !sensitive(o));
    outputs_ok && paths_ok
}

/// The lowercase words of a subcommand: `+record-list` → record, list; `DescribeMetricList` → describe, metric, list.
fn words_of(sub: &str) -> Vec<String> {
    let mut out = vec![];
    for part in sub.trim_start_matches('+').split(['-', '_', ':', '.', '/']) {
        let mut word = String::new();
        for c in part.chars() {
            if c.is_ascii_uppercase() && !word.is_empty() {
                out.push(std::mem::take(&mut word));
            }
            word.push(c.to_ascii_lowercase());
        }
        if !word.is_empty() {
            out.push(word);
        }
    }
    out
}
