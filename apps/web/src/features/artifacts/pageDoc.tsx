import { type AnnotationDto, type AnnotationStatus, docFileOf } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, IconButton, Textarea } from '../../ui'
import { Markdown } from '../chat/Markdown'
import type { PageDocBox } from './geometry'
import { type PageRulesProps, PageRulesSection } from './pageRules'

/** Every page's document (docs/<id>.md) of the shown version, read once per version. */
export function usePageDocs(
  files: { path: string; hash: string }[] | null,
  readFile: (path: string) => Promise<string>,
) {
  const [docs, setDocs] = useState<Record<string, string>>({})
  const read = useRef(readFile)
  read.current = readFile
  const key = (files ?? [])
    .filter((f) => /^docs\/[a-z0-9-]+\.md$/.test(f.path))
    .map((f) => `${f.path}:${f.hash}`)
    .join('|')
  useEffect(() => {
    let live = true
    const paths = key ? key.split('|').map((x) => x.slice(0, x.lastIndexOf(':'))) : []
    void Promise.all(
      paths.map(
        async (p) => [p.slice('docs/'.length, -'.md'.length), await read.current(p).catch(() => '')] as const,
      ),
    ).then((pairs) => live && setDocs(Object.fromEntries(pairs)))
    return () => {
      live = false
    }
  }, [key])
  return docs
}

const STATUS: Record<AnnotationStatus, string> = {
  open: t('待处理'),
  sent: t('已交给 AI'),
  resolved: t('已解决'),
}

/**
 * 页面文档 (蒋庆 2026-11-27): the PRD written beside a page on the canvas, Markdown typed by people or the AI (AI 帮我写),
 * and under it the page's annotations — kept where the 批注 panel showed them before, now with the page.
 */
export function PageDocNode({
  screenId,
  title,
  md,
  start,
  canEdit,
  notes,
  version,
  ai,
  onSave,
  onAi,
  onStatus,
  onDelete,
  onSendNotes,
  onFocusNote,
  rules,
  zoom,
  onResize,
  onMove,
}: {
  screenId: string
  title: string
  md: string
  /** Opened just now by 编写页面文档: straight into typing. */
  start: boolean
  canEdit: boolean
  notes: AnnotationDto[]
  version: string
  /** Why the AI cannot help now (no bot, offline…); null when it can. */
  ai: string | null
  onSave: (md: string) => Promise<boolean>
  onAi: () => void
  onStatus: (id: string, status: AnnotationStatus) => void
  onDelete: (id: string) => void
  onSendNotes: (ids: string[]) => void
  onFocusNote: (note: AnnotationDto) => void
  /** The page's rules (numbered as its marks); absent without the rules layer. */
  rules?: PageRulesProps
  /** The canvas's zoom: a drag of the edges is that many times its size on the canvas. */
  zoom: number
  /** Dragged to this size (canvas px), as it goes; `done` on letting go. */
  onResize: (size: { w: number; h: number }, done: boolean) => void
  /** Dragged by its header this far (canvas px) from where it started, as it goes; `done` on letting go. */
  onMove: (by: { dx: number; dy: number }, done: boolean) => void
}) {
  const me = useSession((s) => s.user?.id ?? null)
  /** A note's 删除 asks once more, in place. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState(start && canEdit && !md)
  const [draft, setDraft] = useState(md)
  useEffect(() => {
    if (!editing) setDraft(md)
  }, [md, editing])
  const done = async () => {
    setEditing(false)
    if (draft !== md) await onSave(draft)
  }
  const open = notes.filter((n) => n.status === 'open')
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keeps the canvas from panning or zooming while reading or typing
    <section
      className="art-pagedoc"
      aria-label={t('页面文档 · {title}', { title })}
      data-testid={`art-pagedoc-${screenId}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header
        className="art-pagedoc__head"
        data-testid={`art-pagedoc-move-${screenId}`}
        title={t('拖动标题栏移动文档')}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
          e.preventDefault()
          // Captured: the drag goes on over a page's frame too.
          e.currentTarget.setPointerCapture?.(e.pointerId)
          const from = { x: e.clientX, y: e.clientY }
          const by = (ev: PointerEvent) => ({
            dx: Math.round((ev.clientX - from.x) / zoom),
            dy: Math.round((ev.clientY - from.y) / zoom),
          })
          dragWith(
            (ev) => onMove(by(ev), false),
            (ev) => onMove(by(ev), true),
          )
        }}
      >
        <strong>{t('页面文档')}</strong>
        <span className="art-pagedoc__file">{docFileOf(screenId)}</span>
        {canEdit && !editing ? (
          <>
            <Button
              size="small"
              variant="plain"
              icon="sparkle"
              disabled={!!ai}
              title={ai ?? undefined}
              onClick={onAi}
            >
              {t('AI 帮我写')}
            </Button>
            <IconButton size="small" title={t('编辑文档')} onClick={() => setEditing(true)}>
              {'pencil' as const}
            </IconButton>
          </>
        ) : null}
        {editing ? (
          <Button size="small" variant="primary" onClick={() => void done()}>
            {t('完成')}
          </Button>
        ) : null}
      </header>
      <div className="art-pagedoc__body">
        {editing ? (
          <Textarea
            aria-label={t('页面文档')}
            className="art-pagedoc__input"
            value={draft}
            rows={16}
            maxLength={100_000}
            // biome-ignore lint/a11y/noAutofocus: opened on purpose to type the document
            autoFocus
            placeholder={t('用 Markdown 写：页面目标、内容与模块、交互说明、异常与边界')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void done()}
          />
        ) : md.trim() ? (
          <Markdown text={md} />
        ) : (
          <p className="art-pagedoc__empty">
            {canEdit ? t('还没有文档。点右上角铅笔开始写，或让 AI 帮你写') : t('还没有文档')}
          </p>
        )}
        {rules ? <PageRulesSection rules={rules} canEdit={canEdit} /> : null}
        {notes.length ? (
          <section className="art-pagedoc__notes" aria-label={t('批注')}>
            <header>
              <h4>{t('批注（{n}）', { n: notes.length })}</h4>
              {canEdit && open.length ? (
                <Button
                  size="small"
                  variant="plain"
                  icon="sparkle"
                  disabled={!!ai}
                  title={ai ?? undefined}
                  onClick={() => onSendNotes(open.map((n) => n.id))}
                >
                  {t('交给 AI 处理')}
                </Button>
              ) : null}
            </header>
            <ol>
              {notes.map((n) => (
                <li
                  key={n.id}
                  className={cx('art-pagedoc__note', n.status === 'resolved' && 'art-pagedoc__note--done')}
                >
                  <button type="button" className="art-pagedoc__note-text" onClick={() => onFocusNote(n)}>
                    {n.note}
                  </button>
                  <span className="art-pagedoc__meta">
                    {n.authorName} · {STATUS[n.status]}
                    {n.versionId !== version ? ` · ${t('旧版本上的')}` : ''}
                  </span>
                  {canEdit ? (
                    <span className="art-pagedoc__acts">
                      {n.status === 'resolved' ? (
                        <Button size="small" variant="plain" onClick={() => onStatus(n.id, 'open')}>
                          {t('重新打开')}
                        </Button>
                      ) : (
                        <Button size="small" variant="plain" onClick={() => onStatus(n.id, 'resolved')}>
                          {t('标为已解决')}
                        </Button>
                      )}
                      {n.authorId === me ? (
                        confirming === n.id ? (
                          <Button size="small" variant="plain" onClick={() => onDelete(n.id)}>
                            {t('确认删除')}
                          </Button>
                        ) : (
                          <IconButton size="small" title={t('删除')} onClick={() => setConfirming(n.id)}>
                            {'trash' as const}
                          </IconButton>
                        )
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
      {(['e', 's', 'se'] as const).map((edge) => (
        <span
          key={edge}
          className={`art-pagedoc__grip art-pagedoc__grip--${edge}`}
          data-testid={`art-pagedoc-grip-${edge}`}
          aria-hidden="true"
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            e.currentTarget.setPointerCapture?.(e.pointerId)
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            const start = { x: e.clientX, y: e.clientY, w: box.width / zoom, h: box.height / zoom }
            const size = (ev: PointerEvent) => ({
              w: Math.round(Math.max(280, edge === 's' ? start.w : start.w + (ev.clientX - start.x) / zoom)),
              h: Math.round(Math.max(240, edge === 'e' ? start.h : start.h + (ev.clientY - start.y) / zoom)),
            })
            dragWith(
              (ev) => onResize(size(ev), false),
              (ev) => onResize(size(ev), true),
            )
          }}
        />
      ))}
    </section>
  )
}

/** Follows a drag on the window until the pointer is let go. */
function dragWith(move: (e: PointerEvent) => void, end: (e: PointerEvent) => void) {
  const up = (e: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    end(e)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/**
 * The canvas's 页面文档 layer: which pages show one (a document, annotations, or 编写页面文档 just pressed), their
 * nodes, and the title button that starts one. Only a page shown alone has its document beside it: 全部页面 is the UI
 * at a glance (蒋庆 2026-11-27), its title button opens the page alone with its document.
 */
export function usePageDocLayer(o: {
  files: { path: string; hash: string }[] | null
  readFile: (path: string) => Promise<string>
  screens: { id: string; file: string }[]
  notes: AnnotationDto[]
  /** The shown version: notes made on another one say so. */
  version: string
  canEdit: boolean
  ai: string | null
  save: (screenId: string, md: string) => Promise<boolean>
  write: (screenId: string) => void
  setStatus: (id: string, status: AnnotationStatus) => void
  remove: (id: string) => void
  send: (ids: string[]) => void
  focus: (note: AnnotationDto) => void
  /** Brings a page and its new document into view, once laid out. */
  reveal: (screenId: string) => void
  /** A page's rules, for its document; pages with rules show one. */
  rulesOf: (screenId: string) => PageRulesProps
  artifactId: string
  zoom: number
  /** One page is shown alone: the documents show beside it; else none do. */
  alone: boolean
  /** Shows a page alone (from 全部页面), to see its document. */
  openAlone: (screenId: string) => void
}) {
  const docs = usePageDocs(o.files, o.readFile)
  const [started, setStarted] = useState<ReadonlySet<string>>(new Set())
  const [boxes, setBox] = useDocBoxes(o.artifactId)
  /** A header drag's box when it started: its moves add to that. */
  const moveFrom = useRef(new Map<string, PageDocBox>())
  const shown = new Set(
    o.screens
      .filter(
        (s) =>
          docs[s.id] !== undefined ||
          started.has(s.id) ||
          !!o.rulesOf(s.id).page ||
          o.notes.some((n) => n.file === s.file),
      )
      .map((s) => s.id),
  )
  const key = o.alone ? JSON.stringify([...shown].sort().map((id) => [id, boxes[id] ?? {}])) : '[]'
  const show = (screenId: string) => {
    setStarted((s) => (s.has(screenId) ? s : new Set(s).add(screenId)))
    if (!o.alone) o.openAlone(screenId)
    o.reveal(screenId)
  }
  return {
    /** Shows a page's document (empty if it has none yet) and brings it into view, as 编写页面文档 does. */
    start: show,
    /** Stable while the same pages show one in the same boxes, for the layout's memo. */
    pageDocs: useMemoBoxes(key),
    node: (screenId: string, title: string, file: string) => (
      <PageDocNode
        screenId={screenId}
        title={title}
        md={docs[screenId] ?? ''}
        start={started.has(screenId)}
        canEdit={o.canEdit}
        notes={o.notes.filter((n) => n.file === file)}
        version={o.version}
        ai={o.ai}
        onSave={(md) => o.save(screenId, md)}
        onAi={() => o.write(screenId)}
        onStatus={o.setStatus}
        onDelete={o.remove}
        onSendNotes={o.send}
        onFocusNote={o.focus}
        rules={o.rulesOf(screenId)}
        zoom={o.zoom}
        onResize={(size, done) => setBox(screenId, size, done)}
        onMove={(by, done) => {
          const at = moveFrom.current.get(screenId) ?? boxes[screenId] ?? {}
          moveFrom.current.set(screenId, at)
          if (done) moveFrom.current.delete(screenId)
          setBox(screenId, { dx: (at.dx ?? 0) + by.dx, dy: (at.dy ?? 0) + by.dy }, done)
        }}
      />
    ),
    /** 编写页面文档 (查看页面文档 in 全部页面 when it has one), right of a page's name, while none shows beside it. */
    titleButton: (screenId: string) =>
      (o.alone ? o.canEdit && !shown.has(screenId) : o.canEdit || shown.has(screenId)) ? (
        <button
          type="button"
          className="art-title__doc"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            show(screenId)
          }}
        >
          {shown.has(screenId) ? t('查看页面文档') : t('编写页面文档')}
        </button>
      ) : null,
  }
}

/**
 * Each page doc's box: its size dragged by its edges and its offset dragged by its header (canvas px; absent: the
 * default), kept per artifact on this device.
 */
function useDocBoxes(artifactId: string) {
  const storeKey = `gg.art.docSizes.${artifactId}`
  const [boxes, set] = useState<Record<string, PageDocBox>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, PageDocBox>
    } catch {
      return {}
    }
  })
  const setBox = (id: string, change: PageDocBox, done: boolean) =>
    set((m) => {
      const next = { ...m, [id]: { ...m[id], ...change } }
      if (done) localStorage.setItem(storeKey, JSON.stringify(next))
      return next
    })
  return [boxes, setBox] as const
}

function useMemoBoxes(key: string) {
  const ref = useRef<{ key: string; map: ReadonlyMap<string, PageDocBox> }>({ key: '[]', map: new Map() })
  if (ref.current.key !== key) ref.current = { key, map: new Map(JSON.parse(key) as [string, PageDocBox][]) }
  return ref.current.map
}
