import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { type AppInfo, ipc, onSnapshot, type Snapshot } from './ipc'

export const useDaemon = create<{ info: AppInfo | null; snapshot: Snapshot }>()(() => ({
  info: null,
  snapshot: { phase: 'unbound' },
}))

/** Loads the initial state and follows snapshot events; resolves to the unlisten function. */
export async function connectDaemon() {
  const unlisten = await onSnapshot((snapshot) => useDaemon.setState({ snapshot }))
  const [info, snapshot] = await Promise.all([ipc.appInfo(), ipc.snapshot()])
  useDaemon.setState({ info, snapshot })
  return unlisten
}

/** Binding details change on login / unbind / revocation. */
export async function refreshInfo() {
  useDaemon.setState({ info: await ipc.appInfo() })
}

/** Current time, re-rendered every `ms` for relative labels ("上次 3 秒前"). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
