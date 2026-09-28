import { useState } from 'react'
import { api } from '../../lib/api'
import { Icon, IconButton, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import './previews.css'
import { PreviewActions } from './PreviewActions'
import { openInWorkbench, snapshotUrl, usePreviews } from './store'

export const PREVIEW_STATE = { online: '在线', offline: '离线', stopped: '服务已停止', closed: '已关闭' }

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
    try {
      await api.post(`/previews/${previewId}/start`)
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setReopening(false)
    }
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
            <img src={snapshotUrl(p)} alt={`${p.title} 首屏`} loading="lazy" />
          ) : (
            <Icon name="globe" size={32} className="pv-card__placeholder" />
          )}
        </button>
      ) : null}
      <div className="pv-card__body">
        <div className="pv-card__head">
          {state ? (
            <span className={`pv-dot pv-dot--${state}`} role="img" aria-label={PREVIEW_STATE[state]} />
          ) : null}
          <span className="pv-card__title" title={title}>
            {title}
          </span>
          {p ? <PreviewActions preview={p} /> : null}
          {state === 'closed' && list?.manageableBotIds.includes(botId) ? (
            <IconButton size="small" title="重新开放" disabled={reopening} onClick={() => void reopen()}>
              {'play' as const}
            </IconButton>
          ) : null}
        </div>
        {p ? (
          <div className="pv-card__meta">
            {p.status === 'stopped' ? '服务已停止 · ' : ''}
            {p.port ? `:${p.port}` : ''}
            {p.path}
            {p.serviceName ? ` · ${p.serviceName}` : ''}
          </div>
        ) : null}
      </div>
    </div>
  )
}
