import { useState } from 'react'
import { attempt } from '../../lib/errors'
import { Icon, IconButton } from '../../ui'
import './previews.css'
import { t } from '../../i18n'
import { startPreview } from './meta'
import { PreviewActions } from './PreviewActions'
import { openInWorkbench, snapshotUrl, usePreviews } from './store'

export const PREVIEW_STATE = {
  online: { label: t('在线'), color: 'var(--system-green)' },
  offline: { label: t('离线'), color: 'var(--system-gray)' },
  stopped: { label: t('服务已停止'), color: 'var(--system-orange)' },
  closed: { label: t('已关闭'), color: 'var(--system-gray)' },
}

/**
 * A bot's preview card (plan §6), a link card like Feishu's: the page's first screen as the machine last rendered
 * it, live state from the group's preview list, and icon actions. The picture opens it in the workbench. A closed
 * card can be reopened by whoever manages its bot, which also restarts the service behind it.
 */
export function PreviewCard({
  previewId,
  groupId,
  botId,
  fallback,
}: {
  previewId: string
  groupId: string
  botId: string
  fallback: string
}) {
  const list = usePreviews(groupId)
  const [reopening, setReopening] = useState(false)
  const p = list?.previews.find((x) => x.id === previewId)
  const state = p ? p.status : list ? 'closed' : undefined
  const title = p?.title ?? fallback
  const reopen = async () => {
    setReopening(true)
    await attempt(() => startPreview(previewId))
    setReopening(false)
  }
  return (
    <div className={p ? 'pv-card' : 'pv-card pv-card--gone'}>
      {p ? (
        <button
          type="button"
          className="pv-card__shot"
          disabled={p.status !== 'online'}
          onClick={() => openInWorkbench(p)}
          tabIndex={-1}
        >
          {p.snapshotAt ? (
            <img src={snapshotUrl(p)} alt={t('{title} 首屏', { title: p.title })} loading="lazy" />
          ) : (
            <Icon name="globe" size={32} className="pv-card__placeholder" />
          )}
        </button>
      ) : null}
      <div className="pv-card__body">
        <div className="pv-card__head">
          {state ? (
            <span className={`pv-dot pv-dot--${state}`} role="img" aria-label={PREVIEW_STATE[state].label} />
          ) : null}
          <span className="pv-card__title" title={title}>
            {title}
          </span>
          {p ? <PreviewActions preview={p} /> : null}
          {state === 'closed' && list?.manageableBotIds.includes(botId) ? (
            <IconButton size="small" title={t('重新开放')} disabled={reopening} onClick={() => void reopen()}>
              {'play' as const}
            </IconButton>
          ) : null}
        </div>
        {p ? (
          <div className="pv-card__meta">
            {p.snapshotError ? <span className="pv-card__error">{p.snapshotError}</span> : null}
            {p.status === 'stopped' ? `${t('服务已停止')} · ` : ''}
            {p.port ? `:${p.port}` : ''}
            {p.path}
            {p.serviceName ? ` · ${p.serviceName}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}
