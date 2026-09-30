//! Keys never reach the daemon's logs (design §5). Its own binary: the subscriber is process-wide.
#[path = "support/provider_rig.rs"]
mod provider_rig;

use gonggong::protocol::*;
use gonggong::providers::Store;
use provider_rig::*;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Collects everything the daemon traces (every level).
#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl Write for Captured {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn the_key_never_reaches_the_logs() {
    let logs = Captured::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_ansi(false)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::set_global_default(subscriber).unwrap();
    let mut r = rig(Duration::from_secs(60));
    let claude = r.add(AgentKind::Claude, "kimi-coding", true);
    r.add(AgentKind::Codex, "zhipu", true);
    let quiet = |run_id: &str, kind: AgentKind, bot: &str| {
        let s = start(run_id, kind);
        let bot = RunBot { id: bot.into(), ..s.bot.clone() };
        RunStart { bot, prompt: RunPrompt { text: "mock:commands".into(), ..s.prompt.clone() }, ..s }
    };
    for (run_id, kind, bot) in [("r1", AgentKind::Claude, "b1"), ("r2", AgentKind::Codex, "b2")] {
        r.run(quiet(run_id, kind, bot));
        assert_eq!(r.finish(run_id).await.reply, "ok");
    }
    // Editing the provider restarts the adapter: nothing on that path may print the key either.
    Store::update(r.home(), |s| s.edit(&claude, |p| p.base_url = "https://example.test/anthropic".into())).unwrap();
    r.run(quiet("r3", AgentKind::Claude, "b1"));
    assert_eq!(r.finish("r3").await.reply, "ok");
    let logs = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(logs.contains("session/new"), "trace-level JSON-RPC was captured");
    assert!(!logs.contains(KEY) && !logs.contains("0123456789"));
}
