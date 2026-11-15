import { z } from 'zod'
import { GitOngoingKind } from '../common.js'
import { WorkspaceSpec } from './run-payloads.js'

/** One directory level of the files browser (files.tree), dirs first then files, each by name. */
export const FILE_TREE_MAX_ENTRIES = 1000
/** files.read returns text up to this size; bigger files only carry their metadata. */
export const FILE_TEXT_MAX_BYTES = 2 * 1024 * 1024
export const FileTreeEntry = z.object({
  name: z.string(),
  dir: z.boolean(),
  /** Bytes; 0 for directories. */
  size: z.number().int(),
  /** Last modification, ms since epoch. */
  mtime: z.number().int(),
  /** Changed or untracked against HEAD (for a directory: anything below it). */
  uncommitted: z.boolean(),
  /** Matched by .gitignore; only listed when asked with showIgnored. */
  ignored: z.boolean(),
})
export type FileTreeEntry = z.infer<typeof FileTreeEntry>
/** Answer to files.tree; `truncated` = the directory had more than FILE_TREE_MAX_ENTRIES entries. */
export const FilesTreeResult = z.object({
  t: z.literal('files.tree.result'),
  requestId: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
/** Answer to files.read; `text` only for valid UTF-8 within maxBytes. */
export const FilesReadResult = z.object({
  t: z.literal('files.read.result'),
  requestId: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
  error: z.string().nullable(),
})

// ── Manual git (plan Git增强): read-only views at any ref, and owner-gated writes ──────────────────────────────────
/** A local branch, or a remote-tracking one (`name` = `origin/feat`). */
export const GitBranch = z.object({
  name: z.string(),
  kind: z.enum(['local', 'remote']),
  current: z.boolean(),
  /** Local only: its upstream (`origin/feat`) and how far apart they are; null without one. */
  upstream: z.string().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  /** Tip commit. */
  commit: z.string(),
  subject: z.string(),
  at: z.string(),
})
export type GitBranch = z.infer<typeof GitBranch>
export const GitRemote = z.object({ name: z.string(), url: z.string() })
export type GitRemote = z.infer<typeof GitRemote>
/** `commit`: the commit it points at (an annotated tag peeled); `subject`/`at`: that commit's. */
export const GitTag = z.object({
  name: z.string(),
  commit: z.string(),
  annotated: z.boolean(),
  subject: z.string(),
  at: z.string(),
})
export type GitTag = z.infer<typeof GitTag>
export const GitRefsResult = z.object({
  t: z.literal('git.refs.result'),
  requestId: z.string(),
  branches: z.array(GitBranch),
  remotes: z.array(GitRemote),
  /** gitOps3: tags newest first, and up to 5 local branches checked out lately (reflog), latest first. */
  tags: z.array(GitTag).default([]),
  recent: z.array(z.string()).default([]),
  error: z.string().nullable(),
})
export type GitRefsResult = z.infer<typeof GitRefsResult>

export const GitCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  email: z.string(),
  at: z.string(),
  subject: z.string(),
  parents: z.array(z.string()),
  /** Decorations: branch and tag names pointing at it. */
  refs: z.array(z.string()),
})
export type GitCommit = z.infer<typeof GitCommit>
export const GitLogResult = z.object({
  t: z.literal('git.log.result'),
  requestId: z.string(),
  commits: z.array(GitCommit),
  hasMore: z.boolean(),
  error: z.string().nullable(),
})
export type GitLogResult = z.infer<typeof GitLogResult>

/** A directory listing read from a ref (ls-tree): `mtime` 0, `uncommitted` and `ignored` false. */
export const GitTreeResult = z.object({
  t: z.literal('git.tree.result'),
  requestId: z.string(),
  entries: z.array(FileTreeEntry),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type GitTreeResult = z.infer<typeof GitTreeResult>
export const GitReadResult = z.object({
  t: z.literal('git.read.result'),
  requestId: z.string(),
  size: z.number().int(),
  binary: z.boolean(),
  mime: z.string(),
  text: z.string().nullable(),
  error: z.string().nullable(),
})
export type GitReadResult = z.infer<typeof GitReadResult>

/** Answer to git.show: one commit with its whole message, its committer and the branches that contain it. */
export const GitShowResult = z.object({
  t: z.literal('git.show.result'),
  requestId: z.string(),
  commit: GitCommit.nullable(),
  /** The whole message, subject included. */
  body: z.string(),
  committer: z.string(),
  committerEmail: z.string(),
  committedAt: z.string(),
  /** Local and remote-tracking branches containing it, at most 100. */
  branches: z.array(z.string()),
  error: z.string().nullable(),
})
export type GitShowResult = z.infer<typeof GitShowResult>

export const GitChange = z.object({
  path: z.string(),
  change: z.enum(['added', 'modified', 'deleted', 'renamed']),
  /** Renamed only. */
  oldPath: z.string().nullable(),
})
export type GitChange = z.infer<typeof GitChange>

/** A change of the work tree against HEAD; `add`/`del` lines, null for binary files. */
export const GitWorkChange = GitChange.extend({
  /** Not tracked by git yet (IDEA's Unversioned Files). */
  untracked: z.boolean(),
  add: z.number().int().nullable(),
  del: z.number().int().nullable(),
})
export type GitWorkChange = z.infer<typeof GitWorkChange>
export const GitConflictSide = z.enum(['modified', 'added', 'deleted'])
export type GitConflictSide = z.infer<typeof GitConflictSide>
/** An unmerged path and what each side did to it (`ours` = HEAD; in a rebase that is the branch being rebased onto). */
export const GitConflict = z.object({ path: z.string(), ours: GitConflictSide, theirs: GitConflictSide })
export type GitConflict = z.infer<typeof GitConflict>
/** What stopped midway. */
export const GitOngoing = z.object({
  kind: GitOngoingKind,
  /** What is merged, picked or reverted, or the branch being rebased: a branch name or a short hash. */
  subject: z.string().nullable(),
  /** Rebase progress: commit `step` of `total`. */
  step: z.number().int().nullable(),
  total: z.number().int().nullable(),
  /** The message git prepared for the commit that finishes it (MERGE_MSG). */
  message: z.string().nullable(),
})
export type GitOngoing = z.infer<typeof GitOngoing>
/** HEAD's commit, to amend; `pushed` = already on its upstream or another remote branch. */
export const GitHeadCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  pushed: z.boolean(),
})
export type GitHeadCommit = z.infer<typeof GitHeadCommit>
/** Answer to git.changes: what a commit could take, unmerged paths apart; `head` null on an unborn branch. */
export const GitChangesResult = z.object({
  t: z.literal('git.changes.result'),
  requestId: z.string(),
  changes: z.array(GitWorkChange),
  conflicts: z.array(GitConflict),
  ongoing: GitOngoing.nullable(),
  head: GitHeadCommit.nullable(),
  error: z.string().nullable(),
})
export type GitChangesResult = z.infer<typeof GitChangesResult>

/** Who last changed each line: `start` is 1-based; `commit` '' = not committed yet. */
export const GitBlameRange = z.object({
  start: z.number().int(),
  count: z.number().int(),
  commit: z.string(),
})
export type GitBlameRange = z.infer<typeof GitBlameRange>
export const GitBlameCommit = z.object({
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  email: z.string(),
  at: z.string(),
  subject: z.string(),
})
export type GitBlameCommit = z.infer<typeof GitBlameCommit>
export const GitBlameResult = z.object({
  t: z.literal('git.blame.result'),
  requestId: z.string(),
  ranges: z.array(GitBlameRange),
  commits: z.array(GitBlameCommit),
  error: z.string().nullable(),
})
export type GitBlameResult = z.infer<typeof GitBlameResult>

/** `stash@{index}`; `untracked`: it holds untracked files too (a third parent). */
export const GitStash = z.object({
  index: z.number().int(),
  hash: z.string(),
  message: z.string(),
  /** The branch it was made on; null on a detached HEAD. */
  branch: z.string().nullable(),
  at: z.string(),
  untracked: z.boolean(),
})
export type GitStash = z.infer<typeof GitStash>
export const GitStashesResult = z.object({
  t: z.literal('git.stashes.result'),
  requestId: z.string(),
  stashes: z.array(GitStash),
  error: z.string().nullable(),
})
export type GitStashesResult = z.infer<typeof GitStashesResult>

/**
 * Answer to git.conflict: an unmerged path's three versions (null = absent on that side, or binary) and git's own merge
 * of them with diff3 markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`), null unless all three are text.
 */
export const GitConflictResult = z.object({
  t: z.literal('git.conflict.result'),
  requestId: z.string(),
  base: z.string().nullable(),
  ours: z.string().nullable(),
  theirs: z.string().nullable(),
  merged: z.string().nullable(),
  binary: z.boolean(),
  error: z.string().nullable(),
})
export type GitConflictResult = z.infer<typeof GitConflictResult>
export const GitCompareResult = z.object({
  t: z.literal('git.compare.result'),
  requestId: z.string(),
  changes: z.array(GitChange),
  error: z.string().nullable(),
})
export type GitCompareResult = z.infer<typeof GitCompareResult>

/** Answer to git.diff: the unified patch (`git diff` format, untracked files included when `to` is the work tree). */
export const GitDiffResult = z.object({
  t: z.literal('git.diff.result'),
  requestId: z.string(),
  patch: z.string().nullable(),
  /** The patch was cut at `maxBytes`. */
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type GitDiffResult = z.infer<typeof GitDiffResult>
/** Answer to git.refresh, sent after the fresh status went out as workspace.state. */
export const GitRefreshResult = z.object({
  t: z.literal('git.refresh.result'),
  requestId: z.string(),
  error: z.string().nullable(),
})
export type GitRefreshResult = z.infer<typeof GitRefreshResult>

/** gitOps3 added all but the first four. */
export const GitActionKind = z.enum([
  'checkout',
  'pull',
  'commit',
  'push',
  'branch-create',
  'branch-rename',
  'branch-delete',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'reset',
  'discard',
  'stash',
  'unstash',
  'stash-drop',
  'tag-create',
  'tag-delete',
  'tag-push',
  'continue',
  'abort',
  'skip',
  'resolve',
  /** gitOps4 */
  'add',
  'ignore',
  'apply',
  'restore',
])
export type GitActionKind = z.infer<typeof GitActionKind>
export const GitConflictPick = z.enum(['ours', 'theirs'])
export type GitConflictPick = z.infer<typeof GitConflictPick>
/** One line of an interactive rebase's todo (IDEA's Pick / Reword / Squash / Fixup / Drop); `message` for reword and squash. */
export const GitRebaseStep = z.object({
  action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']),
  commit: z.string().min(4).max(64),
  message: z.string().min(1).max(10_000).optional(),
})
export type GitRebaseStep = z.infer<typeof GitRebaseStep>
/**
 * git.action parameters beyond branch/remote/message/paths (gitOps3); each action reads its own, see GitAction. Absent
 * when the action has none, so a daemon without gitOps3 gets the same message as before.
 */
export const GitActionArgs = z.object({
  name: z.string().optional(),
  from: z.string().optional(),
  onto: z.string().optional(),
  commit: z.string().optional(),
  commits: z.array(z.string()).optional(),
  mode: z.string().optional(),
  detach: z.boolean().optional(),
  force: z.boolean().optional(),
  tags: z.boolean().optional(),
  checkout: z.boolean().optional(),
  amend: z.boolean().optional(),
  noCommit: z.boolean().optional(),
  untracked: z.boolean().optional(),
  stash: z.number().int().optional(),
  pop: z.boolean().optional(),
  index: z.boolean().optional(),
  path: z.string().optional(),
  side: GitConflictPick.optional(),
  content: z.string().optional(),
  /** gitOps4 */
  target: z.string().optional(),
  expect: z.string().optional(),
  keepAdded: z.boolean().optional(),
  patch: z.string().optional(),
  localCommits: z.enum(['rebase', 'drop']).optional(),
  todo: z.array(GitRebaseStep).optional(),
  reverse: z.boolean().optional(),
})
export type GitActionArgs = z.infer<typeof GitActionArgs>

/** One controlled Git process, in execution order. No environment or stdin is included; long text is marked cut. */
export const GitCommandRecord = z.object({
  command: z.string(),
  startedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
})
export type GitCommandRecord = z.infer<typeof GitCommandRecord>
/**
 * gitOps4: what an action's outcome needs beyond its text. `code` overwritten: local changes in the way (`paths`), nothing
 * done; diverged: a checked out remote branch's local one has commits of its own (`ahead`, `behind`), nothing done —
 * ask whether to rebase them or drop them (checkout `args.localCommits`); conflicts: it went through but left `paths`
 * conflicted (a smart checkout restoring the changes, an update stashing around). `updated`: what a pull brought in.
 */
export const GitActionDetail = z.object({
  code: z.enum(['overwritten', 'diverged', 'conflicts']).nullable(),
  paths: z.array(z.string()),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  updated: z
    .object({ from: z.string(), to: z.string(), commits: z.number().int(), files: z.number().int() })
    .nullable(),
  commands: z.array(GitCommandRecord).nullable(),
})
export type GitActionDetail = z.infer<typeof GitActionDetail>
export const GitActionResultDetail = GitActionDetail.extend({
  commands: GitCommandRecord.array().nullable().default(null),
})
export type GitActionResultDetail = z.infer<typeof GitActionResultDetail>
/**
 * Answer to git.action. `busy`: a turn holds the directory (plan W10), nothing was run. `output`: git's summary
 * (new HEAD, pushed range…), credentials stripped.
 */
export const GitActionResult = z.object({
  t: z.literal('git.action.result'),
  requestId: z.string(),
  ok: z.boolean(),
  busy: z.boolean(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  detail: GitActionResultDetail.nullable().default(null),
})
export type GitActionResult = z.infer<typeof GitActionResult>

/** `ref`: a branch, remote branch, tag or commit; null = HEAD. */
const GitRef = z.string().min(1).max(255).nullable()
const gitTarget = { requestId: z.string(), groupId: z.string(), botId: z.string(), workspace: WorkspaceSpec }

/**
 * Which repo of the workspace a git message works on, as reported in GitStatus.repos: a submodule or nested repo
 * relative to the workspace root, or an `extra` repo's absolute path inside one of `workspace.extraDirs`; omitted = the
 * root repo. git.refs and git.action since gitRepos, every other git read since gitOps3.
 */
const GitRepo = z.string().min(1).max(4096).optional()

/** Local and remote-tracking branches, the remotes, and (gitOps3) tags and recent branches. */
export const GitRefs = z.object({ t: z.literal('git.refs'), ...gitTarget, repo: GitRepo })
/**
 * gitOps3 log filters, all combined. `all`: every branch, remote branch and tag instead of `ref`; `text`: the message,
 * a fixed string unless `regexp` (extended), case-insensitive unless `matchCase`; `since`/`until`: ISO dates; `path`:
 * work-tree-relative, a file's history following renames; `order` date (default) or topo.
 */
export const GitLogFilter = z.object({
  all: z.boolean().optional(),
  author: z.string().optional(),
  text: z.string().optional(),
  regexp: z.boolean().optional(),
  matchCase: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  path: z.string().optional(),
  firstParent: z.boolean().optional(),
  noMerges: z.boolean().optional(),
  order: z.enum(['date', 'topo']).optional(),
})
export type GitLogFilter = z.infer<typeof GitLogFilter>
/** Newest first from `ref` (a branch, tag, commit or a range like `main..feat`); `skip` pages. */
export const GitLog = z.object({
  t: z.literal('git.log'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  skip: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
  filter: GitLogFilter.optional(),
})
/** gitOps3: one commit's whole message, its committer and the branches containing it. */
export const GitShow = z.object({
  t: z.literal('git.show'),
  ...gitTarget,
  repo: GitRepo,
  commit: z.string().min(1),
})
/** One directory of `ref`'s tree, without touching the work tree. */
export const GitTree = z.object({
  t: z.literal('git.tree'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string(),
})
/** One file of `ref`'s tree, without touching the work tree. */
export const GitRead = z.object({
  t: z.literal('git.read'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string(),
  maxBytes: z.number().int(),
})
/** Paths that differ from `from` to `to`; `to` null = the work tree (uncommitted changes included). */
export const GitCompare = z.object({
  t: z.literal('git.compare'),
  ...gitTarget,
  repo: GitRepo,
  from: z.string().min(1),
  to: GitRef,
})
/**
 * The patch from `from` to `to` (null = the work tree, untracked files included), of `path` only when given; cut at
 * `maxBytes`. Never touches the work tree or the index. gitOps3: `ignoreWhitespace` (-w), `context` lines (-U).
 */
export const GitDiff = z.object({
  t: z.literal('git.diff'),
  ...gitTarget,
  repo: GitRepo,
  from: z.string().min(1),
  to: GitRef,
  path: z.string().nullable(),
  maxBytes: z.number().int(),
  ignoreWhitespace: z.boolean().optional(),
  context: z.number().int().min(0).optional(),
  /** gitOps4: a rename's source, diffed with `path` as one file. */
  oldPath: z.string().nullable().optional(),
  /** gitOps4, IDEA's modes: trim = -b, ignore = -w, ignore-blank = -w --ignore-blank-lines (over ignoreWhitespace). */
  whitespace: z.enum(['trim', 'ignore', 'ignore-blank']).optional(),
})
/**
 * gitOps3: the work tree against HEAD as a commit would take it (untracked files flagged, line counts), unmerged paths
 * apart, what stopped midway and HEAD's commit. Never touches the index.
 */
export const GitChanges = z.object({ t: z.literal('git.changes'), ...gitTarget, repo: GitRepo })
/** gitOps3: who last changed each line of `path` at `ref` (null = the work tree, uncommitted lines included). */
export const GitBlame = z.object({
  t: z.literal('git.blame'),
  ...gitTarget,
  repo: GitRepo,
  ref: GitRef,
  path: z.string().min(1),
})
/** gitOps3: the stash list, newest first. */
export const GitStashes = z.object({ t: z.literal('git.stashes'), ...gitTarget, repo: GitRepo })
/** gitOps3: an unmerged path's base, ours and theirs (each up to `maxBytes`) and git's diff3 merge of them. */
export const GitConflictRead = z.object({
  t: z.literal('git.conflict'),
  ...gitTarget,
  repo: GitRepo,
  path: z.string().min(1),
  maxBytes: z.number().int(),
})
/**
 * Re-reads the workspace git status and sends it as workspace.state (same as after a turn); `fetch` first runs
 * `git fetch --prune` of every remote, so ahead/behind and remote branches are current. Not held by a turn.
 */
export const GitRefresh = z.object({ t: z.literal('git.refresh'), ...gitTarget, fetch: z.boolean() })
/**
 * A manual write, refused (`busy`) while a turn holds the directory; commits are made as `identity` (else the machine's
 * git config). Each action reads (`args` = GitActionArgs, gitOps3):
 * - checkout: `branch` (a remote branch creates its tracking local one); `args.detach`: a commit or tag, detached;
 *   `args.mode` keep (default: git refuses to overwrite changes) | smart (stash, switch, restore) | force (discard).
 *   gitOps4: changes in the way fail with detail overwritten; a smart checkout whose restore conflicts succeeds with
 *   detail conflicts; a remote branch whose local one exists brings it up to the remote one (fast-forward), or when
 *   that one has commits of its own fails with detail diverged unless `args.localCommits` rebase (onto the remote one)
 *   | drop (reset to it)
 * - pull: the upstream into the current branch, `args.mode` ff-only (default) | merge | rebase, stashing changes
 *   around a merge or rebase; a `branch` other than the current one is fast-forwarded without checking it out.
 *   gitOps4: `args.from` a remote branch (`origin/feat`) instead of the upstream, fetched first; changes stashed
 *   around every mode; detail updated
 * - commit: `paths` only (work tree relative; deletions and untracked files included) or everything when null, with
 *   `message`; `args.amend` rewrites the last commit (`paths` [] = only its message), refused when HEAD is no longer
 *   `args.expect` (gitOps4)
 * - push: local `branch` to `remote`, setting the upstream when missing; `args.force` = --force-with-lease, `args.tags`
 *   = all tags too. gitOps4: to the remote branch `args.target` (default: the upstream's branch when it is on `remote`,
 *   else the same name), always as explicit refs (`refs/heads/a:refs/heads/b`), never a refspec taken from input;
 *   `args.commit` pushes only up to that commit of the branch (`<hash>:refs/heads/b`), refused when it is not on it
 * - branch-create: new `branch` at `args.from` (default HEAD), switched to when `args.checkout`; gitOps4: `args.force`
 *   overwrites an existing one (not the current branch)
 * - branch-rename: `branch` to `args.name`
 * - branch-delete: `branch`, `args.force` even when unmerged; a remote-tracking `origin/x` deletes x on that remote
 * - merge: `branch` into the current one, `args.mode` default | no-ff | ff-only | squash, `args.noCommit`, `message`
 * - rebase: the current branch, or `branch` (switched to first), onto `args.onto`. gitOps4 `args.todo`: interactive, the
 *   current branch's `onto..HEAD` rewritten as listed (refused unless it lists each of those commits once, none a
 *   merge); reword and squash take their `message`; stops on conflicts as any rebase
 * - apply (gitOps4): `args.commit`'s changes to `paths` applied to the work tree, undone when `args.reverse`; conflicts
 *   left as markers (git apply --3way)
 * - restore (gitOps4): `paths` as they are at `args.commit`, written into the work tree (deleted when absent there)
 * - cherry-pick, revert: `args.commits`, oldest first
 * - reset: the current branch to `args.commit`, `args.mode` soft | mixed | hard | keep; gitOps4: `args.expect` = the
 *   HEAD it must still be at, refused otherwise (as with commit `args.amend`)
 * - discard: `paths` back to HEAD, untracked ones deleted; files added to the index are deleted too unless
 *   `args.keepAdded` (gitOps4), then only unstaged. gitOps4: `args.patch` (a `git diff` of the work tree against HEAD
 *   for the one path) reverts only those hunks, refused when it no longer applies
 * - add (gitOps4): untracked `paths` staged (`git add`)
 * - ignore (gitOps4): `paths` appended to the repo's root .gitignore as `/path` lines (glob characters escaped), the
 *   file created when missing
 * - stash: `message`, `args.untracked` too, only `paths` when given
 * - unstash: `stash@{args.stash}`, dropped when `args.pop`, `args.index` reinstating the index; with `branch`: as that
 *   new branch. gitOps4: `args.expect` = the stash commit it must still be, refused otherwise (the list moved)
 * - stash-drop: `stash@{args.stash}`, every stash without it; `args.expect` as unstash's
 * - tag-create: `args.name` at `args.from` (default HEAD), annotated with `message` when given
 * - tag-delete: `args.name`, on `remote` too when given (gitOps4: as `refs/tags/<name>`)
 * - tag-push: `args.name` to `remote` (gitOps4: as `refs/tags/<name>`)
 * - continue: the stopped merge / rebase / cherry-pick / revert, a merge commit with `message` when given
 * - abort, skip: the stopped operation
 * - resolve: `args.path` taking `args.side`, or written with `args.content`, then marked resolved; gitOps4: with
 *   `args.side`, `paths` as well
 * A merge, rebase, cherry-pick, revert, pull, unstash or continue that stops on conflicts fails with an error naming them
 * and leaves them to resolve. Pushes are never forced but by `args.force`.
 */
export const GitAction = z.object({
  t: z.literal('git.action'),
  ...gitTarget,
  repo: GitRepo,
  action: GitActionKind,
  branch: z.string().nullable(),
  remote: z.string().nullable(),
  message: z.string().nullable(),
  paths: z.array(z.string()).nullable().default(null),
  identity: z.object({ name: z.string(), email: z.string() }).nullable(),
  args: GitActionArgs.optional(),
})
export type GitAction = z.infer<typeof GitAction>
