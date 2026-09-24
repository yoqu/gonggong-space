import { MessageSquare, Radar } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet } from 'react-router'
import { useSession } from '../../app/session'
import { Toaster } from '../../ui'
import { AccountMenu, ROLE_LABEL } from '../auth/AccountMenu'
import { ADMIN_NAV } from './nav'
import './admin.css'

/** 管理后台.dc.html shell: title bar + grouped left nav (a scrolling tab row under 768px). Members manage their own bots and machines in the chat UI. */
export function AdminLayout() {
  const user = useSession((s) => s.user)
  if (user?.role !== 'sysadmin') return <Navigate to="/" replace />
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
        <span className="admin__role" data-testid="admin-role">
          {user.name}
          {user.name === ROLE_LABEL[user.role] ? null : (
            <span className="admin__role-badge">{ROLE_LABEL[user.role]}</span>
          )}
        </span>
        <AccountMenu />
      </header>
      <div className="admin__body">
        <nav className="admin__nav" aria-label="管理后台">
          {ADMIN_NAV.map((g) => (
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
  return <Navigate to={`/admin/${ADMIN_NAV[0]?.items[0]?.path}`} replace />
}
