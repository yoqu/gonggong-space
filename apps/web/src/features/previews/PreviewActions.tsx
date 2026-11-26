import type { PreviewDto, PreviewHostRes } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt, toastError } from '../../lib/errors'
import { go } from '../../lib/go'
import { Icon, IconButton, Presence, toast } from '../../ui'
import { ClosePreviewConfirm } from './ClosePreviewConfirm'
import { startPreview } from './meta'
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
  const [stopping, setStopping] = useState(false)
  const demo = useSession((s) => s.tenancy?.demoMode)
  const online = p.status === 'online'
  const run = async (key: string, request: () => Promise<unknown>) => {
    setBusy(key)
    await attempt(request)
    setBusy(undefined)
  }
  // 托管到服务器: a static site goes up as a work; any other page is handed to its bot to build and host.
  const host = async () => {
    setBusy('host')
    try {
      const res = await api.post<PreviewHostRes>(`/previews/${p.id}/host`)
      if ('asked' in res) toast({ type: 'success', message: t('已交给 Bot 构建并托管') })
      else
        toast({
          type: 'success',
          message: t('已托管到服务器'),
          action: { label: t('打开作品'), onClick: () => go(`/works/${res.artifactId}`) },
        })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(undefined)
    }
  }
  const stopLabel =
    p.status === 'stopped'
      ? t('彻底关闭')
      : p.status === 'offline'
        ? t('关闭预览')
        : p.serviceId
          ? t('停止预览和服务')
          : t('停止预览')
  return (
    <div className="pv-actions">
      {online ? (
        <>
          <a
            className="ui-btn ui-btn--plain ui-btn--small ui-icon-btn"
            href={openUrl(p.id, p.path)}
            target="_blank"
            rel="noreferrer"
            title={t('打开')}
            aria-label={t('打开')}
          >
            <Icon name="external" size={15} />
          </a>
          <IconButton
            size="small"
            title={t('在工作台打开')}
            onClick={() => {
              if (openInWorkbench(p)) onDone?.()
            }}
          >
            {'sidebar-right' as const}
          </IconButton>
        </>
      ) : null}
      {p.canManage ? (
        <>
          {p.status === 'stopped' ? (
            <IconButton
              size="small"
              title={t('启动服务')}
              disabled={busy === 'start'}
              onClick={() => void run('start', () => startPreview(p.id))}
            >
              {'play' as const}
            </IconButton>
          ) : null}
          {share && !demo ? (
            <IconButton size="small" title={t('公开链接')} onClick={() => setSharing(true)}>
              {'link' as const}
            </IconButton>
          ) : null}
          {online && p.kind === 'http' ? (
            <IconButton
              size="small"
              title={t('托管到服务器')}
              disabled={busy === 'host'}
              onClick={() => void host()}
            >
              {'cloud' as const}
            </IconButton>
          ) : null}
          {online ? (
            <IconButton
              size="small"
              title={t('重新截图')}
              disabled={busy === 'shot'}
              onClick={() => void run('shot', () => api.post(`/previews/${p.id}/snapshot`))}
            >
              {'arrow-clockwise' as const}
            </IconButton>
          ) : null}
          <IconButton
            size="small"
            title={stopLabel}
            className="pv-actions__stop"
            onClick={() => setStopping(true)}
          >
            {'stop' as const}
          </IconButton>
        </>
      ) : null}
      <Presence>{sharing ? <ShareDialog preview={p} onClose={() => setSharing(false)} /> : null}</Presence>
      <Presence>
        {stopping ? (
          <ClosePreviewConfirm
            preview={p}
            mode={p.status === 'stopped' ? 'close' : 'stop'}
            stopService={p.status === 'online' && !!p.serviceId}
            onDone={onDone}
            onClose={() => setStopping(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
