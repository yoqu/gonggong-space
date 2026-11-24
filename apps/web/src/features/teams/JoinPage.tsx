import type { InvitePreviewDto } from '@gonggong/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Avatar, Button, Icon, Spinner } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from '../auth/AuthCard'
import { useAuthOptions } from '../auth/options'
import { FeishuLoginButton } from '../feishu/login'
import { switchTeam, teamsApi } from './store'
import './teams.css'

/** /join/:token — the invite landing page; signed-out visitors log in or sign up first, then come back here. */
export function JoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { user, status, load } = useSession()
  const options = useAuthOptions()
  const [invite, setInvite] = useState<InvitePreviewDto | null>(null)
  const [error, setError] = useState('')
  const [unreadable, setUnreadable] = useState(false)
  const [phase, setPhase] = useState<SubmitPhase>('idle')

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])
  useEffect(() => {
    teamsApi.preview(token).then(setInvite, () => setUnreadable(true))
  }, [token])

  const accept = async (e: FormEvent) => {
    e.preventDefault()
    if (phase !== 'idle' || !user) return
    setPhase('busy')
    try {
      const team = await teamsApi.accept(token)
      setPhase('done')
      switchTeam(team.id)
    } catch (err) {
      setError(errorText(err))
      setPhase('idle')
    }
  }

  const back = `/join/${token}`
  const dead = unreadable || invite?.valid === false
  const usable = Boolean(invite?.valid && !error)
  const showCard = !dead && Boolean(invite) && status === 'ready'

  const beforeTitle = dead ? (
    <span className="join-status-icon" aria-hidden="true">
      <Icon name="warning" size={20} />
    </span>
  ) : undefined

  return (
    <AuthCard
      testId="join-page"
      variant="register"
      beforeTitle={beforeTitle}
      title={dead ? t('邀请链接已失效') : showCard ? undefined : t('加入团队')}
      subtitle={
        dead
          ? t('该链接已过期或被撤销，请联系团队管理员重新邀请。')
          : showCard
            ? undefined
            : t('正在读取邀请…')
      }
      onSubmit={accept}
      footer={
        showCard && usable ? (
          user ? (
            <p className="auth__foot">
              <Link to="/" className="auth__link">
                {t('返回消息')}
              </Link>
            </p>
          ) : (
            <p className="auth__foot">
              {t('还没有账号？')}{' '}
              <Link to={`/register?invite=${encodeURIComponent(token)}`} className="auth__link">
                {t('注册并加入')}
              </Link>
            </p>
          )
        ) : null
      }
    >
      {dead ? (
        status === 'ready' ? (
          <Link to={user ? '/' : '/login'} className="ui-btn ui-btn--primary ui-btn--xlarge ui-btn--full">
            {user ? t('返回消息') : t('返回登录')}
          </Link>
        ) : null
      ) : !invite || status !== 'ready' ? (
        <Spinner />
      ) : (
        <>
          <div className="join-card">
            <Avatar name={invite.teamName} shape="square" size={52} className="join-card__team-av" />
            <div className="join-card__head">
              <span className="join-card__inviter">
                <Avatar name={invite.inviterName} size={20} />
                <span>{t('{inviter} 邀请你加入', { inviter: invite.inviterName })}</span>
              </span>
              <h1 className="auth__title">{invite.teamName}</h1>
            </div>
          </div>

          {error ? <Alert variant="error" description={error} /> : null}

          {usable ? (
            user ? (
              <AuthSubmit phase={phase} label={t('加入团队')} busy={t('加入中…')} done={t('已加入')} />
            ) : (
              <div className="join-actions">
                <Button
                  variant="primary"
                  size="xlarge"
                  fullWidth
                  className="auth__submit"
                  onClick={() => navigate(`/login?next=${encodeURIComponent(back)}`)}
                >
                  {t('登录后加入')}
                </Button>
                {options?.feishuLogin ? (
                  <>
                    <p className="auth__or">{t('或')}</p>
                    <FeishuLoginButton next={back} label={t('飞书登录并加入')} />
                  </>
                ) : null}
              </div>
            )
          ) : null}
        </>
      )}
    </AuthCard>
  )
}
