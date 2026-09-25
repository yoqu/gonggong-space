import type { UserDto } from '@gonggong/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type FormEvent, useState } from 'react'
import { useSession } from '../../app/session'
import { api } from '../../lib/api'
import { Alert, Button, Dialog, Icon, SecureField, Spinner, toast } from '../../ui'
import { AuthCard, errorText } from './AuthCard'
import { logout } from './logout'

const MIN_LENGTH = 8
const STRENGTH = ['', '较弱', '一般', '较强', '很强'] as const

/** 0–4: length plus character variety; advisory only, the server enforces just the minimum length. */
function strength(pw: string) {
  if (!pw) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length
  if (pw.length < MIN_LENGTH) return 1
  return Math.min(4, 1 + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (pw.length >= 12 ? 1 : 0))
}

type Phase = 'idle' | 'busy' | 'done'
type RuleState = 'ok' | 'bad' | undefined

function usePasswordChange(onChanged: (me: UserDto) => void) {
  const [form, setForm] = useState({ old: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [confirmLeft, setConfirmLeft] = useState(false)
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
    if (!form.old) return fail('请输入原密码')
    if (form.next.length < MIN_LENGTH) return fail(`新密码至少 ${MIN_LENGTH} 位`)
    if (form.next !== form.confirm) return fail('两次输入的新密码不一致')
    if (form.next === form.old) return fail('新密码不能与原密码相同')
    setPhase('busy')
    try {
      const me = await api.post<UserDto>('/auth/password', { oldPassword: form.old, newPassword: form.next })
      setPhase('done')
      setTimeout(() => onChanged(me), 420)
    } catch (err) {
      fail(errorText(err))
      setPhase('idle')
    }
  }

  // Red only once the confirm is complete (as long as the new password, or left): neutral while still typing.
  const mismatch =
    !!form.confirm && form.confirm !== form.next && (confirmLeft || form.confirm.length >= form.next.length)
  const rules: { label: string; state: RuleState }[] = [
    { label: `至少 ${MIN_LENGTH} 位`, state: form.next.length >= MIN_LENGTH ? 'ok' : undefined },
    {
      label: '与原密码不同',
      state: !form.next || !form.old ? undefined : form.next === form.old ? 'bad' : 'ok',
    },
    {
      label: '两次输入一致',
      state: mismatch ? 'bad' : form.confirm && form.confirm === form.next ? 'ok' : undefined,
    },
  ]
  return { form, set, error, errorKey, phase, submit, rules, mismatch, setConfirmLeft }
}

type PasswordChange = ReturnType<typeof usePasswordChange>

function SubmitContent({ phase, label }: { phase: Phase; label: string }) {
  if (phase === 'busy')
    return (
      <>
        <Spinner size={14} color="currentColor" />
        保存中…
      </>
    )
  if (phase === 'done')
    return (
      <>
        <Icon name="check" weight={2.4} />
        已更新
      </>
    )
  return label
}

function PasswordChangeFields({
  pc,
  oldLabel,
  submitLabel,
}: {
  pc: PasswordChange
  oldLabel: string
  /** Omit when the surrounding dialog puts the submit button in its footer. */
  submitLabel?: string
}) {
  const size = submitLabel ? 'large' : 'regular'
  const { form, set, error, phase, rules, mismatch, setConfirmLeft } = pc
  const score = strength(form.next)
  return (
    <>
      <div className="auth__fields">
        <SecureField
          label={oldLabel}
          size={size}
          autoComplete="current-password"
          value={form.old}
          onChange={set('old')}
          autoFocus
        />
        <SecureField
          label="新密码"
          size={size}
          autoComplete="new-password"
          placeholder={`至少 ${MIN_LENGTH} 位`}
          value={form.next}
          onChange={set('next')}
        />
        <div className="auth-meter" data-score={score} aria-live="polite">
          <span className="auth-meter__bars">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} data-on={score >= i || undefined} />
            ))}
          </span>
          <span className="auth-meter__label">
            {form.next ? `强度：${STRENGTH[score]}` : '建议混合字母、数字和符号'}
          </span>
        </div>
        <SecureField
          label="确认新密码"
          size={size}
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          onFocus={() => setConfirmLeft(false)}
          onBlur={() => setConfirmLeft(true)}
          aria-invalid={mismatch || undefined}
        />
      </div>
      <ul className="auth-rules">
        {rules.map((r) => (
          <li key={r.label} data-state={r.state}>
            <span className="auth-rules__mark">
              {r.state === 'ok' ? (
                <Icon name="check" size={10} weight={2.6} />
              ) : r.state === 'bad' ? (
                <Icon name="xmark" size={10} weight={2.6} />
              ) : null}
            </span>
            {r.label}
          </li>
        ))}
      </ul>
      <AnimatePresence initial={false}>
        {error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Alert variant="error" description={error} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      {submitLabel ? (
        <Button
          type="submit"
          variant="primary"
          size="xlarge"
          fullWidth
          className="auth__submit"
          data-phase={phase}
          aria-busy={phase === 'busy' || undefined}
        >
          <SubmitContent phase={phase} label={submitLabel} />
        </Button>
      ) : null}
    </>
  )
}

/** Shown instead of the app while `mustChangePassword` is set (first login with an admin-issued password). */
export function ChangePasswordPage() {
  const setUser = useSession((s) => s.setUser)
  const pc = usePasswordChange((me) => {
    setUser(me)
    toast({ type: 'success', message: '密码已更新，欢迎加入共工' })
  })
  return (
    <AuthCard
      variant="password"
      title="修改密码"
      subtitle="首次登录需修改管理员设置的初始密码。"
      errorKey={pc.errorKey}
      leaving={pc.phase === 'done'}
      onSubmit={pc.submit}
      footer={
        <button type="button" className="auth__link auth__foot" onClick={() => void logout()}>
          退出登录
        </button>
      }
    >
      <PasswordChangeFields pc={pc} oldLabel="初始密码" submitLabel="修改密码" />
    </AuthCard>
  )
}

/** Account menu → 修改密码: same form in a dialog; the server signs out the other sessions. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const setUser = useSession((s) => s.setUser)
  const pc = usePasswordChange((me) => {
    setUser(me)
    toast({ type: 'success', message: '密码已修改，其他设备上的登录已失效' })
    onClose()
  })
  return (
    <Dialog
      open
      title="修改密码"
      message="修改后，其他设备上的登录会失效。"
      onClose={onClose}
      closeOnBackdrop={false}
      width={420}
      actions={[
        { label: '取消', onClick: onClose },
        {
          label: pc.phase === 'busy' ? '保存中…' : '保存新密码',
          variant: 'primary',
          type: 'submit',
          form: 'change-password',
          disabled: pc.phase !== 'idle',
        },
      ]}
    >
      <form id="change-password" className="auth-dialog" onSubmit={pc.submit} noValidate>
        <PasswordChangeFields pc={pc} oldLabel="当前密码" />
      </form>
    </Dialog>
  )
}
