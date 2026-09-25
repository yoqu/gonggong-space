import type { ReactionEmoji, ReactionsDto } from '@gonggong/protocol'
import { api } from '../../lib/api'

const path = (messageId: string, emoji: ReactionEmoji) =>
  `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`

/** Adds (`on`) or removes my reaction; returns the message's reactions afterwards. */
export const setReaction = (messageId: string, emoji: ReactionEmoji, on: boolean) =>
  on ? api.put<ReactionsDto>(path(messageId, emoji)) : api.del<ReactionsDto>(path(messageId, emoji))
