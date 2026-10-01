import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { create } from 'zustand'
import { NotificationPanel } from '../features/notifications/NotificationPanel'
import { syncPush } from '../features/notifications/push'
import { SearchOverlay } from '../features/search/SearchOverlay'
import { SettingsHost } from '../features/settings/SettingsDialog'
import { TeamSwitcher, useMultiTeam } from '../features/teams/TeamSwitcher'
import { t } from '../i18n'
import { useRealtimeStatus } from '../lib/realtime'
import { Icon, Logo, Toaster, Toolbar, ToolbarButton, ToolbarGroup } from '../ui'
import { useIsMobile } from './viewport'

type Overlay = 'search' | 'notif' | null

/** Which shell overlay is open; the controls live in the NavRail and sidebar, the overlays in AppShell. */
export const useShellOverlay = create<{ overlay: Overlay; set: (o: Overlay) => void }>()((set) => ({
  overlay: null,
  set: (overlay) => set({ overlay }),
}))

/** Compact toolbar row and search field at the top of the conversation sidebar. */
export function ShellBar({ onNewGroup }: { onNewGroup?: () => void }) {
  const set = useShellOverlay((s) => s.set)
  const mobile = useIsMobile()
  const multiTeam = useMultiTeam()
  return (
    <div className="shellbar">
      <Toolbar leading={<Logo size={20} />} title={multiTeam ? undefined : t('共工空间')} scrolled={false}>
        <TeamSwitcher />
        {onNewGroup ? (
          <ToolbarGroup>
            <ToolbarButton icon="plus" label={t('新建群')} onClick={onNewGroup} />
          </ToolbarGroup>
        ) : null}
      </Toolbar>
      <button
        type="button"
        className="shellbar__search"
        aria-label={t('搜索消息、文件、运行')}
        onClick={() => set('search')}
      >
        <Icon name="search" size={13} weight={1.7} />
        <span className="shellbar__placeholder">{t('搜索')}</span>
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
          {t('连接已断开，正在重连…')}
        </div>
      ) : null}
      <div className="app__body">
        <Outlet />
      </div>
      <NotificationPanel open={overlay === 'notif'} onClose={close} />
      {overlay === 'search' ? <SearchOverlay onClose={close} /> : null}
      <SettingsHost />
      <Toaster />
    </div>
  )
}
