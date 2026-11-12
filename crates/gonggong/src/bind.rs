use crate::config::{Config, Trust};
use crate::protocol::{
    AgentKind, CreateBot, DaemonLoginReq, DaemonLoginRes, LinkPollReq, LinkPollRes, LinkRequestReq, LinkRequestRes,
    LoginBot, MachineInfo, SystemInfo,
};
use crate::t;
use crate::tls;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Networks, System};

/// This machine as reported to the server; the name drops any DNS suffix (`wanglei-mbp.local` → `wanglei-mbp`).
pub fn machine_info() -> MachineInfo {
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let name = host.split('.').next().filter(|s| !s.is_empty()).unwrap_or("unknown").to_string();
    MachineInfo {
        name,
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        hardware_id: hardware_id(),
        system: Some(system_info()),
    }
}

/// The OS machine id survives network and hostname changes; hashed so the raw id never leaves the host.
/// `GONGGONG_MACHINE_ID` overrides it for several isolated instances on one host (e2e, one GONGGONG_HOME each).
fn hardware_id() -> Option<String> {
    let id = std::env::var("GONGGONG_MACHINE_ID").ok().filter(|s| !s.is_empty()).or_else(|| machine_uid::get().ok())?;
    let id = id.trim();
    (!id.is_empty()).then(|| Sha256::digest(format!("gonggong:{id}")).iter().map(|b| format!("{b:02x}")).collect())
}

fn system_info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    sys.refresh_cpu_list(CpuRefreshKind::nothing());
    SystemInfo {
        os_version: System::long_os_version(),
        kernel: System::kernel_version(),
        cpu_model: sys.cpus().first().map(|c| c.brand().trim().to_string()).filter(|s| !s.is_empty()),
        cpu_cores: u32::try_from(sys.cpus().len()).ok().filter(|&n| n > 0),
        memory_bytes: Some(sys.total_memory()).filter(|&n| n > 0),
        mac_address: mac_address(),
    }
}

/// Display only: physical-looking interfaces (en*/eth*/wl*) first, virtual ones and loopback have no MAC or rank last.
fn mac_address() -> Option<String> {
    Networks::new_with_refreshed_list()
        .iter()
        .filter(|(_, n)| !n.mac_address().is_unspecified())
        .min_by_key(|(name, _)| (!["en", "eth", "wl"].iter().any(|p| name.starts_with(p)), name.to_string()))
        .map(|(_, n)| n.mac_address().to_string())
}

/// What binding needs, from a 接入链接 `gonggong://bind?server=…&code=…` (plan J1) or the equivalent
/// `gg login` command line as copied from the Web.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    /// http(s), without a trailing `/`.
    pub server: String,
    /// Upper case `XXXX-XXXX`.
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    /// `--create-bot <agent>` of a pasted command (Agent 自助接入).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_bot: Option<AgentKind>,
}

const LINK_SCHEME: &str = "gonggong";
const LINK_HOST: &str = "bind";

/// Parses a pasted 接入链接 or `gg login --server … --code …` (flags in any order, `--flag=value` too); surrounding
/// whitespace and quotes are ignored. `fp` / `--fingerprint` explicitly trust a self-signed certificate.
pub fn parse_link(input: &str) -> Result<Link> {
    let input = unquote(input.trim());
    if input.starts_with(&format!("{LINK_SCHEME}:")) { link_of_url(input) } else { link_of_command(input) }
}

fn unquote(s: &str) -> &str {
    ['\'', '"'].iter().find_map(|q| s.strip_prefix(*q)?.strip_suffix(*q)).unwrap_or(s)
}

fn link_of_url(input: &str) -> Result<Link> {
    let url = reqwest::Url::parse(input).context(t!("接入链接格式错误"))?;
    if url.scheme() != LINK_SCHEME || url.host_str() != Some(LINK_HOST) {
        bail!(t!("不是共工空间的接入链接"));
    }
    let param = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());
    checked(param("server"), param("code"), param("fp"))
}

fn link_of_command(input: &str) -> Result<Link> {
    let words: Vec<&str> = input.split_whitespace().filter(|w| *w != "\\").collect();
    let [gg, login, args @ ..] = words.as_slice() else {
        bail!(t!("无法识别：请粘贴接入链接或 gg login 命令"))
    };
    if *gg != "gg" || *login != "login" {
        bail!(t!("无法识别：请粘贴接入链接或 gg login 命令"));
    }
    if let [link, rest @ ..] = args
        && !link.starts_with("--")
    {
        let mut parsed = link_of_url(unquote(link))?;
        parsed.create_bot = match flags(rest)?.as_slice() {
            [] => None,
            [("create-bot", agent)] => Some(agent_kind(agent)?),
            [(name, _), ..] => bail!(t!("gg login 命令中有无法识别的参数 {arg}", arg = format!("--{name}"))),
        };
        return Ok(parsed);
    }
    let (mut server, mut code, mut fingerprint, mut create_bot) = (None, None, None::<String>, None);
    for (name, value) in flags(args)? {
        let slot = match name {
            "server" => &mut server,
            "code" => &mut code,
            "fingerprint" => &mut fingerprint,
            "create-bot" => {
                create_bot = Some(agent_kind(&value)?);
                continue;
            }
            _ => bail!(t!("gg login 命令中有无法识别的参数 {arg}", arg = format!("--{name}"))),
        };
        *slot = Some(value);
    }
    let mut link = checked(server, code, fingerprint)?;
    link.create_bot = create_bot;
    Ok(link)
}

fn agent_kind(value: &str) -> Result<AgentKind> {
    crate::configure::parse_kind(value).map_err(|e| anyhow::anyhow!("--create-bot: {e}"))
}

/// `--name value` / `--name=value` pairs, values unquoted.
fn flags<'a>(args: &[&'a str]) -> Result<Vec<(&'a str, String)>> {
    let mut out = vec![];
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let Some(flag) = arg.strip_prefix("--") else {
            bail!(t!("gg login 命令中有无法识别的参数 {arg}", arg = arg))
        };
        let (name, value) = match flag.split_once('=') {
            Some((name, value)) => (name, value),
            None => (
                flag,
                *args.next().filter(|v| !v.starts_with("--")).with_context(|| t!("--{flag} 缺少值", flag = flag))?,
            ),
        };
        out.push((name, unquote(value).to_string()));
    }
    Ok(out)
}

fn checked(server: Option<String>, code: Option<String>, fingerprint: Option<String>) -> Result<Link> {
    let server = server.context(t!("缺少服务器地址"))?;
    let server = server.trim().trim_end_matches('/');
    let url = reqwest::Url::parse(server).with_context(|| t!("服务器地址格式错误：{server}", server = server))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        bail!(t!("服务器地址必须是 http(s) 地址：{server}", server = server));
    }
    // Requests are built as `{server}/api/…`: anything past the path would swallow it.
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        bail!(t!("服务器地址不能包含账号、查询参数或 #：{server}", server = server));
    }
    tls::validate_server(server)?;
    let code = code.context(t!("缺少接入链接中的代码"))?.trim().to_uppercase();
    let valid = |part: &str| part.len() == 4 && part.chars().all(|c| c.is_ascii_alphanumeric());
    if !code.split_once('-').is_some_and(|(a, b)| valid(a) && valid(b)) {
        bail!(t!("接入链接中的代码格式应为 XXXX-XXXX"));
    }
    let fingerprint = fingerprint
        .map(|value| Trust::fingerprint(&value).map(|trust| trust.fingerprint_value().unwrap().to_owned()))
        .transpose()?;
    Ok(Link { server: server.into(), code, fingerprint, create_bot: None })
}

#[derive(Deserialize)]
struct ApiError {
    error: String,
    message: String,
}

/// Exchanges the one-time code of a connect link for this machine's long-lived token.
/// Returns the config and whether the server restored this host's earlier machine.
pub async fn login(server: &str, code: &str, machine: MachineInfo, trust: Trust) -> Result<(Config, bool)> {
    login_as(server, code, machine, trust, None).await.map(|l| (l.config, l.restored))
}

/// What a login brought back.
pub struct Login {
    pub config: Config,
    /// The server restored this host's earlier machine.
    pub restored: bool,
    /// The bot `create_bot` asked for, with the DM made for it.
    pub bot: Option<LoginBot>,
}

/// [`login`], asking the server to make a bot of `create_bot` on this machine (Agent 自助接入).
pub async fn login_as(
    server: &str,
    code: &str,
    machine: MachineInfo,
    trust: Trust,
    create_bot: Option<AgentKind>,
) -> Result<Login> {
    let server = server.trim_end_matches('/');
    let config = Config {
        server: server.into(),
        token: String::new(),
        machine_id: String::new(),
        owner_name: String::new(),
        tls_trust: Some(trust),
    };
    let res = tls::http(&config)?
        .post(format!("{server}/api/daemon/login"))
        .json(&DaemonLoginReq {
            code: code.trim().to_uppercase(),
            machine,
            create_bot: create_bot.map(|agent| CreateBot { agent }),
        })
        .send()
        .await
        .with_context(|| t!("无法连接服务器 {server}", server = server))?;
    if !res.status().is_success() {
        let status = res.status();
        let reason = match res.json::<ApiError>().await {
            Ok(e) => match e.error.as_str() {
                "code_expired" => return Err(CodeExpired.into()),
                "code_locked" => t!("接入链接尝试次数过多，已锁定，请稍后在 Web 端重新生成").into(),
                "unauthorized" => t!("接入链接无效，请核对后重试").into(),
                "invalid" => t!("接入链接中的代码格式应为 XXXX-XXXX").into(),
                _ => e.message,
            },
            Err(_) => t!("服务器返回 {status}", status = status),
        };
        bail!(t!("绑定失败：{reason}", reason = reason));
    }
    let body: DaemonLoginRes = res.json().await.context(t!("服务器响应无法解析"))?;
    Ok(logged_in(config, body))
}

fn logged_in(config: Config, body: DaemonLoginRes) -> Login {
    let config = Config { token: body.token, machine_id: body.machine_id, owner_name: body.owner_name, ..config };
    Login { config, restored: body.restored, bot: body.bot }
}

/// The 接入码 was expired or already used; [`connect`] then asks for a confirmation on the web instead.
#[derive(Debug)]
struct CodeExpired;

impl std::fmt::Display for CodeExpired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let reason = t!("接入链接已失效（已过期或已被使用），请在 Web 端重新生成");
        f.write_str(&t!("绑定失败：{reason}", reason = reason))
    }
}

impl std::error::Error for CodeExpired {}

pub struct Connect<'a> {
    /// Where the request being waited on is kept (`pending-link.json`), so a rerun after an interrupted wait goes on.
    pub home: &'a Path,
    /// Fail on an expired code instead of asking the web (unattended setups such as Docker).
    pub code_only: bool,
    pub open_browser: bool,
}

/// A link request being waited on.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    server: String,
    #[serde(flatten)]
    request: LinkRequestRes,
}

/// `gg login`: the 接入码 when it still works, otherwise (or without one) a request the user allows on the web.
pub async fn connect(
    server: &str,
    code: Option<&str>,
    machine: MachineInfo,
    trust: Trust,
    create_bot: Option<AgentKind>,
    opts: Connect<'_>,
) -> Result<Login> {
    let server = server.trim_end_matches('/');
    if let Some(code) = code {
        match login_as(server, code, machine.clone(), trust.clone(), create_bot).await {
            Err(e) if !opts.code_only && e.is::<CodeExpired>() => {}
            done => return done,
        }
    }
    let config = Config {
        server: server.into(),
        token: String::new(),
        machine_id: String::new(),
        owner_name: String::new(),
        tls_trust: Some(trust),
    };
    let http = tls::http(&config)?;
    let file = opts.home.join("pending-link.json");
    let resumed = std::fs::read(&file)
        .ok()
        .and_then(|b| serde_json::from_slice::<Pending>(&b).ok())
        .filter(|p| p.server == server)
        .map(|p| p.request);
    let (mut request, mut heading) = match resumed {
        Some(r) => (r, t!("继续等待上次的接入申请：")),
        None => {
            let heading = match code {
                Some(_) => t!("接入码已过期或已用过，改为在网页上确认这台机器："),
                None => t!("请在网页上确认这台机器："),
            };
            (request_link(&http, server, code, &machine, create_bot).await?, heading)
        }
    };
    let mut renewed = false;
    loop {
        save_pending(&file, &Pending { server: server.into(), request: request.clone() })?;
        println!("{heading}");
        prompt(&request, opts.open_browser);
        let interval =
            std::time::Duration::from_millis(if request.interval_ms == 0 { 3000 } else { request.interval_ms });
        let ended = loop {
            match poll_link(&http, server, &request).await? {
                Some(LinkPollRes::Pending) => tokio::time::sleep(interval).await,
                other => break other,
            }
        };
        let _ = std::fs::remove_file(&file);
        match ended {
            Some(LinkPollRes::Approved(body)) => return Ok(logged_in(config, body)),
            Some(LinkPollRes::Denied) => {
                bail!(t!("接入申请已被拒绝；如需接入，请重新运行 gg login --server {server}", server = server))
            }
            // Expired, or gone from the server (a stale saved request): one fresh request, then give up.
            _ if !renewed => {
                renewed = true;
                heading = t!("接入申请已过期，已重新发起：");
                request = request_link(&http, server, code, &machine, create_bot).await?;
            }
            _ => bail!(t!(
                "接入申请一直没有人确认，已停止等待；准备好后请重新运行 gg login --server {server}",
                server = server
            )),
        }
    }
}

async fn request_link(
    http: &reqwest::Client,
    server: &str,
    code: Option<&str>,
    machine: &MachineInfo,
    create_bot: Option<AgentKind>,
) -> Result<LinkRequestRes> {
    let res = http
        .post(format!("{server}/api/daemon/link-requests"))
        .json(&LinkRequestReq {
            machine: machine.clone(),
            create_bot: create_bot.map(|agent| CreateBot { agent }),
            code: code.map(|c| c.trim().to_uppercase()),
        })
        .send()
        .await
        .with_context(|| t!("无法连接服务器 {server}", server = server))?;
    let status = res.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        // A server from before web confirmation.
        if code.is_some() {
            return Err(CodeExpired.into());
        }
        bail!(t!("绑定失败：服务器版本较旧，请在 Web 端重新生成接入链接"));
    }
    if !status.is_success() {
        let reason = match res.json::<ApiError>().await {
            Ok(e) if e.error == "code_locked" => t!("待确认的接入申请过多，请稍后再试").into(),
            Ok(e) => e.message,
            Err(_) => t!("服务器返回 {status}", status = status),
        };
        bail!(t!("绑定失败：{reason}", reason = reason));
    }
    res.json().await.context(t!("服务器响应无法解析"))
}

/// `None`: the server no longer knows this request (or its secret), e.g. one saved by an earlier run.
async fn poll_link(http: &reqwest::Client, server: &str, request: &LinkRequestRes) -> Result<Option<LinkPollRes>> {
    let res = http
        .post(format!("{server}/api/daemon/link-requests/{}/poll", request.id))
        .json(&LinkPollReq { secret: request.secret.clone() })
        .send()
        .await
        .with_context(|| t!("无法连接服务器 {server}", server = server))?;
    let status = res.status();
    if matches!(status.as_u16(), 401 | 404 | 409) {
        return Ok(None);
    }
    if !status.is_success() {
        bail!(t!("绑定失败：{reason}", reason = t!("服务器返回 {status}", status = status)));
    }
    res.json().await.map(Some).context(t!("服务器响应无法解析"))
}

fn save_pending(file: &Path, pending: &Pending) -> Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, serde_json::to_vec_pretty(pending)?)?;
    // It holds the request's secret.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// What the user (or the agent relaying it) needs: where to allow this machine and the code to check there.
fn prompt(request: &LinkRequestRes, open_browser: bool) {
    println!("  {}", t!("确认链接：{url}", url = request.url));
    println!("  {}", t!("核对码：{code}（与网页上显示的一致再点「允许接入」）", code = request.user_code));
    println!("{}", t!("等待确认…命令中断后重新运行同一条命令会接着等"));
    if open_browser {
        open_url(&request.url);
    }
}

/// Best effort: a desktop session opens the link itself; a headless one only has the printed link.
fn open_url(url: &str) {
    let graphical = std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some();
    let cmd = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "linux") && graphical {
        "xdg-open"
    } else {
        return;
    };
    let _ = std::process::Command::new(cmd)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// Voids this machine's token on the server; the machine itself stays so logging in again restores it.
pub async fn logout(config: &Config) -> Result<()> {
    let url = format!("{}/api/daemon/logout", config.server);
    let res = tls::http(config)?.post(url).bearer_auth(&config.token).send().await?;
    crate::bots::ok(res).await.map(drop)
}
