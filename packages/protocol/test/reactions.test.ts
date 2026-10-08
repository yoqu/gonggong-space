import { describe, expect, it } from 'vitest'
import { ReactionEmoji, UserCardDto, WebEvent } from '../src/index.js'

describe('reactions', () => {
  it('accepts only the fixed emoji set', () => {
    expect(ReactionEmoji.safeParse('👍').success).toBe(true)
    expect(ReactionEmoji.safeParse('❤️').success).toBe(true)
    expect(ReactionEmoji.safeParse('🍕').success).toBe(false)
    expect(ReactionEmoji.safeParse('<script>').success).toBe(false)
  })

  it('parses the realtime event', () => {
    const e = {
      t: 'message.reactions',
      groupId: 'g1',
      messageId: 'm1',
      reactions: [
        {
          emoji: '🎉',
          count: 2,
          mine: false,
          users: [
            { id: 'u1', name: '王磊' },
            { id: 'u2', name: '李建国' },
          ],
        },
      ],
    }
    expect(WebEvent.parse(e)).toEqual(e)
    expect(WebEvent.safeParse({ ...e, reactions: [{ ...e.reactions[0], count: 0 }] }).success).toBe(false)
    expect(WebEvent.safeParse({ ...e, reactions: [{ ...e.reactions[0], users: ['王磊'] }] }).success).toBe(
      false,
    )
  })

  it('user card carries only non-sensitive fields', () => {
    const card = {
      id: 'u1',
      name: '王磊',
      account: 'wang',
      avatar: null,
      role: 'member',
      groupAdmin: true,
      online: false,
    }
    expect(UserCardDto.parse({ ...card, passwordHash: 'x', mustChangePassword: true })).toEqual(card)
  })
})
