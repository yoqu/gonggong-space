import type { SecretRequestDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { errorText } from '../../lib/api'
import { Button, DeniedArt, EmptyState, Presence, Spinner } from '../../ui'
import { secretsApi } from './api'
import { FillDialog } from './SecretCard'

/** /secret-requests/:id — where a Feishu 填写密钥 card links: the value is typed here, never in Feishu. */
export function SecretRequestPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const [req, setReq] = useState<SecretRequestDto | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    secretsApi.request(id).then(setReq, (e) => setError(errorText(e)))
  }, [id])

  const back = req && (
    <Link to={`/g/${req.groupId}`} className="ui-btn ui-btn--secondary ui-btn--md">
      {t('打开群聊')}
    </Link>
  )
  const view = error ? (
    <EmptyState
      illustration={<DeniedArt />}
      title={t('无法打开密钥卡片')}
      description={error}
      action={<Button onClick={() => navigate('/')}>{t('返回消息')}</Button>}
    />
  ) : !req ? (
    <Spinner />
  ) : req.filled || done ? (
    <EmptyState
      title={t('已填写，可以回到飞书')}
      description={req.names.join('、')}
      icon="lock"
      action={back}
    />
  ) : req.audience === 'origin' && req.userId !== me ? (
    <EmptyState title={t('只有发起人本人可以填写这些密钥')} icon="lock" action={back} />
  ) : (
    <Presence>
      <FillDialog card={req} onClose={() => navigate(`/g/${req.groupId}`)} onDone={() => setDone(true)} />
    </Presence>
  )
  return <div className="not-found">{view}</div>
}
