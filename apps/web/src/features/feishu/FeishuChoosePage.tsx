import type { FeishuTicketDto, MeDto } from '@gonggong/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Avatar, Icon, SecureField, Spinner, Tag, TextField } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from '../auth/AuthCard'
import { FeishuMark } from './FeishuChatLink'
import { FeishuLoginButton } from './login'
import './login.css'

type Mode = 'choose' | 'bind'

/** First 飞书登录 of a Feishu user no account is linked to: guided choice between 创建新账号 and 绑定已有账号. */
export function FeishuChoosePage() {
  const ticket = useSearchParams()[0].get('ticket') ?? ''
  const { setUser } = useSession()
  const navigate = useNavigate()
  const [info, setInfo] = useState<FeishuTicketDto | null>(null)
  const [expired, setExpired] = useState('')
  const [mode, setMode] = useState<Mode>('choose')
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [phase, setPhase] = useState<SubmitPhase>('idle')
  const [creating, setCreating] = useState(false)
  const accountRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const base = `/auth/feishu/ticket/${encodeURIComponent(ticket)}`

  useEffect(() => {
    api.get<FeishuTicketDto>(base).then(
      (dto) => {
        setInfo(dto)
        if (dto.suggestedAccount) setAccount(dto.suggestedAccount)
        if (!dto.canCreate) setMode('bind')
      },
      (e) => setExpired(errorText(e)),
    )
  }, [base])

  const enter = (me: MeDto) => {
    setPhase('done')
    setTimeout(() => {
      setUser(me)
      navigate(info?.next ?? '/', { replace: true })
    }, 240)
  }
  const fail = (message: string) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  async function bind(e: FormEvent) {
    e.preventDefault()
    if (phase !== 'idle' || creating) return
    if (!account.trim() || !password) {
      ;(account.trim() ? passwordRef : accountRef).current?.focus()
      return fail(account.trim() ? t('请输入密码') : t('请输入账号'))
    }
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
    if (phase !== 'idle' || creating) return
    setCreating(true)
    setError('')
    try {
      enter(await api.post<MeDto>(`${base}/create`))
    } catch (err) {
      fail(errorText(err))
      setCreating(false)
    }
  }

  const binding = !!info && (!info.canCreate || mode === 'bind')
  const matched = !!info?.suggestedAccount
  const prefilledMatch = !!info?.suggestedAccount && account.trim() === info.suggestedAccount

  const beforeTitle = expired ? (
    <span className="feishu-status-icon feishu-status-icon--warn" aria-hidden="true">
      <Icon name="clock" size={20} />
    </span>
  ) : binding && info.canCreate ? (
    <button
      type="button"
      className="feishu-back"
      disabled={phase !== 'idle'}
      onClick={() => {
        setError('')
        setMode('choose')
      }}
    >
      <Icon name="chevron-left" size={14} />
      <span>{t('返回选择')}</span>
    </button>
  ) : undefined

  const title = expired
    ? t('授权已过期')
    : !info
      ? t('飞书登录')
      : binding
        ? t('绑定已有账号')
        : t('确认账号')

  const subtitle = expired
    ? expired || t('飞书登录凭证已失效，重新授权即可继续。')
    : !info
      ? t('正在确认你的飞书身份…')
      : !info.canCreate
        ? t('当前未开启自动开户，请绑定管理员开通的账号。')
        : undefined

  const createCard = (
    <button
      type="button"
      className={cx('feishu-choice', !matched && 'feishu-choice--primary')}
      disabled={creating || phase !== 'idle'}
      onClick={create}
    >
      <span className="feishu-choice__icon">
        <Icon name="person-add" size={18} />
      </span>
      <span className="feishu-choice__body">
        <span className="feishu-choice__head">
          <span className="feishu-choice__title">{t('创建新账号')}</span>
        </span>
        <span className="feishu-choice__desc">
          {matched ? t('不关联旧账号，用飞书资料新建独立账号') : t('用飞书资料一步开户，免设密码')}
        </span>
      </span>
      <span className="feishu-choice__end">
        {creating ? (
          <Spinner size={14} />
        ) : phase === 'done' ? (
          <Icon name="check" size={16} weight={2.2} />
        ) : (
          <Icon name="chevron-right" size={16} />
        )}
      </span>
    </button>
  )

  const bindCard = (
    <button
      type="button"
      className={cx('feishu-choice', matched && 'feishu-choice--primary')}
      disabled={creating || phase !== 'idle'}
      onClick={() => {
        setError('')
        setMode('bind')
      }}
    >
      <span className="feishu-choice__icon">
        <Icon name="link" size={18} />
      </span>
      <span className="feishu-choice__body">
        <span className="feishu-choice__head">
          <span className="feishu-choice__title">{t('绑定已有账号')}</span>
          {info?.suggestedAccount ? <Tag tone="blue">{info.suggestedAccount}</Tag> : null}
        </span>
        <span className="feishu-choice__desc">
          {matched
            ? t('检测到同邮箱账号，绑定后保留原有群聊与 Bot')
            : t('关联已有的共工账号，保留群聊与 Bot')}
        </span>
      </span>
      <span className="feishu-choice__end">
        <Icon name="chevron-right" size={16} />
      </span>
    </button>
  )

  return (
    <AuthCard
      testId="feishu-choose-page"
      variant="login"
      beforeTitle={beforeTitle}
      title={title}
      subtitle={subtitle}
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
        <FeishuLoginButton next="/" variant="primary" label={t('重新使用飞书登录')} />
      ) : !info ? (
        <div className="feishu-choose__loading" role="status">
          <Spinner size={18} />
          <span>{t('正在读取飞书授权信息…')}</span>
        </div>
      ) : (
        <>
          <div className="feishu-id">
            <span className="feishu-id__av">
              <Avatar src={info.avatar ?? undefined} name={info.name} size={38} />
              <span className="feishu-id__badge" aria-hidden="true">
                <FeishuMark size={10} />
              </span>
            </span>
            <div className="feishu-choose__who">
              <span className="feishu-choose__name">{info.name}</span>
              {info.email ? <span className="feishu-choose__email">{info.email}</span> : null}
            </div>
          </div>

          {!binding ? (
            <div className="feishu-choose__stack">
              <div className="feishu-choices">
                {matched ? (
                  <>
                    {bindCard}
                    {createCard}
                  </>
                ) : (
                  <>
                    {createCard}
                    {bindCard}
                  </>
                )}
              </div>
              <p className="auth-error" role="alert" data-shown={error ? true : undefined}>
                {error ? (
                  <>
                    <Icon name="exclamation-circle" size={13} />
                    {error}
                  </>
                ) : null}
              </p>
            </div>
          ) : (
            <>
              <div className="auth__fields">
                <TextField
                  label={t('账号')}
                  size="large"
                  ref={accountRef}
                  autoComplete="username"
                  placeholder={t('输入已有共工账号')}
                  value={account}
                  trailing={prefilledMatch ? <Tag tone="blue">{t('邮箱匹配')}</Tag> : undefined}
                  onChange={(e) => {
                    setAccount(e.target.value)
                    setError('')
                  }}
                  autoFocus={!account}
                />
                <SecureField
                  label={t('密码')}
                  size="large"
                  ref={passwordRef}
                  autoComplete="current-password"
                  placeholder={t('输入原账号密码')}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
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
              <AuthSubmit phase={phase} label={t('绑定并登录')} busy={t('绑定中…')} done={t('登录成功')} />
            </>
          )}
        </>
      )}
    </AuthCard>
  )
}
