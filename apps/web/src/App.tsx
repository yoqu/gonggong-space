import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router'
import { AppShell } from './app/AppShell'
import { ChatPage } from './app/ChatPage'
import { RequireSession } from './app/RequireSession'
import { AdminIndex, AdminLayout } from './features/admin/AdminLayout'
import { AdminPlaceholder } from './features/admin/AdminPage'
import { ADMIN_NAV } from './features/admin/nav'
import { LoginPage } from './features/auth/LoginPage'
import { RegisterPage } from './features/auth/RegisterPage'
import { EmptyState } from './ui'
import './app/shell.css'

const UiGallery = lazy(() => import('./app/UiGallery'))

function NotFound() {
  return (
    <div className="not-found">
      <EmptyState
        bare
        title="页面不存在"
        description="链接可能已失效，或你没有访问权限。"
        actions={
          <Link to="/" className="ui-btn ui-btn--primary ui-btn--md">
            返回消息
          </Link>
        }
      />
    </div>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
          <Route path="bot/:botId" element={<ChatPage />} />
        </Route>
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          {ADMIN_NAV.flatMap((g) => g.items).map((i) => (
            <Route key={i.path} path={i.path} element={i.element ?? <AdminPlaceholder item={i} />} />
          ))}
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
