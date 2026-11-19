import type { GroupPreviewsDto, PreviewDto } from '@gonggong/protocol'
import { useRef } from 'react'
import { useWorkbench } from '../../app/workbench'
import { api } from '../../lib/api'
import { createGroupStore } from '../../lib/groupStore'
import { openTab } from '../workbench/open'

/** Each group's open previews and live services, loaded on first use and replaced by `group.previews` events. */
const store = createGroupStore<GroupPreviewsDto>({
  load: (groupId) => api.get<GroupPreviewsDto>(`/groups/${groupId}/previews`),
  onEvent: (e) =>
    e.t === 'group.previews'
      ? {
          groupId: e.groupId,
          value: { previews: e.previews, services: e.services, manageableBotIds: e.manageableBotIds },
        }
      : null,
})

export const usePreviews = store.use
export const resetPreviews = store.reset

export type PreviewStatus = PreviewDto['status'] | 'closed'

/** A workbench tab's preview and its state; undefined until the group's list first loads. */
export function usePreview(previewId: string) {
  const groupId = useWorkbench((s) => s.groupId) ?? ''
  const list = usePreviews(groupId)
  // A realtime reconnect clears the list for a moment: keep the last answer so the tab does not flash.
  const last = useRef<{ preview: PreviewDto | undefined; status: PreviewStatus } | undefined>(undefined)
  if (list) {
    const preview = list.previews.find((p) => p.id === previewId)
    last.current = { preview, status: preview ? preview.status : 'closed' }
  }
  return last.current
}

export const openUrl = (previewId: string, path = '/') =>
  `/api/previews/${previewId}/open?path=${encodeURIComponent(path)}`

/** Opens the preview as a workbench tab; false (and a toast) when the workbench is full. */
export const openInWorkbench = (p: Pick<PreviewDto, 'id' | 'path' | 'kind'>) =>
  openTab(
    p.kind === 'miniprogram'
      ? { kind: 'miniprogram', previewId: p.id }
      : p.kind === 'gui'
        ? { kind: 'live', previewId: p.id }
        : { kind: 'web', previewId: p.id, path: p.path },
  )

export const previewIcon = (kind: PreviewDto['kind']) =>
  kind === 'miniprogram' ? 'smartphone' : kind === 'gui' ? 'desktop' : 'globe'

/** Versioned by when it was taken, so a retake shows at once while the image stays cacheable. */
export const snapshotUrl = (p: { id: string; snapshotAt: string | null }) =>
  `/api/previews/${p.id}/snapshot?v=${encodeURIComponent(p.snapshotAt ?? '')}`
