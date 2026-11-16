import { AGENT_KINDS, AGENT_META, type MachineDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AGENT_FIGURES } from '../src/features/bots/agentFigures'
import { clientRuns, machineAgents } from '../src/features/bots/model'
import { AgentIcon } from '../src/ui'

describe('AgentIcon', () => {
  it('draws each agent mark in white on its brand gradient, named for screen readers', () => {
    for (const kind of AGENT_KINDS) {
      const { unmount } = render(<AgentIcon kind={kind} />)
      const icon = screen.getByRole('img', { name: AGENT_META[kind].name })
      expect(icon.style.width).toBe('20px')
      expect(icon.style.background).toContain('linear-gradient')
      const paths = icon.querySelectorAll('path')
      expect(paths).toHaveLength(AGENT_META[kind].mark.length)
      for (const p of paths) expect(p.getAttribute('fill')).toBe('#fff')
      unmount()
    }
  })

  it('takes a size', () => {
    render(<AgentIcon kind="codex" size={32} />)
    const icon = screen.getByRole('img', { name: 'Codex' })
    expect(icon.style.width).toBe('32px')
    expect(icon.style.height).toBe('32px')
  })
})

describe('agent registry in the web app', () => {
  it('figures wear the registry brand colours and names', () => {
    for (const kind of AGENT_KINDS) {
      expect(AGENT_FIGURES[kind].name).toBe(AGENT_META[kind].name)
      expect(AGENT_FIGURES[kind].from).toBe(AGENT_META[kind].color.from)
      expect(AGENT_FIGURES[kind].to).toBe(AGENT_META[kind].color.to)
    }
  })

  const machine = (features: string[], reported: string[] = []) =>
    ({ features, agents: reported.map((kind) => ({ kind, available: true })) }) as unknown as MachineDto

  it('a client runs an agent it has the feature for, or has reported', () => {
    expect(clientRuns(machine([]), 'claude')).toBe(true)
    expect(clientRuns(machine([]), 'gemini')).toBe(false)
    expect(clientRuns(machine(['gemini']), 'gemini')).toBe(true)
    expect(clientRuns(machine([], ['gemini']), 'gemini')).toBe(true)
    expect(clientRuns(null, 'antigravity')).toBe(true)
    expect(machineAgents(machine(['pi']))).toEqual(['claude', 'codex', 'pi'])
  })
})
