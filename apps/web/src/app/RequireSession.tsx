import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { realtime } from '../lib/realtime'
import { Alert, Button, Mascot, toast } from '../ui'
import { useSession } from './session'
import { loadWorkspace, useWorkspace } from './workspace'

export function RequireSession() {
  const { user, status, load } = useSession()
  // The workspace endpoints refuse a user who still has to change the initial password.
  const userId = user && !user.mustChangePassword ? user.id : undefined

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  useEffect(() => {
    if (!userId) return
    const off = realtime.subscribe(useWorkspace.getState().applyEvent)
    realtime.start()
    loadWorkspace().catch((e: Error) => toast({ type: 'error', title: '加载工作区失败', message: e.message }))
    return () => {
      off()
      realtime.stop()
    }
  }, [userId])

  if (status === 'error')
    return (
      <div className="app-center">
        <Alert variant="error" title="无法连接服务器" description="请检查网络或服务器状态后重试。">
          <div style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        </Alert>
      </div>
    )
  if (status !== 'ready')
    return (
      <div className="app-center app-splash" role="status">
        <Mascot action="run" size={96} />
        <span className="app-splash__name">共工</span>
        <span className="app-splash__hint">正在连接…</span>
      </div>
    )
  if (!user) return <Navigate to="/login" replace />
  if (user.mustChangePassword) return <ChangePasswordPage />
  return <Outlet />
}
