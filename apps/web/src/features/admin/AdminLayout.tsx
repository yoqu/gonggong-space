import { MessageSquare, Radar } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet } from 'react-router'
import { useSession } from '../../app/session'
import { Toaster } from '../../ui'
import { AccountMenu, ROLE_LABEL } from '../auth/AccountMenu'
import { ADMIN_NAV } from './nav'
import './admin.css'

function visibleNav(role: string | undefined) {
  return ADMIN_NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => role === 'sysadmin' || !i.sysadminOnly),
  })).filter((g) => g.items.length)
}

/** 管理后台.dc.html shell: title bar + grouped left nav (a scrolling tab row under 768px). */
export function AdminLayout() {
  const user = useSession((s) => s.user)
  return (
    <div className="admin">
      <header className="admin__bar">
        <span className="brand-mark">
          <Radar size={14} />
        </span>
        <span className="admin__product">AI 团队工作区</span>
        <span className="admin__slash">/</span>
        <span className="admin__crumb">管理后台</span>
        <span className="spacer" />
        <Link to="/" className="admin__back">
          <MessageSquare size={13} />
          返回群聊
        </Link>
        {user ? <span className="admin__role">{`${user.name} · ${ROLE_LABEL[user.role]}`}</span> : null}
        <AccountMenu />
      </header>
      <div className="admin__body">
        <nav className="admin__nav" aria-label="管理后台">
          {visibleNav(user?.role).map((g) => (
            <div key={g.head} className="admin__group">
              <div className="admin__head">{g.head}</div>
              {g.items.map((i) => (
                <NavLink key={i.path} to={`/admin/${i.path}`} className="admin__item">
                  <i.icon size={14} />
                  <span>{i.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <main className="admin__main">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}

export function AdminIndex() {
  const role = useSession((s) => s.user?.role)
  return <Navigate to={`/admin/${visibleNav(role)[0]?.items[0]?.path ?? 'bots'}`} replace />
}
