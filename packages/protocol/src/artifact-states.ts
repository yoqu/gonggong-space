import { z } from 'zod'

// ── Screen states (plugin web-prototype SKILL.md): fixed-choice dimensions a screen's look varies by ────────────────
// Global dims (`dims` of gg-artifact.json) hold across screens (role, signed in); a screen opts into them with `uses`
// and adds its own (`screens[].dims`: an order's stage, empty data). A dim's first value is its default. Elements show
// under `data-gg-when="order=unpaid|paid role=member"` (space: and, |: or); `data-gg-set="order=paid"` switches state,
// with `data-gg-link` on the screen it goes to. gg-kit.js evaluates them from the screen URL's query.

export const ARTIFACT_GLOBAL_DIMS_MAX = 3
export const ARTIFACT_SCREEN_DIMS_MAX = 2
const KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const ArtifactStateKey = z.string().max(40).regex(KEY)
export const GgArtifactDim = z
  .object({
    id: ArtifactStateKey,
    label: z.string().trim().min(1).max(40),
    values: z
      .array(z.object({ id: ArtifactStateKey, label: z.string().trim().min(1).max(40) }))
      .min(2)
      .max(8),
  })
  .refine((d) => new Set(d.values.map((v) => v.id)).size === d.values.length, { message: '取值重复' })
export type GgArtifactDim = z.infer<typeof GgArtifactDim>
/** Dim id → value id. */
export type ArtifactState = Record<string, string>

/** The dims a screen varies by: the global ones it uses, then its own. */
export function screenDims(
  m: { dims?: GgArtifactDim[]; screens: { id: string; uses?: string[]; dims?: GgArtifactDim[] }[] },
  screenId: string,
): GgArtifactDim[] {
  const s = m.screens.find((x) => x.id === screenId)
  if (!s) return []
  return [...(m.dims ?? []).filter((d) => s.uses?.includes(d.id)), ...(s.dims ?? [])]
}

export const defaultState = (dims: GgArtifactDim[]): ArtifactState =>
  Object.fromEntries(dims.map((d) => [d.id, d.values[0]?.id ?? '']))

export const stateQuery = (state: ArtifactState) => new URLSearchParams(state).toString()

/** The state a query names for these dims, defaults where it names none or an unknown value. */
export function stateFromQuery(dims: GgArtifactDim[], query: string): ArtifactState {
  const q = new URLSearchParams(query)
  return Object.fromEntries(
    dims.map((d) => {
      const v = q.get(d.id)
      return [d.id, v && d.values.some((x) => x.id === v) ? v : (d.values[0]?.id ?? '')]
    }),
  )
}

const PAIR = /^([a-z0-9]+(?:-[a-z0-9]+)*)=([a-z0-9]+(?:-[a-z0-9]+)*(?:\|[a-z0-9]+(?:-[a-z0-9]+)*)*)$/
export type StateCondition = { dim: string; values: string[] }

/** `data-gg-when`; null when malformed. */
export function parseStateWhen(text: string): StateCondition[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const out: StateCondition[] = []
  for (const p of parts) {
    const m = PAIR.exec(p)
    if (!m) return null
    out.push({ dim: m[1] as string, values: (m[2] as string).split('|') })
  }
  return out
}

/** `data-gg-set`: one value per dim; null when malformed. */
export function parseStateSet(text: string): ArtifactState | null {
  const when = parseStateWhen(text)
  if (!when || when.some((c) => c.values.length !== 1)) return null
  const out: ArtifactState = {}
  for (const c of when) {
    if (c.dim in out) return null
    out[c.dim] = c.values[0] as string
  }
  return out
}

export const stateMatches = (when: StateCondition[], state: ArtifactState) =>
  when.every((c) => c.values.includes(state[c.dim] ?? ''))

/** gg-artifact.json: global dim ids unique, `uses` naming global dims, a screen's own dims named like none of them. */
export function refineStateDims(
  m: { dims?: GgArtifactDim[]; screens: { uses?: string[]; dims?: GgArtifactDim[] }[] },
  ctx: z.RefinementCtx,
) {
  const global = new Set<string>()
  for (const [i, d] of (m.dims ?? []).entries()) {
    if (global.has(d.id))
      ctx.addIssue({ code: 'custom', path: ['dims', i, 'id'], message: `维度 id 重复：${d.id}` })
    global.add(d.id)
  }
  for (const [i, s] of m.screens.entries()) {
    for (const u of s.uses ?? [])
      if (!global.has(u))
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'uses'], message: `没有全局维度 ${u}` })
    const own = new Set<string>()
    for (const d of s.dims ?? []) {
      if (global.has(d.id) || own.has(d.id))
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'dims'], message: `维度 id 重复：${d.id}` })
      own.add(d.id)
    }
  }
}
