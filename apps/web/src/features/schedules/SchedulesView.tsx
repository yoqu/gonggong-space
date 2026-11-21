import { SCHEDULE_MAX_PER_GROUP, type ScheduleDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { attempt } from '../../lib/errors'
import { Alert, Button, EmptyState, GroupBox, NoSchedulesArt, Presence, Spinner, Switch, Tag } from '../../ui'
import { botsText, useBotNames } from '../bots/model'
import '../groups/groups.css'
import { lastText, stateText } from './model'
import { ScheduleDialog } from './ScheduleDialog'
import { reloadSchedules, schedulesApi, timingText, useSchedules, useSchedulesError } from './store'

function Row({ s, onEdit }: { s: ScheduleDto; onEdit: () => void }) {
  const bots = useWorkspace((x) => x.bots)
  const names = useBotNames(s.botIds)
  const [pending, setPending] = useState<boolean | null>(null)
  const toggle = async (enabled: boolean) => {
    setPending(enabled)
    await attempt(() => schedulesApi.update(s.id, { enabled }))
    setPending(null)
  }
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    await attempt(() => schedulesApi.run(s))
    setRunning(false)
  }
  const last = lastText(s, (id) => bots.find((b) => b.id === id)?.name ?? t('已移出'))
  return (
    <div className="gs-row" data-testid={`schedule-${s.id}`}>
      <span className="gs-row__main">
        <span className="gs-row__title">
          {s.name}
          {s.createdByBotId ? <Tag tone="gray">{t('Bot 创建')}</Tag> : null}
        </span>
        <span className="gs-muted">
          {timingText(s)} · {botsText(s, names)}
        </span>
        <span className="gs-muted">
          {stateText(s)}
          {last ? ` · ${last}` : ''}
        </span>
      </span>
      {s.canManage ? (
        <span className="gs-row__ops">
          <Button
            variant="plain"
            size="small"
            aria-label={t('立即执行「{name}」', { name: s.name })}
            disabled={running}
            onClick={() => void run()}
          >
            {t('立即执行')}
          </Button>
          <Button variant="plain" size="small" onClick={onEdit}>
            {t('编辑')}
          </Button>
          <Switch
            aria-label={t('启用「{name}」', { name: s.name })}
            checked={pending ?? s.enabled}
            disabled={pending !== null}
            onChange={(v) => void toggle(v)}
          />
        </span>
      ) : null}
    </div>
  )
}

/** 群设置 · 定时任务: every member sees and creates them; the owner and group admins change them. */
export function SchedulesView({ groupId }: { groupId: string }) {
  const list = useSchedules(groupId)
  const error = useSchedulesError(groupId)
  const botIds = useWorkspace((s) => s.groups.find((g) => g.id === groupId)?.botIds) ?? []
  const [editing, setEditing] = useState<ScheduleDto | 'new' | null>(null)
  if (!list) {
    if (error)
      return (
        <Alert variant="error" title={t('定时任务加载失败')} description={error}>
          <div style={{ marginTop: 'var(--space-8)' }}>
            <Button size="small" onClick={() => reloadSchedules(groupId)}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      )
    return <Spinner />
  }
  return (
    <>
      {list.length ? (
        <>
          <div className="gs-toolbar">
            <span className="gs-toolbar__text">
              {t('{n} / {max} 个', { n: list.length, max: SCHEDULE_MAX_PER_GROUP })}
            </span>
            <Button
              size="small"
              disabled={list.length >= SCHEDULE_MAX_PER_GROUP}
              onClick={() => setEditing('new')}
            >
              {t('新建定时任务')}
            </Button>
          </div>
          <GroupBox>
            {list.map((s) => (
              <Row key={s.id} s={s} onEdit={() => setEditing(s)} />
            ))}
          </GroupBox>
        </>
      ) : (
        <EmptyState
          compact
          illustration={<NoSchedulesArt />}
          title={t('还没有定时任务')}
          description={t(
            '到点由 Bot 自动执行一段指令；也可以直接让 Bot 帮你建，例如「每个工作日 9 点汇总昨天的 PR」。',
          )}
          action={
            <Button size="small" onClick={() => setEditing('new')}>
              {t('新建定时任务')}
            </Button>
          }
        />
      )}
      <Presence>
        {editing ? (
          <ScheduleDialog
            groupId={groupId}
            botIds={botIds}
            schedule={editing === 'new' ? undefined : editing}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}
