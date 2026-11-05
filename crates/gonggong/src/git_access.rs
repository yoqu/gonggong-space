//! The machine's git access driven from the web (`gitaccess.cmd`): ssh keys in `~/.ssh`, HTTPS tokens git reads
//! through a per-host `store` credential helper, access tests and ssh host keys. Tokens only ever arrive; the private
//! key and the tokens never leave the machine.
use crate::protocol::{GitAccessAction, GitAccessCmd, GitAccessTest, GitAccessView, GitTokenView, HostKey, SshKeyView};
use crate::t;
use anyhow::{Context, Result, bail};
use regex::Regex;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const TEST_TIMEOUT: Duration = Duration::from_secs(30);
const KEYSCAN_TIMEOUT: &str = "10";
const KEY_NAME: &str = "id_ed25519";
/// A token serves a host's plain-http remotes too (self-hosted GitLab often has `http://` clone URLs): git looks
/// credentials up by protocol.
const SCHEMES: [&str; 2] = ["https", "http"];

static HOST: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9.-]+(:\d+)?$").unwrap());

pub struct GitAccess {
    /// 共工's home: the token store lives here.
    home: PathBuf,
    /// Whose `~/.ssh` and global git config are used.
    user_home: PathBuf,
}

/// What a command produced: the view after it, and the test result for `test`.
pub struct Outcome {
    pub view: GitAccessView,
    pub test: Option<GitAccessTest>,
}

impl GitAccess {
    pub fn new(home: PathBuf, user_home: PathBuf) -> Self {
        GitAccess { home, user_home }
    }

    pub async fn run(&self, cmd: GitAccessCmd) -> Result<Outcome> {
        let host = || cmd.host.as_deref().map(str::trim).filter(|h| HOST.is_match(h)).context(t!("主机名无效"));
        let test = match cmd.action {
            GitAccessAction::Status => None,
            GitAccessAction::GenKey => {
                self.gen_key().await?;
                None
            }
            GitAccessAction::SaveToken => {
                let token = cmd.token.as_ref().context(t!("缺少令牌"))?;
                self.save_token(&token.host, &token.username, &token.secret).await?;
                None
            }
            GitAccessAction::RemoveToken => {
                self.remove_token(host()?).await?;
                None
            }
            GitAccessAction::Test => {
                let url = cmd.url.as_deref().map(str::trim).filter(|u| !u.is_empty() && !u.starts_with('-'));
                let url = url.context(t!("仓库地址无效"))?;
                Some(self.test(url).await)
            }
            GitAccessAction::TrustHost => {
                self.trust_host(host()?).await?;
                None
            }
        };
        Ok(Outcome { view: self.view().await, test })
    }

    fn ssh_dir(&self) -> PathBuf {
        self.user_home.join(".ssh")
    }

    fn token_file(&self) -> PathBuf {
        self.home.join("git-credentials")
    }

    pub async fn view(&self) -> GitAccessView {
        GitAccessView {
            ssh_keys: self.ssh_keys().await,
            tokens: token_views(&read_tokens(&self.token_file())),
            helper: self.global_helper().await,
            known_hosts: known_hosts(&std::fs::read_to_string(self.ssh_dir().join("known_hosts")).unwrap_or_default()),
        }
    }

    async fn ssh_keys(&self) -> Vec<SshKeyView> {
        let Ok(dir) = std::fs::read_dir(self.ssh_dir()) else { return vec![] };
        let mut paths: Vec<PathBuf> = dir
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "pub"))
            .collect();
        paths.sort();
        let mut keys = vec![];
        for path in paths {
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let Some(line) = text.lines().map(str::trim).find(|l| !l.is_empty()) else { continue };
            let mut parts = line.splitn(3, ' ');
            let (Some(kind), Some(_)) = (parts.next(), parts.next()) else { continue };
            let comment = parts.next().map(str::trim).filter(|c| !c.is_empty()).map(String::from);
            let fingerprint =
                ssh_keygen(&["-lf"], &path).await.and_then(|o| o.split_whitespace().nth(1).map(String::from));
            keys.push(SshKeyView {
                path: path.display().to_string(),
                kind: kind.to_string(),
                fingerprint: fingerprint.unwrap_or_default(),
                public_key: line.to_string(),
                comment,
            });
        }
        keys
    }

    /// The global `credential.helper` the machine already had; the per-host ones 共工 adds are separate keys.
    async fn global_helper(&self) -> Option<String> {
        let out = self.git_config(&["--get-all", "credential.helper"]).await.ok()?;
        let helpers: Vec<&str> = out.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        (!helpers.is_empty()).then(|| helpers.join(", "))
    }

    async fn git_config(&self, args: &[&str]) -> Result<String> {
        let out = crate::proc::async_command("git")
            .args(["config", "--global"])
            .args(args)
            .env("HOME", &self.user_home)
            .env_remove("XDG_CONFIG_HOME")
            .env_remove("GIT_CONFIG_GLOBAL")
            .output()
            .await
            .context(t!("无法执行 git"))?;
        // 1 = the key is not set, for reads and unsets alike.
        match out.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&out.stdout).into_owned()),
            Some(1) | Some(5) => Ok(String::new()),
            _ => bail!("git config: {}", String::from_utf8_lossy(&out.stderr).trim()),
        }
    }

    async fn gen_key(&self) -> Result<()> {
        let dir = self.ssh_dir();
        let key = dir.join(KEY_NAME);
        if key.exists() || key.with_extension("pub").exists() {
            bail!(t!("已有 SSH 密钥 {path}，不会覆盖", path = key.display()));
        }
        std::fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let comment = format!("gonggong@{}", gethostname::gethostname().to_string_lossy());
        let out = crate::proc::async_command("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", "", "-C", &comment, "-f"])
            .arg(&key)
            .stdin(Stdio::null())
            .output()
            .await
            .context(t!("无法执行 ssh-keygen，请先安装 OpenSSH"))?;
        if !out.status.success() {
            bail!("ssh-keygen: {}", String::from_utf8_lossy(&out.stderr).trim());
        }
        Ok(())
    }

    async fn save_token(&self, host: &str, username: &str, secret: &str) -> Result<()> {
        let (host, username, secret) = (host.trim(), username.trim(), secret.trim());
        if !HOST.is_match(host) {
            bail!(t!("主机名无效"));
        }
        if username.is_empty() || secret.is_empty() {
            bail!(t!("用户名和令牌不能为空"));
        }
        let file = self.token_file();
        let mut lines: Vec<String> =
            read_tokens(&file).into_iter().filter(|l| !l.host.eq_ignore_ascii_case(host)).map(|l| l.raw).collect();
        for scheme in SCHEMES {
            lines.push(format!("{scheme}://{}:{}@{host}", percent_encode(username), percent_encode(secret)));
        }
        write_private(&file, &lines)?;
        // Git runs the helper through sh, also on Windows: forward slashes survive its quoting.
        let helper = format!("store --file \"{}\"", file.display().to_string().replace('\\', "/"));
        for scheme in SCHEMES {
            self.git_config(&["--replace-all", &helper_key(scheme, host), &helper]).await?;
        }
        Ok(())
    }

    async fn remove_token(&self, host: &str) -> Result<()> {
        let file = self.token_file();
        let lines: Vec<String> =
            read_tokens(&file).into_iter().filter(|l| !l.host.eq_ignore_ascii_case(host)).map(|l| l.raw).collect();
        write_private(&file, &lines)?;
        for scheme in SCHEMES {
            self.git_config(&["--unset-all", &helper_key(scheme, host)]).await?;
        }
        Ok(())
    }

    async fn test(&self, url: &str) -> GitAccessTest {
        let home = self.user_home.to_string_lossy();
        let args = ["ls-remote", "--heads", url];
        let out = crate::repo::remote_output_with(&self.user_home, &args, &[("HOME", &home)], Some(TEST_TIMEOUT)).await;
        let failure = match out {
            Ok(out) if out.status.success() => None,
            Ok(out) => Some((crate::repo::classify(&String::from_utf8_lossy(&out.stderr)), out.stderr)),
            Err(f) => Some((f, vec![])),
        };
        let url = crate::repo::redact(url);
        let Some((failure, stderr)) = failure else {
            return GitAccessTest { url, ok: true, reason: None, detail: None, host_key: None };
        };
        let unknown_host = String::from_utf8_lossy(&stderr).to_lowercase().contains("host key verification failed");
        let host_key = match unknown_host.then(|| crate::repo::ssh_host(&url)).flatten() {
            Some(host) => Some(HostKey { fingerprints: keyscan_fingerprints(&host).await, host }),
            None => None,
        };
        GitAccessTest { url, ok: false, reason: Some(failure.reason), detail: Some(failure.detail), host_key }
    }

    async fn trust_host(&self, host: &str) -> Result<()> {
        let keys = keyscan(host).await;
        if keys.is_empty() {
            bail!(t!("无法获取 {host} 的主机密钥", host = host));
        }
        let dir = self.ssh_dir();
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("known_hosts");
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let new: Vec<&str> = keys.lines().filter(|l| !existing.lines().any(|e| e.trim() == l.trim())).collect();
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        if !existing.is_empty() && !existing.ends_with('\n') {
            writeln!(file)?;
        }
        for line in new {
            writeln!(file, "{line}")?;
        }
        Ok(())
    }
}

fn helper_key(scheme: &str, host: &str) -> String {
    format!("credential.{scheme}://{host}.helper")
}

struct TokenLine {
    raw: String,
    host: String,
    username: String,
    secret: String,
}

impl TokenLine {
    fn view(&self) -> GitTokenView {
        let shown: String = self.secret.chars().take(4).collect();
        GitTokenView { host: self.host.clone(), username: self.username.clone(), masked: format!("{shown}…") }
    }
}

/// One per host: the same token is stored for each of [`SCHEMES`].
fn token_views(lines: &[TokenLine]) -> Vec<GitTokenView> {
    let mut views: Vec<GitTokenView> = vec![];
    for line in lines {
        if !views.iter().any(|v| v.host.eq_ignore_ascii_case(&line.host)) {
            views.push(line.view());
        }
    }
    views
}

fn read_tokens(file: &Path) -> Vec<TokenLine> {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    text.lines()
        .filter_map(|line| {
            let url = url::Url::parse(line.trim()).ok()?;
            let host = match url.port() {
                Some(p) => format!("{}:{p}", url.host_str()?),
                None => url.host_str()?.to_string(),
            };
            Some(TokenLine {
                raw: line.trim().to_string(),
                host,
                username: percent_decode(url.username())?,
                secret: percent_decode(url.password()?)?,
            })
        })
        .collect()
}

/// Everything but unreserved characters, as git's credential store reads it back.
fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Owner-only from the first byte, replaced atomically.
fn write_private(path: &Path, lines: &[String]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let written = (|| {
        let mut file = options.open(&tmp)?;
        for line in lines {
            writeln!(file, "{line}")?;
        }
        file.sync_all()?;
        std::fs::rename(&tmp, path)?;
        anyhow::Ok(())
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// Plain host names of a known_hosts file, in order; hashed entries cannot be read back.
fn known_hosts(text: &str) -> Vec<String> {
    let mut hosts: Vec<String> = vec![];
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with('|') || line.starts_with('@') {
            continue;
        }
        let Some(names) = line.split_whitespace().next() else { continue };
        for name in names.split(',') {
            if !hosts.iter().any(|h| h == name) {
                hosts.push(name.to_string());
            }
        }
    }
    hosts
}

async fn ssh_keygen(args: &[&str], path: &Path) -> Option<String> {
    let out = crate::proc::async_command("ssh-keygen").args(args).arg(path).stdin(Stdio::null()).output().await.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `ssh-keyscan` of `host` (`host:port` too): known_hosts lines, empty when unreachable.
async fn keyscan(host: &str) -> String {
    let mut cmd = crate::proc::async_command("ssh-keyscan");
    cmd.args(["-T", KEYSCAN_TIMEOUT]);
    let name = match host.rsplit_once(':') {
        Some((name, port)) => {
            cmd.args(["-p", port]);
            name
        }
        None => host,
    };
    let out = cmd.arg(name).stdin(Stdio::null()).stderr(Stdio::null()).output().await;
    out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// `ED25519 SHA256:…` per key of `host`, what the user compares with the host's published fingerprints.
async fn keyscan_fingerprints(host: &str) -> Vec<String> {
    let keys = keyscan(host).await;
    if keys.is_empty() {
        return vec![];
    }
    let child = crate::proc::async_command("ssh-keygen")
        .args(["-lf", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return vec![] };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(keys.as_bytes()).await;
    }
    let Ok(out) = child.wait_with_output().await else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            let kind = parts.last()?.trim_matches(|c| c == '(' || c == ')');
            Some(format!("{kind} {}", parts.get(1)?))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{GitTokenInput, RepoAccessReason};

    fn cmd(action: GitAccessAction) -> GitAccessCmd {
        GitAccessCmd { request_id: "r".into(), action, token: None, host: None, url: None }
    }

    fn token(host: &str, username: &str, secret: &str) -> GitAccessCmd {
        let token = GitTokenInput { host: host.into(), username: username.into(), secret: secret.into() };
        GitAccessCmd { token: Some(token), ..cmd(GitAccessAction::SaveToken) }
    }

    fn setup() -> (tempfile::TempDir, GitAccess) {
        let dir = tempfile::tempdir().unwrap();
        let access = GitAccess::new(dir.path().join(".gonggong"), dir.path().into());
        (dir, access)
    }

    /// What git itself answers for `host` with this home's global config.
    fn credential_fill(home: &Path, host: &str) -> String {
        credential_fill_with(home, "https", host)
    }

    fn credential_fill_with(home: &Path, protocol: &str, host: &str) -> String {
        let mut child = std::process::Command::new("git")
            .args(["credential", "fill"])
            .env("HOME", home)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env_remove("XDG_CONFIG_HOME")
            .env_remove("GIT_CONFIG_GLOBAL")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(format!("protocol={protocol}\nhost={host}\n\n").as_bytes()).unwrap();
        String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap()
    }

    #[tokio::test]
    async fn generates_an_ed25519_key_once_and_never_overwrites_it() {
        let (dir, access) = setup();
        let first = access.run(cmd(GitAccessAction::GenKey)).await.unwrap().view;
        assert_eq!(first.ssh_keys.len(), 1);
        let key = &first.ssh_keys[0];
        assert_eq!(key.kind, "ssh-ed25519");
        assert!(key.fingerprint.starts_with("SHA256:"), "{key:?}");
        assert!(key.comment.as_deref().unwrap().starts_with("gonggong@"));
        assert!(key.public_key.starts_with("ssh-ed25519 "));
        let private = dir.path().join(".ssh/id_ed25519");
        let before = std::fs::read(&private).unwrap();

        let again = access.run(cmd(GitAccessAction::GenKey)).await.err().unwrap();
        assert!(format!("{again:#}").contains("不会覆盖"));
        assert_eq!(std::fs::read(&private).unwrap(), before);
    }

    #[tokio::test]
    async fn a_saved_token_is_what_git_answers_for_its_host_and_leaves_masked() {
        let (dir, access) = setup();
        let view = access.run(token("gitlab.example.com", "wang lei", "glpat-s3cr/et@+%")).await.unwrap().view;
        assert_eq!(
            view.tokens,
            vec![GitTokenView {
                host: "gitlab.example.com".into(),
                username: "wang lei".into(),
                masked: "glpa…".into()
            }]
        );
        let filled = credential_fill(dir.path(), "gitlab.example.com");
        assert!(filled.contains("username=wang lei"), "{filled}");
        assert!(filled.contains("password=glpat-s3cr/et@+%"), "{filled}");
        assert!(!credential_fill(dir.path(), "github.com").contains("password="));
        // Self-hosted GitLab often clones over plain http: the same token answers there.
        let http = credential_fill_with(dir.path(), "http", "gitlab.example.com");
        assert!(http.contains("password=glpat-s3cr/et@+%"), "{http}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(".gonggong/git-credentials")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        let replaced = access.run(token("gitlab.example.com", "wanglei", "new-token")).await.unwrap().view;
        assert_eq!(replaced.tokens.len(), 1);
        assert!(credential_fill(dir.path(), "gitlab.example.com").contains("password=new-token"));
        assert!(credential_fill_with(dir.path(), "http", "gitlab.example.com").contains("password=new-token"));

        let removed = access
            .run(GitAccessCmd { host: Some("gitlab.example.com".into()), ..cmd(GitAccessAction::RemoveToken) })
            .await
            .unwrap()
            .view;
        assert!(removed.tokens.is_empty());
        assert!(!credential_fill(dir.path(), "gitlab.example.com").contains("password="));
        assert!(!credential_fill_with(dir.path(), "http", "gitlab.example.com").contains("password="));
        let config = std::fs::read_to_string(dir.path().join(".gitconfig")).unwrap();
        assert!(!config.contains("gitlab.example.com"), "{config}");
    }

    #[tokio::test]
    async fn keeps_the_machines_own_helper_and_reports_it() {
        let (dir, access) = setup();
        std::fs::write(dir.path().join(".gitconfig"), "[credential]\n\thelper = osxkeychain\n").unwrap();
        let view = access.run(token("github.com", "x", "ghp_token")).await.unwrap().view;
        assert_eq!(view.helper.as_deref(), Some("osxkeychain"));
        let config = std::fs::read_to_string(dir.path().join(".gitconfig")).unwrap();
        assert!(config.contains("helper = osxkeychain"), "{config}");
    }

    #[tokio::test]
    async fn rejects_a_bad_host() {
        let (_dir, access) = setup();
        let err = access.run(token("evil.com/x?", "u", "t")).await.err().unwrap();
        assert!(format!("{err:#}").contains("主机名无效"));
    }

    #[tokio::test]
    async fn tests_access_to_a_url() {
        let (dir, access) = setup();
        let repo = dir.path().join("repo");
        std::process::Command::new("git").args(["init", "-q"]).arg(&repo).status().unwrap();
        let test = |url: String| GitAccessCmd { url: Some(url), ..cmd(GitAccessAction::Test) };

        let ok = access.run(test(repo.display().to_string())).await.unwrap().test.unwrap();
        assert!(ok.ok, "{ok:?}");

        let bad = access.run(test(dir.path().join("missing").display().to_string())).await.unwrap().test.unwrap();
        assert!(!bad.ok);
        assert_eq!(bad.reason, Some(RepoAccessReason::Denied));
        assert!(bad.detail.is_some());
    }

    #[test]
    fn lists_plain_known_hosts() {
        let text = "github.com,140.82.112.3 ssh-ed25519 AAAA\n|1|hash= ssh-rsa AAAA\n[git.corp]:2222 ssh-rsa A\n\n";
        assert_eq!(known_hosts(text), vec!["github.com", "140.82.112.3", "[git.corp]:2222"]);
    }
}
