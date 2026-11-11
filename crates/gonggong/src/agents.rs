use crate::adapters;
use crate::engine::ADAPTERS;
use crate::local::{LocalSettings, load_catalogs};
use crate::protocol::{AgentInfo, AgentKind};
use crate::t;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime};

/// Longer than any CLI needs to print its version, short enough that a hung one does not stall detection.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

pub fn binary(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        _ => &adapter(kind).spec.install.bin,
    }
}

/// The manifest adapter of an agent other than Claude and Codex.
fn adapter(kind: AgentKind) -> &'static adapters::Adapter {
    adapters::get(kind).expect("every agent but Claude and Codex has a manifest adapter")
}

/// Oldest CLI the pinned ACP adapter (engine::ADAPTERS) supports, or the manifest's; older ones get a warning on the
/// bot.
pub fn min_version(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "2.0.0",
        AgentKind::Codex => "0.160.1",
        _ => &adapter(kind).spec.install.min_version,
    }
}

/// Detects installed agent CLIs (the owner's configured paths, else PATH and common install dirs), with the catalog
/// probed for the same builds.
pub fn detect(home: &Path, local: &LocalSettings) -> Vec<AgentInfo> {
    let cached = load_catalogs(home);
    AgentKind::ALL
        .into_iter()
        .map(|kind| {
            let mut info = detect_one(home, kind, local);
            let key = catalog_key(kind, info.version.as_deref());
            info.catalog = cached.get(&kind).filter(|c| info.available && c.key == key).map(|c| c.catalog.clone());
            info
        })
        .collect()
}

/// The CLI and adapter builds a catalog is probed from, and the CLI's own user-level config: upgrading either build or
/// editing the config (a provider or model added to `~/.codex/config.toml`) may change what is offered.
pub fn catalog_key(kind: AgentKind, version: Option<&str>) -> String {
    let adapter = ADAPTERS
        .iter()
        .find(|(k, ..)| *k == kind)
        .map(|(.., v)| *v)
        .or_else(|| adapters::get(kind)?.adapter_version())
        .unwrap_or("");
    format!("{}+{adapter}+{}", version.unwrap_or("?"), file_digest(&cli_config(kind)))
}

/// A short digest of the file's content, empty when it cannot be read.
fn file_digest(path: &Path) -> String {
    std::fs::read(path)
        .map(|b| Sha256::digest(b).iter().take(6).map(|b| format!("{b:02x}")).collect())
        .unwrap_or_default()
}

/// The agent talks to its maker's own service, where its built-in reviewer works: the official login, without a base
/// URL in its env, the daemon's env or the CLI's user config (`config`: Claude's `settings.json` when the run loads
/// it, Codex's `config.toml`; None = absent). Claude `auto` through a gateway refuses every action it should check;
/// Codex's reviewer model fails on third-party providers.
pub fn official_service(kind: AgentKind, selection: &crate::providers::Selection, config: Option<&str>) -> bool {
    let crate::providers::Selection::Official(official) = selection else { return false };
    if !matches!(kind, AgentKind::Claude | AgentKind::Codex) {
        return false;
    }
    let base_url = |k: &str| k.ends_with("BASE_URL") || k == "CODEX_HOME" || k == "CLAUDE_CONFIG_DIR";
    if official.env.keys().any(|k| base_url(k)) || std::env::vars_os().any(|(k, _)| k.to_str().is_some_and(base_url)) {
        return false;
    }
    let Some(config) = config else { return true };
    match kind {
        AgentKind::Claude => {
            let Ok(settings) = serde_json::from_str::<serde_json::Value>(config) else { return false };
            settings["env"].as_object().is_none_or(|env| !env.keys().any(|k| base_url(k)))
        }
        AgentKind::Codex => {
            let Ok(doc) = toml::from_str::<toml::Table>(config) else { return false };
            let provider = doc.get("model_provider").and_then(|v| v.as_str());
            provider.is_none_or(|p| p == "openai")
                && !doc.contains_key("openai_base_url")
                && !doc.contains_key("base_url")
        }
        _ => false,
    }
}

/// [`official_service`] with the CLI's user config under `user_home`; Claude's only when the run loads it.
pub fn official_service_here(
    kind: AgentKind,
    selection: &crate::providers::Selection,
    user_home: &Path,
    loads_cli_config: bool,
) -> bool {
    let path = match kind {
        AgentKind::Claude if loads_cli_config => Some(user_home.join(".claude/settings.json")),
        AgentKind::Codex => Some(
            std::env::var_os("CODEX_HOME").map_or_else(|| user_home.join(".codex"), PathBuf::from).join("config.toml"),
        ),
        _ => None,
    };
    let config = path.and_then(|p| std::fs::read_to_string(p).ok());
    official_service(kind, selection, config.as_deref())
}

/// The user-level config file the CLI reads its providers and models from.
fn cli_config(kind: AgentKind) -> PathBuf {
    match kind {
        AgentKind::Claude => crate::config::user_home().join(".claude/settings.json"),
        AgentKind::Codex => std::env::var_os("CODEX_HOME")
            .map_or_else(|| crate::config::user_home().join(".codex"), PathBuf::from)
            .join("config.toml"),
        _ => {
            let a = adapter(kind);
            a.config_home(&crate::config::user_home(), &env_var).join(&a.spec.home.config)
        }
    }
}

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn detect_one(home: &Path, kind: AgentKind, local: &LocalSettings) -> AgentInfo {
    let path = locate(home, kind, local);
    let available = path.as_deref().is_some_and(Path::is_file);
    let tool = crate::tools::ToolKind::of(kind);
    AgentInfo {
        kind,
        available,
        version: path.as_deref().filter(|_| available).and_then(|p| version(home, p)),
        managed: path.as_deref().filter(|_| available).is_some_and(|p| crate::tools::is_managed(home, p)),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        min_version: Some(min_version(kind).into()),
        catalog: None,
        latest: crate::tools::cached_latest(home, tool),
    }
}

/// The agent CLI to run: the configured path (even if it no longer exists, so the error names it), else the
/// Gonggong-managed install, else a search.
pub fn locate(home: &Path, kind: AgentKind, local: &LocalSettings) -> Option<PathBuf> {
    let managed =
        || file_names(binary(kind)).into_iter().map(|n| crate::tools::tools_bin(home).join(n)).find(|p| p.is_file());
    local.agent(kind).path.map(PathBuf::from).or_else(managed).or_else(|| find(binary(kind)))
}

/// The Rust target the npm `@openai/codex` package names its native binary after (see its `bin/codex.js`).
fn codex_target() -> Option<(&'static str, &'static str)> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => ("aarch64-apple-darwin", "@openai/codex-darwin-arm64"),
        ("macos", "x86_64") => ("x86_64-apple-darwin", "@openai/codex-darwin-x64"),
        ("linux", "aarch64") => ("aarch64-unknown-linux-musl", "@openai/codex-linux-arm64"),
        ("linux", "x86_64") => ("x86_64-unknown-linux-musl", "@openai/codex-linux-x64"),
        ("windows", "aarch64") => ("aarch64-pc-windows-msvc", "@openai/codex-win32-arm64"),
        ("windows", "x86_64") => ("x86_64-pc-windows-msvc", "@openai/codex-win32-x64"),
        _ => return None,
    })
}

/// Why the Codex CLI at `cli` cannot start, if it cannot: the file is gone, or it is the npm package's launcher
/// whose native binary is missing (a broken or half-removed install fails later with a bare `spawn … ENOENT`).
pub fn codex_problem(cli: &Path) -> Option<String> {
    let Ok(real) = std::fs::canonicalize(cli) else {
        return Some(t!("找不到 Codex 命令 {path}", path = cli.display()));
    };
    if real.extension().is_none_or(|e| e != "js") {
        return None;
    }
    let (triple, platform) = codex_target()?;
    let pkg = real.parent()?.parent()?;
    let exe = if cfg!(windows) { "codex.exe" } else { "codex" };
    let vendors = pkg
        .ancestors()
        .flat_map(|a| {
            let nested = a.join("node_modules").join(platform);
            let sibling = (a.file_name() == Some("node_modules".as_ref())).then(|| a.join(platform));
            [Some(nested), sibling]
        })
        .flatten()
        .chain([pkg.to_path_buf()])
        .map(|p| p.join("vendor").join(triple));
    let found = vendors.flat_map(|v| [v.join("bin").join(exe), v.join("codex").join(exe)]).any(|p| p.is_file());
    (!found).then(|| t!("Codex 安装不完整：缺少本机程序（{target}）", target = triple))
}

/// The error a Codex session reports when its CLI cannot start, with how to fix the install.
pub fn codex_unusable(problem: &str) -> String {
    t!(
        "Codex 无法启动：{problem}。请重新安装：pnpm add -g @openai/codex（或 npm install -g @openai/codex），或在「设置 → Agent 工具」里改用共工托管安装",
        problem = problem
    )
}

/// The script of an agent CLI npm installed, to run on the Node the daemon picked: the file behind its link when it
/// is a node script (`.js`, or a `#!/usr/bin/env node` file), else `rel` in the `node_modules` beside it (Windows'
/// `.cmd` shim). `None`: a native binary, run as it is.
pub fn node_script(cli: &Path, rel: &str) -> Option<PathBuf> {
    use std::io::Read;
    let real = std::fs::canonicalize(cli).ok()?;
    let mut head = [0u8; 19];
    let shebang =
        std::fs::File::open(&real).and_then(|mut f| f.read_exact(&mut head)).is_ok() && &head == b"#!/usr/bin/env node";
    if shebang || real.extension().is_some_and(|e| e == "js" || e == "mjs") {
        return Some(real);
    }
    let beside = real.parent()?.join("node_modules").join(rel);
    beside.is_file().then_some(beside)
}

pub fn find(bin: &str) -> Option<PathBuf> {
    let names = file_names(bin);
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .chain(extra_dirs())
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

/// Windows can only run `.exe` files and (via cmd.exe) the `.cmd` shims npm installs; the extensionless file npm
/// puts next to them is a sh script.
pub(crate) fn file_names(bin: &str) -> Vec<String> {
    if cfg!(windows) { vec![format!("{bin}.exe"), format!("{bin}.cmd")] } else { vec![bin.into()] }
}

/// Common install dirs missing from the PATH of GUI apps and services.
fn extra_dirs() -> Vec<PathBuf> {
    let home = crate::config::user_home();
    let mut dirs = vec![home.join(".local/bin")];
    if cfg!(windows) {
        dirs.extend(std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("npm")));
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    dirs.push(home.join(".npm-global/bin"));
    dirs
}

#[cfg(unix)]
const PATH_MARK: &str = "__GONGGONG_PATH__";

/// PATH as the user's interactive login shell builds it (nvm, volta, asdf…). Apps opened from Finder/Dock only get
/// launchd's minimal PATH, so neither the agent CLIs nor the `node` their shebang needs would be found.
#[cfg(unix)]
pub fn login_shell_path() -> Option<String> {
    use std::process::Stdio;
    use std::time::Duration;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let script = format!("printf '{PATH_MARK}%s{PATH_MARK}' \"$PATH\"");
    let child = crate::proc::command(shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .ok()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || tx.send(child.wait_with_output()));
    // A broken rc file must not hang startup.
    let out = rx.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    marked_path(&String::from_utf8_lossy(&out.stdout))
}

/// The PATH between the markers, ignoring whatever the rc files print around it.
#[cfg(unix)]
fn marked_path(out: &str) -> Option<String> {
    let rest = &out[out.find(PATH_MARK)? + PATH_MARK.len()..];
    Some(rest[..rest.find(PATH_MARK)?].to_string()).filter(|p| !p.is_empty())
}

/// First semver-looking token of `<bin> --version`, e.g. "codex-cli 0.156.1" → "0.156.1". npm installs the CLIs as
/// node scripts, so the managed Node goes first on PATH. Detection runs every minute: the answer is reused until the
/// file (behind any symlink) changes.
fn version(home: &Path, path: &Path) -> Option<String> {
    type Key = (PathBuf, u64, Option<SystemTime>);
    static KNOWN: LazyLock<Mutex<HashMap<PathBuf, (Key, String)>>> = LazyLock::new(Mutex::default);
    let real = std::fs::canonicalize(path).ok()?;
    let meta = std::fs::metadata(&real).ok()?;
    let key = (real, meta.len(), meta.modified().ok());
    if let Some((known, v)) = KNOWN.lock().unwrap().get(path)
        && *known == key
    {
        return Some(v.clone());
    }
    let mut cmd = crate::proc::command(path);
    if let Some(bin) = crate::tools::runtime_bin(home) {
        cmd.env("PATH", crate::tools::prepend_path(&bin));
    }
    let v = parse_version(&crate::proc::stdout_within(cmd.arg("--version"), VERSION_TIMEOUT)?)?;
    KNOWN.lock().unwrap().insert(path.to_path_buf(), (key, v.clone()));
    Some(v)
}

/// 登录 state as the agent CLI reports it (`claude auth status`, `codex login status`) or, for the others, as their
/// manifest's checks find it; `None` if it cannot tell.
pub fn login_status(kind: AgentKind, cli: &Path) -> Option<String> {
    let args = match kind {
        AgentKind::Claude => ["auth", "status"],
        AgentKind::Codex => ["login", "status"],
        _ => return adapter(kind).login_status(&crate::config::user_home(), &env_var),
    };
    let out = crate::proc::command(cli).args(args).output().ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    login_label(kind, &text)
}

pub fn login_label(kind: AgentKind, out: &str) -> Option<String> {
    match kind {
        AgentKind::Claude => {
            let v: serde_json::Value = serde_json::from_str(out.trim()).ok()?;
            if !v["loggedIn"].as_bool()? {
                return Some(crate::t!("未登录").into());
            }
            let how = match v["subscriptionType"].as_str() {
                Some(plan) => {
                    let mut c = plan.chars();
                    format!(
                        "Claude {}",
                        c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default()
                    )
                }
                None => v["authMethod"].as_str().unwrap_or(crate::t!("未知方式")).to_string(),
            };
            Some(crate::t!("已登录 · {how}", how = how))
        }
        AgentKind::Codex => {
            let line = out.lines().map(str::trim).find(|l| !l.is_empty())?;
            if line.starts_with("Not logged in") {
                return Some(crate::t!("未登录").into());
            }
            let how = line.strip_prefix("Logged in using ")?;
            Some(crate::t!("已登录 · {how}", how = how.trim_start_matches("an ").trim_start_matches("a ")))
        }
        _ => None,
    }
}

pub fn parse_version(s: &str) -> Option<String> {
    s.split_whitespace()
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_digit() && c != '.').to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn built_in_review_needs_the_official_service() {
        use crate::protocol::AgentKind::{Claude, Codex, Gemini};
        use crate::providers::{Official, Provider, Selection};
        let official = Selection::Official(Official::default());
        let works = |kind, config: Option<&str>| super::official_service(kind, &official, config);
        assert!(works(Codex, None));
        assert!(works(Codex, Some("model = \"gpt-5\"\nmodel_provider = \"openai\"\n")));
        assert!(!works(Codex, Some("openai_base_url = \"http://127.0.0.1:3425/v1\"\n")));
        assert!(!works(Codex, Some("model_provider = \"custom\"\n[model_providers.custom]\n")));
        assert!(!works(Codex, Some("not toml [")));
        assert!(works(Claude, Some(r#"{"model":"opus","env":{"HTTPS_PROXY":"http://p"}}"#)));
        assert!(!works(Claude, Some(r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.kimi.com/coding/"}}"#)));
        assert!(!works(Gemini, None));
        let mut env = Official::default();
        env.env.insert("ANTHROPIC_BASE_URL".into(), "https://relay.test".into());
        assert!(!super::official_service(Claude, &Selection::Official(env), None));
        let relay = Provider::custom(Codex, "relay".into(), "https://relay.test/v1".into(), "k".into());
        assert!(!super::official_service(Codex, &Selection::Provider(Box::new(relay)), None));
    }

    use super::{file_names, parse_version};

    #[test]
    fn codex_without_its_native_binary_is_reported_before_starting() {
        use super::{codex_problem, codex_target};
        let Some((triple, platform)) = codex_target() else { return };
        let dir = tempfile::tempdir().unwrap();
        let modules = dir.path().join("node_modules");
        let pkg = modules.join("@openai/codex");
        std::fs::create_dir_all(pkg.join("bin")).unwrap();
        let cli = pkg.join("bin/codex.js");
        std::fs::write(&cli, "").unwrap();
        assert!(codex_problem(&dir.path().join("gone")).unwrap().contains("gone"));
        assert!(codex_problem(&cli).unwrap().contains(triple));

        let exe = if cfg!(windows) { "codex.exe" } else { "codex" };
        let native = modules.join(platform).join("vendor").join(triple).join("bin");
        std::fs::create_dir_all(&native).unwrap();
        std::fs::write(native.join(exe), "").unwrap();
        assert_eq!(codex_problem(&cli), None, "the platform package next to it");
        std::fs::remove_dir_all(modules.join(platform)).unwrap();

        // npm installs it nested in the package.
        let nested = pkg.join("node_modules").join(platform).join("vendor").join(triple).join("bin");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join(exe), "").unwrap();
        assert_eq!(codex_problem(&cli), None, "nested");
        std::fs::remove_dir_all(pkg.join("node_modules")).unwrap();

        // Older releases keep it in the package itself.
        let old = pkg.join("vendor").join(triple).join("codex");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join(exe), "").unwrap();
        assert_eq!(codex_problem(&cli), None);
    }

    #[cfg(unix)]
    #[test]
    fn extracts_the_path_from_noisy_shell_output() {
        use super::marked_path;
        let out = "Welcome!\n__GONGGONG_PATH__/a/bin:/usr/bin__GONGGONG_PATH__\nbye";
        assert_eq!(marked_path(out).as_deref(), Some("/a/bin:/usr/bin"));
        assert_eq!(marked_path("__GONGGONG_PATH____GONGGONG_PATH__"), None);
        assert_eq!(marked_path("no marker"), None);
    }

    #[test]
    fn labels_the_login_state() {
        use super::login_label;
        use crate::protocol::AgentKind::{Claude, Codex};
        let max = r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}"#;
        assert_eq!(login_label(Claude, max).as_deref(), Some("已登录 · Claude Max"));
        let key = r#"{"loggedIn":true,"authMethod":"api_key"}"#;
        assert_eq!(login_label(Claude, key).as_deref(), Some("已登录 · api_key"));
        assert_eq!(login_label(Claude, r#"{"loggedIn":false}"#).as_deref(), Some("未登录"));
        assert_eq!(login_label(Claude, "command not found"), None);
        assert_eq!(login_label(Codex, "Logged in using ChatGPT\n").as_deref(), Some("已登录 · ChatGPT"));
        assert_eq!(
            login_label(Codex, "Logged in using an API key - sk-***").as_deref(),
            Some("已登录 · API key - sk-***")
        );
        assert_eq!(login_label(Codex, "Not logged in\n").as_deref(), Some("未登录"));
        assert_eq!(login_label(Codex, "error: unknown"), None);
    }

    #[cfg(unix)]
    #[test]
    fn runs_an_npm_script_on_our_node_and_a_native_binary_as_it_is() {
        use super::node_script;
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir.path().join("lib/node_modules/@tencent-ai/codebuddy-code/bin");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("codebuddy"), "#!/usr/bin/env node\nrequire('x')\n").unwrap();
        std::fs::create_dir_all(dir.path().join("bin")).unwrap();
        let shim = dir.path().join("bin/codebuddy");
        std::os::unix::fs::symlink(pkg.join("codebuddy"), &shim).unwrap();
        let rel = "@tencent-ai/codebuddy-code/bin/codebuddy";
        assert_eq!(node_script(&shim, rel), Some(pkg.join("codebuddy").canonicalize().unwrap()));
        let bundle = dir.path().join("gemini.js");
        std::fs::write(&bundle, "").unwrap();
        assert_eq!(node_script(&bundle, rel), Some(bundle.canonicalize().unwrap()));
        let native = dir.path().join("bin/other");
        std::fs::write(&native, "\x7fELF").unwrap();
        assert_eq!(node_script(&native, rel), None);
        std::fs::create_dir_all(dir.path().join("bin/node_modules/@tencent-ai/codebuddy-code/bin")).unwrap();
        std::fs::write(dir.path().join("bin/node_modules").join(rel), "").unwrap();
        let beside = dir.path().canonicalize().unwrap().join("bin/node_modules").join(rel);
        assert_eq!(node_script(&native, rel), Some(beside), "a .cmd shim's");
    }

    #[test]
    fn parses_cli_version_lines() {
        assert_eq!(parse_version("2.1.280 (Claude Code)"), Some("2.1.280".into()));
        assert_eq!(parse_version("codex-cli 0.156.1"), Some("0.156.1".into()));
        assert_eq!(parse_version("no version here"), None);
    }

    #[cfg(unix)]
    #[test]
    fn detection_carries_the_catalog_probed_for_the_same_builds() {
        use super::{catalog_key, detect};
        use crate::local::{AgentSettings, CachedCatalog, LocalSettings, save_catalog};
        use crate::protocol::{AgentCatalog, AgentKind};
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let cli = home.path().join("claude");
        std::fs::write(&cli, "#!/bin/sh\necho '2.1.4 (Claude Code)'\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut local = LocalSettings::default();
        local.agents.insert(AgentKind::Claude, AgentSettings { path: Some(cli.to_string_lossy().into()) });
        let catalog = AgentCatalog { current: Some("opus".into()), ..Default::default() };
        let claude = |home| detect(home, &local).into_iter().find(|a| a.kind == AgentKind::Claude).unwrap();

        assert_eq!(claude(home.path()).catalog, None);
        let stale = CachedCatalog { key: catalog_key(AgentKind::Claude, Some("2.0.0")), catalog: catalog.clone() };
        save_catalog(home.path(), AgentKind::Claude, stale).unwrap();
        assert_eq!(claude(home.path()).catalog, None);
        let fresh = CachedCatalog { key: catalog_key(AgentKind::Claude, Some("2.1.4")), catalog: catalog.clone() };
        save_catalog(home.path(), AgentKind::Claude, fresh).unwrap();
        assert_eq!(claude(home.path()).catalog, Some(catalog));
    }

    #[test]
    fn editing_the_cli_config_changes_the_catalog_key() {
        use super::file_digest;
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.toml");
        assert_eq!(file_digest(&config), "");
        std::fs::write(&config, "model = \"a\"\n").unwrap();
        let before = file_digest(&config);
        std::fs::write(&config, "model = \"a\"\n[model_providers.b]\n").unwrap();
        assert_ne!(file_digest(&config), before);
        assert_eq!(before.len(), 12);
    }

    #[cfg(unix)]
    #[test]
    fn the_cli_version_is_asked_again_only_when_its_file_changes() {
        use super::detect;
        use crate::local::{AgentSettings, LocalSettings};
        use crate::protocol::AgentKind;
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let (cli, calls) = (home.path().join("claude"), home.path().join("calls"));
        std::fs::write(&cli, format!("#!/bin/sh\necho x >> '{}'\necho '2.1.4 (Claude Code)'\n", calls.display()))
            .unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut local = LocalSettings::default();
        local.agents.insert(AgentKind::Claude, AgentSettings { path: Some(cli.to_string_lossy().into()) });
        let version = || detect(home.path(), &local).into_iter().find(|a| a.kind == AgentKind::Claude).unwrap().version;
        let count = || std::fs::read_to_string(&calls).unwrap().lines().count();

        assert_eq!(version().as_deref(), Some("2.1.4"));
        assert_eq!(version().as_deref(), Some("2.1.4"));
        assert_eq!(count(), 1);
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        std::fs::File::options().write(true).open(&cli).unwrap().set_modified(later).unwrap();
        assert_eq!(version().as_deref(), Some("2.1.4"));
        assert_eq!(count(), 2, "an upgrade changes the file");
    }

    #[test]
    fn prefers_the_configured_path_then_the_managed_install_then_the_search() {
        use super::locate;
        use crate::local::{AgentSettings, LocalSettings};
        use crate::protocol::AgentKind;
        let home = tempfile::tempdir().unwrap();
        let bin = crate::tools::tools_bin(home.path());
        std::fs::create_dir_all(&bin).unwrap();
        for name in file_names("codex") {
            std::fs::write(bin.join(name), "").unwrap();
        }
        let managed = bin.join(&file_names("codex")[0]);
        let mut local = LocalSettings::default();
        assert_eq!(locate(home.path(), AgentKind::Codex, &local), Some(managed));
        let manual = std::env::current_exe().unwrap();
        local.agents.insert(AgentKind::Codex, AgentSettings { path: Some(manual.to_string_lossy().into()) });
        assert_eq!(locate(home.path(), AgentKind::Codex, &local), Some(manual));
    }

    #[test]
    fn windows_runs_exe_or_npm_cmd_shims_never_the_extensionless_sh_script() {
        let want: Vec<String> =
            if cfg!(windows) { vec!["node.exe".into(), "node.cmd".into()] } else { vec!["node".into()] };
        assert_eq!(file_names("node"), want);
    }
}
