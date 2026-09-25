import { useNavigate } from 'react-router'
import { AccountMenu } from '../features/auth/AccountMenu'
import { NavRail, type NavRailItem } from '../ui'
import { useShellOverlay } from './AppShell'
import { useSession } from './session'
import { useWorkspace } from './workspace'

/** Chat window NavRail (D12): 消息 / 通知 / 管理后台 (sysadmin) and the account menu at its foot. */
export function AppRail({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const navigate = useNavigate()
  const admin = useSession((s) => s.user?.role === 'sysadmin')
  const unread = useWorkspace((s) => s.groups.reduce((n, g) => n + (g.muted ? 0 : g.unread), 0))
  const notifCount = useWorkspace((s) => s.notifCount)
  const { overlay, set } = useShellOverlay()
  const bar = orientation === 'horizontal'
  const items: NavRailItem[] = [
    { id: 'chat', label: '消息', icon: 'message', badge: unread },
    { id: 'notif', label: '通知', icon: 'bell', badge: notifCount },
  ]
  const adminItems: NavRailItem[] = admin ? [{ id: 'admin', label: '管理后台', icon: 'shield-check' }] : []
  const select = (id: string) => {
    if (id === 'admin') navigate('/admin')
    else set(id === 'notif' && overlay !== 'notif' ? 'notif' : null)
  }
  return (
    <NavRail
      orientation={orientation}
      items={bar ? [...items, ...adminItems] : items}
      footer={!bar && admin ? adminItems : undefined}
      selected={overlay === 'notif' ? 'notif' : 'chat'}
      onSelect={select}
      trailing={<AccountMenu size={bar ? 24 : 32} align={bar ? 'end' : 'start'} placement="above" />}
    />
  )
}
