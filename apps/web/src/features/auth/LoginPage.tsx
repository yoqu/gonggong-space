import type { UserDto } from '@aiws/protocol'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { Alert, Button, Field, Input } from '../../ui'
import { AuthCard, errorText } from './AuthCard'

export function LoginPage() {
  const { user, setUser } = useSession()
  const navigate = useNavigate()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      setUser(await api.post<UserDto>('/auth/login', { account: account.trim(), password }))
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <AuthCard
      testId="login-page"
      title="登录"
      subtitle="账号由系统管理员创建，首次登录后需修改密码。"
      onSubmit={submit}
    >
      <div className="auth__fields">
        <Field label="账号">
          <Input
            autoComplete="username"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || !account || !password}>
        登录
      </Button>
    </AuthCard>
  )
}
