import type { MessageDto } from '@gonggong/protocol'
import { createContext, useContext, useMemo } from 'react'
import { create } from 'zustand'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { type AvatarProps, Tag, type ThreadSummaryProps } from '../../ui'
import { botFace } from '../bots/avatars'
import { openThread } from './thread'

/** Roots of the shown timeline whose thread has a bot at work (plan 话题); kept by ChatView. */
export const useThreadLive = create<{ roots: ReadonlySet<string> }>()(() => ({ roots: new Set() }))
/** Inside its own thread panel a root needs no reply bar. */
export const InThread = createContext(false)

/** Avatars of a thread's participants (user or bot ids) as the group and workspace know them. */
export function useThreadPeople(groupId: string, participants: string[] | undefined): AvatarProps[] {
  // Keyed by content: groups and bots are replaced with equal content often, and rows must stay memoized.
  const peopleKey = useWorkspace((s) => {
    if (!participants) return '[]'
    const members = s.groups.find((g) => g.id === groupId)?.members
    return JSON.stringify(
      participants.flatMap((id): AvatarProps[] => {
        const member = members?.find((x) => x.userId === id)
        if (member) return [{ name: member.name, src: member.avatar ?? undefined }]
        const bot = s.bots.find((b) => b.id === id)
        return bot ? [{ name: bot.name, src: botFace(bot), shape: 'square' }] : []
      }),
    )
  })
  return useMemo(() => JSON.parse(peopleKey) as AvatarProps[], [peopleKey])
}

/** The reply bar under a thread root: who took part, how many replies, and whether a bot is still at it. */
export function useThreadSummary(m: MessageDto): ThreadSummaryProps | undefined {
  const live = useThreadLive((s) => s.roots.has(m.id))
  const inThread = useContext(InThread)
  const people = useThreadPeople(m.groupId, m.thread?.participants)
  if (inThread || m.threadRootId || (!m.thread && !live)) return undefined
  return {
    count: m.thread?.replyCount ?? 0,
    people,
    unread: !!m.thread?.unread,
    lastTime: m.thread ? ago(m.thread.lastReplyAt) : undefined,
    extra: live ? (
      <Tag tone="blue" icon="bolt">
        {t('Bot 回复中')}
      </Tag>
    ) : undefined,
    onClick: () => openThread(m.id),
  }
}
