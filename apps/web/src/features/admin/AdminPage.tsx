import type { ReactNode } from 'react'
import { useSession } from '../../app/session'
import { Toolbar } from '../../ui'
import { AccountMenu, ROLE_LABEL } from '../auth/AccountMenu'

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

/** A list's count line, prefixed with how many a search left (「1 / 3 个账号」). */
export const countLine = (label: string, shown: number | undefined, total: number) =>
  shown === undefined || shown === total ? label : `${shown} / ${label}`

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
