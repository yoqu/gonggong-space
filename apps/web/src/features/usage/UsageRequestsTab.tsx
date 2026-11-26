import type {
  UsageCapabilitiesDto,
  UsageRunItemDto,
  UsageRunsDto,
  UsageRunsSortBy,
  UsageSortDir,
} from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { localDateTime } from '../../lib/time'
import {
  AgentIcon,
  Button,
  Drawer,
  EmptyState,
  GroupBox,
  GroupRow,
  Icon,
  NoDataArt,
  Table,
  type TableColumn,
  type TableSort,
  Tag,
} from '../../ui'
import {
  fmtAgentKind,
  fmtCompactTokens,
  fmtCostUsd,
  fmtCount,
  fmtDurationMs,
  fmtEntityLabel,
  fmtRunStatusLabel,
  fmtShortTime,
  fmtTps,
  fmtTriggerSource,
} from './formatters'
import type { UsageFilterState, UsageRunsOptions } from './types'

export interface UsageRequestsTabProps {
  data: UsageRunsDto | null
  capabilities: UsageCapabilitiesDto
  options: UsageRunsOptions
  onOptionsChange: (patch: Partial<UsageRunsOptions>) => void
  onFilterJump: (patch: Partial<UsageFilterState>) => void
  stale?: boolean
}

const VALID_SORT = new Set<UsageRunsSortBy>([
  'startedAt',
  'totalTokens',
  'costUsd',
  'durationMs',
  'outputTps',
])

export function UsageRequestsTab({
  data,
  capabilities,
  options,
  onOptionsChange,
  onFilterJump,
  stale = false,
}: UsageRequestsTabProps) {
  const [selected, setSelected] = useState<UsageRunItemDto | null>(null)
  const summary = data?.summary
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / options.pageSize))
  const showCost = capabilities.hasCost && (summary ? summary.costReportedRuns > 0 : true)

  const columns: TableColumn<UsageRunItemDto>[] = [
    {
      key: 'startedAt',
      title: t('时间'),
      width: 108,
      sortable: true,
      mono: true,
      render: (r) => (
        <span title={localDateTime(r.startedAt ?? r.queuedAt)}>
          {fmtShortTime(r.startedAt ?? r.queuedAt)}
        </span>
      ),
    },
    {
      key: 'botName',
      title: 'Bot / Agent',
      width: 156,
      render: (r) => (
        <span className="usage-run-bot">
          <AgentIcon kind={r.agentKind} size={15} />
          <span className="usage-ellipsis" title={`${r.botName} (${fmtAgentKind(r.agentKind)})`}>
            {r.botName}
          </span>
        </span>
      ),
    },
    ...(capabilities.hasModels
      ? [
          {
            key: 'model',
            title: t('模型'),
            width: 144,
            secondary: true,
            render: (r: UsageRunItemDto) => (
              <span className="usage-ellipsis" title={r.model ?? ''}>
                {r.model ? r.model : t('默认')}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'userName',
      title: t('触发人'),
      width: 88,
      secondary: true,
    },
    {
      key: 'groupName',
      title: t('群 / 会话'),
      render: (r) => (
        <span className="usage-ellipsis" title={r.groupName}>
          {r.groupName}
        </span>
      ),
    },
    {
      key: 'totalTokens',
      title: 'Token',
      width: 112,
      align: 'right',
      sortable: true,
      render: (r) =>
        r.totalTokens != null ? (
          <span
            title={
              r.inputTokens != null && r.outputTokens != null
                ? t('输入 {in} · 输出 {out}', {
                    in: fmtCompactTokens(r.inputTokens),
                    out: fmtCompactTokens(r.outputTokens),
                  })
                : undefined
            }
          >
            {fmtCompactTokens(r.totalTokens)}
          </span>
        ) : (
          <span className="usage-muted">{t('未上报')}</span>
        ),
    },
    ...(showCost
      ? [
          {
            key: 'costUsd',
            title: t('费用'),
            width: 82,
            align: 'right' as const,
            sortable: true,
            render: (r: UsageRunItemDto) =>
              r.costUsd != null ? (
                <span className="usage-tone--green">{fmtCostUsd(r.costUsd)}</span>
              ) : (
                <span className="usage-muted">—</span>
              ),
          },
        ]
      : []),
    {
      key: 'durationMs',
      title: t('耗时'),
      width: 84,
      align: 'right',
      sortable: true,
      render: (r) => (
        <span className={r.isSlow ? 'usage-tone--orange usage-weight-medium' : undefined}>
          {fmtDurationMs(r.durationMs)}
        </span>
      ),
    },
    {
      key: 'outputTps',
      title: t('速率'),
      width: 96,
      align: 'right',
      secondary: true,
      sortable: true,
      render: (r) => fmtTps(r.outputTps),
    },
    {
      key: 'status',
      title: t('状态'),
      width: 78,
      render: (r) => {
        const st = fmtRunStatusLabel(r.status, r.isCancelled)
        return (
          <span className="usage-status-cell">
            <span className={cx('usage-dot', `usage-dot--${st.tone}`)} aria-hidden="true" />
            <span>{st.label}</span>
          </span>
        )
      },
    },
  ]

  const onSortChange = (next: TableSort) => {
    if (!VALID_SORT.has(next.key as UsageRunsSortBy)) return
    onOptionsChange({
      sortBy: next.key as UsageRunsSortBy,
      sortDir: next.dir as UsageSortDir,
      page: 1,
    })
  }

  return (
    <div className={cx('usage-tab-stack', stale && 'usage-stale')} data-testid="usage-runs-tab">
      <div className="usage-runs-bar">
        <div className="usage-runs-bar__summary">
          {summary ? (
            <>
              <strong>{t('{n} 轮运行', { n: fmtCount(summary.totalRuns) })}</strong>
              {capabilities.hasInputOutput ? (
                <span>
                  {t('输入 {in} · 输出 {out}', {
                    in: fmtCompactTokens(summary.inputTokens),
                    out: fmtCompactTokens(summary.outputTokens),
                  })}
                </span>
              ) : (
                <span>{fmtCompactTokens(summary.totalTokens)} tokens</span>
              )}
              {summary.failedRuns > 0 ? (
                <span className="usage-tone--red">{t('{n} 失败', { n: summary.failedRuns })}</span>
              ) : null}
              {summary.cancelledRuns > 0 ? <span>{t('{n} 取消', { n: summary.cancelledRuns })}</span> : null}
              {summary.slowRuns > 0 ? (
                <span className="usage-tone--orange">{t('{n} 慢运行', { n: summary.slowRuns })}</span>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="usage-runs-bar__toggles">
          <Button
            size="small"
            variant={options.onlySlow ? 'primary' : 'default'}
            aria-pressed={options.onlySlow}
            onClick={() => onOptionsChange({ onlySlow: !options.onlySlow, page: 1 })}
          >
            {t('仅慢运行 ≥60s')}
          </Button>
          <Button
            size="small"
            variant={options.onlyError ? 'primary' : 'default'}
            aria-pressed={options.onlyError}
            onClick={() => onOptionsChange({ onlyError: !options.onlyError, page: 1 })}
          >
            {t('仅失败')}
          </Button>
        </div>
      </div>

      {summary && summary.bySource.length > 0 ? (
        <section className="usage-source-strip" aria-label={t('触发来源汇总')}>
          <div className="usage-source-strip__cell">
            <span className="usage-source-strip__label">{t('全部运行')}</span>
            <span className="usage-source-strip__val">{fmtCount(summary.totalRuns)}</span>
            <span className="usage-source-strip__sub">{fmtCompactTokens(summary.totalTokens)} tokens</span>
          </div>
          {summary.bySource.slice(0, 4).map((src) => (
            <div key={src.source} className="usage-source-strip__cell">
              <span className="usage-source-strip__label">{fmtTriggerSource(src.source)}</span>
              <span className="usage-source-strip__val">{fmtCount(src.runs)}</span>
              <span className="usage-source-strip__sub">
                {fmtCompactTokens(src.totalTokens)} tokens
                {showCost && src.costUsd > 0 ? ` · ${fmtCostUsd(src.costUsd)}` : ''}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {items.length ? (
        <div className="usage-runs-table-wrap">
          <Table<UsageRunItemDto>
            aria-label={t('运行明细列表')}
            rows={items}
            columns={columns}
            density="compact"
            multiple={false}
            sortRows={false}
            sort={{ key: options.sortBy, dir: options.sortDir }}
            onSortChange={onSortChange}
            onOpen={setSelected}
            onSelectionChange={(ids) => {
              const id = ids[0]
              const found = items.find((x) => x.id === id)
              if (found) setSelected(found)
            }}
          />
          <div className="usage-pagination">
            <span className="usage-pagination__info">
              {t('第 {page} / {pages} 页 · 共 {total} 条（点击行查看详情）', {
                page: options.page,
                pages: pageCount,
                total: fmtCount(total),
              })}
            </span>
            <div className="usage-pagination__btns">
              <Button
                size="small"
                disabled={options.page <= 1}
                onClick={() => onOptionsChange({ page: Math.max(1, options.page - 1) })}
              >
                <Icon name="chevron-left" size={12} />
                {t('上一页')}
              </Button>
              <Button
                size="small"
                disabled={options.page >= pageCount}
                onClick={() => onOptionsChange({ page: Math.min(pageCount, options.page + 1) })}
              >
                {t('下一页')}
                <Icon name="chevron-right" size={12} />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState compact illustration={<NoDataArt />} title={t('当前筛选条件下没有运行记录')} />
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected
            ? `${selected.botName} · ${fmtRunStatusLabel(selected.status, selected.isCancelled).label}`
            : ''
        }
        width={440}
      >
        {selected ? (
          <div className="usage-drawer">
            <div className="usage-drawer__tags">
              <Tag tone={fmtRunStatusLabel(selected.status, selected.isCancelled).tone}>
                {fmtRunStatusLabel(selected.status, selected.isCancelled).label}
              </Tag>
              <Tag tone="gray">{fmtAgentKind(selected.agentKind)}</Tag>
              <Tag tone="gray">{fmtTriggerSource(selected.triggerSource)}</Tag>
              {selected.isSlow ? <Tag tone="orange">{t('慢运行')}</Tag> : null}
              {selected.effort ? <Tag tone="blue">{selected.effort}</Tag> : null}
            </div>

            <GroupBox>
              <GroupRow label={t('运行 ID')} value={selected.id} wideValue />
              <GroupRow
                label={t('发起时间')}
                value={localDateTime(selected.startedAt ?? selected.queuedAt)}
                wideValue
              />
              <GroupRow
                label={t('结束时间')}
                value={selected.endedAt ? localDateTime(selected.endedAt) : '—'}
                wideValue
              />
              <GroupRow label={t('端到端耗时')} value={fmtDurationMs(selected.durationMs)} />
              <GroupRow label={t('有效产出速率')} value={fmtTps(selected.outputTps)} />
            </GroupBox>

            <GroupBox>
              <GroupRow
                label={t('Token 合计')}
                value={selected.totalTokens != null ? fmtCompactTokens(selected.totalTokens) : t('未上报')}
              />
              {selected.inputTokens != null || selected.outputTokens != null ? (
                <GroupRow
                  label={t('输入 / 输出')}
                  value={`${fmtCompactTokens(selected.inputTokens ?? 0)} / ${fmtCompactTokens(selected.outputTokens ?? 0)}`}
                />
              ) : null}
              {selected.costUsd != null ? (
                <GroupRow label={t('费用')} value={fmtCostUsd(selected.costUsd)} />
              ) : null}
              <GroupRow
                label={t('模型')}
                value={fmtEntityLabel(selected.model ?? '__default__', selected.model ?? '')}
                wideValue
              />
              {selected.provider ? (
                <GroupRow label={t('供应商')} value={selected.provider} wideValue />
              ) : null}
            </GroupBox>

            <GroupBox>
              <GroupRow label={t('触发人')} value={selected.userName} />
              <GroupRow
                label={t('群 / 会话')}
                value={`${selected.groupName} (${selected.groupKind === 'dm' ? t('私聊') : t('群聊')})`}
                wideValue
              />
              {selected.filesChanged > 0 ? (
                <GroupRow label={t('变更文件')} value={String(selected.filesChanged)} />
              ) : null}
              {selected.plugins.length > 0 ? (
                <GroupRow label={t('注入插件')} value={selected.plugins.join(', ')} wideValue />
              ) : null}
              {selected.personalSkills > 0 ? (
                <GroupRow label={t('个人技能数')} value={String(selected.personalSkills)} />
              ) : null}
            </GroupBox>

            {selected.step ? (
              <div className="usage-drawer__block">
                <span className="usage-drawer__block-title">{t('状态说明')}</span>
                <p className="usage-drawer__text">{selected.step}</p>
              </div>
            ) : null}
            {selected.summary ? (
              <div className="usage-drawer__block">
                <span className="usage-drawer__block-title">{t('执行摘要')}</span>
                <p className="usage-drawer__text">{selected.summary}</p>
              </div>
            ) : null}

            <div className="usage-drawer__actions">
              <Button
                size="small"
                onClick={() => {
                  onFilterJump({ botId: selected.botId })
                  setSelected(null)
                }}
              >
                {t('只看该 Bot')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  onFilterJump({ userId: selected.userId })
                  setSelected(null)
                }}
              >
                {t('只看该触发人')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  onFilterJump({ groupId: selected.groupId })
                  setSelected(null)
                }}
              >
                {t('只看该会话')}
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
