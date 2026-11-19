import type { WebEvent } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { realtime } from './realtime'

/**
 * Per-group cache loaded on first use, replaced by matching realtime events, and cleared on reconnect so missed
 * events reload on the next render.
 */
export function createGroupStore<T>(o: {
  load: (groupId: string) => Promise<T>
  onEvent: (e: WebEvent) => { groupId: string; value: T } | null
}) {
  const useStore = create<Record<string, T>>()(() => ({}))
  const loading = new Set<string>()
  let synced = false

  function sync() {
    if (synced) return
    synced = true
    realtime.subscribe((e) => {
      const hit = o.onEvent(e)
      if (hit) useStore.setState({ [hit.groupId]: hit.value })
    })
    // Events missed while offline: the next use reloads.
    realtime.onReconnect(() => useStore.setState({}, true))
  }

  function reload(groupId: string) {
    if (loading.has(groupId)) return
    loading.add(groupId)
    o.load(groupId)
      .then((value) => useStore.setState({ [groupId]: value }))
      .catch(() => {})
      .finally(() => loading.delete(groupId))
  }

  function useGroup(groupId: string): T | undefined {
    const value = useStore((s) => s[groupId])
    useEffect(() => {
      sync()
      if (value === undefined) reload(groupId)
    }, [groupId, value])
    return value
  }

  return {
    use: useGroup,
    get: (groupId: string) => useStore.getState()[groupId],
    set: (groupId: string, value: T) => useStore.setState({ [groupId]: value }),
    update: (groupId: string, fn: (prev: T | undefined) => T) =>
      useStore.setState((all) => ({ [groupId]: fn(all[groupId]) })),
    reload,
    /** Tests: forget loaded lists and the realtime hook-up. */
    reset: () => {
      useStore.setState({}, true)
      loading.clear()
      synced = false
    },
  }
}

/** Replaces an item by `id` when present, else appends it. */
export const upsertById = <T extends { id: string }>(list: T[] | undefined, item: T) =>
  (list ?? []).some((x) => x.id === item.id)
    ? (list ?? []).map((x) => (x.id === item.id ? item : x))
    : [...(list ?? []), item]
