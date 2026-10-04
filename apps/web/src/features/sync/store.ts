import type {
  GroupDto,
  SyncConflictDto,
  SyncDecision,
  SyncPreviewDto,
  SyncStatusDto,
  SyncVersionDto,
} from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api, errorText } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Each force group's sync status, loaded on first use and replaced by `group.sync` events; `error` = the load failed. */
const useStore = create<{ status: Record<string, SyncStatusDto>; error: Record<string, string> }>()(() => ({
  status: {},
  error: {},
}))
const loading = new Set<string>()

const clearError = (groupId: string) => {
  const { [groupId]: _, ...error } = useStore.getState().error
  return error
}
const put = (s: SyncStatusDto) =>
  useStore.setState((x) => ({ status: { ...x.status, [s.groupId]: s }, error: clearError(s.groupId) }))

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.sync') {
      const { t: _, ...s } = e
      put(s)
    }
  })
  // Events missed while offline: reload what is shown, keeping it until the answer arrives.
  realtime.onStatus((s) => {
    if (s !== 'open') return
    const { status, error } = useStore.getState()
    for (const id of new Set([...Object.keys(status), ...Object.keys(error)])) load(id)
  })
}

function load(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  api
    .get<SyncStatusDto>(`/groups/${groupId}/sync`)
    .then(put)
    .catch((e) => useStore.setState((x) => ({ error: { ...x.error, [groupId]: errorText(e) } })))
    .finally(() => loading.delete(groupId))
}

/** Undefined for partition groups and until loaded. */
export function useSyncStatus(group: Pick<GroupDto, 'id' | 'mode'>): SyncStatusDto | undefined {
  return useSyncLoad(group).status
}

/** The status with the load error, if any, and a retry after one. */
export function useSyncLoad(group: Pick<GroupDto, 'id' | 'mode'>) {
  const force = group.mode === 'force'
  const status = useStore((s) => (force ? s.status[group.id] : undefined))
  const error = useStore((s) => (force ? s.error[group.id] : undefined))
  useEffect(() => {
    if (!force) return
    sync()
    if (!status && !error) load(group.id)
  }, [group.id, force, status, error])
  // Clearing the error reloads.
  return { status, error, retry: () => useStore.setState({ error: clearError(group.id) }) }
}

/** Which group's sync panel is open, and the bot it focuses; set from outside (e.g. a notification's `?sync=`). */
export const useSyncPanel = create<{ groupId: string | null; botId: string | null }>()(() => ({
  groupId: null,
  botId: null,
}))
export const openSyncPanel = (groupId: string, botId: string | null = null) =>
  useSyncPanel.setState({ groupId, botId })
export const closeSyncPanel = () => useSyncPanel.setState({ groupId: null, botId: null })

export const VERSIONS_PAGE = 50

export const syncApi = {
  versions: (groupId: string, before?: number) =>
    api.get<SyncVersionDto[]>(
      `/groups/${groupId}/sync/versions?${before ? `before=${before}&` : ''}limit=${VERSIONS_PAGE}`,
    ),
  preview: (groupId: string) => api.get<SyncPreviewDto>(`/groups/${groupId}/sync/preview`),
  /** `force` = 丢弃本地改动并加入. */
  join: (groupId: string, botId: string, force: boolean) =>
    api.post<SyncStatusDto>(`/groups/${groupId}/sync/replicas/${botId}/join`, { force }).then(put),
  /** 提交本地改动 / 丢弃本地改动 (F12). */
  drift: (groupId: string, botId: string, choice: 'submit' | 'discard') =>
    api.post(`/groups/${groupId}/sync/replicas/${botId}/drift`, { choice }),
  conflicts: (groupId: string) => api.get<SyncConflictDto[]>(`/groups/${groupId}/sync/conflicts`),
  resolve: (groupId: string, conflictId: string, decisions: SyncDecision[]) =>
    api.post(`/groups/${groupId}/sync/conflicts/${conflictId}/resolve`, { decisions }),
  /** 整版丢弃. */
  discard: (groupId: string, conflictId: string) =>
    api.post(`/groups/${groupId}/sync/conflicts/${conflictId}/discard`),
  /** One side of a conflicting text file. */
  text: (groupId: string, conflictId: string, hash: string) =>
    api.text(`/groups/${groupId}/sync/conflicts/${conflictId}/blobs/${hash}`),
}

/** Tests: forget loaded statuses and the realtime hook-up. */
export function resetSync() {
  useStore.setState({ status: {}, error: {} })
  closeSyncPanel()
  loading.clear()
  synced = false
}
