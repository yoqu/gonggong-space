import { type AnnotationDto, type AnnotationStatus, docFileOf } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { Button, IconButton, Textarea } from '../../ui'
import { Markdown } from '../chat/Markdown'
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
      <header className="art-pagedoc__head">
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
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
            const start = { x: e.clientX, y: e.clientY, w: box.width / zoom, h: box.height / zoom }
            const size = (ev: PointerEvent) => ({
              w: Math.round(Math.max(280, edge === 's' ? start.w : start.w + (ev.clientX - start.x) / zoom)),
              h: Math.round(Math.max(240, edge === 'e' ? start.h : start.h + (ev.clientY - start.y) / zoom)),
            })
            const move = (ev: PointerEvent) => onResize(size(ev), false)
            const up = (ev: PointerEvent) => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
              onResize(size(ev), true)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
      ))}
    </section>
  )
}

/**
 * The canvas's 页面文档 layer: which pages show one (a document, annotations, or 编写页面文档 just pressed), their
 * nodes, and the title button that starts one.
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
}) {
  const docs = usePageDocs(o.files, o.readFile)
  const [started, setStarted] = useState<ReadonlySet<string>>(new Set())
  const [sizes, setSizes] = useDocSizes(o.artifactId)
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
  const key = [...shown]
    .sort()
    .map((id) => `${id}=${sizes[id] ? `${sizes[id].w}x${sizes[id].h}` : ''}`)
    .join(',')
  return {
    /** Shows a page's document (empty if it has none yet), as 编写页面文档 does. */
    start: (screenId: string) => setStarted((s) => (s.has(screenId) ? s : new Set(s).add(screenId))),
    /** Stable while the same pages show one at the same sizes, for the layout's memo. */
    pageDocs: useMemoSizes(key),
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
        onResize={(size, done) => setSizes(screenId, size, done)}
      />
    ),
    /** 编写页面文档, right of a page's name, while it has none showing. */
    titleButton: (screenId: string) =>
      o.canEdit && !shown.has(screenId) ? (
        <button
          type="button"
          className="art-title__doc"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setStarted((s) => new Set(s).add(screenId))
            o.reveal(screenId)
          }}
        >
          {t('编写页面文档')}
        </button>
      ) : null,
  }
}

/** Each page doc's size, dragged by its edges (canvas px; absent: the default), kept per artifact on this device. */
function useDocSizes(artifactId: string) {
  const storeKey = `gg.art.docSizes.${artifactId}`
  const [sizes, set] = useState<Record<string, { w: number; h: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, { w: number; h: number }>
    } catch {
      return {}
    }
  })
  const setSize = (id: string, size: { w: number; h: number }, done: boolean) =>
    set((m) => {
      const next = { ...m, [id]: size }
      if (done) localStorage.setItem(storeKey, JSON.stringify(next))
      return next
    })
  return [sizes, setSize] as const
}

function useMemoSizes(key: string) {
  const ref = useRef<{ key: string; map: ReadonlyMap<string, { w: number; h: number } | null> }>({
    key: '',
    map: new Map(),
  })
  if (ref.current.key !== key)
    ref.current = {
      key,
      map: new Map(
        (key ? key.split(',') : []).map((part) => {
          const [id = '', size = ''] = part.split('=')
          const [w, h] = size.split('x').map(Number)
          return [id, size && w && h ? { w, h } : null]
        }),
      ),
    }
  return ref.current.map
}
