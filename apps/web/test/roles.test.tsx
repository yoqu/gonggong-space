import { AgentKind, BOT_AVATARS, type BotDto } from '@gonggong/protocol'
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import {
  avatarSrc,
  BotAvatar,
  botFace,
  ROLES,
  RolePicker,
  roleCostume,
  useBotCostume,
} from '../src/features/bots/avatars'
import { MASCOT_ACTIONS } from '../src/ui'

const PERSONAS = BOT_AVATARS.filter((k) => k !== 'role-gong')

const bot = (
  presence: BotDto['presence'],
  avatar: BotDto['avatar'] = 'role-invert',
  more: Partial<BotDto> = {},
) =>
  ({ id: 'b1', name: '反推', agentKind: 'claude', avatar, followAgent: false, presence, ...more }) as BotDto

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
    const { getByRole } = render(<RolePicker value="role-gong" agent="claude" onChange={() => {}} />)
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

const AGENTS = AgentKind.options

describe('agent figures', () => {
  const wellFormed = (src: string) => {
    const svg = decodeURIComponent(src.slice('data:image/svg+xml,'.length))
    return new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror') === null
  }

  it('draw every agent, each its own, as a well-formed avatar and a full set of scenes', () => {
    const tiles = new Set(AGENTS.map((k) => avatarSrc(`agent-${k}`)))
    expect(tiles.size).toBe(AGENTS.length)
    for (const k of AGENTS) {
      expect(wellFormed(avatarSrc(`agent-${k}`, true))).toBe(true)
      const c = roleCostume(`agent-${k}`)
      for (const a of MASCOT_ACTIONS) {
        expect(wellFormed(c.scene(a, true))).toBe(true)
        expect(wellFormed(c.scene(a, false))).toBe(true)
      }
    }
  })

  it('dress a bot that follows its agent in that agent, and change with it', () => {
    const follows = bot('online', 'role-gong', { followAgent: true, avatarUrl: null })
    expect(botFace(follows)).toBe(avatarSrc('agent-claude'))
    expect(botFace({ ...follows, agentKind: 'deepseek' })).toBe(avatarSrc('agent-deepseek'))
    expect(botFace({ ...follows, avatarUrl: '/api/avatars/x' })).toBe('/api/avatars/x')
    useWorkspace.setState({ bots: [{ ...follows, agentKind: 'codex' }] })
    expect(renderHook(() => useBotCostume('b1')).result.current?.role).toBe('agent-codex')
  })

  it('lead the picker with 跟随 Agent, drawn as the current agent', () => {
    let picked = ''
    const { container, rerender } = render(
      <RolePicker value="role-agent" agent="gemini" onChange={(v) => (picked = v)} />,
    )
    const first = screen.getAllByRole('radio')[0] as HTMLInputElement
    expect(first.checked).toBe(true)
    expect(first.getAttribute('aria-label')).toBe('跟随 Agent · Gemini CLI')
    expect(container.querySelector('.role-card__still')?.getAttribute('src')).toBe(avatarSrc('agent-gemini'))
    rerender(<RolePicker value="role-gong" agent="pi" onChange={(v) => (picked = v)} />)
    expect(container.querySelector('.role-card__still')?.getAttribute('src')).toBe(avatarSrc('agent-pi'))
    fireEvent.click(screen.getByRole('radio', { name: /跟随 Agent/ }))
    expect(picked).toBe('role-agent')
  })
})
