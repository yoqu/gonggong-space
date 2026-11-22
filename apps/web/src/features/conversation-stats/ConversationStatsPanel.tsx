import type {
  ConversationDayDto,
  ConversationMetricsDto,
  ConversationOpsDto,
  ConversationOverviewDto,
  ConversationStatsBy,
  ConversationStatsRowDto,
  RunStatus,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { ago, browserTimeZone, localDateTime } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  EmptyState,
  NoDataArt,
  SegmentedControl,
  Spinner,
  Table,
  type TableColumn,
  Tabs,
  Tag,
} from '../../ui'
import { Sparkline, TrendChart } from '../../ui/chart'
import { STATUS_LABEL } from '../chat/RunGraphics'
import { fmtWorked } from '../runs/activity'
import { Delta, dayLabel, peakOf, ShareCard, sharePct } from '../usage/metrics'
import './conversation-stats.css'

type Row = ConversationStatsRowDto & { id: string }
type DayMetric = Exclude<keyof ConversationDayDto, 'day'>

const WINDOWS = ['7', '30', '90'] as const
const DAY_METRICS: { value: DayMetric; label: string }[] = [
  { value: 'userMessages', label: t('用户消息') },
  { value: 'botMessages', label: t('Bot 回复') },
  { value: 'runs', label: t('运行轮次') },
  { value: 'activeUsers', label: t('活跃成员') },
  { value: 'activeConversations', label: t('活跃会话') },
]
const STATUS_COLOR: Record<RunStatus, string> = {
  completed: 'var(--system-green)',
  running: 'var(--system-blue)',
  awaiting_approval: 'var(--system-orange)',
  awaiting_answer: 'var(--system-yellow)',
  queued: 'var(--system-teal)',
  offline_wait: 'var(--system-indigo)',
  interrupted: 'var(--system-red)',
  forbidden: 'var(--system-pink)',
  expired: 'var(--system-gray)',
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')
const rate = (r: { completedRuns: number; endedRuns: number }) => pct(r.completedRuns, r.endedRuns)

function Tiles({ o, days }: { o: ConversationOverviewDto; days: number }) {
  const { current: c, previous: p } = o
  const counted = (label: string, k: keyof ConversationMetricsDto & DayMetric) => ({
    label,
    value: String(c[k]),
    spark: o.daily.map((d) => d[k]),
    foot: <Delta now={c[k]} before={p[k]} days={days} />,
  })
  const tiles = [
    {
      label: t('会话总数'),
      value: String(o.groups + o.dms),
      foot: <span className="usage-stat__delta">{t('群 {g} · 私聊 {d}', { g: o.groups, d: o.dms })}</span>,
    },
    counted(t('活跃会话'), 'activeConversations'),
    {
      label: t('新建会话'),
      value: String(c.newConversations),
      foot: <Delta now={c.newConversations} before={p.newConversations} days={days} />,
    },
    counted(t('用户消息'), 'userMessages'),
    counted(t('Bot 回复'), 'botMessages'),
    counted(t('活跃成员'), 'activeUsers'),
    counted(t('运行轮次'), 'runs'),
    {
      label: t('成功率'),
      value: rate(c),
      foot: (
        <span className="usage-stat__delta">
          {t('已结束 {e} 轮，完成 {c} 轮', { c: c.completedRuns, e: c.endedRuns })}
        </span>
      ),
    },
    {
      label: t('平均耗时'),
      value: c.avgRunMs === null ? '—' : fmtWorked(c.avgRunMs),
      foot: <span className="usage-stat__delta">{t('已完成轮次')}</span>,
    },
  ]
  return (
    <div className="usage-stats">
      {tiles.map((tile) => (
        <div key={tile.label} className="usage-stat">
          <span className="usage-stat__label">{tile.label}</span>
          <div className="usage-stat__body">
            <span className="usage-stat__value">{tile.value}</span>
            {'spark' in tile ? <Sparkline values={tile.spark} /> : null}
          </div>
          {tile.foot}
        </div>
      ))}
    </div>
  )
}

function Trend({ daily, days }: { daily: ConversationDayDto[]; days: number }) {
  const [metric, setMetric] = useState<DayMetric>('userMessages')
  const label = DAY_METRICS.find((m) => m.value === metric)?.label ?? ''
  const points = daily.map((d) => {
    const { label: day, tick } = dayLabel(d.day)
    return {
      label: day,
      tick,
      value: d[metric],
      lines: [
        `${label} ${d[metric]}`,
        ...DAY_METRICS.filter((x) => x.value !== metric).map((x) => `${x.label} ${d[x.value]}`),
      ],
    }
  })
  const total = daily.reduce((n, d) => n + d[metric], 0)
  const peak = peakOf(points)
  const summary =
    t('近 {n} 天每日{metric}：合计 {total}', { n: days, metric: label, total }) +
    (peak.value ? t('，峰值 {day} {value}', { day: peak.label, value: peak.value }) : '')
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">{t('每日趋势')}</span>
        <SegmentedControl
          size="small"
          aria-label={t('趋势指标')}
          value={metric}
          onChange={setMetric}
          items={DAY_METRICS}
        />
      </div>
      <TrendChart points={points} format={String} aria-label={summary} />
    </section>
  )
}

const statusKey = (s: string): string => (s === 'succeeded' ? 'completed' : s)
const statusLabel = (s: string): string => STATUS_LABEL[statusKey(s) as RunStatus] ?? s
const statusColor = (s: string): string => STATUS_COLOR[statusKey(s) as RunStatus] ?? 'var(--system-gray)'

function Statuses({ statuses }: { statuses: ConversationOverviewDto['statuses'] }) {
  // Fold legacy status values (e.g. historical `succeeded` rows) into canonical keys so legend & bar stay complete.
  const merged = [
    ...statuses.reduce((m, s) => {
      const key = statusKey(s.status)
      m.set(key, (m.get(key) ?? 0) + s.count)
      return m
    }, new Map<string, number>()),
  ].map(([status, count]) => ({ status, count }))
  const total = merged.reduce((n, s) => n + s.count, 0)
  if (!total) return null
  const parts = merged.map((s) => ({
    key: s.status,
    name: statusLabel(s.status),
    value: s.count,
    color: statusColor(s.status),
  }))
  return (
    <ShareCard
      title={t('运行状态分布')}
      meta={t('{n} 轮', { n: total })}
      barLabel={t('运行状态：{parts}', {
        parts: parts.map((p) => `${p.name} ${sharePct(p.value, total)}`).join(t('，')),
      })}
      legendLabel={t('运行状态图例')}
      parts={parts}
      total={total}
    />
  )
}

type Reason = ConversationOpsDto['failures']['reasons'][number] & { id: string }

/** 运营: whether people beyond the builders take it up, and why their runs fail. */
function Ops({ ops, days }: { ops: ConversationOpsDto; days: number }) {
  const { retention: r, activation: a, failures: f, audience: u } = ops
  const tiles = [
    {
      label: t('留存'),
      value: pct(r.retained, r.previous),
      foot: t('前 {n} 天活跃 {p} 人，{r} 人回访', { n: days, p: r.previous, r: r.retained }),
    },
    {
      label: t('新成员激活'),
      value: pct(a.activated, a.joined),
      foot:
        t('新加入 {j} 人，{a} 人已发起运行', { j: a.joined, a: a.activated }) +
        (a.medianHours === null ? '' : t(' · 中位 {h} 小时', { h: a.medianHours })),
    },
    {
      label: t('失败率'),
      value: pct(f.failedRuns, f.endedRuns),
      foot: t('已结束 {e} 轮，失败 {f} 轮（不含手动停止）', { e: f.endedRuns, f: f.failedRuns }),
    },
    {
      label: t('使用者占比'),
      value: pct(u.userRuns, u.userRuns + u.builderRuns),
      foot: t('使用者 {u} 人 {ur} 轮 · 搭建者 {b} 人 {br} 轮', {
        u: u.users,
        ur: u.userRuns,
        b: u.builders,
        br: u.builderRuns,
      }),
    },
  ]
  return (
    <section className="cstats-ops" aria-labelledby="cstats-ops-title">
      <span id="cstats-ops-title" className="usage-card__title">
        {t('运营')}
      </span>
      <div className="usage-stats">
        {tiles.map((tile) => (
          <div key={tile.label} className="usage-stat">
            <span className="usage-stat__label">{tile.label}</span>
            <div className="usage-stat__body">
              <span className="usage-stat__value">{tile.value}</span>
            </div>
            <span className="usage-stat__delta">{tile.foot}</span>
          </div>
        ))}
      </div>
      {f.reasons.length ? (
        <Table<Reason>
          aria-label={t('失败原因')}
          rows={f.reasons.map((x) => ({ ...x, id: `${x.status}:${x.step}` }))}
          multiple={false}
          columns={[
            { key: 'status', title: t('状态'), width: 96, render: (x) => statusLabel(x.status) },
            { key: 'step', title: t('失败原因'), render: (x) => x.step || '—' },
            { key: 'count', title: t('轮次'), width: 72, align: 'right' },
          ]}
        />
      ) : null}
    </section>
  )
}

const num = (key: keyof ConversationStatsRowDto, title: string): TableColumn<Row> => ({
  key,
  title,
  width: 80,
  align: 'right',
  sortable: true,
})
const COLUMNS: Record<string, TableColumn<Row>> = {
  team: { key: 'teamName', title: t('团队'), width: 120, sortable: true, secondary: true },
  owner: { key: 'ownerName', title: t('创建人'), width: 96, secondary: true },
  botOwner: { key: 'ownerName', title: t('主人'), width: 96, secondary: true },
  userMessages: num('userMessages', t('用户消息')),
  botMessages: num('botMessages', t('Bot 回复')),
  conversations: num('conversations', t('参与会话')),
  activeConversations: num('conversations', t('活跃会话')),
  activeUsers: num('activeUsers', t('活跃成员')),
  botUsers: num('activeUsers', t('使用人数')),
  runs: num('runs', t('运行轮次')),
  rate: {
    key: 'rate',
    title: t('成功率'),
    width: 72,
    align: 'right',
    sortable: true,
    sortValue: (r) => (r.endedRuns ? r.completedRuns / r.endedRuns : -1),
    render: rate,
  },
  last: {
    key: 'lastActiveAt',
    title: t('最近活跃'),
    width: 112,
    sortable: true,
    secondary: true,
    sortValue: (r) => (r.lastActiveAt ? Date.parse(r.lastActiveAt) : 0),
    render: (r) =>
      r.lastActiveAt ? <span title={localDateTime(r.lastActiveAt)}>{ago(r.lastActiveAt)}</span> : '—',
  },
}

const TABS: { value: ConversationStatsBy; label: string; name: string; columns: (keyof typeof COLUMNS)[] }[] =
  [
    {
      value: 'conversation',
      label: t('按会话'),
      name: t('会话#conversation'),
      columns: ['team', 'owner', 'userMessages', 'botMessages', 'activeUsers', 'runs', 'rate', 'last'],
    },
    {
      value: 'user',
      label: t('按成员'),
      name: t('成员'),
      columns: ['userMessages', 'conversations', 'runs', 'rate', 'last'],
    },
    {
      value: 'bot',
      label: t('按 Bot'),
      name: 'Bot',
      columns: ['team', 'botOwner', 'botMessages', 'conversations', 'botUsers', 'runs', 'rate', 'last'],
    },
    {
      value: 'team',
      label: t('按团队'),
      name: t('团队'),
      columns: ['activeConversations', 'userMessages', 'botMessages', 'activeUsers', 'runs', 'rate', 'last'],
    },
  ]

function Details({
  path,
  days,
  platform,
}: {
  path: (sub: string, q: string) => string
  days: number
  platform: boolean
}) {
  const [by, setBy] = useState<ConversationStatsBy>('conversation')
  const tabs = platform ? TABS : TABS.filter((x) => x.value !== 'team')
  const tab = tabs.find((x) => x.value === by) ?? tabs[0]!
  const {
    data: rows,
    error,
    loading,
    reload,
  } = useGet<ConversationStatsRowDto[]>(path('', `by=${tab.value}&days=${days}`))
  const columns = tab.columns.filter((c) => platform || c !== 'team').map((c) => COLUMNS[c]!)
  return (
    <>
      <Tabs value={tab.value} onChange={setBy} items={tabs} />
      {error ? <Alert variant="error" description={error} retrying={loading} onRetry={reload} /> : null}
      {rows === null ? (
        error ? null : (
          <Spinner size={18} />
        )
      ) : rows.length ? (
        <Table<Row>
          aria-label={t('会话明细')}
          rows={rows.map((r) => ({ ...r, id: r.key }))}
          multiple={false}
          defaultSort={{ key: 'lastActiveAt', dir: 'desc' }}
          columns={[
            {
              key: 'name',
              title: tab.name,
              sortable: true,
              render: (r) => (
                <>
                  {r.name}
                  {r.kind === 'dm' ? <Tag className="cstats-kind">{t('私聊')}</Tag> : null}
                </>
              ),
            },
            ...columns,
          ]}
        />
      ) : (
        <EmptyState compact illustration={<NoDataArt />} title={t('近 {n} 天没有会话', { n: days })} />
      )}
    </>
  )
}

/**
 * 会话统计: conversations, messages and runs over 7/30/90 days, with breakdowns by conversation, member, Bot and
 * (platform-wide) team. `base` is /admin/conversation-stats (sysadmins; `teamId` narrows) or /teams/:id/conversation-stats.
 */
export function ConversationStatsPanel({ base, teamId = '' }: { base: string; teamId?: string }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]>('30')
  const days = Number(win)
  const platform = base.startsWith('/admin/')
  const team = teamId ? `&teamId=${teamId}` : ''
  const path = (sub: string, q: string) => `${base}${sub}?${q}${team}`
  const {
    data: o,
    error,
    loading,
    reload,
  } = useGet<ConversationOverviewDto>(
    path('/overview', `days=${days}&tz=${encodeURIComponent(browserTimeZone)}`),
  )
  const {
    data: ops,
    error: opsError,
    loading: opsLoading,
    reload: reloadOps,
  } = useGet<ConversationOpsDto>(path('/ops', `days=${days}`))
  return (
    <>
      <SegmentedControl
        aria-label={t('时间范围')}
        value={win}
        onChange={setWin}
        items={WINDOWS.map((n) => ({ value: n, label: t('近 {n} 天', { n: Number(n) }) }))}
      />
      {error ? <Alert variant="error" description={error} retrying={loading} onRetry={reload} /> : null}
      {o ? (
        <>
          <Tiles o={o} days={days} />
          <Trend daily={o.daily} days={days} />
          <Statuses statuses={o.statuses} />
          {ops ? (
            <Ops ops={ops} days={days} />
          ) : opsError ? (
            <Alert variant="error" description={opsError} retrying={opsLoading} onRetry={reloadOps} />
          ) : null}
        </>
      ) : error ? null : (
        <Spinner size={18} />
      )}
      <Details path={path} days={days} platform={platform && !teamId} />
      <p className="usage-note">
        {t(
          '只统计数量，不含消息内容 · 消息为成员与 Bot 的发言，不含系统事件 · 运行轮次按发起时间计入 · 成功率 = 已完成 / 已结束 · 搭建者：系统管理员、团队管理员、电脑或 Bot 的主人、群管理员，其余为使用者。',
        )}
      </p>
    </>
  )
}
