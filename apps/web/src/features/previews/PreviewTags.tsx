import type { PreviewDto, ServiceDto } from '@gonggong/protocol'
import { Icon, Popover } from '../../ui'
import './previews.css'
import { PreviewActions } from './PreviewActions'
import { PREVIEW_STATE } from './PreviewCard'
import { snapshotUrl, usePreviews } from './store'

/** Pinned above the composer: every open preview tunnel of the group, for all members. */
export function PreviewTags({ groupId }: { groupId: string }) {
  const list = usePreviews(groupId)
  if (!list?.previews.length) return null
  return (
    <div className="pv-tags">
      {list.previews.map((p) => (
        <PreviewTag key={p.id} preview={p} service={list.services.find((s) => s.id === p.serviceId)} />
      ))}
    </div>
  )
}

function PreviewTag({ preview: p, service }: { preview: PreviewDto; service?: ServiceDto }) {
  return (
    <Popover
      placement="top-start"
      width={320}
      aria-label={p.title}
      trigger={
        <button type="button" className="pv-tag">
          <span className={`pv-dot pv-dot--${p.status}`} />
          <Icon name="globe" size={13} className="pv-tag__icon" />
          <span className="pv-tag__title">{p.title}</span>
          {p.port ? <span className="pv-tag__port">:{p.port}</span> : null}
        </button>
      }
    >
      {(close) => (
        <div className="pv-pop">
          {p.snapshotAt ? (
            <img className="pv-pop__shot" src={snapshotUrl(p)} alt={`${p.title} 首屏`} />
          ) : null}
          <div className="pv-card__head">
            <span className="pv-card__title">{p.title}</span>
            <PreviewActions preview={p} share={false} onDone={close} />
          </div>
          <div className="pv-card__meta">
            {p.botName} · {PREVIEW_STATE[p.status]}
            {p.port ? ` · :${p.port}` : ''}
          </div>
          {service ? (
            <div className="pv-card__meta pv-mono" title={service.command}>
              $ {service.command}
            </div>
          ) : null}
        </div>
      )}
    </Popover>
  )
}
