import type { GroupDto, SyncPreviewDto, SyncStatusDto, SyncVersionDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Each force group's sync status, loaded on first use and replaced by `group.sync` events. */
const useStore = create<Record<string, SyncStatusDto>>()(() => ({}))
const loading = new Set<string>()

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.sync') {
      const { t: _, ...s } = e
      useStore.setState({ [s.groupId]: s })
    }
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
    .get<SyncStatusDto>(`/groups/${groupId}/sync`)
    .then((r) => useStore.setState({ [groupId]: r }))
    .catch(() => {})
    .finally(() => loading.delete(groupId))
}

/** Undefined for partition groups and until loaded. */
export function useSyncStatus(group: Pick<GroupDto, 'id' | 'mode'>): SyncStatusDto | undefined {
  const force = group.mode === 'force'
  const status = useStore((s) => (force ? s[group.id] : undefined))
  useEffect(() => {
    if (!force) return
    sync()
    if (!status) load(group.id)
  }, [group.id, force, status])
  return status
}

export const VERSIONS_PAGE = 50

export const syncApi = {
  versions: (groupId: string, before?: number) =>
    api.get<SyncVersionDto[]>(
      `/groups/${groupId}/sync/versions?${before ? `before=${before}&` : ''}limit=${VERSIONS_PAGE}`,
    ),
  preview: (groupId: string) => api.get<SyncPreviewDto>(`/groups/${groupId}/sync/preview`),
  /** `force` = 丢弃本地改动并加入. */
  join: (groupId: string, botId: string, force: boolean) =>
    api
      .post<SyncStatusDto>(`/groups/${groupId}/sync/replicas/${botId}/join`, { force })
      .then((s) => useStore.setState({ [groupId]: s })),
}

/** Tests: forget loaded statuses and the realtime hook-up. */
export function resetSync() {
  useStore.setState({}, true)
  loading.clear()
  synced = false
}
