import { useEffect } from 'react'
import { Navigate, Outlet } from 'react-router'
import { realtime } from '../lib/realtime'
import { Alert, Button, Spinner } from '../ui'
import { useSession } from './session'
import { useWorkspace } from './workspace'

export function RequireSession() {
  const { user, status, load } = useSession()
  const userId = user?.id

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  useEffect(() => {
    if (!userId) return
    const off = realtime.subscribe(useWorkspace.getState().applyEvent)
    realtime.start()
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
      <div className="app-center">
        <Spinner size={18} />
      </div>
    )
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}
