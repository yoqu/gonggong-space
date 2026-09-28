import type { GroupPreviewsDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { openTab } from '../workbench/open'

/** Each group's open previews and live services, loaded on first use and replaced by `group.previews` events. */
const useStore = create<Record<string, GroupPreviewsDto>>()(() => ({}))
const loading = new Set<string>()

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'group.previews')
      useStore.setState({
        [e.groupId]: { previews: e.previews, services: e.services, manageableBotIds: e.manageableBotIds },
      })
  })
  // Events missed while offline: the next use reloads.
  realtime.onStatus((s) => {
    if (s === 'open') useStore.setState({}, true)
  })
}

export function loadPreviews(groupId: string) {
  if (loading.has(groupId)) return
  loading.add(groupId)
  api
    .get<GroupPreviewsDto>(`/groups/${groupId}/previews`)
    .then((list) => useStore.setState({ [groupId]: list }))
    .catch(() => {})
    .finally(() => loading.delete(groupId))
}

export function usePreviews(groupId: string): GroupPreviewsDto | undefined {
  const list = useStore((s) => s[groupId])
  // Also after a reconnect cleared the lists.
  useEffect(() => {
    sync()
    if (!list) loadPreviews(groupId)
  }, [groupId, list])
  return list
}

/** Tests: forget loaded lists and the realtime hook-up. */
export function resetPreviews() {
  useStore.setState({}, true)
  loading.clear()
  synced = false
}

export const openUrl = (previewId: string, path = '/') =>
  `/api/previews/${previewId}/open?path=${encodeURIComponent(path)}`

/** Opens the preview as a workbench tab; false (and a toast) when the workbench is full. */
export const openInWorkbench = (p: { id: string; path: string }) =>
  openTab({ kind: 'web', previewId: p.id, path: p.path })

/** Versioned by when it was taken, so a retake shows at once while the image stays cacheable. */
export const snapshotUrl = (p: { id: string; snapshotAt: string | null }) =>
  `/api/previews/${p.id}/snapshot?v=${encodeURIComponent(p.snapshotAt ?? '')}`
