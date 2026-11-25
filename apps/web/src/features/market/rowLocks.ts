import { useRef, useState } from 'react'

/** Per-row busy state for list actions, so one slow row never locks the others or runs twice. */
export function useRowLocks() {
  const held = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const run = async <T>(id: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (held.current.has(id)) return undefined
    held.current.add(id)
    setBusy(new Set(held.current))
    try {
      return await fn()
    } finally {
      held.current.delete(id)
      setBusy(new Set(held.current))
    }
  }
  return { busy, run }
}
