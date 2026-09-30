import { useEffect, useRef, useState } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { Button, EmptyState, Icon, Presence, SegmentedControl, TextField } from '../../../ui'
import '../../previews/previews.css'
import { PREVIEW_STATE } from '../../previews/PreviewCard'
import { ShareDialog } from '../../previews/ShareDialog'
import { openUrl, usePreview } from '../../previews/store'
import type { TabMeta, TabProps } from '../types'
import './web-tab.css'

const VIEWPORTS = ['fit', '1440', '1024', '768', '390'] as const
type Viewport = (typeof VIEWPORTS)[number]
const VIEWPORT_ITEMS = VIEWPORTS.map((v) => ({ value: v, label: v === 'fit' ? '自适应' : v }))
const viewportKey = (previewId: string) => `gonggong.webtab.viewport.${previewId}`

function loadViewport(previewId: string): Viewport {
  try {
    const v = localStorage.getItem(viewportKey(previewId))
    return VIEWPORTS.find((x) => x === v) ?? 'fit'
  } catch {
    return 'fit'
  }
}

function saveViewport(previewId: string, v: Viewport) {
  try {
    localStorage.setItem(viewportKey(previewId), v)
  } catch {
    // storage unavailable (private mode): the preset lasts for this tab only
  }
}

/**
 * A preview in the workbench (design §4.2). The frame is cross-origin, so its own navigation can't be read: the path
 * field is only where the frame enters, never synced back.
 */
export function WebTab({ tab, tabKey: key }: TabProps<'web'>) {
  const state = usePreview(tab.previewId)
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState(tab.path)
  const [viewport, setViewport] = useState(() => loadViewport(tab.previewId))
  const [sharing, setSharing] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  useEffect(() => setDraft(tab.path), [tab.path])
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const src = openUrl(tab.previewId, tab.path)
  const p = state?.preview
  const status = state ? PREVIEW_STATE[state.status] : null
  const enter = () => {
    const path = draft.trim().startsWith('/') ? draft.trim() : `/${draft.trim()}`
    setDraft(path)
    useWorkbench.getState().patch(key, { path })
    setReload((n) => n + 1)
  }
  const width = viewport === 'fit' ? 0 : Number(viewport)
  const scale = width && room.width ? Math.min(1, room.width / width) : 1

  return (
    <div className="wt-web">
      <div className="wt-web__bar">
        <Button
          size="small"
          variant="plain"
          icon="arrow-clockwise"
          aria-label="刷新"
          onClick={() => setReload((n) => n + 1)}
        />
        <TextField
          className="wt-web__path"
          size="regular"
          aria-label="进入路径"
          prefix="进入路径"
          title="回车后从这个路径重新进入；页面内的跳转不会同步到这里"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) enter()
          }}
        />
        <SegmentedControl
          size="small"
          aria-label="视口尺寸"
          items={VIEWPORT_ITEMS}
          value={viewport}
          onChange={(v) => {
            setViewport(v)
            saveViewport(tab.previewId, v)
          }}
        />
        <a
          className="ui-btn ui-btn--small ui-btn--plain ui-btn--icon"
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label="新窗口打开"
          title="新窗口打开"
        >
          <Icon name="external" size={14} />
        </a>
        {p?.canManage ? (
          <Button size="small" variant="plain" icon="link" onClick={() => setSharing(true)}>
            公开链接…
          </Button>
        ) : null}
        {status ? (
          <span className="pv-card__state">
            <span className="pv-dot" style={{ background: status.color }} />
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="wt-web__stage" ref={stage}>
        {state?.status === 'online' && p ? (
          // One frame for every preset: switching the viewport must not reload the page.
          <div className="wt-web__device" style={width ? { width: width * scale } : undefined}>
            <iframe
              key={reload}
              className="wt-web__frame"
              title={p.title}
              src={src}
              style={
                width
                  ? { width: `${width}px`, height: `${room.height / scale}px`, transform: `scale(${scale})` }
                  : undefined
              }
            />
          </div>
        ) : state?.status === 'offline' ? (
          <EmptyState
            icon="desktop"
            title="服务已停止 · 等待 Bot 重新发布"
            description="恢复在线后自动重新加载"
          />
        ) : state?.status === 'closed' ? (
          <EmptyState
            icon="desktop"
            title="预览已关闭"
            action={<Button onClick={() => useWorkbench.getState().closeTab(key)}>关闭标签页</Button>}
          />
        ) : null}
      </div>
      <Presence>
        {sharing && p ? <ShareDialog preview={p} onClose={() => setSharing(false)} /> : null}
      </Presence>
    </div>
  )
}

export function useWebTabMeta(tab: TabProps<'web'>['tab']): TabMeta {
  const state = usePreview(tab.previewId)
  return {
    icon: 'desktop',
    title: state?.preview?.title ?? '预览',
    ...(state ? { status: state.status === 'online' ? 'online' : 'offline' } : {}),
  }
}
