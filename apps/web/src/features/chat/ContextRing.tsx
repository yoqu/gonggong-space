import type { ContextUsage } from '@gonggong/protocol'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import { fmtTokens } from '../../lib/format'
import { LevelIndicator, RollingNumber } from '../../ui'
import './context.css'

const R = 5
const ARC = 2 * Math.PI * R
/** Claude Code warns this far before its compaction point. */
const MARGIN = 20_000

export type ContextLevel = 'normal' | 'warning' | 'critical'

/** Token counts where the meter turns orange and red: before the agent's own compaction or stop, else by share. */
function thresholds({ size, compactAt, blockAt }: ContextUsage): { warning: number; critical?: number } {
  if (compactAt) return { warning: compactAt - MARGIN }
  if (blockAt) return { warning: blockAt - 2 * MARGIN, critical: blockAt - MARGIN }
  return { warning: size * 0.7, critical: size * 0.9 }
}

/** What the ring and its details show of a context occupancy. */
export function contextGauge(context: ContextUsage) {
  const size = Math.max(1, context.size)
  const pct = Math.min(100, Math.round((context.used / size) * 100))
  const { warning, critical } = thresholds(context)
  const level: ContextLevel =
    critical != null && context.used >= critical ? 'critical' : context.used >= warning ? 'warning' : 'normal'
  return {
    size,
    pct,
    warning,
    critical,
    level,
    detail: `${fmtTokens(context.used)} / ${fmtTokens(context.size)}`,
    /** Tokens left before the agent compacts by itself. */
    left: context.compactAt ? fmtTokens(Math.max(0, context.compactAt - context.used)) : null,
  }
}

/** The one-line tooltip: `上下文 124k / 200k · 还剩 23k 自动压缩`. */
export function contextTitle(context: ContextUsage) {
  const { detail, left } = contextGauge(context)
  return [t('上下文 {detail}', { detail }), left && t('还剩 {n} 自动压缩', { n: left })]
    .filter(Boolean)
    .join(' · ')
}

/** The ring and percentage, for inside a `.ctx-meter` (which carries `data-level`). */
export function ContextRing({ context }: { context: ContextUsage }) {
  const { size, pct } = contextGauge(context)
  const mark = context.compactAt ?? context.blockAt
  // Where the compaction (or stop) point sits on the ring, clockwise from the top.
  const angle = mark ? (Math.min(1, mark / size) - 0.25) * 2 * Math.PI : 0
  return (
    <>
      <svg viewBox="0 0 14 14" width={14} height={14} aria-hidden="true">
        <circle className="ctx-meter__track" cx={7} cy={7} r={R} />
        <circle
          className="ctx-meter__arc"
          cx={7}
          cy={7}
          r={R}
          strokeDasharray={`${(pct / 100) * ARC} ${ARC}`}
          transform="rotate(-90 7 7)"
        />
        {mark ? (
          <circle
            className={cx('ctx-meter__mark', !context.compactAt && 'ctx-meter__mark--block')}
            cx={7 + R * Math.cos(angle)}
            cy={7 + R * Math.sin(angle)}
            r={1.4}
          />
        ) : null}
      </svg>
      <RollingNumber value={`${pct}%`} />
    </>
  )
}

/** The occupancy bar and what compaction means, for the top of a `.ctx-pop`. */
export function ContextSummary({ context }: { context: ContextUsage }) {
  const { size, pct, warning, critical, level, detail, left } = contextGauge(context)
  return (
    <>
      <LevelIndicator
        value={pct}
        warning={(warning / size) * 100}
        critical={critical == null ? undefined : (critical / size) * 100}
        aria-label={t('上下文占用')}
        label={
          <>
            <span>{t('上下文')}</span>
            <span className="ctx-pop__detail">{detail}</span>
          </>
        }
      />
      <p className="ctx-pop__hint">
        {left ? t('还剩 {n} 自动压缩。', { n: left }) : null}
        {context.blockAt
          ? t('已关闭自动压缩，用到 {n} 时 Agent 会停下，需要手动压缩或开新对话。', {
              n: fmtTokens(context.blockAt),
            })
          : null}
        {level === 'critical' ? (context.blockAt ? t('即将停下。') : t('即将用满。')) : null}
        {t('压缩会把此前的对话总结后保留；开新对话则不再带上此前的对话。')}
      </p>
    </>
  )
}
