import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'
import { create } from 'zustand'
import { AccountMenu } from '../features/auth/AccountMenu'
import { NotificationPanel } from '../features/notifications/NotificationPanel'
import { syncPush } from '../features/notifications/push'
import { SearchOverlay } from '../features/search/SearchOverlay'
import { useRealtimeStatus } from '../lib/realtime'
import { Badge, Icon, Logo, Toaster, Toolbar, ToolbarButton, ToolbarGroup } from '../ui'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { useWorkspace } from './workspace'

type Overlay = 'search' | 'notif' | null

/** Which shell overlay is open; the controls live in the sidebar, the overlays in AppShell. */
export const useShellOverlay = create<{ overlay: Overlay; set: (o: Overlay) => void }>()((set) => ({
  overlay: null,
  set: (overlay) => set({ overlay }),
}))

/** Compact toolbar row and search field at the top of the conversation sidebar. */
export function ShellBar({ onNewGroup }: { onNewGroup?: () => void }) {
  const user = useSession((s) => s.user)
  const notifCount = useWorkspace((s) => s.notifCount)
  const { overlay, set } = useShellOverlay()
  const mobile = useIsMobile()
  return (
    <div className="shellbar">
      <Toolbar leading={<Logo size={20} />} title="共工" scrolled={false}>
        <ToolbarGroup>
          {onNewGroup ? <ToolbarButton icon="plus" label="新建群" onClick={onNewGroup} /> : null}
          <ToolbarButton
            icon={
              <span className="shellbar__bell">
                <Icon name="bell" />
                <Badge count={notifCount} />
              </span>
            }
            label={notifCount > 0 ? `通知（${notifCount} 条未读）` : '通知'}
            active={overlay === 'notif'}
            onClick={() => set(overlay === 'notif' ? null : 'notif')}
          />
          {user?.role === 'sysadmin' ? (
            <Link to="/admin" className="ui-toolbar__btn" aria-label="管理后台" title="管理后台">
              <Icon name="shield-check" />
            </Link>
          ) : null}
        </ToolbarGroup>
        <AccountMenu />
      </Toolbar>
      <button
        type="button"
        className="shellbar__search"
        aria-label="搜索消息、文件、运行"
        onClick={() => set('search')}
      >
        <Icon name="search" size={13} weight={1.7} />
        <span className="shellbar__placeholder">搜索</span>
        {mobile ? null : (
          <kbd className="shellbar__kbd">{/Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'}</kbd>
        )}
      </button>
    </div>
  )
}

/** True once a connection that had been open is lost, until it reopens. */
function useConnectionLost() {
  const status = useRealtimeStatus()
  const [wasOpen, setWasOpen] = useState(false)
  if (status === 'open' && !wasOpen) setWasOpen(true)
  return wasOpen && status !== 'open'
}

/** Keeps this browser's push subscription on the logged-in account; failures only mean no browser push. */
function usePushSync() {
  useEffect(() => {
    syncPush().catch((e: Error) => console.warn('push subscription sync failed:', e))
  }, [])
}

export function AppShell() {
  const mobile = useIsMobile()
  const { overlay, set } = useShellOverlay()
  const lost = useConnectionLost()
  usePushSync()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        set('search')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      set(null)
    }
  }, [set])
  const close = () => set(null)
  return (
    <div className="app">
      {mobile && lost ? (
        <div className="app__offline" role="status">
          连接已断开，正在重连…
        </div>
      ) : null}
      <div className="app__body">
        <Outlet />
      </div>
      <NotificationPanel open={overlay === 'notif'} onClose={close} />
      {overlay === 'search' ? <SearchOverlay onClose={close} /> : null}
      <Toaster />
    </div>
  )
}
