import type { RunStatus } from '@gonggong/protocol'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { SPRING } from '../../lib/motion'
import { Icon } from '../../ui'
import './run-graphics.css'

/** SF Symbols style: 16px grid, one stroke weight, hierarchical color (`sf-2` = secondary layer at 40%). */
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const SHIELD = 'M8 1.8l5 1.9v3.9c0 3.1-2.1 5.6-5 6.6-2.9-1-5-3.5-5-6.6V3.7z'
const BUBBLE = 'M3 3h10a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H7.2L4.5 13.6v-2.4H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'

function Check() {
  const reduced = useReducedMotion()
  return (
    <motion.path
      d="M5.2 8.3l1.9 1.9 3.8-4.3"
      {...STROKE}
      initial={reduced ? false : { pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut', delay: 0.1 }}
    />
  )
}

const GLYPH: Record<RunStatus, ReactNode> = {
  queued: (
    <>
      <path className="sf-2" d="M6 13.2c.5-1.5 2-2 2-3 0 1 1.5 1.5 2 3z" fill="currentColor" />
      <path
        d="M4.5 2h7M4.5 14h7M5.2 2c0 3.2 2.8 4 2.8 6s-2.8 2.8-2.8 6M10.8 2c0 3.2-2.8 4-2.8 6s2.8 2.8 2.8 6"
        {...STROKE}
      />
    </>
  ),
  offline_wait: (
    <>
      <rect className="sf-2" x="2" y="2.8" width="12" height="8.4" rx="1.6" fill="currentColor" />
      <rect x="2" y="2.8" width="12" height="8.4" rx="1.6" {...STROKE} />
      <path d="M6 14h4M8 11.2V14M4.8 7h2M9.2 7h2" {...STROKE} />
    </>
  ),
  forbidden: (
    <>
      <circle className="sf-2" cx="8" cy="8" r="6.2" fill="currentColor" />
      <circle cx="8" cy="8" r="6.2" {...STROKE} />
      <path d="M3.7 12.3l8.6-8.6" {...STROKE} />
    </>
  ),
  running: (
    <>
      <circle className="sf-2" cx="8" cy="8" r="6" {...STROKE} />
      <path className="run-status__spin" d="M8 2a6 6 0 0 1 6 6" {...STROKE} />
    </>
  ),
  awaiting_approval: (
    <>
      <path className="sf-2 run-status__pulse" d={SHIELD} fill="currentColor" />
      <path d={SHIELD} {...STROKE} />
      <path d="M8 5v3.2M8 10.6v.1" {...STROKE} />
    </>
  ),
  awaiting_answer: (
    <>
      <path className="sf-2 run-status__pulse" d={BUBBLE} fill="currentColor" />
      <path d={BUBBLE} {...STROKE} />
      <path d="M6.6 5.9a1.5 1.5 0 1 1 2 1.4c-.4.2-.6.5-.6.9M8 9.6v.1" {...STROKE} />
    </>
  ),
  completed: (
    <>
      <circle className="sf-2" cx="8" cy="8" r="6.5" fill="currentColor" />
      <Check />
    </>
  ),
  interrupted: (
    <>
      <circle className="sf-2" cx="8" cy="8" r="6.5" fill="currentColor" />
      <rect x="5.6" y="5.6" width="4.8" height="4.8" rx="0.8" fill="currentColor" />
    </>
  ),
  expired: (
    <>
      <circle className="sf-2" cx="8" cy="8" r="2" fill="currentColor" />
      <circle cx="8" cy="8" r="6.2" {...STROKE} strokeDasharray="2 2.2" />
    </>
  ),
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: '排队中',
  offline_wait: '离线等待',
  forbidden: '无权触发',
  running: '运行中',
  awaiting_approval: '等待审批',
  awaiting_answer: '等待回答',
  completed: '已完成',
  interrupted: '已中断',
  expired: '已作废',
}

/** Statuses that need someone to act keep their text visible (C6); the rest show it on hover. */
const SPELLED: RunStatus[] = ['awaiting_approval', 'awaiting_answer']

/** `spelled` always shows the text (card headers). */
export function RunStatusIcon({ status, spelled }: { status: RunStatus; spelled?: boolean }) {
  const label = STATUS_LABEL[status]
  return (
    <span className="run-status" data-status={status} title={label}>
      <span className="run-status__glyph" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.svg
            key={status}
            viewBox="0 0 16 16"
            width="15"
            height="15"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={status === 'completed' ? SPRING.bouncy : SPRING.snappy}
          >
            {GLYPH[status]}
          </motion.svg>
        </AnimatePresence>
      </span>
      <span className={spelled || SPELLED.includes(status) ? 'run-status__text' : 'run-vh'}>{label}</span>
    </span>
  )
}

/** A graphic plus its short value; the full label is the tooltip and the (visually hidden) accessible text. */
function Fact({
  label,
  value,
  className,
  children,
}: {
  label: string
  value: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <span className={className ? `run-fact ${className}` : 'run-fact'} title={label}>
      <span className="run-fact__art" aria-hidden="true">
        {children}
        {value}
      </span>
      <span className="run-vh">{label}</span>
    </span>
  )
}

export function FilesFact({ n }: { n: number }) {
  if (!n) return null
  return (
    <Fact label={`改动 ${n} 个文件`} value={n}>
      <Icon name="doc-text" size={12} />
    </Fact>
  )
}

/** Duration as a clock face; while live, a ring fills once per minute (a bare ring would read as a spinner). */
export function ClockFact({ ms, text, live }: { ms: number; text: string; live: boolean }) {
  const p = ((ms / 1000) % 60) / 60
  return (
    <Fact label={`耗时 ${text}`} value={text} className={live ? 'run-fact--live' : undefined}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <circle className="sf-2" cx="8" cy="8" r="6" {...STROKE} strokeWidth={1.5} />
        <path d="M8 5v3l2 1.5" {...STROKE} strokeWidth={1.5} />
        {live ? (
          <circle
            className="clock-ring__arc"
            cx="8"
            cy="8"
            r="6"
            {...STROKE}
            strokeWidth={1.5}
            pathLength={100}
            strokeDasharray={`${Math.max(p * 100, 0.01)} 100`}
          />
        ) : null}
      </svg>
    </Fact>
  )
}

/** Token use against a 10k full bar. */
export function TokenFact({ total, label }: { total: number; label: string }) {
  return (
    <Fact label={label} value={label}>
      <span className="token-meter">
        <span style={{ width: `${Math.min(total / 10_000, 1) * 100}%` }} />
      </span>
    </Fact>
  )
}

/** Relay hop as chain links; walked ones are solid. */
export function HopChain({ hop, max }: { hop: number; max: number }) {
  return (
    <span className="hop-chain" title={`接力 ${hop}/${max}`}>
      {Array.from({ length: Math.max(max, hop) }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: links are positional
        <span key={i} className={i < hop ? 'hop-chain__dot hop-chain__dot--on' : 'hop-chain__dot'} />
      ))}
      <span className="run-vh">{`接力 ${hop}/${max}`}</span>
    </span>
  )
}

const FAN_STEP = 24

/** Fan-out: branches from the message to each triggered bot. */
export function FanOut({ bots }: { bots: string[] }) {
  const reduced = useReducedMotion()
  const w = bots.length * FAN_STEP
  const label = `扇出 · ${bots.length} 个 Bot 并行`
  return (
    <div className="tl-fan" title={`${label}：${bots.join('、')}`}>
      <span className="run-vh">{label}</span>
      <svg width={w} height="12" viewBox={`0 0 ${w} 12`} aria-hidden="true">
        {bots.map((_, i) => {
          const x = i * FAN_STEP + FAN_STEP / 2
          return (
            <motion.path
              // biome-ignore lint/suspicious/noArrayIndexKey: one branch per run, in queue order
              key={i}
              d={`M${w / 2} 0C${w / 2} 7 ${x} 5 ${x} 12`}
              {...STROKE}
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.3, delay: i * 0.08, ease: 'easeOut' }}
            />
          )
        })}
      </svg>
      <div className="tl-fan__bots" aria-hidden="true">
        {bots.map((b, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: one avatar per run, in queue order
          <span key={i} className="tl-fan__bot" title={b}>
            {Array.from(b)[0]}
          </span>
        ))}
      </div>
    </div>
  )
}

const RING = 2 * Math.PI * 7
const URGENT_MS = 30_000

/** Approval countdown: the ring shrinks with the time left and turns orange for the last 30 seconds; the text beside it says the same. */
export function CountdownRing({
  left,
  total,
  text,
  children,
}: {
  left: number
  total: number
  text: string
  children: ReactNode
}) {
  const p = total > 0 ? Math.min(Math.max(left / total, 0), 1) : 0
  return (
    <span
      className={left <= URGENT_MS ? 'countdown-ring countdown-ring--urgent' : 'countdown-ring'}
      title={`剩余 ${text}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <circle className="sf-2" cx="9" cy="9" r="7" {...STROKE} strokeWidth={1.6} />
        <circle
          className="countdown-ring__arc"
          cx="9"
          cy="9"
          r="7"
          {...STROKE}
          strokeWidth={1.6}
          strokeDasharray={`${p * RING} ${RING}`}
        />
      </svg>
      <span className="countdown-ring__icon">{children}</span>
    </span>
  )
}

/** Offline wait: the machine with a broken, flowing link. */
export function OfflineGlyph() {
  return (
    <svg
      className="offline-glyph"
      viewBox="0 0 40 16"
      width="40"
      height="16"
      role="img"
      aria-label="机器离线"
    >
      <title>机器离线</title>
      <rect className="sf-2" x="1" y="2.8" width="12" height="8.4" rx="1.6" fill="currentColor" />
      <rect x="1" y="2.8" width="12" height="8.4" rx="1.6" {...STROKE} />
      <path d="M5 14h4M7 11.2V14M25.5 5.5l-3 5" {...STROKE} />
      <path className="offline-glyph__link" d="M16 7h5M27 7h11" {...STROKE} strokeDasharray="2 2" />
    </svg>
  )
}
