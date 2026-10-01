import { t } from '../i18n'
import { useDaemon, useNow } from '../store'

export function StatusLine() {
  const now = useNow()
  const info = useDaemon((s) => s.info)
  const snapshot = useDaemon((s) => s.snapshot)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const online = status?.conn.state === 'online'
  const beat = status?.lastHeartbeatMs
    ? t('上次 {n} 秒前', { n: Math.max(0, Math.round((now - status.lastHeartbeatMs) / 1000)) })
    : t('尚未发送')
  const runs = status?.runs ?? []
  const available = new Set(status?.agents.filter((a) => a.available).map((a) => a.kind))
  const adapters = info?.adapters
    .filter((a) => available.has(a.kind))
    .map((a) => `${a.package.split('/').pop()} ${a.version}`)
    .join(' · ')
  return (
    <footer className="dk-statusline" data-testid="status-line">
      <span>
        {status?.heartbeatSec && online
          ? t('心跳 {sec}s · {beat}', { sec: status.heartbeatSec, beat })
          : t('心跳 — · 未连接')}
      </span>
      <span>
        {online && status?.latencyMs != null ? t('延迟 {ms} ms', { ms: status.latencyMs }) : t('延迟 —')}
      </span>
      <span>
        {t('运行 {running} · 队列 {queued}', {
          running: runs.filter((r) => !r.queued).length,
          queued: runs.filter((r) => r.queued).length,
        })}
      </span>
      <span className="dk-flex" />
      <span className="dk-ellipsis">{t('ACP 适配器 {list}', { list: adapters || '—' })}</span>
      {info ? (
        <span>{t('v{version} · 协议 v{protocol}', { version: info.version, protocol: info.protocol })}</span>
      ) : null}
    </footer>
  )
}
