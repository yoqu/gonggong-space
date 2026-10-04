import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button, Icon, Tag } from '../../ui'
import { lastText, stateText } from './model'
import { ScheduleDialog } from './ScheduleDialog'
import { schedulesApi, timingText, useBotNames, useSchedules } from './store'
import './schedules.css'

/** A scheduled task's card in the chat; its live state comes from the group's list (gone = 已删除). */
export function ScheduleCard({
  scheduleId,
  groupId,
  fallback,
}: {
  scheduleId: string
  groupId: string
  /** The event text, shown until the list loads and as the title once deleted. */
  fallback: string
}) {
  const list = useSchedules(groupId)
  const s = list?.find((x) => x.id === scheduleId)
  const bots = useWorkspace((x) => x.bots)
  const groupBots = useWorkspace((x) => x.groups.find((g) => g.id === groupId)?.botIds) ?? []
  const names = useBotNames(s?.botIds ?? [])
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  if (!s)
    return (
      <div className="sc-card" data-state="gone">
        <div className="sc-card__head">
          <Icon name="clock" size={14} />
          <span className="sc-card__title">{fallback}</span>
          {list ? <Tag tone="gray">{t('已删除')}</Tag> : null}
        </div>
      </div>
    )
  const last = lastText(s, (id) => bots.find((b) => b.id === id)?.name ?? t('已移出'))
  return (
    <div className="sc-card" data-state={s.enabled ? 'on' : 'off'}>
      <div className="sc-card__head">
        <Icon name="clock" size={14} />
        <span className="sc-card__title">{s.name}</span>
        <Tag tone={s.enabled ? 'green' : 'gray'}>{s.enabled ? t('启用中') : t('已停用#off')}</Tag>
      </div>
      <div className="sc-card__body">
        <span>
          {timingText(s)} · {names.join(' → ')}
        </span>
        <span className="sc-muted">{fallback}</span>
        <span className="sc-muted">
          {stateText(s)}
          {last ? ` · ${last}` : ''}
        </span>
        <span className="sc-card__prompt">{s.prompt}</span>
      </div>
      {s.canManage ? (
        <div className="sc-card__ops">
          <Button
            size="small"
            onClick={() => void attempt(() => schedulesApi.update(s.id, { enabled: !s.enabled }))}
          >
            {s.enabled ? t('暂停') : t('恢复')}
          </Button>
          <Button size="small" onClick={() => setEditing(true)}>
            {t('编辑')}
          </Button>
          <Button
            size="small"
            variant={confirming ? 'destructive' : undefined}
            onClick={() => (confirming ? void attempt(() => schedulesApi.remove(s)) : setConfirming(true))}
          >
            {confirming ? t('确认删除') : t('删除')}
          </Button>
        </div>
      ) : null}
      {editing ? (
        <ScheduleDialog groupId={groupId} botIds={groupBots} schedule={s} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  )
}
