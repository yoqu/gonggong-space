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
import { ago, dateLocale } from '../../lib/time'
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
import { TZ } from '../usage/UsagePage'
import '../usage/usage.css'
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

function Delta({ now, before, days }: { now: number; before: number; days: number }) {
  if (!before) return null
  const p = Math.round(((now - before) / before) * 100)
  return (
    <span className="usage-stat__delta">
      <span>{p ? `${p > 0 ? '↑' : '↓'} ${Math.abs(p)}%` : t('持平')}</span>
      <span>{t('较前 {n} 天', { n: days })}</span>
    </span>
  )
}

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
    const [m, dd] = d.day.split('-').slice(1).map(Number) as [number, number]
    return {
      label: t('{m}月{d}日', { m, d: dd }),
      tick: `${m}/${dd}`,
      value: d[metric],
      lines: [
        `${label} ${d[metric]}`,
        ...DAY_METRICS.filter((x) => x.value !== metric).map((x) => `${x.label} ${d[x.value]}`),
      ],
    }
  })
  const total = daily.reduce((n, d) => n + d[metric], 0)
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), points[0] ?? { label: '', value: 0 })
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

function Statuses({ statuses }: { statuses: ConversationOverviewDto['statuses'] }) {
  const total = statuses.reduce((n, s) => n + s.count, 0)
  if (!total) return null
  return (
    <section className="usage-card">
      <div className="usage-card__head">
        <span className="usage-card__title">{t('运行状态分布')}</span>
        <span className="usage-card__meta">{t('{n} 轮', { n: total })}</span>
      </div>
      <div
        className="usage-share"
        role="img"
        aria-label={t('运行状态：{parts}', {
          parts: statuses.map((s) => `${STATUS_LABEL[s.status]} ${pct(s.count, total)}`).join(t('，')),
        })}
      >
        {statuses.map((s) => (
          <span key={s.status} style={{ flexGrow: s.count, background: STATUS_COLOR[s.status] }} />
        ))}
      </div>
      <ul className="usage-legend" aria-label={t('运行状态图例')}>
        {statuses.map((s) => (
          <li key={s.status}>
            <span
              className="usage-legend__swatch"
              style={{ background: STATUS_COLOR[s.status] }}
              aria-hidden="true"
            />
            <span className="usage-legend__name">{STATUS_LABEL[s.status]}</span>
            <span className="usage-legend__value">{s.count}</span>
            <span className="usage-legend__pct">{pct(s.count, total)}</span>
          </li>
        ))}
      </ul>
    </section>
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
            { key: 'status', title: t('状态'), width: 96, render: (x) => STATUS_LABEL[x.status] },
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
      r.lastActiveAt ? (
        <span title={new Date(r.lastActiveAt).toLocaleString(dateLocale)}>{ago(r.lastActiveAt)}</span>
      ) : (
        '—'
      ),
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
  const { data: rows, error } = useGet<ConversationStatsRowDto[]>(path('', `by=${tab.value}&days=${days}`))
  const columns = tab.columns.filter((c) => platform || c !== 'team').map((c) => COLUMNS[c]!)
  return (
    <>
      <Tabs value={tab.value} onChange={setBy} items={tabs} />
      {error ? <Alert variant="error" description={error} /> : null}
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
  const { data: o, error } = useGet<ConversationOverviewDto>(
    path('/overview', `days=${days}&tz=${encodeURIComponent(TZ)}`),
  )
  const { data: ops } = useGet<ConversationOpsDto>(path('/ops', `days=${days}`))
  return (
    <>
      <SegmentedControl
        aria-label={t('时间范围')}
        value={win}
        onChange={setWin}
        items={WINDOWS.map((n) => ({ value: n, label: t('近 {n} 天', { n: Number(n) }) }))}
      />
      {error ? <Alert variant="error" description={error} /> : null}
      {o ? (
        <>
          <Tiles o={o} days={days} />
          <Trend daily={o.daily} days={days} />
          <Statuses statuses={o.statuses} />
          {ops ? <Ops ops={ops} days={days} /> : null}
        </>
      ) : error ? null : (
        <Spinner size={18} />
      )}
      <Details path={path} days={days} platform={platform && !teamId} />
      <p className="usage-note">
        {t(
          '只统计数量，不含消息内容 · 消息为成员与 Bot 的发言，不含系统事件 · 运行轮次按发起时间计入 · 成功率 = 已完成 / 已结束 · 搭建者：系统管理员、团队管理员、机器或 Bot 的主人、群管理员，其余为使用者。',
        )}
      </p>
    </>
  )
}
