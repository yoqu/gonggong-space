import type { UserDto } from '@gonggong/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { api, errorText } from '../../lib/api'
import { Checkbox, Icon, SecureField, TextField } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from './AuthCard'
import { useAuthOptions } from './options'

const ACCOUNT_KEY = 'gonggong.lastAccount'
const remembered = () => {
  try {
    return localStorage.getItem(ACCOUNT_KEY) ?? ''
  } catch {
    return ''
  }
}
const remember = (account: string | null) => {
  try {
    if (account) localStorage.setItem(ACCOUNT_KEY, account)
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // private mode: nothing to remember
  }
}

export function LoginPage() {
  const { user, setUser } = useSession()
  const navigate = useNavigate()
  const [account, setAccount] = useState(remembered)
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(() => remembered() !== '')
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [forgot, setForgot] = useState(false)
  const options = useAuthOptions()
  const accountRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  if (user && phase !== 'done') return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (phase !== 'idle') return
    // Enabled even when empty: pressing it points at what is missing instead of a dead, greyed-out button.
    if (!account.trim() || !password) {
      ;(account.trim() ? passwordRef : accountRef).current?.focus()
      setError(account.trim() ? '请输入密码' : '请输入账号')
      setErrorKey((k) => k + 1)
      return
    }
    setPhase('busy')
    setError('')
    try {
      const me = await api.post<UserDto>('/auth/login', { account: account.trim(), password })
      remember(keep ? account.trim() : null)
      setPhase('done')
      // Let the success state land before the app replaces the screen.
      setTimeout(() => {
        setUser(me)
        navigate('/', { replace: true })
      }, 420)
    } catch (err) {
      setError(errorText(err))
      setErrorKey((k) => k + 1)
      setPhase('idle')
    }
  }

  return (
    <AuthCard
      testId="login-page"
      variant="login"
      title="登录"
      subtitle="欢迎回来，继续和团队一起干活。"
      errorKey={errorKey}
      leaving={phase === 'done'}
      onSubmit={submit}
      footer={
        options?.registrationOpen ? (
          <p className="auth__foot">
            还没有账号？
            <Link to="/register" className="auth__link">
              立即注册
            </Link>
          </p>
        ) : (
          <p className="auth__foot">还没有账号？请联系系统管理员开通</p>
        )
      }
    >
      <div className="auth__fields">
        <TextField
          label="账号"
          size="large"
          ref={accountRef}
          autoComplete="username"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value)
            setError('')
          }}
          autoFocus={!account}
        />
        <SecureField
          label="密码"
          size="large"
          autoComplete="current-password"
          value={password}
          ref={passwordRef}
          onChange={(e) => {
            setPassword(e.target.value)
            setError('')
          }}
          aria-invalid={!!error || undefined}
          autoFocus={!!account}
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
      <div className="auth__row">
        <Checkbox checked={keep} onChange={setKeep} label="记住我" />
        <button
          type="button"
          className="auth__link"
          aria-expanded={forgot}
          onClick={() => setForgot((f) => !f)}
        >
          忘记密码？
        </button>
      </div>
      <AnimatePresence initial={false}>
        {forgot ? (
          <motion.p
            key="forgot"
            className="auth__note"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            请联系系统管理员重置密码，用拿到的临时密码登录后再修改。
          </motion.p>
        ) : null}
      </AnimatePresence>
      <AuthSubmit phase={phase} label="登录" busy="登录中…" done="登录成功" />
    </AuthCard>
  )
}
