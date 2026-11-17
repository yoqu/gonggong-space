//! Agent adapters from plugin manifests (docs/plan/插件体系-contributes-方案.md §5). Gemini CLI, CodeBuddy, pi,
//! DeepSeek Harness, Antigravity CLI, OpenCode, Qwen Code, Kimi Code, Goose and GitHub Copilot CLI are the built-in
//! `agent-*` plugins of the server's official folder, compiled in here: how each is
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
const BUILT_IN: [(&str, Files); 10] = [
    official!("agent-gemini", "contrib/agents/gemini/launch.mjs"),
    official!("agent-codebuddy"),
    official!("agent-pi", "contrib/agents/pi/launch.mjs", "contrib/agents/pi/gonggong.ts"),
    official!("agent-deepseek", "contrib/agents/deepseek/launch.mjs"),
    official!("agent-antigravity"),
    official!("agent-opencode", "contrib/agents/opencode/launch.mjs"),
    official!("agent-qwen"),
    official!("agent-kimi", "contrib/agents/kimi/launch.mjs"),
    official!("agent-goose", "contrib/agents/goose/launch.mjs"),
    official!("agent-copilot", "contrib/agents/copilot/launch.mjs"),
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
    /// `None`: not on npm, so Gonggong cannot install it; the owner runs `command`.
    pub npm: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
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
    Arg {
        args: Vec<String>,
    },
    Env {
        env: String,
    },
    Script,
    /// session/new `_meta.<key>.systemPrompt.append`.
    Meta {
        key: String,
    },
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
    /// The provider endpoints it can run on.
    pub protocols: Vec<crate::protocol::ApiProtocol>,
    pub env: ProviderNames,
    #[serde(default)]
    pub skip_base_urls: Vec<String>,
    /// Per endpoint protocol: env names in place of `env`, and the env and arguments that make the CLI speak it.
    #[serde(default)]
    pub by_protocol: BTreeMap<crate::protocol::ApiProtocol, ProtocolEnv>,
    /// The CLI ignores a provider without a model: the run fails, saying so, instead of falling back to its login.
    #[serde(default)]
    pub needs_model: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolEnv {
    pub env: Option<ProviderNames>,
    #[serde(default)]
    pub set: BTreeMap<String, String>,
    #[serde(default)]
    pub args: Vec<String>,
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
    Env {
        names: Vec<String>,
        label: String,
    },
    EnvFile {
        files: Vec<String>,
        keys: Vec<String>,
        label: String,
    },
    YamlKey {
        file: String,
        key: String,
        label: String,
    },
    JsonValue {
        file: String,
        pointer: String,
        equals: String,
        label: String,
        #[serde(default, rename = "loggedOut")]
        logged_out: bool,
    },
    JsonKeys {
        file: String,
    },
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
                LoginCheck::JsonValue { file, pointer, equals, label, logged_out } => {
                    let v = std::fs::read_to_string(path(file))
                        .ok()
                        .and_then(|t| serde_json::from_str::<Value>(&strip_comments(&t)).ok());
                    if v.as_ref().and_then(|v| v.pointer(pointer)?.as_str()) == Some(equals.as_str()) {
                        return Some(match logged_out {
                            true => t!("未登录 · {why}", why = label).to_string(),
                            false => logged(label),
                        });
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
        match (&self.spec.install.npm, &self.spec.install.command) {
            (Some(npm), _) => t!(
                "这台电脑上没有 {agent}，请安装：npm install -g {npm}，或在桌面端「执行 → Agent」页托管安装（或运行 gg agents install）",
                agent = self.spec.title,
                npm = npm
            ),
            (None, command) => t!(
                "这台电脑上没有 {agent}，请在这台电脑的终端运行：{command}",
                agent = self.spec.title,
                command = command.as_deref().unwrap_or(&self.spec.install.bin)
            ),
        }
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
mod tests;
