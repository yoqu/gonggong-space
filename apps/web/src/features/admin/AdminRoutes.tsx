import { Route, Routes } from 'react-router'
import { NotFound } from '../../app/NotFound'
import { AdminIndex, AdminLayout } from './AdminLayout'
import { ADMIN_NAV } from './nav'

/** The whole 管理后台 under `/admin/*`, split out of the entry bundle since only sysadmins open it. */
export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminIndex />} />
        {ADMIN_NAV.flatMap((g) => g.items).map((i) => (
          <Route key={i.path} path={i.path} element={i.element} />
        ))}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
