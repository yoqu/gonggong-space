import {
  ARTIFACT_PAGE_GROUP_DEPTH,
  type ArtifactEditOp,
  type GgArtifactManifest,
  type GgArtifactScreen,
} from '@gonggong/protocol'
import {
  type DragEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { ConfirmActionDialog, Icon, MenuButton, type MenuItem, Presence, usePresenceOpen } from '../../ui'
import { CanvasChat } from './CanvasChat'
import { CommandLog } from './CommandLog'
import { setArtifactPage, setCanvasScreen, useArtifactPage, useCanvasScreen } from './page'
import {
  addGroup,
  canNest,
  canNestScreen,
  deleteGroup,
  flatGroups,
  groupDepth,
  indentScreen,
  insertGroup,
  moveGroup,
  moveScreen,
  newGroupId,
  outdentScreen,
  type PageGroupNode,
  type PagesOp,
  pageTree,
  renameGroup,
  shiftGroup,
  shiftScreen,
  subpages,
} from './pageTree'
import { focusArtifact } from './store'
import './rail.css'

const OPEN_KEY = 'gg.art.rail'
const SPLIT_KEY = 'gg.art.railSplit'
/** Below this tab width the rail is a drawer over the canvas, closed until asked for. */
const NARROW_PX = 720
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.85
const WIDTH_KEY = 'gg.art.railWidth'
const WIDTH_MIN = 180
const WIDTH_MAX = 480
const WIDTH_DEFAULT = 248

const LOG_KEY = 'gg.art.railLog'
/** The rail's lower half: the 画布 AI 对话, or the command log (everything sent about the artifact, group included). */
const LOG_TABS = ['chat', 'log'] as const
type LogTab = (typeof LOG_TABS)[number]

const clampWidth = (w: number) => Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, w)))
const readWidth = () => {
  const v = Number(localStorage.getItem(WIDTH_KEY))
  return v >= WIDTH_MIN && v <= WIDTH_MAX ? v : WIDTH_DEFAULT
}

const readSplit = () => {
  const v = Number(localStorage.getItem(SPLIT_KEY))
  return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : 2 / 3
}

/**
 * Whether the rail shows: remembered on wide tabs (open by default); a drawer on narrow ones that starts closed.
 * `ref` goes on the element holding the rail and the canvas.
 */
export function useRail() {
  const [narrow, setNarrow] = useState(false)
  const [wide, setWide] = useState(() => localStorage.getItem(OPEN_KEY) !== '0')
  const [drawer, setDrawer] = useState(false)
  /** Opened or closed by hand: only then does the rail ease in (not when the tab opens with it). */
  const [toggled, setToggled] = useState(false)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? NARROW_PX) < NARROW_PX))
    observer.current.observe(el)
  }, [])
  const open = narrow ? drawer : wide
  const setOpen = (v: boolean) => {
    setToggled(true)
    if (narrow) return setDrawer(v)
    setWide(v)
    localStorage.setItem(OPEN_KEY, v ? '1' : '0')
  }
  return { ref, narrow, open, setOpen, toggled }
}

/** Follows a pointer drag from `e` until release, then calls `done`. */
function drag(e: PointerEvent<HTMLElement>, move: (ev: globalThis.PointerEvent) => void, done: () => void) {
  e.preventDefault()
  e.currentTarget.setPointerCapture(e.pointerId)
  const up = () => {
    done()
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** Menus stay narrow enough to open inside the rail's side of the tab. */
const clip = (title: string) => (title.length > 14 ? `${title.slice(0, 13)}…` : title)

/** What is being renamed or created inline. */
type Editing =
  | { kind: 'screen'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'new'; parent: string | undefined; beside?: { id: string; place: 'above' | 'below' } }
  | null
/** What is being dragged. */
type Dragged = { kind: 'screen' | 'group'; id: string } | null

/**
 * The canvas's left rail: the pages above (文件夹, nested; each shows only its screens, 全部页面 shows them all), the
 * AI chat and command log below, split 2:1 by default and draggable.
 */
export function PageRail({
  artifactId,
  groupId,
  manifest,
  empty = false,
  readOnly,
  canEdit,
  narrow = false,
  refreshKey,
  onEdit,
  onClose,
  versionId,
  onPicked,
}: {
  artifactId: string
  groupId: string
  manifest: GgArtifactManifest | null
  /** Before the first version exists: shows empty creation hint instead of single-page note. */
  empty?: boolean
  readOnly: boolean
  /** A group member (not a visitor): may edit and read the command log. */
  canEdit: boolean
  /** Narrow drawer over the canvas: caps width, omits edge resize, closes on Escape. */
  narrow?: boolean
  refreshKey: string
  onEdit: (ops: ArtifactEditOp[]) => Promise<unknown>
  onClose: () => void
  /** The past version shown (null: the head): picking a page stays on it. */
  versionId: string | null
  /** A page was picked (the narrow drawer closes). */
  onPicked: () => void
}) {
  const [split, setSplit] = useState(readSplit)
  const [log, setLog] = useState<LogTab>(() => (localStorage.getItem(LOG_KEY) === 'log' ? 'log' : 'chat'))
  const pickLog = (k: LogTab) => {
    setLog(k)
    localStorage.setItem(LOG_KEY, k)
  }
  const [width, setWidth] = useState(readWidth)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!narrow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, onClose])
  const resize = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let last = split
    drag(
      e,
      (ev) => {
        last = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (ev.clientY - rect.top) / rect.height))
        setSplit(last)
      },
      () => localStorage.setItem(SPLIT_KEY, String(last)),
    )
  }
  const resizeWidth = (e: PointerEvent<HTMLDivElement>) => {
    const x0 = e.clientX
    const w0 = width
    let last = width
    drag(
      e,
      (ev) => {
        last = clampWidth(w0 + ev.clientX - x0)
        setWidth(last)
      },
      () => localStorage.setItem(WIDTH_KEY, String(last)),
    )
  }

  return (
    <aside
      className="art-rail"
      aria-label={t('页面与命令')}
      data-testid="art-rail"
      ref={box}
      style={narrow ? undefined : { width }}
    >
      {narrow ? null : (
        /* biome-ignore lint/a11y/useSemanticElements: a draggable splitter, not a static rule */
        <div
          className="art-rail__edge"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('调整宽度')}
          aria-valuenow={width}
          tabIndex={-1}
          onPointerDown={resizeWidth}
        />
      )}
      <section className="art-rail__pages" style={{ flexBasis: canEdit ? `${split * 100}%` : '100%' }}>
        <Pages
          artifactId={artifactId}
          manifest={manifest}
          empty={empty}
          readOnly={readOnly || !canEdit}
          onEdit={onEdit}
          onClose={onClose}
          versionId={versionId}
          onPicked={onPicked}
        />
      </section>
      {canEdit ? (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: a draggable splitter, not a static rule */}
          <div
            className="art-rail__split"
            role="separator"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(split * 100)}
            tabIndex={-1}
            onPointerDown={resize}
          />
          <section className="art-rail__log">
            <div className="art-rail__tabs" role="tablist">
              {LOG_TABS.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={log === k}
                  className={cx('art-rail__tab', log === k && 'is-current')}
                  onClick={() => pickLog(k)}
                >
                  {k === 'chat' ? t('AI 对话') : t('命令记录')}
                </button>
              ))}
            </div>
            {log === 'chat' ? (
              <CanvasChat artifactId={artifactId} groupId={groupId} />
            ) : (
              <div className="art-rail__scroll ui-panel-swap">
                <CommandLog artifactId={artifactId} groupId={groupId} refreshKey={refreshKey} />
              </div>
            )}
          </section>
        </>
      ) : null}
    </aside>
  )
}

function Pages({
  artifactId,
  manifest: m,
  empty,
  readOnly,
  onEdit,
  onClose,
  versionId,
  onPicked,
}: {
  artifactId: string
  manifest: GgArtifactManifest | null
  empty?: boolean
  readOnly: boolean
  onEdit: (ops: ArtifactEditOp[]) => Promise<unknown>
  onClose: () => void
  versionId: string | null
  onPicked: () => void
}) {
  const [editing, setEditing] = useState<Editing>(null)
  const [dragged, setDragged] = useState<Dragged>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<GgArtifactScreen | null>(null)
  /** Pages whose subpages are folded away. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const current = useCanvasScreen(artifactId)
  const asked = useArtifactPage(artifactId)
  const page = m?.groups?.some((g) => g.id === asked) || m?.screens.some((s) => s.id === asked) ? asked : null
  const show = (id: string | null) => {
    setArtifactPage(artifactId, id)
    onPicked()
  }

  const header = (
    <div className="art-rail__head">
      <h3 className="art-rail__title">{t('页面')}</h3>
      {m && !readOnly ? (
        <button
          type="button"
          className="art-rail__icon"
          aria-label={t('新建文件夹')}
          title={t('新建文件夹')}
          onClick={() => setEditing({ kind: 'new', parent: undefined })}
        >
          <Icon name="folder-plus" size={14} />
        </button>
      ) : null}
      <button
        type="button"
        className="art-rail__icon"
        aria-label={t('收起侧栏')}
        title={t('收起侧栏')}
        onClick={onClose}
      >
        <Icon name="sidebar" size={14} />
      </button>
    </div>
  )
  if (!m)
    return (
      <>
        {header}
        <p className="art-log__empty">
          {empty ? t('还没有页面，生成第一版后会列在这里') : t('单页产物，没有页面列表')}
        </p>
      </>
    )

  const tree = pageTree(m)
  const groups = flatGroups(tree)
  const save = async (op: PagesOp | ArtifactEditOp | null) => {
    if (!op) return false
    setBusy(true)
    const ok = await attempt(() => onEdit([op]))
    setBusy(false)
    return ok
  }
  const commit = (title: string) => {
    const e = editing
    setEditing(null)
    const v = title.trim()
    if (!e || !v) return
    if (e.kind === 'new') {
      const id = newGroupId(m)
      const title = v.slice(0, 40)
      // A new page opens at once: it starts empty, for AI to fill or screens to be dragged in.
      void save(
        e.beside ? insertGroup(m, title, e.beside.id, e.beside.place) : addGroup(m, title, e.parent),
      ).then((ok) => ok && setArtifactPage(artifactId, id))
    } else if (e.kind === 'group') {
      if (m.groups?.find((g) => g.id === e.id)?.title !== v) void save(renameGroup(m, e.id, v.slice(0, 40)))
    } else if (m.screens.find((s) => s.id === e.id)?.title !== v)
      void save({ kind: 'manifest', op: 'rename', screenId: e.id, title: v.slice(0, 80) })
  }
  const edit = !readOnly && !busy

  const drop = (target: {
    group: string | undefined
    before?: string
    into?: string
    beside?: { id: string; place: 'above' | 'below' }
  }) => {
    const d = dragged
    setDragged(null)
    setOver(null)
    if (!d || !edit) return
    if (d.kind === 'screen') void save(moveScreen(m, d.id, target.into ?? target.group, target.before))
    else if (target.beside) void save(besideGroup(d.id, target.beside.id, target.beside.place))
    else void save(moveGroup(m, d.id, target.into ?? target.group))
  }
  /** Drops the page `id` just above or below the page `other`, among its siblings. */
  const besideGroup = (id: string, other: string, place: 'above' | 'below') => {
    const parent = m.groups?.find((g) => g.id === other)?.parent
    const siblings = (m.groups ?? []).filter((g) => g.parent === parent && g.id !== id).map((g) => g.id)
    const before = place === 'above' ? other : siblings[siblings.indexOf(other) + 1]
    return moveGroup(m, id, parent, before)
  }
  /**
   * A page dropped on another page: on its top or bottom quarter beside it (same folder, same parent page), on its
   * middle under it as its last subpage.
   */
  const screenTarget = (s: GgArtifactScreen, edge: 'above' | 'below' | null) => {
    const d = dragged?.id
    if (!d) return null
    if (!edge) return moveScreen(m, d, undefined, undefined, s.id)
    const siblings = m.screens.filter((x) => x.group === s.group && x.parent === s.parent && x.id !== d)
    const before = edge === 'above' ? s.id : siblings[siblings.findIndex((x) => x.id === s.id) + 1]?.id
    return moveScreen(m, d, s.group, before, s.parent)
  }
  const screenDropProps = (s: GgArtifactScreen) => {
    const key = `s:${s.id}`
    return edit && dragged?.kind === 'screen' && dragged.id !== s.id
      ? {
          onDragOver: (e: DragEvent) => {
            const edge = edgeOf(e)
            if (!edge && !canNestScreen(m, dragged.id, s.id)) return
            e.preventDefault()
            e.stopPropagation()
            setOver(edge ? `${key}:${edge}` : key)
          },
          onDragLeave: () => setOver((o) => (o === key || o?.startsWith(`${key}:`) ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            const edge = edgeOf(e)
            const next = screenTarget(s, edge)
            setDragged(null)
            setOver(null)
            if (!edge && next) {
              setFolded((f) => {
                if (!f.has(s.id)) return f
                const u = new Set(f)
                u.delete(s.id)
                return u
              })
            }
            void save(next)
          },
        }
      : {}
  }
  /** A page dragged over another page's top or bottom quarter goes beside it; over its middle, into it. */
  const edgeOf = (e: DragEvent): 'above' | 'below' | null => {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.height) return null
    const y = (e.clientY - r.top) / r.height
    return y < 0.25 ? 'above' : y > 0.75 ? 'below' : null
  }
  const dropProps = (key: string, target: Parameters<typeof drop>[0]) =>
    edit && dragged
      ? {
          onDragOver: (e: DragEvent) => {
            const edge = dragged.kind === 'group' && target.into ? edgeOf(e) : null
            const into = edge ? target.group : (target.into ?? target.group)
            if (dragged.kind === 'group' && (target.before || !canNest(m, dragged.id, into))) return
            e.preventDefault()
            e.stopPropagation()
            setOver(edge ? `${key}:${edge}` : key)
          },
          onDragLeave: () => setOver((o) => (o === key || o?.startsWith(`${key}:`) ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            const edge = dragged.kind === 'group' && target.into ? edgeOf(e) : null
            drop(
              edge && target.into
                ? { group: target.group, beside: { id: target.into, place: edge } }
                : target,
            )
          },
        }
      : {}
  const dragProps = (kind: 'screen' | 'group', id: string) =>
    edit
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', id)
            setDragged({ kind, id })
          },
          onDragEnd: () => {
            setDragged(null)
            setOver(null)
          },
        }
      : {}

  const nameInput = (initial: string, label: string) => (
    <input
      className="art-rail__input"
      aria-label={label}
      defaultValue={initial}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: an inline rename starts typing at once
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229)
          e.currentTarget.blur()
        else if (e.key === 'Escape') {
          e.stopPropagation()
          setEditing(null)
        }
      }}
    />
  )

  const screenRow = (s: GgArtifactScreen, depth: number): ReactElement[] => {
    const kids = subpages(m, s.id)
    const open = !folded.has(s.id)
    const moveItems: MenuItem[] = [
      ...(s.group || s.parent ? [{ label: t('移到顶层'), value: 'to:' }] : []),
      ...groups
        .filter((g) => g.group.id !== s.group || !!s.parent)
        .map((g) => ({
          label: `${'　'.repeat(g.depth - 1)}${clip(g.group.title)}`,
          title: g.group.title,
          value: `to:${g.group.id}`,
        })),
    ]
    const row = (
      <li
        key={s.id}
        className={cx(
          'art-rail__row',
          over === `s:${s.id}` && 'art-rail__row--into',
          over === `s:${s.id}:above` && 'art-rail__row--above',
          over === `s:${s.id}:below` && 'art-rail__row--below',
          (page === s.id || current === s.id) && 'is-current',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        {...dragProps('screen', s.id)}
        {...screenDropProps(s)}
      >
        {kids.length ? (
          <button
            type="button"
            className="art-rail__twisty"
            aria-label={open ? t('收起子页面') : t('展开子页面')}
            aria-expanded={open}
            onClick={() =>
              setFolded((f) => {
                const next = new Set(f)
                if (open) next.add(s.id)
                else next.delete(s.id)
                return next
              })
            }
          >
            <Icon name="chevron-right" size={11} />
          </button>
        ) : (
          <span className="art-rail__twisty" aria-hidden="true" />
        )}
        <Icon name="doc" size={13} className="art-rail__glyph" />
        {editing?.kind === 'screen' && editing.id === s.id ? (
          nameInput(s.title, t('页面名称'))
        ) : (
          <button
            type="button"
            className="art-rail__name"
            aria-current={page === s.id ? 'page' : undefined}
            onClick={() => {
              setCanvasScreen(artifactId, s.id)
              // One page on its own: the canvas shows it alone; the others stay under 全部页面.
              setArtifactPage(artifactId, s.id)
              focusArtifact(artifactId, { screenIds: [s.id], versionId })
              onPicked()
            }}
            onDoubleClick={() => edit && setEditing({ kind: 'screen', id: s.id })}
          >
            {s.title}
            {m.entry === s.id ? <span className="art-rail__tag">{t('入口#entry')}</span> : null}
          </button>
        )}
        {edit ? (
          <MenuButton
            className="art-rail__more"
            aria-label={t('页面操作')}
            align="end"
            portal
            items={[
              { label: t('重命名'), value: 'rename' },
              { label: t('创建副本'), value: 'duplicate' },
              { separator: true },
              { label: t('上移'), value: 'up', disabled: !shiftScreen(m, s.id, -1) },
              { label: t('下移'), value: 'down', disabled: !shiftScreen(m, s.id, 1) },
              { label: t('设为上一页的子页面'), value: 'indent', disabled: !indentScreen(m, s.id) },
              ...(s.parent ? [{ label: t('移出子页面'), value: 'outdent' }] : []),
              ...(moveItems.length ? [{ separator: true } as const, ...moveItems] : []),
              { separator: true },
              { label: t('删除页面'), value: 'delete', destructive: true, disabled: m.screens.length === 1 },
            ]}
            onSelect={(v) => {
              if (v === 'rename') setEditing({ kind: 'screen', id: s.id })
              else if (v === 'duplicate') void save({ kind: 'manifest', op: 'duplicate', screenId: s.id })
              else if (v === 'delete') setDeleting(s)
              else if (v === 'up' || v === 'down') void save(shiftScreen(m, s.id, v === 'up' ? -1 : 1))
              else if (v === 'indent') void save(indentScreen(m, s.id))
              else if (v === 'outdent') void save(outdentScreen(m, s.id))
              else if (v.startsWith('to:')) void save(moveScreen(m, s.id, v.slice(3) || undefined))
            }}
          >
            <Icon name="more" size={13} />
          </MenuButton>
        ) : null}
      </li>
    )
    return open ? [row, ...kids.flatMap((k) => screenRow(k, depth + 1))] : [row]
  }

  const groupRow = (g: PageGroupNode) => {
    const id = g.group.id
    const deepest = groupDepth(m, id) >= ARTIFACT_PAGE_GROUP_DEPTH
    return [
      besideRow(id, 'above', g.depth - 1),
      <li key={id} className="art-rail__group">
        <div
          className={cx(
            'art-rail__row',
            'art-rail__row--group',
            over === `g:${id}` && 'art-rail__row--over',
            over === `g:${id}:above` && 'art-rail__row--above',
            over === `g:${id}:below` && 'art-rail__row--below',
            page === id && 'is-current',
          )}
          style={{ paddingLeft: 8 + (g.depth - 1) * 14 }}
          {...dragProps('group', id)}
          {...dropProps(`g:${id}`, { group: g.group.parent, into: id })}
        >
          <Icon name="folder" size={13} className="art-rail__glyph" />
          {editing?.kind === 'group' && editing.id === id ? (
            nameInput(g.group.title, t('文件夹名称'))
          ) : (
            <button
              type="button"
              className="art-rail__name"
              aria-current={page === id ? 'page' : undefined}
              onClick={() => show(id)}
              onDoubleClick={() => edit && setEditing({ kind: 'group', id })}
            >
              {g.group.title}
            </button>
          )}
          {edit ? (
            <MenuButton
              className="art-rail__more"
              aria-label={t('文件夹操作')}
              align="end"
              portal
              items={[
                { label: t('添加子文件夹'), value: 'sub', disabled: deepest },
                { label: t('上方添加文件夹'), value: 'above' },
                { label: t('下方添加文件夹'), value: 'below' },
                { separator: true },
                { label: t('上移'), value: 'up', disabled: !shiftGroup(m, id, -1) },
                { label: t('下移'), value: 'down', disabled: !shiftGroup(m, id, 1) },
                ...(g.group.parent ? [{ label: t('移到顶层'), value: 'top' }] : []),
                { separator: true },
                { label: t('重命名'), value: 'rename' },
                { label: t('删除文件夹'), value: 'delete', destructive: true },
              ]}
              onSelect={(v) => {
                if (v === 'rename') setEditing({ kind: 'group', id })
                else if (v === 'sub') setEditing({ kind: 'new', parent: id })
                else if (v === 'above' || v === 'below')
                  setEditing({ kind: 'new', parent: g.group.parent, beside: { id, place: v } })
                else if (v === 'up' || v === 'down') void save(shiftGroup(m, id, v === 'up' ? -1 : 1))
                else if (v === 'top') void save(moveGroup(m, id, undefined))
                else if (v === 'delete') {
                  if (page === id) setArtifactPage(artifactId, g.group.parent ?? null)
                  void save(deleteGroup(m, id))
                }
              }}
            >
              <Icon name="more" size={13} />
            </MenuButton>
          ) : null}
        </div>
        <ul className="art-rail__list">
          {newRow(id, g.depth)}
          {g.groups.flatMap(groupRow)}
          {g.screens.flatMap((s) => screenRow(s, g.depth))}
        </ul>
      </li>,
      besideRow(id, 'below', g.depth - 1),
    ]
  }

  const inputRow = (key: string, depth: number) => (
    <li key={key} className="art-rail__row" style={{ paddingLeft: 8 + depth * 14 }}>
      <Icon name="folder" size={13} className="art-rail__glyph" />
      {nameInput('', t('文件夹名称'))}
    </li>
  )
  /** A new subpage of `parent` being named (beside one: besideRow). */
  const newRow = (parent: string | undefined, depth: number) =>
    editing?.kind === 'new' && editing.parent === parent && !editing.beside ? inputRow('new', depth) : null
  const besideRow = (id: string, place: 'above' | 'below', depth: number) =>
    editing?.kind === 'new' && editing.beside?.id === id && editing.beside.place === place
      ? inputRow(`new-${place}-${id}`, depth)
      : null

  return (
    <>
      {header}
      <div
        className={cx('art-rail__scroll', over === 'top' && 'art-rail__scroll--over')}
        {...dropProps('top', { group: undefined })}
      >
        <ul className="art-rail__list" aria-busy={busy}>
          <li className={cx('art-rail__row', 'art-rail__row--all', page === null && 'is-current')}>
            <Icon name="dashboard" size={13} className="art-rail__glyph" />
            <button
              type="button"
              className="art-rail__name"
              aria-current={page === null ? 'page' : undefined}
              onClick={() => show(null)}
            >
              {t('全部页面')}
              <span className="art-rail__count">{m.screens.length}</span>
            </button>
          </li>
          {newRow(undefined, 0)}
          {tree.groups.flatMap(groupRow)}
          {tree.screens.flatMap((s) => screenRow(s, 0))}
        </ul>
        {!readOnly && !m.groups?.length ? (
          <p className="art-rail__hint">{t('新建文件夹后，可以把页面拖进去；每个文件夹单独显示它的页面')}</p>
        ) : null}
      </div>
      <Presence>
        {deleting ? (
          <ConfirmActionDialog
            title={t('删除页面「{title}」？', { title: deleting.title })}
            message={t('从产物里移除这个页面')}
            consequences={[
              ...(subpages(m, deleting.id).length
                ? [t('它的 {n} 个子页面会移到上一级，不会被删除', { n: subpages(m, deleting.id).length })]
                : []),
              t('可以在版本记录里找回'),
            ]}
            label={t('删除')}
            done={t('已删除')}
            run={() => onEdit([{ kind: 'manifest', op: 'delete', screenId: deleting.id }])}
            onClose={() => setDeleting(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** A folder (文件夹) with no screens yet, or (`first`) a work before its first version, over the canvas. */
export function PageEmpty({ first }: { first?: boolean }) {
  const shown = usePresenceOpen()
  return (
    <p className="art-page-empty" data-testid="art-page-empty" data-state={shown ? 'open' : 'closed'}>
      {first
        ? t('在下方对话框里说要做什么，AI 会做出第一版')
        : t('这个文件夹还没有页面：让 AI 生成，或从左侧把页面拖进来')}
    </p>
  )
}

/** Why the canvas's editing tools are off, if they are. */
export const noEditReasonOf = (versionKey: string, readOnly: boolean, manifest: unknown) =>
  !versionKey
    ? t('AI 做出第一版后可以编辑')
    : readOnly
      ? t('历史版本只读')
      : !manifest
        ? t('单页产物不支持画布编辑')
        : undefined

/** Pill shown at top-center of the canvas when filtered to a single page or folder. */
export function PagePill({
  id,
  page,
  manifest,
  empty,
  first,
}: {
  id: string
  page: string | null
  manifest?: GgArtifactManifest | null
  empty?: boolean
  first?: boolean
}) {
  // The first version's hint fades out as the screens come in.
  const firstHint = <Presence>{first ? <PageEmpty first /> : null}</Presence>
  if (first || !page) return firstHint
  const folder = manifest?.groups?.find((g) => g.id === page)
  const title = folder?.title ?? manifest?.screens.find((s) => s.id === page)?.title ?? page
  return (
    <>
      <div className="art-page-pill" role="status" data-testid="art-page-pill">
        <Icon name={folder ? 'folder' : 'smartphone'} size={13} />
        <span>{t('正在查看「{name}」', { name: title })}</span>
        <button type="button" className="art-page-pill__all" onClick={() => setArtifactPage(id, null)}>
          {t('查看全部页面')}
        </button>
      </div>
      {empty ? <PageEmpty /> : null}
      {firstHint}
    </>
  )
}
