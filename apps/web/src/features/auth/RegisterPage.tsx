import type { UserDto } from '@gonggong/protocol'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { Button, Icon, Spinner, TextField } from '../../ui'
import { AuthCard, errorText } from './AuthCard'
import { useAuthOptions } from './options'
import { PasswordField } from './PasswordInput'

const ACCOUNT_RE = /^[a-z0-9_.-]{2,32}$/
const MIN_PASSWORD = 8

/** Self sign-up, reachable only while the sysadmin has opened registration (系统参数 · 开放自助注册). */
export function RegisterPage() {
  const { user, setUser } = useSession()
  const navigate = useNavigate()
  const options = useAuthOptions()
  const [form, setForm] = useState({ account: '', name: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle')

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
    if (!ACCOUNT_RE.test(account)) return fail('账号需为 2–32 位小写字母、数字或 . _ -')
    if (!form.name.trim()) return fail('请填写姓名')
    if (form.password.length < MIN_PASSWORD) return fail(`密码至少 ${MIN_PASSWORD} 位`)
    if (form.password !== form.confirm) return fail('两次输入的密码不一致')
    setPhase('busy')
    try {
      const me = await api.post<UserDto>('/auth/register', {
        account,
        name: form.name.trim(),
        password: form.password,
      })
      setPhase('done')
      setTimeout(() => {
        setUser(me)
        navigate('/', { replace: true })
      }, 420)
    } catch (err) {
      fail(errorText(err))
      setPhase('idle')
    }
  }

  const closed = options?.registrationOpen === false
  return (
    <AuthCard
      testId="register-page"
      title="注册"
      subtitle={
        closed ? '当前未开放注册，请联系系统管理员创建账号。' : '注册后即可加入群、绑定机器、创建你的 Bot。'
      }
      errorKey={errorKey}
      leaving={phase === 'done'}
      onSubmit={submit}
      footer={
        <p className="auth__foot">
          已有账号？
          <Link to="/login" className="auth__link">
            去登录
          </Link>
        </p>
      }
    >
      {closed ? null : (
        <>
          <div className="auth__fields">
            <TextField
              label="账号"
              size="large"
              autoComplete="username"
              placeholder="登录用，如 wanglei"
              value={form.account}
              onChange={set('account')}
              autoFocus
            />
            <TextField
              label="姓名"
              size="large"
              autoComplete="name"
              placeholder="群里显示的名字"
              value={form.name}
              onChange={set('name')}
            />
            <PasswordField
              label="密码"
              autoComplete="new-password"
              placeholder={`至少 ${MIN_PASSWORD} 位`}
              value={form.password}
              onChange={set('password')}
            />
            <PasswordField
              label="确认密码"
              autoComplete="new-password"
              value={form.confirm}
              onChange={set('confirm')}
            >
              <p className="auth-error" role="alert" data-shown={error ? true : undefined}>
                {error ? (
                  <>
                    <Icon name="warning" size={13} />
                    {error}
                  </>
                ) : null}
              </p>
            </PasswordField>
          </div>
          <Button
            type="submit"
            variant="primary"
            size="xlarge"
            fullWidth
            className="auth__submit"
            data-phase={phase}
            aria-busy={phase === 'busy' || undefined}
          >
            {phase === 'busy' ? (
              <>
                <Spinner size={14} color="currentColor" />
                注册中…
              </>
            ) : phase === 'done' ? (
              <>
                <Icon name="check" weight={2.4} />
                注册成功
              </>
            ) : (
              '注册并进入'
            )}
          </Button>
        </>
      )}
    </AuthCard>
  )
}
