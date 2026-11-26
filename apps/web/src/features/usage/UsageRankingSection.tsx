import { AGENT_META, type AgentKind, type UsageBreakdownRowDto } from '@gonggong/protocol'
import { type CSSProperties, useMemo, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { AgentIcon, Button, Icon, PopUpButton } from '../../ui'
import {
  DEFAULT_COST_FORMAT,
  fmtAgentKind,
  fmtCompactTokens,
  fmtCost,
  fmtCount,
  fmtDurationMs,
  fmtEntityLabel,
  fmtRate,
  fmtTps,
  fmtUnitPrice,
  seriesColor,
  type UsageCostFormat,
} from './formatters'

type RankSort = 'tokens' | 'runs' | 'cost' | 'duration'

export interface UsageRankingSectionProps {
  title: string
  items: UsageBreakdownRowDto[]
  totalItems?: number
  hasCost: boolean
  hasInputOutput: boolean
  costFormat?: UsageCostFormat
  kind?: 'agentKind' | 'model' | 'bot' | 'user' | 'group' | 'provider'
  defaultOpen?: boolean
  initialLimit?: number
  stale?: boolean
  onSelectRow?: (row: UsageBreakdownRowDto) => void
  compact?: boolean
}

export function UsageRankingSection({
  title,
  items,
  totalItems,
  hasCost,
  hasInputOutput,
  costFormat = DEFAULT_COST_FORMAT,
  kind,
  defaultOpen = true,
  initialLimit = 6,
  stale = false,
  onSelectRow,
  compact = false,
}: UsageRankingSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [expanded, setExpanded] = useState(false)
  const [sort, setSort] = useState<RankSort>('tokens')

  const effectiveSort: RankSort = sort === 'cost' && !hasCost ? 'tokens' : sort

  const sorted = useMemo(() => {
    const copy = [...items]
    copy.sort((a, b) => {
      if (effectiveSort === 'runs') return b.runs - a.runs || b.totalTokens - a.totalTokens
      if (effectiveSort === 'cost') return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens
      if (effectiveSort === 'duration') return (b.avgDurationMs ?? 0) - (a.avgDurationMs ?? 0)
      return b.totalTokens - a.totalTokens || b.runs - a.runs
    })
    return copy
  }, [items, effectiveSort])

  const metricValueOf = (r: UsageBreakdownRowDto) => {
    if (effectiveSort === 'runs') return r.runs
    if (effectiveSort === 'cost') return r.costUsd
    if (effectiveSort === 'duration') return r.avgDurationMs ?? 0
    return r.totalTokens
  }

  const max = Math.max(1e-9, ...sorted.map(metricValueOf))
  const shown = expanded ? sorted : sorted.slice(0, initialLimit)
  const remaining = Math.max(0, (totalItems ?? sorted.length) - shown.length)

  const sortOptions = [
    { value: 'tokens', label: 'Token' },
    { value: 'runs', label: t('轮次') },
    ...(hasCost ? [{ value: 'cost', label: t('费用') }] : []),
    { value: 'duration', label: t('平均耗时') },
  ]

  if (!items.length) return null

  return (
    <section className={cx('usage-panel', compact && 'usage-panel--compact', stale && 'usage-stale')}>
      <div className="usage-panel__head">
        <button
          type="button"
          className="usage-collapse-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={cx('usage-collapse-btn__chev', open && 'usage-collapse-btn__chev--open')}>
            <Icon name="chevron-right" size={12} weight={2} />
          </span>
          <span className="usage-panel__title">{title}</span>
          <span className="usage-panel__count">{totalItems ?? items.length}</span>
        </button>
        {open ? (
          <PopUpButton
            size="small"
            aria-label={t('排序指标')}
            value={effectiveSort}
            options={sortOptions}
            onChange={(v) => setSort(v as RankSort)}
          />
        ) : null}
      </div>

      {open ? (
        <div className="usage-rank-list">
          {shown.map((row, idx) => {
            const val = metricValueOf(row)
            const ratio = val > 0 ? Math.max(0.015, Math.min(1, val / max)) : 0
            const displayName =
              kind === 'agentKind' ? fmtAgentKind(row.name || row.key) : fmtEntityLabel(row.key, row.name)
            const primaryText =
              effectiveSort === 'runs'
                ? t('{n} 轮', { n: fmtCount(row.runs) })
                : effectiveSort === 'cost'
                  ? fmtCost(row.costUsd, { partial: row.costReportedRuns < row.runs, format: costFormat })
                  : effectiveSort === 'duration'
                    ? fmtDurationMs(row.avgDurationMs)
                    : row.totalTokens > 0
                      ? fmtCompactTokens(row.totalTokens)
                      : t('未上报')

            const metaParts: string[] = []
            if (kind === 'model' && row.modelDisplayName && row.modelDisplayName !== displayName) {
              metaParts.push(row.modelDisplayName)
            }
            if (row.sublabel && kind !== 'agentKind') metaParts.push(row.sublabel)
            if (kind === 'model' && row.unitPrice) {
              metaParts.push(`${fmtUnitPrice(row.unitPrice, costFormat)} / 1M`)
            }
            metaParts.push(t('{n} 轮', { n: fmtCount(row.runs) }))
            if (row.failedRuns > 0) metaParts.push(t('{n} 失败', { n: row.failedRuns }))
            if (row.avgDurationMs != null)
              metaParts.push(t('均值 {d}', { d: fmtDurationMs(row.avgDurationMs) }))
            if (row.avgOutputTps != null) metaParts.push(fmtTps(row.avgOutputTps))

            const rightSubParts: string[] = []
            if (hasInputOutput && (row.inputTokens > 0 || row.outputTokens > 0)) {
              rightSubParts.push(
                t('输入 {in} · 输出 {out}', {
                  in: fmtCompactTokens(row.inputTokens),
                  out: fmtCompactTokens(row.outputTokens),
                }),
              )
            } else if (row.successRate != null) {
              rightSubParts.push(t('成功 {r}', { r: fmtRate(row.successRate) }))
            }
            if (row.tokenShare > 0 && effectiveSort === 'tokens') {
              rightSubParts.push(fmtRate(row.tokenShare))
            }

            const TagName = onSelectRow ? 'button' : 'div'
            return (
              <TagName
                key={row.key}
                type={onSelectRow ? 'button' : undefined}
                className={cx('usage-rank-row', onSelectRow && 'usage-rank-row--interactive')}
                style={{ '--i': idx } as CSSProperties}
                onClick={onSelectRow ? () => onSelectRow(row) : undefined}
              >
                <div className="usage-rank-row__info">
                  {kind === 'agentKind' && row.key in AGENT_META ? (
                    <span className="usage-rank-row__icon">
                      <AgentIcon kind={row.key as AgentKind} size={18} />
                    </span>
                  ) : null}
                  <div className="usage-rank-row__text">
                    <span
                      className="usage-rank-row__name"
                      title={
                        row.modelDisplayName && row.modelDisplayName !== displayName
                          ? `${displayName} (${row.modelDisplayName})`
                          : displayName
                      }
                    >
                      {displayName}
                    </span>
                    {!compact ? <span className="usage-rank-row__meta">{metaParts.join(' · ')}</span> : null}
                  </div>
                </div>

                <div className="usage-rank-row__bar" aria-hidden="true">
                  <span
                    className="usage-rank-row__bar-fill"
                    style={{
                      transform: `scaleX(${ratio})`,
                      background: seriesColor(idx, row.key),
                    }}
                  />
                </div>

                <div className="usage-rank-row__nums">
                  <div className="usage-rank-row__primary-col">
                    <span className="usage-rank-row__primary">{primaryText}</span>
                    {!compact && rightSubParts.length ? (
                      <span className="usage-rank-row__sub">{rightSubParts.join(' · ')}</span>
                    ) : null}
                  </div>
                  {hasCost && effectiveSort !== 'cost' ? (
                    <span className="usage-rank-row__cost">
                      {row.costReportedRuns > 0
                        ? fmtCost(row.costUsd, {
                            partial: row.costReportedRuns < row.runs,
                            format: costFormat,
                          })
                        : '—'}
                    </span>
                  ) : null}
                </div>
              </TagName>
            )
          })}
          {sorted.length > initialLimit || remaining > 0 ? (
            <div className="usage-rank-foot">
              {sorted.length > initialLimit ? (
                <Button size="small" variant="plain" onClick={() => setExpanded((v) => !v)}>
                  {expanded
                    ? t('收起')
                    : t('展开更多（还有 {n} 项）', {
                        n: remaining > 0 ? remaining : sorted.length - initialLimit,
                      })}
                </Button>
              ) : remaining > 0 ? (
                <span className="usage-rank-foot__note">{t('还有 {n} 项未展示', { n: remaining })}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
