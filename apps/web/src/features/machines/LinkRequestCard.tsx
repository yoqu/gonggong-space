import type { LinkRequestDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { ApiError, api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Alert, Button } from '../../ui'
import { AGENT_LABEL } from '../bots/model'
import { OS_LABEL } from './model'
import './machines.css'

export type LinkOutcome = 'pending' | 'approved' | 'denied' | 'expired' | 'handled'

const initial = (r: LinkRequestDto): LinkOutcome =>
  r.status === 'expired' || (r.status === 'pending' && Date.parse(r.expiresAt) <= Date.now())
    ? 'expired'
    : r.status === 'pending'
      ? 'pending'
      : 'handled'

/**
 * A machine whose bind code had expired asks to be bound: who started it checks the machine and the code shown in its
 * terminal, then allows it here. Used by /link/:id and inline in 绑定新机器.
 */
export function LinkRequestCard({
  request,
  onDecided,
}: {
  request: LinkRequestDto
  onDecided?: (outcome: LinkOutcome) => void
}) {
  const [outcome, setOutcome] = useState(() => initial(request))
  const [busy, setBusy] = useState(false)
  const decide = async (to: 'approve' | 'deny') => {
    setBusy(true)
    let next: LinkOutcome
    try {
      await api.post(`/link-requests/${request.id}/${to}`)
      next = to === 'approve' ? 'approved' : 'denied'
    } catch (err) {
      setBusy(false)
      if (!(err instanceof ApiError) || (err.status !== 410 && err.status !== 409)) return toastError(err)
      next = err.status === 410 ? 'expired' : 'handled'
    }
    setOutcome(next)
    onDecided?.(next)
  }
  const { machine } = request
  return (
    <section className="link-card" aria-label={t('机器接入申请')}>
      <p className="link-card__name">{machine.name}</p>
      <dl className="link-card__facts">
        <dt>{t('系统')}</dt>
        <dd>{`${OS_LABEL[machine.os]} · ${machine.arch}`}</dd>
        <dt>Agent</dt>
        <dd>{request.agent ? AGENT_LABEL[request.agent] : '—'}</dd>
        <dt>{t('发起 IP')}</dt>
        <dd>{request.ip}</dd>
      </dl>
      {outcome === 'pending' ? (
        <>
          <div className="link-card__check">
            <span className="link-card__label">{t('核对码')}</span>
            <span className="link-card__code">{request.userCode}</span>
          </div>
          <p className="link-card__hint">{t('只在你本人刚发起接入、且核对码与终端一致时允许。')}</p>
          <div className="link-card__actions">
            <Button disabled={busy} onClick={() => void decide('deny')}>
              {t('拒绝')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void decide('approve')}>
              {t('允许接入')}
            </Button>
          </div>
        </>
      ) : outcome === 'approved' ? (
        <Alert
          variant="success"
          title={t('已允许接入')}
          description={
            request.agent
              ? t('机器正在接入，Bot 建好后自动打开私聊。')
              : t('机器正在接入，稍后可在「机器与 Bot」中查看。')
          }
        />
      ) : outcome === 'denied' ? (
        <Alert title={t('已拒绝接入')} description={t('这台机器不会被绑定。')} />
      ) : outcome === 'expired' ? (
        <Alert
          variant="warning"
          title={t('接入申请已过期')}
          description={t('在机器的终端重新运行接入命令即可。')}
        />
      ) : (
        <Alert title={t('这个接入申请已处理过')} />
      )}
    </section>
  )
}
