import type { UsageBreakdownBy, UsageBreakdownRowDto } from '@gonggong/protocol'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { SegmentedControl, Table, type TableColumn } from '../../ui'
import {
  fmtAgentKind,
  fmtCompactTokens,
  fmtCostUsd,
  fmtCount,
  fmtDurationMs,
  fmtEntityLabel,
  fmtRate,
  fmtTps,
} from './formatters'

type SpeedRow = UsageBreakdownRowDto & { id: string }

export interface UsageSpeedTableProps {
  by: UsageBreakdownBy
  onByChange: (next: UsageBreakdownBy) => void
  items: UsageBreakdownRowDto[]
  hasModels: boolean
  hasCost: boolean
  stale?: boolean
}

export function UsageSpeedTable({
  by,
  onByChange,
  items,
  hasModels,
  hasCost,
  stale = false,
}: UsageSpeedTableProps) {
  if (!items.length) return null

  const modeItems: { value: UsageBreakdownBy; label: string }[] = [
    ...(hasModels ? [{ value: 'model' as const, label: t('模型') }] : []),
    { value: 'agentKind', label: 'Agent' },
    { value: 'bot', label: 'Bot' },
  ]

  const columns: TableColumn<SpeedRow>[] = [
    {
      key: 'name',
      title: by === 'model' ? t('模型') : by === 'agentKind' ? t('Agent 类型') : 'Bot',
      sortable: true,
      render: (r) => (
        <span className="usage-speed__name">
          {by === 'agentKind' ? fmtAgentKind(r.name || r.key) : fmtEntityLabel(r.key, r.name)}
        </span>
      ),
    },
    {
      key: 'avgOutputTps',
      title: t('有效产出速率'),
      width: 116,
      align: 'right',
      sortable: true,
      sortValue: (r) => r.avgOutputTps ?? -1,
      render: (r) => fmtTps(r.avgOutputTps),
    },
    {
      key: 'avgDurationMs',
      title: t('平均耗时'),
      width: 96,
      align: 'right',
      sortable: true,
      sortValue: (r) => r.avgDurationMs ?? -1,
      render: (r) => fmtDurationMs(r.avgDurationMs),
    },
    {
      key: 'p95DurationMs',
      title: t('P95 耗时'),
      width: 96,
      align: 'right',
      secondary: true,
      sortable: true,
      sortValue: (r) => r.p95DurationMs ?? -1,
      render: (r) => fmtDurationMs(r.p95DurationMs),
    },
    {
      key: 'successRate',
      title: t('成功率'),
      width: 76,
      align: 'right',
      sortable: true,
      sortValue: (r) => r.successRate ?? -1,
      render: (r) => (
        <span className={r.successRate != null && r.successRate < 0.9 ? 'usage-tone--orange' : undefined}>
          {fmtRate(r.successRate)}
        </span>
      ),
    },
    {
      key: 'runs',
      title: t('轮次'),
      width: 72,
      align: 'right',
      sortable: true,
      render: (r) => fmtCount(r.runs),
    },
    {
      key: 'totalTokens',
      title: 'Token',
      width: 92,
      align: 'right',
      sortable: true,
      render: (r) => (r.totalTokens > 0 ? fmtCompactTokens(r.totalTokens) : '—'),
    },
    ...(hasCost
      ? [
          {
            key: 'costUsd',
            title: t('费用'),
            width: 88,
            align: 'right' as const,
            sortable: true,
            render: (r: SpeedRow) =>
              r.costReportedRuns > 0 ? (
                <span className="usage-tone--green">
                  {fmtCostUsd(r.costUsd, r.costReportedRuns < r.runs)}
                </span>
              ) : (
                '—'
              ),
          },
        ]
      : []),
  ]

  return (
    <section className={cx('usage-panel', stale && 'usage-stale')} data-testid="usage-speed-table">
      <div className="usage-panel__head">
        <div>
          <span className="usage-panel__title">{t('模型与 Agent 效率')}</span>
          <span className="usage-panel__sub">{t('基于已完成轮次的端到端耗时与输出 Token')}</span>
        </div>
        <SegmentedControl
          size="small"
          aria-label={t('效率对比维度')}
          value={by}
          onChange={onByChange}
          items={modeItems}
        />
      </div>
      <Table<SpeedRow>
        aria-label={t('模型与 Agent 效率对比')}
        rows={items.map((x) => ({ ...x, id: x.key }))}
        columns={columns}
        density="compact"
        multiple={false}
        defaultSort={{ key: 'avgOutputTps', dir: 'desc' }}
      />
    </section>
  )
}
