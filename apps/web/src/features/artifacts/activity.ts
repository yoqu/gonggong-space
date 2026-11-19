import type { ArtifactActivityDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { realtime } from '../../lib/realtime'

/**
 * What live runs are writing in each artifact (plan 原型协作 P1): seeded by GET /api/artifacts/:id, then replaced by
 * every artifact.activity event; dropped on reconnect, as the server forgot the runs that ended meanwhile.
 */
const useStore = create<Record<string, ArtifactActivityDto[]>>()(() => ({}))
const EMPTY: ArtifactActivityDto[] = []

let synced = false
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'artifact.activity') setActivity(e.artifactId, e.activity)
  })
  realtime.onReconnect(() => useStore.setState({}, true))
}

export const setActivity = (artifactId: string, activity: ArtifactActivityDto[]) =>
  useStore.setState({ [artifactId]: activity.length ? activity : EMPTY })

export function useActivityOf(artifactId: string) {
  useEffect(sync, [])
  return useStore((s) => s[artifactId] ?? EMPTY)
}

/** What one run is writing, artifact by artifact (its card). */
export function useRunActivity(runId: string) {
  useEffect(sync, [])
  const all = useStore((s) => s)
  return Object.entries(all).flatMap(([artifactId, list]) =>
    list.filter((a) => a.runId === runId).map((a) => ({ artifactId, ...a })),
  )
}

/** Tests. */
export const resetActivity = () => {
  synced = false
  useStore.setState({}, true)
}
