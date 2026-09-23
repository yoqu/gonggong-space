import type { ReactNode } from 'react'
import { EmptyState } from '../../ui'
import type { AdminItem } from './nav'

export function AdminPageHeader({
  title,
  desc,
  actions,
}: {
  title: string
  desc: string
  actions?: ReactNode
}) {
  return (
    <div className="admin__page-head">
      <div className="admin__titles">
        <h1 className="admin__title">{title}</h1>
        <p className="admin__desc">{desc}</p>
      </div>
      <span className="spacer" />
      {actions}
    </div>
  )
}

/** Stands in for pages other slices have not delivered yet. */
export function AdminPlaceholder({ item }: { item: AdminItem }) {
  return (
    <>
      <AdminPageHeader title={item.label} desc={item.desc} />
      <EmptyState icon={<item.icon size={20} />} title="即将上线" description="该页面正在开发中。" />
    </>
  )
}
