import type { UsageRowDto } from '@gonggong/protocol'
import { type CSSProperties, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Dialog, EmptyState, Icon, Spinner, Tabs } from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { errorText } from '../auth/AuthCard'
import './usage.css'

type By = 'bot' | 'user' | 'group'

const TABS: { value: By; label: string }[] = [
  { value: 'bot', label: '按 Bot' },
  { value: 'user', label: '按触发人' },
  { value: 'group', label: '按群' },
]

export const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** GET /api/usage; `rows` stays null while loading. */
export function useUsage(query: string) {
  const [rows, setRows] = useState<UsageRowDto[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setRows(null)
    setError('')
    api
      .get<UsageRowDto[]>(`/usage?${query}`)
      .then(setRows)
      .catch((e) => setError(errorText(e)))
  }, [query])
  return { rows, error }
}

/** Horizontal bars scaled to the largest token total; unreported-only rows show 未上报. */
export function UsageBars({ rows, compact }: { rows: UsageRowDto[]; compact?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens))
  return (
    <div className={compact ? 'usage-bars usage-bars--compact' : 'usage-bars'}>
      {rows.map((r) => (
        <div key={r.key} className="usage-bars__row" data-testid="usage-row">
          <span className="usage-bars__name">{r.name}</span>
          <div className="usage-bars__track">
            <div className="usage-bars__fill" style={{ width: `${(r.totalTokens / max) * 100}%` }} />
          </div>
          <span className="usage-bars__value">
            {r.totalTokens ? `${fmtTokens(r.totalTokens)}${compact ? '' : ' tokens'}` : '未上报'}
          </span>
          {compact ? null : <span className="usage-bars__runs">{r.runs} 轮</span>}
        </div>
      ))}
    </div>
  )
}

const UNIT: Record<By, string> = { bot: '个 Bot', user: '位触发人', group: '个群' }

function Stats({ rows, by }: { rows: UsageRowDto[]; by: By }) {
  const sum = (k: 'totalTokens' | 'runs' | 'unreported') => rows.reduce((n, r) => n + r[k], 0)
  const tiles = [
    { label: 'token 合计', value: fmtTokens(sum('totalTokens')), color: 'var(--system-blue)' },
    { label: '运行轮次', value: String(sum('runs')), color: 'var(--system-green)' },
    { label: '未上报轮次', value: String(sum('unreported')), color: 'var(--system-orange)' },
    { label: '参与统计', value: `${rows.length} ${UNIT[by]}`, color: 'var(--system-purple)' },
  ]
  return (
    <div className="usage-stats">
      {tiles.map((t) => (
        <div key={t.label} className="usage-stat" style={{ '--stat-color': t.color } as CSSProperties}>
          <span className="usage-stat__label">{t.label}</span>
          <span className="usage-stat__value">{t.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Last 30 days by bot, trigger user or group; the server scopes members to their own bots (spec §3.7). */
function UsagePanel() {
  const [by, setBy] = useState<By>('bot')
  const { rows, error } = useUsage(`by=${by}&days=30`)
  return (
    <>
      <Tabs value={by} onChange={setBy} items={TABS} />
      {error ? <Alert variant="error" description={error} /> : null}
      {rows?.length ? <Stats rows={rows} by={by} /> : null}
      <div className="usage-panel">
        {rows === null ? (
          error ? null : (
            <Spinner size={18} />
          )
        ) : rows.length ? (
          <UsageBars rows={rows} />
        ) : (
          <EmptyState bare icon={<Icon name="chart-bar" size={20} />} title="近 30 天没有运行" />
        )}
      </div>
      <p className="usage-note">
        近 30 天 · 不做配额限制 · Codex 适配器未上报的轮次计为「未上报」，不计入 token 合计。
      </p>
    </>
  )
}

/** 管理后台 · 用量: every bot in the system. */
export function UsagePage() {
  return (
    <AdminPage title="用量" desc="按 Bot、触发人、群汇总 token 用量。">
      <UsagePanel />
    </AdminPage>
  )
}

/** 我的用量 from the account menu: my bots only. */
export function UsageDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="我的用量" subtitle="我的 Bot 近 30 天用量" width={560} onClose={onClose}>
      <UsagePanel />
    </Dialog>
  )
}
