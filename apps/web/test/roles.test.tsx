import { BOT_AVATARS, type BotDto } from '@gonggong/protocol'
import { render, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import {
  avatarSrc,
  BotAvatar,
  ROLES,
  RolePicker,
  roleCostume,
  useBotCostume,
} from '../src/features/bots/avatars'
import { MASCOT_ACTIONS } from '../src/ui'

const PERSONAS = BOT_AVATARS.filter((k) => k !== 'role-gong')

const bot = (presence: BotDto['presence'], avatar: BotDto['avatar'] = 'role-invert') =>
  ({ id: 'b1', name: '反推', agentKind: 'claude', avatar, presence }) as BotDto

describe('bot characters', () => {
  it('start with 共字君, then twelve blended personalities, each with its mix and one line', () => {
    expect(BOT_AVATARS[0]).toBe('role-gong')
    expect(ROLES['role-gong'].name).toBe('共字君')
    expect(PERSONAS).toHaveLength(12)
    for (const k of PERSONAS) {
      expect(ROLES[k].mix).toMatch(/ × /)
      expect(ROLES[k].line.length).toBeGreaterThan(8)
    }
  })

  it('list each trait on its own line in the picker, so no line ends in a dangling ×', () => {
    const { getByRole } = render(<RolePicker value="role-gong" onChange={() => {}} />)
    const title = getByRole('radio', { name: /铁码/ }).closest('label')?.querySelector('.role-card__title')
    expect([...(title?.children ?? [])].map((s) => s.textContent)).toEqual(['毒舌', '洁癖', '实干'])
  })

  it('animate only in the live avatar', () => {
    for (const k of BOT_AVATARS) {
      expect(decodeURIComponent(avatarSrc(k))).not.toContain('@keyframes')
      expect(decodeURIComponent(avatarSrc(k, true))).toContain('@keyframes')
    }
  })

  it('play their signature move while the bot is running', () => {
    useWorkspace.setState({ bots: [bot('running')] })
    const { container, rerender } = render(<BotAvatar id="b1" name="反推" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-invert', true))
    useWorkspace.setState({ bots: [bot('online')] })
    rerender(<BotAvatar id="b1" name="反推" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(avatarSrc('role-invert'))
  })

  it('act out all twelve mascot actions their own way; 共字君 plays itself', () => {
    useWorkspace.setState({ bots: [bot('running', 'role-gong')] })
    expect(renderHook(() => useBotCostume('b1')).result.current).toBeUndefined()
    const roles = new Set<string>()
    for (const k of PERSONAS) {
      const c = roleCostume(k)
      roles.add(c.role)
      const scenes = new Set(MASCOT_ACTIONS.map((a) => c.scene(a, false)))
      expect(scenes.size).toBe(12)
      expect(decodeURIComponent(c.scene('carry', false))).toContain('@keyframes')
    }
    expect(roles.size).toBe(12)
  })

  it('spell out their words only at large sizes; small scenes keep to symbols', () => {
    const texts = (src: string) =>
      [...decodeURIComponent(src).matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1] ?? '')
    const han = /\p{Script=Han}/u
    expect(texts(roleCostume('role-hammock').scene('ask', true))).toContain('为何?')
    for (const k of PERSONAS)
      for (const a of MASCOT_ACTIONS)
        for (const t of texts(roleCostume(k).scene(a, false))) {
          expect(t).not.toMatch(han)
          expect(t.length).toBeLessThanOrEqual(2)
        }
  })
})
