import type { PreviewDto } from '@gonggong/protocol'
import { useState } from 'react'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Icon, IconButton } from '../../ui'
import './previews.css'
import { ControlRequests } from './control'
import { PreviewActions } from './PreviewActions'
import { openInWorkbench, previewIcon, snapshotUrl, usePreviews } from './store'

/** What a mini program card says while its machine's WeChat devtools wait for a login. */
export const loginNote = (p: PreviewDto) =>
  p.canManage ? '微信开发者工具未登录，请用微信扫码登录' : '等待 Bot 主人登录微信开发者工具'

/** The devtools' login code, for the bot owner or a group admin only (scanning logs the scanner in). */
export function DevtoolsLogin({ preview: p }: { preview: PreviewDto }) {
  return p.canManage ? (
    <img className="pv-login" src={snapshotUrl(p)} alt="微信开发者工具登录二维码" />
  ) : (
    <Icon name="smartphone" size={32} className="pv-card__placeholder" />
  )
}

export const PREVIEW_STATE = {
  online: { label: '在线', color: 'var(--system-green)' },
  offline: { label: '离线', color: 'var(--system-gray)' },
  stopped: { label: '服务已停止', color: 'var(--system-orange)' },
  closed: { label: '已关闭', color: 'var(--system-gray)' },
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
  const mini = p?.kind === 'miniprogram'
  const gui = p?.kind === 'gui'
  const reopen = async () => {
    setReopening(true)
    try {
      await api.post(`/previews/${previewId}/start`)
    } catch (e) {
      toastError(e)
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
          {p.awaiting === 'login' ? (
            <DevtoolsLogin preview={p} />
          ) : p.snapshotAt ? (
            <img src={snapshotUrl(p)} alt={`${p.title} ${mini ? '模拟器' : '首屏'}`} loading="lazy" />
          ) : (
            <Icon name={previewIcon(p.kind)} size={32} className="pv-card__placeholder" />
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
            <IconButton size="small" title="重新开放" disabled={reopening} onClick={() => void reopen()}>
              {'play' as const}
            </IconButton>
          ) : null}
        </div>
        {p ? (
          <div className="pv-card__meta">
            {mini ? (p.awaiting === 'login' ? loginNote(p) : `小程序 · ${p.path}`) : null}
            {gui ? `桌面应用 · ${p.serviceName ?? ''}` : null}
            {p.snapshotError ? <span className="pv-card__error">{p.snapshotError}</span> : null}
            {!mini && !gui && p.status === 'stopped' ? '服务已停止 · ' : ''}
            {!mini && p.port ? `:${p.port}` : ''}
            {mini || gui ? null : p.path}
            {p.serviceName && !gui ? ` · ${p.serviceName}` : ''}
          </div>
        ) : null}
        {p ? <ControlRequests preview={p} /> : null}
      </div>
    </div>
  )
}
