import { z } from 'zod'
import { ARTIFACT_LINKS_MAX, GgArtifactLink } from './artifact-links.js'
import {
  ARTIFACT_GLOBAL_DIMS_MAX,
  ARTIFACT_SCREEN_DIMS_MAX,
  ArtifactStateKey,
  GgArtifactDim,
  refineStateDims,
} from './artifact-states.js'

export const ArtifactScreenId = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)

// ── gg-artifact.json (L1 contract, plugin web-prototype SKILL.md) ───────────
export const ArtifactDevice = z.enum(['miniprogram', 'mobile', 'desktop'])
export type ArtifactDevice = z.infer<typeof ArtifactDevice>
export const GgArtifactScreen = z.object({
  id: ArtifactScreenId,
  title: z.string().min(1).max(80),
  file: z.string(),
  statusBar: z.enum(['light', 'dark']).optional(),
  /** The screen's design prompt (what it is for, its sections, key copy), shown in its details like Stitch's. */
  prompt: z.string().max(4000).optional(),
  /** Its place on the canvas; absent: the canvas lays it out. */
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  /** The global state dims (`dims` of the manifest) this screen varies by; the others do not apply to it. */
  uses: z.array(ArtifactStateKey).max(ARTIFACT_GLOBAL_DIMS_MAX).optional(),
  /** Its own state dims (artifact-states.ts). */
  dims: z.array(GgArtifactDim).max(ARTIFACT_SCREEN_DIMS_MAX).optional(),
})
export type GgArtifactScreen = z.infer<typeof GgArtifactScreen>
/** Reference files members put on the canvas (images, PDFs, text): AI context, not part of the prototype. */
export const ArtifactRefKind = z.enum(['image', 'pdf', 'text'])
export type ArtifactRefKind = z.infer<typeof ArtifactRefKind>
export const ARTIFACT_REF_EXT = {
  png: 'image',
  jpg: 'image',
  webp: 'image',
  gif: 'image',
  pdf: 'pdf',
  txt: 'text',
  md: 'text',
} as const satisfies Record<string, ArtifactRefKind>
export const ARTIFACT_REFS_MAX = 50
export const ArtifactRefFile = z
  .string()
  .regex(/^refs\/[a-z0-9]+(-[a-z0-9]+)*\.(png|jpg|webp|gif|pdf|txt|md)$/)
/** A reference node: its file sits in `refs/` and travels with the version (the agent reads it in its checkout). */
export const GgArtifactRef = z.object({
  id: ArtifactScreenId,
  title: z.string().min(1).max(120),
  file: ArtifactRefFile,
  kind: ArtifactRefKind,
  /** Its place on the canvas; absent: the canvas lays it out. */
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
})
export type GgArtifactRef = z.infer<typeof GgArtifactRef>
export const GG_ARTIFACT_MANIFEST = 'gg-artifact.json'
export const GgArtifactManifest = z
  .object({
    title: z.string().min(1).max(80),
    device: ArtifactDevice,
    entry: ArtifactScreenId,
    screens: z.array(GgArtifactScreen).min(1).max(100),
    refs: z.array(GgArtifactRef).max(ARTIFACT_REFS_MAX).optional(),
    links: z.array(GgArtifactLink).max(ARTIFACT_LINKS_MAX).optional(),
    /** Global state dims (artifact-states.ts). */
    dims: z.array(GgArtifactDim).max(ARTIFACT_GLOBAL_DIMS_MAX).optional(),
  })
  .superRefine((m, ctx) => {
    refineStateDims(m, ctx)
    const ids = new Set<string>()
    for (const [i, s] of m.screens.entries()) {
      if (s.file !== `screens/${s.id}.html`)
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'file'], message: `必须是 screens/${s.id}.html` })
      if (ids.has(s.id))
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'id'], message: `屏幕 id 重复：${s.id}` })
      ids.add(s.id)
    }
    if (!ids.has(m.entry)) ctx.addIssue({ code: 'custom', path: ['entry'], message: `没有屏幕 ${m.entry}` })
    const refIds = new Set<string>()
    for (const [i, r] of (m.refs ?? []).entries()) {
      if (refIds.has(r.id))
        ctx.addIssue({ code: 'custom', path: ['refs', i, 'id'], message: `参考 id 重复：${r.id}` })
      refIds.add(r.id)
      const ext = r.file.slice(r.file.lastIndexOf('.') + 1) as keyof typeof ARTIFACT_REF_EXT
      if (ARTIFACT_REF_EXT[ext] !== r.kind)
        ctx.addIssue({ code: 'custom', path: ['refs', i, 'kind'], message: `与文件类型不符：${r.file}` })
    }
    const linkIds = new Set<string>()
    for (const [i, l] of (m.links ?? []).entries()) {
      if (linkIds.has(l.id))
        ctx.addIssue({ code: 'custom', path: ['links', i, 'id'], message: `链接 id 重复：${l.id}` })
      linkIds.add(l.id)
    }
  })
export type GgArtifactManifest = z.infer<typeof GgArtifactManifest>
