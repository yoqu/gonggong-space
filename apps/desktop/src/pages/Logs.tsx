import {
  Button,
  EmptyState,
  GroupBox,
  Icon,
  type IconName,
  SegmentedControl,
  Spinner,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { type Check, type CheckStatus, ipc, type LogLevel, type LogLine, type NetResult } from '../ipc'
import { Section } from '../lib/ui'
import { openGuide } from '../permissions'
import type { PageProps } from '.'

const ICONS: Record<Check['kind'], IconName> = {
  server: 'server',
  agent: 'plug',
  git: 'git-branch',
  disk: 'hard-drive',
  eol: 'doc-warning',
  screen_recording: 'record',
  accessibility: 'hand',
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

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })

export function LogsPage(_: PageProps) {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [net, setNet] = useState<NetResult | 'measuring' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [level, setLevel] = useState<LogLevel>('info')
  const [lines, setLines] = useState<LogLine[]>([])

  useEffect(() => {
    ipc.diagnostics().then(setChecks, (e) => {
      setChecks([])
      fail(e)
    })
  }, [])

  useEffect(() => {
    // Unchanged logs keep the old list, so a quiet log doesn't re-render every refresh.
    const load = () =>
      ipc.recentLogs(level, LOG_LIMIT).then(
        (next) => setLines((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)),
        () => {},
      )
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
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
      if (path) toast({ type: 'success', message: t('诊断包已导出：{path}', { path }) })
    } catch (e) {
      fail(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <Section title={t('诊断')}>
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
              {c.status === 'warn' && (c.kind === 'screen_recording' || c.kind === 'accessibility') ? (
                <Button size="small" onClick={openGuide}>
                  {t('去授权')}
                </Button>
              ) : null}
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
        <div className="dk-inline">
          <Button onClick={measure} disabled={net === 'measuring'}>
            {t('测量延迟与带宽')}
          </Button>
          <Button onClick={exportBundle} disabled={exporting}>
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
        <div className="dk-logpane" data-testid="log-pane">
          {lines.length === 0 ? <EmptyState compact icon="doc-text" title={t('暂无日志')} /> : null}
          {lines.map((l, i) => (
            // Lines have no identity; the list is replaced wholesale on every refresh.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <div key={i} className={`dk-log dk-log--${l.level}`}>
              {l.text}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}
