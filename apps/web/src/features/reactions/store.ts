import type { MessageDto, ReactionDto, ReactionEmoji } from '@gonggong/protocol'
import { useEffect } from 'react'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { realtime } from '../../lib/realtime'
import { toast } from '../../ui'
import { setReaction } from './api'

export type ReactionTarget = Pick<MessageDto, 'id' | 'groupId' | 'reactions'>

/** Reactions changed since the timeline loaded them, by message id. */
const useChanged = create<Record<string, ReactionDto[]>>()(() => ({}))
const put = (messageId: string, reactions: ReactionDto[]) => useChanged.setState({ [messageId]: reactions })

let synced = false
/** Timelines refetch after a reconnect, so their data supersedes what was changed before it. */
function sync() {
  if (synced) return
  synced = true
  realtime.subscribe((e) => {
    if (e.t === 'message.reactions') put(e.messageId, e.reactions)
  })
  realtime.onStatus((s) => {
    if (s === 'open') useChanged.setState({}, true)
  })
}

export function useReactions(message: ReactionTarget): ReactionDto[] {
  useEffect(sync, [])
  return useChanged((s) => s[message.id]) ?? message.reactions ?? []
}

type Reactor = ReactionDto['users'][number]

function applyMine(list: ReactionDto[], emoji: ReactionEmoji, on: boolean, me: Reactor): ReactionDto[] {
  const hit = list.find((r) => r.emoji === emoji)
  if (on) {
    if (!hit) return [...list, { emoji, count: 1, mine: true, users: [me] }]
    return list.map((r) =>
      r === hit ? { ...r, count: r.count + 1, mine: true, users: [...r.users, me] } : r,
    )
  }
  if (!hit) return list
  if (hit.count === 1) return list.filter((r) => r !== hit)
  const users = hit.users.filter((u) => u.id !== me.id)
  return list.map((r) => (r === hit ? { ...r, count: r.count - 1, mine: false, users } : r))
}

/** Flips my `emoji` on the message: shown at once, then replaced by the server's result (or rolled back). */
export async function toggleReaction(messageId: string, current: ReactionDto[], emoji: ReactionEmoji) {
  const on = !current.find((r) => r.emoji === emoji)?.mine
  const user = useSession.getState().user
  put(messageId, applyMine(current, emoji, on, { id: user?.id ?? '', name: user?.name ?? '' }))
  try {
    put(messageId, (await setReaction(messageId, emoji, on)).reactions)
  } catch (e) {
    put(messageId, current)
    toast({ type: 'error', message: e instanceof Error ? e.message : '表情回应失败' })
  }
}
