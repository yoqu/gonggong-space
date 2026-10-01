import type { InvitePreviewDto } from '@gonggong/protocol'
import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Alert, Button, Spinner } from '../../ui'
import { AuthCard, AuthSubmit, type SubmitPhase } from '../auth/AuthCard'
import { switchTeam, teamsApi } from './store'

/** /join/:token — the invite landing page; signed-out visitors log in or sign up first, then come back here. */
export function JoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { user, status, load } = useSession()
  const [invite, setInvite] = useState<InvitePreviewDto | null>(null)
  const [error, setError] = useState('')
  const [phase, setPhase] = useState<SubmitPhase>('idle')

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])
  useEffect(() => {
    teamsApi.preview(token).then(setInvite, (e) => setError(errorText(e)))
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
  const usable = invite?.valid && !error
  return (
    <AuthCard
      testId="join-page"
      variant="register"
      title={invite ? t('加入「{team}」', { team: invite.teamName }) : t('加入团队')}
      subtitle={
        invite
          ? t('{inviter} 邀请你加入团队「{team}」。', { inviter: invite.inviterName, team: invite.teamName })
          : t('正在读取邀请…')
      }
      onSubmit={accept}
      footer={
        user ? (
          <p className="auth__foot">
            <Link to="/" className="auth__link">
              {t('返回消息')}
            </Link>
          </p>
        ) : null
      }
    >
      {error || (invite && !invite.valid) ? (
        <Alert
          variant="error"
          title={t('邀请链接已失效')}
          description={error || t('请联系团队管理员重新邀请。')}
        />
      ) : !invite || status !== 'ready' ? (
        <Spinner />
      ) : null}
      {usable && status === 'ready' ? (
        user ? (
          <AuthSubmit phase={phase} label={t('加入团队')} busy={t('加入中…')} done={t('已加入')} />
        ) : (
          <div className="auth__fields">
            <Button
              variant="primary"
              size="xlarge"
              fullWidth
              className="auth__submit"
              onClick={() => navigate(`/login?next=${encodeURIComponent(back)}`)}
            >
              {t('登录后加入')}
            </Button>
            <p className="auth__foot">
              {t('还没有账号？')}
              <Link to={`/register?invite=${encodeURIComponent(token)}`} className="auth__link">
                {t('注册并加入')}
              </Link>
            </p>
          </div>
        )
      ) : null}
    </AuthCard>
  )
}
