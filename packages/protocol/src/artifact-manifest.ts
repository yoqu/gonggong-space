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
  /** The page group it sits in (`groups` of the manifest); absent: the top level. */
  group: ArtifactScreenId.optional(),
  /** The page it is a subpage of (子页面), up to ARTIFACT_PAGE_GROUP_DEPTH deep; it then sits in no group of its own. */
  parent: ArtifactScreenId.optional(),
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
export const ARTIFACT_PAGE_GROUPS_MAX = 50
/** How deep page folders nest (墨刀 allows 7 levels). */
export const ARTIFACT_PAGE_GROUP_DEPTH = 7
/** A page group of the page list (多级分类); its place among its siblings is its order in `groups`. */
export const GgArtifactPageGroup = z.object({
  id: ArtifactScreenId,
  title: z.string().trim().min(1).max(40),
  /** Its parent group; absent: the top level. */
  parent: ArtifactScreenId.optional(),
})
export type GgArtifactPageGroup = z.infer<typeof GgArtifactPageGroup>

/** Unique ids, known parents, no cycle, at most ARTIFACT_PAGE_GROUP_DEPTH deep. */
export function pageGroupIssues(groups: readonly GgArtifactPageGroup[]): string[] {
  const byId = new Map<string, GgArtifactPageGroup>()
  const issues: string[] = []
  for (const g of groups) {
    if (byId.has(g.id)) issues.push(`分组 id 重复：${g.id}`)
    byId.set(g.id, g)
  }
  for (const g of groups) {
    let depth = 1
    for (let p = g.parent; p !== undefined; p = byId.get(p)?.parent) {
      if (!byId.has(p)) {
        issues.push(`没有分组 ${p}`)
        break
      }
      if (++depth > ARTIFACT_PAGE_GROUP_DEPTH) {
        issues.push(`分组最多 ${ARTIFACT_PAGE_GROUP_DEPTH} 级：${g.id}`)
        break
      }
    }
  }
  return issues
}

/** Subpages (`parent`): a known other page, no cycle, at most ARTIFACT_PAGE_GROUP_DEPTH deep, not also in a group. */
export function subpageIssues(screens: readonly Pick<GgArtifactScreen, 'id' | 'parent' | 'group'>[]) {
  const parentOf = new Map(screens.map((s) => [s.id, s.parent]))
  const issues: [number, string][] = []
  for (const [i, s] of screens.entries()) {
    if (s.parent === undefined) continue
    if (s.group !== undefined) issues.push([i, `子页面不能再放进分组：${s.id}`])
    let depth = 1
    for (let p: string | undefined = s.parent; p !== undefined; p = parentOf.get(p)) {
      if (!parentOf.has(p)) {
        issues.push([i, `没有页面 ${p}`])
        break
      }
      if (p === s.id) {
        issues.push([i, `页面不能挂在自己下面：${s.id}`])
        break
      }
      if (++depth > ARTIFACT_PAGE_GROUP_DEPTH) {
        issues.push([i, `子页面最多 ${ARTIFACT_PAGE_GROUP_DEPTH} 级：${s.id}`])
        break
      }
    }
  }
  return issues
}

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
    /** Page groups of the page list, nested by `parent` (多级分类). */
    groups: z.array(GgArtifactPageGroup).max(ARTIFACT_PAGE_GROUPS_MAX).optional(),
  })
  .superRefine((m, ctx) => {
    refineStateDims(m, ctx)
    for (const message of pageGroupIssues(m.groups ?? []))
      ctx.addIssue({ code: 'custom', path: ['groups'], message })
    const groupIds = new Set((m.groups ?? []).map((g) => g.id))
    for (const [i, s] of m.screens.entries())
      if (s.group !== undefined && !groupIds.has(s.group))
        ctx.addIssue({ code: 'custom', path: ['screens', i, 'group'], message: `没有分组 ${s.group}` })
    for (const [i, message] of subpageIssues(m.screens))
      ctx.addIssue({ code: 'custom', path: ['screens', i, 'parent'], message })
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
