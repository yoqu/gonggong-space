import { create } from 'zustand'

/** A name to @ in a group's composer, handed over from a hover card's @TA; the composer of that group takes it. */
export const useMention = create<{
  pending: { groupId: string; name: string; threadRootId?: string } | null
}>(() => ({
  pending: null,
}))

/** `threadRootId`: the composer of that thread takes it instead of the main one. */
export const mentionInChat = (groupId: string, name: string, threadRootId?: string) =>
  useMention.setState({ pending: { groupId, name, threadRootId } })

/** `draft` already @s `name` as a whole mention. */
export const mentions = (draft: string, name: string) =>
  new RegExp(`(^|\\s)@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`).test(draft)
