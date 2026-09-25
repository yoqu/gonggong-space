import type { UsageRowDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Dialog, EmptyState, LevelIndicator, Spinner, Table, Tabs } from '../../ui'
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

/** Compact bars scaled to the largest token total (Bot detail); unreported-only rows show 未上报. */
export function UsageBars({ rows }: { rows: UsageRowDto[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens))
  return (
    <div className="usage-bars">
      {rows.map((r) => (
        <div key={r.key} className="usage-bars__row" data-testid="usage-row">
          <span className="usage-bars__name">{r.name}</span>
          <LevelIndicator value={r.totalTokens} max={max} aria-label={`${r.name} 的用量`} />
          <span className="usage-bars__value">{r.totalTokens ? fmtTokens(r.totalTokens) : '未上报'}</span>
        </div>
      ))}
    </div>
  )
}

const UNIT: Record<By, string> = { bot: '个 Bot', user: '位触发人', group: '个群' }
const NAME_COLUMN: Record<By, string> = { bot: 'Bot', user: '触发人', group: '群' }
const PART_COLORS = [
  'var(--system-blue)',
  'var(--system-teal)',
  'var(--system-purple)',
  'var(--system-orange)',
  'var(--system-pink)',
]

function Stats({ rows, by }: { rows: UsageRowDto[]; by: By }) {
  const sum = (k: 'totalTokens' | 'runs' | 'unreported') => rows.reduce((n, r) => n + r[k], 0)
  const tiles = [
    { label: 'token 合计', value: fmtTokens(sum('totalTokens')) },
    { label: '运行轮次', value: String(sum('runs')) },
    { label: '未上报轮次', value: String(sum('unreported')) },
    { label: '参与统计', value: `${rows.length} ${UNIT[by]}` },
  ]
  return (
    <div className="usage-stats">
      {tiles.map((t) => (
        <div key={t.label} className="usage-stat">
          <span className="usage-stat__label">{t.label}</span>
          <span className="usage-stat__value">{t.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Token share of the top five, the rest folded into 其他. */
function Share({ rows }: { rows: UsageRowDto[] }) {
  const total = rows.reduce((n, r) => n + r.totalTokens, 0)
  if (!total) return null
  const top = [...rows].sort((a, b) => b.totalTokens - a.totalTokens).filter((r) => r.totalTokens)
  const shown = top.slice(0, PART_COLORS.length)
  const rest = total - shown.reduce((n, r) => n + r.totalTokens, 0)
  const parts = [
    ...shown.map((r, i) => ({
      value: r.totalTokens,
      color: PART_COLORS[i],
      label: `${r.name} ${fmtTokens(r.totalTokens)}`,
    })),
    ...(rest ? [{ value: rest, color: 'var(--system-gray)', label: `其他 ${fmtTokens(rest)}` }] : []),
  ]
  return (
    <LevelIndicator
      className="usage-share"
      max={total}
      value={total}
      parts={parts}
      aria-label="token 分布"
      label={
        <>
          <span>token 分布</span>
          <span className="usage-share__total">合计 {fmtTokens(total)} tokens</span>
        </>
      }
    />
  )
}

/** Last 30 days by bot, trigger user or group; the server scopes members to their own bots (spec §3.7). */
function UsagePanel() {
  const [by, setBy] = useState<By>('bot')
  const { rows, error } = useUsage(`by=${by}&days=30`)
  const max = Math.max(1, ...(rows ?? []).map((r) => r.totalTokens))
  return (
    <>
      <Tabs value={by} onChange={setBy} items={TABS} />
      {error ? <Alert variant="error" description={error} /> : null}
      {rows?.length ? (
        <>
          <Stats rows={rows} by={by} />
          <Share rows={rows} />
        </>
      ) : null}
      {rows === null ? (
        error ? null : (
          <Spinner size={18} />
        )
      ) : rows.length ? (
        <Table<UsageRowDto & { id: string }>
          aria-label="用量明细"
          rows={rows.map((r) => ({ ...r, id: r.key }))}
          multiple={false}
          defaultSort={{ key: 'totalTokens', dir: 'desc' }}
          columns={[
            { key: 'name', title: NAME_COLUMN[by], sortable: true },
            {
              key: 'share',
              title: '占比',
              width: 140,
              render: (r) => (
                <LevelIndicator
                  className="usage-meter"
                  value={r.totalTokens}
                  max={max}
                  aria-label={`${r.name} 的用量`}
                />
              ),
            },
            {
              key: 'totalTokens',
              title: 'token',
              width: 96,
              align: 'right',
              sortable: true,
              render: (r) => (r.totalTokens ? fmtTokens(r.totalTokens) : '未上报'),
            },
            { key: 'runs', title: '轮次', width: 64, align: 'right', sortable: true },
            {
              key: 'unreported',
              title: '未上报',
              width: 72,
              align: 'right',
              secondary: true,
              sortable: true,
            },
          ]}
        />
      ) : (
        <EmptyState compact icon="chart-bar" title="近 30 天没有运行" />
      )}
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
    <Dialog open title="我的用量" subtitle="我的 Bot 近 30 天用量" width={600} onClose={onClose}>
      <UsagePanel />
    </Dialog>
  )
}
