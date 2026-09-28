import { BOT_AVATARS, type BotDto } from '@gonggong/protocol'
import { render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { avatarSrc, BotAvatar, ROLES, roleCostume, useBotCostume } from '../src/features/bots/avatars'

const FUNCTIONS = BOT_AVATARS.filter((k) => k !== 'role-gong')

const bot = (presence: BotDto['presence']) =>
  ({ id: 'b1', name: '找茬', agentKind: 'claude', avatar: 'role-qa', presence }) as BotDto

describe('role characters', () => {
  it('start with 共字君, then the ten functions of a software team, each with a temperament', () => {
    expect(BOT_AVATARS[0]).toBe('role-gong')
    expect(ROLES['role-gong'].name).toBe('共字君')
    expect(FUNCTIONS).toHaveLength(10)
    for (const k of FUNCTIONS) {
      expect(ROLES[k].title).toMatch(/经理|师$/)
      expect(ROLES[k].trait.length).toBeGreaterThan(4)
    }
  })

  it('animate only in the live variant', () => {
    for (const k of BOT_AVATARS) {
      expect(decodeURIComponent(avatarSrc(k))).not.toContain('@keyframes')
      expect(decodeURIComponent(avatarSrc(k, true))).toContain('@keyframes')
    }
  })

  it('play their signature move while the bot is running', () => {
    useWorkspace.setState({ bots: [bot('running')] })
    const { container, rerender } = render(<BotAvatar id="b1" name="找茬" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-qa', true))
    useWorkspace.setState({ bots: [bot('online')] })
    rerender(<BotAvatar id="b1" name="找茬" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-qa'))
  })

  it('dress the chat mascot as the role; 共字君 plays itself', () => {
    useWorkspace.setState({ bots: [{ ...bot('running'), avatar: 'role-gong' }] })
    const { result } = renderHook(() => useBotCostume('b1'))
    expect(result.current).toBeUndefined()
    for (const k of FUNCTIONS) {
      const c = roleCostume(k)
      expect([c.head, c.headLive]).toEqual([avatarSrc(k), avatarSrc(k, true)])
      expect(c.eyes).toHaveLength(2)
    }
  })
})
