import { z } from 'zod'

// ── Force sync (docs/plan/强制同步-开发计划.md) ──────────────────────────────
/** Defaults of the system parameters (F18): a bigger file or version is held and the owner told to .gitignore it. */
export const SYNC_FILE_MAX_BYTES = 50 * 1024 * 1024
export const SYNC_VERSION_MAX_BYTES = 200 * 1024 * 1024
/** Changed paths listed in a run's context hint (F20); `changedTotal` tells how many there were. */
export const SYNC_CHANGED_MAX = 20
/** Paths a sync.state report or a replica row lists; `total` tells how many there were. */
export const SYNC_FILES_MAX = 50
/** Changes per sync.submit (a whole tree at the mode switch included). */
export const SYNC_SUBMIT_CHANGES_MAX = 100_000
/** Hashes per POST …/blobs/missing. */
export const SYNC_MISSING_MAX = 1000

/** sha256 of a file's bytes, lowercase hex: the blob's address. */
export const SyncHash = z.string().regex(/^[0-9a-f]{64}$/)
/** Windows device names, reserved with any extension (`con.txt`, `com1 .log`). */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
/** Code points HFS+ ignores in names, so `.g\u200cit` is `.git` on macOS. */
const IGNORABLE = /[\u200b-\u200f\u202a-\u202e\u206a-\u206f\ufeff]/g
function syncSegmentOk(s: string, i: number) {
  if (s === '' || /[. ]$/.test(s)) return false
  const name = s.replace(IGNORABLE, '').toLowerCase()
  if (name === '.git' || /^git~\d+$/.test(name) || (i === 0 && name === '.gonggong')) return false
  return !WIN_RESERVED.test((name.split('.')[0] ?? '').trimEnd())
}
/**
 * Relative to the workspace root, `/`-separated, canonical, and valid on every platform (F17): no `\\`, `:` or control
 * characters, no segment ending in `.` or a space, no Windows device name. `.git` (in any spelling a filesystem
 * folds to it) is never synced (F4), nor the daemon's own `.gonggong` directory at the root.
 */
const syncPathChar = (c: string) => c !== '\\' && c !== ':' && c > '\x1f' && c !== '\x7f'
export const SyncPath = z
  .string()
  .min(1)
  .refine((p) => [...p].every(syncPathChar) && p.split('/').every(syncSegmentOk), { message: '路径无效' })
/** A path's state in a version: `hash` null = deleted. */
export const SyncEntry = z.object({ path: SyncPath, hash: SyncHash.nullable(), exec: z.boolean() })
export type SyncEntry = z.infer<typeof SyncEntry>
/** `baseHash`: the path's hash at the replica's base version, null = it did not exist (F6). */
export const SyncChange = SyncEntry.extend({ baseHash: SyncHash.nullable() })
export type SyncChange = z.infer<typeof SyncChange>

/**
 * What rootHash (F14) is the sha256 of: live entries sorted by the UTF-8 bytes of their path, one
 * `path NUL x|- NUL hash LF` line each. The Rust daemon builds the same text (cases/sync-root.json).
 */
export function syncRootText(entries: readonly SyncEntry[]) {
  const enc = new TextEncoder()
  const cmp = (a: Uint8Array, b: Uint8Array) => {
    const i = a.findIndex((x, j) => x !== b[j])
    return i < 0 || i >= b.length ? a.length - b.length : (a[i] ?? 0) - (b[i] ?? 0)
  }
  return entries
    .filter((e) => e.hash !== null)
    .map((e) => ({ e, key: enc.encode(e.path) }))
    .sort((a, b) => cmp(a.key, b.key))
    .map(({ e }) => `${e.path}\0${e.exec ? 'x' : '-'}\0${e.hash}\n`)
    .join('')
}

// ── daemon → server ─────────────────────────────────────────────────────────
/**
 * `init`: the base replica's whole tree as v1 (mode switch); `run`: a turn's changes; `local`: the owner submitted
 * local edits (F12); `interrupted`: /stop → 保留 (F21); `merge`: re-submitted after manual conflict decisions (F11).
 */
export const SyncSubmitKind = z.enum(['init', 'run', 'local', 'interrupted', 'merge'])
export type SyncSubmitKind = z.infer<typeof SyncSubmitKind>
/**
 * A replica's changes against `baseVersion`, sent once every new blob is uploaded. `submitId` makes retries after a
 * reconnect idempotent; `merged` = rebased by a clean three-way merge after a conflict (F7).
 */
export const SyncSubmit = z.object({
  t: z.literal('sync.submit'),
  groupId: z.string(),
  botId: z.string(),
  submitId: z.uuid(),
  runId: z.string().nullable(),
  baseVersion: z.number().int().min(0),
  kind: SyncSubmitKind,
  merged: z.boolean(),
  changes: z.array(SyncChange).max(SYNC_SUBMIT_CHANGES_MAX),
})
export type SyncSubmit = z.infer<typeof SyncSubmit>
/** The replica now matches `version`; the server compares `rootHash` with that version's tree (F14). */
export const SyncApplied = z.object({
  t: z.literal('sync.applied'),
  groupId: z.string(),
  botId: z.string(),
  version: z.number().int().min(0),
  rootHash: SyncHash,
})
/**
 * Why a replica stopped taking versions: `drift` = local edits found (F12), `held` = a conflict waits for a decision
 * (F11), `dirty` = uncommitted git changes at the mode switch (not participating), `error` = a cross-platform or size
 * limit was hit (F17, F18; `reason` in the daemon's words), `lost` = the daemon has no sync state for a replica the
 * server counts as joined (home wiped, reinstalled): the server realigns it. `files` = the paths concerned, at most
 * SYNC_FILES_MAX.
 */
export const SyncReplicaIssue = z.enum(['drift', 'held', 'dirty', 'error', 'lost'])
export type SyncReplicaIssue = z.infer<typeof SyncReplicaIssue>
export const SyncState = z.object({
  t: z.literal('sync.state'),
  groupId: z.string(),
  botId: z.string(),
  state: SyncReplicaIssue,
  files: z.array(z.string()).max(SYNC_FILES_MAX),
  total: z.number().int().min(0),
  reason: z.string().nullable(),
})

// ── server → daemon ─────────────────────────────────────────────────────────
/**
 * Answer to sync.submit. `conflict`: nothing was taken; `conflicts` = the head's state of each conflicting path, to
 * three-way merge against (F7). `rejected`: blobs not uploaded, over the size limit, the replica no longer takes part,
 * or `bad_base`: its base version is past the head.
 */
export const SyncRejectReason = z.enum(['blobs_missing', 'too_large', 'not_participating', 'bad_base'])
export const SyncSubmitResult = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted'), version: z.number().int().min(1) }),
  z.object({
    outcome: z.literal('conflict'),
    headVersion: z.number().int().min(0),
    conflicts: z.array(SyncEntry),
  }),
  z.object({ outcome: z.literal('rejected'), reason: SyncRejectReason }),
])
export type SyncSubmitResult = z.infer<typeof SyncSubmitResult>
export const SyncResult = z.object({
  t: z.literal('sync.result'),
  groupId: z.string(),
  botId: z.string(),
  submitId: z.string(),
  result: SyncSubmitResult,
})
/** The group has a new head: idle, clean replicas of it catch up (F8, F12). */
export const SyncAvailable = z.object({
  t: z.literal('sync.available'),
  groupId: z.string(),
  version: z.number().int().min(1),
})
/**
 * Someone settled a replica's issue: local edits submitted or discarded (F12), each conflicting file decided (F11:
 * keep mine / take the head / let the bot merge), or the whole held change discarded. Discards back files up first.
 */
export const SyncDecision = z.object({ path: SyncPath, choice: z.enum(['mine', 'theirs', 'bot']) })
export type SyncDecision = z.infer<typeof SyncDecision>
export const SyncActionKind = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('drift'), choice: z.enum(['submit', 'discard']) }),
  z.object({ kind: z.literal('conflict'), decisions: z.array(SyncDecision).min(1) }),
  z.object({ kind: z.literal('discard') }),
])
export type SyncActionKind = z.infer<typeof SyncActionKind>
export const SyncAction = z.object({
  t: z.literal('sync.action'),
  groupId: z.string(),
  botId: z.string(),
  action: SyncActionKind,
})
/**
 * Mode switch for one replica (§3.5): `base` submits its whole tree as the next version (kind `init`, replacing the
 * head); `align` makes the tree exactly the head after backing up what it overwrites, or reports `dirty` when git has
 * uncommitted changes unless `force`; `leave` stops syncing and forgets the replica's sync state. `repoId` names the
 * managed workspace (null for `leave`).
 */
export const SyncRole = z.enum(['base', 'align', 'leave'])
export type SyncRole = z.infer<typeof SyncRole>
export const SyncInit = z.object({
  t: z.literal('sync.init'),
  groupId: z.string(),
  botId: z.string(),
  role: SyncRole,
  force: z.boolean(),
  repoId: z.string().nullable(),
})

// ── Run fields ──────────────────────────────────────────────────────────────
/**
 * run.start in a force group: catch up to `headVersion` first (F9); `changed` (at most SYNC_CHANGED_MAX) lists what
 * changed since this bot's last turn at `lastVersion` (null = first turn), for the context hint (F20).
 */
export const RunSyncStart = z.object({
  headVersion: z.number().int().min(0),
  lastVersion: z.number().int().min(0).nullable(),
  changed: z.array(z.string()).max(SYNC_CHANGED_MAX),
  changedTotal: z.number().int().min(0),
  /**
   * A merge turn (交给 Bot 合并, F11): the held change's decisions, applied under the replica's lock before the turn
   * (bot = conflict markers written for the agent); the turn's submit is kind `merge`.
   */
  resolve: z.array(SyncDecision).nullable().default(null),
})
export type RunSyncStart = z.infer<typeof RunSyncStart>
/**
 * run.done in a force group, sent once the submit settled so a relay can start right away (F10): `accepted` = taken
 * as `version` (`merged` after a clean auto merge), `unchanged` = nothing to submit, the replica is at `version`;
 * `held` = `files` conflicts wait for a decision; `error` = not submitted (limits, offline…), in the daemon's words;
 * `waiting` = the turn never started: the replica has local edits or a held conflict (F11, F12), so the server queues
 * the run again until the issue is settled; `stopped` = /stop left `files` changed and unsubmitted (F21): the replica
 * waits like with local edits until the initiator keeps (kind `interrupted`) or discards them.
 */
export const RunSyncDone = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted'), version: z.number().int().min(1), merged: z.boolean() }),
  z.object({ outcome: z.literal('unchanged'), version: z.number().int().min(0) }),
  z.object({ outcome: z.literal('held'), files: z.number().int().min(1) }),
  z.object({ outcome: z.literal('error'), reason: z.string() }),
  z.object({ outcome: z.literal('waiting'), issue: z.enum(['drift', 'held']) }),
  z.object({ outcome: z.literal('stopped'), files: z.number().int().min(1) }),
])
export type RunSyncDone = z.infer<typeof RunSyncDone>

// ── REST for the daemon (machine token): /api/daemon/sync/:groupId/… ─────────
/** POST …/blobs/missing: which of `hashes` the server lacks, so only those are uploaded (F15). */
export const SyncMissingReq = z.object({ hashes: z.array(SyncHash).max(SYNC_MISSING_MAX) })
export const SyncMissingRes = z.object({ missing: z.array(SyncHash) })
export type SyncMissingRes = z.infer<typeof SyncMissingRes>
/**
 * PUT / GET …/blobs/:hash: the raw bytes, gzip `Content-Encoding` allowed; the server checks the hash on upload and
 * serves any blob a version of the group still references (also the merge base, F16).
 */
export const SYNC_BLOB_CONTENT_TYPE = 'application/octet-stream'
/** GET …/changes?from=N: the latest entry of each path changed in (from, head]; from=0 = the whole head. */
export const SyncChangesQuery = z.object({ from: z.coerce.number().int().min(0) })
export const SyncChangesRes = z.object({ headVersion: z.number().int().min(0), entries: z.array(SyncEntry) })
export type SyncChangesRes = z.infer<typeof SyncChangesRes>

// ── Web ─────────────────────────────────────────────────────────────────────
/** A replica as the sync panel shows it (F14). */
export const SyncReplicaState = z.enum([
  'consistent',
  'syncing',
  'behind',
  'drift',
  'conflict',
  /** Not taking versions after a failure (cross-platform or size limit, root hash mismatch, F14, F17, F18). */
  'error',
  'excluded',
  'offline',
])
export type SyncReplicaState = z.infer<typeof SyncReplicaState>
export const SyncReplicaDto = z.object({
  botId: z.string(),
  botName: z.string(),
  /** The bot's owner may join its replica, like a group admin. */
  ownerId: z.string(),
  machineName: z.string().nullable(),
  /** A /cd directory never takes part (F2). */
  workspace: z.enum(['managed', 'cd']),
  /** Version the replica last applied; null before it joined. */
  version: z.number().int().nullable(),
  state: SyncReplicaState,
  updatedAt: z.string().nullable(),
  /** What the daemon last reported, if anything is wrong (`dirty` = left out at the switch, may join later). */
  issue: SyncReplicaIssue.nullable(),
  /** With drift / conflict / excluded: the paths concerned (capped) and why, as the daemon reported. */
  files: z.array(z.string()),
  reason: z.string().nullable(),
})
export type SyncReplicaDto = z.infer<typeof SyncReplicaDto>
export const SyncVersionTag = z.enum(['init', 'auto_merge', 'interrupted', 'local', 'merge'])
export type SyncVersionTag = z.infer<typeof SyncVersionTag>
export const SyncVersionDto = z.object({
  version: z.number().int(),
  author: z.object({ kind: z.enum(['bot', 'user']), id: z.string(), name: z.string() }),
  runId: z.string().nullable(),
  tags: z.array(SyncVersionTag),
  files: z.number().int(),
  createdAt: z.string(),
})
export type SyncVersionDto = z.infer<typeof SyncVersionDto>
/** GET /api/groups/:id/sync, and live as `group.sync`; `consistent` of `total` participating replicas. */
export const SyncStatusDto = z.object({
  groupId: z.string(),
  headVersion: z.number().int(),
  consistent: z.number().int(),
  total: z.number().int(),
  /** Switching from partition: the base bot's tree is not in yet; new turns wait (§3.5). */
  switching: z.boolean(),
  replicas: z.array(SyncReplicaDto),
})
export type SyncStatusDto = z.infer<typeof SyncStatusDto>

// ── Mode switch (§3.5, group admins) ────────────────────────────────────────
/** POST /api/groups/:id/sync/enable: partition → force with `baseBotId`'s tree as the first version. */
export const SyncEnableReq = z.object({ baseBotId: z.string() })
/**
 * POST /api/groups/:id/sync/replicas/:botId/join (group admin or the bot's owner): align a left-out replica;
 * `force` = 丢弃并加入, its uncommitted changes are backed up and overwritten.
 */
export const SyncJoinReq = z.object({ force: z.boolean().default(false) })
/**
 * Why a bot would sit out or align late: `cd` a local directory, `offline` its machine (aligns once it connects),
 * `dirty` uncommitted git changes as last reported (the daemon decides at the switch), `not_ready` no clone yet,
 * `outdated` its daemon cannot sync (no `sync` feature).
 */
export const SyncPreviewReason = z.enum(['cd', 'offline', 'dirty', 'not_ready', 'outdated'])
export type SyncPreviewReason = z.infer<typeof SyncPreviewReason>
/** GET /api/groups/:id/sync/preview: what switching would do to each bot; `canBase` = may be the base. */
export const SyncPreviewDto = z.object({
  bots: z.array(
    z.object({
      botId: z.string(),
      botName: z.string(),
      machineName: z.string().nullable(),
      plan: z.enum(['align', 'excluded']),
      reason: SyncPreviewReason.nullable(),
      canBase: z.boolean(),
    }),
  ),
})
export type SyncPreviewDto = z.infer<typeof SyncPreviewDto>
/** POST /api/groups/:id/sync/replicas/:botId/drift (group admin or the bot's owner): settle local edits (F12). */
export const SyncDriftReq = z.object({ choice: z.enum(['submit', 'discard']) })
/**
 * POST /api/groups/:id/sync/conflicts/:conflictId/resolve (group admin or the bot's owner): one decision per
 * conflicting file (F11); any `bot` starts a merge turn of that bot, otherwise the replica re-submits at once.
 * POST …/discard drops the whole held change after a backup.
 */
export const SyncResolveReq = z.object({ decisions: z.array(SyncDecision).min(1) })
/** A held change: per file the replica's, the head's and the base's content hash (null = absent / deleted). */
export const SyncConflictDto = z.object({
  id: z.string(),
  botId: z.string(),
  versionBase: z.number().int(),
  headVersion: z.number().int(),
  files: z.array(
    z.object({
      path: z.string(),
      binary: z.boolean(),
      mineHash: z.string().nullable(),
      theirsHash: z.string().nullable(),
      baseHash: z.string().nullable(),
    }),
  ),
  createdAt: z.string(),
})
export type SyncConflictDto = z.infer<typeof SyncConflictDto>
