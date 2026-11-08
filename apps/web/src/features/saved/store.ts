import type { SavedStateDto } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { realtime } from '../../lib/realtime'
import { hm, pad } from '../../lib/time'

/** My open 稍后处理 ids (the saved mark on messages) and the reminders that fired (the sidebar count). */
export const useSaved = create<{ ids: Set<string>; due: number }>()(() => ({ ids: new Set(), due: 0 }))

const REFRESH_MS = 300

export async function loadSaved() {
  const d = await api.get<SavedStateDto>('/saved/state')
  useSaved.setState({ ids: new Set(d.ids), due: d.due })
}

/** Keeps useSaved fresh: on mount, on every change of my saved messages, and after a reconnect. */
export function useSavedSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => void loadSaved().catch(() => {})
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(load, REFRESH_MS)
    }
    load()
    const off = realtime.subscribe((e) => {
      if (e.t === 'saved.changed') later()
    })
    const offReconnect = realtime.onReconnect(load)
    return () => {
      clearTimeout(timer)
      off()
      offReconnect()
    }
  }, [])
}

const call = async (p: Promise<unknown>) => {
  try {
    await p
    await loadSaved()
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

export const savedApi = {
  save: (messageId: string, remindAt: Date | null) =>
    call(api.put(`/messages/${messageId}/save`, { remindAt: remindAt?.toISOString() ?? null })),
  remove: (messageId: string) => call(api.del(`/messages/${messageId}/save`)),
  done: (messageId: string, done: boolean) => call(api.put(`/messages/${messageId}/save/done`, { done })),
}

const at = (d: Date, days: number, hour: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  x.setHours(hour, 0, 0, 0)
  return x
}

/** The reminder choices offered from `now` (20 分钟 … 下周一 9 点); `custom` and `none` have no time. */
export function remindPresets(now = new Date()): { value: string; label: string; at: Date | null }[] {
  const mins = (n: number) => new Date(now.getTime() + n * 60_000)
  // Next Monday, a week ahead when today is Monday.
  const toMonday = ((8 - now.getDay()) % 7 || 7) as number
  return [
    { value: 'remind:20m', label: t('20 分钟后'), at: mins(20) },
    { value: 'remind:1h', label: t('1 小时后'), at: mins(60) },
    { value: 'remind:3h', label: t('3 小时后'), at: mins(180) },
    { value: 'remind:tomorrow', label: t('明天 9 点'), at: at(now, 1, 9) },
    { value: 'remind:monday', label: t('下周一 9 点'), at: at(now, toMonday, 9) },
    { value: 'remind:custom', label: t('自定义…'), at: null },
    { value: 'remind:none', label: t('不提醒'), at: null },
  ]
}

/** When a reminder is due, from `now`: 今天 / 明天 HH:mm, else MM-DD HH:mm. */
export function remindLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  if (diff === 0) return t('今天 {time}', { time: hm(iso) })
  if (diff === 1) return t('明天 {time}', { time: hm(iso) })
  return `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}-`}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(iso)}`
}
