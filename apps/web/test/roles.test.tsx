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
import { MASCOT_SCENES } from '../src/ui'

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

  it('act out all fourteen mascot states and moves their own way; 共字君 plays itself', () => {
    useWorkspace.setState({ bots: [bot('running', 'role-gong')] })
    expect(renderHook(() => useBotCostume('b1')).result.current).toBeUndefined()
    const roles = new Set<string>()
    for (const k of PERSONAS) {
      const c = roleCostume(k)
      roles.add(c.role)
      const scenes = new Set(MASCOT_SCENES.map((a) => c.scene(a, false)))
      expect(scenes.size).toBe(14)
      expect(decodeURIComponent(c.scene('carry', false))).toContain('@keyframes')
      expect(decodeURIComponent(c.scene('walk', false))).toContain('@keyframes')
      expect(decodeURIComponent(c.scene('hop', false))).toContain('@keyframes')
    }
    expect(roles.size).toBe(12)
  })

  it('uses the unified rig skeleton, expanded viewBox, centered spin pivot and isolated keyframes', () => {
    const parser = new DOMParser()
    for (const k of [...PERSONAS, ...AGENTS.map((a) => `agent-${a}` as const)]) {
      const c = roleCostume(k)
      for (const a of MASCOT_SCENES) {
        for (const words of [true, false]) {
          const svg = decodeURIComponent(c.scene(a, words).slice('data:image/svg+xml,'.length))
          expect(parser.parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull()
          expect(svg).toContain('viewBox="-22 -24 84 82"')
          expect(svg).toContain('.r-spin{transform-origin:20px 20px}')
          for (const bone of [
            'r-shadow',
            'r-root',
            'r-lean',
            'r-body',
            'r-spin',
            'r-la',
            'r-ra',
            'r-lf',
            'r-rf',
          ])
            expect(svg).toContain(bone)
          expect(svg).not.toMatch(/\b(NaN|undefined)\b/)
          const style = svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
          const kfs = [...style.matchAll(/@keyframes\s+([^\s{]+)/g)].map((m) => m[1])
          expect(new Set(kfs).size).toBe(kfs.length)
        }
      }
    }
  })

  it('spell out their words only at large sizes; small scenes degrade Chinese and long labels to symbols', () => {
    const texts = (src: string) =>
      [...decodeURIComponent(src).matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1] ?? '')
    const han = /\p{Script=Han}/u
    expect(texts(roleCostume('role-hammock').scene('ask', true))).toContain('为何?')
    expect(texts(roleCostume('role-hammock').scene('ask', false))).toContain('?')
    expect(texts(roleCostume('role-hammock').scene('raise', false))).toContain('!')
    expect(texts(roleCostume('role-hammock').scene('carry', false))).toContain('■')
    expect(texts(roleCostume('role-invert').scene('error', false))).toContain('!')
    expect(texts(roleCostume('role-invert').scene('type', false))).toContain('{ }')
    expect(texts(roleCostume('role-no').scene('error', false))).toContain('!')
    expect(texts(roleCostume('role-abacus').scene('error', false))).toContain('!')
    for (const k of [...PERSONAS, ...AGENTS.map((a) => `agent-${a}` as const)])
      for (const a of MASCOT_SCENES)
        for (const t of texts(roleCostume(k).scene(a, false))) {
          expect(t).not.toMatch(han)
          expect(t.length).toBeLessThanOrEqual(6)
        }
  })

  it('gives dark-bodied figures high-contrast ink and unique per-figure expressions', () => {
    const svgOf = (k: Parameters<typeof roleCostume>[0], a: (typeof MASCOT_SCENES)[number], words = true) =>
      decodeURIComponent(roleCostume(k).scene(a, words))
    // Dark figures fall back to high-contrast ink (#94a0b8 or light `from` tint) instead of dark `to`.
    expect(svgOf('agent-kimi', 'sleep')).toContain('fill="#94a0b8"')
    expect(svgOf('agent-opencode', 'sleep')).toContain('fill="#94a0b8"')
    expect(svgOf('role-sentry', 'sleep')).toContain('fill="#94a0b8"')
    expect(svgOf('role-braces', 'sleep')).toContain('fill="#a0a9b5"')
    // Claude hops via centered .r-spin rotation; steps error winks; sentry sleeps with wink.
    expect(svgOf('agent-claude', 'hop')).toContain('.r-spin{animation:')
    expect(svgOf('role-steps', 'error')).not.toBe(svgOf('role-steps', 'idle'))
    expect(svgOf('role-sentry', 'sleep')).toContain('ellipse')
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
      for (const a of MASCOT_SCENES) {
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
