import type { FeishuTicketDto, MeDto } from '@gonggong/protocol'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Avatar, Icon, SecureField, Spinner, Tag, TextField } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from '../auth/AuthCard'
import { FeishuLoginButton } from './login'
import './login.css'

type Mode = 'choose' | 'bind'

/** First 飞书登录 of a Feishu user no account is linked to: guided choice between 新建账号 and 绑定已有账号. */
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
    }, 420)
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
  const title = expired
    ? t('飞书授权已过期')
    : !info
      ? t('飞书登录')
      : binding
        ? t('绑定已有共工账号')
        : t('欢迎，{name}', { name: info.name })
  const subtitle = expired
    ? t('登录凭证已失效，重新授权飞书即可继续。')
    : !info
      ? t('正在确认你的飞书身份…')
      : !info.canCreate
        ? t('当前空间未开启飞书自动开户，请绑定管理员为你开通的共工账号。')
        : binding
          ? t('输入你原有的共工账号和密码，验证后将与当前飞书自动绑定。')
          : t('首次通过飞书进入共工空间，请选择你的账号方式：')

  return (
    <AuthCard
      testId="feishu-choose-page"
      variant="login"
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
        <div className="feishu-choose__stack">
          <Alert variant="error" description={expired} />
          <FeishuLoginButton next="/" variant="primary" label={t('重新使用飞书登录')} />
        </div>
      ) : !info ? (
        <div className="feishu-choose__loading" role="status">
          <Spinner size={18} />
          <span>{t('正在读取飞书授权信息…')}</span>
        </div>
      ) : (
        <>
          <div className="feishu-id">
            <Avatar src={info.avatar ?? undefined} name={info.name} size={36} />
            <div className="feishu-choose__who">
              <span className="feishu-choose__name">{info.name}</span>
              {info.email ? <span className="feishu-choose__email">{info.email}</span> : null}
            </div>
            <Tag tone="green" className="feishu-id__tag">
              {t('飞书已授权')}
            </Tag>
          </div>

          {!binding ? (
            <div className="feishu-choose__stack">
              {info.suggestedAccount ? (
                <Alert
                  variant="info"
                  title={t('检测到邮箱匹配的已有账号')}
                  description={t(
                    '账号「{account}」与你的飞书邮箱一致。如果你之前使用过共工，建议选择绑定以保留原有群聊与 Bot。',
                    { account: info.suggestedAccount },
                  )}
                />
              ) : null}

              <div className="feishu-choices">
                <button
                  type="button"
                  className={cx('feishu-choice', !info.suggestedAccount && 'feishu-choice--primary')}
                  disabled={creating || phase !== 'idle'}
                  onClick={create}
                >
                  <span className="feishu-choice__icon">
                    <Icon name="person-add" size={18} />
                  </span>
                  <span className="feishu-choice__body">
                    <span className="feishu-choice__head">
                      <span className="feishu-choice__title">{t('新建账号')}</span>
                      {!info.suggestedAccount ? <Tag tone="blue">{t('新用户推荐')}</Tag> : null}
                    </span>
                    <span className="feishu-choice__desc">
                      {t('没有共工账号？自动使用飞书姓名和头像一步开户，无需设置密码，以后飞书一键登录。')}
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

                <button
                  type="button"
                  className={cx('feishu-choice', !!info.suggestedAccount && 'feishu-choice--primary')}
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
                      {info.suggestedAccount ? <Tag tone="blue">{t('推荐')}</Tag> : null}
                    </span>
                    <span className="feishu-choice__desc">
                      {info.suggestedAccount
                        ? t('关联已有账号「{account}」，保留你原有的群聊、Bot 与权限。', {
                            account: info.suggestedAccount,
                          })
                        : t('之前用管理员发的账号或注册过？验证原密码完成绑定，保留原有群聊与 Bot。')}
                    </span>
                  </span>
                  <span className="feishu-choice__end">
                    <Icon name="chevron-right" size={16} />
                  </span>
                </button>
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
              {!info.canCreate ? (
                <Alert
                  variant="info"
                  description={t('如果还没有共工账号，请联系系统管理员开通后再回来绑定。')}
                />
              ) : null}
              <div className="auth__fields">
                <TextField
                  label={t('账号')}
                  size="large"
                  ref={accountRef}
                  autoComplete="username"
                  placeholder={t('管理员发放或之前注册的账号')}
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
                  ref={passwordRef}
                  autoComplete="current-password"
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
              {info.canCreate ? (
                <button
                  type="button"
                  className="auth__link feishu-choose__back"
                  disabled={phase !== 'idle'}
                  onClick={() => {
                    setError('')
                    setMode('choose')
                  }}
                >
                  <Icon name="chevron-left" size={13} />
                  {t('没有共工账号？返回选择新建账号')}
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </AuthCard>
  )
}
