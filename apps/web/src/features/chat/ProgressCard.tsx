import type { ProgressCard as Card, ProgressStageStatus } from '@gonggong/protocol'
import { memo } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Icon, type IconName, ProgressIndicator, Tag, type TagTone } from '../../ui'
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

/** Stage list of a progress card, as shown on its run card and in the task dock. */
export function ProgressStages({ card }: { card: Card }) {
  return (
    <ol className="pg-stages">
      {card.stages.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stages are replaced whole and may repeat a name
        <li key={i} className="pg-stage" data-testid="progress-stage" data-status={s.status}>
          <Icon name={STAGE_ICON[s.status]} size={12} />
          {s.name}
        </li>
      ))}
    </ol>
  )
}

/** A progress card inside the card of the run that posted or last updated it: one compact block, no separate card. */
export const RunProgress = memo(function RunProgress({ card }: { card: Card }) {
  const { done, total } = stagesDone(card)
  return (
    <div className="run-progress" data-testid="run-progress" data-status={card.status}>
      <div className="run-progress__head">
        <Icon name="bolt" size={12} />
        <span className="run-progress__title">{card.title}</span>
        <span className="run-progress__count">
          {done}/{total}
        </span>
        {card.status === 'running' ? null : <Tag tone={STATUS[card.status][1]}>{STATUS[card.status][0]}</Tag>}
      </div>
      <ProgressStages card={card} />
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
