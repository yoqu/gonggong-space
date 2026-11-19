import type { GroupDto } from '@gonggong/protocol'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, GroupBox, IconButton } from '../../ui'
import { type Picks, RunConfigChip, useCanConfigure } from '../chat/RunConfigChips'
import '../schedules/schedules.css'
import { BotAvatar } from './avatars'
import { PRESENCE } from './model'

/** Filters saved model/effort picks down to the currently selected candidate bots. */
export const selectedRunOptions = (candidates: string[], picks: Picks): Picks =>
  Object.fromEntries(candidates.flatMap((id) => (picks[id] ? [[id, picks[id]]] : [])))

/**
 * Ordered candidate bot selector with per-bot model and reasoning-effort picks (`RunConfigChip`),
 * shared by scheduled tasks and group webhooks.
 */
export function CandidateBotPicker({
  group,
  botIds,
  candidates,
  onCandidatesChange,
  picks,
  onPicksChange,
  title,
  max,
  offlineWarning,
  scope = 'schedule',
}: {
  group: GroupDto | undefined
  /** All bots of the group offered as candidates. */
  botIds: string[]
  candidates: string[]
  onCandidatesChange: (next: string[]) => void
  picks: Picks
  onPicksChange: (next: Picks) => void
  title: string
  max?: number
  offlineWarning?: string
  scope?: 'schedule' | 'webhook'
}) {
  const allBots = useWorkspace((s) => s.bots)
  const canConfigure = useCanConfigure(group)
  const nameOf = (id: string) => allBots.find((b) => b.id === id)?.name ?? t('已移出')
  const isOnline = (id: string) => {
    const p = allBots.find((b) => b.id === id)?.presence
    return p === 'online' || p === 'running'
  }
  const pickFor = (id: string, next: Picks[string] | null) => {
    const rest = { ...picks }
    delete rest[id]
    onPicksChange(next ? { ...rest, [id]: next } : rest)
  }
  const move = (i: number) => {
    const prev = candidates[i - 1]
    const curr = candidates[i]
    if (!prev || !curr) return
    const next = [...candidates]
    next[i - 1] = curr
    next[i] = prev
    onCandidatesChange(next)
  }
  const allOffline = candidates.length > 0 && candidates.every((id) => !isOnline(id))
  const atLimit = max !== undefined && candidates.length >= max

  return (
    <section>
      <h3 className="sc-form__title">{title}</h3>
      <GroupBox>
        {candidates.map((id, i) => {
          const bot = allBots.find((b) => b.id === id)
          const online = isOnline(id)
          return (
            <div key={id} className="sc-bot">
              <span className="sc-bot__rank">{i + 1}</span>
              <BotAvatar id={id} name={nameOf(id)} size={22} />
              <span className="sc-bot__name">
                <span
                  className="sc-bot__dot"
                  style={{ background: bot ? PRESENCE[bot.presence].color : 'var(--system-gray)' }}
                  aria-hidden="true"
                />
                {nameOf(id)}
                {!online ? <span className="sc-bot__off">{t('离线')}</span> : null}
              </span>
              {group && bot ? (
                <RunConfigChip
                  scope={scope}
                  group={group}
                  bot={bot}
                  pick={picks[id]}
                  editable={canConfigure(bot)}
                  onPick={(next) => pickFor(id, next)}
                />
              ) : null}
              <IconButton
                size="small"
                title={t('上移 {name}', { name: nameOf(id) })}
                disabled={i === 0}
                onClick={() => move(i)}
              >
                {'chevron-up' as const}
              </IconButton>
              <IconButton
                size="small"
                title={t('移除 {name}', { name: nameOf(id) })}
                onClick={() => onCandidatesChange(candidates.filter((x) => x !== id))}
              >
                {'minus' as const}
              </IconButton>
            </div>
          )
        })}
        <div className="sc-bot sc-bot--add">
          {botIds
            .filter((id) => !candidates.includes(id))
            .map((id) => {
              const bot = allBots.find((b) => b.id === id)
              const online = isOnline(id)
              return (
                <Button
                  key={id}
                  size="small"
                  disabled={atLimit}
                  aria-label={t('添加 {name}', { name: nameOf(id) })}
                  onClick={() => onCandidatesChange([...candidates, id])}
                >
                  <span
                    className="sc-bot__dot"
                    style={{ background: bot ? PRESENCE[bot.presence].color : 'var(--system-gray)' }}
                    aria-hidden="true"
                  />
                  + {nameOf(id)}
                  {!online ? <span className="sc-bot__off">{t('离线')}</span> : null}
                </Button>
              )
            })}
          {botIds.length === 0 ? (
            <span className="sc-muted">{t('本群还没有 Bot')}</span>
          ) : botIds.every((id) => candidates.includes(id)) ? (
            <span className="sc-muted">{t('本群的 Bot 都已加入')}</span>
          ) : null}
        </div>
      </GroupBox>
      {offlineWarning && allOffline ? <p className="sc-warn">{offlineWarning}</p> : null}
    </section>
  )
}
