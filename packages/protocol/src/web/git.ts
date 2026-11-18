import { z } from 'zod'
import { AgentSettingValues } from '../agent-settings.js'
import { AgentKind, Allowlist, Tier, TriggerScope } from '../common.js'
import {
  GitActionArgs,
  GitActionDetail,
  GitActionKind,
  GitBlameCommit,
  GitBlameRange,
  GitBranch,
  GitChange,
  GitCommit,
  GitConflict,
  GitConflictPick,
  GitHeadCommit,
  GitOngoing,
  GitRebaseStep,
  GitRemote,
  GitStash,
  GitTag,
  GitWorkChange,
  RepoAccessReason,
} from '../daemon.js'
import { BotRole, MachineDto } from './machines-bots.js'

// ── Manual git (plan Git增强, docs/archive/2026-11/Git管理-IDEA对标-开发计划.md) ─────────────────────────────────────────────
// Reads (any member): GET /api/groups/:id/bots/:botId/git/{refs,log,show,tree,text,compare,diff,changes,blame,stashes,
// conflict}. Writes: POST …/git/actions — the bot owner's run at once; anyone else's wait for the owner's approval.
// Partition groups with a repo only; writes are refused with 409 while a run of the bot (or of a bot sharing its
// directory) is live. Anything beyond what a daemon supports (see DaemonFeature gitOps3) is refused with 409.
/** Which repo of the workspace (see GitStatus.repos `path`); omitted = the root repo. */
const gitRepoPath = z.string().min(1).max(4096).optional()
/** A query flag: 1 / true. */
const queryFlag = z
  .enum(['0', '1', 'false', 'true'])
  .transform((v) => v === '1' || v === 'true')
  .optional()
/** A branch, tag, commit or rev expression (`main..feat`, `stash@{0}^1`); never an option (`-x`) nor spaced. */
const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
const gitRev = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !s.startsWith('-') && !/\s/.test(s) && !hasControl(s), '无效的修订')
/**
 * A short branch or tag name as `git check-ref-format --branch` takes it, never `HEAD` nor `refs/…`: nothing a refspec
 * would read as more (`+a:b`, `:b`, `HEAD`), so a push or delete only ever names the branch it says.
 */
export function isGitRefName(s: string) {
  return (
    s !== 'HEAD' &&
    s !== '@' &&
    !s.startsWith('refs/') &&
    !/^[-+/]/.test(s) &&
    !/[/.]$/.test(s) &&
    !/[ ~^:?*[\\]/.test(s) &&
    !hasControl(s) &&
    !s.includes('..') &&
    !s.includes('@{') &&
    s.split('/').every((p) => p !== '' && !p.startsWith('.') && !p.endsWith('.lock'))
  )
}
const gitRefName = z.string().trim().min(1).max(255).refine(isGitRefName, '无效的分支或标签名')
/** A configured remote's name (`origin`), never a URL or a path. */
const gitRemoteName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][\w.-]{0,99}$/, '无效的远程名称')
/** A full or abbreviated object name. */
const gitHash = z.string().regex(/^[0-9a-f]{4,64}$/)
/** GET …/git/refs?repo= */
export const GitRefsQuery = z.object({ repo: gitRepoPath })
/** GET …/git/refs — `tags` and `recent` stay empty from daemons without gitOps3. */
export const GitRefsDto = z.object({
  branches: z.array(GitBranch),
  remotes: z.array(GitRemote),
  tags: z.array(GitTag),
  recent: z.array(z.string()),
})
export type GitRefsDto = z.infer<typeof GitRefsDto>
/** GET …/git/log?ref=&skip=&repo= plus the filters of GitLogFilter (flags as 1). */
export const GitLogQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  all: queryFlag,
  author: z.string().trim().min(1).max(255).optional(),
  text: z.string().trim().min(1).max(255).optional(),
  regexp: queryFlag,
  matchCase: queryFlag,
  since: z.iso.date().optional(),
  until: z.iso.date().optional(),
  path: z.string().min(1).max(4096).optional(),
  firstParent: queryFlag,
  noMerges: queryFlag,
  order: z.enum(['date', 'topo']).optional(),
})
export type GitLogQuery = z.infer<typeof GitLogQuery>
export const GitLogDto = z.object({ commits: z.array(GitCommit), hasMore: z.boolean() })
export type GitLogDto = z.infer<typeof GitLogDto>
/** GET …/git/show?commit=&repo= */
export const GitShowQuery = z.object({ repo: gitRepoPath, commit: gitRev })
export const GitShowDto = z.object({
  commit: GitCommit,
  body: z.string(),
  committer: z.string(),
  committerEmail: z.string(),
  committedAt: z.string(),
  branches: z.array(z.string()),
})
export type GitShowDto = z.infer<typeof GitShowDto>
/** GET …/git/tree?ref=&path=&repo= answers FilesTreeDto; GET …/git/text?ref=&path=&repo= answers FileTextDto. */
export const GitRefPathQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255),
  path: z.string().default(''),
})
/** GET …/git/compare?from=&to=&repo= — `to` omitted = the work tree. */
export const GitCompareQuery = z.object({
  repo: gitRepoPath,
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255).optional(),
})
export const GitCompareDto = z.object({ changes: z.array(GitChange) })
export type GitCompareDto = z.infer<typeof GitCompareDto>
/**
 * GET …/git/diff?from=&to=&path=&repo=&ignoreWhitespace=&context= — the unified patch (see GitDiff); `to` omitted =
 * the work tree, `path` = one file.
 */
export const GitDiffQuery = z.object({
  repo: gitRepoPath,
  from: z.string().min(1).max(255),
  to: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4096).optional(),
  ignoreWhitespace: queryFlag,
  context: z.coerce.number().int().min(0).max(1_000_000).optional(),
  /** gitOps4: a rename's source, diffed with `path` as one file. */
  oldPath: z.string().min(1).max(4096).optional(),
  /** gitOps4 (else only ignore, as ignoreWhitespace): see GitDiff. */
  whitespace: z.enum(['trim', 'ignore', 'ignore-blank']).optional(),
})
export const GitDiffDto = z.object({ patch: z.string().nullable(), truncated: z.boolean() })
export type GitDiffDto = z.infer<typeof GitDiffDto>
/** GET …/git/changes?repo= */
export const GitChangesQuery = z.object({ repo: gitRepoPath })
/**
 * The work tree's changes for the commit view. `limited`: the daemon predates gitOps3, so this is its plain compare
 * against HEAD (no untracked flags, line counts, conflicts or HEAD commit).
 */
export const GitChangesDto = z.object({
  changes: z.array(GitWorkChange),
  conflicts: z.array(GitConflict),
  ongoing: GitOngoing.nullable(),
  head: GitHeadCommit.nullable(),
  limited: z.boolean(),
})
export type GitChangesDto = z.infer<typeof GitChangesDto>
/** GET …/git/blame?path=&ref=&repo= — `ref` omitted = the work tree. */
export const GitBlameQuery = z.object({
  repo: gitRepoPath,
  ref: z.string().min(1).max(255).optional(),
  path: z.string().min(1).max(4096),
})
export const GitBlameDto = z.object({ ranges: z.array(GitBlameRange), commits: z.array(GitBlameCommit) })
export type GitBlameDto = z.infer<typeof GitBlameDto>
/** GET …/git/stashes?repo= */
export const GitStashesQuery = z.object({ repo: gitRepoPath })
export const GitStashesDto = z.object({ stashes: z.array(GitStash) })
export type GitStashesDto = z.infer<typeof GitStashesDto>
/** GET …/git/conflict?path=&repo= */
export const GitConflictQuery = z.object({ repo: gitRepoPath, path: z.string().min(1).max(4096) })
export const GitConflictDto = z.object({
  base: z.string().nullable(),
  ours: z.string().nullable(),
  theirs: z.string().nullable(),
  merged: z.string().nullable(),
  binary: z.boolean(),
})
export type GitConflictDto = z.infer<typeof GitConflictDto>
/**
 * POST …/git/refresh — any member: re-reads the bot's git status (pushed as a bot state update); `fetch` fetches the
 * remotes first. Not refused while a run is live (it never touches the work tree). Answers 204.
 */
export const GitRefreshReq = z.object({ fetch: z.boolean().default(false) })
export type GitRefreshReq = z.infer<typeof GitRefreshReq>

const gitPaths = z.array(z.string().min(1).max(4096)).max(5000)
const gitMessage = z.string().trim().min(1).max(10_000)
/** Conflict resolutions are written into the work tree as is. */
export const GIT_RESOLVE_MAX_BYTES = 2 * 1024 * 1024
export const GIT_PATCH_MAX_BYTES = 1024 * 1024
/**
 * POST …/git/actions (see GitAction in the daemon protocol for what each does). `confirmBase`: the owner's second
 * confirmation to push the protected base branch, which is never force-pushed nor deleted on the remote.
 */
export const GitActionReq = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('checkout'),
    repo: gitRepoPath,
    /** A branch (a remote one creates its tracking local one), or with `detach` any revision. */
    branch: gitRev,
    /** A commit or tag: detached HEAD. */
    detach: z.boolean().default(false),
    /** With changes in the way: keep them (git refuses to overwrite), smart (stash and restore) or force (discard). */
    mode: z.enum(['keep', 'smart', 'force']).default('keep'),
    /** gitOps4: a remote branch whose local one has commits of its own: rebase them onto it, or drop them. */
    localCommits: z.enum(['rebase', 'drop']).optional(),
  }),
  z.object({
    action: z.literal('pull'),
    repo: gitRepoPath,
    mode: z.enum(['ff-only', 'merge', 'rebase']).default('ff-only'),
    /** A local branch other than the current one: fast-forwarded from its upstream. */
    branch: gitRefName.optional(),
    /** gitOps4: a remote branch (`origin/feat`) pulled into the current one instead of its upstream. */
    from: gitRefName.optional(),
  }),
  z.object({
    action: z.literal('commit'),
    repo: gitRepoPath,
    message: z.string().trim().min(1, '请填写提交说明').max(10_000),
    /** Work-tree-relative paths to commit (as listed by git changes); omitted = every change; [] = none (amend only). */
    paths: gitPaths.optional(),
    amend: z.boolean().default(false),
    /** gitOps4, with amend: HEAD as the requester saw it; refused when it moved (a reword approved late). */
    expectHead: gitHash.optional(),
  }),
  z.object({
    action: z.literal('push'),
    repo: gitRepoPath,
    remote: gitRemoteName.default('origin'),
    /** The local branch pushed. */
    branch: gitRefName,
    /** gitOps4: the branch on the remote it goes to; omitted = its upstream's when on `remote`, else the same name. */
    target: gitRefName.optional(),
    /** Needed when the branch on the remote (`target`) is the protected base branch. */
    confirmBase: z.boolean().default(false),
    /** --force-with-lease; refused for the protected base branch. */
    force: z.boolean().default(false),
    tags: z.boolean().default(false),
    /** gitOps4: only up to this commit of the branch (IDEA's Push All up to Here). */
    commit: gitHash.optional(),
  }),
  z.object({
    action: z.literal('branch-create'),
    repo: gitRepoPath,
    name: gitRefName,
    from: gitRev.optional(),
    checkout: z.boolean().default(true),
    /** gitOps4: replace an existing branch of that name (never the current one). */
    overwrite: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('branch-rename'),
    repo: gitRepoPath,
    branch: gitRefName,
    name: gitRefName,
  }),
  z.object({
    action: z.literal('branch-delete'),
    repo: gitRepoPath,
    /** A remote-tracking `origin/x` deletes x on that remote. */
    branch: gitRefName,
    force: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('merge'),
    repo: gitRepoPath,
    branch: gitRev,
    mode: z.enum(['default', 'no-ff', 'ff-only', 'squash']).default('default'),
    noCommit: z.boolean().default(false),
    message: gitMessage.optional(),
  }),
  z.object({
    action: z.literal('rebase'),
    repo: gitRepoPath,
    onto: gitRev,
    /** Rebase this branch (switched to first) instead of the current one. */
    branch: gitRefName.optional(),
    /**
     * gitOps4, IDEA's interactive rebase of the current branch: every commit of `onto..HEAD` once, oldest first, in the
     * new order (no merge commits); the first can't be squashed or fixed up.
     */
    todo: z.array(GitRebaseStep).min(1).max(200).optional(),
  }),
  z.object({ action: z.literal('cherry-pick'), repo: gitRepoPath, commits: z.array(gitRev).min(1).max(100) }),
  z.object({ action: z.literal('revert'), repo: gitRepoPath, commits: z.array(gitRev).min(1).max(100) }),
  z.object({
    action: z.literal('reset'),
    repo: gitRepoPath,
    commit: gitRev,
    mode: z.enum(['soft', 'mixed', 'hard', 'keep']).default('mixed'),
    /** gitOps4: HEAD as the requester saw it; refused when it moved before the reset ran (an Undo Commit approved late). */
    expectHead: gitHash.optional(),
  }),
  z.object({
    action: z.literal('discard'),
    repo: gitRepoPath,
    paths: gitPaths.min(1),
    /** gitOps4: files added to the index are only unstaged, kept on disk (IDEA: "Delete local copies" unticked). */
    keepAdded: z.boolean().default(false),
    /** gitOps4: only these hunks of the one path (a `git diff` against HEAD), as IDEA's revert arrow in the diff. */
    patch: z.string().min(1).max(GIT_PATCH_MAX_BYTES).optional(),
  }),
  /** gitOps4: IDEA's Add to VCS — untracked `paths` staged as added. */
  z.object({ action: z.literal('add'), repo: gitRepoPath, paths: gitPaths.min(1) }),
  /** gitOps4: IDEA's Add to .gitignore — `paths` appended to the repo's root .gitignore as `/path`. */
  z.object({ action: z.literal('ignore'), repo: gitRepoPath, paths: gitPaths.min(1) }),
  z.object({
    action: z.literal('stash'),
    repo: gitRepoPath,
    message: z.string().trim().min(1).max(1000).optional(),
    untracked: z.boolean().default(false),
    paths: gitPaths.min(1).optional(),
  }),
  z.object({
    action: z.literal('unstash'),
    repo: gitRepoPath,
    stash: z.number().int().min(0),
    /** gitOps4: the stash's commit as listed; refused when `stash@{n}` is another one by then. */
    expect: gitHash.optional(),
    pop: z.boolean().default(false),
    index: z.boolean().default(false),
    /** Restore it as this new branch (made at the stash's base) instead. */
    branch: gitRefName.optional(),
  }),
  z.object({
    action: z.literal('stash-drop'),
    repo: gitRepoPath,
    /** Omitted = every stash. */
    stash: z.number().int().min(0).optional(),
    /** gitOps4: as unstash's. */
    expect: gitHash.optional(),
  }),
  z.object({
    action: z.literal('tag-create'),
    repo: gitRepoPath,
    name: gitRefName,
    commit: gitRev.optional(),
    /** Makes it an annotated tag. */
    message: gitMessage.optional(),
  }),
  z.object({
    action: z.literal('tag-delete'),
    repo: gitRepoPath,
    name: gitRefName,
    /** Deletes it on this remote too. */
    remote: gitRemoteName.optional(),
  }),
  z.object({
    action: z.literal('tag-push'),
    repo: gitRepoPath,
    name: gitRefName,
    remote: gitRemoteName.default('origin'),
  }),
  z.object({ action: z.literal('continue'), repo: gitRepoPath, message: gitMessage.optional() }),
  z.object({ action: z.literal('abort'), repo: gitRepoPath }),
  z.object({ action: z.literal('skip'), repo: gitRepoPath }),
  z.object({
    action: z.literal('resolve'),
    repo: gitRepoPath,
    path: z.string().min(1).max(4096),
    /** Take one side as is, or write `content`. */
    side: GitConflictPick.optional(),
    content: z.string().max(GIT_RESOLVE_MAX_BYTES).optional(),
    /** gitOps4, with `side`: these conflicted paths too (IDEA's Accept Yours / Theirs on several files). */
    paths: gitPaths.min(1).optional(),
  }),
  /**
   * gitOps4, IDEA's Cherry-Pick / Revert Selected Changes: `commit`'s changes to `paths` applied to the work tree
   * (`reverse`: undone), uncommitted; conflicting hunks left as conflict markers.
   */
  z.object({
    action: z.literal('apply'),
    repo: gitRepoPath,
    commit: gitRev,
    paths: gitPaths.min(1),
    reverse: z.boolean().default(false),
  }),
  /** gitOps4, IDEA's Get from Revision: `paths` as they are at `commit`, in the work tree (absent there = deleted). */
  z.object({ action: z.literal('restore'), repo: gitRepoPath, commit: gitRev, paths: gitPaths.min(1) }),
])
export type GitActionReq = z.infer<typeof GitActionReq>
/** What a client sends: the defaults may be left out. */
export type GitActionInput = z.input<typeof GitActionReq>
export const GitOperationStatus = z.enum([
  'pending_approval',
  'running',
  'succeeded',
  'failed',
  'rejected',
  'expired',
])
export type GitOperationStatus = z.infer<typeof GitOperationStatus>
export const GitOperationDto = z.object({
  id: z.string(),
  groupId: z.string(),
  botId: z.string(),
  /** The repo acted on (see GitActionReq); null = the root repo. */
  repo: z.string().nullable(),
  action: GitActionKind,
  branch: z.string().nullable(),
  remote: z.string().nullable(),
  message: z.string().nullable(),
  /** A commit (discard, stash) of these paths only; null = every change. */
  paths: z.array(z.string()).nullable(),
  /** The action's other parameters (see GitActionArgs); null when it has none. */
  args: GitActionArgs.nullable(),
  /** A push of the protected base branch: approving it is the owner's second confirmation. */
  pushesBase: z.boolean(),
  status: GitOperationStatus,
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  decidedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** git's summary on success; why it failed otherwise. */
  output: z.string().nullable(),
  error: z.string().nullable(),
  /** gitOps4: see GitActionDetail. */
  detail: GitActionDetail.nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type GitOperationDto = z.infer<typeof GitOperationDto>
/** GET /api/groups/:id/git/operations — pending ones plus the latest settled, newest first. */
export const GitOperationsDto = z.object({ operations: z.array(GitOperationDto) })
export type GitOperationsDto = z.infer<typeof GitOperationsDto>
/** POST /api/git-operations/:id/decide — the bot owner only. */
export const DecideGitOperationReq = z.object({ approve: z.boolean() })

/** MIME types `GET …/files/raw?path=` serves inline (Range supported); anything else is a download. */
export const INLINE_FILE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'audio/flac',
  'application/pdf',
] as const
/** PUT /api/groups/:id/bots/:botId/tier (bot owner or sysadmin); null follows the bot's own tier. */
export const GroupBotTierReq = z.object({ tier: Tier.nullable() })
/** PUT /api/groups/:id/bots/:botId/config (bot owner or group admin; anyone in a DM): nulls follow the bot. */
export const GroupBotConfigReq = z.object({ model: z.string().nullable(), effort: z.string().nullable() })
export const EXTRA_DIRS_MAX = 10
/** PUT /api/groups/:id/bots/:botId/extra-dirs (bot owner only): the full list, [] clears it. */
export const GroupBotExtraDirsReq = z.object({
  dirs: z.array(z.string().trim().min(1).max(1024)).max(EXTRA_DIRS_MAX),
})

/** PUT /api/groups/:id/bots/:botId/repos/:repoId (bot owner only): a local clone of that extra repo, null = managed. */
export const GroupBotRepoPathReq = z.object({ path: z.string().trim().min(1).max(1024).nullable() })

/** GET /api/bots/owners: who the caller may create bots for, with their machines (self only for members). */
export const BotOwnerDto = z.object({ id: z.string(), name: z.string(), machines: z.array(MachineDto) })
export type BotOwnerDto = z.infer<typeof BotOwnerDto>

export const CreateBotReq = z.object({
  name: z.string().min(1).max(40),
  ownerId: z.string(),
  agentKind: AgentKind,
  /** Omit when the owner has no machine yet (bot becomes pending_bind). */
  machineId: z.string().nullable(),
  systemPrompt: z.string().max(4000).default(''),
  avatar: BotRole.default('role-agent'),
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
  /** A provider id of `agentKind`, `official` or `inherit` (default); only for one's own bot on one's own machine. */
  provider: z.string().min(1).optional(),
})
export const UpdateBotReq = z.object({
  name: z.string().min(1).max(40).optional(),
  avatar: BotRole.optional(),
  systemPrompt: z.string().max(4000).optional(),
  tier: Tier.optional(),
  triggerScope: TriggerScope.optional(),
  triggerList: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  model: z.string().nullable().optional(),
  effort: z.string().nullable().optional(),
  /** Bot owner only. */
  alwaysAllow: Allowlist.optional(),
  aiReview: z.boolean().optional(),
  /** Bot owner only; null = default. */
  gitName: z.string().trim().min(1).max(80).nullable().optional(),
  gitEmail: z.email().max(200).nullable().optional(),
  /** Bot owner only; replaces the overrides (only `botOverride` fields of the bot's agent kind). */
  agentSettings: AgentSettingValues.optional(),
})
/** POST /api/bots/:id/share-requests: a member asks the owner to share the bot with them. */
export const BotShareRequestReq = z.object({ reason: z.string().trim().max(200).default('') })
/** A pending 申请共享 (GET /api/bots/:id/share-requests: all of them for the owner, only one's own otherwise). */
export const BotShareRequestDto = z.object({
  id: z.string(),
  botId: z.string(),
  userId: z.string(),
  userName: z.string(),
  reason: z.string(),
  createdAt: z.string(),
})
export type BotShareRequestDto = z.infer<typeof BotShareRequestDto>
/** POST /api/share-requests/:id/approve: the DM opened for the requester. */
export const ShareApprovedDto = z.object({ groupId: z.string() })
export type ShareApprovedDto = z.infer<typeof ShareApprovedDto>
/** PUT /api/bots/:id/shares (owner or sysadmin): the full list of members the bot is shared with. */
export const BotSharesReq = z.object({ userIds: z.array(z.string()).max(200) })

// ── Repos (team-wide history, access probes) ────────────────────────────────
export const RepoDto = z.object({
  id: z.string(),
  /** repoKey: `host/path`, lowercase. */
  key: z.string(),
  /** Latest URL used, credentials removed. */
  url: z.string(),
  name: z.string(),
  lastBranch: z.string().nullable(),
  lastUsedAt: z.string(),
  /** Groups currently bound to it. */
  groups: z.number().int(),
  /** The caller has used it (sorted first). */
  mine: z.boolean(),
  /** Directories holding it on the caller's machines. */
  localPaths: z.array(z.object({ machineId: z.string(), path: z.string() })),
})
export type RepoDto = z.infer<typeof RepoDto>

/** POST /api/repos/probe: each bot's machine tries the repo with its own credentials. */
export const RepoProbeReq = z.object({
  url: z.string(),
  branch: z.string(),
  /** Empty → the caller's own online bots (only to learn the branches). */
  botIds: z.array(z.string()).default([]),
})
export const BotProbeDto = z.object({
  botId: z.string(),
  ok: z.boolean(),
  /** offline = not checked; the bot is verified when its machine comes back. */
  reason: z.union([RepoAccessReason, z.literal('offline')]).nullable(),
  usedUrl: z.string().nullable(),
  detail: z.string().nullable(),
})
export type BotProbeDto = z.infer<typeof BotProbeDto>
export const RepoProbeRes = z.object({
  results: z.array(BotProbeDto),
  /** From the first machine that could read the repo; null when none could. */
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
})
export type RepoProbeRes = z.infer<typeof RepoProbeRes>

// ── Git accounts (personal access tokens, repo discovery only) ─────────────
export const GitProvider = z.enum(['github', 'gitlab'])
export type GitProvider = z.infer<typeof GitProvider>
export const GitAccountDto = z.object({
  id: z.string(),
  provider: GitProvider,
  baseUrl: z.string(),
  login: z.string(),
  /** invalid = the provider rejected the token (401); reconnect to fix. */
  status: z.enum(['ok', 'invalid']),
})
export type GitAccountDto = z.infer<typeof GitAccountDto>
/** POST /api/me/git-accounts; baseUrl defaults to https://github.com for GitHub. */
export const AddGitAccountReq = z.object({
  provider: GitProvider,
  baseUrl: z.string().optional(),
  token: z.string().min(1, '请填写 Token'),
})
export const ProviderRepoDto = z.object({
  /** `owner/name`. */
  fullName: z.string(),
  /** Clone URL in the caller's preferred protocol. */
  url: z.string(),
  defaultBranch: z.string().nullable(),
  private: z.boolean(),
})
export type ProviderRepoDto = z.infer<typeof ProviderRepoDto>
