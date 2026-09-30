import { lazy, Suspense } from 'react'
import { useWorkbench } from '../../../app/workbench'
import { Button, EmptyState, type IconName } from '../../../ui'
import '../../previews/live.css'
import '../../previews/previews.css'
import { DevtoolsLogin, loginNote, PREVIEW_STATE } from '../../previews/PreviewCard'
import { usePreview } from '../../previews/store'
import type { TabMeta, TabProps } from '../types'

// livekit-client loads with the first live view, not with the chat.
const LiveView = lazy(() => import('../../previews/LiveView').then((m) => ({ default: m.LiveView })))

/** A desktop app's window, live, in the workbench (plan B4). */
export const LiveTab = ({ tab, tabKey, active }: TabProps<'live'>) => (
  <LivePreview previewId={tab.previewId} tabKey={tabKey} icon="desktop" active={active} />
)

/**
 * A live preview's tab: its picture, or why there is none. A mini program waits for its devtools login first.
 * A hidden tab leaves the room, so it stops costing the machine a stream.
 */
export function LivePreview({
  previewId,
  tabKey,
  icon,
  active,
}: {
  previewId: string
  tabKey: string
  icon: IconName
  active: boolean
}) {
  const state = usePreview(previewId)
  const p = state?.preview
  if (!p)
    return state?.status === 'closed' ? (
      <EmptyState
        icon={icon}
        title="预览已关闭"
        action={<Button onClick={() => useWorkbench.getState().closeTab(tabKey)}>关闭标签页</Button>}
      />
    ) : null
  return (
    <div className="wt-live">
      <div className="wt-live__head">
        <span className={`pv-dot pv-dot--${p.status}`} />
        <span className="pv-card__title">{p.title}</span>
        <span className="pv-muted">{PREVIEW_STATE[p.status].label}</span>
      </div>
      {p.awaiting === 'login' ? (
        <div className="wt-live__login">
          <DevtoolsLogin preview={p} />
          <span>{loginNote(p)}</span>
        </div>
      ) : !active ? null : (
        <Suspense fallback={null}>
          <LiveView preview={p} />
        </Suspense>
      )}
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
