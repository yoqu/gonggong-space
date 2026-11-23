import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export type InspectorView = 'group-info' | 'run' | 'thread' | 'threads'

interface InspectorState {
  view: InspectorView | null
  payload: unknown
  /** The view this one was opened from and can return to. */
  back: InspectorView | null
  /** The stable node `<InspectorPortal>` renders into, once an `<InspectorSlot>` has mounted. */
  host: HTMLElement | null
  open: (view: InspectorView, payload?: unknown, back?: InspectorView) => void
  close: () => void
}

interface ScrollAnchor {
  el: HTMLElement
  offset: number
}

interface SavedScroll {
  top: number
  left: number
  width: number
  atBottom: boolean
  anchor: ScrollAnchor | null
}

/** Created once: the same node is re-parented when the rail moves, so the portalled body is never remounted. */
const hostEl = document.createElement('div')
hostEl.className = 'chat__inspector'

const liveScroll = new WeakMap<HTMLElement, SavedScroll>()
const pendingScroll = new Map<HTMLElement, SavedScroll>()
let restoring = false
let restoreFrame = 0

function cancelRestoreFrame() {
  if (!restoreFrame) return
  cancelAnimationFrame(restoreFrame)
  restoreFrame = 0
}

function clearPendingScroll() {
  cancelRestoreFrame()
  pendingScroll.clear()
}

function findAnchor(container: HTMLElement): ScrollAnchor | null {
  const box = container.getBoundingClientRect()
  if (box.height <= 0) return null
  for (const item of container.querySelectorAll<HTMLElement>('[data-msg-id], [data-run-id]')) {
    const rect = item.getBoundingClientRect()
    if (rect.height > 0 && rect.bottom > box.top + 1) {
      return { el: item, offset: rect.top - box.top }
    }
  }
  return null
}

function readScroll(el: HTMLElement): SavedScroll {
  const top = el.scrollTop
  const left = el.scrollLeft
  const atBottom =
    top > 0 && el.scrollHeight > el.clientHeight && el.scrollHeight - top - el.clientHeight <= 2
  const anchor = !atBottom && top > 0 ? findAnchor(el) : null
  return { top, left, width: el.clientWidth, atBottom, anchor }
}

// Track live scroll positions as a fallback in case hostEl is disconnected before a ref cleanup runs.
hostEl.addEventListener(
  'scroll',
  (e) => {
    if (restoring || restoreFrame || !hostEl.isConnected || !(e.target instanceof HTMLElement)) return
    liveScroll.set(e.target, readScroll(e.target))
  },
  { capture: true, passive: true },
)

for (const ev of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
  hostEl.addEventListener(ev, cancelRestoreFrame, { capture: true, passive: true })
}

/**
 * Re-parenting hostEl across layout slots (e.g. closing/opening the workbench) makes browsers reset scrollTop/scrollLeft
 * to 0 on every scrollable descendant; snapshot before detach and restore after re-attach.
 */
function captureScroll() {
  cancelRestoreFrame()
  const nodes = [hostEl, ...hostEl.querySelectorAll<HTMLElement>('*')]
  if (hostEl.isConnected) {
    pendingScroll.clear()
    for (const el of nodes) {
      if (el.scrollTop > 0 || el.scrollLeft > 0) {
        const snap = readScroll(el)
        liveScroll.set(el, snap)
        pendingScroll.set(el, snap)
      } else {
        liveScroll.delete(el)
      }
    }
    return
  }
  if (pendingScroll.size > 0) return
  for (const el of nodes) {
    const saved = liveScroll.get(el)
    if (saved && (saved.top > 0 || saved.left > 0)) pendingScroll.set(el, saved)
  }
}

function applySaved(el: HTMLElement, saved: SavedScroll) {
  if (!hostEl.contains(el)) return
  if (saved.atBottom) {
    el.scrollTop = el.scrollHeight
  } else {
    el.scrollTop = saved.top
    if (
      saved.width > 0 &&
      el.clientWidth > 0 &&
      el.clientWidth !== saved.width &&
      saved.anchor &&
      el.contains(saved.anchor.el)
    ) {
      const box = el.getBoundingClientRect()
      const rect = saved.anchor.el.getBoundingClientRect()
      if (box.height > 0 && rect.height > 0) {
        el.scrollTop += rect.top - box.top - saved.anchor.offset
      }
    }
  }
  el.scrollLeft = saved.left
}

function restoreScroll() {
  if (!pendingScroll.size) return
  const entries = [...pendingScroll.entries()]
  pendingScroll.clear()
  const run = () => {
    restoring = true
    try {
      for (const [el, saved] of entries) applySaved(el, saved)
    } finally {
      restoring = false
    }
  }
  run()
  // Second pass after layout settles (e.g. width reflow or flex height finalized on first paint).
  restoreFrame = requestAnimationFrame(() => {
    restoreFrame = 0
    if (hostEl.isConnected) run()
  })
}

/**
 * Right-hand inspector of the chat window. Whoever opens a view renders its body with `<InspectorPortal>`.
 */
export const useInspector = create<InspectorState>()((set) => ({
  view: null,
  payload: null,
  back: null,
  host: null,
  open: (view, payload = null, back) => {
    clearPendingScroll()
    set({ view, payload, back: back ?? null })
  },
  close: () => {
    clearPendingScroll()
    set({ view: null, payload: null, back: null })
  },
}))

const attachHost = (slot: HTMLElement | null) => {
  if (!slot) return
  if (hostEl.parentElement !== slot) {
    captureScroll()
    slot.appendChild(hostEl)
    restoreScroll()
  }
  if (useInspector.getState().host !== hostEl) useInspector.setState({ host: hostEl })
  return () => {
    // Only snapshot if this slot still owns hostEl (unmounting before the next slot mounts).
    if (hostEl.parentElement === slot) captureScroll()
  }
}

/** The rail's body: wherever the layout renders it, it holds the one stable inspector host. */
export function InspectorSlot() {
  return <div ref={attachHost} className="chat__inspector-slot" />
}

/** Renders `children` into the inspector while `view` is the open one. */
export function InspectorPortal({ view, children }: { view: InspectorView; children: ReactNode }) {
  const open = useInspector((s) => s.view === view)
  const host = useInspector((s) => s.host)
  return open && host ? createPortal(children, host) : null
}
