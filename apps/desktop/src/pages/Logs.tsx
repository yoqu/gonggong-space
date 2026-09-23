import { Button, Tabs, toast } from '@web/ui'
import { FileWarning, GitBranch, HardDrive, type LucideIcon, Plug, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Check, type CheckStatus, ipc, type LogLevel, type LogLine, type NetResult } from '../ipc'
import type { PageProps } from '.'

const ICONS: Record<Check['kind'], LucideIcon> = {
  server: Server,
  agent: Plug,
  git: GitBranch,
  disk: HardDrive,
  eol: FileWarning,
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  ok: '#32D74B',
  warn: '#FF9F0A',
  error: '#FF453A',
  skipped: 'var(--color-text-tertiary)',
}

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'debug', label: 'debug' },
]
const LOG_LIMIT = 500
const REFRESH_MS = 2000

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })

export function LogsPage(_: PageProps) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [net, setNet] = useState<NetResult | 'measuring' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [level, setLevel] = useState<LogLevel>('info')
  const [lines, setLines] = useState<LogLine[]>([])

  useEffect(() => {
    ipc.diagnostics().then(setChecks, fail)
  }, [])

  useEffect(() => {
    const load = () => ipc.recentLogs(level, LOG_LIMIT).then(setLines, () => {})
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [level])

  const measure = async () => {
    setNet('measuring')
    try {
      setNet(await ipc.measureNet())
    } catch (e) {
      setNet(null)
      fail(e)
    }
  }

  const exportBundle = async () => {
    setExporting(true)
    try {
      const path = await ipc.exportDiagnostics()
      if (path) toast({ type: 'success', message: `诊断包已导出：${path}` })
    } catch (e) {
      fail(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="dk-checks">
        {(checks ?? []).map((c) => {
          const Icon = ICONS[c.kind]
          return (
            <div key={c.kind} className="dk-check" data-testid="check" data-status={c.status}>
              <Icon size={14} color={STATUS_COLOR[c.status]} />
              <div className="dk-check__text">
                <span className="dk-check__label">{c.label}</span>
                <span className="dk-sub dk-ellipsis" title={c.detail}>
                  {c.detail}
                </span>
              </div>
            </div>
          )
        })}
        {checks ? null : <div className="dk-card dk-card--muted">检测中…</div>}
      </div>
      <div className="dk-inline">
        <Button variant="outline" size="sm" onClick={measure} disabled={net === 'measuring'}>
          测量延迟与带宽
        </Button>
        <Button variant="outline" size="sm" onClick={exportBundle} disabled={exporting}>
          导出诊断包
        </Button>
        <span className="dk-sub">
          {net === 'measuring'
            ? '测量中…'
            : net
              ? `延迟 ${net.latencyMs} ms · 带宽 ${net.bandwidthMbps} Mbps · 已上报服务器`
              : ''}
        </span>
        <span className="dk-flex" />
        <Tabs size="sm" items={LEVELS} value={level} onChange={setLevel} />
      </div>
      <div className="dk-logpane" data-testid="log-pane">
        {lines.length === 0 ? <div className="dk-log">暂无日志</div> : null}
        {lines.map((l, i) => (
          // Lines have no identity; the list is replaced wholesale on every refresh.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <div key={i} className={`dk-log dk-log--${l.level}`}>
            {l.text}
          </div>
        ))}
      </div>
    </>
  )
}
