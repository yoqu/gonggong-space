import { type ComponentType, lazy, type ReactNode, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { AppShell } from './app/AppShell'
import { ChatPage } from './app/ChatPage'
import { NotFound } from './app/NotFound'
import { RequireSession } from './app/RequireSession'
import { Mascot } from './ui'
import './app/shell.css'

const named = <K extends string, M extends Record<K, ComponentType>>(load: () => Promise<M>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))

const LoginPage = named(() => import('./features/auth/LoginPage'), 'LoginPage')
const RegisterPage = named(() => import('./features/auth/RegisterPage'), 'RegisterPage')
const FeishuChoosePage = named(() => import('./features/feishu/FeishuChoosePage'), 'FeishuChoosePage')
const JoinPage = named(() => import('./features/teams/JoinPage'), 'JoinPage')
const WelcomePage = named(() => import('./features/teams/WelcomePage'), 'WelcomePage')
const AdminRoutes = lazy(() => import('./features/admin/AdminRoutes'))
// Behind the DEV check so production builds don't emit the gallery chunk at all.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./app/UiGallery')) : null

// Same delayed splash as the session boot, so a fast chunk load shows nothing.
const loading = (
  <div className="app-center app-splash" role="status">
    <Mascot action="wait" size={96} />
  </div>
)
/** Inside the session gate, so loading a page never unmounts it (and its realtime connection). */
const later = (page: ReactNode) => <Suspense fallback={loading}>{page}</Suspense>

export function App() {
  return (
    <Suspense fallback={loading}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/feishu/choose" element={<FeishuChoosePage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        {UiGallery ? <Route path="/_ui" element={<UiGallery />} /> : null}
        <Route element={<RequireSession />}>
          <Route path="welcome" element={later(<WelcomePage />)} />
          <Route element={<AppShell />}>
            <Route index element={<ChatPage />} />
            <Route path="g/:groupId" element={<ChatPage />} />
            <Route path="bot/:botId" element={<ChatPage />} />
            <Route path="machine/:machineId" element={<ChatPage />} />
          </Route>
          <Route path="admin/*" element={later(<AdminRoutes />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
