//! A turn sharing its directory asks before its first change there (docs/plan/工作区并行-写时确认.md): run in a mode
//! that asks before changing files (or a read-only bot), its reads go on; its first change waits for the directory's
//! other writers (`workspace::WriteGate`), then the bot's own mode and approval rules apply again.
use super::*;

pub(super) struct Gate {
    dir: workspace::WriteGate,
    /// The bot's own mode, switched back to once the turn may change files.
    restore: Option<String>,
    /// The turn may change files.
    pub(super) open: bool,
    /// Waiting to open: the group is asked or the other writers are waited for.
    asking: bool,
    /// Which wait is current: an interrupted one must not open the gate for the requests after it.
    epoch: u64,
    /// Wakes the wait an interruption ended.
    wake: Arc<Notify>,
    /// Permission requests waiting for it, answered as usual once it opens.
    held: Vec<(RequestPermissionRequest, oneshot::Sender<Option<PermissionOptionId>>)>,
}

/// Whether a permission request may change files: edits, moves and deletes, commands not known to only read, and
/// whatever else the agent does by itself. Reads, searches and MCP tools do not.
pub(super) fn may_write(tool_kind: &str, command: Option<&str>, mcp: bool, cwd: &Path) -> bool {
    match tool_kind {
        _ if mcp => false,
        "read" | "search" | "think" | "fetch" | "switch_mode" => false,
        "execute" => !command.is_some_and(|c| local::trust::reads_only(c, cwd)),
        _ => true,
    }
}

/// What the confirmation says the turn is about to do: no command or path outside the workspace, which may carry
/// secrets, goes to the group before the owner saw it.
pub(super) fn target(tool_kind: &str, paths: &[PathBuf], cwd: &Path) -> String {
    match paths.first().and_then(|p| p.strip_prefix(cwd).ok()) {
        _ if tool_kind == "execute" => t!("运行可能改动文件的命令").into(),
        Some(p) => t!("修改 {path}", path = p.display()),
        None => t!("修改文件").into(),
    }
}

/// Holds a change of the active turn while its gate is shut, and opens it (`Shared::await_write`) unless already.
pub(super) fn hold(shared: &Arc<Shared>, s: &mut State, req: RequestPermissionRequest, target: String) -> Permission {
    let (tx, rx) = oneshot::channel();
    let Some(a) = s.active.as_mut() else { return Permission::Now(None) };
    let Some(g) = a.gate.as_mut() else { return Permission::Now(None) };
    g.held.push((req, tx));
    if !g.asking {
        g.asking = true;
        let (shared, run_id, epoch) = (shared.clone(), a.run_id.clone(), g.epoch);
        tokio::spawn(async move { shared.await_write(run_id, epoch, target).await });
    }
    Permission::Ask(rx)
}

/// The active turn's prompt was cancelled: its held changes are answered cancelled and an unanswered confirmation is
/// taken back, as the turn may go on (打断并追加).
pub(super) fn interrupted(s: &mut State) {
    let Some(a) = s.active.as_mut() else { return };
    for (request_id, _) in s.questions.iter().filter(|(_, q)| matches!(q.reply, Reply::Dir(_))) {
        let request_id = request_id.clone();
        a.out.send(DaemonToServer::QuestionWithdraw { run_id: a.run_id.clone(), request_id });
    }
    if let Some(g) = a.gate.as_mut() {
        g.held.clear();
        g.asking = false;
        g.epoch += 1;
        g.wake.notify_one();
    }
}

enum Step {
    Stop,
    Open,
    Wait,
}

fn waiting(s: &State, run_id: &str, epoch: u64) -> bool {
    let gate = s.active.as_ref().filter(|a| a.run_id == run_id).and_then(|a| a.gate.as_ref());
    gate.is_some_and(|g| g.asking && g.epoch == epoch) && !s.cancelled.contains(run_id)
}

impl Shared {
    /// The active turn asks before its first change in its shared directory; `restore`: the mode to go back to then.
    pub(super) fn guard(&self, dir: workspace::WriteGate, restore: Option<String>) {
        let mut s = self.0.lock().unwrap();
        if let Some(a) = s.active.as_mut() {
            let wake = Arc::default();
            a.gate = Some(Gate { dir, restore, open: false, asking: false, epoch: 0, wake, held: vec![] });
        }
    }

    /// The mode switch a gate started, resolving to the mode in effect (None: unknown).
    pub(super) fn take_restoring(&self) -> Option<tokio::task::JoinHandle<Option<String>>> {
        self.0.lock().unwrap().restoring.take()
    }

    /// Opens the gate of the active turn `run_id` once no other turn may write, or the group chose to go on beside
    /// them. Gives up when the turn is stopped or this wait (`epoch`) interrupted. `target`: what the turn is about
    /// to do, for the confirmation.
    async fn await_write(self: Arc<Self>, run_id: String, epoch: u64, target: String) {
        let Some((gate, wake)) = self
            .0
            .lock()
            .unwrap()
            .active
            .as_ref()
            .and_then(|a| a.gate.as_ref())
            .map(|g| (g.dir.clone(), g.wake.clone()))
        else {
            return;
        };
        let mut changed = gate.subscribe();
        let (mut ask, mut asked, mut force, mut waited) = (None, false, false, false);
        let mut holders = vec![];
        loop {
            // Checked, taken and asked under one lock: an interrupted wait neither takes the directory nor asks.
            let step = {
                let mut s = self.0.lock().unwrap();
                if !waiting(&s, &run_id, epoch) {
                    Step::Stop
                } else {
                    match gate.take(force) {
                        Ok(()) => Step::Open,
                        Err(others) => {
                            if !asked {
                                asked = true;
                                ask = confirm_in(&mut s, gate.question(&others, &target));
                            }
                            holders = others;
                            Step::Wait
                        }
                    }
                }
            };
            match step {
                Step::Stop => {
                    if let Some((request_id, _)) = &ask {
                        self.withdraw(request_id, t!("已停止，不再等待修改工作区"));
                    }
                    return;
                }
                Step::Open => {
                    if let Some((request_id, _)) = &ask {
                        self.withdraw(request_id, t!("其他运行已结束，开始修改"));
                    } else if waited {
                        self.status(&run_id, t!("其他运行已结束，开始修改").into());
                    }
                    return self.open(&run_id, epoch, &gate).await;
                }
                Step::Wait => {}
            }
            let answered = match &mut ask {
                Some((_, rx)) => tokio::select! {
                    _ = changed.changed() => None,
                    choice = rx => Some(choice.unwrap_or(false)),
                    _ = self.cancel_signal() => None,
                    _ = wake.notified() => None,
                },
                None => tokio::select! {
                    _ = changed.changed() => None,
                    _ = self.cancel_signal() => None,
                    _ = wake.notified() => None,
                },
            };
            if let Some(choice) = answered {
                (ask, force, waited) = (None, choice, !choice);
                if waited {
                    let step = t!("等 {holders} 结束后再修改文件", holders = holders.join(t!("、")));
                    self.status(&run_id, step);
                }
            }
        }
    }

    /// The turn's changes count from here: what others changed while it only read is not its own (nor discarded
    /// with it). Then its held requests are answered as usual.
    async fn open(self: &Arc<Self>, run_id: &str, epoch: u64, dir: &workspace::WriteGate) {
        let roots = {
            let s = self.0.lock().unwrap();
            let a = s.active.as_ref().filter(|a| a.run_id == run_id);
            a.and_then(|a| a.git.as_ref()).map(|g| (g.cwd.clone(), g.extras.clone()))
        };
        let tracked = match roots {
            Some((cwd, extras)) => Some(git::track(&cwd, &extras).await),
            None => None,
        };
        let mut guard = self.0.lock().unwrap();
        let s = &mut *guard;
        if !waiting(s, run_id, epoch) {
            // Interrupted meanwhile: what comes next may only read. A newer wait (asking) holds the place itself; it
            // takes it under this lock, so it cannot start between the check and the yield.
            let gate = s.active.as_ref().filter(|a| a.run_id == run_id).and_then(|a| a.gate.as_ref());
            if gate.is_none_or(|g| !g.open && !g.asking) {
                dir.yield_write();
            }
            return;
        }
        let a = s.active.as_mut().expect("checked by waiting");
        if let (Some(g), Some(tracked)) = (a.git.as_mut(), tracked) {
            g.tracked = tracked;
        }
        let g = a.gate.as_mut().expect("checked by waiting");
        g.asking = false;
        g.open = true;
        let held = std::mem::take(&mut g.held);
        if let (Some(mode), Some((cx, session))) = (g.restore.take(), s.conn.clone()) {
            // Requests until it takes effect are answered by the bot's tier anyway; the next turn waits for it.
            s.restoring = Some(tokio::spawn(async move {
                match cx.send_request(SetSessionModeRequest::new(session, mode.clone())).block_task().await {
                    Ok(_) => Some(mode),
                    Err(e) => {
                        tracing::warn!("session/set_mode {mode} failed: {e}");
                        None
                    }
                }
            }));
        }
        for (req, tx) in held {
            match permission_in(self, s, req) {
                Permission::Now(choice) => {
                    let _ = tx.send(choice);
                }
                Permission::Ask(rx) => {
                    tokio::spawn(async move {
                        let _ = tx.send(rx.await.ok().flatten());
                    });
                }
            }
        }
    }

    /// Whether the active turn may change files: its gate is open, or it has none.
    pub(super) fn may_change(&self, run_id: &str) -> bool {
        let s = self.0.lock().unwrap();
        s.active.as_ref().filter(|a| a.run_id == run_id).is_none_or(|a| a.gate.as_ref().is_none_or(|g| g.open))
    }
}

impl Conversation<'_> {
    /// A turn sharing its directory runs in the read-only tier's mode, which asks before changing files (read-only
    /// bots already do). Where the agent cannot switch to it, the turn waits for the other writers (or the group's
    /// go-ahead) before it starts. False: it was stopped meanwhile.
    pub(super) async fn guard(&mut self, req: &TurnReq, session: &SessionId, gate: workspace::WriteGate) -> bool {
        let bot = &req.start.bot;
        let read_only = bot.tier == Tier::ReadOnly;
        let restore = self.mode.clone().filter(|_| !read_only);
        match mode_for(bot.agent_kind, Tier::ReadOnly) {
            Some(mode) => {
                if self.modes.iter().any(|o| o == mode) {
                    self.switch(session, mode).await;
                }
                // Checked for read-only bots too: a session left in another mode would change files unasked.
                if self.mode.as_deref() == Some(mode) {
                    self.shared.guard(gate, restore);
                    return true;
                }
            }
            // Without modes, the read-only tier holds by other means (sandbox env, the pi extension's confirm).
            None if read_only => {
                self.shared.guard(gate, None);
                return true;
            }
            None => {}
        }
        self.shared.guard(gate, None);
        let (run_id, epoch) = {
            let mut s = self.shared.0.lock().unwrap();
            let Some(a) = s.active.as_mut() else { return false };
            let g = a.gate.as_mut().expect("just set");
            g.asking = true;
            (a.run_id.clone(), g.epoch)
        };
        self.shared.clone().await_write(run_id.clone(), epoch, t!("修改文件").into()).await;
        self.shared.may_change(&run_id)
    }
}
