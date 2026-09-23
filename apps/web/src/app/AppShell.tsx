import { PROTOCOL_VERSION } from '@aiws/protocol'
import { Bell, Radar, Search, SlidersHorizontal } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { useRealtimeStatus } from '../lib/realtime'
import { Toaster } from '../ui'
import { useSession } from './session'
import { useIsMobile } from './viewport'
import { useWorkspace } from './workspace'

const CONN = {
  open: { label: '已连接', color: 'var(--color-success)' },
  connecting: { label: '连接中…', color: 'var(--color-warning)' },
  closed: { label: '已断开 · 重连中', color: 'var(--color-danger)' },
}

export function TopBar({
  onSearch,
  onNotifications,
}: {
  onSearch?: () => void
  onNotifications?: () => void
}) {
  const user = useSession((s) => s.user)
  const notifCount = useWorkspace((s) => s.notifCount)
  const mobile = useIsMobile()
  return (
    <header className="topbar">
      <Link to="/" className="topbar__brand">
        <span className="brand-mark">
          <Radar size={14} />
        </span>
        {mobile ? null : <span className="topbar__title">AI 团队工作区</span>}
      </Link>
      <button type="button" className="topbar__search" onClick={onSearch}>
        <Search size={13} />
        <span className="topbar__search-text">搜索消息、文件、运行</span>
        {mobile ? null : <kbd className="topbar__kbd">⌘K</kbd>}
      </button>
      <div className="topbar__actions">
        {user?.role === 'sysadmin' ? (
          <Link to="/admin" className="topbar__link" title="管理后台">
            <SlidersHorizontal size={13} />
            {mobile ? null : <span>管理后台</span>}
          </Link>
        ) : null}
        <button
          type="button"
          className="topbar__bell"
          title="通知"
          aria-label="通知"
          onClick={onNotifications}
        >
          <Bell size={15} />
          {notifCount > 0 ? (
            <span className="topbar__count">{notifCount > 99 ? '99+' : notifCount}</span>
          ) : null}
        </button>
        {user ? (
          <button type="button" className="topbar__avatar" aria-label={user.name} title={user.name}>
            {Array.from(user.name)[0]}
          </button>
        ) : null}
      </div>
    </header>
  )
}

export function StatusBar() {
  const conn = CONN[useRealtimeStatus()]
  const online = useWorkspace(
    (s) => s.bots.filter((b) => b.presence === 'online' || b.presence === 'running').length,
  )
  return (
    <footer className="statusbar">
      <span className="statusbar__conn">
        <span className="dot dot--sm" style={{ background: conn.color }} />
        {conn.label}
      </span>
      <span>|</span>
      <span>bot {online} 个在线</span>
      <span className="spacer" />
      <span>协议 v{PROTOCOL_VERSION}</span>
    </footer>
  )
}

export function AppShell() {
  const mobile = useIsMobile()
  return (
    <div className="app">
      <TopBar />
      <div className="app__body">
        <Outlet />
      </div>
      {mobile ? null : <StatusBar />}
      <Toaster />
    </div>
  )
}
