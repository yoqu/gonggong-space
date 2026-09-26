import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { Welcome } from '../src/app/Welcome'
import { runMascot } from '../src/features/runs/mascot'
import { MASCOT_ACTIONS, Mascot } from '../src/ui'

describe('Mascot', () => {
  it('draws 共字君 in the requested action with its prop', () => {
    render(<Mascot action="carry" label="执行工具" />)
    const art = screen.getByRole('img', { name: '执行工具' })
    expect(art.getAttribute('data-action')).toBe('carry')
    expect(art.querySelector('.ui-mascot__prop--carry')).toBeTruthy()
  })

  it('is decorative without a label and crops to the head for avatars', () => {
    const { container } = render(<Mascot crop="head" size={32} />)
    const svg = container.querySelector('svg') as SVGSVGElement
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('viewBox')).not.toBe('0 0 120 120')
    expect(svg.querySelector('.ui-mascot__prop')).toBeNull()
  })

  it('keeps gradient ids unique per instance', () => {
    const { container } = render(
      <>
        <Mascot />
        <Mascot />
      </>,
    )
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every action', () => {
    expect(MASCOT_ACTIONS).toEqual([
      'idle',
      'wave',
      'think',
      'ask',
      'raise',
      'wait',
      'type',
      'carry',
      'run',
      'done',
      'error',
      'sleep',
    ])
  })
})

describe('runMascot', () => {
  it('maps what a run is doing to an action', () => {
    expect(runMascot('running', true, '')).toEqual({ action: 'type', label: '正在回复' })
    expect(runMascot('running', false, '运行 pnpm test')).toEqual({ action: 'carry', label: '执行工具' })
    expect(runMascot('running', false, '')).toEqual({ action: 'run', label: '正在工作' })
    expect(runMascot('queued', false, '该 Bot 忙，排第 1')).toEqual({ action: 'wait', label: '排队中' })
    expect(runMascot('awaiting_approval', false, '等待审批：x')).toEqual({
      action: 'raise',
      label: '等待审批',
    })
    expect(runMascot('awaiting_answer', false, '等待回答')).toEqual({ action: 'ask', label: '等待回答' })
    expect(runMascot('completed', false, '')).toBeNull()
  })
})

describe('splash', () => {
  it('shows 共字君 running while the session connects', () => {
    useSession.setState({ user: null, status: 'loading' })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    const splash = screen.getByRole('status')
    expect(splash.querySelector('.ui-mascot')?.getAttribute('data-action')).toBe('run')
    expect(splash.textContent).toContain('正在连接')
  })
})

describe('welcome', () => {
  it('greets a newcomer with 共字君 waving', () => {
    const noop = () => {}
    render(
      <Welcome
        name="王磊"
        bound={false}
        hasBot={false}
        onBindMachine={noop}
        onNewBot={noop}
        onNewGroup={noop}
      />,
    )
    const welcome = screen.getByRole('region', { name: '开始使用' })
    expect(welcome.querySelector('.ui-mascot')?.getAttribute('data-action')).toBe('wave')
  })
})
