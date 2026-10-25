use crate::protocol::GitCommandRecord;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::process::Output;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const STREAM_MAX_BYTES: usize = 64 * 1024;
const COMMAND_MAX_BYTES: usize = 16 * 1024;
const COMMAND_MAX: usize = 128;
const TRUNCATED: &str = "\n… [输出已截断]\n";

tokio::task_local! {
    static CURRENT: Arc<Mutex<Vec<(u64, GitCommandRecord)>>>;
}

struct Captured<F> {
    inner: F,
    records: Arc<Mutex<Vec<(u64, GitCommandRecord)>>>,
}

impl<F: Future> Future for Captured<F> {
    type Output = F::Output;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = unsafe { self.get_unchecked_mut() };
        let inner = unsafe { Pin::new_unchecked(&mut this.inner) };
        CURRENT.sync_scope(this.records.clone(), || inner.poll(cx))
    }
}

pub(crate) async fn capture<F: Future>(future: F) -> (F::Output, Vec<GitCommandRecord>) {
    let records = Arc::new(Mutex::new(vec![]));
    let result = Captured { inner: future, records: records.clone() }.await;
    let mut commands = std::mem::take(&mut *records.lock().unwrap());
    commands.sort_by_key(|c| c.0);
    (result, commands.into_iter().map(|(_, c)| c).collect())
}

pub(crate) struct Started {
    at: String,
    seq: u64,
    instant: Instant,
    command: String,
}

pub(crate) fn start(dir: &Path, args: &[&str]) -> Started {
    Started {
        at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        seq: SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() as u64,
        instant: Instant::now(),
        command: format!(
            "git -C {} {}",
            quote(&dir.to_string_lossy()),
            args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
        ),
    }
}

impl Started {
    pub(crate) fn output(self, output: &Output) {
        self.finish(output.status.code(), &output.stdout, &output.stderr);
    }

    pub(crate) fn error(self, error: &str) {
        self.finish(None, &[], error.as_bytes());
    }

    fn finish(self, exit_code: Option<i32>, stdout: &[u8], stderr: &[u8]) {
        let _ = CURRENT.try_with(|current| {
            let mut current = current.lock().unwrap();
            if current.len() >= COMMAND_MAX {
                if current.len() == COMMAND_MAX {
                    current.push((
                        u64::MAX,
                        GitCommandRecord {
                            command: "[后续 Git 命令已省略]".into(),
                            started_at: self.at,
                            duration_ms: 0,
                            exit_code: None,
                            stdout: String::new(),
                            stderr: "[命令日志已截断]".into(),
                            truncated: true,
                        },
                    ));
                }
                return;
            }
            let command = printable(&crate::logs::redact(&self.command, &[]));
            let (command, command_cut) = bounded(&command, COMMAND_MAX_BYTES);
            let (stdout, out_cut) = text(stdout);
            let (stderr, err_cut) = text(stderr);
            current.push((
                self.seq,
                GitCommandRecord {
                    command,
                    started_at: self.at,
                    duration_ms: self.instant.elapsed().as_millis() as u64,
                    exit_code,
                    stdout,
                    stderr,
                    truncated: command_cut || out_cut || err_cut,
                },
            ));
        });
    }
}

fn quote(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-._/:=@".contains(c)) {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

fn text(bytes: &[u8]) -> (String, bool) {
    let text = crate::logs::redact(&String::from_utf8_lossy(bytes), &[]);
    bounded(&printable(&text), STREAM_MAX_BYTES)
}

fn printable(text: &str) -> String {
    text.chars()
        .flat_map(|c| match c {
            '\0' => "\\0".chars().collect::<Vec<_>>(),
            '\n' | '\t' => vec![c],
            c if c.is_control() => format!("\\x{:02x}", c as u32).chars().collect(),
            c => vec![c],
        })
        .collect()
}

fn bounded(text: &str, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text.to_string(), false);
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}{}", &text[..end], TRUNCATED), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nul_and_control_characters_are_readable_and_database_safe() {
        let (out, cut) = text(b"src/a.ts\0src/b.ts\0\n\tbell:\x07 escape:\x1b end:\x7f\r\n");
        assert!(!cut);
        assert_eq!(out, "src/a.ts\\0src/b.ts\\0\n\tbell:\\x07 escape:\\x1b end:\\x7f\\x0d\n");
        assert!(!out.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\t')));
    }

    #[test]
    fn masks_credentials_and_marks_utf8_safe_truncation_and_shell_quoting() {
        let (text, cut) = text(format!("{}密码{}", "x".repeat(STREAM_MAX_BYTES), "🙂").as_bytes());
        assert!(cut);
        assert!(text.ends_with(TRUNCATED));
        assert_eq!(quote("two words"), "'two words'");
        assert_eq!(quote("a'b"), "'a'\\''b'");
        let out = crate::logs::redact(
            "https://bob:s3cret@git.corp/pay.git password=hunter22 ghp_abcdefghijklmnopqrstuvwxyz",
            &[],
        );
        for secret in ["bob:s3cret", "hunter22", "ghp_abcdefghijklmnopqrstuvwxyz"] {
            assert!(!out.contains(secret));
        }
    }
}
