import {
  ARTIFACT_PAGE_GROUP_DEPTH,
  type ArtifactEditOp,
  type GgArtifactManifest,
  type GgArtifactPageGroup,
  type GgArtifactScreen,
} from '@gonggong/protocol'

/** The page list (多级分类) as the rail shows it: per level, its subgroups first, then its pages. */
export interface PageGroupNode {
  group: GgArtifactPageGroup
  depth: number
  groups: PageGroupNode[]
  screens: GgArtifactScreen[]
}
export interface PageTree {
  groups: PageGroupNode[]
  screens: GgArtifactScreen[]
}

export function pageTree(m: GgArtifactManifest): PageTree {
  const groups = m.groups ?? []
  const known = new Set(groups.map((g) => g.id))
  const level = (parent: string | undefined, depth: number): PageTree => ({
    groups: groups
      .filter((g) => g.parent === parent)
      .map((g) => ({ group: g, depth, ...level(g.id, depth + 1) })),
    screens: m.screens.filter((s) => (s.group && known.has(s.group) ? s.group : undefined) === parent),
  })
  return level(undefined, 1)
}

/** A page list change, as the `pages` op the server applies in one version. */
export type PagesOp = Extract<ArtifactEditOp, { kind: 'pages' }>
const op = (groups: GgArtifactPageGroup[], screens: GgArtifactScreen[]): PagesOp => ({
  kind: 'pages',
  groups,
  screens: screens.map((s) => (s.group ? { id: s.id, group: s.group } : { id: s.id })),
})
const withGroup = (s: GgArtifactScreen, group: string | undefined): GgArtifactScreen => {
  const { group: _, ...rest } = s
  return group ? { ...rest, group } : rest
}

/** `g-1`, `g-2`…: the first free group id. */
export function newGroupId(m: GgArtifactManifest) {
  const taken = new Set([...(m.groups ?? []), ...m.screens].map((x) => x.id))
  for (let n = 1; ; n++) if (!taken.has(`g-${n}`)) return `g-${n}`
}

export const groupDepth = (m: GgArtifactManifest, id: string | undefined) => {
  let depth = 0
  for (let p = id; p !== undefined; p = m.groups?.find((g) => g.id === p)?.parent) depth++
  return depth
}

/** How many levels the group's subtree takes (itself: 1). */
function subtreeHeight(m: GgArtifactManifest, id: string): number {
  const kids = (m.groups ?? []).filter((g) => g.parent === id)
  return 1 + Math.max(0, ...kids.map((g) => subtreeHeight(m, g.id)))
}

const isWithin = (m: GgArtifactManifest, id: string | undefined, ancestor: string) => {
  for (let p = id; p !== undefined; p = m.groups?.find((g) => g.id === p)?.parent)
    if (p === ancestor) return true
  return false
}

export const addGroup = (m: GgArtifactManifest, title: string, parent?: string): PagesOp =>
  op([...(m.groups ?? []), { id: newGroupId(m), title, ...(parent && { parent }) }], m.screens)

export const renameGroup = (m: GgArtifactManifest, id: string, title: string): PagesOp =>
  op(
    (m.groups ?? []).map((g) => (g.id === id ? { ...g, title } : g)),
    m.screens,
  )

/** Its subgroups and pages move up to its parent. */
export function deleteGroup(m: GgArtifactManifest, id: string): PagesOp {
  const gone = m.groups?.find((g) => g.id === id)
  const parent = gone?.parent
  const groups = (m.groups ?? [])
    .filter((g) => g.id !== id)
    .map((g) => (g.parent === id ? { ...g, parent } : g))
    .map(({ parent: p, ...g }) => (p ? { ...g, parent: p } : g))
  return op(
    groups,
    m.screens.map((s) => (s.group === id ? withGroup(s, parent) : s)),
  )
}

/** The group can sit in `parent` (top level: undefined) without a cycle or going deeper than allowed. */
export const canNest = (m: GgArtifactManifest, id: string, parent: string | undefined) =>
  !isWithin(m, parent, id) && groupDepth(m, parent) + subtreeHeight(m, id) <= ARTIFACT_PAGE_GROUP_DEPTH

/** Moves the group into `parent`, after its new siblings; null when it cannot go there. */
export function moveGroup(m: GgArtifactManifest, id: string, parent: string | undefined): PagesOp | null {
  const g = m.groups?.find((x) => x.id === id)
  if (!g || g.parent === parent || !canNest(m, id, parent)) return null
  const { parent: _, ...rest } = g
  return op(
    [...(m.groups ?? []).filter((x) => x.id !== id), { ...rest, ...(parent && { parent }) }],
    m.screens,
  )
}

/**
 * Moves the page into `group` (top level: undefined), before `before` (a page) or after the group's last page; null
 * when nothing changes.
 */
export function moveScreen(
  m: GgArtifactManifest,
  id: string,
  group: string | undefined,
  before?: string,
): PagesOp | null {
  const screen = m.screens.find((s) => s.id === id)
  if (!screen || before === id) return null
  const rest = m.screens.filter((s) => s.id !== id)
  const moved = withGroup(screen, group)
  let at = before ? rest.findIndex((s) => s.id === before) : -1
  if (at < 0) {
    const last = rest.findLastIndex((s) => (s.group ?? undefined) === group)
    at = last < 0 ? rest.length : last + 1
  }
  const screens = [...rest.slice(0, at), moved, ...rest.slice(at)]
  const same = screens.every((s, i) => s.id === m.screens[i]?.id && s.group === m.screens[i]?.group)
  return same ? null : op(m.groups ?? [], screens)
}

/** Every group as a flat list in tree order, for 移到分类 menus. */
export function flatGroups(tree: PageTree): PageGroupNode[] {
  return tree.groups.flatMap((g) => [g, ...flatGroups(g)])
}
