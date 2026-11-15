use super::*;

/// A path's state in a version: `hash` (sha256 hex) `None` = deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncEntry {
    pub path: String,
    pub hash: Option<String>,
    pub exec: bool,
}

/// `base_hash`: the path's hash at the replica's base version, `None` = it did not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub path: String,
    pub hash: Option<String>,
    pub exec: bool,
    pub base_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncSubmitKind {
    Init,
    Run,
    Local,
    Interrupted,
    Merge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSubmit {
    pub group_id: String,
    pub bot_id: String,
    pub submit_id: String,
    pub run_id: Option<String>,
    pub base_version: u64,
    pub kind: SyncSubmitKind,
    pub merged: bool,
    pub changes: Vec<SyncChange>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncReplicaIssue {
    Drift,
    Held,
    Dirty,
    Error,
    Lost,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncRejectReason {
    BlobsMissing,
    TooLarge,
    NotParticipating,
    BadBase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SyncSubmitResult {
    Accepted {
        version: u64,
    },
    #[serde(rename_all = "camelCase")]
    Conflict {
        head_version: u64,
        conflicts: Vec<SyncEntry>,
    },
    Rejected {
        reason: SyncRejectReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncChoice {
    Mine,
    Theirs,
    Bot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncDecision {
    pub path: String,
    pub choice: SyncChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriftChoice {
    Submit,
    Discard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SyncActionKind {
    Drift { choice: DriftChoice },
    Conflict { decisions: Vec<SyncDecision> },
    Discard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncRole {
    Base,
    Align,
    Leave,
}

/// run.start in a force group: catch up to `head_version` first; `changed` since this bot's last turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSyncStart {
    pub head_version: u64,
    pub last_version: Option<u64>,
    pub changed: Vec<String>,
    pub changed_total: u32,
    /// A merge turn: the held change's decisions, applied before the turn; its submit is kind `merge`.
    #[serde(default)]
    pub resolve: Option<Vec<SyncDecision>>,
}

/// Why a turn did not start: the replica waits for its local edits or held conflict to be settled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncWaitIssue {
    Drift,
    Held,
}

/// How a force-group turn's submit settled before run.done.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum RunSyncDone {
    Accepted {
        version: u64,
        merged: bool,
    },
    Unchanged {
        version: u64,
    },
    Held {
        files: u32,
    },
    Error {
        reason: String,
        #[serde(rename = "reasonI18n", default)]
        reason_i18n: Option<I18nText>,
    },
    Waiting {
        issue: SyncWaitIssue,
    },
    /// /stop left `files` changed and unsubmitted (F21): kept or discarded by the initiator.
    Stopped {
        files: u32,
    },
}

/// Response of `POST /api/daemon/sync/:groupId/blobs/missing`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncMissingRes {
    pub missing: Vec<String>,
}

/// Response of `GET /api/daemon/sync/:groupId/changes?from=N`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChangesRes {
    pub head_version: u64,
    pub entries: Vec<SyncEntry>,
}
