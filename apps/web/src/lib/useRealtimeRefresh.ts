import type { WebEvent } from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
import { realtime } from './realtime'

/**
 * Calls `load` now, again `delayMs` after a burst of events that `match`, and on reconnect (events were lost).
 * Re-subscribes only when `load` changes, so `match` may be an inline function.
 */
export function useRealtimeRefresh(load: () => void, match: (e: WebEvent) => boolean, delayMs = 300) {
  const matchRef = useRef(match)
  matchRef.current = match
  useEffect(() => {
    load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = realtime.subscribe((e) => {
      if (!matchRef.current(e)) return
      clearTimeout(timer)
      timer = setTimeout(load, delayMs)
    })
    const offReconnect = realtime.onReconnect(load)
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [load, delayMs])
}
