import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Button, Icon, Presence, Tag } from '../../ui'
import { botsText, useBotNames } from '../bots/model'
import '../groups/groups.css'
import { DeleteScheduleDialog } from './DeleteScheduleDialog'
import { lastTextFor, stateText } from './model'
import { ScheduleDialog } from './ScheduleDialog'
import { schedulesApi, timingText, useSchedules } from './store'
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const act = async (request: () => Promise<unknown>) => {
    setBusy(true)
    await attempt(request)
    setBusy(false)
  }
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
  const last = lastTextFor(s, bots)
  return (
    <div className="sc-card" data-state={s.enabled ? 'on' : 'off'}>
      <div className="sc-card__head">
        <Icon name="clock" size={14} />
        <span className="sc-card__title">{s.name}</span>
        <Tag tone={s.enabled ? 'green' : 'gray'}>{s.enabled ? t('启用中') : t('已停用#off')}</Tag>
      </div>
      <div className="sc-card__body">
        <span>
          {timingText(s)} · {botsText(s, names)}
        </span>
        <span className="gs-muted">{fallback}</span>
        <span className="gs-muted">
          {stateText(s)}
          {last ? ` · ${last}` : ''}
        </span>
        <span className="sc-card__prompt">{s.prompt}</span>
      </div>
      {s.canManage ? (
        <div className="sc-card__ops">
          <Button
            size="small"
            disabled={busy}
            onClick={() => void act(() => schedulesApi.update(s.id, { enabled: !s.enabled }))}
          >
            {s.enabled ? t('停用') : t('启用')}
          </Button>
          <Button size="small" disabled={busy} onClick={() => void act(() => schedulesApi.run(s))}>
            {t('立即执行')}
          </Button>
          <Button size="small" onClick={() => setEditing(true)}>
            {t('编辑')}
          </Button>
          <Button size="small" onClick={() => setConfirmDelete(true)}>
            {t('删除')}
          </Button>
        </div>
      ) : null}
      <Presence>
        {editing ? (
          <ScheduleDialog
            groupId={groupId}
            botIds={groupBots}
            schedule={s}
            onClose={() => setEditing(false)}
          />
        ) : null}
      </Presence>
      <Presence>
        {confirmDelete ? (
          <DeleteScheduleDialog
            name={s.name}
            run={() => schedulesApi.remove(s)}
            onClose={() => setConfirmDelete(false)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
