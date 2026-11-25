import { type FormEvent, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { Button, Icon, Presence, TextField } from '../../ui'
import { AuthCard, AuthSubmit } from '../auth/AuthCard'
import { logout } from '../auth/logout'
import { tokenOf } from './store'
import { NewTeamSheet } from './TeamSwitcher'

/** /welcome — signed in but in no team yet (plan T4): create a team when allowed, or paste an invite link. */
export function WelcomePage() {
  const tenancy = useSession((s) => s.tenancy)
  const admin = useSession((s) => s.user?.role === 'sysadmin')
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const canCreate = !!tenancy?.canCreateTeam
  if (tenancy?.teams.length) return <Navigate to="/" replace />
  const token = tokenOf(text)
  const fail = (message: string) => {
    setError(message)
    setErrorKey((k) => k + 1)
    inputRef.current?.focus()
  }
  const join = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return fail(t('请输入邀请链接'))
    if (!token) return fail(t('邀请链接格式不正确'))
    navigate(`/join/${token}`)
  }
  return (
    <>
      <AuthCard
        testId="welcome-page"
        variant="register"
        title={canCreate ? t('加入或新建团队') : t('加入团队')}
        subtitle={
          canCreate
            ? t('新建一个团队，或粘贴团队管理员发给你的邀请链接加入。')
            : t('需要加入团队才能使用。请向团队管理员索取邀请链接，粘贴到下方加入。')
        }
        errorKey={errorKey}
        onSubmit={join}
        footer={
          <p className="auth__foot">
            {admin ? (
              <Button variant="plain" onClick={() => navigate('/admin')}>
                {t('进入管理后台')}
              </Button>
            ) : null}
            <Button variant="plain" onClick={() => void logout()}>
              {t('退出登录')}
            </Button>
          </p>
        }
      >
        <div className="auth__fields">
          <TextField
            ref={inputRef}
            label={t('邀请链接')}
            size="large"
            placeholder={`${location.origin}/join/…`}
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value)
              setError('')
            }}
          />
          <p className="auth-error" role="alert" data-shown={error ? true : undefined}>
            {error ? (
              <>
                <Icon name="exclamation-circle" size={13} />
                {error}
              </>
            ) : null}
          </p>
        </div>
        <AuthSubmit phase="idle" label={t('下一步')} busy="" done="" />
        {canCreate ? (
          <>
            <p className="auth__or">{t('或')}</p>
            <Button size="xlarge" fullWidth onClick={() => setCreating(true)}>
              {t('新建团队')}
            </Button>
          </>
        ) : null}
      </AuthCard>
      <Presence>{creating ? <NewTeamSheet onClose={() => setCreating(false)} /> : null}</Presence>
    </>
  )
}
