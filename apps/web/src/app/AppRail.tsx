import { useLocation, useNavigate } from 'react-router'
import { AccountMenu } from '../features/auth/AccountMenu'
import { useWorksShown } from '../features/works/WorksPage'
import { t } from '../i18n'
import { NavRail, type NavRailItem } from '../ui'
import { useShellOverlay } from './AppShell'
import { useIsBuilder } from './builder'
import { isMachinesPath } from './MachineSidebar'
import { useSession } from './session'
import { useSidebarCollapse } from './sidebarCollapse'
import { useWorkbench } from './workbench'
import { alertCount, useWorkspace } from './workspace'

/**
 * Chat window NavRail (D12): 消息 / 作品 (with a creation plugin on) / 市场 / 机器与 Bot / 通知 / 管理后台 (sysadmin)
 * and the account menu. 市场 is visible to all signed-in members; 机器与 Bot is a builder tool hidden from people
 * who only @ bots (its route stays open).
 */
export function AppRail({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const machines = isMachinesPath(pathname)
  const works = isWorksPath(pathname)
  const market = isMarketPath(pathname)
  const worksShown = useWorksShown()
  const builder = useIsBuilder()
  const admin = useSession((s) => s.user?.role === 'sysadmin')
  const unread = useWorkspace((s) => s.groups.reduce((n, g) => n + alertCount(g), 0))
  const notifCount = useWorkspace((s) => s.notifCount)
  const { overlay, set } = useShellOverlay()
  const sidebarCollapsed = useSidebarCollapse((s) => s.collapsed)
  const workbenchFull = useWorkbench((s) => !!s.groupId && s.open && s.mode === 'full')
  const inChat = !machines && !works && !market
  const bar = orientation === 'horizontal'
  const canToggleSidebar = !bar && inChat && overlay !== 'notif'
  const sidebarVisible = !workbenchFull && !sidebarCollapsed
  const items: NavRailItem[] = [
    {
      id: 'chat',
      label: t('消息'),
      icon: 'message',
      badge: unread,
      ...(canToggleSidebar
        ? {
            expanded: sidebarVisible,
            title: sidebarVisible ? t('收起会话列表') : t('展开会话列表'),
          }
        : {}),
    },
    // A hidden entry still shows, selected, while its page is opened directly.
    ...(worksShown || works ? [{ id: 'works', label: t('作品'), icon: 'grid' as const }] : []),
    { id: 'market', label: t('市场'), icon: 'tag' as const },
    ...(builder || machines ? [{ id: 'machines', label: t('电脑与 Bot#nav'), icon: 'server' as const }] : []),
    { id: 'notif', label: t('通知'), icon: 'bell', badge: notifCount },
  ]
  const adminItems: NavRailItem[] = admin
    ? [{ id: 'admin', label: t('管理后台#nav'), icon: 'shield-check' }]
    : []
  const select = (id: string) => {
    if (id === 'admin') navigate('/admin')
    else if (id === 'notif') set(overlay === 'notif' ? null : 'notif')
    else {
      const wasNotif = overlay === 'notif'
      set(null)
      if (id === 'machines' && !machines) navigate('/machines')
      else if (id === 'works' && !works) navigate('/works')
      else if (id === 'market' && !market) navigate('/market')
      else if (id === 'chat') {
        if (!inChat) navigate('/')
        else if (!wasNotif && !bar) {
          if (workbenchFull) {
            useWorkbench.getState().setMode('split')
            useSidebarCollapse.getState().setCollapsed(false)
          } else {
            useSidebarCollapse.getState().toggle()
          }
        }
      }
    }
  }
  return (
    <NavRail
      orientation={orientation}
      items={bar ? [...items, ...adminItems] : items}
      footer={!bar && admin ? adminItems : undefined}
      selected={
        overlay === 'notif' ? 'notif' : machines ? 'machines' : works ? 'works' : market ? 'market' : 'chat'
      }
      onSelect={select}
      trailing={<AccountMenu size={bar ? 24 : 32} align={bar ? 'end' : 'start'} placement="above" />}
    />
  )
}

export const isWorksPath = (pathname: string) => /^\/works(\/|$)/.test(pathname)
export const isMarketPath = (pathname: string) => /^\/market(\/|$)/.test(pathname)
