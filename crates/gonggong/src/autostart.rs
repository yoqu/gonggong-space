//! `gg service`: keeps `gg run` running in the background and starts it at login (Agent 自助接入), as a launchd agent
//! on macOS and a systemd user unit on Linux. Windows keeps the desktop app. The daemon's self-upgrade re-execs in place
//! (same pid, same path), so the service manager never sees it exit.
use crate::lock::{Lock, LockError};
use crate::t;
use anyhow::{Context, Result, bail};
use std::path::{Path, PathBuf};

pub const LABEL: &str = "com.gonggong.daemon";
pub const UNIT: &str = "gonggong.service";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Macos,
    Linux,
    Other,
}

impl Os {
    pub fn current() -> Os {
        match std::env::consts::OS {
            "macos" => Os::Macos,
            "linux" => Os::Linux,
            _ => Os::Other,
        }
    }
}

/// Machine-readable, printed by `gg status` as `service: <state>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Running,
    /// Installed but not running (starting, crashed, or stopped).
    Installed,
    NotInstalled,
    Unsupported,
}

impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            State::Running => "running",
            State::Installed => "installed",
            State::NotInstalled => "not-installed",
            State::Unsupported => "unsupported",
        }
    }
}

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `launchctl` / `systemctl`; tests swap in a fake so nothing is registered for real.
pub trait Runner {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<Output>;
}

pub struct System;

impl Runner for System {
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<Output> {
        let out = crate::proc::command(program).args(args).stdin(std::process::Stdio::null()).output()?;
        Ok(Output {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}

/// Where and how the service runs.
pub struct Spec {
    pub os: Os,
    /// The user's home (LaunchAgents, ~/.config/systemd/user).
    pub user_home: PathBuf,
    /// The gonggong home: logs and the daemon lock.
    pub home: PathBuf,
    /// Absolute path of this gg.
    pub exe: PathBuf,
    /// PATH for the daemon: launchd and systemd start it with a minimal one, without the agent CLIs or node.
    pub path: String,
    /// GONGGONG_HOME when set, so the service serves the same home.
    pub gonggong_home: Option<String>,
    pub uid: u32,
}

impl Spec {
    pub fn current() -> Result<Spec> {
        let exe = std::env::current_exe().context(t!("无法确定 gg 的路径"))?;
        let exe = exe.canonicalize().unwrap_or(exe);
        let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into());
        #[cfg(unix)]
        // SAFETY: getuid has no preconditions and cannot fail.
        let uid = unsafe { libc::getuid() };
        #[cfg(not(unix))]
        let uid = 0;
        Ok(Spec {
            os: Os::current(),
            user_home: crate::config::user_home(),
            home: crate::config::home(),
            exe,
            path,
            gonggong_home: std::env::var("GONGGONG_HOME").ok().filter(|h| !h.is_empty()),
            uid,
        })
    }

    /// PATH as the user's login shell builds it (nvm, volta…), for the service to find the agent CLIs and node; it
    /// takes a few seconds, so only installing asks for it.
    pub fn with_login_path(mut self) -> Spec {
        #[cfg(unix)]
        if let Some(path) = crate::agents::login_shell_path() {
            self.path = path;
        }
        self
    }

    pub fn plist_path(&self) -> PathBuf {
        self.user_home.join("Library/LaunchAgents").join(format!("{LABEL}.plist"))
    }

    pub fn unit_path(&self) -> PathBuf {
        self.user_home.join(".config/systemd/user").join(UNIT)
    }

    fn log_path(&self) -> PathBuf {
        self.home.join("logs/service.log")
    }

    fn env(&self) -> Vec<(&'static str, &str)> {
        let mut env = vec![("PATH", self.path.as_str())];
        env.extend(self.gonggong_home.as_deref().map(|h| ("GONGGONG_HOME", h)));
        env
    }

    fn target(&self) -> String {
        format!("gui/{}", self.uid)
    }
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The launchd agent: started at login, restarted 10 s after it exits.
pub fn plist(spec: &Spec) -> String {
    let string = |s: &str| format!("<string>{}</string>", xml(s));
    let env: String =
        spec.env().iter().map(|(k, v)| format!("\n\t\t<key>{k}</key>\n\t\t{}", string(v))).collect::<String>();
    let log = string(&spec.log_path().to_string_lossy());
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		{exe}
		<string>run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>EnvironmentVariables</key>
	<dict>{env}
	</dict>
	<key>StandardOutPath</key>
	{log}
	<key>StandardErrorPath</key>
	{log}
</dict>
</plist>
"#,
        exe = string(&spec.exe.to_string_lossy()),
    )
}

/// A systemd value in double quotes (`%` is a specifier there).
fn quoted(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"").replace('%', "%%"))
}

/// The systemd user unit: started with the user's session, restarted 10 s after it exits, never rate-limited.
pub fn unit(spec: &Spec) -> String {
    let env: String =
        spec.env().iter().map(|(k, v)| format!("Environment={}\n", quoted(&format!("{k}={v}")))).collect();
    format!(
        "[Unit]\nDescription=Gonggong daemon (gg run)\nAfter=network-online.target\nStartLimitIntervalSec=0\n\n\
         [Service]\nExecStart={} run\nRestart=always\nRestartSec=10\n{env}\n[Install]\nWantedBy=default.target\n",
        quoted(&spec.exe.to_string_lossy())
    )
}

fn must(out: std::io::Result<Output>, what: &str) -> Result<Output> {
    let out = out.with_context(|| t!("无法执行 {cmd}", cmd = what))?;
    if !out.ok {
        bail!(t!("{cmd} 失败：{err}", cmd = what, err = out.stderr.trim()));
    }
    Ok(out)
}

fn write(path: &Path, content: &str) -> Result<()> {
    std::fs::create_dir_all(path.parent().expect("has a parent"))?;
    std::fs::write(path, content).with_context(|| t!("无法写入 {path}", path = path.display()))
}

/// Installs (or rewrites) and starts the service; returns what to tell the user.
pub fn install(spec: &Spec, run: &dyn Runner) -> Result<Vec<String>> {
    let mut notes = vec![];
    match spec.os {
        Os::Other => bail!(t!("当前系统不支持 gg service，请使用桌面客户端")),
        Os::Macos => {
            std::fs::create_dir_all(spec.home.join("logs"))?;
            let held = held(spec, state(spec, run) == State::Running);
            write(&spec.plist_path(), &plist(spec))?;
            let path = spec.plist_path().to_string_lossy().into_owned();
            // Reloads a previous version of the agent; failing means there was none.
            let _ = run.run("launchctl", &["bootout", &format!("{}/{LABEL}", spec.target())]);
            must(run.run("launchctl", &["bootstrap", &spec.target(), &path]), "launchctl bootstrap")?;
            notes.extend(held);
            notes.push(
                t!("已安装后台服务（launchd），登录后自动运行 gg run，日志见 {log}", log = spec.log_path().display())
                    .into(),
            );
        }
        Os::Linux => {
            let user_systemd = run.run("systemctl", &["--user", "show-environment"]).is_ok_and(|o| o.ok);
            if !user_systemd {
                bail!(t!(
                    "本机没有可用的 systemd 用户实例（如容器内），无法安装服务；请改用 nohup gg run > {log} 2>&1 & 在后台运行",
                    log = spec.log_path().display()
                ));
            }
            let held = held(spec, state(spec, run) == State::Running);
            write(&spec.unit_path(), &unit(spec))?;
            must(run.run("systemctl", &["--user", "daemon-reload"]), "systemctl --user daemon-reload")?;
            must(run.run("systemctl", &["--user", "enable", UNIT]), "systemctl --user enable")?;
            // Restart picks up a rewritten unit or a new gg; it also starts a stopped one.
            must(run.run("systemctl", &["--user", "restart", UNIT]), "systemctl --user restart")?;
            notes.extend(held);
            notes.push(t!("已安装后台服务（systemd 用户单元），登录后自动运行 gg run").into());
            notes.push(t!("注销后仍要运行，需执行 loginctl enable-linger").into());
        }
    }
    Ok(notes)
}

/// A daemon outside the service holding the lock keeps serving; the service waits and takes over when it exits.
fn held(spec: &Spec, service_running: bool) -> Option<String> {
    if service_running {
        return None;
    }
    match Lock::acquire(&spec.home) {
        Err(LockError::Held { pid }) => Some(match pid {
            Some(pid) => {
                t!("本机已有 daemon 在运行（pid {pid}），服务会在它退出后接管；要立即切换，请先停掉它", pid = pid)
                    .into()
            }
            None => t!("本机已有 daemon 在运行，服务会在它退出后接管；要立即切换，请先停掉它").into(),
        }),
        _ => None,
    }
}

pub fn uninstall(spec: &Spec, run: &dyn Runner) -> Result<Vec<String>> {
    match spec.os {
        Os::Other => bail!(t!("当前系统不支持 gg service，请使用桌面客户端")),
        Os::Macos => {
            let _ = run.run("launchctl", &["bootout", &format!("{}/{LABEL}", spec.target())]);
            remove(&spec.plist_path())?;
        }
        Os::Linux => {
            let _ = run.run("systemctl", &["--user", "disable", "--now", UNIT]);
            remove(&spec.unit_path())?;
            let _ = run.run("systemctl", &["--user", "daemon-reload"]);
        }
    }
    Ok(vec![t!("已卸载后台服务").into()])
}

fn remove(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

pub fn state(spec: &Spec, run: &dyn Runner) -> State {
    match spec.os {
        Os::Other => State::Unsupported,
        Os::Macos if !spec.plist_path().exists() => State::NotInstalled,
        Os::Linux if !spec.unit_path().exists() => State::NotInstalled,
        Os::Macos => {
            let out = run.run("launchctl", &["print", &format!("{}/{LABEL}", spec.target())]);
            let running = out.is_ok_and(|o| o.ok && o.stdout.lines().any(|l| l.trim() == "state = running"));
            if running { State::Running } else { State::Installed }
        }
        Os::Linux => {
            let out = run.run("systemctl", &["--user", "is-active", UNIT]);
            if out.is_ok_and(|o| o.stdout.trim() == "active") { State::Running } else { State::Installed }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Fake {
        calls: RefCell<Vec<String>>,
        /// (call prefix, ok, stdout)
        answers: Vec<(&'static str, bool, &'static str)>,
    }

    impl Runner for Fake {
        fn run(&self, program: &str, args: &[&str]) -> std::io::Result<Output> {
            let call = format!("{program} {}", args.join(" "));
            self.calls.borrow_mut().push(call.clone());
            let (ok, stdout) =
                self.answers.iter().find(|(p, ..)| call.starts_with(p)).map_or((true, ""), |(_, ok, out)| (*ok, *out));
            Ok(Output { ok, stdout: stdout.into(), stderr: if ok { String::new() } else { "boom".into() } })
        }
    }

    fn spec(os: Os, dir: &Path) -> Spec {
        Spec {
            os,
            user_home: dir.join("home"),
            home: dir.join("home/.gonggong"),
            exe: PathBuf::from("/Users/wl/My Apps/gg"),
            path: "/opt/homebrew/bin:/usr/bin:/bin".into(),
            gonggong_home: None,
            uid: 501,
        }
    }

    #[test]
    fn the_launchd_agent_runs_gg_run_at_login_and_keeps_it_alive() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = spec(Os::Macos, dir.path());
        s.gonggong_home = Some("/tmp/a&b".into());
        let p = plist(&s);
        assert!(p.contains("<string>com.gonggong.daemon</string>"));
        assert!(p.contains("<string>/Users/wl/My Apps/gg</string>\n\t\t<string>run</string>"));
        assert!(p.contains("<key>RunAtLoad</key>\n\t<true/>"));
        assert!(p.contains("<key>KeepAlive</key>\n\t<true/>"));
        assert!(p.contains("<key>PATH</key>\n\t\t<string>/opt/homebrew/bin:/usr/bin:/bin</string>"));
        assert!(p.contains("<key>GONGGONG_HOME</key>\n\t\t<string>/tmp/a&amp;b</string>"));
        assert!(p.contains(&format!("<string>{}</string>", s.home.join("logs/service.log").display())));
    }

    #[test]
    fn the_systemd_unit_quotes_the_path_and_restarts_without_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = spec(Os::Linux, dir.path());
        s.path = "/a%b:/usr/bin".into();
        let u = unit(&s);
        assert!(u.contains("ExecStart=\"/Users/wl/My Apps/gg\" run\n"));
        assert!(u.contains("Restart=always\nRestartSec=10\n"));
        assert!(u.contains("StartLimitIntervalSec=0"));
        assert!(u.contains("Environment=\"PATH=/a%%b:/usr/bin\"\n"));
        assert!(!u.contains("GONGGONG_HOME"));
        assert!(u.contains("WantedBy=default.target"));
    }

    #[test]
    fn macos_install_writes_the_agent_and_bootstraps_it() {
        let dir = tempfile::tempdir().unwrap();
        let s = spec(Os::Macos, dir.path());
        let fake = Fake::default();
        assert_eq!(state(&s, &fake), State::NotInstalled);
        install(&s, &fake).unwrap();
        assert_eq!(std::fs::read_to_string(s.plist_path()).unwrap(), plist(&s));
        let plist = s.plist_path().display().to_string();
        assert_eq!(
            *fake.calls.borrow(),
            [
                "launchctl bootout gui/501/com.gonggong.daemon".to_string(),
                format!("launchctl bootstrap gui/501 {plist}")
            ]
        );

        let running = Fake { answers: vec![("launchctl print", true, "\tstate = running\n")], ..Default::default() };
        assert_eq!(state(&s, &running), State::Running);
        let stopped =
            Fake { answers: vec![("launchctl print", true, "\tstate = not running\n")], ..Default::default() };
        assert_eq!(state(&s, &stopped), State::Installed);

        let failing = Fake { answers: vec![("launchctl bootstrap", false, "")], ..Default::default() };
        let err = install(&s, &failing).unwrap_err().to_string();
        assert!(err.contains("launchctl bootstrap") && err.contains("boom"), "{err}");

        uninstall(&s, &fake).unwrap();
        assert!(!s.plist_path().exists());
        assert_eq!(fake.calls.borrow().last().unwrap(), "launchctl bootout gui/501/com.gonggong.daemon");
    }

    #[test]
    fn linux_install_enables_and_restarts_the_user_unit() {
        let dir = tempfile::tempdir().unwrap();
        let s = spec(Os::Linux, dir.path());
        let fake = Fake::default();
        let notes = install(&s, &fake).unwrap();
        assert!(notes.iter().any(|n| n.contains("loginctl enable-linger")), "{notes:?}");
        assert_eq!(std::fs::read_to_string(s.unit_path()).unwrap(), unit(&s));
        assert_eq!(
            *fake.calls.borrow(),
            [
                "systemctl --user show-environment",
                "systemctl --user daemon-reload",
                "systemctl --user enable gonggong.service",
                "systemctl --user restart gonggong.service",
            ]
        );
        let active = Fake { answers: vec![("systemctl --user is-active", true, "active\n")], ..Default::default() };
        assert_eq!(state(&s, &active), State::Running);
        let inactive =
            Fake { answers: vec![("systemctl --user is-active", false, "inactive\n")], ..Default::default() };
        assert_eq!(state(&s, &inactive), State::Installed);
        uninstall(&s, &fake).unwrap();
        assert!(!s.unit_path().exists());
    }

    #[test]
    fn linux_without_a_user_systemd_says_so_and_installs_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let s = spec(Os::Linux, dir.path());
        let fake = Fake { answers: vec![("systemctl --user show-environment", false, "")], ..Default::default() };
        let err = install(&s, &fake).unwrap_err().to_string();
        assert!(err.contains("nohup gg run"), "{err}");
        assert!(!s.unit_path().exists());
        assert_eq!(fake.calls.borrow().len(), 1);
    }

    #[test]
    fn other_systems_are_not_supported() {
        let dir = tempfile::tempdir().unwrap();
        let s = spec(Os::Other, dir.path());
        assert!(install(&s, &Fake::default()).is_err());
        assert_eq!(state(&s, &Fake::default()), State::Unsupported);
    }

    #[test]
    fn a_daemon_already_running_outside_the_service_is_left_to_serve() {
        let dir = tempfile::tempdir().unwrap();
        let s = spec(Os::Macos, dir.path());
        let _running = Lock::acquire(&s.home).unwrap();
        let notes = install(&s, &Fake::default()).unwrap();
        assert!(notes[0].contains("服务会在它退出后接管"), "{notes:?}");
    }
}
