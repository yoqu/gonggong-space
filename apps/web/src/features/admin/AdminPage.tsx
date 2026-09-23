import type { ReactNode } from 'react'
import { EmptyState } from '../../ui'
import type { AdminItem } from './nav'

/** Page frame of 管理后台.dc.html: title, subtitle, optional primary action, then content. */
export function AdminPage({
  title,
  desc,
  actions,
  children,
}: {
  title: string
  desc: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="admin__page">
      <div className="admin__page-head">
        <div className="admin__titles">
          <h1 className="admin__title">{title}</h1>
          <p className="admin__desc">{desc}</p>
        </div>
        <span className="spacer" />
        {actions}
      </div>
      {children}
    </div>
  )
}

/** Stands in for pages other slices have not delivered yet. */
export function AdminPlaceholder({ item }: { item: AdminItem }) {
  return (
    <AdminPage title={item.label} desc={item.desc}>
      <EmptyState icon={<item.icon size={20} />} title="即将上线" description="该页面正在开发中。" />
    </AdminPage>
  )
}
