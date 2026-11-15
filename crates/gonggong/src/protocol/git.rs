use super::*;

/// git.refs: local and remote-tracking branches, and the remotes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefs {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    /// A repo of the workspace as GitStatus.repos reports it; None = the root repo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.log: newest first from `ref` (None = HEAD; a range like `main..feat` too), narrowed by `filter`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLog {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub skip: u32,
    pub limit: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<GitLogFilter>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitLogOrder {
    Date,
    Topo,
}

/// git.log filters, all combined. `all`: every branch, remote branch and tag instead of `ref`; `text`: the message, a
/// fixed string unless `regexp` (extended), case-insensitive unless `match_case`; `since`/`until`: ISO dates; `path`:
/// work-tree-relative, a file's history following renames.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regexp: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_case: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_parent: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_merges: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<GitLogOrder>,
}

/// git.show: one commit's whole message, its committer and the branches containing it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitShow {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub commit: String,
}

/// git.tree: one directory of `ref`'s tree, the work tree untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTree {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
}

/// git.read: one file of `ref`'s tree, the work tree untouched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRead {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
    pub max_bytes: u64,
}

/// git.compare: paths that differ from `from` to `to` (None = the work tree, uncommitted changes included).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCompare {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub from: String,
    pub to: Option<String>,
}

/// git.diff: the unified patch from `from` to `to` (None = the work tree, untracked files included), of `path` only
/// when given, cut at `max_bytes`. Never touches the work tree or the index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub from: String,
    pub to: Option<String>,
    pub path: Option<String>,
    pub max_bytes: u64,
    /// `-w`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_whitespace: Option<bool>,
    /// Context lines (`-U`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<u32>,
    /// [`FEATURE_GIT_OPS4`]: a rename's source, diffed with `path` as one file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    /// [`FEATURE_GIT_OPS4`], over `ignore_whitespace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub whitespace: Option<GitWhitespace>,
}

/// IDEA's whitespace modes of a diff: trim = `-b`, ignore = `-w`, ignore-blank = `-w --ignore-blank-lines`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitWhitespace {
    Trim,
    Ignore,
    IgnoreBlank,
}

/// git.changes: the work tree against HEAD as a commit would take it, unmerged paths apart, what stopped midway and
/// HEAD's commit. Never touches the index.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChanges {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.blame: who last changed each line of `path` at `ref` (None = the work tree, uncommitted lines included).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlame {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub r#ref: Option<String>,
    pub path: String,
}

/// git.stashes: the stash list, newest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashes {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
}

/// git.conflict: an unmerged path's base, ours and theirs (each up to `max_bytes`) and git's diff3 merge of them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictRead {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub path: String,
    pub max_bytes: u64,
}

/// git.refresh: sends the current git status as workspace.state, after `git fetch --prune --all` when `fetch`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRefresh {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    pub fetch: bool,
}

/// All but the first four came with [`FEATURE_GIT_OPS3`]; add, ignore, apply and restore with [`FEATURE_GIT_OPS4`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GitActionKind {
    Checkout,
    Pull,
    Commit,
    Push,
    BranchCreate,
    BranchRename,
    BranchDelete,
    Merge,
    Rebase,
    CherryPick,
    Revert,
    Reset,
    Discard,
    Stash,
    Unstash,
    StashDrop,
    TagCreate,
    TagDelete,
    TagPush,
    Continue,
    Abort,
    Skip,
    Resolve,
    Add,
    Ignore,
    Apply,
    Restore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitConflictPick {
    Ours,
    Theirs,
}

/// git.action parameters beyond branch/remote/message/paths; each action reads its own (see [`GitAction`]).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionArgs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub onto: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commits: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detach: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amend: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_commit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub untracked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stash: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pop: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub side: Option<GitConflictPick>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expect: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_added: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_commits: Option<GitLocalCommits>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub todo: Option<Vec<GitRebaseStep>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverse: Option<bool>,
}

/// One line of an interactive rebase's todo; `message` for reword and squash.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitRebaseStep {
    pub action: GitRebaseAction,
    pub commit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitRebaseAction {
    Pick,
    Reword,
    Squash,
    Fixup,
    Drop,
}

/// What a checkout of a remote branch does with the commits its local one has of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitLocalCommits {
    Rebase,
    Drop,
}

/// [`FEATURE_GIT_OPS4`]: what an action's outcome needs beyond its text (see GitActionDetail in daemon.ts).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GitActionDetail {
    pub code: Option<GitActionCode>,
    pub paths: Vec<String>,
    /// diverged: the local branch's own commits, and the remote one's.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// What a pull brought in.
    pub updated: Option<GitUpdated>,
    #[serde(default)]
    pub commands: Option<Vec<GitCommandRecord>>,
}

/// One process run by a manual git action, in execution order. Environment and stdin never enter this audit record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandRecord {
    pub command: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitActionCode {
    Overwritten,
    Diverged,
    Conflicts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitUpdated {
    pub from: String,
    pub to: String,
    pub commits: u32,
    pub files: u32,
}

/// git.action: a manual write, refused (`busy`) while a turn holds the directory; commits are made as `identity`.
/// What each action reads is spelled out on GitAction in packages/protocol (daemon.ts). Pushes are only ever forced
/// with `args.force` (--force-with-lease).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAction {
    pub request_id: String,
    pub group_id: String,
    pub bot_id: String,
    pub workspace: WorkspaceSpec,
    /// A repo of the workspace as GitStatus.repos reports it; None = the root repo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    pub action: GitActionKind,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub message: Option<String>,
    /// commit, discard, stash: only these work-tree-relative paths; None = every change. Older servers never send it.
    /// add, ignore, apply, restore: the paths they act on; resolve: more conflicted paths to take a side for.
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    pub identity: Option<GitIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<GitActionArgs>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitBranchKind {
    Local,
    Remote,
}

/// A local branch, or a remote-tracking one (`name` = `origin/feat`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitBranch {
    pub name: String,
    pub kind: GitBranchKind,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub commit: String,
    pub subject: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
}

/// `commit`: the commit it points at (an annotated tag peeled); `subject`/`at`: that commit's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitTag {
    pub name: String,
    pub commit: String,
    pub annotated: bool,
    pub subject: String,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub at: String,
    pub subject: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub change: GitChangeKind,
    pub old_path: Option<String>,
}

/// A change of the work tree against HEAD; `add`/`del` lines, None for binary files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkChange {
    pub path: String,
    pub change: GitChangeKind,
    pub old_path: Option<String>,
    /// Not tracked by git yet.
    pub untracked: bool,
    pub add: Option<u32>,
    pub del: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitConflictSide {
    Modified,
    Added,
    Deleted,
}

/// An unmerged path and what each side did to it (`ours` = HEAD).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitConflict {
    pub path: String,
    pub ours: GitConflictSide,
    pub theirs: GitConflictSide,
}

/// What stopped midway: `subject` is what is merged, picked or reverted, or the branch being rebased; `step` of
/// `total` a rebase's progress; `message` the one git prepared for the commit that finishes it (MERGE_MSG).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitOngoing {
    pub kind: GitOngoingKind,
    pub subject: Option<String>,
    pub step: Option<u32>,
    pub total: Option<u32>,
    pub message: Option<String>,
}

/// HEAD's commit, to amend; `pushed` = already on a remote-tracking branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHeadCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub pushed: bool,
}

/// Lines `start` (1-based) to `start + count - 1` were last changed by `commit` ('' = not committed yet).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitBlameRange {
    pub start: u32,
    pub count: u32,
    pub commit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub at: String,
    pub subject: String,
}

/// `stash@{index}`; `branch` None when made on a detached HEAD; `untracked`: it holds untracked files too.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitStash {
    pub index: u32,
    pub hash: String,
    pub message: String,
    pub branch: Option<String>,
    pub at: String,
    pub untracked: bool,
}
