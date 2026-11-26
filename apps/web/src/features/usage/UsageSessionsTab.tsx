import type {
  UsageBreakdownDto,
  UsageCapabilitiesDto,
  UsageHeatmapDto,
  UsageInsightsDto,
  UsageSessionRowDto,
  UsageSessionSort,
} from '@gonggong/protocol'
import { useMemo, useState } from 'react'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { ago } from '../../lib/time'
import { AgentIcon, EmptyState, NoDataArt, SegmentedControl } from '../../ui'
import {
  fmtAgentKind,
  fmtCompactTokens,
  fmtCostUsd,
  fmtCount,
  fmtDurationMs,
  fmtRate,
  fmtToolKind,
  fmtTriggerSource,
  seriesColor,
} from './formatters'
import { UsageWeekHourHeatmap } from './UsageHeatmap'
import { type UsageKpiCell, UsageKpiStrip } from './UsageKpiStrip'
import { UsageRankingSection } from './UsageRankingSection'

type ShapeMode = 'turns' | 'duration' | 'source'
type ToolViewMode = 'name' | 'kind' | 'mcp'

export interface UsageSessionsTabProps {
  insights: UsageInsightsDto | null
  heatmap: UsageHeatmapDto | null
  groupBreakdown: UsageBreakdownDto | null
  secondaryBreakdown: UsageBreakdownDto | null
  secondaryTitle: string
  secondaryKind: 'model' | 'user'
  capabilities: UsageCapabilitiesDto
  sessionSort: UsageSessionSort
  onSessionSortChange: (s: UsageSessionSort) => void
  stale?: boolean
}

function SessionRow({
  s,
  sort,
  hasCost,
  showDetails = false,
}: {
  s: UsageSessionRowDto
  sort: UsageSessionSort
  hasCost: boolean
  showDetails?: boolean
}) {
  const primary =
    sort === 'runs'
      ? t('{n} 轮', { n: fmtCount(s.turns) })
      : sort === 'duration'
        ? fmtDurationMs(s.totalDurationMs)
        : fmtCompactTokens(s.totalTokens)
  return (
    <div className="usage-session-row">
      <span className="usage-session-row__icon">
        <AgentIcon kind={s.agentKind} size={18} />
      </span>
      <div className="usage-session-row__main">
        <span className="usage-session-row__title" title={s.groupName}>
          {s.groupName}
        </span>
        <span className="usage-session-row__meta">
          {s.botName} · {fmtAgentKind(s.agentKind)}
          {s.model ? ` · ${s.model}` : ''} · {s.userName} · {ago(s.lastAt)}
        </span>
      </div>
      <div className="usage-session-row__right">
        <span className="usage-session-row__val">{primary}</span>
        {showDetails ? (
          <span className="usage-session-row__sub">
            {t('{n} 轮', { n: s.turns })}
            {s.inputTokens > 0 || s.outputTokens > 0
              ? ` · ${t('入 {in} / 出 {out}', {
                  in: fmtCompactTokens(s.inputTokens),
                  out: fmtCompactTokens(s.outputTokens),
                })}`
              : ''}
          </span>
        ) : null}
      </div>
      {hasCost && s.costReportedRuns > 0 ? (
        <span className="usage-session-row__cost">{fmtCostUsd(s.costUsd, s.costReportedRuns < s.turns)}</span>
      ) : null}
    </div>
  )
}

export function UsageSessionsTab({
  insights,
  heatmap,
  groupBreakdown,
  secondaryBreakdown,
  secondaryTitle,
  secondaryKind,
  capabilities,
  sessionSort,
  onSessionSortChange,
  stale = false,
}: UsageSessionsTabProps) {
  const [shapeMode, setShapeMode] = useState<ShapeMode>('turns')
  const [toolMode, setToolMode] = useState<ToolViewMode>('name')

  const shape = insights?.sessionShape
  const toolUsage = insights?.toolUsage
  const pluginUsage = insights?.pluginUsage
  const showTools = capabilities.hasTools && !!toolUsage && toolUsage.coveredRuns > 0
  const showPlugins =
    !!pluginUsage && (pluginUsage.items.length > 0 || pluginUsage.runsWithPersonalSkills > 0)

  const kpiCells = useMemo<UsageKpiCell[]>(() => {
    if (!shape) return []
    const cells: UsageKpiCell[] = [
      {
        key: 'sessions',
        label: t('会话数'),
        value: fmtCount(shape.totalSessions),
        sub:
          shape.medianTokensPerSession != null || shape.p90TokensPerSession != null
            ? t('中位 {med} · P90 {p90}', {
                med:
                  shape.medianTokensPerSession != null ? fmtCompactTokens(shape.medianTokensPerSession) : '—',
                p90: shape.p90TokensPerSession != null ? fmtCompactTokens(shape.p90TokensPerSession) : '—',
              })
            : t('均值 {n} 轮 / 会话', { n: shape.avgTurnsPerSession.toFixed(1) }),
      },
      {
        key: 'session-tokens',
        label: 'Token',
        value: fmtCompactTokens(shape.totalTokens),
        sub: t('平均 {n} / 会话', { n: fmtCompactTokens(Math.round(shape.avgTokensPerSession)) }),
      },
      {
        key: 'active-duration',
        label: t('累计活跃时长'),
        value: fmtDurationMs(shape.totalActiveDurationMs),
        sub: t('平均 {n} 轮 / 会话', { n: shape.avgTurnsPerSession.toFixed(1) }),
      },
      {
        key: 'scope-split',
        label: t('群聊 / 私聊'),
        value: `${fmtCount(shape.groupCount)} / ${fmtCount(shape.dmCount)}`,
        sub: t('{n} 个群聊 · {m} 个私聊', { n: shape.groupCount, m: shape.dmCount }),
      },
    ]
    return cells
  }, [shape])

  const histogramBars = useMemo(() => {
    if (!shape) return []
    if (shapeMode === 'duration') {
      return shape.durationBuckets.map((b) => ({
        key: b.bucket,
        label: b.bucket,
        value: b.runs,
        sub: `${fmtCompactTokens(b.totalTokens)} tokens`,
      }))
    }
    if (shapeMode === 'source') {
      return shape.triggerSources.map((b) => ({
        key: b.source,
        label: fmtTriggerSource(b.source),
        value: b.runs,
        sub: `${fmtCompactTokens(b.totalTokens)} tokens`,
      }))
    }
    return shape.turnBuckets.map((b) => ({
      key: b.bucket,
      label: t('{b} 轮', { b: b.bucket }),
      value: b.sessions,
      sub: `${fmtCompactTokens(b.totalTokens)} tokens`,
    }))
  }, [shape, shapeMode])

  const toolRows = useMemo(() => {
    if (!toolUsage) return []
    if (toolMode === 'kind') {
      return toolUsage.byToolKind.map((x) => ({
        key: x.toolKind,
        label: fmtToolKind(x.toolKind),
        kind: x.toolKind,
        calls: x.calls,
        runs: x.runs,
      }))
    }
    if (toolMode === 'mcp') {
      return toolUsage.byMcpTool.map((x) => ({
        key: `${x.server}:${x.tool}`,
        label: `${x.server} / ${x.tool}`,
        kind: 'other',
        calls: x.calls,
        runs: x.runs,
      }))
    }
    if (toolUsage.byToolName.length > 0) {
      return toolUsage.byToolName.map((x) => ({
        key: `${x.kind}:${x.name}`,
        label: x.name,
        kind: x.kind,
        calls: x.calls,
        runs: x.runs,
      }))
    }
    return toolUsage.byToolKind.map((x) => ({
      key: x.toolKind,
      label: fmtToolKind(x.toolKind),
      kind: x.toolKind,
      calls: x.calls,
      runs: x.runs,
    }))
  }, [toolUsage, toolMode])

  const totalToolCalls = useMemo(
    () => (toolUsage?.byToolKind ?? []).reduce((sum, x) => sum + x.calls, 0),
    [toolUsage?.byToolKind],
  )

  const kindColorMap = useMemo(
    () => new Map((toolUsage?.byToolKind ?? []).map((x, i) => [x.toolKind, seriesColor(i, x.toolKind)])),
    [toolUsage?.byToolKind],
  )

  if (insights && insights.sessionShape.totalSessions === 0) {
    return <EmptyState compact illustration={<NoDataArt />} title={t('当前时间范围内没有会话记录')} />
  }

  const maxHist = Math.max(1, ...histogramBars.map((b) => b.value))
  const maxToolCalls = Math.max(1, ...toolRows.map((r) => r.calls))
  const maxPluginRuns = Math.max(1, ...(pluginUsage?.items ?? []).map((p) => p.runs))
  const maxWeekly = Math.max(1, ...(toolUsage?.weeklyByKind ?? []).map((w) => w.total))

  return (
    <div className={cx('usage-tab-stack', stale && 'usage-stale')} data-testid="usage-sessions-tab">
      {kpiCells.length > 0 ? <UsageKpiStrip cells={kpiCells} aria-label={t('会话核心指标')} /> : null}

      <div className="usage-two-col">
        {groupBreakdown?.items.length ? (
          <UsageRankingSection
            title={t('按群 / 会话')}
            items={groupBreakdown.items}
            totalItems={groupBreakdown.totalItems}
            hasCost={capabilities.hasCost}
            hasInputOutput={capabilities.hasInputOutput}
            kind="group"
            compact
          />
        ) : null}
        {secondaryBreakdown?.items.length ? (
          <UsageRankingSection
            title={secondaryTitle}
            items={secondaryBreakdown.items}
            totalItems={secondaryBreakdown.totalItems}
            hasCost={capabilities.hasCost}
            hasInputOutput={capabilities.hasInputOutput}
            kind={secondaryKind}
            compact
          />
        ) : null}
      </div>

      <div className="usage-two-col">
        <UsageWeekHourHeatmap data={heatmap} hasCost={capabilities.hasCost} />

        <section className="usage-panel" data-testid="usage-top-sessions">
          <div className="usage-panel__head">
            <span className="usage-panel__title">{t('最耗会话')}</span>
            <SegmentedControl
              size="small"
              aria-label={t('最耗会话排序')}
              value={sessionSort}
              onChange={onSessionSortChange}
              items={[
                { value: 'tokens', label: 'Token' },
                { value: 'runs', label: t('轮次') },
                { value: 'duration', label: t('耗时') },
              ]}
            />
          </div>
          <div className="usage-session-list">
            {(insights?.topSessions ?? []).slice(0, 8).map((s) => (
              <SessionRow
                key={`${s.sessionKey}:${s.groupId}:${s.botId}`}
                s={s}
                sort={sessionSort}
                hasCost={capabilities.hasCost}
              />
            ))}
          </div>
        </section>
      </div>

      <div className={cx('usage-two-col', !showPlugins && 'usage-two-col--single')}>
        <section className="usage-panel" data-testid="usage-session-shape">
          <div className="usage-panel__head">
            <div className="usage-panel__head-left">
              <span className="usage-panel__title">{t('会话形态')}</span>
              <SegmentedControl
                size="small"
                aria-label={t('会话形态维度')}
                value={shapeMode}
                onChange={setShapeMode}
                items={[
                  { value: 'turns', label: t('轮次') },
                  { value: 'duration', label: t('耗时') },
                  { value: 'source', label: t('来源') },
                ]}
              />
            </div>
            {shape ? (
              <span className="usage-panel__meta">
                {t('{n} 个会话', { n: fmtCount(shape.totalSessions) })}
              </span>
            ) : null}
          </div>

          <div className="usage-hist">
            {histogramBars.map((b, i) => {
              const ratio = b.value > 0 ? Math.max(0.06, b.value / maxHist) : 0
              return (
                <div key={b.key} className="usage-hist__col" title={`${b.label}: ${b.value} (${b.sub})`}>
                  <span className="usage-hist__val">{fmtCount(b.value)}</span>
                  <div className="usage-hist__track">
                    <span
                      className="usage-hist__bar"
                      style={{
                        transform: `scaleY(${ratio})`,
                        opacity: Math.max(0.45, 1 - i * 0.1),
                      }}
                    />
                  </div>
                  <span className="usage-hist__label">{b.label}</span>
                </div>
              )
            })}
          </div>
        </section>

        {showPlugins && pluginUsage ? (
          <section className="usage-panel" data-testid="usage-plugins-card">
            <div className="usage-panel__head">
              <div>
                <span className="usage-panel__title">{t('常用插件（注入）')}</span>
                <span className="usage-panel__sub">
                  {t('按注入轮次统计')}
                  {pluginUsage.runsWithPersonalSkills > 0
                    ? ` · ${t('个人技能注入 {n} 轮', { n: fmtCount(pluginUsage.runsWithPersonalSkills) })}`
                    : ''}
                </span>
              </div>
              <span className="usage-panel__meta">{t('{n} 个插件', { n: pluginUsage.items.length })}</span>
            </div>
            {pluginUsage.items.length > 0 ? (
              <div className="usage-mini-rank">
                {pluginUsage.items.slice(0, 8).map((p) => (
                  <div key={p.name} className="usage-mini-rank__row">
                    <span className="usage-mini-rank__name" title={p.name}>
                      {p.name}
                    </span>
                    <div className="usage-mini-rank__bar" aria-hidden="true">
                      <span style={{ transform: `scaleX(${Math.max(0.03, p.runs / maxPluginRuns)})` }} />
                    </div>
                    <span className="usage-mini-rank__val">{t('{n} 轮', { n: fmtCount(p.runs) })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="usage-note">
                {t('本时段有 {n} 轮运行注入了个人技能，无命名插件记录。', {
                  n: fmtCount(pluginUsage.runsWithPersonalSkills),
                })}
              </p>
            )}
          </section>
        ) : null}
      </div>

      {showTools && toolUsage ? (
        <section className="usage-panel" data-testid="usage-tools-card">
          <div className="usage-panel__head">
            <div className="usage-panel__head-left">
              <span className="usage-panel__title">{t('Tool 使用')}</span>
              <SegmentedControl
                size="small"
                aria-label={t('Tool 视图')}
                value={toolMode}
                onChange={setToolMode}
                items={[
                  { value: 'name', label: t('工具名') },
                  { value: 'kind', label: t('分类') },
                  ...(toolUsage.byMcpTool.length > 0 ? [{ value: 'mcp' as const, label: 'MCP' }] : []),
                ]}
              />
            </div>
            <span className="usage-panel__meta">
              {t('{c} 次调用 · {r} 轮', { c: fmtCount(totalToolCalls), r: fmtCount(toolUsage.coveredRuns) })}
              {toolUsage.purgedRuns > 0
                ? ` · ${t('{d} 天保留窗 · {p} 轮已归档', { d: toolUsage.retentionDays, p: fmtCount(toolUsage.purgedRuns) })}`
                : ''}
            </span>
          </div>

          <div className="usage-tools-grid">
            <div className="usage-tools-list">
              {toolRows.slice(0, 10).map((r) => (
                <div key={r.key} className="usage-tools-row">
                  <span
                    className="usage-swatch"
                    style={{ background: kindColorMap.get(r.kind) ?? 'var(--system-indigo)' }}
                    aria-hidden="true"
                  />
                  <span className="usage-tools-row__name" title={r.label}>
                    {r.label}
                  </span>
                  <div className="usage-tools-row__bar" aria-hidden="true">
                    <span
                      style={{
                        transform: `scaleX(${Math.max(0.02, r.calls / maxToolCalls)})`,
                        background: kindColorMap.get(r.kind) ?? 'var(--system-indigo)',
                      }}
                    />
                  </div>
                  <span className="usage-tools-row__val">{fmtCount(r.calls)}</span>
                  <span className="usage-tools-row__sub">{t('{n} 轮', { n: fmtCount(r.runs) })}</span>
                  <span className="usage-tools-row__pct">
                    {totalToolCalls > 0 ? fmtRate(r.calls / totalToolCalls, 0) : '—'}
                  </span>
                </div>
              ))}
            </div>

            <div className="usage-tools-side">
              {toolUsage.byToolKind.length > 0 && totalToolCalls > 0 ? (
                <>
                  <div className="usage-share" role="img" aria-label={t('Tool 分类占比')}>
                    {toolUsage.byToolKind.map((k) => (
                      <span
                        key={k.toolKind}
                        style={{
                          flexGrow: k.calls,
                          background: kindColorMap.get(k.toolKind) ?? 'var(--system-gray)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="usage-tools-legend">
                    {toolUsage.byToolKind.map((k) => (
                      <span key={k.toolKind} className="usage-tools-legend__item">
                        <span
                          className="usage-swatch"
                          style={{ background: kindColorMap.get(k.toolKind) ?? 'var(--system-gray)' }}
                        />
                        <span>{fmtToolKind(k.toolKind)}</span>
                        <strong>{fmtCount(k.calls)}</strong>
                      </span>
                    ))}
                  </div>
                </>
              ) : null}

              {toolUsage.weeklyByKind.length > 0 ? (
                <div className="usage-weekly-tools">
                  <span className="usage-panel__sub">{t('每周工具调用趋势')}</span>
                  <div className="usage-weekly-bars">
                    {toolUsage.weeklyByKind.slice(-8).map((w) => {
                      const ratio = w.total > 0 ? Math.max(0.08, w.total / maxWeekly) : 0
                      return (
                        <div key={w.week} className="usage-weekly-col" title={`${w.week}: ${w.total}`}>
                          <div className="usage-weekly-track">
                            <div className="usage-weekly-stack" style={{ transform: `scaleY(${ratio})` }}>
                              {toolUsage.byToolKind.map((k) => {
                                const v = w.byKind[k.toolKind] ?? 0
                                if (!v) return null
                                return (
                                  <span
                                    key={k.toolKind}
                                    style={{
                                      flexGrow: v,
                                      background: kindColorMap.get(k.toolKind) ?? 'var(--system-gray)',
                                    }}
                                  />
                                )
                              })}
                            </div>
                          </div>
                          <span className="usage-weekly-label">{w.week.slice(5)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {insights?.recentSessions.length ? (
        <section className="usage-panel" data-testid="usage-recent-sessions">
          <div className="usage-panel__head">
            <span className="usage-panel__title">{t('最近会话')}</span>
            <span className="usage-panel__meta">
              {t('最近 {n} 条', { n: insights.recentSessions.length })}
            </span>
          </div>
          <div className="usage-session-list">
            {insights.recentSessions.slice(0, 10).map((s) => (
              <SessionRow
                key={`${s.sessionKey}:${s.groupId}:${s.botId}`}
                s={s}
                sort="tokens"
                hasCost={capabilities.hasCost}
                showDetails
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
