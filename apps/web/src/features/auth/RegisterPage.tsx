import type { MeDto } from '@gonggong/protocol'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Icon, SecureField, TextField } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from './AuthCard'
import { useAuthOptions } from './options'

const ACCOUNT_RE = /^[a-z0-9_.-]{2,32}$/
const MIN_PASSWORD = 8

/** Self sign-up while the sysadmin has opened registration (系统参数 · 开放自助注册), or with a team invite (plan D12). */
export function RegisterPage() {
  const { user, setUser } = useSession()
  const navigate = useNavigate()
  const invite = useSearchParams()[0].get('invite')
  const options = useAuthOptions()
  const [form, setForm] = useState({ account: '', name: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<SubmitPhase>('idle')

  if (user && phase !== 'done') return <Navigate to="/" replace />

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setError('')
  }
  const fail = (message: string) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (phase !== 'idle') return
    const account = form.account.trim()
    if (!ACCOUNT_RE.test(account)) return fail(t('账号需为 2–32 位小写字母、数字或 . _ -'))
    if (!form.name.trim()) return fail(t('请填写姓名'))
    if (form.password.length < MIN_PASSWORD) return fail(t('密码至少 {n} 位', { n: MIN_PASSWORD }))
    if (form.password !== form.confirm) return fail(t('两次输入的密码不一致'))
    setPhase('busy')
    try {
      const me = await api.post<MeDto>('/auth/register', {
        account,
        name: form.name.trim(),
        password: form.password,
        inviteToken: invite ?? undefined,
      })
      setPhase('done')
      setTimeout(() => {
        setUser(me)
        navigate(invite ? `/join/${invite}` : '/', { replace: true })
      }, 420)
    } catch (err) {
      fail(errorText(err))
      setPhase('idle')
    }
  }

  const closed = options?.registrationOpen === false && !invite
  return (
    <AuthCard
      testId="register-page"
      variant="register"
      title={t('注册')}
      subtitle={
        closed
          ? t('当前未开放注册，请联系系统管理员创建账号。')
          : t('注册后即可加入群、绑定机器、创建你的 Bot。')
      }
      errorKey={errorKey}
      leaving={phase === 'done'}
      onSubmit={submit}
      footer={
        <p className="auth__foot">
          {t('已有账号？')}
          <Link to="/login" className="auth__link">
            {t('去登录')}
          </Link>
        </p>
      }
    >
      {closed ? null : (
        <>
          <div className="auth__fields">
            <TextField
              label={t('账号')}
              size="large"
              autoComplete="username"
              placeholder={t('登录用，如 wanglei')}
              value={form.account}
              onChange={set('account')}
              autoFocus
            />
            <TextField
              label={t('姓名')}
              size="large"
              autoComplete="name"
              placeholder={t('群里显示的名字')}
              value={form.name}
              onChange={set('name')}
            />
            <SecureField
              label={t('密码')}
              size="large"
              autoComplete="new-password"
              placeholder={t('至少 {n} 位', { n: MIN_PASSWORD })}
              value={form.password}
              onChange={set('password')}
            />
            <SecureField
              label={t('确认密码')}
              size="large"
              autoComplete="new-password"
              value={form.confirm}
              onChange={set('confirm')}
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
          <AuthSubmit phase={phase} label={t('注册并进入')} busy={t('注册中…')} done={t('注册成功')} />
        </>
      )}
    </AuthCard>
  )
}
