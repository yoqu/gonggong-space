import type { ArtifactDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Each group's artifacts (GET /api/groups/:id/artifacts, latest update first): 作品 in the tab bar and `#`. */
const useLists = create<Record<string, ArtifactDto[]>>()(() => ({}))
const loaded = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const EMPTY: ArtifactDto[] = []

export async function loadGroupArtifacts(groupId: string) {
  loaded.add(groupId)
  const list = await api.get<ArtifactDto[]>(`/groups/${groupId}/artifacts`).catch(() => null)
  if (list) useLists.setState({ [groupId]: list })
}

/** A card update (new version, run start or end) reloads its group's list, once per burst. */
function later(groupId: string) {
  clearTimeout(timers.get(groupId))
  timers.set(
    groupId,
    setTimeout(() => {
      timers.delete(groupId)
      void loadGroupArtifacts(groupId)
    }, 500),
  )
}

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if ((e.t === 'message.new' || e.t === 'message.edited') && e.message.card?.type === 'artifact')
      if (loaded.has(e.message.groupId)) later(e.message.groupId)
  })
  realtime.onReconnect(() => {
    for (const g of loaded) later(g)
  })
}

export function useGroupArtifacts(groupId: string): ArtifactDto[] {
  const list = useLists((s) => s[groupId])
  useEffect(() => {
    sync()
    if (groupId && !loaded.has(groupId)) void loadGroupArtifacts(groupId)
  }, [groupId])
  return list ?? EMPTY
}

export const resetGroupArtifacts = () => {
  loaded.clear()
  useLists.setState({}, true)
}
