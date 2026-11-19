import { z } from 'zod'
import { ArtifactDir, ArtifactFile, ArtifactFiles } from './artifacts.js'
import { SyncHash } from './sync.js'

/** An artifact a run checks out before the agent starts (RunStart.artifacts). */
export const DaemonArtifactRef = z.object({
  id: z.string(),
  dir: ArtifactDir,
  headVersionId: z.string().nullable(),
  digest: SyncHash.nullable(),
  /** Its plugin (name): the turn's copy of it gives the shell screenshots are framed in. */
  plugin: z.string().nullable().default(null),
})
export type DaemonArtifactRef = z.infer<typeof DaemonArtifactRef>
/** GET /api/daemon/artifacts/:id/versions/:versionId */
export const ArtifactManifestRes = z.object({ versionId: z.string(), files: z.array(ArtifactFile) })
export type ArtifactManifestRes = z.infer<typeof ArtifactManifestRes>
/** POST /api/daemon/runs/:runId/artifacts/:id/versions — every blob uploaded first; `submitKey` makes retries idempotent. */
export const ArtifactSubmitReq = z.object({
  parentVersionId: z.string().nullable(),
  /** `local`: changes found on the machine before the run started (uploaded before the head is checked out). */
  source: z.enum(['run', 'local']).default('run'),
  submitKey: z.uuid(),
  files: ArtifactFiles,
})
export type ArtifactSubmitReq = z.infer<typeof ArtifactSubmitReq>
/** `head` false with `stale` true: kept as a candidate, the head moved on meanwhile. */
export const ArtifactSubmitRes = z.object({
  versionId: z.string(),
  n: z.number().int().min(1),
  head: z.boolean(),
  stale: z.boolean(),
})
export type ArtifactSubmitRes = z.infer<typeof ArtifactSubmitRes>
