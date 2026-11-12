//! Agent adapters from plugin manifests (docs/plan/插件体系-contributes-方案.md §5). Gemini CLI, CodeBuddy, pi and
//! DeepSeek Harness are the built-in `agent-*` plugins of the server's official folder, compiled in here: how each is
//! installed, started and driven is the `contributes.agents` entry of its manifest, and what a manifest cannot say is
//! its launch script, a Node script run before each agent process starts. Claude and Codex stay code adapters.
use crate::protocol::{AgentKind, McpServer, Tier};
use crate::t;
use agent_client_protocol::schema::v1 as acp;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;

macro_rules! official {
    ($name:literal $(, $file:literal)*) => {
        (
            $name,
            &[
                (
                    "gonggong-plugin.json",
                    include_str!(concat!("../../../apps/server/plugins/official/", $name, "/gonggong-plugin.json")),
                ),
                $(($file, include_str!(concat!("../../../apps/server/plugins/official/", $name, "/", $file))),)*
            ],
        )
    };
}

type Files = &'static [(&'static str, &'static str)];

/// The built-in agent plugins: name and the files the daemon needs (manifest, launch script and what it loads).
const BUILT_IN: [(&str, Files); 4] = [
    official!("agent-gemini", "contrib/agents/gemini/launch.mjs"),
    official!("agent-codebuddy"),
    official!("agent-pi", "contrib/agents/pi/launch.mjs", "contrib/agents/pi/gonggong.ts"),
    official!("agent-deepseek", "contrib/agents/deepseek/launch.mjs"),
];

/// A launch script gets this long; past it the turn fails.
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Spec {
    pub id: String,
    pub title: String,
    pub vendor: String,
    pub install: Install,
    pub acp: Acp,
    #[serde(default)]
    pub chdir: bool,
    pub system_prompt: SystemPrompt,
    #[serde(default)]
    pub mcp: Mcp,
    pub skills: Skills,
    pub tiers: Option<Tiers>,
    pub provider: Option<ProviderEnv>,
    pub home: Home,
    pub login: Login,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub permission: Permission,
    #[serde(default)]
    pub errors: Errors,
    #[serde(default)]
    pub steering_dirs: Vec<String>,
    pub state: Option<String>,
    pub launch_script: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Install {
    pub npm: String,
    pub bin: String,
    pub script: Option<String>,
    pub brew: Option<String>,
    pub min_version: String,
    #[serde(default = "min_node")]
    pub min_node: String,
}

fn min_node() -> String {
    "22.0.0".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Acp {
    Native {
        #[serde(default)]
        args: Vec<String>,
    },
    Adapter {
        npm: String,
        version: String,
        #[serde(default = "adapter_entry")]
        entry: String,
    },
}

fn adapter_entry() -> String {
    "dist/index.js".into()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "via", rename_all = "camelCase")]
pub enum SystemPrompt {
    Arg { args: Vec<String> },
    Env { env: String },
    Script,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Via {
    #[default]
    Acp,
    Env,
    Script,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mcp {
    #[serde(default)]
    pub via: Via,
    pub env: Option<String>,
    #[serde(default)]
    pub extra: Map<String, Value>,
    /// Where the built-in gonggong server goes: `Script` hands it to the launch script instead of ACP.
    #[serde(default)]
    pub gonggong: Via,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillsVia {
    Link,
    Arg,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skills {
    pub via: SkillsVia,
    #[serde(default)]
    pub args: Vec<String>,
    pub dirs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierSpec {
    pub mode: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tiers {
    pub full: TierSpec,
    pub workspace: TierSpec,
    pub readonly: TierSpec,
    #[serde(default)]
    pub restart_on_change: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEnv {
    pub env: ProviderNames,
    #[serde(default)]
    pub skip_base_urls: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderNames {
    pub api_key: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Home {
    pub env: Option<String>,
    pub default: String,
    pub config: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    pub checks: Vec<LoginCheck>,
    #[serde(default = "yes")]
    pub logged_out: bool,
    pub command: String,
    pub hint: String,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LoginCheck {
    Env { names: Vec<String>, label: String },
    EnvFile { files: Vec<String>, keys: Vec<String>, label: String },
    YamlKey { file: String, key: String, label: String },
    JsonValue { file: String, pointer: String, equals: String, label: String },
    JsonKeys { file: String },
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission {
    pub mcp_meta: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Errors {
    pub meta_key: Option<String>,
}

/// A built-in agent adapter: its manifest entry and the plugin files behind it.
pub struct Adapter {
    pub kind: AgentKind,
    pub plugin: &'static str,
    pub spec: Spec,
    files: Files,
}

impl Adapter {
    /// The ACP session mode or env of `tier`; None: the agent has no permission modes.
    pub fn tier(&self, tier: Tier) -> Option<&TierSpec> {
        let t = self.spec.tiers.as_ref()?;
        Some(match tier {
            Tier::Full => &t.full,
            Tier::Workspace => &t.workspace,
            Tier::ReadOnly => &t.readonly,
        })
    }

    pub fn restarts_on_tier(&self) -> bool {
        self.spec.tiers.as_ref().is_some_and(|t| t.restart_on_change)
    }

    /// The adapter npm package and version, if the agent needs one.
    pub fn adapter_version(&self) -> Option<&str> {
        match &self.spec.acp {
            Acp::Adapter { version, .. } => Some(version),
            Acp::Native { .. } => None,
        }
    }

    /// `<home>/<state>/<key>`: the (group, bot) pair's state (`<group>-<bot>`), or [`PROBE`]'s.
    pub fn state_dir(&self, home: &Path, key: &str) -> Option<PathBuf> {
        self.spec.state.as_ref().map(|s| home.join(s).join(key))
    }

    /// The agent's own config directory on the machine (`home.env`, else `home.default` under the user's home).
    pub fn config_home(&self, user_home: &Path, env: &dyn Fn(&str) -> Option<String>) -> PathBuf {
        self.spec
            .home
            .env
            .as_deref()
            .and_then(|e| env(e).filter(|v| !v.is_empty()))
            .map_or_else(|| user_home.join(&self.spec.home.default), PathBuf::from)
    }

    /// The plugin folder (`{pkg}`), written once per content under `<home>/agent-pkgs/`.
    pub fn pkg_dir(&self, home: &Path) -> std::io::Result<PathBuf> {
        let mut hash = Sha256::new();
        for (path, content) in self.files {
            hash.update(path.as_bytes());
            hash.update([0]);
            hash.update(content.as_bytes());
            hash.update([0]);
        }
        let digest: String = hash.finalize().iter().take(6).map(|b| format!("{b:02x}")).collect();
        let dir = home.join("agent-pkgs").join(format!("{}-{digest}", self.plugin));
        if dir.is_dir() {
            return Ok(dir);
        }
        let tmp = home.join("agent-pkgs").join(format!(".{}-{}.partial", self.plugin, uuid::Uuid::new_v4()));
        for (path, content) in self.files {
            let file = tmp.join(path);
            std::fs::create_dir_all(file.parent().expect("has a parent"))?;
            std::fs::write(file, content)?;
        }
        let moved = std::fs::rename(&tmp, &dir).or_else(|e| if dir.is_dir() { Ok(()) } else { Err(e) });
        let _ = std::fs::remove_dir_all(&tmp);
        moved.map(|_| dir)
    }

    /// 登录 state from the manifest's checks; None when it cannot tell.
    pub fn login_status(&self, user_home: &Path, env: &dyn Fn(&str) -> Option<String>) -> Option<String> {
        let home = self.config_home(user_home, env);
        let path = |p: &str| expand(p, &home, user_home);
        let logged = |how: &str| t!("已登录 · {how}", how = how);
        for check in &self.spec.login.checks {
            match check {
                LoginCheck::Env { names, label } => {
                    if names.iter().any(|n| env(n).is_some_and(|v| !v.is_empty())) {
                        return Some(logged(label));
                    }
                }
                LoginCheck::EnvFile { files, keys, label } => {
                    let found = files.iter().any(|f| {
                        std::fs::read_to_string(path(f)).is_ok_and(|text| {
                            text.lines().any(|l| {
                                let l = l.trim().trim_start_matches("export ").trim_start();
                                l.split_once('=').is_some_and(|(k, v)| {
                                    keys.iter().any(|key| key == k.trim()) && !unquote(v).is_empty()
                                })
                            })
                        })
                    });
                    if found {
                        return Some(logged(label));
                    }
                }
                LoginCheck::YamlKey { file, key, label } => {
                    let found = std::fs::read_to_string(path(file)).is_ok_and(|text| {
                        text.lines().any(|l| {
                            l.trim().split_once(':').is_some_and(|(k, v)| unquote(k) == key && !unquote(v).is_empty())
                        })
                    });
                    if found {
                        return Some(logged(label));
                    }
                }
                LoginCheck::JsonValue { file, pointer, equals, label } => {
                    let v = std::fs::read_to_string(path(file))
                        .ok()
                        .and_then(|t| serde_json::from_str::<Value>(&strip_comments(&t)).ok());
                    if v.as_ref().and_then(|v| v.pointer(pointer)?.as_str()) == Some(equals.as_str()) {
                        return Some(logged(label));
                    }
                }
                LoginCheck::JsonKeys { file } => {
                    let keys = std::fs::read_to_string(path(file))
                        .ok()
                        .and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok())
                        .map(|m| m.keys().cloned().collect::<Vec<_>>())
                        .unwrap_or_default();
                    if !keys.is_empty() {
                        return Some(logged(&keys.join(", ")));
                    }
                }
            }
        }
        self.spec.login.logged_out.then(|| t!("未登录").to_string())
    }

    /// The base URL env value for provider `p`: none for the agent maker's own services (`skipBaseUrls`, picked by
    /// a preset's env instead).
    pub fn base_url<'a>(&self, base_url: &'a str) -> Option<&'a str> {
        let url = base_url.trim_end_matches('/');
        let skip = self
            .spec
            .provider
            .as_ref()
            .is_some_and(|p| p.skip_base_urls.iter().any(|s| s.trim_end_matches('/') == url));
        (!skip).then_some(url)
    }

    /// Where the install hint points when the CLI is missing.
    pub fn missing(&self) -> String {
        t!(
            "这台机器上没有 {agent}，请安装：npm install -g {npm}，或在「设置 → Agent 工具」里用共工托管安装",
            agent = self.spec.title,
            npm = self.spec.install.npm
        )
    }
}

fn unquote(s: &str) -> &str {
    s.trim().trim_matches(['"', '\''])
}

/// `~/…` under the user's home, `{home}/…` under the agent's.
fn expand(p: &str, home: &Path, user_home: &Path) -> PathBuf {
    if let Some(rest) = p.strip_prefix("{home}/") {
        home.join(rest)
    } else if let Some(rest) = p.strip_prefix("~/") {
        user_home.join(rest)
    } else {
        PathBuf::from(p)
    }
}

/// The state key throwaway sessions (model probe, fork) run under.
pub const PROBE: &str = "probe";

static ADAPTERS: LazyLock<Vec<Adapter>> = LazyLock::new(|| {
    BUILT_IN
        .iter()
        .map(|(plugin, files)| {
            let manifest: Value = serde_json::from_str(files[0].1).expect("built-in agent manifest");
            let entry = manifest["contributes"]["agents"][0].clone();
            let spec: Spec = serde_json::from_value(entry).unwrap_or_else(|e| panic!("{plugin}: {e}"));
            let kind: AgentKind = serde_json::from_value(Value::String(spec.id.clone()))
                .unwrap_or_else(|_| panic!("{plugin}: unknown agent {}", spec.id));
            Adapter { kind, plugin, spec, files }
        })
        .collect()
});

pub fn all() -> &'static [Adapter] {
    &ADAPTERS
}

/// The manifest adapter of `kind`; None for the code adapters (Claude, Codex).
pub fn get(kind: AgentKind) -> Option<&'static Adapter> {
    ADAPTERS.iter().find(|a| a.kind == kind)
}

/// Repo folders some agent is steered by.
pub fn steering_dirs() -> impl Iterator<Item = &'static str> {
    ADAPTERS.iter().flat_map(|a| a.spec.steering_dirs.iter().map(String::as_str))
}

/// `_meta` keys naming the MCP server and tool of a permission request.
pub fn mcp_meta_keys() -> impl Iterator<Item = &'static str> {
    ADAPTERS.iter().filter_map(|a| a.spec.permission.mcp_meta.as_deref())
}

/// `_meta` keys of a failed prompt carrying the JSON-RPC error.
pub fn error_meta_keys() -> impl Iterator<Item = &'static str> {
    ADAPTERS.iter().filter_map(|a| a.spec.errors.meta_key.as_deref())
}

/// The values `{…}` in a manifest's arguments and env stand for.
#[derive(Default)]
pub struct Vars<'a> {
    pub prompt: &'a str,
    pub state: Option<&'a Path>,
    pub pkg: Option<&'a Path>,
    pub node: Option<&'a Path>,
    pub cli: Option<&'a str>,
}

impl Vars<'_> {
    pub fn fill(&self, s: &str) -> String {
        let path = |p: Option<&Path>| p.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        // `{prompt}` last: the bot's prompt may itself contain `{cli}` and the like.
        s.replace("{state}", &path(self.state))
            .replace("{pkg}", &path(self.pkg))
            .replace("{node}", &path(self.node))
            .replace("{cli}", self.cli.unwrap_or_default())
            .replace("{prompt}", self.prompt)
    }
}

/// `args` with `{pluginDirs}` standing for one argument per folder; nothing without folders.
pub fn with_dirs(args: &[String], dirs: &[PathBuf], vars: &Vars) -> Vec<String> {
    if dirs.is_empty() {
        return vec![];
    }
    args.iter()
        .flat_map(|a| {
            if a == "{pluginDirs}" {
                dirs.iter().map(|d| d.to_string_lossy().into_owned()).collect()
            } else {
                vec![vars.fill(a)]
            }
        })
        .collect()
}

/// MCP servers as a JSON map name → config, each with `extra` merged in (`mcp.via: env`).
pub fn mcp_map(servers: &[McpServer], ask: Option<&acp::McpServer>, extra: &Map<String, Value>) -> String {
    let mut out = Map::new();
    for s in servers {
        let (name, config) = match s {
            McpServer::Stdio { name, command, args, env } => {
                (name, json!({ "command": command, "args": args, "env": env }))
            }
            McpServer::Http { name, url, headers } => (name, json!({ "url": url, "headers": headers })),
        };
        out.insert(name.clone(), config);
    }
    if let Some((name, gonggong)) = ask.and_then(gonggong) {
        out.insert(name, json!({ "url": gonggong["url"], "headers": gonggong["headers"] }));
    }
    for config in out.values_mut() {
        let config = config.as_object_mut().expect("built as objects");
        config.extend(extra.clone());
    }
    Value::Object(out).to_string()
}

/// The built-in gonggong server as `{ name, url, headers }`.
pub fn gonggong(ask: &acp::McpServer) -> Option<(String, Value)> {
    let acp::McpServer::Http(http) = ask else { return None };
    let headers: Map<String, Value> = http.headers.iter().map(|h| (h.name.clone(), h.value.clone().into())).collect();
    Some((http.name.clone(), json!({ "name": http.name, "url": http.url, "headers": headers })))
}

/// What a launch script hands back: env and arguments for the agent process.
#[derive(Debug, Default, PartialEq, Eq, Deserialize)]
pub struct Launch {
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub args: Vec<String>,
}

/// Runs the launch script `script` on `node` with the run as stdin JSON; its stdout JSON is the [`Launch`].
pub async fn run_script(node: &Path, script: &Path, input: &Value) -> Result<Launch, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    let failed = |e: &dyn std::fmt::Display| t!("启动脚本 {script} 失败：{e}", script = script.display(), e = e);
    let mut child = crate::proc::async_command(node)
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| failed(&e))?;
    let mut stdin = child.stdin.take().expect("piped");
    let body = input.to_string();
    let write = async move {
        stdin.write_all(body.as_bytes()).await?;
        stdin.shutdown().await
    };
    let run = async move {
        let (written, out) = tokio::join!(write, child.wait_with_output());
        written.and(out)
    };
    let out = match tokio::time::timeout(SCRIPT_TIMEOUT, run).await {
        Ok(out) => out.map_err(|e| failed(&e))?,
        Err(_) => return Err(failed(&t!("超时"))),
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(failed(&err.lines().last().unwrap_or_default()));
    }
    serde_json::from_slice(&out.stdout).map_err(|e| failed(&e))
}

/// The gonggong approval request (§5.2), sent by an adapter's extension as a permission request (kind `other`)
/// whose raw input is `{ method: "confirm", message: "{\"gonggong\": { toolCallId, title?, input }}" }`: made over
/// into one for the tool call it is about (its id, so the run card's tool is the one asked about, and its input, which
/// the owner's rules read). Other requests are left as they are.
pub fn own_request(call: &mut acp::ToolCallUpdate) {
    let raw = call.fields.raw_input.as_ref();
    if raw.and_then(|r| r["method"].as_str()) != Some("confirm") {
        return;
    }
    let Some(request) = raw
        .and_then(|r| r["message"].as_str())
        .and_then(|m| serde_json::from_str::<Value>(m).ok())
        .and_then(|mut v| v.get_mut("gonggong").map(Value::take))
    else {
        return;
    };
    let Some(id) = request["toolCallId"].as_str() else { return };
    call.tool_call_id = acp::ToolCallId::new(id);
    call.fields.title = request["title"].as_str().map(String::from);
    call.fields.kind = None;
    call.fields.raw_input = Some(request["input"].clone());
}

/// JSON with `//` and `/* */` comments (as Gemini CLI writes its settings) made plain JSON.
pub fn strip_comments(text: &str) -> String {
    let (mut out, mut chars) = (String::with_capacity(text.len()), text.chars().peekable());
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            match c {
                '\\' => out.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                out.push(c);
            }
            ('/', Some('/')) => while chars.next_if(|&n| n != '\n').is_some() {},
            ('/', Some('*')) => {
                chars.next();
                let mut last = ' ';
                for n in chars.by_ref() {
                    if last == '*' && n == '/' {
                        break;
                    }
                    last = n;
                }
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{HttpHeader, McpServerHttp, ToolCallUpdateFields, ToolKind};

    fn a(kind: AgentKind) -> &'static Adapter {
        get(kind).unwrap()
    }

    #[test]
    fn reads_the_four_built_in_manifests() {
        let ids: Vec<_> = all().iter().map(|a| (a.kind, a.plugin)).collect();
        assert_eq!(
            ids,
            [
                (AgentKind::Gemini, "agent-gemini"),
                (AgentKind::Codebuddy, "agent-codebuddy"),
                (AgentKind::Pi, "agent-pi"),
                (AgentKind::Deepseek, "agent-deepseek"),
            ]
        );
        assert!(get(AgentKind::Claude).is_none() && get(AgentKind::Codex).is_none(), "code adapters");
        assert_eq!(a(AgentKind::Pi).adapter_version(), Some("0.0.34"));
        assert_eq!(a(AgentKind::Deepseek).spec.install.min_node, "24.9.0");
        assert_eq!(a(AgentKind::Gemini).spec.install.min_node, "22.0.0", "the default");
        assert!(a(AgentKind::Deepseek).restarts_on_tier() && !a(AgentKind::Gemini).restarts_on_tier());
        assert_eq!(a(AgentKind::Pi).tier(Tier::Full).map(|t| t.mode.clone()), None);
        assert_eq!(a(AgentKind::Deepseek).tier(Tier::ReadOnly).unwrap().env["DSH_PERMISSION_MODE"], "read-only");
        assert_eq!(steering_dirs().collect::<Vec<_>>(), [".gemini"]);
        assert_eq!(mcp_meta_keys().collect::<Vec<_>>(), ["gemini-cli"]);
        assert_eq!(error_meta_keys().collect::<Vec<_>>(), ["codebuddy.ai/errorMessage"]);
    }

    #[test]
    fn writes_the_plugin_folder_once_per_content() {
        let home = tempfile::tempdir().unwrap();
        let pkg = a(AgentKind::Pi).pkg_dir(home.path()).unwrap();
        assert!(pkg.join("contrib/agents/pi/gonggong.ts").is_file());
        assert!(pkg.join("gonggong-plugin.json").is_file());
        assert_eq!(a(AgentKind::Pi).pkg_dir(home.path()).unwrap(), pkg);
    }

    #[test]
    fn fills_arguments_and_lists_plugin_dirs_one_per_argument() {
        let vars = Vars { prompt: "hi", state: Some(Path::new("/s")), cli: Some("/bin/x"), ..Default::default() };
        assert_eq!(vars.fill("{prompt} {state}/a {cli} {pkg}"), "hi /s/a /bin/x ");
        // The bot's own words go in verbatim, braces and all.
        let code = Vars { prompt: "run {cli} in {pkg}", cli: Some("/bin/x"), ..Default::default() };
        assert_eq!(code.fill("--append-system-prompt={prompt}"), "--append-system-prompt=run {cli} in {pkg}");
        let args = vec!["--plugin-dir".to_string(), "{pluginDirs}".to_string()];
        assert!(with_dirs(&args, &[], &vars).is_empty());
        let dirs = [PathBuf::from("/a"), PathBuf::from("/b")];
        assert_eq!(with_dirs(&args, &dirs, &vars), ["--plugin-dir", "/a", "/b"]);
    }

    #[test]
    fn codebuddy_sets_a_base_url_only_for_a_third_party_service() {
        let c = a(AgentKind::Codebuddy);
        assert_eq!(c.base_url("https://copilot.tencent.com/"), None);
        assert_eq!(c.base_url("https://www.codebuddy.ai"), None);
        assert_eq!(c.base_url("https://openrouter.ai/api/v1/"), Some("https://openrouter.ai/api/v1"));
        assert_eq!(a(AgentKind::Gemini).base_url("https://g.test"), Some("https://g.test"));
    }

    #[test]
    fn tells_the_logins_from_env_and_files() {
        let home = tempfile::tempdir().unwrap();
        let none = |_: &str| None;
        let key = |n: &str| (n == "GEMINI_API_KEY" || n == "DEEPSEEK_API_KEY").then(|| "k".to_string());
        let gemini = a(AgentKind::Gemini);
        assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("未登录"));
        assert_eq!(gemini.login_status(home.path(), &key).as_deref(), Some("已登录 · API key"));
        std::fs::create_dir_all(home.path().join(".gemini")).unwrap();
        std::fs::write(home.path().join(".gemini/.env"), "# key\nexport GEMINI_API_KEY=\"\"\n").unwrap();
        assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("未登录"), "an empty value");
        std::fs::write(home.path().join(".env"), "GEMINI_API_KEY=AIza-x\n").unwrap();
        assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("已登录 · API key"));
        let vertex = "{ // vertex\n \"security\": { \"auth\": { \"selectedType\": \"vertex-ai\" } } }";
        std::fs::write(home.path().join(".gemini/settings.json"), vertex).unwrap();
        assert_eq!(gemini.login_status(home.path(), &none).as_deref(), Some("已登录 · Vertex AI"));

        let codebuddy = a(AgentKind::Codebuddy);
        assert_eq!(codebuddy.login_status(home.path(), &none), None, "it cannot tell");
        let cb = |n: &str| (n == "CODEBUDDY_API_KEY").then(|| "k".to_string());
        assert_eq!(codebuddy.login_status(home.path(), &cb).as_deref(), Some("已登录 · API key"));

        let dir = tempfile::tempdir().unwrap();
        let at = |n: &str| (n == "PI_CODING_AGENT_DIR" || n == "DSH_HOME").then(|| dir.path().to_string_lossy().into());
        let pi = a(AgentKind::Pi);
        assert_eq!(pi.login_status(home.path(), &at), None);
        std::fs::write(dir.path().join("auth.json"), "{}").unwrap();
        assert_eq!(pi.login_status(home.path(), &at), None);
        std::fs::write(dir.path().join("auth.json"), r#"{"anthropic":{"type":"oauth"},"openai":{"key":"k"}}"#).unwrap();
        assert_eq!(pi.login_status(home.path(), &at).as_deref(), Some("已登录 · anthropic, openai"));

        let dsh = a(AgentKind::Deepseek);
        assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("未登录"));
        assert_eq!(dsh.login_status(home.path(), &key).as_deref(), Some("已登录 · API key"));
        std::fs::write(dir.path().join(".credentials.yaml"), "DEEPSEEK_API_KEY: ''\n").unwrap();
        assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("未登录"), "an empty value");
        std::fs::write(dir.path().join(".credentials.yaml"), "DEEPSEEK_API_KEY: sk-x\n").unwrap();
        assert_eq!(dsh.login_status(home.path(), &at).as_deref(), Some("已登录 · API key"));
    }

    fn confirm(message: &str) -> acp::ToolCallUpdate {
        let raw = json!({ "method": "confirm", "title": "bash", "message": message });
        acp::ToolCallUpdate::new(
            "pi-ui-7",
            ToolCallUpdateFields::new().title("bash").kind(ToolKind::Other).raw_input(raw),
        )
    }

    #[test]
    fn makes_a_gonggong_approval_request_one_for_its_tool_call() {
        let message = json!({ "gonggong": { "toolCallId": "call_1", "input": { "command": "rm -rf build" } } });
        let mut call = confirm(&message.to_string());
        own_request(&mut call);
        assert_eq!(call.tool_call_id.0.as_ref(), "call_1");
        assert_eq!(call.fields.title, None, "the tool keeps the title the adapter gave it");
        assert_eq!(call.fields.kind, None);
        assert_eq!(call.fields.raw_input, Some(json!({ "command": "rm -rf build" })));
        let message =
            json!({ "gonggong": { "toolCallId": "c2", "title": "mcp__gonggong__list_messages", "input": {} } });
        let mut call = confirm(&message.to_string());
        own_request(&mut call);
        assert_eq!(call.fields.title.as_deref(), Some("mcp__gonggong__list_messages"));
        let mut other = confirm("Allow rm -rf?");
        own_request(&mut other);
        assert_eq!(other.tool_call_id.0.as_ref(), "pi-ui-7");
    }

    fn ask() -> acp::McpServer {
        acp::McpServer::Http(
            McpServerHttp::new("gonggong", "http://127.0.0.1:1/s").headers(vec![HttpHeader::new("x-k", "v")]),
        )
    }

    #[test]
    fn hands_the_runs_mcp_servers_and_gonggongs_as_a_map() {
        let servers = vec![
            McpServer::Stdio {
                name: "fs".into(),
                command: "npx".into(),
                args: vec!["-y".into(), "fs-mcp".into()],
                env: BTreeMap::from([("K".into(), "v".into())]),
            },
            McpServer::Http {
                name: "docs".into(),
                url: "https://docs.example.com/mcp".into(),
                headers: BTreeMap::from([("Authorization".into(), "Bearer t".into())]),
            },
        ];
        let env: Value =
            serde_json::from_str(&mcp_map(&servers, Some(&ask()), &a(AgentKind::Pi).spec.mcp.extra)).unwrap();
        assert_eq!(env["fs"]["command"], "npx");
        assert_eq!(env["fs"]["env"]["K"], "v");
        assert_eq!(env["docs"]["headers"]["Authorization"], "Bearer t");
        assert_eq!(env["gonggong"]["url"], "http://127.0.0.1:1/s");
        assert_eq!(env["gonggong"]["headers"]["x-k"], "v");
        assert_eq!(env["gonggong"]["exposure"], "direct");
        assert_eq!(env["gonggong"]["timeout"], 90_000);
    }

    #[test]
    fn strips_json_comments_but_not_strings() {
        let text = "{ // c\n \"a\": \"//x\", /* b */ \"c\": 1 /*/ y */ }";
        let v: Value = serde_json::from_str(&strip_comments(text)).unwrap();
        assert_eq!(v, json!({ "a": "//x", "c": 1 }));
    }

    async fn launch(kind: AgentKind, home: &Path, input: Value) -> Result<Launch, String> {
        let pkg = a(kind).pkg_dir(home).unwrap();
        let script = pkg.join(a(kind).spec.launch_script.as_ref().unwrap());
        run_script(Path::new("node"), &script, &input).await
    }

    #[tokio::test]
    async fn a_failing_or_silent_script_fails_the_launch() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.mjs");
        std::fs::write(&bad, "console.error('boom'); process.exit(3)").unwrap();
        let e = run_script(Path::new("node"), &bad, &json!({})).await.unwrap_err();
        assert!(e.contains("boom"), "{e}");
        let echo = dir.path().join("echo.mjs");
        std::fs::write(&echo, "process.stdin.on('data', (d) => process.stdout.write(JSON.stringify({ env: { IN: String(JSON.parse(d).x) }, args: ['-a'] })))").unwrap();
        let out = run_script(Path::new("node"), &echo, &json!({ "x": 7 })).await.unwrap();
        assert_eq!(out, Launch { env: BTreeMap::from([("IN".into(), "7".into())]), args: vec!["-a".into()] });
    }

    #[tokio::test]
    async fn gemini_gets_a_home_with_the_instructions_the_login_and_the_gonggong_server() {
        let (home, user) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let own = user.path().join(".gemini");
        std::fs::create_dir_all(own.join("extensions")).unwrap();
        std::fs::write(
            own.join("settings.json"),
            "{ // mine\n \"context\": { \"fileName\": [\"AGENTS.md\", \"GEMINI.md\"] } }",
        )
        .unwrap();
        std::fs::write(own.join("AGENTS.md"), "user rules").unwrap();
        std::fs::write(own.join("oauth_creds.json"), "{}").unwrap();
        let state = home.path().join("gemini/g1-b1");
        let (_, gonggong) = gonggong(&ask()).unwrap();
        let input = json!({
            "state": state, "userHome": user.path(), "systemPrompt": "bot rules",
            "provider": { "baseUrl": "https://g.test", "model": null }, "gonggong": gonggong,
        });
        let out = launch(AgentKind::Gemini, home.path(), input).await.unwrap();
        assert_eq!(out.env["GEMINI_CLI_HOME"], state.to_string_lossy());
        let ours = state.join(".gemini");
        let settings: Value =
            serde_json::from_str(&std::fs::read_to_string(ours.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["security"]["auth"]["selectedType"], "gemini-api-key");
        assert_eq!(settings["mcpServers"]["gonggong"]["httpUrl"], "http://127.0.0.1:1/s");
        assert_eq!(settings["mcpServers"]["gonggong"]["headers"]["x-k"], "v");
        assert_eq!(settings["mcpServers"]["gonggong"]["timeout"], 90_000_000);
        assert_eq!(std::fs::read_to_string(ours.join("AGENTS.md")).unwrap(), "bot rules\n\nuser rules");
        assert!(!ours.join("GEMINI.md").exists(), "one memory file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(ours.join("settings.json")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
            assert_eq!(std::fs::read_link(ours.join("oauth_creds.json")).unwrap(), own.join("oauth_creds.json"));
            assert!(ours.join("extensions").is_dir());
        }
        // The user's login file gone: so is the link; the official login keeps the user's own settings.
        std::fs::remove_file(own.join("oauth_creds.json")).unwrap();
        let input =
            json!({ "state": state, "userHome": user.path(), "systemPrompt": "", "provider": null, "gonggong": null });
        launch(AgentKind::Gemini, home.path(), input).await.unwrap();
        assert!(ours.join("oauth_creds.json").symlink_metadata().is_err());
        let settings: Value =
            serde_json::from_str(&std::fs::read_to_string(ours.join("settings.json")).unwrap()).unwrap();
        assert_eq!(settings["security"], Value::Null);
        assert_eq!(settings["mcpServers"], Value::Null);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pi_gets_a_wrapper_that_runs_it_with_the_extension_and_the_adapters_arguments() {
        let home = tempfile::tempdir().unwrap();
        let data = home.path().join("pi");
        let input = json!({ "data": data, "node": "/bin/echo", "cli": "/x/pi", "cliScript": "cli.js", "bin": "pi" });
        let out = launch(AgentKind::Pi, home.path(), input).await.unwrap();
        let wrapper = data.join("pi-gonggong");
        assert_eq!(out.env["PI_ACP_PI_COMMAND"], wrapper.to_string_lossy());
        assert_eq!((out.env["GG_PI_EXE"].as_str(), out.env["GG_PI_SCRIPT"].as_str()), ("/bin/echo", "cli.js"));
        let extension = out.env["GG_PI_EXTENSION"].clone();
        assert!(Path::new(&extension).is_file());
        let run = std::process::Command::new(&wrapper).args(["--mode", "rpc"]).envs(&out.env).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&run.stdout), format!("cli.js --approve -e {extension} --mode rpc\n"));
        // A native build runs as it is; without a CLI (a test's agent stands in) its name.
        let input = json!({ "data": data, "node": "/n", "cli": null, "cliScript": null, "bin": "pi" });
        let out = launch(AgentKind::Pi, home.path(), input).await.unwrap();
        assert_eq!(out.env["GG_PI_EXE"], "pi");
        assert!(!out.env.contains_key("GG_PI_SCRIPT"));
    }

    #[tokio::test]
    async fn deepseek_gets_its_persona_patch() {
        let home = tempfile::tempdir().unwrap();
        let state = home.path().join("deepseek/g1-b1");
        let out = launch(AgentKind::Deepseek, home.path(), json!({ "state": state, "systemPrompt": "bot rules" }))
            .await
            .unwrap();
        let file = state.join("system-prompt.yml");
        assert_eq!(out.args, ["--patch".to_string(), file.to_string_lossy().into_owned()]);
        let patch: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        assert_eq!(
            patch[0]["config"]["personaPrefix"],
            "You are a coding agent powered by the {{model}} model.\n\nbot rules"
        );
    }
}
