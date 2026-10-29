import {
  type ArtifactDesignSystem,
  type ArtifactEditOp,
  type ArtifactWholeFile,
  tokenValueOk,
} from '@gonggong/protocol'
import { api } from '../../lib/api'
import { syncDesignMd } from './designMd'
import { loadArtifact } from './store'
import { parseTokens, writeTokens } from './tokens'

export type DesignFile = ArtifactWholeFile
export type DesignEditOp = ArtifactEditOp

/** GET /api/artifacts/:id/design-systems — the plugin's presets. */
export type DesignSystemPreset = ArtifactDesignSystem

/** The shown version's design files; `md` null when it has no DESIGN.md. */
export interface DesignFiles {
  versionId: string
  css: string
  md: string | null
}

/** More token changes than this go as one tokens.css file op (the request takes 50 ops). */
const TOKEN_OPS_MAX = 40

export const tokenMap = (css: string) => new Map(parseTokens(css).vars)

/** The draft with token `changes` (keyed `--x`), mirrored into DESIGN.md's front matter. */
export const applyTokens = (draft: DesignFiles, changes: Record<string, string>): DesignFiles => ({
  ...draft,
  css: writeTokens(draft.css, changes),
  md: draft.md === null ? null : syncDesignMd(draft.md, changes),
})

/** Token names whose draft value cannot be saved. */
export const invalidTokens = (css: string) =>
  parseTokens(css)
    .vars.filter(([, v]) => !tokenValueOk(v))
    .map(([k]) => k)

/** What saving the draft sends: token ops for changed tokens (or the whole tokens.css), DESIGN.md as a file op. */
export function designOps(base: DesignFiles, draft: DesignFiles): DesignEditOp[] {
  const before = tokenMap(base.css)
  const changed = [...tokenMap(draft.css)].filter(([k, v]) => before.get(k) !== v)
  const ops: DesignEditOp[] =
    changed.length > TOKEN_OPS_MAX
      ? [{ kind: 'file', path: 'tokens.css', content: draft.css }]
      : changed.map(([name, value]) => ({ kind: 'token', name, value }))
  if (draft.md !== null && draft.md !== base.md)
    ops.push({ kind: 'file', path: 'DESIGN.md', content: draft.md })
  return ops
}

export async function saveDesign(artifactId: string, baseVersionId: string, ops: DesignEditOp[]) {
  try {
    await api.post(`/artifacts/${artifactId}/edits`, { baseVersionId, ops })
  } finally {
    await loadArtifact(artifactId)
  }
}

/** POST …/commands apply-design-system: the bot restyles every screen to the saved design system. */
export const applyDesignSystem = (artifactId: string, botId: string) =>
  api.post(`/artifacts/${artifactId}/commands`, { command: 'apply-design-system', botId })

export const loadPresets = (artifactId: string) =>
  api.get<DesignSystemPreset[]>(`/artifacts/${artifactId}/design-systems`)
