//! Remote repo identity and access with the machine's own credentials: canonical keys, the ssh ↔ https fallback
//! (the owner's preferred protocol first), and `repo.probe`.
use crate::protocol::{GitProtocol, REPO_BRANCHES_MAX, RepoAccessReason, RepoProbe, RepoProbeResult};
use crate::t;
use regex::Regex;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::process::Command;

const CANDIDATE_TIMEOUT: Duration = Duration::from_secs(15);

/// `git@host:path`, also user-less `host:path` (ssh config aliases); a one-letter host would be a Windows drive.
static SCP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:[^@/\s]+@)?([^:/\s\\]{2,}):(.+)$").unwrap());
static SCHEME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(ssh|https?)://(?:[^@/\s]*@)?([^:/\s]+)(:\d+)?/(.+)$").unwrap());
static USERINFO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(https?://)[^@/\s]*@").unwrap());

#[derive(Debug, PartialEq)]
enum Family {
    Ssh,
    Http,
}

struct Remote {
    family: Family,
    host: String,
    /// Without `.git` and surrounding slashes, original case.
    path: String,
    explicit_port: bool,
}

fn parse(url: &str) -> Option<Remote> {
    let url = url.trim();
    let trim = |p: &str| p.trim_matches('/').strip_suffix(".git").unwrap_or(p.trim_matches('/')).to_string();
    if let Some(m) = SCHEME.captures(url) {
        let family = if &m[1] == "ssh" { Family::Ssh } else { Family::Http };
        let (host, path) = (m[2].to_string(), trim(&m[4]));
        return (!path.is_empty()).then_some(Remote { family, host, path, explicit_port: m.get(3).is_some() });
    }
    // Any other scheme (file://) is not scp syntax.
    let m = SCP.captures(url).filter(|_| !url.contains("://"))?;
    let path = trim(&m[2]);
    (!path.is_empty()).then(|| Remote { family: Family::Ssh, host: m[1].to_string(), path, explicit_port: false })
}

/// Canonical identity `host/path` (lowercase, port and credentials left out), equal to `repoKey` in
/// packages/protocol (cases/repo-keys.json). Local paths and `file://` URLs resolve symlinks (macOS `/var`).
pub fn normalize_remote(url: &str) -> String {
    let url = url.trim();
    if let Some(r) = parse(url) {
        return format!("{}/{}", r.host, r.path).to_lowercase();
    }
    let path = url.strip_prefix("file://").unwrap_or(url);
    let real = std::fs::canonicalize(path).map(|p| p.to_string_lossy().into_owned());
    let real = real.unwrap_or_else(|_| path.into());
    let real = real.trim_end_matches('/');
    format!("file://{}", real.strip_suffix(".git").unwrap_or(real).trim_end_matches('/'))
}

/// URLs to try in order: the preferred protocol's form first, then the other form. ssh → https drops the ssh port
/// (https is almost always on 443); https → ssh is only guessed without an explicit port.
pub fn candidates(url: &str, pref: GitProtocol) -> Vec<String> {
    let url = url.trim().to_string();
    let Some(r) = parse(&url) else { return vec![url] };
    let alt = match r.family {
        Family::Ssh => Some(format!("https://{}/{}.git", r.host, r.path)),
        Family::Http if !r.explicit_port => Some(format!("git@{}:{}.git", r.host, r.path)),
        Family::Http => None,
    };
    let Some(alt) = alt else { return vec![url] };
    let alt_first = matches!((pref, &r.family), (GitProtocol::Ssh, Family::Http) | (GitProtocol::Https, Family::Ssh));
    if alt_first { vec![alt, url] } else { vec![url, alt] }
}

/// A failed git remote operation, classified from git's (C locale) stderr.
#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub reason: RepoAccessReason,
    pub detail: String,
}

/// Phrases (not bare words: stderr echoes the URL, e.g. `team/openssl`) that mean the host was never reached.
const NETWORK: &[&str] = &[
    "could not resolve",
    "connection refused",
    "connection timed out",
    "operation timed out",
    "network is unreachable",
    "no route to host",
    "failed to connect",
    "ssl certificate problem",
    "server certificate verification failed",
    "unable to get local issuer certificate",
    "ssl_connect",
    "tls connection",
];

/// The line that explains a failure: the remote's own message, else git's first fatal error, else the first line.
fn explain(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let pick = |prefix: &str| lines.iter().find_map(|l| l.strip_prefix(prefix)).map(str::trim);
    let line = pick("remote:").or_else(|| pick("fatal:")).or(lines.first().copied()).unwrap_or(t!("git 执行失败"));
    USERINFO.replace_all(line, "$1").into_owned()
}

fn classify(stderr: &str) -> Failure {
    let lower = stderr.to_lowercase();
    let detail = explain(stderr);
    let reason = if lower.contains("remote branch") && lower.contains("not found") {
        RepoAccessReason::BranchMissing
    } else if NETWORK.iter().any(|n| lower.contains(n)) {
        RepoAccessReason::Network
    } else {
        RepoAccessReason::Denied
    };
    let detail = match lower.contains("host key verification failed") {
        true => t!("Host key verification failed：先在这台机器上手动 ssh 一次该主机，确认 host key").into(),
        false => detail,
    };
    Failure { reason, detail }
}

/// ssh must fail instead of asking (host key, passphrase) on the daemon's tty; the user's own ssh command wins.
static BATCH_SSH: LazyLock<Option<&'static str>> = LazyLock::new(|| {
    let configured = std::process::Command::new("git").args(["config", "--get", "core.sshCommand"]).output();
    let configured = configured.is_ok_and(|o| o.status.success());
    (std::env::var_os("GIT_SSH_COMMAND").is_none() && !configured)
        .then_some("ssh -o BatchMode=yes -o ConnectTimeout=15")
});

/// Runs a git remote command non-interactively in the C locale, so failures classify the same on every machine.
/// `limit` None = no time limit (clones of big repos).
pub async fn remote_git(dir: &Path, args: &[&str], limit: Option<Duration>) -> Result<String, Failure> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args).env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C").kill_on_drop(true);
    if let Some(ssh) = *BATCH_SSH {
        cmd.env("GIT_SSH_COMMAND", ssh);
    }
    let out = match limit {
        None => cmd.output().await,
        Some(limit) => tokio::time::timeout(limit, cmd.output()).await.map_err(|_| Failure {
            reason: RepoAccessReason::Timeout,
            detail: t!("{s} 秒内无响应", s = limit.as_secs()),
        })?,
    };
    let out =
        out.map_err(|e| Failure { reason: RepoAccessReason::Denied, detail: t!("无法执行 git：{e}", e = e) })?;
    match out.status.success() {
        true => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
        false => Err(classify(&String::from_utf8_lossy(&out.stderr))),
    }
}

struct Listing {
    default_branch: Option<String>,
    branches: Vec<String>,
}

fn parse_listing(stdout: &str) -> Listing {
    let mut default_branch = None;
    let mut branches = vec![];
    for line in stdout.lines() {
        let Some((left, name)) = line.split_once('\t') else { continue };
        if name == "HEAD" {
            if let Some(target) = left.strip_prefix("ref: refs/heads/") {
                default_branch = Some(target.to_string());
            }
        } else if let Some(branch) = name.strip_prefix("refs/heads/") {
            branches.push(branch.to_string());
        }
    }
    branches.sort();
    Listing { default_branch, branches }
}

/// repo.probe: `git ls-remote` on each candidate until one answers; the first failure explains a total failure.
pub async fn probe(req: RepoProbe) -> RepoProbeResult {
    let mut result = RepoProbeResult {
        request_id: req.request_id,
        ok: false,
        reason: None,
        used_url: None,
        default_branch: None,
        branches: vec![],
        detail: None,
    };
    let mut first: Option<Failure> = None;
    let cwd = std::env::temp_dir();
    for url in candidates(&req.url, req.protocol) {
        let args = ["ls-remote", "--symref", "--", &url, "HEAD", "refs/heads/*"];
        match remote_git(&cwd, &args, Some(CANDIDATE_TIMEOUT)).await {
            Ok(stdout) => {
                let listing = parse_listing(&stdout);
                let has = listing.branches.contains(&req.branch);
                result.ok = has;
                result.reason = (!has).then_some(RepoAccessReason::BranchMissing);
                result.detail = (!has).then(|| t!("分支 {branch} 不存在", branch = req.branch));
                result.used_url = Some(url);
                result.default_branch = listing.default_branch;
                result.branches = listing.branches.into_iter().take(REPO_BRANCHES_MAX).collect();
                return result;
            }
            Err(f) => {
                first.get_or_insert(f);
            }
        }
    }
    let failure = first.expect("candidates is never empty");
    result.reason = Some(failure.reason);
    result.detail = Some(failure.detail);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        url: String,
        key: String,
    }

    #[test]
    fn keys_match_the_shared_cases() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/cases/repo-keys.json");
        let cases: Vec<Case> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for c in cases {
            assert_eq!(normalize_remote(&c.url), c.key, "{}", c.url);
        }
    }

    #[test]
    fn local_remotes_compare_by_real_path() {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        std::fs::create_dir(&bare).unwrap();
        let plain = bare.to_string_lossy().into_owned();
        assert_eq!(normalize_remote(&format!("file://{plain}")), normalize_remote(&plain));
        assert_eq!(normalize_remote(&format!("file://{plain}/")), normalize_remote(&plain));
        assert_ne!(normalize_remote(&plain), normalize_remote(&dir.path().to_string_lossy()));
    }

    #[test]
    fn candidates_put_the_preferred_protocol_first() {
        let ssh = "ssh://git@git.corp:2222/team/App.git";
        let https = "https://git.corp/team/App.git";
        let scp = "git@git.corp:team/App.git";
        let table: &[(&str, GitProtocol, &[&str])] = &[
            (ssh, GitProtocol::Auto, &[ssh, https]),
            (ssh, GitProtocol::Ssh, &[ssh, https]),
            (ssh, GitProtocol::Https, &[https, ssh]),
            (https, GitProtocol::Auto, &[https, scp]),
            (https, GitProtocol::Ssh, &[scp, https]),
            (https, GitProtocol::Https, &[https, scp]),
            ("https://git.corp:8443/team/App", GitProtocol::Ssh, &["https://git.corp:8443/team/App"]),
            ("file:///tmp/x.git", GitProtocol::Https, &["file:///tmp/x.git"]),
        ];
        for (url, pref, want) in table {
            assert_eq!(candidates(url, *pref), *want, "{url} {pref:?}");
        }
    }

    #[test]
    fn failures_classify_from_stderr() {
        let cases = [
            ("remote: Repository not found.\nfatal: repository 'https://x/y/' not found", RepoAccessReason::Denied),
            ("fatal: could not read Username for 'https://x': terminal prompts disabled", RepoAccessReason::Denied),
            ("ssh: Could not resolve hostname git.corp: nodename nor servname", RepoAccessReason::Network),
            ("fatal: unable to access 'https://x/': SSL certificate problem: self signed", RepoAccessReason::Network),
            (
                "remote: Repository not found.\nfatal: repository 'https://x/team/openssl/' not found",
                RepoAccessReason::Denied,
            ),
            (
                "warning: Could not find remote branch dev to clone.\nfatal: Remote branch dev not found in upstream origin",
                RepoAccessReason::BranchMissing,
            ),
        ];
        for (stderr, want) in cases {
            assert_eq!(classify(stderr).reason, want, "{stderr}");
        }
        let f = classify("fatal: unable to access 'https://oauth2:secret@x/y/': The requested URL returned error: 403");
        assert_eq!(f.reason, RepoAccessReason::Denied);
        assert_eq!(f.detail, "unable to access 'https://x/y/': The requested URL returned error: 403");
        let f = classify(
            "fatal: '/x.git' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\n\
             Please make sure you have the correct access rights\nand the repository exists.",
        );
        assert_eq!(f.detail, "'/x.git' does not appear to be a git repository");
        let f =
            classify("Warning: Permanently added 'x'\nremote: Repository not found.\nfatal: repository 'x' not found");
        assert_eq!(f.detail, "Repository not found.");
    }

    fn bare_repo() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        let sh = |args: &[&str], cwd: &Path| {
            assert!(std::process::Command::new("git").args(args).current_dir(cwd).status().unwrap().success());
        };
        std::fs::create_dir(&src).unwrap();
        sh(&["init", "-q", "-b", "main"], &src);
        sh(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "a"], &src);
        sh(&["branch", "feat/x"], &src);
        sh(&["clone", "-q", "--bare", "src", "remote.git"], dir.path());
        let url = format!("file://{}", dir.path().join("remote.git").display());
        (dir, url)
    }

    fn req(url: &str, branch: &str) -> RepoProbe {
        RepoProbe { request_id: "q".into(), url: url.into(), branch: branch.into(), protocol: GitProtocol::Auto }
    }

    #[tokio::test]
    async fn probe_lists_branches_and_the_default_branch() {
        let (_dir, url) = bare_repo();
        let r = probe(req(&url, "main")).await;
        assert!(r.ok, "{r:?}");
        assert_eq!(r.used_url.as_deref(), Some(&*url));
        assert_eq!(r.default_branch.as_deref(), Some("main"));
        assert_eq!(r.branches, ["feat/x", "main"]);
    }

    #[tokio::test]
    async fn probe_reports_a_missing_branch_and_an_unreadable_repo() {
        let (dir, url) = bare_repo();
        let r = probe(req(&url, "dev")).await;
        assert_eq!((r.ok, r.reason), (false, Some(RepoAccessReason::BranchMissing)));
        assert_eq!(r.branches, ["feat/x", "main"]);
        let gone = format!("file://{}", dir.path().join("nope.git").display());
        let r = probe(req(&gone, "main")).await;
        assert_eq!((r.ok, r.reason), (false, Some(RepoAccessReason::Denied)));
        assert!(r.detail.is_some());
    }
}
