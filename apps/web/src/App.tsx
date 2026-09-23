import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AppShell } from './app/AppShell'
import { ChatPage } from './app/ChatPage'
import { RequireSession } from './app/RequireSession'
import { AdminIndex, AdminLayout } from './features/admin/AdminLayout'
import { AdminPlaceholder } from './features/admin/AdminPage'
import { ADMIN_NAV } from './features/admin/nav'
import { LoginPage } from './features/auth/LoginPage'
import './app/shell.css'

const UiGallery = lazy(() => import('./app/UiGallery'))

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {import.meta.env.DEV ? (
        <Route
          path="/_ui"
          element={
            <Suspense>
              <UiGallery />
            </Suspense>
          }
        />
      ) : null}
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<ChatPage />} />
          <Route path="g/:groupId" element={<ChatPage />} />
        </Route>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          {ADMIN_NAV.flatMap((g) => g.items).map((i) => (
            <Route key={i.path} path={i.path} element={i.element ?? <AdminPlaceholder item={i} />} />
          ))}
        </Route>
      </Route>
    </Routes>
  )
}
