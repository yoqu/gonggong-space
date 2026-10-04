//! Force sync in the run lifecycle (docs/plan/强制同步-开发计划.md §3.1, S4): a replica catches up before a turn,
//! submits the turn's changes after it (three-way merging conflicts), and idle replicas catch up when a new version is
//! out; the mode switch (§3.5, S8) makes a replica the base, aligns it or lets it leave. Every step on a replica holds
//! its lock, and a turn holds it from catch-up to submit, so a version arriving meanwhile is applied only once the
//! turn's changes are in (F8).
use crate::config::Config;
use crate::git;
use crate::protocol::{
    DaemonToServer, RunStart, RunSyncDone, SYNC_FILES_MAX, SyncChange, SyncEntry, SyncRejectReason, SyncReplicaIssue,
    SyncRole, SyncSubmit, SyncSubmitKind, SyncSubmitResult,
};
use crate::service::Outbox;
use crate::sync::{self, ApplyError, Base, Client, Manifest, Merge, Replica};
use crate::t;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{OwnedMutexGuard, oneshot};

/// How long a submit waits for its sync.result.
const RESULT_TIMEOUT: Duration = Duration::from_secs(60);
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
    pending: Mutex<HashMap<String, oneshot::Sender<SyncSubmitResult>>>,
    /// Workspaces already set up for byte-exact sync.
    prepared: Mutex<HashSet<PathBuf>>,
}

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
            pending: Mutex::default(),
            prepared: Mutex::default(),
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

    /// Before a turn of a managed replica in a force group: catches it up to the head (F9), or refuses the turn while
    /// it waits for a decision (F11, F12). None: nothing to sync (other mode, no server access, not joined yet).
    pub async fn before_turn(
        self: &Arc<Self>,
        start: &RunStart,
        cwd: &Path,
        out: &Outbox,
    ) -> Result<Option<SyncTurn>, String> {
        if start.sync.is_none() || start.workspace.cd_path.is_some() || self.client.is_none() {
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
        match replica.issue()? {
            Some(SyncReplicaIssue::Held) => return Err(t!("强制同步有冲突待处理，处理后才能继续运行").into()),
            Some(SyncReplicaIssue::Drift | SyncReplicaIssue::Dirty) => return Err(drift_error()),
            // Its own turn's changes that could not be submitted: this turn's submit carries them again.
            Some(SyncReplicaIssue::Error) => {}
            None if self.drifted(&replica, out).await? => return Err(drift_error()),
            None => {}
        }
        if let Err(e) = self.catch_up(&replica, out).await {
            tracing::warn!("run {}: catch-up failed, running behind: {e}", start.run_id);
        }
        Ok(Some(SyncTurn {
            replicas: self.clone(),
            replica,
            run_id: start.run_id.clone(),
            out: out.clone(),
            _lock: lock,
        }))
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
                if let Err(e) = me.catch_up_idle(&replica, &out).await {
                    tracing::warn!("sync catch-up of {}/{} failed: {e}", replica.group(), replica.bot());
                }
            });
        }
    }

    pub fn on_result(&self, submit_id: &str, result: SyncSubmitResult) {
        if let Some(tx) = self.pending.lock().unwrap().remove(submit_id) {
            let _ = tx.send(result);
        }
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
        match self.submit(r, None, SyncSubmitKind::Init, out, 0, false, changes).await? {
            SyncSubmitResult::Accepted { version } => {
                r.set_base(&Base { version, files: files.clone() })?;
                r.set_issue(None)?;
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
        let client = self.client()?;
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
        let res = client.changes(r.group(), 0).await.map_err(|e| format!("{e:#}"))?;
        if res.head_version == 0 {
            return Err(t!("强制同步还没有版本").into());
        }
        let head = sync::advance(&Manifest::new(), &res.entries);
        let mut entries = res.entries;
        entries.extend(current.keys().filter(|p| !head.contains_key(*p)).map(|p| SyncEntry {
            path: p.clone(),
            hash: None,
            exec: false,
        }));
        if !synced {
            let overwritten: Vec<String> =
                current.iter().filter(|(p, f)| head.get(*p) != Some(*f)).map(|(p, _)| p.clone()).collect();
            r.backup(&overwritten)?;
        }
        let group = r.group();
        let fetch = |hash: String| async move { client.download(group, &hash).await.map_err(|e| format!("{e:#}")) };
        let base = Base { version: 0, files: current };
        let root_hash = r.apply_from(base, res.head_version, &entries, fetch).await.map_err(|e| e.to_string())?;
        r.set_issue(None)?;
        applied(out, r, res.head_version, root_hash);
        Ok(())
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
            Ok(()) => Ok(()),
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

    /// Applies what changed since the base up to the head and reports the tree's root hash (F14).
    async fn catch_up(&self, r: &Replica, out: &Outbox) -> Result<(), ApplyError> {
        let Some(client) = &self.client else { return Ok(()) };
        let base = r.base()?;
        let res = client.changes(r.group(), base.version).await.map_err(|e| format!("{e:#}"))?;
        if res.head_version <= base.version {
            return Ok(());
        }
        let group = r.group();
        let fetch = |hash: String| async move { client.download(group, &hash).await.map_err(|e| format!("{e:#}")) };
        let root_hash = r.apply(res.head_version, &res.entries, fetch).await?;
        applied(out, r, res.head_version, root_hash);
        Ok(())
    }

    async fn submit_turn(&self, r: &Replica, run_id: &str, out: &Outbox) -> Result<RunSyncDone, String> {
        let client = self.client.as_ref().expect("a sync turn has a client");
        let base = r.base()?;
        let mut tree = r.tree().await?;
        let mut changes = sync::diff(&base.files, &tree.manifest());
        if changes.is_empty() {
            self.catch_up_after(r, out).await;
            return Ok(RunSyncDone::Unchanged { version: base.version });
        }
        let violations = sync::check(&tree, &changes);
        if let Some(first) = violations.first() {
            let paths: Vec<_> = violations.iter().map(|v| v.path.clone()).collect();
            report(out, r, SyncReplicaIssue::Error, &paths, Some(first.reason()));
            r.set_issue(Some(SyncReplicaIssue::Error))?;
            return Ok(RunSyncDone::Error { reason: first.reason() });
        }
        // After a clean merge a path is re-submitted on top of the head's content (F7).
        let mut rebased: HashMap<String, String> = HashMap::new();
        for attempt in 0..SUBMIT_ATTEMPTS {
            for c in &mut changes {
                if let Some(h) = rebased.get(&c.path) {
                    c.base_hash = Some(h.clone());
                }
            }
            upload(client, r, &changes).await?;
            let merged = attempt > 0;
            let submitted =
                self.submit(r, Some(run_id), SyncSubmitKind::Run, out, base.version, merged, changes.clone());
            match submitted.await? {
                SyncSubmitResult::Accepted { version } => {
                    // The submitted tree on top of the old base: catching up from there brings in the others' changes.
                    r.set_base(&Base { version: base.version, files: tree.manifest() })?;
                    r.set_issue(None)?;
                    self.catch_up_after(r, out).await;
                    return Ok(RunSyncDone::Accepted { version, merged });
                }
                SyncSubmitResult::Rejected { reason } => return Err(rejected(reason)),
                SyncSubmitResult::Conflict { conflicts, .. } => {
                    if attempt + 1 == SUBMIT_ATTEMPTS || !merge(client, r, &changes, &conflicts, &mut rebased).await? {
                        let paths: Vec<_> = conflicts.into_iter().map(|c| c.path).collect();
                        report(out, r, SyncReplicaIssue::Held, &paths, None);
                        r.set_issue(Some(SyncReplicaIssue::Held))?;
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
    ) -> Result<SyncSubmitResult, String> {
        let submit_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(submit_id.clone(), tx);
        out.send(DaemonToServer::SyncSubmit(SyncSubmit {
            group_id: r.group().into(),
            bot_id: r.bot().into(),
            submit_id: submit_id.clone(),
            run_id: run_id.map(Into::into),
            base_version,
            kind,
            merged,
            changes,
        }));
        let result = tokio::time::timeout(RESULT_TIMEOUT, rx).await;
        self.pending.lock().unwrap().remove(&submit_id);
        match result {
            Ok(Ok(result)) => Ok(result),
            _ => Err(t!("等待服务器确认同步提交超时").into()),
        }
    }
}

impl SyncTurn {
    /// After the turn, before run.done (F10): submits its changes and settles them.
    pub async fn finish(self) -> RunSyncDone {
        let r = &self.replica;
        match self.replicas.submit_turn(r, &self.run_id, &self.out).await {
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

fn drift_error() -> String {
    t!("工作区有未处理的本地改动（强制同步），处理后才能继续运行").into()
}

fn rejected(reason: SyncRejectReason) -> String {
    match reason {
        SyncRejectReason::BlobsMissing => t!("同步提交被拒绝：文件内容未上传完整"),
        SyncRejectReason::TooLarge => t!("同步提交被拒绝：超过单版体积上限"),
        SyncRejectReason::NotParticipating => t!("同步提交被拒绝：该副本未参与强制同步"),
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
    rebased: &mut HashMap<String, String>,
) -> Result<bool, String> {
    let fetch = async |hash: &str| {
        client.download(r.group(), hash).await.map_err(|e| t!("下载同步内容失败：{e}", e = format!("{e:#}")))
    };
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
        rebased.insert(path.clone(), their_hash.clone());
    }
    Ok(true)
}
