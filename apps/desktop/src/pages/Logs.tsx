import {
  Alert,
  Button,
  EmptyState,
  GroupBox,
  Icon,
  type IconName,
  SegmentedControl,
  Skeleton,
  Spinner,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type Check, type CheckStatus, ipc, type LogLevel, type LogLine, type NetResult } from '../ipc'
import { fail, Section } from '../lib/ui'
import type { PageProps } from '.'

const ICONS: Record<Check['kind'], IconName> = {
  server: 'server',
  agent: 'plug',
  git: 'git-branch',
  disk: 'hard-drive',
  eol: 'doc-warning',
}

const STATUS: Record<CheckStatus, { color: string; tone: TagTone; text: string }> = {
  ok: { color: 'var(--system-green)', tone: 'green', text: t('正常') },
  warn: { color: 'var(--system-orange)', tone: 'orange', text: t('注意') },
  error: { color: 'var(--system-red)', tone: 'red', text: t('异常') },
  skipped: { color: 'var(--system-gray)', tone: 'gray', text: t('跳过') },
}

const LEVELS: { value: LogLevel; label: string }[] = [
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'debug', label: 'debug' },
]
const LOG_LIMIT = 500
const REFRESH_MS = 2000

/** Overlapping refreshes may both bring a line: only those after the last one shown count. */
function appendLines(prev: LogLine[], next: LogLine[]): LogLine[] {
  const last = prev.at(-1)?.seq ?? 0
  const fresh = next.filter((l) => l.seq > last)
  return fresh.length ? [...prev, ...fresh].slice(-LOG_LIMIT) : prev
}

export function LogsPage(_: PageProps) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [diagError, setDiagError] = useState('')
  const [diagLoading, setDiagLoading] = useState(true)
  const [diagTick, setDiagTick] = useState(0)
  const [net, setNet] = useState<NetResult | 'measuring' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [level, setLevel] = useState<LogLevel>('info')
  const [lines, setLines] = useState<LogLine[]>([])
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [logsError, setLogsError] = useState('')
  const [logsTick, setLogsTick] = useState(0)

  const reloadDiag = useCallback(() => setDiagTick((n) => n + 1), [])
  const reloadLogs = useCallback(() => setLogsTick((n) => n + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `diagTick` triggers a fresh diagnostics run
  useEffect(() => {
    let alive = true
    setDiagLoading(true)
    ipc.diagnostics().then(
      (res) => {
        if (!alive) return
        setChecks(res)
        setDiagError('')
        setDiagLoading(false)
      },
      (e) => {
        if (!alive) return
        setDiagError(e instanceof Error ? e.message : String(e))
        setDiagLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [diagTick])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `logsTick` retries logs loading
  useEffect(() => {
    let alive = true
    // A level's first load replaces the list; later ones fetch only newer lines, so a quiet log costs nothing.
    let after: number | null = null
    setLogsLoaded(false)
    setLogsError('')
    const load = () =>
      ipc.recentLogs(level, LOG_LIMIT, after).then(
        (next) => {
          if (!alive) return
          const first = after === null
          after = next.at(-1)?.seq ?? after ?? 0
          setLines((prev) => (first ? next : appendLines(prev, next)))
          setLogsLoaded(true)
          setLogsError('')
        },
        (e) => {
          if (!alive) return
          setLogsLoaded(true)
          setLogsError(e instanceof Error ? e.message : String(e))
        },
      )
    void load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [level, logsTick])

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
      if (path) toast({ type: 'success', message: t('诊断包已导出：{path}', { path }) })
    } catch (e) {
      fail(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Section
        title={t('诊断')}
        aside={
          checks ? (
            <Button size="small" loading={diagLoading} onClick={reloadDiag}>
              {t('重新检测')}
            </Button>
          ) : undefined
        }
      >
        {diagError ? (
          <Alert
            variant="error"
            title={t('诊断未完成')}
            description={diagError}
            retrying={diagLoading}
            onRetry={reloadDiag}
          />
        ) : (
          <GroupBox>
            {(checks ?? []).map((c) => (
              <div key={c.kind} className="dk-row" data-testid="check" data-status={c.status}>
                <Icon name={ICONS[c.kind]} size={16} color={STATUS[c.status].color} />
                <div className="dk-row__main">
                  <span>{c.label}</span>
                  <span className="dk-sub dk-ellipsis" title={c.detail}>
                    {c.detail}
                  </span>
                </div>
                <Tag tone={STATUS[c.status].tone}>{STATUS[c.status].text}</Tag>
              </div>
            ))}
            {checks?.length === 0 ? <EmptyState compact icon="warning" title={t('诊断未完成')} /> : null}
            {checks ? null : (
              <div className="dk-row">
                <Spinner />
                <span className="dk-sub">
                  {t('正在检测服务器连接、Agent、git 凭据、磁盘与换行符，可能需要半分钟…')}
                </span>
              </div>
            )}
          </GroupBox>
        )}
        <div className="dk-inline">
          <Button onClick={measure} disabled={net === 'measuring'} loading={net === 'measuring'}>
            {t('测量延迟与带宽')}
          </Button>
          <Button onClick={exportBundle} disabled={exporting} loading={exporting}>
            {t('导出诊断包…')}
          </Button>
          <span className="dk-sub">
            {net === 'measuring'
              ? t('测量中…')
              : net
                ? t('延迟 {ms} ms · 带宽 {mbps} Mbps · 已上报服务器', {
                    ms: net.latencyMs,
                    mbps: net.bandwidthMbps,
                  })
                : ''}
          </span>
        </div>
      </Section>
      <Section
        title={t('最近日志')}
        aside={
          <SegmentedControl
            aria-label={t('日志级别')}
            size="small"
            items={LEVELS}
            value={level}
            onChange={setLevel}
          />
        }
      >
        {logsError ? <Alert variant="error" description={logsError} onRetry={reloadLogs} /> : null}
        <div className="dk-logpane" data-testid="log-pane">
          {!logsLoaded ? (
            <Skeleton count={3} />
          ) : lines.length === 0 && !logsError ? (
            <EmptyState compact icon="doc-text" title={t('暂无日志')} />
          ) : null}
          {lines.map((l) => (
            <div key={l.seq} className={`dk-log dk-log--${l.level}`}>
              {l.text}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
