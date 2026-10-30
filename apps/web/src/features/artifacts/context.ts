import type { ArtifactContext, ArtifactRefKind, GgArtifactRef } from '@gonggong/protocol'
import { create } from 'zustand'

/**
 * What the canvas hands to the group composer (Stitch's selection-as-context and Add to Chat ⌘L): the selected
 * screens and elements of one artifact show as chips above the input and go out with the next message.
 */
export interface ContextItem {
  /** `screen:<id>`, `el:<file>#<ggId>` or `ref:<id>`. */
  key: string
  /** Empty for a reference. */
  screenId: string
  screenTitle: string
  /** Set for an element. */
  element?: { file: string; ggId: string; label: string }
  /** Set for a file uploaded to the canvas (G04). */
  ref?: { id: string; file: string; title: string; kind: ArtifactRefKind }
  /** Added with Add to Chat: stays when the selection changes. */
  pinned: boolean
}

export interface CanvasContext {
  groupId: string
  artifactId: string
  title: string
  /** The artifact's own bot (ArtifactDto.botId): the server hands a message without an @ to it. */
  botId: string | null
  items: ContextItem[]
}

type Base = Omit<CanvasContext, 'items'>
type Item = Omit<ContextItem, 'pinned'>

interface ContextState {
  context: CanvasContext | null
  /** Bumped by Add to Chat: the composer of the group takes the focus. */
  focus: number
  /** Bumped by the composer's 设计系统 chip: the canvas of `artifactId` opens its design-system panel. */
  design: { artifactId: string; n: number } | null
}

export const useCanvasContext = create<ContextState>()(() => ({ context: null, focus: 0, design: null }))

/** The composer asks the canvas of `artifactId` to open its design-system panel. */
export const requestDesignPanel = (artifactId: string) =>
  useCanvasContext.setState((s) => ({ design: { artifactId, n: (s.design?.n ?? 0) + 1 } }))

const sameArtifact = (c: CanvasContext | null, b: Base) =>
  c && c.artifactId === b.artifactId && c.groupId === b.groupId ? c : null

function merge(base: Base, keep: ContextItem[], add: ContextItem[]) {
  const items = [...keep]
  for (const it of add) {
    const at = items.findIndex((x) => x.key === it.key)
    if (at < 0) items.push(it)
    else if (it.pinned) items[at] = it
  }
  useCanvasContext.setState({ context: items.length ? { ...base, items } : null })
}

/** The canvas selection changed: it replaces what was selected before; pinned items stay. */
export function setSelectionContext(base: Base, selection: Item[]) {
  const prev = sameArtifact(useCanvasContext.getState().context, base)
  merge(
    base,
    (prev?.items ?? []).filter((i) => i.pinned),
    selection.map((i) => ({ ...i, pinned: false })),
  )
}

/** Add to Chat (⌘L): the items stay until removed or sent, and the composer takes the focus. */
export function pinContext(base: Base, items: Item[]) {
  const prev = sameArtifact(useCanvasContext.getState().context, base)
  merge(
    base,
    prev?.items ?? [],
    items.map((i) => ({ ...i, pinned: true })),
  )
  useCanvasContext.setState((s) => ({ focus: s.focus + 1 }))
}

/** The canvas of `artifactId` went away: its unpinned selection goes with it. */
export function dropSelectionContext(artifactId: string) {
  const c = useCanvasContext.getState().context
  if (c?.artifactId !== artifactId) return
  const items = c.items.filter((i) => i.pinned)
  useCanvasContext.setState({ context: items.length ? { ...c, items } : null })
}

export function removeContextItem(key: string) {
  const c = useCanvasContext.getState().context
  if (!c) return
  const items = c.items.filter((i) => i.key !== key)
  useCanvasContext.setState({ context: items.length ? { ...c, items } : null })
}

export const clearContext = () => useCanvasContext.setState({ context: null })

/** A whole screen (not an element of it, not a reference). */
export const isScreenItem = (i: ContextItem) => !i.element && !i.ref

/**
 * SendMessageReq.artifactContext; elements without a source position (scripts made them) are left out. `refs`: the
 * reference files' paths in the version (G04).
 */
export function artifactContextOf(c: CanvasContext): ArtifactContext {
  const screenIds = [...new Set(c.items.filter(isScreenItem).map((i) => i.screenId))]
  const elements = c.items.flatMap((i) => (i.element ? [i.element] : [])).slice(0, 20)
  const refs = c.items.flatMap((i) => (i.ref ? [i.ref.file] : [])).slice(0, 20)
  return {
    artifactId: c.artifactId,
    ...(screenIds.length ? { screenIds } : {}),
    ...(elements.length ? { elements } : {}),
    ...(refs.length ? { refs } : {}),
  }
}

export const screenItem = (id: string, title: string): Item => ({
  key: `screen:${id}`,
  screenId: id,
  screenTitle: title,
})

export const elementItem = (
  screenId: string,
  screenTitle: string,
  el: { file: string; ggId: string; label: string },
): Item => ({ key: `el:${el.file}#${el.ggId}`, screenId, screenTitle, element: el })

export const refItem = (r: Pick<GgArtifactRef, 'id' | 'file' | 'title' | 'kind'>): Item => ({
  key: `ref:${r.id}`,
  screenId: '',
  screenTitle: '',
  ref: { id: r.id, file: r.file, title: r.title, kind: r.kind },
})
