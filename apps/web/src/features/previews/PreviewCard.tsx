import { useState } from 'react'
import { Button, Icon, Presence } from '../../ui'
import './previews.css'
import { ShareDialog } from './ShareDialog'
import { openUrl, usePreviews } from './store'

const STATE = {
  online: { label: '在线', color: 'var(--system-green)' },
  offline: { label: '离线', color: 'var(--system-gray)' },
  closed: { label: '已关闭', color: 'var(--system-gray)' },
}

/**
 * A bot's preview card (plan §6): live state from the group's preview list; 打开 and the embedded frame go through
 * the main site, which hands the member over to the preview origin.
 */
export function PreviewCard({
  previewId,
  groupId,
  fallback,
}: {
  previewId: string
  groupId: string
  fallback: string
}) {
  const list = usePreviews(groupId)
  const [embedded, setEmbedded] = useState(false)
  const [sharing, setSharing] = useState(false)
  const p = list?.previews.find((x) => x.id === previewId)
  const state = STATE[p ? p.status : list ? 'closed' : 'offline']
  const src = p ? openUrl(p.id, p.path) : ''
  return (
    <div className="pv-card">
      <div className="pv-card__head">
        <Icon name="desktop" size={16} className="pv-card__icon" />
        <span className="pv-card__title">{p?.title ?? fallback}</span>
        {list ? (
          <span className="pv-card__state">
            <span className="pv-dot" style={{ background: state.color }} />
            {state.label}
          </span>
        ) : null}
      </div>
      {p ? (
        <>
          <div className="pv-card__meta">
            {p.serviceName ? `服务 ${p.serviceName} · ` : ''}
            {p.path}
          </div>
          <div className="pv-card__actions">
            <a className="ui-btn ui-btn--small" href={src} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} />
              打开
            </a>
            <Button size="small" icon="eye" aria-pressed={embedded} onClick={() => setEmbedded(!embedded)}>
              {embedded ? '收起' : '内嵌预览'}
            </Button>
            {p.canManage ? (
              <Button size="small" icon="link" onClick={() => setSharing(true)}>
                公开链接…
              </Button>
            ) : null}
          </div>
          {embedded ? <iframe className="pv-card__frame" title={p.title} src={src} /> : null}
        </>
      ) : null}
      <Presence>
        {sharing && p ? <ShareDialog preview={p} onClose={() => setSharing(false)} /> : null}
      </Presence>
    </div>
  )
}
