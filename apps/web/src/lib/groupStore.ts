import type { WebEvent } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { errorText } from './api'
import { realtime } from './realtime'

interface GroupStoreState<T> {
  values: Record<string, T>
  errors: Record<string, string | null>
}

/**
 * Per-group cache loaded on first use, replaced by matching realtime events, and cleared on reconnect so missed
 * events reload on the next render.
 */
export function createGroupStore<T>(o: {
  load: (groupId: string) => Promise<T>
  onEvent: (e: WebEvent) => { groupId: string; value: T } | null
  /** `'clear'` drops cached values so the next render reloads; `'reload'` refreshes loaded groups in place. */
  reconnect?: 'clear' | 'reload'
}) {
  const useStore = create<GroupStoreState<T>>()(() => ({ values: {}, errors: {} }))
  const loading = new Set<string>()
  let unsubs: (() => void)[] = []
  let synced = false
  let epoch = 0

  function sync() {
    if (synced) return
    synced = true
    unsubs = [
      realtime.subscribe((e) => {
        const hit = o.onEvent(e)
        if (hit)
          useStore.setState((s) => ({
            values: { ...s.values, [hit.groupId]: hit.value },
            errors: { ...s.errors, [hit.groupId]: null },
          }))
      }),
      // Events missed while offline: drop cached values or refresh loaded groups in place.
      realtime.onReconnect(() => {
        if (o.reconnect === 'reload') {
          const { values, errors } = useStore.getState()
          const ids = new Set([...Object.keys(values), ...Object.keys(errors).filter((k) => errors[k])])
          for (const groupId of ids) reload(groupId)
        } else {
          useStore.setState({ values: {}, errors: {} })
        }
      }),
    ]
  }

  function reload(groupId: string) {
    if (loading.has(groupId)) return
    const run = epoch
    loading.add(groupId)
    useStore.setState((s) => ({ errors: { ...s.errors, [groupId]: null } }))
    o.load(groupId)
      .then((value) => {
        if (epoch !== run) return
        useStore.setState((s) => ({
          values: { ...s.values, [groupId]: value },
          errors: { ...s.errors, [groupId]: null },
        }))
      })
      .catch((e) => {
        if (epoch !== run) return
        useStore.setState((s) => ({
          errors: { ...s.errors, [groupId]: errorText(e) },
        }))
      })
      .finally(() => {
        if (epoch === run) loading.delete(groupId)
      })
  }

  function useError(groupId: string | null): string | null {
    return useStore((s) => (groupId ? (s.errors[groupId] ?? null) : null))
  }

  const useGroup = Object.assign(
    function useGroup(groupId: string | null): T | undefined {
      const value = useStore((s) => (groupId ? s.values[groupId] : undefined))
      const error = useStore((s) => (groupId ? (s.errors[groupId] ?? null) : null))
      useEffect(() => {
        if (!groupId) return
        sync()
        if (value === undefined && !error) reload(groupId)
      }, [groupId, value, error])
      return value
    },
    { useError, reload },
  )

  return {
    use: useGroup,
    useError,
    get: (groupId: string) => useStore.getState().values[groupId],
    set: (groupId: string, value: T) =>
      useStore.setState((s) => ({
        values: { ...s.values, [groupId]: value },
        errors: { ...s.errors, [groupId]: null },
      })),
    update: (groupId: string, fn: (prev: T | undefined) => T) =>
      useStore.setState((s) => ({
        values: { ...s.values, [groupId]: fn(s.values[groupId]) },
        errors: { ...s.errors, [groupId]: null },
      })),
    reload,
    /** Tests: forget loaded lists and the realtime hook-up. */
    reset: () => {
      epoch++
      for (const unsub of unsubs) unsub()
      unsubs = []
      useStore.setState({ values: {}, errors: {} })
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
