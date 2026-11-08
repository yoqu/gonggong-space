import type { ThreadUnreadDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

/** Followed threads with new replies, and how many of them @ me (the sidebar's 话题 row). */
export const useThreadUnread = create<ThreadUnreadDto>()(() => ({ unread: 0, mentioned: 0 }))

const REFRESH_MS = 300

/** Keeps useThreadUnread fresh: on mount, on every change of my thread state, and after a reconnect. */
export function useThreadUnreadSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      void api
        .get<ThreadUnreadDto>('/threads/unread')
        .then((d) => useThreadUnread.setState(d))
        .catch(() => {})
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(load, REFRESH_MS)
    }
    load()
    const off = realtime.subscribe((e) => {
      if (e.t === 'thread.state') later()
    })
    const offReconnect = realtime.onReconnect(load)
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [])
}
