import { copyText } from '@web/lib/clipboard'
import { useNow } from '@web/lib/now'
import { Dialog, GroupBox, GroupRow, toast } from '@web/ui'
import { t } from '../i18n'
import type { Snapshot } from '../ipc'
import { connKind, host } from '../lib/labels'
import { useDaemon } from '../store'

export type StatusConnTone = 'ok' | 'reconnecting' | 'offline'

export function statusConnSummary(snapshot: Snapshot): { tone: StatusConnTone; label: string } {
  const kind = connKind(snapshot)
  if (kind === 'ok') return { tone: 'ok', label: t('已连接') }
  if (kind === 'connecting' || kind === 'offline') return { tone: 'reconnecting', label: t('重连中…') }
  return { tone: 'offline', label: t('未连接') }
}

function formatClock(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Technical connection details moved out of the footer status line, with one-click copy for troubleshooting. */
export function ConnectionDiagnosticsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const info = useDaemon((s) => s.info)
  const snapshot = useDaemon((s) => s.snapshot)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const online = status?.conn.state === 'online'
  const now = useNow(open && online && Boolean(status?.lastHeartbeatMs))
  const conn = statusConnSummary(snapshot)

  const serverHost = host(info?.server) || '—'
  const heartbeatInterval = status?.heartbeatSec ? t('{n} 秒', { n: status.heartbeatSec }) : '—'
  const lastHeartbeat =
    online && status?.lastHeartbeatMs
      ? t('上次 {n} 秒前（{time}）', {
          n: Math.max(0, Math.round((now - status.lastHeartbeatMs) / 1000)),
          time: formatClock(status.lastHeartbeatMs),
        })
      : online
        ? t('尚未发送')
        : '—'
  const latency = online && status?.latencyMs != null ? t('{ms} ms', { ms: status.latencyMs }) : '—'
  const protocolVersion = info ? `v${info.protocol}` : '—'
  const clientVersion = info ? `v${info.version}` : '—'

  const available = new Set(status?.agents.filter((a) => a.available).map((a) => a.kind))
  const adapters =
    info?.adapters
      .filter((a) => available.has(a.kind))
      .map((a) => `${a.package.split('/').pop()} ${a.version}`) ?? []
  const adaptersText = adapters.join(' · ') || '—'

  const copyDiagnostics = async () => {
    const lines = [
      `${t('连接状态')}: ${conn.label}`,
      `${t('服务器')}: ${serverHost}`,
      `${t('客户端版本')}: ${clientVersion}`,
      `${t('协议版本')}: ${protocolVersion}`,
      `${t('心跳间隔')}: ${heartbeatInterval}`,
      `${t('上次心跳')}: ${lastHeartbeat}`,
      `${t('延迟')}: ${latency}`,
      `${t('适配器')}: ${adaptersText}`,
    ]
    try {
      await copyText(lines.join('\n'))
      toast({ type: 'success', message: t('已复制诊断信息') })
    } catch {
      toast({ type: 'error', message: t('复制诊断信息失败') })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('连接诊断')}
      width={460}
      actions={[
        { label: t('复制诊断信息'), onClick: () => void copyDiagnostics() },
        { label: t('关闭'), variant: 'primary', onClick: onClose },
      ]}
    >
      <GroupBox>
        <GroupRow label={t('连接状态')} value={conn.label} />
        <GroupRow label={t('服务器')} wideValue value={serverHost} />
        <GroupRow label={t('心跳间隔')} value={heartbeatInterval} />
        <GroupRow label={t('上次心跳')} wideValue value={lastHeartbeat} />
        <GroupRow label={t('延迟')} value={latency} />
        <GroupRow label={t('协议版本')} value={protocolVersion} />
        <GroupRow label={t('客户端版本')} value={clientVersion} />
        <GroupRow label={t('适配器')} wideValue value={adaptersText} />
      </GroupBox>
    </Dialog>
  )
}
