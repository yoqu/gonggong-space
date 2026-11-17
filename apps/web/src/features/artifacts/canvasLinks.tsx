import type {
  ArtifactEditOp,
  ArtifactLinkRatio,
  GgArtifactLink,
  GgArtifactManifest,
} from '@gonggong/protocol'
import {
  type ClipboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { attempt } from '../../lib/errors'
import { Button, Icon, IconButton, type MenuItem, SegmentedControl } from '../../ui'
import { AddLinkDialog, type NewLink } from './AddLinkDialog'
import { type CanvasNode, clampLinkSize, LINK_CARD, LINK_HEAD, linkNodeId, linkPage } from './geometry'
import { CMD } from './menus'
import { hostOf, linkIcon, ratioItems, validUrl } from './webPage'
import './canvas-links.css'

/** Command values of link nodes (the context menu, ⌘K, the toolbar). */
export const LINK_CMD = {
  add: 'link:add',
  open: 'link:open',
  reload: 'link:reload',
  rename: 'link:rename',
  embed: 'link:embed',
  card: 'link:card',
} as const

const openPage = (url: string) => window.open(url, '_blank', 'noopener')

type Size = { w: number; h?: number }

/** Buttons on a node keep the pointer from the canvas (no drag, no pan). */
const keep = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * A web page on the canvas: `embed` loads it in an iframe under a header (icon, title, host, reload, new tab), which
 * takes the pointer only while the node is selected and the view is still; `card` is one row that opens it. Far from
 * the view the iframe is not rendered.
 */
export function LinkNode({
  value,
  live,
  near,
  reload,
  onReload,
}: {
  value: GgArtifactLink
  live: boolean
  near: boolean
  reload: number
  onReload: () => void
}) {
  const host = hostOf(value.url)
  const icon = <Icon name={linkIcon(value.url)} size={16} className="art-link__icon" />
  if (value.display === 'card')
    return (
      <div className="art-link art-link--card">
        {icon}
        <div className="art-link__names">
          <strong className="art-link__title">{value.title}</strong>
          <span className="art-link__host">{host}</span>
        </div>
        <Button
          size="small"
          onPointerDown={keep}
          onClick={(e) => {
            keep(e)
            openPage(value.url)
          }}
        >
          {t('打开')}
        </Button>
      </div>
    )
  return (
    <div className="art-link">
      <div className="art-link__head">
        {icon}
        <strong className="art-link__title">{value.title}</strong>
        <span className="art-link__host">{host}</span>
        <IconButton size="small" title={t('刷新')} onPointerDown={keep} onClick={onReload}>
          {'arrow-clockwise' as const}
        </IconButton>
        <IconButton
          size="small"
          title={t('新标签打开')}
          onPointerDown={keep}
          onClick={() => openPage(value.url)}
        >
          {'external' as const}
        </IconButton>
      </div>
      {near ? (
        <iframe
          key={reload}
          className={cx('art-link__frame', live && 'art-link__frame--live')}
          src={value.url}
          title={value.title}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer-when-downgrade"
          loading="lazy"
        />
      ) : (
        <div className="art-link__off">
          <Icon name={linkIcon(value.url)} size={32} />
        </div>
      )}
    </div>
  )
}

/**
 * Over a selected embed, in viewport pixels: the ratio bar with the page's size, and the bottom-right handle that
 * resizes it (a fixed ratio changes the width only; free the height too). `onSize` runs as it drags, `done` on release.
 */
function LinkSizer({
  value,
  z,
  readOnly,
  onRatio,
  onSize,
}: {
  value: GgArtifactLink
  z: number
  readOnly: boolean
  onRatio: (r: ArtifactLinkRatio) => void
  onSize: (size: Size, done: boolean) => void
}) {
  const page = linkPage(value)
  const drag = useRef<{ x: number; y: number; w: number; h: number; size?: Size } | null>(null)
  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const w = clampLinkSize(d.w + (e.clientX - d.x) / z)
    d.size = value.ratio === 'free' ? { w, h: clampLinkSize(d.h + (e.clientY - d.y) / z) } : { w }
    onSize(d.size, false)
  }
  // Saved as last shown while dragging: a release reports no movement of its own.
  const end = () => {
    const size = drag.current?.size
    drag.current = null
    if (size) onSize(size, true)
  }
  return (
    <>
      <div className="art-link-bar" role="toolbar" aria-label={t('嵌入比例')} onPointerDown={keep}>
        {readOnly ? null : (
          <SegmentedControl
            size="small"
            aria-label={t('比例')}
            items={ratioItems()}
            value={value.ratio}
            onChange={onRatio}
          />
        )}
        <span className="art-link-bar__size">{`${page.w} × ${page.h}`}</span>
      </div>
      {readOnly ? null : (
        <span
          className="art-link-resize"
          data-testid={`art-link-resize-${value.id}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            keep(e)
            e.currentTarget.setPointerCapture?.(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, ...page }
          }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      )}
    </>
  )
}

type LinkPatch = Partial<Pick<GgArtifactLink, 'title' | 'display' | 'ratio' | 'w' | 'h'>>

/**
 * The canvas's links (manifest `links`) with where they were just dragged and how they were just resized, until the
 * version saving it arrives; their commands, menu, selection extras and the 添加链接 dialog.
 */
export function useCanvasLinks({
  artifactId,
  manifest,
  moves,
  canEdit,
  onEdit,
  center,
}: {
  artifactId: string
  manifest: GgArtifactManifest | null | undefined
  /** The canvas's dragged nodes, by node id. */
  moves: Record<string, { x: number; y: number }>
  canEdit: boolean
  onEdit: (ops: ArtifactEditOp[]) => Promise<void>
  /** The middle of the view, in canvas units: new links go there. */
  center: () => { x: number; y: number }
}) {
  const [draft, setDraft] = useState<Record<string, LinkPatch>>({})
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new manifest has the changes in place
  useEffect(() => setDraft({}), [manifest])
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [adding, setAdding] = useState<string | null>(null)
  const links = useMemo<GgArtifactLink[]>(
    () => (manifest?.links ?? []).map((l) => ({ ...l, ...moves[linkNodeId(l.id)], ...draft[l.id] })),
    [manifest, moves, draft],
  )
  const of = (nodeId: string) => links.find((l) => linkNodeId(l.id) === nodeId)
  const update = (
    l: GgArtifactLink,
    patch: LinkPatch,
    op: Omit<Extract<ArtifactEditOp, { kind: 'link-update' }>, 'kind' | 'id'> | null,
  ) => {
    if (!canEdit) return
    setDraft((d) => ({ ...d, [l.id]: { ...d[l.id], ...patch } }))
    if (!op) return
    void attempt(() => onEdit([{ kind: 'link-update', id: l.id, ...op }])).then(
      (ok) => ok || setDraft(({ [l.id]: _, ...rest }) => rest),
    )
  }
  const setRatio = (l: GgArtifactLink, ratio: ArtifactLinkRatio) => {
    if (ratio === l.ratio) return
    const h = linkPage(l).h
    if (ratio === 'free') update(l, { ratio, h }, { ratio, h })
    else update(l, { ratio, h: undefined }, { ratio, h: null })
  }
  const add = async (link: NewLink) => {
    const page = link.display === 'card' ? null : linkPage({ ratio: link.ratio })
    const c = center()
    const w = page?.w ?? LINK_CARD.w
    const h = page ? page.h + LINK_HEAD : LINK_CARD.h
    return attempt(() =>
      onEdit([{ kind: 'link', ...link, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) }]),
    )
  }

  return {
    links,
    of,
    /** Opens 添加链接, with a URL pasted on the canvas. */
    paste: (e: ClipboardEvent) => {
      const text = e.clipboardData.getData('text/plain').trim()
      if (!canEdit || !validUrl(text)) return
      e.preventDefault()
      setAdding(text)
    },
    /** Runs a link command on the selected links; false when `value` is not one. */
    command: (value: string, selected: string[], rename: (nodeId: string) => void) => {
      if (!value.startsWith('link:')) return false
      const picked = links.filter((l) => selected.includes(linkNodeId(l.id)))
      const [first] = picked
      if (value === LINK_CMD.add) {
        if (canEdit) setAdding('')
      } else if (value === LINK_CMD.open) for (const l of picked) openPage(l.url)
      else if (value === LINK_CMD.reload)
        setReloads((r) => ({ ...r, ...Object.fromEntries(picked.map((l) => [l.id, (r[l.id] ?? 0) + 1])) }))
      else if (value === LINK_CMD.rename) {
        if (canEdit && first && picked.length === 1) rename(linkNodeId(first.id))
      } else if (value === LINK_CMD.embed || value === LINK_CMD.card) {
        const display = value === LINK_CMD.embed ? 'embed' : 'card'
        for (const l of picked) if (l.display !== display) update(l, { display }, { display })
      }
      return true
    },
    contextItems: (selected: string[]): MenuItem[] => {
      const picked = links.filter((l) => selected.includes(linkNodeId(l.id)))
      const ro = canEdit ? {} : { disabled: true, title: t('历史版本只读') }
      return [
        { label: t('打开'), value: LINK_CMD.open },
        { label: t('刷新'), value: LINK_CMD.reload },
        { separator: true },
        {
          label: t('重命名'),
          value: LINK_CMD.rename,
          ...ro,
          ...(picked.length === 1 ? {} : { disabled: true }),
        },
        picked[0]?.display === 'card'
          ? { label: t('切换为嵌入页面'), value: LINK_CMD.embed, ...ro }
          : { label: t('切换为链接卡片'), value: LINK_CMD.card, ...ro },
        { separator: true },
        { label: t('删除'), value: CMD.remove, shortcut: '⌫', destructive: true, ...ro },
      ]
    },
    rename: (nodeId: string, title: string) => {
      const l = of(nodeId)
      if (l) update(l, { title }, { title })
    },
    /** The node's body. */
    body: (n: CanvasNode, live: boolean, near: boolean) => {
      const l = of(n.id)
      return l ? (
        <LinkNode
          value={l}
          live={live}
          near={near}
          reload={reloads[l.id] ?? 0}
          onReload={() => setReloads((r) => ({ ...r, [l.id]: (r[l.id] ?? 0) + 1 }))}
        />
      ) : null
    },
    /** Inside a selected embed's outline: the ratio bar and the resize handle. */
    sizer: (n: CanvasNode, z: number): ReactNode => {
      const l = of(n.id)
      if (l?.display !== 'embed') return null
      return (
        <LinkSizer
          value={l}
          z={z}
          readOnly={!canEdit}
          onRatio={(r) => setRatio(l, r)}
          onSize={(size, done) => update(l, size, done ? (l.ratio === 'free' ? size : { w: size.w }) : null)}
        />
      )
    },
    openAdd: () => canEdit && setAdding(''),
    dialog:
      adding !== null ? (
        <AddLinkDialog artifactId={artifactId} url={adding} onAdd={add} onClose={() => setAdding(null)} />
      ) : null,
  }
}
