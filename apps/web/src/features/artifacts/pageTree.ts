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
    screens: m.screens.filter(
      (s) => !s.parent && (s.group && known.has(s.group) ? s.group : undefined) === parent,
    ),
  })
  return level(undefined, 1)
}

/** The page's subpages (子页面), in manifest order. */
export const subpages = (m: GgArtifactManifest, id: string) => m.screens.filter((s) => s.parent === id)

/** The page itself, then each of its ancestors' ids up to its top-level page. */
function lineage(m: GgArtifactManifest, id: string | undefined) {
  const out: string[] = []
  for (let p = id; p !== undefined && !out.includes(p); p = m.screens.find((s) => s.id === p)?.parent)
    out.push(p)
  return out
}

/** The top-level page above it (itself when it has no parent): its folder is the subtree's. */
const rootOf = (m: GgArtifactManifest, id: string) => {
  const top = lineage(m, id).at(-1)
  return m.screens.find((s) => s.id === top)
}

/**
 * The screens the canvas shows for `page`: one page (a screen id) alone, or a folder's pages with their subpages;
 * null: 全部页面.
 */
export function shownScreens(m: GgArtifactManifest, page: string | null | undefined) {
  if (!page) return m.screens
  if (m.screens.some((s) => s.id === page)) return m.screens.filter((s) => s.id === page)
  return m.screens.filter((s) => rootOf(m, s.id)?.group === page)
}

/** The page can go under `parent` (top level: undefined) without a cycle or going deeper than allowed. */
export function canNestScreen(m: GgArtifactManifest, id: string, parent: string | undefined) {
  if (!parent) return true
  if (lineage(m, parent).includes(id)) return false
  const height = (x: string): number => 1 + Math.max(0, ...subpages(m, x).map((s) => height(s.id)))
  return lineage(m, parent).length + height(id) <= ARTIFACT_PAGE_GROUP_DEPTH
}

/** A page list change, as the `pages` op the server applies in one version. */
export type PagesOp = Extract<ArtifactEditOp, { kind: 'pages' }>
const op = (groups: GgArtifactPageGroup[], screens: GgArtifactScreen[]): PagesOp => ({
  kind: 'pages',
  groups,
  screens: screens.map((s) => ({
    id: s.id,
    ...(s.group && { group: s.group }),
    ...(s.parent && { parent: s.parent }),
  })),
})
const withGroup = (s: GgArtifactScreen, group: string | undefined): GgArtifactScreen => {
  const { group: _, ...rest } = s
  return group ? { ...rest, group } : rest
}
/** In `group`, or under the page `parent` (then in no group of its own). */
const placed = (
  s: GgArtifactScreen,
  group: string | undefined,
  parent: string | undefined,
): GgArtifactScreen => {
  const { group: _, parent: __, ...rest } = s
  return parent ? { ...rest, parent } : group ? { ...rest, group } : rest
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

/**
 * Moves the group into `parent`, before its sibling `before` or after its last sibling; null when it cannot go there or
 * nothing changes.
 */
export function moveGroup(
  m: GgArtifactManifest,
  id: string,
  parent: string | undefined,
  before?: string,
): PagesOp | null {
  const all = m.groups ?? []
  const g = all.find((x) => x.id === id)
  if (!g || before === id || !canNest(m, id, parent)) return null
  const { parent: _, ...rest } = g
  const others = all.filter((x) => x.id !== id)
  const at = before ? others.findIndex((x) => x.id === before) : -1
  const moved = { ...rest, ...(parent && { parent }) }
  const groups = at < 0 ? [...others, moved] : [...others.slice(0, at), moved, ...others.slice(at)]
  const same = groups.every((x, i) => x.id === all[i]?.id && x.parent === all[i]?.parent)
  return same ? null : op(groups, m.screens)
}

/** A new empty folder (文件夹) right above or below `sibling`, beside it. */
export function insertGroup(
  m: GgArtifactManifest,
  title: string,
  sibling: string,
  place: 'above' | 'below',
): PagesOp {
  const all = m.groups ?? []
  const at = all.findIndex((g) => g.id === sibling) + (place === 'below' ? 1 : 0)
  const parent = all.find((g) => g.id === sibling)?.parent
  const added = { id: newGroupId(m), title, ...(parent && { parent }) }
  return op([...all.slice(0, at), added, ...all.slice(at)], m.screens)
}

/** Where moving one step up (-1) or down (1) among `siblings` puts `id`: before which one (undefined: last); null at the edge. */
function stepBefore(siblings: string[], id: string, dir: -1 | 1): string | undefined | null {
  const i = siblings.indexOf(id)
  const to = i + dir
  if (i < 0 || to < 0 || to >= siblings.length) return null
  return dir < 0 ? siblings[to] : siblings[to + 1]
}

/** 上移 / 下移 among its sibling pages. */
export function shiftGroup(m: GgArtifactManifest, id: string, dir: -1 | 1): PagesOp | null {
  const parent = m.groups?.find((g) => g.id === id)?.parent
  const siblings = (m.groups ?? []).filter((g) => g.parent === parent).map((g) => g.id)
  const before = stepBefore(siblings, id, dir)
  return before === null ? null : moveGroup(m, id, parent, before)
}

/** 上移 / 下移 among its sibling pages (same folder, same parent page). */
export function shiftScreen(m: GgArtifactManifest, id: string, dir: -1 | 1): PagesOp | null {
  const me = m.screens.find((s) => s.id === id)
  const siblings = m.screens.filter((s) => s.group === me?.group && s.parent === me?.parent).map((s) => s.id)
  const before = stepBefore(siblings, id, dir)
  return before === null ? null : moveScreen(m, id, me?.group, before, me?.parent)
}

/**
 * Moves the page into `group` (top level: undefined) or under the page `parent`, before `before` (a sibling) or after
 * the last sibling; null when it cannot go there or nothing changes. Its subpages go with it.
 */
export function moveScreen(
  m: GgArtifactManifest,
  id: string,
  group: string | undefined,
  before?: string,
  parent?: string,
): PagesOp | null {
  const screen = m.screens.find((s) => s.id === id)
  if (!screen || before === id || !canNestScreen(m, id, parent)) return null
  const rest = m.screens.filter((s) => s.id !== id)
  const moved = placed(screen, group, parent)
  let at = before ? rest.findIndex((s) => s.id === before) : -1
  if (at < 0) {
    const last = rest.findLastIndex((s) =>
      parent ? s.parent === parent || s.id === parent : !s.parent && (s.group ?? undefined) === group,
    )
    at = last < 0 ? rest.length : last + 1
  }
  const screens = [...rest.slice(0, at), moved, ...rest.slice(at)]
  const same = screens.every(
    (s, i) =>
      s.id === m.screens[i]?.id && s.group === m.screens[i]?.group && s.parent === m.screens[i]?.parent,
  )
  return same ? null : op(m.groups ?? [], screens)
}

/** 设为子页面: under the sibling page just above it, as its last subpage. */
export function indentScreen(m: GgArtifactManifest, id: string): PagesOp | null {
  const me = m.screens.find((s) => s.id === id)
  const siblings = m.screens.filter((s) => s.group === me?.group && s.parent === me?.parent)
  const above = siblings[siblings.findIndex((s) => s.id === id) - 1]
  return above ? moveScreen(m, id, undefined, undefined, above.id) : null
}

/** 移出子页面: out of its parent page, right after it. */
export function outdentScreen(m: GgArtifactManifest, id: string): PagesOp | null {
  const up = m.screens.find((s) => s.id === m.screens.find((x) => x.id === id)?.parent)
  if (!up) return null
  const siblings = m.screens.filter((s) => s.group === up.group && s.parent === up.parent && s.id !== id)
  const next = siblings[siblings.findIndex((s) => s.id === up.id) + 1]
  return moveScreen(m, id, up.group, next?.id, up.parent)
}

/** Every group as a flat list in tree order, for 移到分类 menus. */
export function flatGroups(tree: PageTree): PageGroupNode[] {
  return tree.groups.flatMap((g) => [g, ...flatGroups(g)])
}
