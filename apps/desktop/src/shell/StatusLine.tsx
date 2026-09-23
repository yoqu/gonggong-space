import { useDaemon, useNow } from '../store'

export function StatusLine() {
  const now = useNow()
  const info = useDaemon((s) => s.info)
  const snapshot = useDaemon((s) => s.snapshot)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const online = status?.conn.state === 'online'
  const beat = status?.lastHeartbeatMs
    ? `上次 ${Math.max(0, Math.round((now - status.lastHeartbeatMs) / 1000))} 秒前`
    : '尚未发送'
  const runs = status?.runs ?? []
  const available = new Set(status?.agents.filter((a) => a.available).map((a) => a.kind))
  const adapters = info?.adapters
    .filter((a) => available.has(a.kind))
    .map((a) => `${a.package.split('/').pop()} ${a.version}`)
    .join(' · ')
  return (
    <div className="dk-statusline" data-testid="status-line">
      <span>
        {status?.heartbeatSec && online ? `心跳 ${status.heartbeatSec}s · ${beat}` : '心跳 — · 未连接'}
      </span>
      <span>|</span>
      <span>{online && status?.latencyMs != null ? `延迟 ${status.latencyMs} ms` : '延迟 —'}</span>
      <span>|</span>
      <span>
        运行 {runs.filter((r) => !r.queued).length} · 队列 {runs.filter((r) => r.queued).length}
      </span>
      <span className="dk-flex" />
      <span>ACP 适配器 {adapters || '—'}</span>
    </div>
  )
}
