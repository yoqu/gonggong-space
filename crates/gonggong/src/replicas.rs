//! Force sync in the run lifecycle (docs/plan/强制同步-开发计划.md §3.1, S4): a replica catches up before a turn,
//! submits the turn's changes after it (three-way merging conflicts), and idle replicas catch up when a new version is
//! out; the mode switch (§3.5, S8) makes a replica the base, aligns it or lets it leave; a paused replica's local edits
//! (F12) or held conflict (F11) are settled by sync.action or a merge turn. Every step on a replica holds its lock, and
//! a turn holds it from catch-up to submit, so a version arriving meanwhile is applied only once the turn's changes are
//! in (F8).
use crate::config::Config;
use crate::git;
use crate::protocol::{
    DaemonToServer, DriftChoice, RunOutcome, RunStart, RunSyncDone, SYNC_FILES_MAX, SyncActionKind, SyncChange,
    SyncChoice, SyncDecision, SyncEntry, SyncRejectReason, SyncReplicaIssue, SyncRole, SyncSubmit, SyncSubmitKind,
    SyncSubmitResult, SyncWaitIssue,
};
use crate::service::Outbox;
use crate::sync::{self, ApplyError, Base, Client, Held, Manifest, Merge, Pending, Replica};
use crate::t;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{OwnedMutexGuard, oneshot};

/// How long a submit waits for its sync.result before it is sent again, and how often it is sent; still unanswered,
/// it stays pending for the next sync.available (a reconnect brings one) or turn.
const RESULT_TIMEOUT: Duration = Duration::from_secs(60);
const SEND_ATTEMPTS: usize = 2;
/// Catch-up attempts after settling a replica, waiting 1 s, 2 s, 4 s… in between.
const CATCH_UP_ATTEMPTS: u32 = 5;
/// Submits per turn: the first plus re-submits after clean auto merges (F7); a conflict past that is held (F11).
const SUBMIT_ATTEMPTS: usize = 3;

/// One async lock per replica (group, bot).
type Locks = Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>;

pub(crate) struct Replicas {
    home: PathBuf,
    /// None without server REST access (tests): nothing is synced.
    client: Option<Client>,
    locks: Locks,
    /// Submits awaiting their sync.result, by submit id.
    waiting: Mutex<HashMap<String, oneshot::Sender<SyncSubmitResult>>>,
    /// Workspaces already set up for byte-exact sync.
    prepared: Mutex<HashSet<PathBuf>>,
    /// Replicas whose state the server may have missed (a catch-up that kept failing, a reconnect): their next idle
    /// catch-up reports where they are even at the head, which clears an issue the server still holds.
    unreported: Mutex<HashSet<(String, String)>>,
}

/// Why a force-group turn did not start.
pub(crate) enum Refusal {
    /// The replica waits for its local edits or held conflict to be settled: the server queues the run again.
    Wait(SyncWaitIssue),
    Failed(String),
}

impl From<String> for Refusal {
    fn from(e: String) -> Self {
        Refusal::Failed(e)
    }
}

/// Path → the head hash a change is rebased on (None = absent in the head).
type Rebased = BTreeMap<String, Option<String>>;

/// A force-group turn's hold on its replica, from the catch-up before it to the submit after it.
pub(crate) struct SyncTurn {
    replicas: Arc<Replicas>,
    replica: Replica,
    run_id: String,
    out: Outbox,
    _lock: OwnedMutexGuard<()>,
}

impl Replicas {
    pub fn new(home: PathBuf, api: Option<&Config>) -> Arc<Self> {
        let client = api.and_then(|c| Client::new(c).inspect_err(|e| tracing::warn!("sync client: {e:#}")).ok());
        Arc::new(Replicas {
            home,
            client,
            locks: Mutex::default(),
            waiting: Mutex::default(),
            prepared: Mutex::default(),
            unreported: Mutex::default(),
        })
    }

    async fn lock(&self, group: &str, bot: &str) -> OwnedMutexGuard<()> {
        let lock = self.locks.lock().unwrap().entry((group.into(), bot.into())).or_default().clone();
        lock.lock_owned().await
    }

    async fn prepare(&self, work: &Path) {
        if self.prepared.lock().unwrap().contains(work) {
            return;
        }
        match sync::prepare(work).await {
            Ok(()) => drop(self.prepared.lock().unwrap().insert(work.to_path_buf())),
            Err(e) => tracing::warn!("sync prepare {}: {e}", work.display()),
        }
    }

    /// Before a turn of a managed replica in a force group: catches it up to the head (F9), or makes the turn wait
    /// while it has local edits or a held conflict (F11, F12). A merge turn applies its decisions instead and runs on
    /// the held tree. None: nothing to sync (other mode, no server access, not joined yet).
    pub async fn before_turn(
        self: &Arc<Self>,
        start: &RunStart,
        cwd: &Path,
        out: &Outbox,
    ) -> Result<Option<SyncTurn>, Refusal> {
        let Some(sync_start) = start.sync.as_ref() else { return Ok(None) };
        if start.workspace.cd_path.is_some() || self.client.is_none() {
            return Ok(None);
        }
        let replica = Replica::new(&self.home, &start.group_id, &start.bot.id, cwd.to_path_buf());
        if !replica.joined() {
            tracing::warn!(
                "run {}: replica {}/{} has not joined force sync",
                start.run_id,
                start.group_id,
                start.bot.id
            );
            return Ok(None);
        }
        let lock = self.lock(&start.group_id, &start.bot.id).await;
        self.prepare(cwd).await;
        if let Err(e) = self.flush(&replica, out).await {
            tracing::warn!("run {}: resending the pending sync submit failed: {e}", start.run_id);
        }
        let turn = |replica| SyncTurn {
            replicas: self.clone(),
            replica,
            run_id: start.run_id.clone(),
            out: out.clone(),
            _lock: lock,
        };
        match replica.issue()? {
            Some(SyncReplicaIssue::Held) => {
                match (replica.held()?, &sync_start.resolve) {
                    (Some(held), _) if held.merging => {}
                    (Some(held), Some(decisions)) => self.decide(&replica, held, decisions).await?,
                    // The server dispatches a merge turn past the held conflict: waiting would bring it straight back.
                    (None, Some(_)) => return Err(t!("找不到待处理的同步冲突，无法合并").to_string().into()),
                    _ => return Err(Refusal::Wait(SyncWaitIssue::Held)),
                }
                // Stays on its base until the merge is in: the head's side of each file is already decided.
                return Ok(Some(turn(replica)));
            }
            Some(SyncReplicaIssue::Drift | SyncReplicaIssue::Dirty) => return Err(Refusal::Wait(SyncWaitIssue::Drift)),
            // Its own turn's changes that could not be submitted: this turn's submit carries them again.
            Some(SyncReplicaIssue::Error) => {}
            None if self.drifted(&replica, out).await? => return Err(Refusal::Wait(SyncWaitIssue::Drift)),
            None => {}
        }
        if let Err(e) = self.catch_up(&replica, out).await {
            tracing::warn!("run {}: catch-up failed, running behind: {e}", start.run_id);
        }
        Ok(Some(turn(replica)))
    }

    /// A new version is out: each idle, settled replica of the group catches up; one with a turn running waits for it.
    pub fn on_available(self: &Arc<Self>, group: &str, out: &Outbox) {
        if self.client.is_none() {
            return;
        }
        for replica in Replica::joined_in(&self.home, group) {
            let (me, out) = (self.clone(), out.clone());
            tokio::spawn(async move {
                let _lock = me.lock(replica.group(), replica.bot()).await;
                if let Err(e) = me.flush(&replica, &out).await {
                    tracing::warn!(
                        "resending the pending sync submit of {}/{} failed: {e}",
                        replica.group(),
                        replica.bot()
                    );
                }
                if let Err(e) = me.catch_up_idle(&replica, &out).await {
                    tracing::warn!("sync catch-up of {}/{} failed: {e}", replica.group(), replica.bot());
                }
            });
        }
    }

    /// A new connection: the server may have missed reports sent while away.
    pub fn connected(&self) {
        let mut unreported = self.unreported.lock().unwrap();
        unreported.extend(Replica::all(&self.home).iter().map(|r| (r.group().to_string(), r.bot().to_string())));
    }

    fn mark_unreported(&self, r: &Replica) {
        self.unreported.lock().unwrap().insert((r.group().into(), r.bot().into()));
    }

    fn take_unreported(&self, r: &Replica) -> bool {
        self.unreported.lock().unwrap().remove(&(r.group().into(), r.bot().into()))
    }

    pub fn on_result(&self, submit_id: &str, result: SyncSubmitResult) {
        if let Some(tx) = self.waiting.lock().unwrap().remove(submit_id) {
            let _ = tx.send(result);
        }
    }

    /// sync.action (F11, F12): someone settled the replica's local edits or held conflict.
    pub fn on_action(self: &Arc<Self>, group: String, bot: String, action: SyncActionKind, out: &Outbox) {
        let (me, out) = (self.clone(), out.clone());
        tokio::spawn(async move {
            let _lock = me.lock(&group, &bot).await;
            let Some(r) = Replica::find(&me.home, &group, &bot) else {
                return tracing::warn!("sync.action for {group}/{bot}: no such joined replica");
            };
            let result = match action {
                SyncActionKind::Drift { choice: DriftChoice::Submit } => me.submit_local(&r, &out).await,
                SyncActionKind::Drift { choice: DriftChoice::Discard } | SyncActionKind::Discard => {
                    me.discard(&r, &out).await
                }
                SyncActionKind::Conflict { decisions } => me.resolve(&r, &decisions, &out).await,
            };
            if let Err(e) = result {
                tracing::warn!("sync.action on {group}/{bot} failed: {e}");
                // Still paused; the reason shows on its replica row.
                if let Ok(Some(issue)) = r.issue() {
                    let paths = paused_paths(&r).await.unwrap_or_default();
                    report(&out, &r, issue, &paths, Some(e));
                }
            }
        });
    }

    /// sync.init (§3.5): becomes the base, aligns to the head or leaves, under the replica's lock. Repeating one is
    /// harmless: the base resubmits the same tree, a replica still at a synced version aligns without loss.
    pub fn on_init(self: &Arc<Self>, init: Init, out: &Outbox) {
        let (me, out) = (self.clone(), out.clone());
        tokio::spawn(async move {
            let lock = me.lock(&init.group, &init.bot).await;
            let work = crate::workspace::managed_path(&me.home, &init.group, &init.bot, init.repo_id.as_deref());
            let r = Replica::new(&me.home, &init.group, &init.bot, work);
            let result = match init.role {
                SyncRole::Leave => r.forget(),
                SyncRole::Base => me.become_base(&r, &out).await,
                SyncRole::Align => me.align(&r, init.force, &out).await,
            };
            if let Err(e) = result {
                tracing::warn!("sync.init {:?} of {}/{} failed: {e}", init.role, init.group, init.bot);
                if init.role != SyncRole::Leave {
                    report(&out, &r, SyncReplicaIssue::Error, &[], Some(e));
                }
            }
            drop(lock);
            if init.role == SyncRole::Leave {
                let mut locks = me.locks.lock().unwrap();
                let key = (init.group, init.bot);
                if locks.get(&key).is_some_and(|l| Arc::strong_count(l) == 1) {
                    locks.remove(&key);
                }
            }
        });
    }

    fn client(&self) -> Result<&Client, String> {
        self.client.as_ref().ok_or_else(|| t!("无法连接服务器同步接口").to_string())
    }

    /// The base of a mode switch: its whole tree, uncommitted changes included, replaces the head.
    async fn become_base(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let client = self.client()?;
        self.prepare(r.work()).await;
        let tree = r.tree().await?;
        let files = tree.manifest();
        let changes = sync::diff(&Manifest::new(), &files);
        let violations = sync::check(&tree, &changes);
        if let Some(first) = violations.first() {
            let paths: Vec<_> = violations.iter().map(|v| v.path.clone()).collect();
            report(out, r, SyncReplicaIssue::Error, &paths, Some(first.reason()));
            return Ok(());
        }
        upload(client, r, &changes).await?;
        match self.submit(r, None, SyncSubmitKind::Init, out, 0, false, changes, &files).await? {
            SyncSubmitResult::Accepted { version } => {
                r.set_base(&Base { version, files: files.clone() })?;
                r.clear()?;
                applied(out, r, version, sync::manifest_root(&files));
                Ok(())
            }
            SyncSubmitResult::Rejected { reason } => Err(rejected(reason)),
            SyncSubmitResult::Conflict { .. } => Err(t!("同步提交被拒绝：与权威版本冲突").into()),
        }
    }

    /// Joins a replica: its tree becomes exactly the head (files the head lacks are deleted). Uncommitted git changes
    /// leave it out (`dirty`) unless `force`; whatever is overwritten is backed up first, except on a replica still
    /// matching a version it synced, whose files are all in the server's history.
    async fn align(&self, r: &Replica, force: bool, out: &Outbox) -> Result<(), String> {
        self.prepare(r.work()).await;
        let current = r.tree().await?.manifest();
        let synced = r.joined() && r.issue()?.is_none() && !sync::drift(&r.base()?.files, &current);
        if !force && !synced {
            let dirty: Vec<String> = git::porcelain(r.work()).await?.into_keys().collect();
            if !dirty.is_empty() {
                r.forget()?;
                report(out, r, SyncReplicaIssue::Dirty, &dirty, None);
                return Ok(());
            }
        }
        self.reset(r, current, !synced, out).await
    }

    /// Makes the tree exactly the head (files the head lacks are deleted; with `backup` whatever is overwritten is
    /// backed up first), settles the replica and reports it.
    async fn reset(&self, r: &Replica, current: Manifest, backup: bool, out: &Outbox) -> Result<(), String> {
        let client = self.client()?;
        let res = client.changes(r.group(), 0).await.map_err(|e| format!("{e:#}"))?;
        if res.head_version == 0 {
            return Err(t!("强制同步还没有版本").into());
        }
        let head = sync::advance(&Manifest::new(), &res.entries);
        if backup {
            let overwritten: Vec<String> =
                current.iter().filter(|(p, f)| head.get(*p) != Some(*f)).map(|(p, _)| p.clone()).collect();
            r.backup(&overwritten)?;
        }
        let mut entries = res.entries;
        entries.extend(current.keys().filter(|p| !head.contains_key(*p)).map(|p| SyncEntry {
            path: p.clone(),
            hash: None,
            exec: false,
        }));
        let group = r.group();
        let fetch = |hash: String| async move { client.download(group, &hash).await.map_err(|e| format!("{e:#}")) };
        let base = Base { version: 0, files: current };
        let root_hash = r.apply_from(base, res.head_version, &entries, fetch).await.map_err(|e| e.to_string())?;
        r.clear()?;
        applied(out, r, res.head_version, root_hash);
        Ok(())
    }

    /// 丢弃 (F12) / 整版丢弃 (F11): what changed since the base is backed up, then the tree becomes the head.
    async fn discard(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let current = r.tree().await?.manifest();
        let changed: Vec<String> = sync::diff(&r.base()?.files, &current).into_iter().map(|c| c.path).collect();
        r.backup(&changed)?;
        self.reset(r, current, false, out).await
    }

    /// 提交为一版 (F12): the local edits go in like a turn's, conflicts included (F7, F11); a /stop'ped turn's changes
    /// kept by its initiator go in as that run's, kind `interrupted` (F21).
    async fn submit_local(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let stopped = r.stopped()?;
        let kind = if stopped.is_some() { SyncSubmitKind::Interrupted } else { SyncSubmitKind::Local };
        match self.submit_tree(r, stopped.as_deref(), kind, out).await? {
            RunSyncDone::Accepted { .. } | RunSyncDone::Unchanged { .. } => self.settle(r, out).await,
            // Reported already.
            _ => Ok(()),
        }
    }

    /// Per-file decisions on the held change (F11), re-submitted at once unless a bot merge turn is due.
    async fn resolve(&self, r: &Replica, decisions: &[SyncDecision], out: &Outbox) -> Result<(), String> {
        let held = r.held()?.ok_or_else(|| t!("找不到待处理的同步冲突").to_string())?;
        self.decide(r, held, decisions).await?;
        if r.held()?.is_some_and(|h| h.merging) {
            return Ok(());
        }
        match self.submit_tree(r, None, SyncSubmitKind::Merge, out).await? {
            RunSyncDone::Accepted { .. } | RunSyncDone::Unchanged { .. } => self.settle(r, out).await,
            _ => Ok(()),
        }
    }

    /// Writes each decision into the tree and rebases its path on the head: keep mine leaves the file, take theirs
    /// writes the head's, let the bot merge writes the three-way merge with conflict markers for a merge turn.
    async fn decide(&self, r: &Replica, mut held: Held, decisions: &[SyncDecision]) -> Result<(), String> {
        let client = self.client()?;
        let fetch = async |hash: &str| download(client, r, hash).await;
        for d in decisions {
            let theirs = held
                .conflicts
                .iter()
                .find(|c| c.path == d.path)
                .ok_or_else(|| t!("{path} 不是冲突文件", path = d.path))?
                .clone();
            match d.choice {
                SyncChoice::Mine => {}
                SyncChoice::Theirs => {
                    let bytes = match &theirs.hash {
                        Some(h) => Some(fetch(h).await?),
                        None => None,
                    };
                    r.put(&d.path, bytes.as_deref(), theirs.exec)?;
                }
                SyncChoice::Bot => {
                    let mine = held.changes.iter().find(|c| c.path == d.path);
                    let (Some(mine), Some(their_hash)) = (mine, &theirs.hash) else {
                        return Err(t!("{path} 不能交给 Bot 合并", path = d.path));
                    };
                    let Some(mine_hash) = &mine.hash else {
                        return Err(t!("{path} 不能交给 Bot 合并", path = d.path));
                    };
                    // The held side, never the tree: a merge turn that did not finish may have left markers there.
                    let mine_bytes = fetch(mine_hash).await?;
                    let base = match &mine.base_hash {
                        Some(h) => Some(fetch(h).await?),
                        None => None,
                    };
                    let bytes = match r.merge(&mine_bytes, base.as_deref(), &fetch(their_hash).await?).await? {
                        Merge::Clean(b) | Merge::Conflict(b) => b,
                        Merge::Binary => return Err(t!("{path} 不能交给 Bot 合并", path = d.path)),
                    };
                    r.put(&d.path, Some(&bytes), mine.exec)?;
                    held.merging = true;
                }
            }
            held.rebased.insert(d.path.clone(), theirs.hash.clone());
        }
        r.set_held(Some(&held))
    }

    /// After settling: catches up to the head, or reports the version it is at, which clears the server's issue. A
    /// failed catch-up is retried a few times, then left to the next sync.available (a reconnect brings one).
    async fn settle(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let mut delay = Duration::from_secs(1);
        let mut attempt = 1;
        loop {
            match self.catch_up(r, out).await {
                Ok(true) => return Ok(()),
                Ok(false) => return self.report_base(r, out),
                Err(ApplyError::Failed(e)) if attempt < CATCH_UP_ATTEMPTS => {
                    tracing::warn!("sync catch-up of {}/{} failed, retrying: {e}", r.group(), r.bot());
                    tokio::time::sleep(delay).await;
                    delay *= 2;
                    attempt += 1;
                }
                Err(e) => {
                    self.mark_unreported(r);
                    return Err(e.to_string());
                }
            }
        }
    }

    fn report_base(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let base = r.base()?;
        applied(out, r, base.version, sync::manifest_root(&base.files));
        Ok(())
    }

    /// Resends the submit a timeout or a restart left unsettled, with its id: the server answers an accepted one with
    /// its version again. Accepted, its tree becomes the base and the replica is settled; otherwise it is dropped and
    /// its changes stay in the tree for the next submit.
    async fn flush(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        let Some(p) = r.pending()? else { return Ok(()) };
        if let SyncSubmitResult::Accepted { .. } = self.send(&p, out).await? {
            r.set_base(&Base { version: p.submit.base_version, files: p.files })?;
            return r.clear();
        }
        r.set_pending(None)
    }

    async fn catch_up_idle(&self, r: &Replica, out: &Outbox) -> Result<(), String> {
        // Paused until someone settles it (F11, F12).
        if r.issue()?.is_some() {
            return Ok(());
        }
        self.prepare(r.work()).await;
        if self.drifted(r, out).await? {
            return Ok(());
        }
        match self.catch_up(r, out).await {
            Err(ApplyError::Drift(paths)) => {
                report(out, r, SyncReplicaIssue::Drift, &paths, None);
                r.set_issue(Some(SyncReplicaIssue::Drift))
            }
            Err(ApplyError::Failed(e)) => Err(e),
            Ok(true) => {
                self.take_unreported(r);
                Ok(())
            }
            Ok(false) if self.take_unreported(r) => self.report_base(r, out),
            Ok(false) => Ok(()),
        }
    }

    /// Local edits since the base (F12) are reported and pause the replica.
    async fn drifted(&self, r: &Replica, out: &Outbox) -> Result<bool, String> {
        let changes = sync::diff(&r.base()?.files, &r.tree().await?.manifest());
        if changes.is_empty() {
            return Ok(false);
        }
        let paths: Vec<_> = changes.into_iter().map(|c| c.path).collect();
        report(out, r, SyncReplicaIssue::Drift, &paths, None);
        r.set_issue(Some(SyncReplicaIssue::Drift))?;
        Ok(true)
    }

    /// Applies what changed since the base up to the head and reports the tree's root hash (F14); false when it was
    /// at the head already.
    async fn catch_up(&self, r: &Replica, out: &Outbox) -> Result<bool, ApplyError> {
        let Some(client) = &self.client else { return Ok(false) };
        let base = r.base()?;
        let res = client.changes(r.group(), base.version).await.map_err(|e| format!("{e:#}"))?;
        if res.head_version <= base.version {
            return Ok(false);
        }
        let group = r.group();
        let fetch = |hash: String| async move { client.download(group, &hash).await.map_err(|e| format!("{e:#}")) };
        let root_hash = r.apply(res.head_version, &res.entries, fetch).await?;
        applied(out, r, res.head_version, root_hash);
        Ok(true)
    }

    /// Submits the tree's changes since the base as a version (F6), three-way merging conflicts (F7) and holding what
    /// still conflicts (F11). Settling a held change submits as kind `merge`, its decided paths rebased on the head.
    async fn submit_tree(
        &self,
        r: &Replica,
        run_id: Option<&str>,
        kind: SyncSubmitKind,
        out: &Outbox,
    ) -> Result<RunSyncDone, String> {
        let client = self.client()?;
        let base = r.base()?;
        let held = r.held()?;
        let kind = if held.is_some() { SyncSubmitKind::Merge } else { kind };
        // After a clean merge or a decision a path is submitted on top of the head's content.
        let mut rebased: Rebased = held.map(|h| h.rebased).unwrap_or_default();
        let mut tree = r.tree().await?;
        let mut changes = sync::diff(&base.files, &tree.manifest());
        if changes.is_empty() {
            r.clear()?;
            return Ok(RunSyncDone::Unchanged { version: base.version });
        }
        let violations = sync::check(&tree, &changes);
        if let Some(first) = violations.first() {
            let paths: Vec<_> = violations.iter().map(|v| v.path.clone()).collect();
            report(out, r, SyncReplicaIssue::Error, &paths, Some(first.reason()));
            r.set_issue(Some(SyncReplicaIssue::Error))?;
            return Ok(RunSyncDone::Error { reason: first.reason() });
        }
        for attempt in 0..SUBMIT_ATTEMPTS {
            for c in &mut changes {
                if let Some(h) = rebased.get(&c.path) {
                    c.base_hash = h.clone();
                }
            }
            upload(client, r, &changes).await?;
            let merged = attempt > 0;
            let files = tree.manifest();
            let submitted = self.submit(r, run_id, kind, out, base.version, merged, changes.clone(), &files);
            match submitted.await? {
                SyncSubmitResult::Accepted { version } => {
                    // The submitted tree on top of the old base: catching up from there brings in the others' changes.
                    r.set_base(&Base { version: base.version, files })?;
                    r.clear()?;
                    return Ok(RunSyncDone::Accepted { version, merged });
                }
                SyncSubmitResult::Rejected { reason } => return Err(rejected(reason)),
                SyncSubmitResult::Conflict { conflicts, .. } => {
                    if attempt + 1 == SUBMIT_ATTEMPTS || !merge(client, r, &changes, &conflicts, &mut rebased).await? {
                        let paths: Vec<_> = conflicts.iter().map(|c| c.path.clone()).collect();
                        r.set_held(Some(&Held { changes, conflicts, rebased, merging: false }))?;
                        r.set_issue(Some(SyncReplicaIssue::Held))?;
                        report(out, r, SyncReplicaIssue::Held, &paths, None);
                        return Ok(RunSyncDone::Held { files: paths.len() as u32 });
                    }
                    tree = r.tree().await?;
                    changes = sync::diff(&base.files, &tree.manifest());
                }
            }
        }
        unreachable!("the last attempt returns")
    }

    /// Versions that came out during the turn (F8).
    async fn catch_up_after(&self, r: &Replica, out: &Outbox) {
        if let Err(e) = self.catch_up(r, out).await {
            tracing::warn!("sync catch-up of {}/{} after the turn failed: {e}", r.group(), r.bot());
        }
    }

    /// Submits `changes` (taking the tree to `files`), kept as pending until a result settles it: a refused one is
    /// dropped here, an accepted one by the caller once its base is set.
    #[allow(clippy::too_many_arguments)]
    async fn submit(
        &self,
        r: &Replica,
        run_id: Option<&str>,
        kind: SyncSubmitKind,
        out: &Outbox,
        base_version: u64,
        merged: bool,
        changes: Vec<SyncChange>,
        files: &Manifest,
    ) -> Result<SyncSubmitResult, String> {
        let submit = SyncSubmit {
            group_id: r.group().into(),
            bot_id: r.bot().into(),
            submit_id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.map(Into::into),
            base_version,
            kind,
            merged,
            changes,
        };
        let p = Pending { submit, files: files.clone() };
        r.set_pending(Some(&p))?;
        let result = self.send(&p, out).await?;
        if !matches!(result, SyncSubmitResult::Accepted { .. }) {
            r.set_pending(None)?;
        }
        Ok(result)
    }

    /// Sends a submit and waits for its sync.result, sending it again while none comes.
    async fn send(&self, p: &Pending, out: &Outbox) -> Result<SyncSubmitResult, String> {
        let id = p.submit.submit_id.clone();
        let (tx, mut rx) = oneshot::channel();
        self.waiting.lock().unwrap().insert(id.clone(), tx);
        let mut result = None;
        for _ in 0..SEND_ATTEMPTS {
            out.send(DaemonToServer::SyncSubmit(p.submit.clone()));
            if let Ok(answer) = tokio::time::timeout(RESULT_TIMEOUT, &mut rx).await {
                result = answer.ok();
                break;
            }
        }
        self.waiting.lock().unwrap().remove(&id);
        result.ok_or_else(|| t!("等待服务器确认同步提交超时").into())
    }

    /// A stopped or failed turn submits nothing (F21). A merge turn leaves its conflict held as it was, the files back
    /// on the replica's side; otherwise the changes wait in the tree like local edits: a stop's for its initiator to
    /// keep or discard, a failure's for the bot's owner (F12).
    async fn unsubmitted(
        &self,
        r: &Replica,
        run_id: &str,
        outcome: RunOutcome,
        out: &Outbox,
    ) -> Result<RunSyncDone, String> {
        if let Some(held) = r.held()?.filter(|h| h.merging) {
            let files = held.conflicts.len() as u32;
            self.restore(r, held).await?;
            return Ok(RunSyncDone::Held { files });
        }
        let base = r.base()?;
        let paths: Vec<String> =
            sync::diff(&base.files, &r.tree().await?.manifest()).into_iter().map(|c| c.path).collect();
        if paths.is_empty() {
            return Ok(RunSyncDone::Unchanged { version: base.version });
        }
        r.set_issue(Some(SyncReplicaIssue::Drift))?;
        if outcome == RunOutcome::Interrupted {
            r.set_stopped(Some(run_id))?;
            return Ok(RunSyncDone::Stopped { files: paths.len() as u32 });
        }
        report(out, r, SyncReplicaIssue::Drift, &paths, None);
        Ok(RunSyncDone::Error { reason: t!("本轮异常结束，改动未提交，待 Bot 主人处理").into() })
    }

    /// Puts the tree back to the replica's side of the held change (the base plus its changes), so no conflict
    /// markers stay behind and nothing else the turn touched goes in with the resolution later; those other edits are
    /// backed up first.
    async fn restore(&self, r: &Replica, mut held: Held) -> Result<(), String> {
        let client = self.client()?;
        let side: Vec<SyncEntry> = held
            .changes
            .iter()
            .map(|c| SyncEntry { path: c.path.clone(), hash: c.hash.clone(), exec: c.exec })
            .collect();
        let side = sync::advance(&r.base()?.files, &side);
        let strays = sync::diff(&side, &r.tree().await?.manifest());
        let conflicted: HashSet<&str> = held.conflicts.iter().map(|c| c.path.as_str()).collect();
        r.backup(
            &strays
                .iter()
                .filter(|c| !conflicted.contains(c.path.as_str()))
                .map(|c| c.path.clone())
                .collect::<Vec<_>>(),
        )?;
        for c in strays {
            let bytes = match &c.base_hash {
                Some(h) => Some(download(client, r, h).await?),
                None => None,
            };
            r.put(&c.path, bytes.as_deref(), side.get(&c.path).is_some_and(|f| f.exec))?;
        }
        held.merging = false;
        r.set_held(Some(&held))
    }
}

impl SyncTurn {
    /// After the turn, before run.done (F10): submits a completed turn's changes and settles them.
    pub async fn finish(self, outcome: RunOutcome) -> RunSyncDone {
        let r = &self.replica;
        let settled = match outcome {
            RunOutcome::Completed => {
                self.replicas.submit_tree(r, Some(&self.run_id), SyncSubmitKind::Run, &self.out).await
            }
            _ => self.replicas.unsubmitted(r, &self.run_id, outcome, &self.out).await,
        };
        match settled {
            Ok(done @ (RunSyncDone::Accepted { .. } | RunSyncDone::Unchanged { .. })) => {
                self.replicas.catch_up_after(r, &self.out).await;
                done
            }
            Ok(done) => done,
            Err(reason) => {
                report(&self.out, r, SyncReplicaIssue::Error, &[], Some(reason.clone()));
                if let Err(e) = r.set_issue(Some(SyncReplicaIssue::Error)) {
                    tracing::warn!("{e}");
                }
                RunSyncDone::Error { reason }
            }
        }
    }
}

/// What a paused replica's row lists: the held change's conflicting paths, else what changed since the base.
async fn paused_paths(r: &Replica) -> Result<Vec<String>, String> {
    if let Some(held) = r.held()? {
        return Ok(held.conflicts.into_iter().map(|c| c.path).collect());
    }
    Ok(sync::diff(&r.base()?.files, &r.tree().await?.manifest()).into_iter().map(|c| c.path).collect())
}

fn rejected(reason: SyncRejectReason) -> String {
    match reason {
        SyncRejectReason::BlobsMissing => t!("同步提交被拒绝：文件内容未上传完整"),
        SyncRejectReason::TooLarge => t!("同步提交被拒绝：超过单版体积上限"),
        SyncRejectReason::NotParticipating => t!("同步提交被拒绝：该副本未参与强制同步"),
        SyncRejectReason::BadBase => t!("同步提交被拒绝：基准版本无效"),
    }
    .into()
}

/// A sync.init as the engine hands it over.
pub(crate) struct Init {
    pub group: String,
    pub bot: String,
    pub role: SyncRole,
    pub force: bool,
    pub repo_id: Option<String>,
}

fn applied(out: &Outbox, r: &Replica, version: u64, root_hash: String) {
    out.send(DaemonToServer::SyncApplied { group_id: r.group().into(), bot_id: r.bot().into(), version, root_hash });
}

fn report(out: &Outbox, r: &Replica, state: SyncReplicaIssue, paths: &[String], reason: Option<String>) {
    out.send(DaemonToServer::SyncState {
        group_id: r.group().into(),
        bot_id: r.bot().into(),
        state,
        files: paths.iter().take(SYNC_FILES_MAX).cloned().collect(),
        total: paths.len() as u32,
        reason,
    });
}

async fn download(client: &Client, r: &Replica, hash: &str) -> Result<Vec<u8>, String> {
    client.download(r.group(), hash).await.map_err(|e| t!("下载同步内容失败：{e}", e = format!("{e:#}")))
}

/// Uploads the new contents the server lacks (F15).
async fn upload(client: &Client, r: &Replica, changes: &[SyncChange]) -> Result<(), String> {
    let mut paths: HashMap<&str, &str> = HashMap::new();
    for c in changes {
        if let Some(h) = &c.hash {
            paths.entry(h).or_insert(&c.path);
        }
    }
    let hashes: Vec<String> = paths.keys().map(|h| h.to_string()).collect();
    let fail = |e: anyhow::Error| t!("上传同步内容失败：{e}", e = format!("{e:#}"));
    for hash in client.missing(r.group(), &hashes).await.map_err(fail)? {
        let path = r.work().join(paths[hash.as_str()]);
        client.upload(r.group(), &hash, &path).await.map_err(fail)?;
    }
    Ok(())
}

/// Three-way merges every conflicting file (base / mine / the head's); writes them only when all merge cleanly and
/// records the head's hash each was rebased on. False: something needs a person (a deletion, binary, overlapping edits).
async fn merge(
    client: &Client,
    r: &Replica,
    changes: &[SyncChange],
    conflicts: &[SyncEntry],
    rebased: &mut Rebased,
) -> Result<bool, String> {
    let fetch = async |hash: &str| download(client, r, hash).await;
    let mut merged = vec![];
    for theirs in conflicts {
        let Some(mine) = changes.iter().find(|c| c.path == theirs.path) else { return Ok(false) };
        let (Some(_), Some(their_hash)) = (&mine.hash, &theirs.hash) else { return Ok(false) };
        let mine_bytes = std::fs::read(r.work().join(&mine.path))
            .map_err(|e| t!("无法读取 {path}：{e}", path = mine.path, e = e))?;
        let base = match &mine.base_hash {
            Some(h) => Some(fetch(h).await?),
            None => None,
        };
        let their_bytes = fetch(their_hash).await?;
        match r.merge(&mine_bytes, base.as_deref(), &their_bytes).await? {
            Merge::Clean(bytes) => merged.push((&mine.path, their_hash, bytes)),
            Merge::Conflict(_) | Merge::Binary => return Ok(false),
        }
    }
    for (path, their_hash, bytes) in merged {
        std::fs::write(r.work().join(path), bytes).map_err(|e| t!("无法写入 {path}：{e}", path = path, e = e))?;
        rebased.insert(path.clone(), Some(their_hash.clone()));
    }
    Ok(true)
}
