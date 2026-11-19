import type {
  CreateScheduleReq,
  GroupSchedulesDto,
  ScheduleDto,
  SchedulePreviewDto,
  UpdateScheduleReq,
} from '@gonggong/protocol'
import { describeSchedule, formatInZone } from '@gonggong/protocol'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { createGroupStore, upsertById } from '../../lib/groupStore'
import { toast } from '../../ui'

/** Each group's scheduled tasks, loaded on first use and replaced by `group.schedules` events. */
const store = createGroupStore<ScheduleDto[]>({
  load: (groupId) => api.get<GroupSchedulesDto>(`/groups/${groupId}/schedules`).then((r) => r.schedules),
  onEvent: (e) => (e.t === 'group.schedules' ? { groupId: e.groupId, value: e.schedules } : null),
})

export const useSchedules = store.use
export const resetSchedules = store.reset

/** Applies a changed schedule at once; the group's `group.schedules` event follows. */
const put = (s: ScheduleDto) => store.update(s.groupId, (list) => upsertById(list, s))

export const schedulesApi = {
  create: (groupId: string, body: CreateScheduleReq) =>
    api.post<ScheduleDto>(`/groups/${groupId}/schedules`, body).then(put),
  update: (id: string, body: UpdateScheduleReq) => api.patch<ScheduleDto>(`/schedules/${id}`, body).then(put),
  /** Fires it now whether it is on or not; the group sees the run. */
  run: (s: ScheduleDto) =>
    api
      .post<ScheduleDto>(`/schedules/${s.id}/run`)
      .then(put)
      .then(() => toast({ type: 'success', message: t('已触发「{name}」，结果见群聊', { name: s.name }) })),
  remove: (s: ScheduleDto) =>
    api
      .del(`/schedules/${s.id}`)
      .then(() => store.update(s.groupId, (list) => (list ?? []).filter((x) => x.id !== s.id))),
  preview: (body: { cron?: string; runAt?: string; timezone: string }) =>
    api.post<SchedulePreviewDto>('/schedules/preview', body),
}

export const timingText = (s: Pick<ScheduleDto, 'cron' | 'runAt' | 'timezone'>) => t.text(describeSchedule(s))

/** A schedule's time as `YYYY-MM-DD HH:mm` in its own time zone. */
export const at = (iso: string, s: Pick<ScheduleDto, 'timezone'>) => formatInZone(iso, s.timezone)
