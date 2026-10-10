import type { MeDto } from '@gonggong/protocol'
import { AnimatePresence, m } from 'motion/react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Checkbox, Icon, SecureField, TextField } from '../../ui'
import { FEISHU_RESULT, FeishuLoginButton, feishuStartUrl, inFeishuClient } from '../feishu/login'
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
  const [params] = useSearchParams()
  // Same-origin paths only (e.g. back to an invite), never another site.
  const asked = params.get('next') ?? ''
  const next = /^\/(?!\/)/.test(asked) ? asked : '/'
  const [account, setAccount] = useState(remembered)
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(() => remembered() !== '')
  // A 飞书登录 that came back unsuccessful says why, and is not retried automatically.
  const feishuResult = params.get('feishu')
  const [error, setError] = useState(() => (feishuResult && FEISHU_RESULT[feishuResult]) || '')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [forgot, setForgot] = useState(false)
  const options = useAuthOptions()
  const accountRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // 回链免登: inside the Feishu client the main app authorizes without a click.
  const autoFeishu = !user && !!options?.feishuLogin && !feishuResult && inFeishuClient()
  useEffect(() => {
    if (autoFeishu) location.replace(feishuStartUrl(next, 'silent'))
  }, [autoFeishu, next])

  if (user && phase !== 'done') return <Navigate to={next} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (phase !== 'idle') return
    // Enabled even when empty: pressing it points at what is missing instead of a dead, greyed-out button.
    if (!account.trim() || !password) {
      ;(account.trim() ? passwordRef : accountRef).current?.focus()
      setError(account.trim() ? t('请输入密码') : t('请输入账号'))
      setErrorKey((k) => k + 1)
      return
    }
    setPhase('busy')
    setError('')
    try {
      const me = await api.post<MeDto>('/auth/login', { account: account.trim(), password })
      remember(keep ? account.trim() : null)
      setPhase('done')
      // Let the success state land before the app replaces the screen.
      setTimeout(() => {
        setUser(me)
        navigate(next, { replace: true })
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
      title={t('登录')}
      subtitle={t('欢迎回来，继续和团队一起干活。')}
      errorKey={errorKey}
      leaving={phase === 'done'}
      onSubmit={submit}
      footer={
        options?.registrationOpen ? (
          <p className="auth__foot">
            {t('还没有账号？')}
            <Link to="/register" className="auth__link">
              {t('立即注册')}
            </Link>
          </p>
        ) : (
          <p className="auth__foot">{t('还没有账号？请联系系统管理员开通')}</p>
        )
      }
    >
      <div className="auth__fields">
        <TextField
          label={t('账号')}
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
          label={t('密码')}
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
        <Checkbox checked={keep} onChange={setKeep} label={t('记住我')} />
        <button
          type="button"
          className="auth__link"
          aria-expanded={forgot}
          onClick={() => setForgot((f) => !f)}
        >
          {t('忘记密码？')}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {forgot ? (
          <m.p
            key="forgot"
            className="auth__note"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {t('请联系系统管理员重置密码，用拿到的临时密码登录后再修改。')}
          </m.p>
        ) : null}
      </AnimatePresence>
      <AuthSubmit phase={phase} label={t('登录')} busy={t('登录中…')} done={t('登录成功')} />
      {options?.feishuLogin ? (
        <>
          <p className="auth__or">{t('或')}</p>
          <FeishuLoginButton next={next} />
        </>
      ) : null}
    </AuthCard>
  )
}
