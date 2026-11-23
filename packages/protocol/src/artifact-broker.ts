import { z } from 'zod'

// ── Capability broker (docs/plan/产物容器-开发计划.md §4.3) ──────────────────────────────────────────────────────
// The `cap_*` postMessage protocol of open-artifact (`packages/protocol/src/shell.ts`, used by
// `packages/runtime/src/broker.ts`), so its editors run unchanged inside our Shell: the editor iframe asks for a
// capability once (`cap_want` → `cap_grant`), then calls it (`cap` → `cap_r`); the Shell may ask for more time
// (`cap_ack`), pushes events (`cap_ev`) and cuts calls sent under an older `gen` (`cap_rewired`).

export const CAP_PROTOCOL = 1
/** Capability names: lower-case. */
export const CAP_NAME = /^[a-z][a-z0-9]{0,23}$/
const CapName = z.string().regex(CAP_NAME)
const Gen = z.number().int().min(0)

/** A rejected call, as open-artifact's `ArtifactError` fields. */
export const CapError = z.object({
  code: z.string(),
  message: z.string(),
  /** Conflicting paths of a `conflict`. */
  paths: z.array(z.unknown()).optional(),
  retryable: z.boolean().optional(),
})
export type CapError = z.infer<typeof CapError>

/** Editor page → Shell. */
export const CapToShell = z.discriminatedUnion('openArtifact', [
  /** `base`: the page's own API base (its directory URL). */
  z.object({
    openArtifact: z.literal('cap_want'),
    cap: CapName,
    protocol: z.number().int(),
    base: z.string(),
  }),
  z.object({
    openArtifact: z.literal('cap'),
    id: z.string().min(1).max(64),
    cap: CapName,
    method: z.string().min(1).max(64),
    args: z.array(z.unknown()),
    gen: Gen,
  }),
])
export type CapToShell = z.infer<typeof CapToShell>

/** Shell → editor page. */
export const CapToPage = z.discriminatedUnion('openArtifact', [
  /** `ok` false: this view may not use it. `config`: what the page may know without asking (artifact id, viewer). */
  z.object({
    openArtifact: z.literal('cap_grant'),
    cap: CapName,
    ok: z.boolean(),
    gen: Gen,
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    openArtifact: z.literal('cap_r'),
    id: z.string(),
    result: z.unknown().optional(),
    error: CapError.optional(),
  }),
  z.object({ openArtifact: z.literal('cap_ack'), id: z.string() }),
  z.object({ openArtifact: z.literal('cap_ev'), cap: CapName, event: z.string(), data: z.unknown() }),
  /** Calls sent under another `gen` will not be answered; `caps`: the capabilities still served. */
  z.object({ openArtifact: z.literal('cap_rewired'), gen: Gen, caps: z.array(CapName).optional() }),
])
export type CapToPage = z.infer<typeof CapToPage>

// ── Broker-facing server endpoints (docs/plan/产物容器-S0-spike.md §6) ─────────────────────────────────────────

export const ArtifactPublishFile = z.object({
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).default('utf8'),
  /** Expected current sha256 (`null` = must not exist yet; omitted = unconditional write). */
  ifMatch: z.string().nullable().optional(),
})
export type ArtifactPublishFile = z.infer<typeof ArtifactPublishFile>

/** POST /api/artifacts/:id/publish — per-file `ifMatch` atomic batch (`null` deletes a path). */
export const ArtifactPublishReq = z.object({
  batch: z.record(z.string(), ArtifactPublishFile.nullable()),
  /** Sender's tab/session id so the Shell suppresses self-echoes of `artifact.files`. */
  clientId: z.string().max(64).optional(),
})
export type ArtifactPublishReq = z.infer<typeof ArtifactPublishReq>

export const ArtifactPublishConflict = z.object({
  path: z.string(),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
})
export type ArtifactPublishConflict = z.infer<typeof ArtifactPublishConflict>

export const ArtifactPublishRes = z.object({
  versionId: z.string(),
  n: z.number().int().min(1),
  hashes: z.record(z.string(), z.string().nullable()),
  coalesced: z.boolean().optional(),
})
export type ArtifactPublishRes = z.infer<typeof ArtifactPublishRes>

/** POST /api/artifacts/:id/assets — image or video upload keyed by 32-hex sha256 prefix. */
export const ArtifactAssetRes = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  url: z.string().regex(/^\/_blob\/[0-9a-f]{32}$/),
  sizeBytes: z.number().int().min(0),
  contentType: z.string(),
})
export type ArtifactAssetRes = z.infer<typeof ArtifactAssetRes>

export const ArtifactHistoryAuthor = z.object({
  kind: z.enum(['person', 'agent', 'system']),
  id: z.string(),
  name: z.string(),
})
export type ArtifactHistoryAuthor = z.infer<typeof ArtifactHistoryAuthor>

export const ArtifactHistoryFileChange = z.object({
  path: z.string(),
  op: z.enum(['added', 'edited', 'deleted']),
})
export type ArtifactHistoryFileChange = z.infer<typeof ArtifactHistoryFileChange>

export const ArtifactHistoryVersionDto = z.object({
  id: z.string(),
  n: z.number().int().min(1),
  first: z.string(),
  at: z.string(),
  author: ArtifactHistoryAuthor,
  files: z.array(ArtifactHistoryFileChange),
  current: z.literal(true).optional(),
})
export type ArtifactHistoryVersionDto = z.infer<typeof ArtifactHistoryVersionDto>

/** GET /api/artifacts/:id/versions/history */
export const ArtifactHistoryListRes = z.object({
  versions: z.array(ArtifactHistoryVersionDto),
  notices: z.array(z.unknown()),
  canRestore: z.boolean(),
})
export type ArtifactHistoryListRes = z.infer<typeof ArtifactHistoryListRes>

/** GET /api/artifacts/:id/versions/:vid/diff?path=… */
export const ArtifactHistoryDiffRes = z.object({
  path: z.string(),
  n: z.number().int().min(1),
  op: z.enum(['added', 'edited', 'deleted']),
  before: z.string().nullable(),
  after: z.string().nullable(),
  binary: z.literal(true).optional(),
  tooLarge: z.literal(true).optional(),
})
export type ArtifactHistoryDiffRes = z.infer<typeof ArtifactHistoryDiffRes>

/** POST /api/artifacts/:id/versions/:vid/restore-files — restores all or selected paths as a new version. */
export const ArtifactRestoreFilesReq = z.object({
  paths: z.array(z.string().min(1)).max(500).optional(),
  clientId: z.string().max(64).optional(),
})
export type ArtifactRestoreFilesReq = z.infer<typeof ArtifactRestoreFilesReq>

export const ArtifactRestoreFilesRes = z.object({
  version: z.number().int().min(1).nullable(),
  changed: z.array(z.string()),
})
export type ArtifactRestoreFilesRes = z.infer<typeof ArtifactRestoreFilesRes>

/** POST /api/artifacts/:id/agent-send — broker `agent.send` into the artifact's AI chat. */
export const ArtifactAgentSendReq = z.object({
  text: z.string().trim().min(1).max(4000),
  title: z.string().max(200).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  botId: z.string().optional(),
})
export type ArtifactAgentSendReq = z.infer<typeof ArtifactAgentSendReq>

export const ArtifactAgentSendRes = z.object({
  status: z.enum(['delivered', 'queued', 'failed']),
  messageId: z.string().optional(),
  reason: z.string().optional(),
})
export type ArtifactAgentSendRes = z.infer<typeof ArtifactAgentSendRes>
