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

/** The reply bar under a thread root: who took part, how many replies, and whether a bot is still at it. */
export function useThreadSummary(m: MessageDto): ThreadSummaryProps | undefined {
  const live = useThreadLive((s) => s.roots.has(m.id))
  const inThread = useContext(InThread)
  // Keyed by content: groups and bots are replaced with equal content often, and rows must stay memoized.
  const peopleKey = useWorkspace((s) => {
    if (!m.thread) return '[]'
    const members = s.groups.find((g) => g.id === m.groupId)?.members
    return JSON.stringify(
      m.thread.participants.flatMap((id): AvatarProps[] => {
        const member = members?.find((x) => x.userId === id)
        if (member) return [{ name: member.name, src: member.avatar ?? undefined }]
        const bot = s.bots.find((b) => b.id === id)
        return bot ? [{ name: bot.name, src: botFace(bot), shape: 'square' }] : []
      }),
    )
  })
  const people = useMemo(() => JSON.parse(peopleKey) as AvatarProps[], [peopleKey])
  if (inThread || m.threadRootId || (!m.thread && !live)) return undefined
  return {
    count: m.thread?.replyCount ?? 0,
    people,
    lastTime: m.thread ? ago(m.thread.lastReplyAt) : undefined,
    extra: live ? (
      <Tag tone="blue" icon="bolt">
        {t('Bot 回复中')}
      </Tag>
    ) : undefined,
    onClick: () => openThread(m.id),
  }
}
