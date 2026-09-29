import { lazy, Suspense } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { Button, EmptyState } from '../../../ui'
import '../../previews/live.css'
import '../../previews/previews.css'
import { PREVIEW_STATE } from '../../previews/PreviewCard'
import { usePreview } from '../../previews/store'
import type { TabMeta, TabProps } from '../types'

// livekit-client loads with the first live view, not with the chat.
export const LiveView = lazy(() => import('../../previews/LiveView').then((m) => ({ default: m.LiveView })))

/** A desktop app's window, live, in the workbench (plan B4). */
export function LiveTab({ tab, tabKey: key }: TabProps<'live'>) {
  const state = usePreview(tab.previewId)
  const p = state?.preview
  if (!p)
    return state?.status === 'closed' ? (
      <EmptyState
        icon="desktop"
        title="预览已关闭"
        action={<Button onClick={() => useWorkbench.getState().closeTab(key)}>关闭标签页</Button>}
      />
    ) : null
  return (
    <div className="wt-live">
      <div className="wt-live__head">
        <span className={`pv-dot pv-dot--${p.status}`} />
        <span className="pv-card__title">{p.title}</span>
        <span className="pv-muted">{PREVIEW_STATE[p.status]}</span>
      </div>
      <Suspense fallback={null}>
        <LiveView preview={p} />
      </Suspense>
    </div>
  )
}

export function useLiveTabMeta(tab: TabProps<'live'>['tab']): TabMeta {
  const state = usePreview(tab.previewId)
  return {
    icon: 'desktop',
    title: state?.preview?.title ?? '桌面应用',
    ...(state ? { status: state.status === 'online' ? 'online' : 'offline' } : {}),
  }
}
