import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { Checkbox, IconButton, SegmentedControl } from '../../ui'
import { SPLIT_MIN_PX } from './DiffParts'
import { type DiffViewMode, useDiffSettings } from './store'
import { useWide } from './useWide'

interface Span {
  top: number
  bottom: number
}

/**
 * The change to move to: the neighbour of `current` while that one is on screen, otherwise the first change from the
 * top of the view down (or the last one above it); -1 past either end.
 */
export function changeTarget(blocks: Span[], view: Span, current: number, dir: 1 | -1) {
  const at = blocks[current]
  if (at && at.bottom >= view.top && at.top <= view.bottom) return blocks[current + dir] ? current + dir : -1
  return dir > 0
    ? blocks.findIndex((b) => b.top >= view.top - 1)
    : blocks.findLastIndex((b) => b.top < view.top - 1)
}

/** Room kept above a change too tall to centre, clear of the sticky toolbar. */
const TOP_GAP = 48
/** How long 「已是最后一处改动」 waits for the key again. */
const HINT_MS = 3000

/** The nearest ancestor scrolling vertically; null when it is the page. */
function scroller(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement)
    if (p.scrollHeight > p.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  return null
}

const changesIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-change]')]

/** Marks the change at `i` as the current one, centred in its scroll box and flashed. */
function show(blocks: HTMLElement[], i: number) {
  const target = blocks[i]
  if (!target) return
  const box = scroller(target)
  const view = box?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
  const r = target.getBoundingClientRect()
  const page = box ?? document.scrollingElement
  if (page) page.scrollTop += r.top - view.top - Math.max(TOP_GAP, (view.bottom - view.top - r.height) / 2)
  for (const b of blocks) {
    b.removeAttribute('data-current')
    b.removeAttribute('data-flash')
  }
  target.setAttribute('data-current', '')
  target.setAttribute('data-flash', '')
  target.addEventListener('animationend', () => target.removeAttribute('data-flash'), { once: true })
}

/** Keys typed into a field stay there. */
const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  ((el instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(el.type)) ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    !!el.closest('[contenteditable]:not([contenteditable="false"])'))

/** The neighbouring files of a diff among several; each lands on its first (1) or last (-1) change. */
export interface FileSteps {
  prev?: (land: 1 | -1) => void
  next?: (land: 1 | -1) => void
}

/**
 * IDEA-style controls over the diff in `target`: unified or side by side, whitespace and whole file (`reread`: the
 * diff can be read again with them), stepping through its changes (F7 / ⇧F7) and, given `files`, on to the next or
 * previous file (⌥⇧→ / ⌥⇧←, or F7 again past the last change), and F4 to open the new version at the current change.
 * Keys work while the diff is shown and nothing is typed. Once `content` (the diff shown) arrives, `start` steps onto
 * its first (1) or last (-1) change. The caller's `actions` sit at the right end.
 */
export function DiffToolbar({
  target,
  actions,
  reread = true,
  files,
  onOpenLine,
  start,
  content,
}: {
  target: RefObject<HTMLElement | null>
  actions?: ReactNode
  reread?: boolean
  files?: FileSteps
  onOpenLine?: (line: number) => void
  start?: 1 | -1
  content?: unknown
}) {
  const { view, ignoreWhitespace, fullContext, set } = useDiffSettings()
  const root = useRef<HTMLDivElement>(null)
  const roomy = useWide(root, SPLIT_MIN_PX)
  const current = useRef(-1)
  // Past an end: the key pressed again goes on to the neighbouring file.
  const [edge, setEdge] = useState<1 | -1 | null>(null)
  const go = (dir: 1 | -1) => {
    const blocks = target.current ? changesIn(target.current) : []
    const first = blocks[0]
    const port = (first && scroller(first)?.getBoundingClientRect()) || { top: 0, bottom: window.innerHeight }
    const i = first
      ? changeTarget(
          blocks.map((b) => b.getBoundingClientRect()),
          port,
          current.current,
          dir,
        )
      : -1
    if (i >= 0) {
      current.current = i
      show(blocks, i)
      setEdge(null)
      return
    }
    const step = dir > 0 ? files?.next : files?.prev
    if (step && edge === dir) {
      setEdge(null)
      step(dir)
    } else setEdge(dir)
  }
  const openLine = () => {
    const blocks = target.current ? changesIn(target.current) : []
    onOpenLine?.(Number((blocks[current.current] ?? blocks[0])?.dataset.line ?? 1))
  }

  useEffect(() => {
    if (!edge) return
    const timer = setTimeout(() => setEdge(null), HINT_MS)
    return () => clearTimeout(timer)
  }, [edge])

  const pending = useRef(start)
  // New content is a new diff to step through.
  useLayoutEffect(() => {
    const el = target.current
    if (!el) return
    current.current = -1
    const blocks = changesIn(el)
    for (const b of blocks) b.removeAttribute('data-current')
    if (!pending.current || content == null) return
    const i = pending.current > 0 ? 0 : blocks.length - 1
    pending.current = undefined
    if (i < 0) return
    current.current = i
    show(blocks, i)
  }, [content, target])

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching views draws the changes anew, unmarked
  useLayoutEffect(() => {
    const el = target.current
    if (el) changesIn(el)[current.current]?.setAttribute('data-current', '')
  }, [view, target])

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    const el = target.current
    if (e.defaultPrevented || !el || el.closest('[hidden]') || typing(e.target)) return
    // Focus in another diff or a dialog keeps the keys there.
    const owner = e.target instanceof Element ? e.target.closest('.git-diff, [role="dialog"]') : null
    if (owner && !owner.contains(el)) return
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey
    // ⌥← / ⌥→ alone would be the browser's back and forward on Windows and Linux.
    const altShift = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey
    if (e.key === 'F7' && plain) go(e.shiftKey ? -1 : 1)
    else if (e.key === 'F4' && plain && !e.shiftKey && onOpenLine) openLine()
    else if (altShift && files && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      (e.key === 'ArrowLeft' ? files.prev : files.next)?.(1)
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const hint =
    edge === 1
      ? files?.next
        ? t('已是最后一处改动，再按 F7 转到下一个文件')
        : t('已是最后一处改动')
      : edge === -1
        ? files?.prev
          ? t('已是第一处改动，再按 ⇧F7 转到上一个文件')
          : t('已是第一处改动')
        : null
  const views: { value: DiffViewMode; label: string; disabled?: boolean }[] = [
    { value: 'unified', label: t('统一') },
    { value: 'split', label: t('并排'), disabled: !roomy },
  ]
  return (
    <div ref={root} className="diff-toolbar">
      <SegmentedControl
        size="small"
        aria-label={t('差异视图')}
        items={views}
        value={roomy ? view : 'unified'}
        onChange={(v) => set({ view: v })}
      />
      {reread ? (
        <>
          <Checkbox
            label={t('忽略空白')}
            checked={ignoreWhitespace}
            onChange={(on) => set({ ignoreWhitespace: on })}
          />
          <Checkbox
            label={t('显示完整文件')}
            checked={fullContext}
            onChange={(on) => set({ fullContext: on })}
          />
        </>
      ) : null}
      <span className="diff-toolbar__end">
        {hint ? (
          <span className="diff-toolbar__hint" role="status">
            {hint}
          </span>
        ) : null}
        <IconButton
          size="small"
          title={`${t('上一处改动')} (⇧F7)`}
          aria-label={t('上一处改动')}
          onClick={() => go(-1)}
        >
          {'arrow-up' as const}
        </IconButton>
        <IconButton
          size="small"
          title={`${t('下一处改动')} (F7)`}
          aria-label={t('下一处改动')}
          onClick={() => go(1)}
        >
          {'arrow-down' as const}
        </IconButton>
        {files ? (
          <>
            <IconButton
              size="small"
              title={`${t('上一个文件')} (⌥⇧←)`}
              aria-label={t('上一个文件')}
              disabled={!files.prev}
              onClick={() => files.prev?.(1)}
            >
              {'chevron-left' as const}
            </IconButton>
            <IconButton
              size="small"
              title={`${t('下一个文件')} (⌥⇧→)`}
              aria-label={t('下一个文件')}
              disabled={!files.next}
              onClick={() => files.next?.(1)}
            >
              {'chevron-right' as const}
            </IconButton>
          </>
        ) : null}
        {onOpenLine ? (
          <IconButton
            size="small"
            title={`${t('跳到源文件')} (F4)`}
            aria-label={t('跳到源文件')}
            onClick={openLine}
          >
            {'external' as const}
          </IconButton>
        ) : null}
        {actions}
      </span>
    </div>
  )
}
