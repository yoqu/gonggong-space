import type { UserDto } from '@aiws/protocol'
import { type FormEvent, useState } from 'react'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { Alert, Button, Field, Input } from '../../ui'
import { AuthCard, errorText } from './AuthCard'
import { logout } from './logout'

const MIN_LENGTH = 8

/** Shown instead of the app while `mustChangePassword` is set (first login with an admin-issued password). */
export function ChangePasswordPage() {
  const setUser = useSession((s) => s.setUser)
  const [form, setForm] = useState({ old: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (form.next.length < MIN_LENGTH) return setError(`新密码至少 ${MIN_LENGTH} 位`)
    if (form.next !== form.confirm) return setError('两次输入的新密码不一致')
    setBusy(true)
    setError('')
    try {
      setUser(await api.post<UserDto>('/auth/password', { oldPassword: form.old, newPassword: form.next }))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="修改密码"
      subtitle="首次登录需修改管理员设置的初始密码；修改后其他设备上的登录将失效。"
      onSubmit={submit}
    >
      <div className="auth__fields">
        <Field label="当前密码">
          <Input
            type="password"
            autoComplete="current-password"
            value={form.old}
            onChange={set('old')}
            autoFocus
          />
        </Field>
        <Field label="新密码">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={`至少 ${MIN_LENGTH} 位`}
            value={form.next}
            onChange={set('next')}
          />
        </Field>
        <Field label="确认新密码">
          <Input type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
        </Field>
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || !form.old || !form.next}>
        修改密码
      </Button>
      <button type="button" className="auth__link" onClick={() => void logout()}>
        退出登录
      </button>
    </AuthCard>
  )
}
