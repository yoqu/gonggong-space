import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ChangePasswordPage } from '../features/auth/ChangePasswordPage'
import { useFeishuLinkResult } from '../features/feishu/login'
import { applyTeamEvent } from '../features/teams/store'
import { t } from '../i18n'
import { toastError } from '../lib/errors'
import { realtime } from '../lib/realtime'
import { Alert, Button, Mascot } from '../ui'
import { useSession } from './session'
import { loadWorkspace, useWorkspace } from './workspace'

export function RequireSession() {
  const { user, tenancy, status, load } = useSession()
  const { pathname, search } = useLocation()
  // Without a team there is nothing to chat in (plan /welcome); sysadmins may still run the platform from /admin.
  const teamless = tenancy?.teams.length === 0
  // The workspace endpoints refuse a user who still has to change the initial password, or one in no team.
  const userId = user && !user.mustChangePassword && !teamless ? user.id : undefined

  useFeishuLinkResult(!!user)

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  useEffect(() => {
    if (!userId) return
    const off = realtime.subscribe(useWorkspace.getState().applyEvent)
    const offTeams = realtime.subscribe(applyTeamEvent)
    realtime.start()
    loadWorkspace().catch((e) => toastError(e, t('加载工作区失败')))
    return () => {
      off()
      offTeams()
      realtime.stop()
    }
  }, [userId])

  if (status === 'error')
    return (
      <div className="app-center">
        <Alert variant="error" title={t('无法连接服务器')} description={t('请检查网络或服务器状态后重试。')}>
          <div style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => void load()}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      </div>
    )
  if (status !== 'ready')
    return (
      <div className="app-center app-splash" role="status">
        <Mascot action="wait" size={96} />
        <span className="app-splash__name">{t('共工空间')}</span>
        <span className="app-splash__hint">{t('正在连接…')}</span>
      </div>
    )
  if (!user)
    return (
      <Navigate
        to={pathname === '/' && !search ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`}
        replace
      />
    )
  if (user.mustChangePassword) return <ChangePasswordPage />
  if (teamless && pathname !== '/welcome' && !(user.role === 'sysadmin' && pathname.startsWith('/admin')))
    return <Navigate to="/welcome" replace />
  return <Outlet />
}
