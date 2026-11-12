import type { LinkRequestDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { EmptyState, Spinner } from '../../ui'
import { type LinkOutcome, LinkRequestCard } from './LinkRequestCard'

/** /link/:id — the 确认链接 gg prints after its bind code expired; signing in first comes back here. */
export function LinkRequestPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [request, setRequest] = useState<LinkRequestDto | null>(null)
  const [error, setError] = useState('')
  const [outcome, setOutcome] = useState<LinkOutcome | null>(null)

  useEffect(() => {
    api.get<LinkRequestDto>(`/link-requests/${id}`).then(setRequest, (e) => setError(errorText(e)))
  }, [id])

  // The machine makes its bot and DM right after binding: open that DM, as 绑定新机器 does.
  const waitForBot = outcome === 'approved' && !!request?.agent
  useEffect(() => {
    if (!waitForBot) return
    return realtime.subscribe((e) => {
      if (e.t === 'machine.onboarded') navigate(`/g/${e.groupId}`)
    })
  }, [waitForBot, navigate])

  return (
    <div className="not-found">
      {error ? (
        <EmptyState title={t('无法打开接入申请')} description={error} icon="link" />
      ) : !request ? (
        <Spinner />
      ) : (
        <div className="link-page">
          <h1 className="link-page__title">{t('确认机器接入')}</h1>
          <LinkRequestCard request={request} onDecided={setOutcome} />
          {outcome && outcome !== 'pending' && !waitForBot ? (
            <Link to="/machines" className="ui-btn ui-btn--secondary ui-btn--md link-page__back">
              {t('查看我的机器')}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  )
}
