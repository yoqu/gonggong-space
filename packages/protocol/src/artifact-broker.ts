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
