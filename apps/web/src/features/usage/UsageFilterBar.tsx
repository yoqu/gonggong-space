import type {
  AdminTeamDto,
  AgentKind,
  UsageExportFormat,
  UsageFacetsDto,
  UsageKpiDto,
  UsagePricingStatusDto,
  UsageStatusFilter,
  UsageTimePreset,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { ago, localDateTime } from '../../lib/time'
import {
  Button,
  DatePicker,
  Icon,
  Popover,
  PopUpButton,
  PullDownButton,
  SearchField,
  SegmentedControl,
} from '../../ui'
import {
  fmtAgentKind,
  fmtCompactTokens,
  fmtCost,
  fmtCount,
  fmtEntityLabel,
  type UsageCostFormat,
  type UsageCurrency,
} from './formatters'
import { hasActiveSecondaryFilters, type UsageFilterState, type UsageGroupKind } from './types'

const TIME_PRESETS: { value: UsageTimePreset; label: string }[] = [
  { value: 'today', label: t('今天') },
  { value: '24h', label: t('24 小时') },
  { value: '7d', label: t('7 天') },
  { value: '30d', label: t('30 天') },
  { value: '90d', label: t('90 天') },
  { value: 'all', label: t('全部') },
  { value: 'custom', label: t('自定义') },
]

const STATUS_OPTIONS: { value: UsageStatusFilter; label: string }[] = [
  { value: 'all', label: t('全部') },
  { value: 'completed', label: t('成功') },
  { value: 'failed', label: t('失败') },
  { value: 'cancelled', label: t('已取消') },
  { value: 'live', label: t('进行中') },
]

const REFRESH_OPTIONS = [
  { value: '0', label: t('关闭自动刷新') },
  { value: '5', label: t('5 秒') },
  { value: '30', label: t('30 秒') },
  { value: '60', label: t('1 分钟') },
]

export interface UsageFilterBarProps {
  filters: UsageFilterState
  onChange: (patch: Partial<UsageFilterState>) => void
  onResetFilters: () => void
  facets: UsageFacetsDto | null
  teams: AdminTeamDto[]
  kpi: UsageKpiDto | null
  hasCost: boolean
  costFormat: UsageCostFormat
  onCurrencyChange: (currency: UsageCurrency) => void
  pricing: UsagePricingStatusDto | null
  canSyncPricing?: boolean
  syncingPricing?: boolean
  syncPricingDone?: boolean
  syncPricingError?: string
  onSyncPricing?: () => void
  refreshSec: number
  onRefreshSecChange: (sec: number) => void
  onManualRefresh: () => void
  refreshing: boolean
  onExport: (format: UsageExportFormat) => void
  showTeamFilter?: boolean
}

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function UsageFilterBar({
  filters,
  onChange,
  onResetFilters,
  facets,
  teams,
  kpi,
  hasCost,
  costFormat,
  onCurrencyChange,
  pricing,
  canSyncPricing = false,
  syncingPricing = false,
  syncPricingDone = false,
  syncPricingError = '',
  onSyncPricing,
  refreshSec,
  onRefreshSecChange,
  onManualRefresh,
  refreshing,
  onExport,
  showTeamFilter = true,
}: UsageFilterBarProps) {
  const [searchDraft, setSearchDraft] = useState(filters.q)
  const [customOpen, setCustomOpen] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(filters.from || isoDaysAgo(7))
  const [draftTo, setDraftTo] = useState(filters.to || isoToday())

  useEffect(() => {
    setSearchDraft(filters.q)
  }, [filters.q])

  useEffect(() => {
    const trimmed = searchDraft.trim()
    if (trimmed === filters.q) return
    const timer = window.setTimeout(() => onChange({ q: trimmed }), 240)
    return () => window.clearTimeout(timer)
  }, [searchDraft, filters.q, onChange])

  const onPresetChange = (next: UsageTimePreset) => {
    if (next === 'custom') {
      const from = filters.from || isoDaysAgo(7)
      const to = filters.to || isoToday()
      setDraftFrom(from)
      setDraftTo(to)
      onChange({ preset: 'custom', from, to })
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    onChange({ preset: next })
  }

  const applyCustomRange = () => {
    if (!draftFrom) return
    const [a, b] = draftTo && draftTo < draftFrom ? [draftTo, draftFrom] : [draftFrom, draftTo]
    onChange({ preset: 'custom', from: a, to: b })
    setCustomOpen(false)
  }

  const showTeams = showTeamFilter && (teams.length > 1 || !!filters.teamId)
  const showAgents = (facets?.agentKinds.length ?? 0) > 1 || !!filters.agentKind
  const showModels = (facets?.models.length ?? 0) > 1 || !!filters.model
  const showProviders = (facets?.providers.length ?? 0) > 1 || !!filters.provider
  const showBots = (facets?.bots.length ?? 0) > 1 || !!filters.botId
  const showUsers = (facets?.users.length ?? 0) > 1 || !!filters.userId
  const showGroups = (facets?.groups.length ?? 0) > 1 || !!filters.groupId
  const hasSecondary = hasActiveSecondaryFilters(filters)
  const partialCost = kpi ? kpi.costReportedRuns < kpi.totalRuns : false

  return (
    <div className="usage-filterbar" data-testid="usage-filterbar">
      <div className="usage-filterbar__row">
        <div className="usage-filterbar__time">
          <SegmentedControl
            size="small"
            aria-label={t('时间范围')}
            value={filters.preset}
            onChange={onPresetChange}
            items={TIME_PRESETS}
          />
          {filters.preset === 'custom' ? (
            <Popover
              open={customOpen}
              onOpenChange={setCustomOpen}
              placement="bottom-start"
              trigger={
                <Button size="small" icon="calendar" aria-label={t('自定义日期范围')}>
                  {filters.from && filters.to
                    ? `${filters.from} – ${filters.to}`
                    : filters.from || t('选择日期')}
                </Button>
              }
            >
              <div className="usage-daterange">
                <DatePicker
                  label={t('开始日期')}
                  value={draftFrom}
                  max={isoToday()}
                  showWeekday={false}
                  onChange={setDraftFrom}
                />
                <DatePicker
                  label={t('结束日期')}
                  value={draftTo}
                  min={draftFrom || undefined}
                  max={isoToday()}
                  showWeekday={false}
                  onChange={setDraftTo}
                />
                <div className="usage-daterange__actions">
                  <Button size="small" variant="plain" onClick={() => setCustomOpen(false)}>
                    {t('取消')}
                  </Button>
                  <Button size="small" variant="primary" disabled={!draftFrom} onClick={applyCustomRange}>
                    {t('应用')}
                  </Button>
                </div>
              </div>
            </Popover>
          ) : null}
        </div>

        <div className="usage-filterbar__right">
          <Button
            size="small"
            variant="plain"
            icon="arrow-clockwise"
            aria-label={t('刷新数据')}
            className={refreshing ? 'usage-refresh--spinning' : undefined}
            onClick={onManualRefresh}
          />
          <span className="usage-autorefresh">
            {refreshSec > 0 ? <span className="usage-autorefresh__dot" aria-hidden="true" /> : null}
            <PopUpButton
              size="small"
              aria-label={t('自动刷新')}
              value={String(refreshSec)}
              options={REFRESH_OPTIONS}
              onChange={(v) => onRefreshSecChange(Number(v))}
            />
          </span>
          {kpi ? (
            <span className="usage-filterbar__readout" data-testid="usage-scope-readout">
              {hasCost && kpi.costReportedRuns > 0 ? (
                <>
                  <span className="usage-readout__cost">
                    {fmtCost(kpi.totalCostUsd, { partial: partialCost, format: costFormat })}
                  </span>
                  {partialCost ? (
                    <span className="usage-readout__muted">
                      {t('{n} 轮未计价', { n: kpi.totalRuns - kpi.costReportedRuns })}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="usage-readout__strong">{fmtCompactTokens(kpi.totalTokens)}</span>
                  <span className="usage-readout__muted">{t('{n} 轮', { n: fmtCount(kpi.totalRuns) })}</span>
                </>
              )}
            </span>
          ) : null}
          <Popover
            open={pricingOpen}
            onOpenChange={setPricingOpen}
            placement="bottom-end"
            trigger={
              <button
                type="button"
                className="usage-pricing-pill"
                data-testid="usage-pricing-pill"
                aria-label={t('模型定价目录与货币设置')}
              >
                {pricing?.stale || pricing?.fx.stale ? (
                  <span className="usage-pricing-pill__dot" aria-hidden="true" />
                ) : null}
                <span>
                  {pricing
                    ? t('models.dev · {n} 模型定价', { n: fmtCount(pricing.modelCount) })
                    : costFormat.currency === 'cny'
                      ? '¥ CNY'
                      : '$ USD'}
                </span>
              </button>
            }
          >
            <div className="usage-pricing-pop" data-testid="usage-pricing-popover">
              <div className="usage-pricing-pop__head">
                <span className="usage-pricing-pop__title">{t('模型定价与汇率')}</span>
                {pricing?.stale || pricing?.fx.stale ? (
                  <span className="usage-pricing-pop__stale">{t('待更新')}</span>
                ) : null}
              </div>
              <div className="usage-pricing-pop__rows">
                {pricing ? (
                  <>
                    <div className="usage-pricing-pop__row">
                      <span>{t('定价来源')}</span>
                      <strong>models.dev</strong>
                    </div>
                    <div className="usage-pricing-pop__row">
                      <span>{t('覆盖规模')}</span>
                      <strong>
                        {t('{p} 供应商 · {m} 模型', {
                          p: fmtCount(pricing.providerCount),
                          m: fmtCount(pricing.modelCount),
                        })}
                      </strong>
                    </div>
                    <div className="usage-pricing-pop__row">
                      <span>{t('目录同步')}</span>
                      <strong title={pricing.syncedAt ? localDateTime(pricing.syncedAt) : undefined}>
                        {pricing.syncedAt ? ago(pricing.syncedAt) : t('内置快照')}
                      </strong>
                    </div>
                  </>
                ) : null}
                <div className="usage-pricing-pop__row">
                  <span>{t('参考汇率')}</span>
                  <strong title={pricing?.fx.syncedAt ? localDateTime(pricing.fx.syncedAt) : undefined}>
                    {`1 USD = ¥${costFormat.usdToCny.toFixed(2)}`}
                  </strong>
                </div>
              </div>
              <div className="usage-pricing-pop__currency">
                <span className="usage-pricing-pop__label">{t('显示币种')}</span>
                <SegmentedControl
                  size="small"
                  aria-label={t('显示币种')}
                  value={costFormat.currency}
                  onChange={onCurrencyChange}
                  items={[
                    { value: 'cny', label: t('¥ 人民币') },
                    { value: 'usd', label: t('$ 美元') },
                  ]}
                />
              </div>
              {syncPricingError ? <p className="usage-pricing-pop__err">{syncPricingError}</p> : null}
              {canSyncPricing && onSyncPricing ? (
                <div className="usage-pricing-pop__actions">
                  <Button
                    size="small"
                    variant="primary"
                    fullWidth
                    icon="arrow-clockwise"
                    loading={syncingPricing}
                    done={syncPricingDone}
                    onClick={onSyncPricing}
                  >
                    {syncPricingDone ? t('已同步最新价格') : t('同步最新价格')}
                  </Button>
                </div>
              ) : null}
            </div>
          </Popover>
        </div>
      </div>

      <div className="usage-filterbar__row usage-filterbar__row--dims">
        <div className="usage-filterbar__dims">
          {showTeams ? (
            <PopUpButton
              size="small"
              aria-label={t('团队')}
              value={filters.teamId}
              options={[
                { value: '', label: t('全部团队') },
                ...teams.map((x) => ({ value: x.id, label: x.name })),
              ]}
              onChange={(v) => onChange({ teamId: v, botId: '', groupId: '' })}
            />
          ) : null}
          {showAgents ? (
            <PopUpButton
              size="small"
              aria-label={t('Agent 类型')}
              value={filters.agentKind}
              options={[
                { value: '', label: t('全部 Agent') },
                ...(facets?.agentKinds ?? []).map((o) => ({
                  value: o.value,
                  label: fmtAgentKind(o.label),
                })),
              ]}
              onChange={(v) => onChange({ agentKind: v as AgentKind | '' })}
            />
          ) : null}
          {showModels ? (
            <PopUpButton
              size="small"
              aria-label={t('模型')}
              value={filters.model}
              options={[
                { value: '', label: t('全部模型') },
                ...(facets?.models ?? []).map((o) => ({
                  value: o.value,
                  label: fmtEntityLabel(o.value, o.label),
                })),
              ]}
              onChange={(v) => onChange({ model: v })}
            />
          ) : null}
          {showProviders ? (
            <PopUpButton
              size="small"
              aria-label={t('供应商')}
              value={filters.provider}
              options={[
                { value: '', label: t('全部供应商') },
                ...(facets?.providers ?? []).map((o) => ({
                  value: o.value,
                  label: fmtEntityLabel(o.value, o.label),
                })),
              ]}
              onChange={(v) => onChange({ provider: v })}
            />
          ) : null}
          {showBots ? (
            <PopUpButton
              size="small"
              aria-label="Bot"
              value={filters.botId}
              options={[
                { value: '', label: t('全部 Bot') },
                ...(facets?.bots ?? []).map((o) => ({ value: o.value, label: o.label })),
              ]}
              onChange={(v) => onChange({ botId: v })}
            />
          ) : null}
          {showUsers ? (
            <PopUpButton
              size="small"
              aria-label={t('触发人')}
              value={filters.userId}
              options={[
                { value: '', label: t('全部触发人') },
                ...(facets?.users ?? []).map((o) => ({ value: o.value, label: o.label })),
              ]}
              onChange={(v) => onChange({ userId: v })}
            />
          ) : null}
          {showGroups ? (
            <PopUpButton
              size="small"
              aria-label={t('群 / 会话')}
              value={filters.groupId}
              options={[
                { value: '', label: t('全部会话') },
                ...(facets?.groups ?? []).map((o) => ({ value: o.value, label: o.label })),
              ]}
              onChange={(v) => onChange({ groupId: v })}
            />
          ) : null}
          <PopUpButton
            size="small"
            aria-label={t('会话类型')}
            value={filters.groupKind}
            options={[
              { value: '', label: t('全部类型') },
              { value: 'group', label: t('群聊') },
              { value: 'dm', label: t('私聊') },
            ]}
            onChange={(v) => onChange({ groupKind: v as UsageGroupKind | '' })}
          />
          <SegmentedControl
            size="small"
            aria-label={t('状态筛选')}
            value={filters.status}
            onChange={(v) => onChange({ status: v })}
            items={STATUS_OPTIONS}
          />
        </div>

        <div className="usage-filterbar__actions">
          <SearchField
            value={searchDraft}
            onChange={setSearchDraft}
            placeholder={t('搜索模型、Bot、用户、会话…')}
            aria-label={t('搜索用量记录')}
            className="usage-filterbar__search"
          />
          {hasSecondary ? (
            <Button size="small" variant="plain" onClick={onResetFilters}>
              <Icon name="xmark" size={12} />
              {t('清除筛选')}
            </Button>
          ) : null}
          <PullDownButton
            size="small"
            icon="download"
            label={t('导出')}
            align="end"
            portal
            items={[
              { value: 'csv', label: t('导出 CSV') },
              { value: 'json', label: t('导出 JSON') },
            ]}
            onSelect={(v) => onExport(v as UsageExportFormat)}
          />
        </div>
      </div>
    </div>
  )
}
