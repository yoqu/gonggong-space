import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { Button, Icon, Popover } from '../../ui'
import '../groups/groups.css'
import { lastTextFor, stateText } from './model'
import { timingText, useSchedules } from './store'
import './schedules.css'

/** Pinned above the composer: the group's upcoming tasks, since their chat cards scroll away. */
export function ScheduleTag({ groupId, onManage }: { groupId: string; onManage: () => void }) {
  const list = useSchedules(groupId)
  const bots = useWorkspace((x) => x.bots)
  const upcoming = (list ?? [])
    .filter((s) => s.enabled && s.nextRunAt)
    .sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''))
  if (!upcoming.length) return null
  const label = t('定时任务：{n} 个', { n: upcoming.length })
  return (
    <Popover
      placement="top-start"
      width={320}
      aria-label={t('定时任务')}
      trigger={
        <button type="button" className="sc-tag" aria-label={label} title={label}>
          <Icon name="clock" size={13} />
          <span className="sc-tag__count sc-tag__full">{t('定时任务 {n}', { n: upcoming.length })}</span>
          <span className="sc-tag__count sc-tag__short">{upcoming.length}</span>
        </button>
      }
    >
      {(close) => (
        <div className="sc-pop">
          <div className="sc-pop__head">
            <span className="sc-pop__title">{t('定时任务')}</span>
            <Button
              size="small"
              variant="plain"
              onClick={() => {
                close()
                onManage()
              }}
            >
              {t('管理#manage')}
            </Button>
          </div>
          {upcoming.map((s) => {
            const last = lastTextFor(s, bots)
            return (
              <div key={s.id} className="sc-pop__item" data-testid={`schedule-tag-${s.id}`}>
                <span className="gs-row__title">{s.name}</span>
                <span className="gs-muted">
                  {timingText(s)} · {stateText(s)}
                </span>
                {last ? <span className="gs-muted">{last}</span> : null}
              </div>
            )
          })}
        </div>
      )}
    </Popover>
  )
}
