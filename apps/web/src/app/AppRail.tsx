import { useLocation, useNavigate } from 'react-router'
import { AccountMenu } from '../features/auth/AccountMenu'
import { useWorksShown } from '../features/works/WorksPage'
import { t } from '../i18n'
import { NavRail, type NavRailItem } from '../ui'
import { useShellOverlay } from './AppShell'
import { useIsBuilder } from './builder'
import { isMachinesPath } from './MachineSidebar'
import { useSession } from './session'
import { alertCount, useWorkspace } from './workspace'

/**
 * Chat window NavRail (D12): 消息 / 作品 (with a creation plugin on) / 市场 / 机器与 Bot / 通知 / 管理后台 (sysadmin)
 * and the account menu. 市场 and 机器与 Bot are builder tools, hidden from people who only @ bots (their routes stay open).
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
  const bar = orientation === 'horizontal'
  const items: NavRailItem[] = [
    { id: 'chat', label: t('消息'), icon: 'message', badge: unread },
    // A hidden entry still shows, selected, while its page is opened directly.
    ...(worksShown || works ? [{ id: 'works', label: t('作品'), icon: 'grid' as const }] : []),
    ...(builder || market ? [{ id: 'market', label: t('市场'), icon: 'tag' as const }] : []),
    ...(builder || machines ? [{ id: 'machines', label: t('机器与 Bot'), icon: 'server' as const }] : []),
    { id: 'notif', label: t('通知'), icon: 'bell', badge: notifCount },
  ]
  const adminItems: NavRailItem[] = admin ? [{ id: 'admin', label: t('管理后台'), icon: 'shield-check' }] : []
  const select = (id: string) => {
    if (id === 'admin') navigate('/admin')
    else if (id === 'notif') set(overlay === 'notif' ? null : 'notif')
    else {
      set(null)
      if (id === 'machines' && !machines) navigate('/machines')
      else if (id === 'works' && !works) navigate('/works')
      else if (id === 'market' && !market) navigate('/market')
      else if (id === 'chat' && (machines || works || market)) navigate('/')
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
