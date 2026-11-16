import { describe, expect, it } from 'vitest'
import {
  AGENT_KINDS,
  AGENT_META,
  AgentKind,
  agentTakes,
  clientRunsAgent,
  DaemonFeature,
  protocolEn,
} from '../src/index.js'

describe('agent registry', () => {
  it('lists every agent kind', () => {
    expect(AGENT_KINDS).toEqual(AgentKind.options)
  })

  it('translates every Chinese text', () => {
    const texts = Object.values(AGENT_META).flatMap((m) =>
      [m.vendor, 'loginHint' in m ? m.loginHint : '', 'note' in m ? m.note : ''].filter((x) =>
        /[一-鿿]/.test(x),
      ),
    )
    for (const x of texts) expect(protocolEn).toHaveProperty([x])
  })

  it('own-login agents take no provider', () => {
    for (const m of Object.values(AGENT_META)) expect(m.login === 'own').toBe(m.protocols.length === 0)
  })

  it('gates later agents on their daemon feature', () => {
    expect(clientRunsAgent([], 'claude')).toBe(true)
    expect(clientRunsAgent([], 'gemini')).toBe(false)
    expect(clientRunsAgent(['gemini'], 'gemini')).toBe(true)
  })

  it('gates each agent on a known daemon feature', () => {
    for (const m of Object.values(AGENT_META))
      if ('feature' in m) expect(DaemonFeature.options).toContain(m.feature)
  })

  it('adds the third-wave agents, each speaking ACP itself', () => {
    const wave = ['opencode', 'qwen', 'kimi', 'goose', 'copilot'] as const
    expect(AGENT_KINDS.slice(-5)).toEqual(wave)
    for (const k of wave) {
      const m = AGENT_META[k]
      expect([m.adapter, m.feature]).toEqual(['cli', k])
      expect(m.mark.length).toBeGreaterThan(0)
    }
    expect(AGENT_KINDS.map((k) => AGENT_META[k].bin).slice(-5)).toEqual([
      'opencode',
      'qwen',
      'kimi',
      'goose',
      'copilot',
    ])
    expect(AGENT_META.goose.install).toBe('command')
    expect(AGENT_META.opencode).toMatchObject({ install: 'managed', login: 'own', protocols: [] })
    expect(AGENT_META.opencode.loginHint).toContain('opencode auth login')
    expect(AGENT_META.qwen.protocols).toEqual(['openai'])
    for (const k of ['kimi', 'goose', 'copilot'] as const)
      expect(AGENT_META[k].protocols).toEqual(['anthropic', 'openai'])
  })

  it('matches providers by protocol', () => {
    expect(agentTakes('claude', 'anthropic')).toBe(true)
    expect(agentTakes('claude', 'openai')).toBe(false)
    expect(agentTakes('pi', 'anthropic')).toBe(false)
  })
})
