//! Inline and file scripts of the interpreters 帮我审批 reads: what their code may do without asking.
use super::{Path, Place, sensitive};

/// Code a script language gives no reason to ask about: patterns that run programs, reach the network, delete or
/// move files, change directory or load code. Writes are judged with the paths the script names.
pub(super) struct Lang {
    risky: &'static [&'static str],
    /// Running programs and reaching the network: allowed to code in the temporary directories.
    reach: &'static [&'static str],
    writes: &'static [&'static str],
}

pub(super) const PYTHON: Lang = Lang {
    risky: &[
        "os.exec",
        "os.spawn",
        "os.fork",
        "os.kill",
        "shutil.rmtree",
        "shutil.move",
        "os.remove",
        "os.unlink",
        "os.rmdir",
        "os.removedirs",
        "os.rename",
        "os.replace",
        "os.chmod",
        "os.chown",
        "os.symlink",
        "os.link",
        ".unlink(",
        ".rmdir(",
        ".rename(",
        "rmtree",
        "eval(",
        "exec(",
        "__import__",
        "importlib",
        "ctypes",
        "import pty",
        "ftplib",
        "smtplib",
        "paramiko",
        "telnetlib",
        "webbrowser",
        "pickle",
        "marshal",
        "sys.modules",
        "os.chdir",
        "expanduser",
        "Path.home",
        "signal.",
        "setattr(os",
        "sys.path",
        "putenv",
        "keyring",
    ],
    reach: &[
        "subprocess",
        "os.system",
        "os.popen",
        "socket",
        "requests",
        "urllib",
        "http.client",
        "httpx",
        "aiohttp",
        "multiprocessing",
    ],
    writes: &[
        ".write_text(",
        ".write_bytes(",
        ".touch(",
        ".mkdir(",
        "os.makedirs",
        "os.mkdir",
        "shutil.copy",
        ".to_csv(",
        ".to_excel(",
        ".to_json(",
        ".savefig(",
        ".save(",
        "ZipFile(",
    ],
};

pub(super) const NODE: Lang = Lang {
    risky: &[
        "eval(",
        "new Function",
        "process.binding",
        "vm'",
        "vm\"",
        "unlink",
        "rmSync",
        "rmdir",
        ".rm(",
        "rename",
        "chmod",
        "chown",
        "symlink",
        "homedir",
        "process.env.HOME",
        "import(",
        "worker_threads",
        "process.kill",
        "process.chdir",
        "process.dlopen",
    ],
    reach: &[
        "child_process",
        "require('http",
        "require(\"http",
        "from 'http",
        "from \"http",
        "net'",
        "net\"",
        "dgram",
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
    ],
    writes: &["writeFile", "appendFile", "mkdir", "createWriteStream", "copyFile", "cpSync", "cp(", "open("],
};

/// Whether code in `lang` may run: nothing risky (running programs and the network are fine `in_temp`), no secret
/// named, and when it writes, every absolute path it or its arguments name inside the roots.
pub(super) fn code_ok(lang: &Lang, code: &str, args: &[&str], place: &Place, in_temp: bool) -> bool {
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
    "Users",
    "home",
    "root",
    "tmp",
    "private",
    "var",
    "etc",
    "opt",
    "usr",
    "Library",
    "System",
    "Applications",
    "Volumes",
    "bin",
    "sbin",
    "dev",
    "srv",
    "mnt",
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
