import {
  ARTIFACT_PAGE_GROUP_DEPTH,
  type ArtifactEditOp,
  type GgArtifactManifest,
  type GgArtifactScreen,
} from '@gonggong/protocol'
import { type DragEvent, type PointerEvent, useCallback, useRef, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { ConfirmActionDialog, Icon, MenuButton, type MenuItem, Presence } from '../../ui'
import { CommandLog } from './CommandLog'
import {
  addGroup,
  canNest,
  deleteGroup,
  flatGroups,
  groupDepth,
  moveGroup,
  moveScreen,
  type PageGroupNode,
  type PagesOp,
  pageTree,
  renameGroup,
} from './pageTree'
import { focusArtifact } from './store'
import './rail.css'

const OPEN_KEY = 'gg.art.rail'
const SPLIT_KEY = 'gg.art.railSplit'
/** Below this tab width the rail is a drawer over the canvas, closed until asked for. */
const NARROW_PX = 720
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.85

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
    if (narrow) return setDrawer(v)
    setWide(v)
    localStorage.setItem(OPEN_KEY, v ? '1' : '0')
  }
  return { ref, narrow, open, setOpen }
}

/** Menus stay narrow enough to open inside the rail's side of the tab. */
const clip = (title: string) => (title.length > 14 ? `${title.slice(0, 13)}…` : title)

/** What is being renamed or created inline. */
type Editing =
  | { kind: 'screen'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'new'; parent: string | undefined }
  | null
/** What is being dragged. */
type Dragged = { kind: 'screen' | 'group'; id: string } | null

/**
 * The canvas's left rail: the page list (多级分类; group, move, rename, delete pages) above, the command log below,
 * split 2:1 by default and draggable.
 */
export function PageRail({
  artifactId,
  groupId,
  manifest,
  readOnly,
  canEdit,
  refreshKey,
  onEdit,
  onClose,
  versionId,
  onPicked,
}: {
  artifactId: string
  groupId: string
  manifest: GgArtifactManifest | null
  readOnly: boolean
  /** A group member (not a visitor): may edit and read the command log. */
  canEdit: boolean
  refreshKey: string
  onEdit: (ops: ArtifactEditOp[]) => Promise<unknown>
  onClose: () => void
  /** The past version shown (null: the head): picking a page stays on it. */
  versionId: string | null
  /** A page was picked (the narrow drawer closes). */
  onPicked: () => void
}) {
  const [split, setSplit] = useState(readSplit)
  const box = useRef<HTMLDivElement>(null)
  const resize = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current
    if (!el) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    let last = split
    const move = (ev: globalThis.PointerEvent) => {
      last = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (ev.clientY - rect.top) / rect.height))
      setSplit(last)
    }
    const up = () => {
      localStorage.setItem(SPLIT_KEY, String(last))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="art-rail" aria-label={t('页面与命令')} data-testid="art-rail" ref={box}>
      <section className="art-rail__pages" style={{ flexBasis: canEdit ? `${split * 100}%` : '100%' }}>
        <Pages
          artifactId={artifactId}
          manifest={manifest}
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
            <h3 className="art-rail__title">{t('命令记录')}</h3>
            <div className="art-rail__scroll">
              <CommandLog artifactId={artifactId} groupId={groupId} refreshKey={refreshKey} />
            </div>
          </section>
        </>
      ) : null}
    </aside>
  )
}

function Pages({
  artifactId,
  manifest: m,
  readOnly,
  onEdit,
  onClose,
  versionId,
  onPicked,
}: {
  artifactId: string
  manifest: GgArtifactManifest | null
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
  const [current, setCurrent] = useState<string | null>(null)

  const header = (
    <div className="art-rail__head">
      <h3 className="art-rail__title">
        {t('页面')}
        {m ? <span className="art-rail__count">{m.screens.length}</span> : null}
      </h3>
      {m && !readOnly ? (
        <button
          type="button"
          className="art-rail__icon"
          aria-label={t('新建分类')}
          title={t('新建分类')}
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
        <p className="art-log__empty">{t('单页产物，没有页面列表')}</p>
      </>
    )

  const tree = pageTree(m)
  const groups = flatGroups(tree)
  const save = async (op: PagesOp | ArtifactEditOp | null) => {
    if (!op) return
    setBusy(true)
    await attempt(() => onEdit([op]))
    setBusy(false)
  }
  const commit = (title: string) => {
    const e = editing
    setEditing(null)
    const v = title.trim()
    if (!e || !v) return
    if (e.kind === 'new') void save(addGroup(m, v.slice(0, 40), e.parent))
    else if (e.kind === 'group') {
      if (m.groups?.find((g) => g.id === e.id)?.title !== v) void save(renameGroup(m, e.id, v.slice(0, 40)))
    } else if (m.screens.find((s) => s.id === e.id)?.title !== v)
      void save({ kind: 'manifest', op: 'rename', screenId: e.id, title: v.slice(0, 80) })
  }
  const edit = !readOnly && !busy

  const drop = (target: { group: string | undefined; before?: string; into?: string }) => {
    const d = dragged
    setDragged(null)
    setOver(null)
    if (!d || !edit) return
    if (d.kind === 'screen') void save(moveScreen(m, d.id, target.into ?? target.group, target.before))
    else void save(moveGroup(m, d.id, target.into ?? target.group))
  }
  const dropProps = (key: string, target: Parameters<typeof drop>[0]) =>
    edit && dragged
      ? {
          onDragOver: (e: DragEvent) => {
            const into = target.into ?? target.group
            if (dragged.kind === 'group' && (target.before || !canNest(m, dragged.id, into))) return
            e.preventDefault()
            e.stopPropagation()
            setOver(key)
          },
          onDragLeave: () => setOver((o) => (o === key ? null : o)),
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
            drop(target)
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
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') setEditing(null)
      }}
    />
  )

  const screenRow = (s: GgArtifactScreen, depth: number) => {
    const moveItems: MenuItem[] = [
      ...(s.group ? [{ label: t('移到顶层'), value: 'to:' }] : []),
      ...groups
        .filter((g) => g.group.id !== s.group)
        .map((g) => ({
          label: `${'　'.repeat(g.depth - 1)}${clip(g.group.title)}`,
          title: g.group.title,
          value: `to:${g.group.id}`,
        })),
    ]
    return (
      <li
        key={s.id}
        className={cx(
          'art-rail__row',
          over === `s:${s.id}` && 'art-rail__row--over',
          current === s.id && 'is-current',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
        {...dragProps('screen', s.id)}
        {...dropProps(`s:${s.id}`, { group: s.group, before: s.id })}
      >
        <Icon name="doc" size={13} className="art-rail__glyph" />
        {editing?.kind === 'screen' && editing.id === s.id ? (
          nameInput(s.title, t('页面名称'))
        ) : (
          <button
            type="button"
            className="art-rail__name"
            onClick={() => {
              setCurrent(s.id)
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
            items={[
              { label: t('重命名'), value: 'rename' },
              { label: t('创建副本'), value: 'duplicate' },
              ...(moveItems.length ? [{ separator: true } as const, ...moveItems] : []),
              { separator: true },
              { label: t('删除页面'), value: 'delete', destructive: true, disabled: m.screens.length === 1 },
            ]}
            onSelect={(v) => {
              if (v === 'rename') setEditing({ kind: 'screen', id: s.id })
              else if (v === 'duplicate') void save({ kind: 'manifest', op: 'duplicate', screenId: s.id })
              else if (v === 'delete') setDeleting(s)
              else if (v.startsWith('to:')) void save(moveScreen(m, s.id, v.slice(3) || undefined))
            }}
          >
            <Icon name="more" size={13} />
          </MenuButton>
        ) : null}
      </li>
    )
  }

  const groupRow = (g: PageGroupNode) => (
    <li key={g.group.id} className="art-rail__group">
      <div
        className={cx(
          'art-rail__row',
          'art-rail__row--group',
          over === `g:${g.group.id}` && 'art-rail__row--over',
        )}
        style={{ paddingLeft: 8 + (g.depth - 1) * 14 }}
        {...dragProps('group', g.group.id)}
        {...dropProps(`g:${g.group.id}`, { group: g.group.parent, into: g.group.id })}
      >
        <Icon name="folder" size={13} className="art-rail__glyph" />
        {editing?.kind === 'group' && editing.id === g.group.id ? (
          nameInput(g.group.title, t('分类名称'))
        ) : (
          <button
            type="button"
            className="art-rail__name"
            onDoubleClick={() => edit && setEditing({ kind: 'group', id: g.group.id })}
          >
            {g.group.title}
          </button>
        )}
        {edit ? (
          <MenuButton
            className="art-rail__more"
            aria-label={t('分类操作')}
            align="end"
            items={[
              { label: t('重命名'), value: 'rename' },
              {
                label: t('新建子分类'),
                value: 'sub',
                disabled: groupDepth(m, g.group.id) >= ARTIFACT_PAGE_GROUP_DEPTH,
              },
              ...(g.group.parent ? [{ label: t('移到顶层'), value: 'top' }] : []),
              { separator: true },
              { label: t('删除分类'), value: 'delete', destructive: true },
            ]}
            onSelect={(v) => {
              if (v === 'rename') setEditing({ kind: 'group', id: g.group.id })
              else if (v === 'sub') setEditing({ kind: 'new', parent: g.group.id })
              else if (v === 'top') void save(moveGroup(m, g.group.id, undefined))
              else if (v === 'delete') void save(deleteGroup(m, g.group.id))
            }}
          >
            <Icon name="more" size={13} />
          </MenuButton>
        ) : null}
      </div>
      <ul className="art-rail__list">
        {g.groups.map(groupRow)}
        {newRow(g.group.id, g.depth)}
        {g.screens.map((s) => screenRow(s, g.depth))}
      </ul>
    </li>
  )

  const newRow = (parent: string | undefined, depth: number) =>
    editing?.kind === 'new' && editing.parent === parent ? (
      <li className="art-rail__row" style={{ paddingLeft: 8 + depth * 14 }}>
        <Icon name="folder" size={13} className="art-rail__glyph" />
        {nameInput('', t('分类名称'))}
      </li>
    ) : null

  return (
    <>
      {header}
      <div
        className={cx('art-rail__scroll', over === 'top' && 'art-rail__scroll--over')}
        {...dropProps('top', { group: undefined })}
      >
        <ul className="art-rail__list" aria-busy={busy}>
          {newRow(undefined, 0)}
          {tree.groups.map(groupRow)}
          {tree.screens.map((s) => screenRow(s, 0))}
        </ul>
        {!readOnly && !m.groups?.length ? (
          <p className="art-rail__hint">{t('拖动页面调整顺序，新建分类后可把页面拖进去')}</p>
        ) : null}
      </div>
      <Presence>
        {deleting ? (
          <ConfirmActionDialog
            title={t('删除页面「{title}」？', { title: deleting.title })}
            message={t('从产物里移除这个页面')}
            consequences={[t('可以在版本记录里找回')]}
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
