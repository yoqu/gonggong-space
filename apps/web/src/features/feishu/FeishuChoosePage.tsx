import type { FeishuTicketDto, MeDto } from '@gonggong/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Button, Icon, SecureField, TextField } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from '../auth/AuthCard'
import './login.css'

/** First 飞书登录 of a Feishu user no account is linked to: 绑定已有账号, or 新建账号 when allowed. */
export function FeishuChoosePage() {
  const ticket = useSearchParams()[0].get('ticket') ?? ''
  const { setUser } = useSession()
  const navigate = useNavigate()
  const [info, setInfo] = useState<FeishuTicketDto | null>(null)
  const [expired, setExpired] = useState('')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [creating, setCreating] = useState(false)
  const base = `/auth/feishu/ticket/${encodeURIComponent(ticket)}`

  useEffect(() => {
    api.get<FeishuTicketDto>(base).then(setInfo, (e) => setExpired(errorText(e)))
  }, [base])

  const enter = (me: MeDto) => {
    setPhase('done')
    setTimeout(() => {
      setUser(me)
      navigate(info?.next ?? '/', { replace: true })
    }, 420)
  }
  const fail = (message: string) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  async function bind(e: FormEvent) {
    e.preventDefault()
    if (phase !== 'idle') return
    if (!account.trim() || !password) return fail(account.trim() ? t('请输入密码') : t('请输入账号'))
    setPhase('busy')
    setError('')
    try {
      enter(await api.post<MeDto>(`${base}/bind`, { account: account.trim(), password }))
    } catch (err) {
      fail(errorText(err))
      setPhase('idle')
    }
  }

  async function create() {
    setCreating(true)
    try {
      enter(await api.post<MeDto>(`${base}/create`))
    } catch (err) {
      fail(errorText(err))
      setCreating(false)
    }
  }

  return (
    <AuthCard
      testId="feishu-choose-page"
      variant="login"
      title={t('飞书登录')}
      subtitle={t('首次使用飞书登录，请绑定已有共工账号或新建账号。')}
      errorKey={errorKey}
      leaving={phase === 'done'}
      onSubmit={bind}
      footer={
        <p className="auth__foot">
          <Link to="/login" className="auth__link">
            {t('返回登录')}
          </Link>
        </p>
      }
    >
      {expired ? (
        <p className="auth-error" role="alert" data-shown>
          <Icon name="exclamation-circle" size={13} />
          {expired}
        </p>
      ) : info ? (
        <>
          <div className="feishu-choose__who">
            <span className="feishu-choose__name">{info.name}</span>
            {info.email ? <span className="feishu-choose__email">{info.email}</span> : null}
          </div>
          <div className="auth__fields">
            <TextField
              label={t('账号')}
              size="large"
              autoComplete="username"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value)
                setError('')
              }}
              autoFocus
            />
            <SecureField
              label={t('密码')}
              size="large"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
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
          <AuthSubmit phase={phase} label={t('绑定并登录')} busy={t('绑定中…')} done={t('登录成功')} />
          {info.canCreate ? (
            <>
              <p className="auth__or">{t('或')}</p>
              <Button size="xlarge" fullWidth loading={creating} disabled={phase !== 'idle'} onClick={create}>
                {t('新建账号')}
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </AuthCard>
  )
}
