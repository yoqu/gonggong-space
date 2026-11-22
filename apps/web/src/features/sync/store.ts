import type {
  GroupDto,
  SyncConflictDto,
  SyncDecision,
  SyncStatusDto,
  SyncVersionDto,
} from '@gonggong/protocol'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { createGroupStore } from '../../lib/groupStore'

/** Each force group's sync status, loaded on first use and replaced by `group.sync` events. */
const syncStore = createGroupStore<SyncStatusDto>({
  load: (groupId) => api.get<SyncStatusDto>(`/groups/${groupId}/sync`),
  onEvent: (e) => {
    if (e.t !== 'group.sync') return null
    const { t: _, ...s } = e
    return { groupId: s.groupId, value: s }
  },
  reconnect: 'reload',
})

/** Undefined for partition groups and until loaded. */
export function useSyncStatus(group: Pick<GroupDto, 'id' | 'mode'>): SyncStatusDto | undefined {
  return useSyncLoad(group).status
}

/** The status with the load error, if any, and a retry after one. */
export function useSyncLoad(group: Pick<GroupDto, 'id' | 'mode'>) {
  const id = group.mode === 'force' ? group.id : null
  const status = syncStore.use(id)
  const error = syncStore.useError(id)
  return { status, error, retry: () => syncStore.reload(group.id) }
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
  /** `force` = 丢弃本地改动并加入. */
  join: (groupId: string, botId: string, force: boolean) =>
    api.post<SyncStatusDto>(`/groups/${groupId}/sync/replicas/${botId}/join`, { force }).then((s) => {
      syncStore.set(s.groupId, s)
      return s
    }),
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
  syncStore.reset()
  closeSyncPanel()
}
