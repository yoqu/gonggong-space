import type { CSSProperties } from 'react'
import { Link, Navigate, NavLink, Outlet } from 'react-router'
import { useSession } from '../../app/session'
import { Icon, Logo, Toaster } from '../../ui'
import '../../ui/sidebar.css'
import { ADMIN_NAV } from './nav'
import './admin.css'

/** 管理后台 shell: a flush Pane sidebar (a scrolling tab row under 768px) beside the page. Members manage their own bots and machines in the chat UI. */
export function AdminLayout() {
  const user = useSession((s) => s.user)
  if (user?.role !== 'sysadmin') return <Navigate to="/" replace />
  return (
    <div className="admin">
      <nav className="ui-sidebar admin__nav" aria-label="管理后台">
        <div className="admin__brand">
          <Logo size={20} />
          <span className="admin__product">共工</span>
          <span className="admin__crumb">管理后台</span>
        </div>
        {ADMIN_NAV.map((g) => (
          <div key={g.head} className="ui-sidebar__section">
            <div className="ui-sidebar__title">{g.head}</div>
            {g.items.map((i) => (
              <NavLink key={i.path} to={`/admin/${i.path}`} className="ui-sidebar__item">
                <span className="ui-sidebar__icon" style={{ '--icon-color': i.color } as CSSProperties}>
                  <Icon name={i.icon} />
                </span>
                <span className="ui-sidebar__label">{i.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="ui-sidebar__section admin__back">
          <Link to="/" className="ui-sidebar__item">
            <span className="ui-sidebar__icon">
              <Icon name="bubble" />
            </span>
            <span className="ui-sidebar__label">返回群聊</span>
          </Link>
        </div>
      </nav>
      <main className="admin__main">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

export function AdminIndex() {
  return <Navigate to={`/admin/${ADMIN_NAV[0]?.items[0]?.path}`} replace />
}
