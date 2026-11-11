import type { ContextBreakdown, ContextUsage, RunDetailDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { fmtTokens } from '../../lib/format'
import { SegmentedControl, Tag, type TagTone } from '../../ui'
import { type ContextLevel, contextGauge } from '../chat/ContextRing'
import { TOOL_LABEL } from './steps'
import './context-window.css'

type Group = 'system' | 'tools' | 'turns'
type Entry = { key: string; group: Group; label: string; tokens: number; count?: number; kind?: string }

/** The run's last reported occupancy, with the estimated make-up the daemon sends at its end. */
export function lastContext(events: RunDetailDto['events']) {
  for (const { event: e } of [...events].reverse()) {
    if (e.kind === 'usage' && e.context) return { context: e.context, breakdown: e.breakdown ?? null }
  }
  return null
}

const LEVEL: Record<ContextLevel, { tone: TagTone; label: string }> = {
  normal: { tone: 'green', label: t('健康') },
  warning: { tone: 'orange', label: t('偏高') },
  critical: { tone: 'red', label: t('将满') },
}
const SHOWN = 8
/** Boxes per group in the map; the rest are merged into one. */
const BOXES = 5
/** Share of its group below which a box is merged or goes without text, and of the window for a group. */
const SMALL = 0.12
const NARROW = 0.08

const toolLabel = (tool: ContextBreakdown['tools'][number]) =>
  tool.name ?? TOOL_LABEL[tool.kind] ?? t('其他工具')

/** 上下文窗口 of one run: occupancy, prompt cache, and what the context is made of (estimated). */
export function ContextWindow({
  context,
  breakdown,
}: {
  context: ContextUsage
  breakdown: ContextBreakdown | null
}) {
  const [filter, setFilter] = useState<'all' | Group>('all')
  const [all, setAll] = useState(false)
  const { level, pct } = contextGauge(context)
  const health = LEVEL[level]
  const free = Math.max(0, context.size - context.used)
  const tools: Entry[] = (breakdown?.tools ?? []).map((tool, i) => ({
    key: `tool:${i}`,
    group: 'tools',
    label: toolLabel(tool),
    tokens: tool.tokens,
    count: tool.count,
    kind: tool.name ? TOOL_LABEL[tool.kind] : undefined,
  }))
  const turns: Entry[] = (breakdown?.turns ?? []).map((tokens, i) => ({
    key: `turn:${i}`,
    group: 'turns',
    label: t('第 {n} 轮', { n: i + 1 }),
    tokens,
  }))
  const sum = (list: Entry[]) => list.reduce((n, e) => n + e.tokens, 0)
  const systemLabel = breakdown?.partial ? t('系统与早先内容') : t('系统提示词与工具定义')
  const system: Entry[] = breakdown
    ? [
        {
          key: 'system',
          group: 'system',
          label: systemLabel,
          tokens: Math.max(0, context.used - sum(tools) - sum(turns)),
        },
      ]
    : []
  const groups = [
    { group: 'system' as const, label: systemLabel, entries: system },
    { group: 'tools' as const, label: t('工具调用'), entries: tools },
    { group: 'turns' as const, label: t('会话内容'), entries: turns },
  ].map((g) => ({ ...g, tokens: sum(g.entries) }))
  const entries = [...system, ...tools, ...turns]
    .filter((e) => filter === 'all' || e.group === filter)
    .sort((a, b) => b.tokens - a.tokens)
  const max = Math.max(1, ...entries.map((e) => e.tokens))
  const cache = breakdown?.cache
  return (
    <section className="ctxw" aria-label={t('上下文窗口')}>
      <div className="ctxw__head">
        <div>
          <div className="ctxw__caption">
            {t('已用上下文')}
            <Tag tone={health.tone}>{health.label}</Tag>
          </div>
          <div className="ctxw__big">
            {fmtTokens(context.used)}
            <span className="ctxw__of">{t(' / {size} token', { size: fmtTokens(context.size) })}</span>
          </div>
          <div className="ctxw__sub">{t('已用 {pct}% · 剩余 {free}', { pct, free: fmtTokens(free) })}</div>
        </div>
        {cache ? (
          <div className="ctxw__cache">
            <div className="ctxw__caption">{t('提示词缓存')}</div>
            <div className="ctxw__big">
              {Math.round((cache.read / Math.max(1, cache.total)) * 100)}%
              <span className="ctxw__of">{t('命中')}</span>
            </div>
            <div className="ctxw__bar" aria-hidden>
              <span style={{ width: `${(cache.read / Math.max(1, cache.total)) * 100}%` }} />
            </div>
            <div className="ctxw__sub">
              {t('{read} 来自缓存 · {fresh} 新增', {
                read: fmtTokens(cache.read),
                fresh: fmtTokens(Math.max(0, cache.total - cache.read)),
              })}
            </div>
          </div>
        ) : null}
      </div>
      {breakdown ? (
        <>
          <div className="ctxw__map" role="img" aria-label={t('上下文构成')}>
            {groups
              .filter((g) => g.tokens > 0)
              .map((g) => (
                <div
                  key={g.group}
                  className="ctxw__col"
                  data-group={g.group}
                  data-narrow={g.tokens < context.size * NARROW || undefined}
                  style={{ flexGrow: g.tokens }}
                >
                  {boxes(g.entries, g.tokens).map((e) => (
                    <div
                      key={e.key}
                      className="ctxw__box"
                      data-small={e.tokens < g.tokens * SMALL || undefined}
                      style={{ flexGrow: e.tokens }}
                      title={`${e.label} ${fmtTokens(e.tokens)}`}
                    >
                      <span className="ctxw__box-name">{e.label}</span>
                      <span className="ctxw__box-n">{fmtTokens(e.tokens)}</span>
                    </div>
                  ))}
                </div>
              ))}
            {free > 0 ? (
              <div className="ctxw__col" data-group="free" style={{ flexGrow: free }}>
                <div className="ctxw__box" style={{ flexGrow: 1 }}>
                  <span className="ctxw__box-name">{t('剩余空间')}</span>
                  <span className="ctxw__box-n">{`${fmtTokens(free)} · ${100 - pct}%`}</span>
                </div>
              </div>
            ) : null}
          </div>
          <ul className="ctxw__legend">
            {groups.map((g) => (
              <li key={g.group} data-group={g.group}>
                {g.label}
                <span>{fmtTokens(g.tokens)}</span>
              </li>
            ))}
            <li data-group="free">
              {t('剩余空间')}
              <span>{fmtTokens(free)}</span>
            </li>
          </ul>
          <div className="ctxw__list-head">
            <span>{t('内容')}</span>
            <SegmentedControl
              size="small"
              aria-label={t('筛选内容')}
              value={filter}
              onChange={setFilter}
              items={[
                { value: 'all', label: t('全部') },
                { value: 'system', label: t('系统') },
                { value: 'tools', label: t('工具调用') },
                { value: 'turns', label: t('会话内容') },
              ]}
            />
          </div>
          <ul className="ctxw__list">
            {(all ? entries : entries.slice(0, SHOWN)).map((e) => (
              <li key={e.key} data-group={e.group}>
                <span className="ctxw__name">{e.label}</span>
                {e.count && e.count > 1 ? <span className="ctxw__count">×{e.count}</span> : null}
                {e.kind ? <span className="ctxw__kind">{e.kind}</span> : null}
                <span className="ctxw__meter" aria-hidden>
                  <span style={{ width: `${(e.tokens / max) * 100}%` }} />
                </span>
                <span className="ctxw__n">{fmtTokens(e.tokens)}</span>
              </li>
            ))}
          </ul>
          {!all && entries.length > SHOWN ? (
            <button type="button" className="ctxw__more" onClick={() => setAll(true)}>
              {t('显示全部 {n} 项', { n: entries.length })}
            </button>
          ) : null}
          <p className="ctxw__note">
            {t('分项按文本长度估算；系统提示词与工具定义为已用量减去其余各项。')}
            {breakdown.partial
              ? t(
                  '会话早先的部分（Agent 压缩或清理过，或机器上的 daemon 重启过）没有分项，算在系统与早先内容里。',
                )
              : null}
          </p>
        </>
      ) : (
        <p className="ctxw__note">{t('分项在本轮结束后统计。')}</p>
      )}
    </section>
  )
}

/** The largest entries of a group (each at least SMALL of it), the rest merged into one box. */
function boxes(entries: Entry[], total: number): Entry[] {
  const sorted = [...entries].sort((a, b) => b.tokens - a.tokens).filter((e) => e.tokens > 0)
  const big = sorted.filter((e, i) => i < BOXES - 1 && e.tokens >= total * SMALL).length
  if (sorted.length - big <= 1) return sorted
  const [first, ...more] = sorted.slice(big) as [Entry, ...Entry[]]
  const rest = [first, ...more]
  return [
    ...sorted.slice(0, big),
    {
      key: `${first.group}:rest`,
      group: first.group,
      label: t('其余 {n} 项', { n: rest.length }),
      tokens: rest.reduce((n, e) => n + e.tokens, 0),
    },
  ]
}
