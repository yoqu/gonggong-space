//! CLI connectors (plan 连接器-体验升级方案 §5.3): the daemon finds, installs, logs in and out the CLI behind a
//! connector itself, so connecting never goes through a chat turn. Every command is built in per driver
//! ([`drivers`]); the server only picks the driver, the profile and the action.
pub mod drivers;
mod shim;

use crate::config::Settings;
use crate::protocol::{
    ConnectorCliState, ConnectorDriver, ConnectorProbe, ConnectorProfile, ConnectorSpec, ConnectorsAction,
    ConnectorsAuth, ConnectorsAuthStep, ConnectorsCmd, ConnectorsResult, ConnectorsStage, DaemonToServer,
};
use crate::service::Outbox;
use crate::t;
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Notify;

pub use shim::run_path;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// A call that talks to the server (starting a login, reading the user).
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the person has to approve a login (or create the app).
pub const AUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const SWEEP: Duration = Duration::from_secs(30 * 60);
const RENEW_EVERY_SECS: i64 = 24 * 3600;
const LINE_MAX_BYTES: usize = 2 << 10;
const PROGRESS_MAX_BYTES: usize = 256 << 10;

pub fn connectors_dir(home: &Path) -> PathBuf {
    crate::tools::tools_dir(home).join("connectors")
}

fn install_dir(home: &Path, connector: &str) -> PathBuf {
    connectors_dir(home).join(connector)
}

/// The `node_modules/.bin` of every connector CLI installed here.
pub fn managed_bins(home: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(connectors_dir(home)) else { return vec![] };
    let mut bins: Vec<_> = entries
        .flatten()
        .filter(|e| e.file_name() != "shims")
        .map(|e| e.path().join("node_modules").join(".bin"))
        .filter(|b| b.is_dir())
        .collect();
    bins.sort();
    bins
}

/// What the daemon keeps across restarts: the member profiles it made, and when it last renewed the logins.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    profiles: BTreeMap<String, BTreeSet<ConnectorProfile>>,
    #[serde(default)]
    /// Unix seconds.
    renewed_at: Option<i64>,
}

impl State {
    fn path(home: &Path) -> PathBuf {
        home.join("connectors.json")
    }

    fn load(home: &Path) -> State {
        std::fs::read(Self::path(home)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn save(&self, home: &Path) {
        let write = || -> Result<()> {
            std::fs::create_dir_all(home)?;
            let tmp = home.join(format!(".connectors.json.{}", uuid::Uuid::new_v4()));
            std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
            Ok(std::fs::rename(tmp, Self::path(home))?)
        };
        if let Err(e) = write() {
            tracing::warn!("connectors state not saved: {e:#}");
        }
    }
}

/// Who a ready profile is, read by a call as the user (not on every probe: it may refresh the token).
#[derive(Debug, Clone, Default)]
struct Known {
    account_id: Option<String>,
    account: Option<String>,
    user_id: Option<String>,
}

#[derive(Clone)]
pub struct Connectors(Arc<Inner>);

struct Inner {
    home: PathBuf,
    /// Where to look for the CLIs instead of PATH and the usual install dirs (tests).
    search: Option<OsString>,
    specs: Mutex<Vec<ConnectorSpec>>,
    out: Mutex<Option<Outbox>>,
    running: Mutex<HashMap<String, Arc<Notify>>>,
    known: Mutex<HashMap<(ConnectorDriver, ConnectorProfile), Known>>,
    state: Mutex<()>,
    sweeping: AtomicBool,
}

impl Connectors {
    pub fn new(home: PathBuf) -> Self {
        Self::build(home, None)
    }

    /// Looks for the CLIs only in `path` and the managed install dirs.
    pub fn with_search_path(home: PathBuf, path: OsString) -> Self {
        Self::build(home, Some(path))
    }

    fn build(home: PathBuf, search: Option<OsString>) -> Self {
        Connectors(Arc::new(Inner {
            home,
            search,
            specs: Mutex::default(),
            out: Mutex::default(),
            running: Mutex::default(),
            known: Mutex::default(),
            state: Mutex::default(),
            sweeping: AtomicBool::new(false),
        }))
    }

    /// connectors.sync: watch these, report them now and every 30 minutes, renew the logins daily.
    pub fn sync(&self, specs: Vec<ConnectorSpec>, out: &Outbox) {
        *self.0.specs.lock().unwrap() = specs;
        *self.0.out.lock().unwrap() = Some(out.clone());
        let this = self.clone();
        tokio::spawn(async move { this.report().await });
        if !self.0.sweeping.swap(true, Ordering::Relaxed) {
            let this = self.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(SWEEP).await;
                    this.renew_due().await;
                    this.report().await;
                }
            });
        }
    }

    /// Before a run starts: the server learns of a login that lapsed meanwhile.
    pub fn before_run(&self) {
        if self.0.out.lock().unwrap().is_some() {
            let this = self.clone();
            tokio::spawn(async move { this.report().await });
        }
    }

    /// connectors.update with every watched connector's `default` profile and the member profiles made here.
    pub async fn report(&self) {
        let Some(out) = self.0.out.lock().unwrap().clone() else { return };
        out.send(DaemonToServer::ConnectorsUpdate { probes: self.probe_all().await });
    }

    pub async fn probe_all(&self) -> Vec<ConnectorProbe> {
        let specs = self.0.specs.lock().unwrap().clone();
        let profiles = State::load(&self.0.home).profiles;
        let mut probes = vec![];
        for spec in &specs {
            let mut list = vec![ConnectorProfile::default_profile()];
            list.extend(profiles.get(&spec.connector).into_iter().flatten().cloned());
            for p in list {
                probes.push(self.probe(spec, &p, false).await);
            }
        }
        probes
    }

    /// Renews the ready logins once a day (plan §6): a call as the user refreshes a token that is due.
    async fn renew_due(&self) {
        let now = chrono::Utc::now().timestamp();
        if State::load(&self.0.home).renewed_at.is_some_and(|at| now - at < RENEW_EVERY_SECS) {
            return;
        }
        for probe in self.probe_all().await.into_iter().filter(|p| p.state == ConnectorCliState::Ready) {
            if let Err(e) = self.renew(probe.driver, &probe.profile).await {
                tracing::warn!("renewing {} {} failed: {e:#}", probe.connector, probe.profile);
            }
        }
        self.update_state(|s| s.renewed_at = Some(now));
    }

    fn update_state(&self, f: impl FnOnce(&mut State)) {
        let _lock = self.0.state.lock().unwrap();
        let mut state = State::load(&self.0.home);
        f(&mut state);
        state.save(&self.0.home);
    }

    /// The driver's CLI: on PATH (and the login shell's), in the usual install dirs, then the managed ones.
    pub async fn locate(&self, driver: ConnectorDriver) -> Option<PathBuf> {
        let (home, search) = (self.0.home.clone(), self.0.search.clone());
        tokio::task::spawn_blocking(move || locate(&home, search.as_deref(), driver.binary())).await.ok().flatten()
    }

    /// The state of `profile`. `read_user`: also read who it is (an API call as the user).
    pub async fn probe(&self, spec: &ConnectorSpec, profile: &ConnectorProfile, read_user: bool) -> ConnectorProbe {
        let mut probe = ConnectorProbe {
            connector: spec.connector.clone(),
            driver: spec.driver,
            profile: profile.clone(),
            state: ConnectorCliState::NotInstalled,
            account: None,
            feishu_user_id: None,
            expires_at: None,
            refresh_expires_at: None,
            version: None,
            detail: None,
        };
        let Some(cli) = self.locate(spec.driver).await else { return probe };
        probe.version = self
            .output(&cli, &["--version".into()], PROBE_TIMEOUT)
            .await
            .ok()
            .and_then(|o| crate::agents::parse_version(&String::from_utf8_lossy(&o.stdout)));
        let out = match self.output(&cli, &drivers::status_args(spec.driver, profile), PROBE_TIMEOUT).await {
            Ok(out) => out,
            Err(e) => {
                probe.state = ConnectorCliState::Error;
                probe.detail = Some(format!("{e:#}"));
                return probe;
            }
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        let status = match spec.driver {
            // lark-cli 1.0.100 prints its errors (`not_configured`) to stderr.
            ConnectorDriver::LarkCli => {
                drivers::lark_status(&format!("{stdout}\n{}", String::from_utf8_lossy(&out.stderr)))
            }
            ConnectorDriver::Meegle => drivers::meegle_status(&stdout, chrono::Utc::now()),
        };
        probe.state = status.state.unwrap_or(ConnectorCliState::Error);
        probe.detail = status.detail.clone().or_else(|| status.state.is_none().then(|| tail(&out)));
        probe.expires_at = status.expires_at.clone();
        probe.refresh_expires_at = status.refresh_expires_at.clone();
        let key = (spec.driver, profile.clone());
        if probe.state != ConnectorCliState::Ready {
            self.0.known.lock().unwrap().remove(&key);
            return probe;
        }
        let cached = self.0.known.lock().unwrap().get(&key).filter(|k| k.account_id == status.account_id).cloned();
        let known = match cached {
            Some(k) if !read_user => k,
            _ if read_user || status.fresh => {
                let k = self.whoami(&cli, spec.driver, profile, status.account_id.clone()).await;
                self.0.known.lock().unwrap().insert(key, k.clone());
                k
            }
            _ => Known::default(),
        };
        probe.account = status.account.or(known.account);
        probe.feishu_user_id = known.user_id;
        probe
    }

    async fn whoami(
        &self,
        cli: &Path,
        driver: ConnectorDriver,
        profile: &ConnectorProfile,
        account_id: Option<String>,
    ) -> Known {
        let out = self.output(cli, &drivers::whoami_args(driver, profile), PROBE_TIMEOUT).await;
        let (account, user_id) =
            out.map(|o| drivers::whoami(driver, &String::from_utf8_lossy(&o.stdout))).unwrap_or_default();
        Known { account_id, account, user_id }
    }

    async fn renew(&self, driver: ConnectorDriver, profile: &ConnectorProfile) -> Result<()> {
        let cli = self.locate(driver).await.context(t!("未安装 {cli}", cli = driver.binary()))?;
        let out = self.output(&cli, &drivers::whoami_args(driver, profile), CALL_TIMEOUT).await?;
        if !out.status.success() {
            bail!(tail(&out));
        }
        Ok(())
    }

    /// connectors.cmd, answered by connectors.progress / connectors.auth and then connectors.result (and an update).
    pub fn cmd(&self, cmd: ConnectorsCmd, out: &Outbox) {
        if cmd.action == ConnectorsAction::Cancel {
            if let Some(cancel) = self.0.running.lock().unwrap().get(&cmd.request_id) {
                cancel.notify_one();
            }
            return;
        }
        let cancel = Arc::new(Notify::new());
        self.0.running.lock().unwrap().insert(cmd.request_id.clone(), cancel.clone());
        let (this, out) = (self.clone(), out.clone());
        tokio::spawn(async move {
            let result = tokio::select! {
                r = this.act(&cmd, &out) => r,
                _ = cancel.notified() => Err(anyhow::anyhow!(t!("已取消连接"))),
            };
            this.0.running.lock().unwrap().remove(&cmd.request_id);
            let probe = this.probe(&cmd.spec, &cmd.profile, result.is_ok()).await;
            let result = result.and_then(|()| match cmd.action {
                ConnectorsAction::Connect if probe.state != ConnectorCliState::Ready => {
                    bail!("{}", incomplete_login_error(probe.detail.as_deref()))
                }
                _ => Ok(()),
            });
            if !cmd.profile.is_default() {
                let (connector, profile) = (cmd.spec.connector.clone(), cmd.profile.clone());
                match cmd.action {
                    ConnectorsAction::Connect if result.is_ok() => {
                        this.update_state(|s| _ = s.profiles.entry(connector).or_default().insert(profile))
                    }
                    ConnectorsAction::Logout if result.is_ok() => this.update_state(|s| {
                        if let Some(set) = s.profiles.get_mut(&connector) {
                            set.remove(&profile);
                        }
                    }),
                    _ => {}
                }
            }
            out.send(DaemonToServer::ConnectorsResult(ConnectorsResult {
                request_id: cmd.request_id.clone(),
                ok: result.is_ok(),
                error: result.err().map(|e| format!("{e:#}")),
                probe: Some(probe),
            }));
            this.report().await;
        });
    }

    async fn act(&self, cmd: &ConnectorsCmd, out: &Outbox) -> Result<()> {
        check(cmd)?;
        let driver = cmd.spec.driver;
        let missing = || t!("未安装 {cli}", cli = driver.binary());
        match cmd.action {
            ConnectorsAction::Detect | ConnectorsAction::Cancel => Ok(()),
            ConnectorsAction::Renew => self.renew(driver, &cmd.profile).await,
            ConnectorsAction::Logout => {
                let cli = self.locate(driver).await.with_context(missing)?;
                let out = self.output(&cli, &drivers::logout_args(&cmd.profile), CALL_TIMEOUT).await?;
                if !out.status.success() {
                    bail!(t!("退出登录失败：{output}", output = tail(&out)));
                }
                Ok(())
            }
            ConnectorsAction::Connect => self.connect(cmd, &Reporter::new(&cmd.request_id, out)).await,
        }
    }

    /// Installs when missing, binds an app when needed (lark-cli), then logs in and waits for the person.
    async fn connect(&self, cmd: &ConnectorsCmd, r: &Reporter<'_>) -> Result<()> {
        let (spec, profile) = (&cmd.spec, &cmd.profile);
        let cli = match self.locate(spec.driver).await {
            Some(cli) => cli,
            None => self.install(spec, r).await?,
        };
        let probe = self.probe(spec, profile, false).await;
        match probe.state {
            ConnectorCliState::Ready if cmd.domains.is_empty() => return Ok(()),
            ConnectorCliState::NeedsInit if spec.driver == ConnectorDriver::LarkCli => {
                within(self.lark_init(&cli, profile, r)).await?
            }
            ConnectorCliState::Error => bail!("{}", probe_error_detail(probe.detail.as_deref())),
            _ => {}
        }
        match spec.driver {
            ConnectorDriver::LarkCli => within(self.lark_login(spec, &cli, profile, &cmd.domains, r)).await,
            ConnectorDriver::Meegle => within(self.meegle_login(&cli, profile, r)).await,
        }
    }

    async fn install(&self, spec: &ConnectorSpec, r: &Reporter<'_>) -> Result<PathBuf> {
        let home = &self.0.home;
        let node = crate::tools::ensure_node(home, &|l| r.progress(ConnectorsStage::Node, l)).await?;
        let settings = Settings::load(home)?;
        let dir = install_dir(home, &spec.connector);
        std::fs::create_dir_all(&dir)?;
        let pkg = drivers::npm_package(spec.driver);
        r.progress(
            ConnectorsStage::Install,
            &t!("安装 {spec}（{registry}）", spec = pkg, registry = settings.mirror.registry()),
        );
        let mut npm = node.npm()?;
        npm.args(["install", "--prefix"]).arg(&dir).args(["--registry", settings.mirror.registry()]);
        npm.args(["--no-audit", "--no-fund", pkg]).envs(settings.child_env());
        crate::tools::run(npm, &|l| r.progress(ConnectorsStage::Install, l)).await?;
        self.locate(spec.driver)
            .await
            .with_context(|| t!("{pkg} 安装后仍找不到 {cli}", pkg = pkg, cli = spec.driver.binary()))
    }

    /// `lark-cli config init --new`: prints a link for the person to create their app, exits once they did. A
    /// member's profile must not become the CLI's current one, or the owner's own calls would run as them.
    async fn lark_init(&self, cli: &Path, profile: &ConnectorProfile, r: &Reporter<'_>) -> Result<()> {
        let before = self.lark_active(cli).await;
        let sent = AtomicBool::new(false);
        let (status, last) = self
            .stream(cli, &drivers::lark_init_args(profile), |line| {
                if let Some(url) = drivers::init_url(line).filter(|_| !sent.swap(true, Ordering::Relaxed)) {
                    r.auth(ConnectorsAuthStep::Init, url, None, None);
                }
                if !drivers::is_qr_row(line) {
                    r.progress(ConnectorsStage::Init, line);
                }
            })
            .await?;
        if !status.success() {
            bail!(t!("创建飞书应用未完成：{output}", output = last));
        }
        if let Some(before) = before.filter(|_| !profile.is_default())
            && self.lark_active(cli).await.is_some_and(|now| now != before)
        {
            self.output(cli, &["profile".into(), "use".into(), before], PROBE_TIMEOUT).await?;
        }
        Ok(())
    }

    /// lark-cli's current profile (`profile list`).
    async fn lark_active(&self, cli: &Path) -> Option<String> {
        let out = self.output(cli, &["profile".into(), "list".into()], PROBE_TIMEOUT).await.ok()?;
        let list: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).ok()?;
        list.iter().find(|p| p["active"] == true)?["name"].as_str().map(String::from)
    }

    async fn lark_login(
        &self,
        spec: &ConnectorSpec,
        cli: &Path,
        profile: &ConnectorProfile,
        domains: &[String],
        r: &Reporter<'_>,
    ) -> Result<()> {
        let out = self.output(cli, &drivers::lark_login_args(profile, domains), CALL_TIMEOUT).await?;
        let login = drivers::device_login(&String::from_utf8_lossy(&out.stdout))
            .with_context(|| t!("无法开始登录：{output}", output = tail(&out)))?;
        r.auth(ConnectorsAuthStep::Login, login.url.clone(), login.user_code.clone(), expires_at(login.expires_in));
        let (status, last) = self
            .stream(cli, &drivers::lark_wait_args(profile, &login.device_code), |l| {
                r.progress(ConnectorsStage::Login, l)
            })
            .await?;
        // A person who leaves some scopes out makes lark-cli exit non-zero, yet the login works.
        if !status.success() && self.probe(spec, profile, false).await.state != ConnectorCliState::Ready {
            bail!("{}", incomplete_login_error(Some(&last)));
        }
        Ok(())
    }

    async fn meegle_login(&self, cli: &Path, profile: &ConnectorProfile, r: &Reporter<'_>) -> Result<()> {
        let out = self.output(cli, &drivers::meegle_init_args(profile), CALL_TIMEOUT).await?;
        let login = drivers::device_login(&String::from_utf8_lossy(&out.stdout))
            .with_context(|| t!("无法开始登录：{output}", output = tail(&out)))?;
        let client_id = login.client_id.clone().with_context(|| t!("无法开始登录：{output}", output = tail(&out)))?;
        r.auth(ConnectorsAuthStep::Login, login.url.clone(), login.user_code.clone(), expires_at(login.expires_in));
        let poll = drivers::meegle_poll_args(profile, &login.device_code, &client_id);
        loop {
            tokio::time::sleep(Duration::from_secs(login.interval.unwrap_or(5).max(1))).await;
            let out = self.output(cli, &poll, CALL_TIMEOUT).await?;
            let stdout = String::from_utf8_lossy(&out.stdout);
            if drivers::meegle_pending(&stdout) {
                continue;
            }
            return match drivers::meegle_poll_status(&stdout).and_then(|s| meegle_poll_error(&s)) {
                Some(msg) => bail!("{msg}"),
                None => Ok(()),
            };
        }
    }

    /// A CLI command: the CLI's own dir and the managed Node first on PATH, so its `#!/usr/bin/env node` runs.
    fn command(&self, cli: &Path, args: &[String]) -> tokio::process::Command {
        let mut dirs: Vec<PathBuf> = cli.parent().map(Path::to_path_buf).into_iter().collect();
        dirs.extend(crate::tools::runtime_bin(&self.0.home));
        dirs.extend(
            std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default(),
        );
        let mut cmd = crate::proc::async_command(cli);
        cmd.args(args).stdin(Stdio::null()).kill_on_drop(true);
        if let Ok(path) = std::env::join_paths(dirs) {
            cmd.env("PATH", path);
        }
        // lark-cli refuses `config init` inside these agents' workspaces.
        cmd.env_remove("OPENCLAW_HOME").env_remove("HERMES_HOME");
        cmd
    }

    async fn output(&self, cli: &Path, args: &[String], limit: Duration) -> Result<std::process::Output> {
        let run = self.command(cli, args).stdout(Stdio::piped()).stderr(Stdio::piped()).output();
        let label = program_label(cli);
        match tokio::time::timeout(limit, run).await {
            Ok(out) => Ok(out.with_context(|| t!("无法启动 {program}", program = label))?),
            Err(_) => bail!(t!("{program} 未在 {secs} 秒内响应", program = label, secs = limit.as_secs())),
        }
    }

    /// Runs a CLI until it exits, handing on each output line; its exit status and last lines.
    async fn stream(&self, cli: &Path, args: &[String], on_line: impl Fn(&str)) -> Result<(ExitStatus, String)> {
        let mut child = self
            .command(cli, args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| t!("无法启动 {program}", program = program_label(cli)))?;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        for pipe in [
            Box::new(child.stdout.take().expect("piped")) as Box<dyn tokio::io::AsyncRead + Unpin + Send>,
            Box::new(child.stderr.take().expect("piped")),
        ] {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(pipe).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() && tx.send(line).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);
        let mut last = VecDeque::new();
        while let Some(line) = rx.recv().await {
            on_line(&line);
            if !drivers::is_qr_row(&line) {
                last.push_back(line);
                if last.len() > 5 {
                    last.pop_front();
                }
            }
        }
        Ok((child.wait().await?, Vec::from(last).join("\n")))
    }
}

/// Sends a request's progress lines (capped) and auth links.
struct Reporter<'a> {
    request_id: &'a str,
    out: &'a Outbox,
    sent: AtomicUsize,
}

impl<'a> Reporter<'a> {
    fn new(request_id: &'a str, out: &'a Outbox) -> Self {
        Reporter { request_id, out, sent: AtomicUsize::new(0) }
    }

    fn progress(&self, stage: ConnectorsStage, line: &str) {
        let mut end = line.len().min(LINE_MAX_BYTES);
        while !line.is_char_boundary(end) {
            end -= 1;
        }
        let line = &line[..end];
        let before = self.sent.fetch_add(line.len(), Ordering::Relaxed);
        let line = if before + line.len() <= PROGRESS_MAX_BYTES {
            line.to_string()
        } else if before <= PROGRESS_MAX_BYTES {
            t!("……输出过多，其余省略").to_string()
        } else {
            return;
        };
        self.out.send(DaemonToServer::ConnectorsProgress { request_id: self.request_id.into(), stage, line });
    }

    fn auth(&self, step: ConnectorsAuthStep, url: String, user_code: Option<String>, expires_at: Option<String>) {
        let request_id = self.request_id.into();
        self.out.send(DaemonToServer::ConnectorsAuth(ConnectorsAuth { request_id, step, url, user_code, expires_at }));
    }
}

async fn within(work: impl Future<Output = Result<()>>) -> Result<()> {
    tokio::time::timeout(AUTH_TIMEOUT, work).await.unwrap_or_else(|_| bail!(t!("等待授权超时，请重新连接")))
}

fn expires_at(seconds: Option<i64>) -> Option<String> {
    seconds.map(|s| {
        (chrono::Utc::now() + chrono::Duration::seconds(s)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    })
}

/// The last lines a CLI printed, for an error.
fn tail(out: &std::process::Output) -> String {
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(5)..].join("\n")
}

/// What the server may ask for: a known package, a plain connector name (a directory), domains as plain words.
fn check(cmd: &ConnectorsCmd) -> Result<()> {
    let plain = |s: &str, extra: &[u8], max: usize| {
        !s.is_empty()
            && s.len() <= max
            && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || extra.contains(&b))
    };
    let spec = &cmd.spec;
    if !plain(&spec.connector, b"-_", 64) || spec.connector == "shims" || spec.connector.starts_with('-') {
        bail!(t!("连接器名称不合法：{name}", name = spec.connector));
    }
    if spec.npm != drivers::npm_package(spec.driver) {
        bail!(t!("{cli} 只能从 {pkg} 安装", cli = spec.driver.binary(), pkg = drivers::npm_package(spec.driver)));
    }
    let domain = |d: &String| (1..=30).contains(&d.len()) && d.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
    if cmd.domains.len() > 30 || !cmd.domains.iter().all(domain) {
        bail!(t!("授权范围不合法"));
    }
    Ok(())
}

fn locate(home: &Path, search: Option<&std::ffi::OsStr>, bin: &str) -> Option<PathBuf> {
    let names = crate::agents::file_names(bin);
    let find_in =
        |dirs: Vec<PathBuf>| dirs.into_iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file());
    let found = match search {
        Some(path) => find_in(std::env::split_paths(path).collect()),
        None => {
            crate::agents::find(bin).or_else(|| login_path().and_then(|p| find_in(std::env::split_paths(p).collect())))
        }
    };
    found.or_else(|| find_in(managed_bins(home)))
}

/// The login shell's PATH, read once: a GUI-started daemon misses nvm and the like.
fn program_label(cli: &Path) -> String {
    cli.file_name().and_then(|n| n.to_str()).unwrap_or("cli").to_string()
}

fn incomplete_login_error(detail: Option<&str>) -> String {
    match detail.map(str::trim).filter(|s| !s.is_empty()) {
        Some(detail) => t!("登录未完成：{detail}", detail = detail),
        None => t!("登录未完成，请重新连接").into(),
    }
}

fn probe_error_detail(detail: Option<&str>) -> String {
    match detail.map(str::trim).filter(|s| !s.is_empty()) {
        Some(detail) => detail.to_string(),
        None => t!("检查连接状态失败，请重试").into(),
    }
}

fn meegle_poll_error(status: &str) -> Option<String> {
    if status.contains("expired") {
        Some(t!("授权链接已过期，请重新连接").into())
    } else if status.contains("denied") {
        Some(t!("已取消授权，需要时可重新连接").into())
    } else {
        None
    }
}

fn login_path() -> Option<&'static OsString> {
    static PATH: OnceLock<Option<OsString>> = OnceLock::new();
    PATH.get_or_init(|| {
        #[cfg(unix)]
        return crate::agents::login_shell_path().map(OsString::from);
        #[cfg(not(unix))]
        None
    })
    .as_ref()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_meegle_oauth_poll_errors_to_clear_user_copy() {
        assert_eq!(meegle_poll_error("expired_token").as_deref(), Some("授权链接已过期，请重新连接"));
        assert_eq!(meegle_poll_error("access_denied").as_deref(), Some("已取消授权，需要时可重新连接"));
        assert_eq!(meegle_poll_error("ok"), None);
    }

    #[test]
    fn avoids_dangling_colon_and_empty_probe_errors() {
        assert_eq!(incomplete_login_error(None), "登录未完成，请重新连接");
        assert_eq!(incomplete_login_error(Some("   ")), "登录未完成，请重新连接");
        assert_eq!(incomplete_login_error(Some("超时")), "登录未完成：超时");
        assert_eq!(probe_error_detail(None), "检查连接状态失败，请重试");
        assert_eq!(probe_error_detail(Some("bad config")), "bad config");
    }

    #[test]
    fn hides_full_cli_path_in_program_label() {
        assert_eq!(
            program_label(Path::new("/Users/alice/.gonggong/connectors/feishu/node_modules/.bin/lark-cli")),
            "lark-cli"
        );
    }
}
