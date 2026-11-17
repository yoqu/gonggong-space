use crate::adapters;
use crate::engine::ADAPTERS;
use crate::local::{LocalSettings, load_catalogs, load_profile_catalogs};
use crate::protocol::{AgentCatalog, AgentKind, AgentState};
use crate::providers::{Endpoint, Selection, Store};
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
pub fn detect(home: &Path, local: &LocalSettings) -> Vec<AgentState> {
    let cached = load_catalogs(home);
    AgentKind::ALL
        .into_iter()
        .map(|kind| {
            let mut info = detect_one(home, kind, local);
            let key = catalog_key(kind, info.version.as_deref());
            info.catalog = cached.get(&kind).filter(|c| info.available && c.key == key).map(|c| c.catalog.clone());
            if info.available && info.catalog.is_none() && kind == AgentKind::Claude {
                info.catalog = fallback_profile_catalog(home, &info);
            }
            info
        })
        .collect()
}

/// When `~/.claude` has no probed catalog (e.g. only a local Claude profile directory is logged in), fall back to the
/// machine default profile's probed catalog, else the first probed profile's.
fn fallback_profile_catalog(home: &Path, claude: &AgentState) -> Option<AgentCatalog> {
    let store = Store::load(home).ok()?;
    let default = store.machine_default(AgentKind::Claude).ok();
    let default_ep = default.as_ref().and_then(|s| s.provider()).map(|(_, e)| e);
    default_ep
        .into_iter()
        .chain(store.providers.iter().flat_map(|p| p.endpoint_for(AgentKind::Claude)))
        .find_map(|e| profile_catalog(home, e, Some(claude)))
}

/// A probed catalog worth caching: an agent logged out or offline (agy) offers no models, and caching that would hide
/// them until its next upgrade.
pub fn offered(kind: AgentKind, catalog: AgentCatalog) -> anyhow::Result<AgentCatalog> {
    match catalog.models.is_empty() {
        true => {
            anyhow::bail!(t!("{kind} 没有报告可选模型，可能未登录或连不上服务", kind = crate::bots::agent_label(kind)))
        }
        false => Ok(catalog),
    }
}

/// The CLI and adapter builds a catalog is probed from, and the CLI's own user-level config: upgrading either build or
/// editing the config (a provider or model added to `~/.codex/config.toml`) may change what is offered.
pub fn catalog_key(kind: AgentKind, version: Option<&str>) -> String {
    format!("{}+{}+{}", version.unwrap_or("?"), adapter_version(kind), file_digest(&cli_config(kind)))
}

fn adapter_version(kind: AgentKind) -> &'static str {
    ADAPTERS
        .iter()
        .find(|(k, ..)| *k == kind)
        .map(|(.., v)| *v)
        .or_else(|| adapters::get(kind)?.adapter_version())
        .unwrap_or("")
}

/// [`catalog_key`] of a local Claude profile: the Claude build it runs (`version` of the detected one, unless the
/// profile pins its own executable) and the profile's `settings.json`, where its gateway and models are configured.
pub fn profile_catalog_key(version: Option<&str>, e: &Endpoint) -> Option<String> {
    let dir = e.claude_profile()?;
    let cli = e.executable_path.as_deref().or(version).unwrap_or("?");
    let adapter = adapter_version(AgentKind::Claude);
    Some(format!("{cli}+{adapter}+{}", file_digest(&dir.join("settings.json"))))
}

/// The catalog probed for the local Claude profile `e` with the Claude build `claude` (the detected one).
pub fn profile_catalog(home: &Path, e: &Endpoint, claude: Option<&AgentState>) -> Option<AgentCatalog> {
    let version = claude
        .and_then(|c| c.version.as_deref())
        .map(String::from)
        .or_else(|| crate::agent_settings::claude_version(home));
    let dir = e.config_dir.as_deref()?;
    let entry = load_profile_catalogs(home).remove(dir)?;
    match version {
        Some(v) => (Some(entry.key) == profile_catalog_key(Some(&v), e)).then_some(entry.catalog),
        None => {
            let key = profile_catalog_key(None, e)?;
            let matched = match key.strip_prefix('?') {
                Some(suffix) => !entry.key.starts_with('?') && entry.key.ends_with(suffix),
                None => entry.key == key,
            };
            matched.then_some(entry.catalog)
        }
    }
}

/// All local Claude profiles (one per directory) and the key to cache each probed catalog under.
pub fn claude_profiles(home: &Path, version: Option<&str>) -> anyhow::Result<Vec<(Selection, String)>> {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for p in Store::load(home)?.providers {
        let Some(selection) = Selection::of(&p, AgentKind::Claude) else { continue };
        let Some((_, e)) = selection.provider() else { continue };
        let (Some(dir), Some(key)) = (e.config_dir.clone(), profile_catalog_key(version, e)) else { continue };
        if seen.insert(dir) {
            out.push((selection, key));
        }
    }
    Ok(out)
}

/// The local Claude profiles (one per directory) without a catalog for the Claude build `version`, with the key to
/// cache the probed one under.
pub fn unprobed_profiles(home: &Path, version: Option<&str>) -> anyhow::Result<Vec<(Selection, String)>> {
    let cached = load_profile_catalogs(home);
    Ok(claude_profiles(home, version)?
        .into_iter()
        .filter(|(s, key)| {
            s.claude_profile().and_then(|d| d.to_str()).is_some_and(|dir| cached.get(dir).is_none_or(|c| &c.key != key))
        })
        .collect())
}

/// A short digest of the file's content, empty when it cannot be read.
fn file_digest(path: &Path) -> String {
    std::fs::read(path)
        .map(|b| Sha256::digest(b).iter().take(6).map(|b| format!("{b:02x}")).collect())
        .unwrap_or_default()
}

fn custom_endpoint(kind: AgentKind, k: &str, v: &str) -> bool {
    let v = v.trim();
    if v.is_empty() {
        return false;
    }
    match kind {
        AgentKind::Claude => {
            matches!(k, "ANTHROPIC_BASE_URL" | "ANTHROPIC_BEDROCK_BASE_URL" | "ANTHROPIC_VERTEX_BASE_URL")
                || (matches!(k, "CLAUDE_CODE_USE_BEDROCK" | "CLAUDE_CODE_USE_VERTEX") && v != "0" && v != "false")
        }
        AgentKind::Codex => k == "OPENAI_BASE_URL",
        _ => true,
    }
}

/// The agent talks to its maker's own service, where its built-in reviewer works: the official login or a local
/// Claude profile, without a base URL in its env, `--settings`, the daemon's env or the CLI's user config (`config`:
/// Claude's `settings.json` when the run loads it, Codex's `config.toml`; None = absent). Claude `auto` through a
/// gateway refuses every action it should check; Codex's reviewer model fails on third-party providers.
pub fn official_service(kind: AgentKind, selection: &crate::providers::Selection, config: Option<&str>) -> bool {
    let daemon_env: Vec<(String, String)> = std::env::vars_os()
        .filter_map(|(k, v)| Some((k.into_string().ok()?, v.to_string_lossy().into_owned())))
        .collect();
    official_service_in(kind, selection, config, &daemon_env)
}

/// [`official_service`] against the given daemon env, so tests do not depend on the machine running them.
fn official_service_in(
    kind: AgentKind,
    selection: &crate::providers::Selection,
    config: Option<&str>,
    daemon_env: &[(String, String)],
) -> bool {
    if !matches!(kind, AgentKind::Claude | AgentKind::Codex) {
        return false;
    }
    let is_profile = selection.claude_profile().is_some();
    if !matches!(selection, crate::providers::Selection::Official(_)) && !is_profile {
        return false;
    }
    if selection.process_env().iter().any(|(k, v)| custom_endpoint(kind, k, v)) {
        return false;
    }
    if !is_profile && daemon_env.iter().any(|(k, v)| custom_endpoint(kind, k, v)) {
        return false;
    }
    if kind == AgentKind::Claude {
        let Ok(args) = selection.claude_args() else { return false };
        let Ok(settings) = args.settings() else { return false };
        if settings
            .and_then(|mut s| s.remove("env"))
            .and_then(|e| e.as_object().cloned())
            .is_some_and(|env| env.iter().any(|(k, v)| custom_endpoint(kind, k, v.as_str().unwrap_or("x"))))
        {
            return false;
        }
    }
    let Some(config) = config else { return true };
    match kind {
        AgentKind::Claude => {
            let Ok(settings) = serde_json::from_str::<serde_json::Value>(config) else { return false };
            settings["env"]
                .as_object()
                .is_none_or(|env| !env.iter().any(|(k, v)| custom_endpoint(kind, k, v.as_str().unwrap_or("x"))))
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

/// [`official_service`] with the CLI's user config under `user_home` (or the profile's / configured config dir);
/// Claude's only when the run loads it.
pub fn official_service_here(
    kind: AgentKind,
    selection: &crate::providers::Selection,
    user_home: &Path,
    loads_cli_config: bool,
) -> bool {
    let env_dir = |key: &str| {
        selection
            .process_env()
            .get(key)
            .cloned()
            .or_else(|| std::env::var_os(key).map(|v| v.to_string_lossy().into_owned()))
            .filter(|v| !v.trim().is_empty())
            .map(PathBuf::from)
    };
    let path = match kind {
        AgentKind::Claude => match selection.claude_profile().map(Path::to_path_buf) {
            Some(dir) => Some(dir.join("settings.json")),
            None if loads_cli_config => {
                Some(env_dir("CLAUDE_CONFIG_DIR").unwrap_or_else(|| user_home.join(".claude")).join("settings.json"))
            }
            None => None,
        },
        AgentKind::Codex => Some(env_dir("CODEX_HOME").unwrap_or_else(|| user_home.join(".codex")).join("config.toml")),
        _ => None,
    };
    let config = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok());
    official_service(kind, selection, config.as_deref())
}

/// The user-level config file the CLI reads its providers and models from.
fn cli_config(kind: AgentKind) -> PathBuf {
    match kind {
        AgentKind::Claude => std::env::var_os("CLAUDE_CONFIG_DIR")
            .filter(|v| !v.is_empty())
            .map_or_else(|| crate::config::user_home().join(".claude"), PathBuf::from)
            .join("settings.json"),
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

fn detect_one(home: &Path, kind: AgentKind, local: &LocalSettings) -> AgentState {
    let path = locate(home, kind, local);
    let available = path.as_deref().is_some_and(Path::is_file);
    let tool = crate::tools::ToolKind::of(kind);
    let mut state = AgentState {
        kind,
        available,
        version: path.as_deref().filter(|_| available).and_then(|p| version(home, p)),
        managed: path.as_deref().filter(|_| available).is_some_and(|p| crate::tools::is_managed(home, p)),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        min_version: Some(min_version(kind).into()),
        catalog: None,
        latest: crate::tools::cached_latest(home, tool),
        upgrade_command: None,
        install_command: None,
    };
    let install = crate::tools::agent_status(home, &state);
    (state.upgrade_command, state.install_command) = (install.upgrade_command, install.install_command);
    state
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
        "Codex 无法启动：{problem}。请重新安装：pnpm add -g @openai/codex（或 npm install -g @openai/codex），或在桌面端「执行 → Agent」页改用共工托管安装（或运行 gg agents install codex）",
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
        .chain(extra_dirs(&crate::config::user_home(), std::env::var_os("NVM_DIR").map(PathBuf::from).as_deref()))
        .flat_map(|dir| names.iter().map(move |n| dir.join(n)))
        .find(|p| p.is_file())
}

/// Windows can only run `.exe` files and (via cmd.exe) the `.cmd` shims npm installs; the extensionless file npm
/// puts next to them is a sh script.
pub(crate) fn file_names(bin: &str) -> Vec<String> {
    if cfg!(windows) { vec![format!("{bin}.exe"), format!("{bin}.cmd")] } else { vec![bin.into()] }
}

/// Common install dirs missing from the PATH of GUI apps and services, including the user-level Node managers
/// (nvm, volta, fnm, asdf, pnpm, bun) whose `npm install -g` lands outside any system dir.
fn extra_dirs(home: &Path, nvm_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = vec![home.join(".local/bin")];
    if cfg!(windows) {
        dirs.extend(std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("npm")));
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    dirs.push(home.join(".npm-global/bin"));
    dirs.extend(
        [
            ".volta/bin",
            ".bun/bin",
            "Library/pnpm",
            ".local/share/pnpm",
            ".asdf/shims",
            ".local/share/fnm/aliases/default/bin",
            "Library/Application Support/fnm/aliases/default/bin",
        ]
        .map(|d| home.join(d)),
    );
    dirs.extend(nvm_bins(&nvm_dir.map_or_else(|| home.join(".nvm"), Path::to_path_buf)));
    dirs
}

/// `bin` of every Node nvm installed, newest first.
fn nvm_bins(nvm: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(nvm.join("versions/node")) else { return vec![] };
    let mut versions: Vec<(Vec<u64>, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let v = name.trim_start_matches('v').split('.').map(str::parse).collect::<Result<_, _>>().ok()?;
            Some((v, e.path().join("bin")))
        })
        .collect();
    versions.sort_by(|a, b| b.0.cmp(&a.0));
    versions.into_iter().map(|(_, bin)| bin).collect()
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

/// Whether `kind` is known to be logged out by its manifest's checks (Claude Code and Codex report their own state
/// through their CLI and are not judged here). Probing such an agent only fails, and Gemini CLI opens a Google
/// sign-in page in the browser each time it starts unauthenticated.
pub fn logged_out(kind: AgentKind, user_home: &Path, env: &dyn Fn(&str) -> Option<String>) -> bool {
    !matches!(kind, AgentKind::Claude | AgentKind::Codex)
        && adapter(kind).login_status(user_home, env).is_some_and(|s| s.starts_with(&*t!("未登录")))
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
    fn probing_waits_for_a_login_its_manifest_can_see() {
        use crate::protocol::AgentKind::{Antigravity, Claude, Gemini};
        let home = tempfile::tempdir().unwrap();
        let none = |_: &str| None;
        let key = |n: &str| (n == "GEMINI_API_KEY").then(|| "k".to_string());
        // Gemini without a key or Vertex would start its Google sign-in in a browser on every probe.
        assert!(super::logged_out(Gemini, home.path(), &none));
        assert!(!super::logged_out(Gemini, home.path(), &key));
        std::fs::create_dir_all(home.path().join(".gemini")).unwrap();
        let google = r#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#;
        std::fs::write(home.path().join(".gemini/settings.json"), google).unwrap();
        assert!(super::logged_out(Gemini, home.path(), &key), "a key does not help once Google sign-in is selected");
        // Unknown login state (agy) and the CLIs that report it themselves are still probed.
        assert!(!super::logged_out(Antigravity, home.path(), &none));
        assert!(!super::logged_out(Claude, home.path(), &none));
    }

    #[test]
    fn built_in_review_needs_the_official_service() {
        use crate::protocol::AgentKind::{Claude, Codex, Gemini};
        use crate::providers::{Official, Provider, Selection};
        let official = Selection::Official(Official::default());
        let works = |kind, config: Option<&str>| super::official_service_in(kind, &official, config, &[]);
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
        assert!(!super::official_service_in(Claude, &Selection::Official(env), None, &[]));
        let gateway = [("ANTHROPIC_BASE_URL".to_string(), "https://relay.test".to_string())];
        assert!(!super::official_service_in(Claude, &official, None, &gateway), "the daemon's own env counts too");
        let relay = Provider::custom(
            crate::protocol::ApiProtocol::Openai,
            "relay".into(),
            "https://relay.test/v1".into(),
            "k".into(),
        );
        assert!(!super::official_service(Codex, &Selection::of(&relay, Codex).unwrap(), None));

        // A local Claude profile with official subscription/token login works unless its settings route to a gateway.
        let dir = tempfile::tempdir().unwrap();
        let mut profile =
            Provider::custom(crate::protocol::ApiProtocol::Anthropic, "Local".into(), String::new(), String::new());
        profile.endpoints[0].config_dir = Some(dir.path().to_string_lossy().into());
        let sel = Selection::of(&profile, Claude).unwrap();
        assert!(super::official_service_here(Claude, &sel, dir.path(), true));
        std::fs::write(dir.path().join("settings.json"), r#"{"env":{"CLAUDE_CODE_OAUTH_TOKEN":"oat-123"}}"#).unwrap();
        assert!(super::official_service_here(Claude, &sel, dir.path(), true));
        std::fs::write(dir.path().join("settings.json"), r#"{"env":{"ANTHROPIC_BASE_URL":"https://gw.test"}}"#)
            .unwrap();
        assert!(!super::official_service_here(Claude, &sel, dir.path(), true));
    }

    use super::{file_names, parse_version};

    #[cfg(unix)]
    #[test]
    fn user_level_node_installs_are_searched_newest_nvm_first() {
        let home = tempfile::tempdir().unwrap();
        let h = home.path();
        for v in ["v9.0.0", "v24.15.0", "v22.22.2"] {
            std::fs::create_dir_all(h.join(".nvm/versions/node").join(v).join("bin")).unwrap();
        }
        let dirs = super::extra_dirs(h, None);
        let nvm: Vec<_> = dirs.iter().filter(|d| d.starts_with(h.join(".nvm"))).collect();
        assert_eq!(
            nvm,
            ["v24.15.0", "v22.22.2", "v9.0.0"]
                .map(|v| h.join(".nvm/versions/node").join(v).join("bin"))
                .iter()
                .collect::<Vec<_>>()
        );
        for d in [".volta/bin", ".bun/bin", "Library/pnpm", ".local/share/pnpm", ".asdf/shims"] {
            assert!(dirs.contains(&h.join(d)), "{d}");
        }
        let custom = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(custom.path().join("versions/node/v20.0.0/bin")).unwrap();
        assert!(super::extra_dirs(h, Some(custom.path())).contains(&custom.path().join("versions/node/v20.0.0/bin")));
    }

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
