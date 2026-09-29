import type { PreviewDto } from '@gonggong/protocol'
import { useState } from 'react'
import { api } from '../../lib/api'
import { Icon, IconButton, Presence, toast } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { ShareDialog } from './ShareDialog'
import { openInWorkbench, openUrl } from './store'

/**
 * A preview's icon actions; the bot owner or a group admin also starts its stopped service, retakes the first
 * screen, stops it and (`share`, not inside a popover, which a dialog press would close) hands out public links.
 */
export function PreviewActions({
  preview: p,
  share = true,
  onDone,
}: {
  preview: PreviewDto
  share?: boolean
  onDone?: () => void
}) {
  const [busy, setBusy] = useState<string>()
  const [sharing, setSharing] = useState(false)
  const run = async (key: string, path: string, body?: unknown) => {
    setBusy(key)
    try {
      await api.post(path, body)
      if (key === 'stop') onDone?.()
    } catch (e) {
      toast({ type: 'error', message: errorText(e) })
    } finally {
      setBusy(undefined)
    }
  }
  // A mini program lives in the machine's devtools: no web address to open or share.
  const web = p.kind !== 'miniprogram'
  const stopLabel = !web ? '关闭预览' : p.serviceId ? '停止穿透和服务' : '停止穿透'
  return (
    <div className="pv-actions">
      {web ? (
        <a
          className="ui-btn ui-btn--plain ui-btn--small ui-icon-btn"
          href={openUrl(p.id, p.path)}
          target="_blank"
          rel="noreferrer"
          title="打开"
          aria-label="打开"
        >
          <Icon name="external" size={15} />
        </a>
      ) : null}
      {p.status === 'online' ? (
        <IconButton
          size="small"
          title="在工作台打开"
          onClick={() => {
            if (openInWorkbench(p)) onDone?.()
          }}
        >
          {'sidebar-right' as const}
        </IconButton>
      ) : null}
      {p.canManage ? (
        <>
          {p.status === 'stopped' ? (
            <IconButton
              size="small"
              title="启动服务"
              disabled={busy === 'start'}
              onClick={() => void run('start', `/previews/${p.id}/start`)}
            >
              {'play' as const}
            </IconButton>
          ) : null}
          {share && web ? (
            <IconButton size="small" title="公开链接" onClick={() => setSharing(true)}>
              {'link' as const}
            </IconButton>
          ) : null}
          <IconButton
            size="small"
            title="重新截图"
            disabled={busy === 'shot'}
            onClick={() => void run('shot', `/previews/${p.id}/snapshot`)}
          >
            {'arrow-clockwise' as const}
          </IconButton>
          <IconButton
            size="small"
            title={stopLabel}
            className="pv-actions__stop"
            disabled={busy === 'stop'}
            onClick={() => void run('stop', `/previews/${p.id}/close`, { stopService: true })}
          >
            {'stop' as const}
          </IconButton>
        </>
      ) : null}
      <Presence>{sharing ? <ShareDialog preview={p} onClose={() => setSharing(false)} /> : null}</Presence>
    </div>
  )
}
