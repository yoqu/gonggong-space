import type { ProgressCard as Card, ProgressStageStatus } from '@gonggong/protocol'
import { memo, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import {
  Icon,
  type IconName,
  Mascot,
  type MascotAction,
  type MascotMove,
  ProgressIndicator,
  Tag,
  type TagTone,
} from '../../ui'
import './progress-card.css'

const STATUS: Record<Card['status'], [string, TagTone]> = {
  running: [t('进行中'), 'blue'],
  done: [t('已完成'), 'green'],
  failed: [t('失败'), 'red'],
}

const STAGE_ICON: Record<ProgressStageStatus, IconName> = {
  pending: 'clock',
  running: 'arrow-clockwise',
  done: 'checkmark-circle',
  failed: 'xmark-circle',
  skipped: 'minus',
}

/** A bot's progress card (progress_card), e.g. a build and deploy; updated in place as the bot polls. */
export const ProgressCard = memo(function ProgressCard({ card }: { card: Card }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === card.botId)?.name ?? 'Bot')
  const [label, tone] = STATUS[card.status]
  return (
    <div className="pg-card" data-testid="progress-card" data-status={card.status}>
      <div className="pg-card__head">
        <Icon name="bolt" size={14} />
        <span className="pg-card__title">{card.title}</span>
        <Tag tone={tone}>{label}</Tag>
      </div>
      <span className="pg-card__bot">{bot}</span>
      <ProgressStages card={card} />
      {card.percent === null ? null : <ProgressIndicator value={card.percent} aria-label={card.title} />}
      {card.detail ? <span className="pg-card__detail">{card.detail}</span> : null}
      {card.link ? (
        <a className="pg-card__link" href={card.link.url} target="_blank" rel="noreferrer">
          {card.link.label}
        </a>
      ) : null}
    </div>
  )
})

/** Stages finished (done or skipped) of all: the todo count shown on run cards and task chips. */
export const stagesDone = (card: Card) => ({
  done: card.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length,
  total: card.stages.length,
})

/** Stage list of a progress card, as shown on its run card and in the task dock; `walker`: the stage 共字君 stands on. */
export function ProgressStages({ card, walker }: { card: Card; walker?: number }) {
  return (
    <ol className="pg-stages">
      {card.stages.map((s, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: stages are replaced whole and may repeat a name
          key={i}
          className="pg-stage"
          data-testid="progress-stage"
          data-status={s.status}
          data-walker={i === walker || undefined}
        >
          <Icon name={STAGE_ICON[s.status]} size={12} />
          {s.name}
        </li>
      ))}
    </ol>
  )
}

/** A hop: crouch, jump with a flip, land with a squash. */
const HOP_MS = 650
/** A skip to the next stage: two bounces on the way. */
const WALK_MS = 600
/** Little things it does while it waits on a stage, one every 4–7s. */
const FIDGETS = ['peek', 'wiggle', 'wave', 'bounce'] as const
const FIDGET_MS = 900

type Move = MascotMove | (typeof FIDGETS)[number]

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Where 共字君 stands and what it does as a run's stages advance: a hop where a stage was just done, then a skip to the
 * running one; while it waits, now and then a fidget. Under reduced motion it is simply there and keeps still.
 */
function useWalk(target: number, done: number, lively: boolean) {
  const [walk, setWalk] = useState<{ at: number; move?: Move }>({ at: target })
  const prev = useRef({ target, done })
  useEffect(() => {
    const from = prev.current
    prev.current = { target, done }
    if (reducedMotion()) return setWalk({ at: target })
    const timers: ReturnType<typeof setTimeout>[] = []
    const go = () => {
      if (target === from.target || target < 0 || from.target < 0) return setWalk({ at: target })
      setWalk({ at: target, move: 'walk' })
      timers.push(setTimeout(() => setWalk({ at: target }), WALK_MS))
    }
    if (done > from.done && from.target >= 0) {
      setWalk({ at: from.target, move: 'hop' })
      timers.push(setTimeout(go, HOP_MS))
    } else go()
    return () => timers.forEach(clearTimeout)
  }, [target, done])
  // Fidgeting counts as idle, so a fidget does not cancel its own end.
  const idle = lively && walk.at >= 0 && (!walk.move || (FIDGETS as readonly string[]).includes(walk.move))
  useEffect(() => {
    if (!idle || reducedMotion()) return
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      timer = setTimeout(
        () => {
          const move = FIDGETS[Math.floor(Math.random() * FIDGETS.length)]
          setWalk((w) => (w.move ? w : { ...w, move }))
          timer = setTimeout(() => {
            setWalk((w) => (w.move === move ? { at: w.at } : w))
            next()
          }, FIDGET_MS)
        },
        4000 + Math.random() * 3000,
      )
    }
    next()
    return () => clearTimeout(timer)
  }, [idle])
  return walk
}

/** The pixel offset of stage `at`'s icon within the walker's container, re-measured when the container resizes. */
function useAnchor(walker: RefObject<HTMLDivElement | null>, at: number) {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  // The walker's own parent: a parent's ref is not attached yet when a child's layout effect first runs.
  useLayoutEffect(() => {
    const el = walker.current?.parentElement
    if (!el) return
    // Layout offsets, not client rects: the card may still be scaling in when this runs.
    const measure = () => {
      const stage = el.querySelectorAll<HTMLElement>('[data-testid="progress-stage"]')[at]
      if (!stage) return
      const middle = stage.offsetTop + stage.offsetHeight / 2
      // Centred on the stage's 12px icon, feet (at 106 of the 120 viewBox) on its baseline.
      setPos({ x: stage.offsetLeft + 6 - WALKER / 2, y: middle + 6 - (WALKER * 106) / 120 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [walker, at])
  return pos
}

/** Whether `box` is on screen: off screen the figure holds still. */
function useOnScreen(box: RefObject<HTMLDivElement | null>, active: boolean) {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const el = box.current
    if (!el || !active) return
    const io = new IntersectionObserver(([e]) => setOn(e?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [box, active])
  return on
}

const WALKER = 28

/** What the figure itself acts out for a move; the overlay adds the jumps, flips and squashes around it. */
const MOVE_ACTION: Partial<Record<Move, MascotAction | MascotMove>> = {
  walk: 'walk',
  hop: 'hop',
  wave: 'wave',
}

/** 共字君 in a run progress card's overlay, standing in for the stage it is on; moves by transform only. */
function Walker({ at, move, on }: { at: number; move?: Move; on: boolean }) {
  const self = useRef<HTMLDivElement>(null)
  const { x, y } = useAnchor(self, at)
  return (
    <div
      ref={self}
      className="pg-walker"
      data-testid="progress-walker"
      data-stage={at}
      data-move={move}
      style={{ transform: `translate(${x}px, ${y}px)` }}
    >
      <Mascot action={(move && MOVE_ACTION[move]) ?? 'type'} size={WALKER} still={!on} />
      <span className="pg-walker__spark" aria-hidden>
        ✦
      </span>
    </div>
  )
}

/** Whether 共字君 can walk `card`'s stages: it is running and one of them is. */
export const walkable = (card: Card) =>
  card.status === 'running' && card.stages.some((s) => s.status === 'running')

/**
 * A progress card inside the card of the run that posted or last updated it: one compact block, no separate card.
 * `walker`: 共字君 walks its stages (the run's only character then).
 */
export const RunProgress = memo(function RunProgress({ card, walker }: { card: Card; walker?: boolean }) {
  const { done, total } = stagesDone(card)
  const walking = !!walker && walkable(card)
  const box = useRef<HTMLDivElement>(null)
  const on = useOnScreen(box, walking)
  const target = walking ? card.stages.findIndex((s) => s.status === 'running') : -1
  const { at, move } = useWalk(target, done, walking && on)
  const standing = walking && at >= 0
  return (
    <div
      ref={box}
      className="run-progress"
      data-testid="run-progress"
      data-status={card.status}
      data-walking={standing || undefined}
    >
      {standing ? <Walker at={at} move={move} on={on} /> : null}
      <div className="run-progress__head">
        <Icon name="bolt" size={12} />
        <span className="run-progress__title">{card.title}</span>
        <span className="run-progress__count">
          {done}/{total}
        </span>
        {card.status === 'running' ? null : <Tag tone={STATUS[card.status][1]}>{STATUS[card.status][0]}</Tag>}
      </div>
      <ProgressStages card={card} walker={standing ? at : undefined} />
      {card.percent === null ? null : <ProgressIndicator value={card.percent} aria-label={card.title} />}
      {card.detail || card.link ? (
        <span className="run-progress__detail">
          {card.detail}
          {card.link ? (
            <a className="pg-card__link" href={card.link.url} target="_blank" rel="noreferrer">
              {card.link.label}
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  )
})
