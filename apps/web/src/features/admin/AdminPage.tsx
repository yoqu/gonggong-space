import type { ReactNode } from 'react'
import { useSession } from '../../app/session'
import { ComingSoonArt, EmptyState, Toolbar } from '../../ui'
import { AccountMenu, ROLE_LABEL } from '../auth/AccountMenu'
import type { AdminItem } from './nav'

function Account() {
  const user = useSession((s) => s.user)
  if (!user) return null
  return (
    <>
      <span className="admin__role" data-testid="admin-role">
        {user.name}
        {user.name === ROLE_LABEL[user.role] ? null : (
          <span className="admin__role-badge">{ROLE_LABEL[user.role]}</span>
        )}
      </span>
      <AccountMenu />
    </>
  )
}

/** Admin page frame: unified toolbar (title, count, actions, search, account), a one-line description, then content. */
export function AdminPage({
  title,
  desc,
  subtitle,
  actions,
  search,
  children,
}: {
  title: string
  desc: string
  /** Toolbar subtitle, usually a count. */
  subtitle?: ReactNode
  /** ToolbarGroups or buttons. */
  actions?: ReactNode
  /** A SearchField, placed rightmost among the page controls. */
  search?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <Toolbar title={title} subtitle={subtitle} className="admin__toolbar">
        {actions}
        {search}
        <span className="admin__account">
          <Account />
        </span>
      </Toolbar>
      <div className="admin__page">
        <p className="admin__desc">{desc}</p>
        {children}
      </div>
    </>
  )
}

/** Stands in for pages other slices have not delivered yet. */
export function AdminPlaceholder({ item }: { item: AdminItem }) {
  return (
    <AdminPage title={item.label} desc={item.desc}>
      <EmptyState illustration={<ComingSoonArt />} title="即将上线" description="该页面正在开发中。" />
    </AdminPage>
  )
}
