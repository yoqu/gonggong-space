import type {
  CreateScheduleReq,
  GroupSchedulesDto,
  ScheduleDto,
  SchedulePreviewDto,
  UpdateScheduleReq,
} from '@gonggong/protocol'
import { describeSchedule, formatInZone } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Each group's scheduled tasks, loaded on first use and replaced by `group.schedules` events. */
const useStore = create<Record<string, ScheduleDto[]>>()(() => ({}))
const loading = new Set<string>()

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.schedules') useStore.setState({ [e.groupId]: e.schedules })
  })
  // Events missed while offline: the next use reloads.
  realtime.onStatus((s) => {
    if (s === 'open') useStore.setState({}, true)
  })
}

function load(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  api
    .get<GroupSchedulesDto>(`/groups/${groupId}/schedules`)
    .then((r) => useStore.setState({ [groupId]: r.schedules }))
    .catch(() => {})
    .finally(() => loading.delete(groupId))
}

export function useSchedules(groupId: string): ScheduleDto[] | undefined {
  const list = useStore((s) => s[groupId])
  useEffect(() => {
    sync()
    if (!list) load(groupId)
  }, [groupId, list])
  return list
}

/** Applies a changed schedule at once; the group's `group.schedules` event follows. */
const put = (s: ScheduleDto) =>
  useStore.setState((all) => ({
    [s.groupId]: (all[s.groupId] ?? []).some((x) => x.id === s.id)
      ? (all[s.groupId] ?? []).map((x) => (x.id === s.id ? s : x))
      : [...(all[s.groupId] ?? []), s],
  }))

export const schedulesApi = {
  create: (groupId: string, body: CreateScheduleReq) =>
    api.post<ScheduleDto>(`/groups/${groupId}/schedules`, body).then(put),
  update: (id: string, body: UpdateScheduleReq) => api.patch<ScheduleDto>(`/schedules/${id}`, body).then(put),
  remove: (s: ScheduleDto) =>
    api
      .del(`/schedules/${s.id}`)
      .then(() =>
        useStore.setState((all) => ({ [s.groupId]: (all[s.groupId] ?? []).filter((x) => x.id !== s.id) })),
      ),
  preview: (body: { cron?: string; runAt?: string; timezone: string }) =>
    api.post<SchedulePreviewDto>('/schedules/preview', body),
}

/** Tests: forget loaded lists and the realtime hook-up. */
export function resetSchedules() {
  useStore.setState({}, true)
  loading.clear()
  synced = false
}

export const timingText = (s: Pick<ScheduleDto, 'cron' | 'runAt' | 'timezone'>) => t.text(describeSchedule(s))

/** Candidate bots by name, in order; removed ones read 已移出. */
export function useBotNames(botIds: string[]) {
  const bots = useWorkspace((s) => s.bots)
  return botIds.map((id) => bots.find((b) => b.id === id)?.name ?? t('已移出'))
}

/** A schedule's time as `YYYY-MM-DD HH:mm` in its own time zone. */
export const at = (iso: string, s: Pick<ScheduleDto, 'timezone'>) => formatInZone(iso, s.timezone)
