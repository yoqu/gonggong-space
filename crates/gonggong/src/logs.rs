//! Daemon log (spec §14): daily files `<home>/logs/daemon.<date>.log` (last KEEP_FILES days) plus an in-memory ring of
//! recent lines for the desktop 日志与诊断 page. `gg run` and the desktop app share `init`.
use regex::Regex;
use serde::Serialize;
use std::collections::VecDeque;
use std::fmt::Write as _;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

pub const KEEP_FILES: usize = 7;
const RING_CAP: usize = 2000;
/// What the file and the ring record, independent of the `GONGGONG_LOG` stderr filter.
const SINK_FILTER: &str = "info,gonggong=debug";

/// Ordered by verbosity: a tab shows every line at or below its level (`warn` = warn + error).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    fn of(level: &Level) -> Self {
        match *level {
            Level::ERROR => Self::Error,
            Level::WARN => Self::Warn,
            Level::INFO => Self::Info,
            _ => Self::Debug,
        }
    }

    fn tag(self) -> &'static str {
        match self {
            Self::Error => "ERROR",
            Self::Warn => "WARN",
            Self::Info => "INFO",
            Self::Debug => "DEBUG",
        }
    }

    fn parse(tag: &str) -> Option<Self> {
        [Self::Error, Self::Warn, Self::Info, Self::Debug].into_iter().find(|l| l.tag() == tag)
    }
}

/// `10:23:01 INFO  git     fetch origin …`, as on the prototype's log pane.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LogLine {
    pub level: LogLevel,
    pub text: String,
}

impl LogLine {
    /// Parses a file line (`2026-09-23 10:23:01 INFO  …`).
    fn parse(line: &str) -> Option<Self> {
        let text = line.get(11..)?;
        let level = LogLevel::parse(text.get(9..)?.split_whitespace().next()?)?;
        Some(LogLine { level, text: text.to_string() })
    }
}

/// The recent-lines ring the desktop app reads.
#[derive(Clone, Default)]
pub struct Logs(Arc<Mutex<VecDeque<LogLine>>>);

impl Logs {
    pub fn push(&self, line: LogLine) {
        let mut ring = self.0.lock().unwrap();
        if ring.len() == RING_CAP {
            ring.pop_front();
        }
        ring.push_back(line);
    }

    /// The newest `limit` lines at or below `max`, oldest first.
    pub fn recent(&self, max: LogLevel, limit: usize) -> Vec<LogLine> {
        let ring = self.0.lock().unwrap();
        let mut out: Vec<_> = ring.iter().rev().filter(|l| l.level <= max).take(limit).cloned().collect();
        out.reverse();
        out
    }
}

struct Sink {
    logs: Logs,
    file: Option<NonBlocking>,
}

#[derive(Default)]
struct Fields(String);

impl Visit for Fields {
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let sep = if self.0.is_empty() { "" } else { " " };
        let _ = match field.name() {
            "message" => write!(self.0, "{sep}{value:?}"),
            name => write!(self.0, "{sep}{name}={value:?}"),
        };
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        let sep = if self.0.is_empty() { "" } else { " " };
        let _ = match field.name() {
            "message" => write!(self.0, "{sep}{value}"),
            name => write!(self.0, "{sep}{name}={value}"),
        };
    }
}

/// `gonggong::engine` → `engine`, `hyper_util::client` → `hyper_util`.
fn short_target(target: &str) -> &str {
    let t = target.strip_prefix("gonggong::").unwrap_or(target);
    t.split("::").next().unwrap_or(t)
}

impl<S: Subscriber> Layer<S> for Sink {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let meta = event.metadata();
        let mut fields = Fields::default();
        event.record(&mut fields);
        let level = LogLevel::of(meta.level());
        let now = chrono::Local::now();
        let text =
            format!("{} {:<5} {:<7} {}", now.format("%H:%M:%S"), level.tag(), short_target(meta.target()), fields.0);
        if let Some(file) = &self.file {
            let _ = file.make_writer().write_all(format!("{} {text}\n", now.format("%Y-%m-%d")).as_bytes());
        }
        self.logs.push(LogLine { level, text });
    }
}

/// Installs the global subscriber: stderr (filtered by `GONGGONG_LOG`) plus the file and ring. Keep the guard alive for
/// the life of the process; dropping it flushes the file.
pub fn init(home: &Path) -> anyhow::Result<(Logs, WorkerGuard)> {
    // The appender prunes old files before it creates the directory, which prints an error on the first run.
    std::fs::create_dir_all(dir(home))?;
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("daemon")
        .filename_suffix("log")
        .max_log_files(KEEP_FILES)
        .build(dir(home))?;
    let (file, guard) = tracing_appender::non_blocking(appender);
    let logs = Logs::default();
    let stderr =
        tracing_subscriber::fmt::layer().with_writer(std::io::stderr).with_filter(EnvFilter::from_env("GONGGONG_LOG"));
    let sink = Sink { logs: logs.clone(), file: Some(file) }.with_filter(EnvFilter::new(SINK_FILTER));
    tracing_subscriber::registry().with(stderr).with(sink).try_init()?;
    Ok((logs, guard))
}

pub fn dir(home: &Path) -> PathBuf {
    home.join("logs")
}

/// Log files, oldest first.
pub fn files(home: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir(home))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("daemon.") && n.ends_with(".log"))
        })
        .collect();
    files.sort();
    files
}

/// The newest `limit` lines at or below `max` from the log files (for the CLI, which does not share the daemon's ring).
pub fn read_recent(home: &Path, max: LogLevel, limit: usize) -> Vec<LogLine> {
    let mut out = vec![];
    for file in files(home).iter().rev() {
        let text = std::fs::read_to_string(file).unwrap_or_default();
        out.extend(text.lines().rev().filter_map(LogLine::parse).filter(|l| l.level <= max));
        if out.len() >= limit {
            break;
        }
    }
    out.truncate(limit);
    out.reverse();
    out
}

static SECRET_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    [
        (r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}", "$1 [REDACTED]"),
        (
            r#"(?i)\b(token|password|passwd|secret|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+"#,
            "$1$2[REDACTED]",
        ),
        (r"(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@", "$1[REDACTED]@"),
        (r"\b[a-z]{2}_[A-Za-z0-9_-]{40,}", "[REDACTED]"),
        (r"\bsk-[A-Za-z0-9_-]{16,}", "[REDACTED]"),
        (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "[REDACTED]"),
    ]
    .into_iter()
    .map(|(re, to)| (Regex::new(re).expect("valid pattern"), to))
    .collect()
});

/// Masks credentials before text leaves the machine: the given `secrets` verbatim, plus tokens, passwords, API keys
/// and URL userinfo by shape.
pub fn redact(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_string();
    for s in secrets.iter().filter(|s| !s.is_empty()) {
        out = out.replace(s, "[REDACTED]");
    }
    for (re, to) in SECRET_PATTERNS.iter() {
        out = re.replace_all(&out, *to).into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(level: LogLevel, text: &str) -> LogLine {
        LogLine { level, text: text.into() }
    }

    #[test]
    fn the_ring_filters_by_level_keeps_order_and_drops_the_oldest() {
        let logs = Logs::default();
        logs.push(line(LogLevel::Info, "a"));
        logs.push(line(LogLevel::Warn, "b"));
        logs.push(line(LogLevel::Debug, "c"));
        logs.push(line(LogLevel::Error, "d"));
        let texts = |max, n| logs.recent(max, n).into_iter().map(|l| l.text).collect::<Vec<_>>();
        assert_eq!(texts(LogLevel::Debug, 10), ["a", "b", "c", "d"]);
        assert_eq!(texts(LogLevel::Info, 10), ["a", "b", "d"]);
        assert_eq!(texts(LogLevel::Warn, 10), ["b", "d"]);
        assert_eq!(texts(LogLevel::Debug, 2), ["c", "d"]);
        for i in 0..RING_CAP {
            logs.push(line(LogLevel::Info, &i.to_string()));
        }
        assert_eq!(logs.recent(LogLevel::Debug, usize::MAX).len(), RING_CAP);
        assert_eq!(logs.recent(LogLevel::Debug, 1)[0].text, (RING_CAP - 1).to_string());
    }

    #[test]
    fn the_sink_formats_events_for_the_ring() {
        let logs = Logs::default();
        let sink = Sink { logs: logs.clone(), file: None };
        let subscriber = tracing_subscriber::registry().with(sink.with_filter(EnvFilter::new(SINK_FILTER)));
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(target: "gonggong::git", repo = "pay", "fetch origin");
            tracing::debug!(target: "hyper_util::client", "noise");
            tracing::warn!("disk low");
        });
        let got = logs.recent(LogLevel::Debug, 10);
        assert_eq!(got.len(), 2);
        assert_eq!(&got[0].text[8..], " INFO  git     fetch origin repo=pay");
        assert_eq!(got[1].level, LogLevel::Warn);
        assert!(got[1].text.ends_with("WARN  logs    disk low"), "{}", got[1].text);
    }

    #[test]
    fn reads_recent_lines_from_the_files_newest_last() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir(home.path())).unwrap();
        let day1 = "2026-09-22 23:59:00 INFO  git     one\n2026-09-22 23:59:30 WARN  sync    two\n";
        let day2 = "2026-09-23 00:00:01 DEBUG engine  three\n2026-09-23 00:00:02 ERROR engine  four\ngarbage\n";
        std::fs::write(dir(home.path()).join("daemon.2026-09-22.log"), day1).unwrap();
        std::fs::write(dir(home.path()).join("daemon.2026-09-23.log"), day2).unwrap();
        std::fs::write(dir(home.path()).join("other.log"), "2026-09-23 00:00:03 ERROR x  nope\n").unwrap();
        let texts = |max, n| read_recent(home.path(), max, n).into_iter().map(|l| l.text).collect::<Vec<_>>();
        assert_eq!(texts(LogLevel::Warn, 10), ["23:59:30 WARN  sync    two", "00:00:02 ERROR engine  four"]);
        assert_eq!(texts(LogLevel::Debug, 2), ["00:00:01 DEBUG engine  three", "00:00:02 ERROR engine  four"]);
        assert_eq!(texts(LogLevel::Info, 10).len(), 3);
    }

    #[test]
    fn redacts_tokens_passwords_keys_and_url_credentials() {
        let token = "mt_Zq3v9Kx0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX";
        let raw = format!(
            "auth {token} Authorization: Bearer abc.def.ghijkl password=hunter22 \
             {{\"apiKey\": \"k-123456\"}} https://bob:s3cret@git.corp/pay.git sk-ant-api03-abcdefghijklmnop \
             ghp_abcdefghijklmnopqrstuvwxyz ok=1"
        );
        let out = redact(&raw, &["custom-secret-value"]);
        for leaked in [token, "abc.def.ghijkl", "hunter22", "k-123456", "bob:s3cret", "sk-ant-api03", "ghp_abc"] {
            assert!(!out.contains(leaked), "{leaked} leaked in {out}");
        }
        assert!(out.contains("https://[REDACTED]@git.corp/pay.git"), "{out}");
        assert!(out.contains("ok=1"));
        assert_eq!(redact("x custom-secret-value y", &["custom-secret-value"]), "x [REDACTED] y");
    }
}
