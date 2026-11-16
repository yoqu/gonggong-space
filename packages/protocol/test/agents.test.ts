import { describe, expect, it } from 'vitest'
import { AGENT_KINDS, AGENT_META, AgentKind, agentTakes, clientRunsAgent, protocolEn } from '../src/index.js'

describe('agent registry', () => {
  it('lists every agent kind', () => {
    expect(AGENT_KINDS).toEqual(AgentKind.options)
  })

  it('translates every Chinese text', () => {
    const texts = Object.values(AGENT_META).flatMap((m) =>
      [m.vendor, 'loginHint' in m ? m.loginHint : '', 'note' in m ? m.note : ''].filter((x) => /[一-鿿]/.test(x)),
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

  it('matches providers by protocol', () => {
    expect(agentTakes('claude', 'anthropic')).toBe(true)
    expect(agentTakes('claude', 'openai')).toBe(false)
    expect(agentTakes('pi', 'anthropic')).toBe(false)
  })
})
