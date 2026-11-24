//! What the active turn's context is made of, sent at its end and while it goes on.
use super::Shared;
use crate::ledger::Ledger;
use crate::protocol::{CacheUsage, DaemonToServer, RunEvent};
use agent_client_protocol::schema::v1::{SessionId, Usage};
use std::sync::Arc;

/// How often the make-up of the context is sent while a turn goes on, at most.
const LIVE_EVERY: std::time::Duration = std::time::Duration::from_secs(2);

impl Shared {
    /// A prompt sent in `session`; `fresh`: the session was just opened, so we see all of it.
    pub(super) fn record_prompt(&self, session: &SessionId, text: &str, new_turn: bool, fresh: bool) {
        let mut s = self.0.lock().unwrap();
        let key = session.0.to_string();
        if fresh {
            s.ledgers.insert(key.clone(), Ledger::default());
        }
        s.ledgers.entry(key).or_insert_with(Ledger::resumed).prompt(text, new_turn);
    }

    /// Sends the context's estimated make-up at the end of the active turn, if its agent reported an occupancy.
    pub(super) fn report_context(&self, session: &SessionId, usage: Option<&Usage>) {
        let cache = usage.and_then(cache_of);
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        let (Some(a), Some(l)) = (s.active.as_ref(), s.ledgers.get_mut(&*session.0)) else { return };
        let Some((context, breakdown)) = l.snapshot(cache) else { return };
        let usage = a.turn.usage.clone().unwrap_or_default();
        let event = RunEvent::Usage { usage, context: Some(context), breakdown: Some(breakdown) };
        a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
    }

    /// Sends the context's make-up so far if it changed and `run_id` is still the active turn.
    fn report_live(&self, run_id: &str, session: &str) {
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        s.live_due = false;
        let Some(a) = s.active.as_ref().filter(|a| a.run_id == run_id) else { return };
        let Some((context, breakdown)) = s.ledgers.get_mut(session).and_then(Ledger::live) else { return };
        let usage = a.turn.usage.clone().unwrap_or_default();
        let event = RunEvent::Usage { usage, context: Some(context), breakdown: Some(breakdown) };
        a.out.send(DaemonToServer::RunEvent { run_id: a.run_id.clone(), event });
    }

    /// Sends the context's make-up so far in `LIVE_EVERY`, if it changed and `run_id` is still the active turn.
    pub(super) fn schedule_live(self: &Arc<Self>, run_id: String, session: String) {
        let shared = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(LIVE_EVERY).await;
            shared.report_live(&run_id, &session);
        });
    }
}

fn cache_of(u: &Usage) -> Option<CacheUsage> {
    let read = u.cached_read_tokens?;
    let total = u.input_tokens + read + u.cached_write_tokens.unwrap_or(0);
    (total > 0).then_some(CacheUsage { read, total })
}
