import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { Welcome } from '../src/app/Welcome'
import { runMascot } from '../src/features/runs/mascot'
import { MASCOT_ACTIONS, Mascot, type MascotCostume } from '../src/ui'

const tester: MascotCostume = {
  role: 't',
  scene: (action, words) => `data:image/svg+xml,${action}${words ? '+words' : ''}`,
}

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

  it('drops props below 48px where they would blur into specks', () => {
    const { container, rerender } = render(<Mascot action="think" size={36} />)
    expect(container.querySelector('svg')?.classList.contains('ui-mascot--compact')).toBe(true)
    rerender(<Mascot action="think" size={48} />)
    expect(container.querySelector('svg')?.classList.contains('ui-mascot--compact')).toBe(false)
  })

  it('turns the jade into a status light when small', () => {
    const { container } = render(<Mascot action="raise" size={32} />)
    expect(container.querySelector('.ui-mascot__gem')).toBeTruthy()
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

describe('costume', () => {
  it("plays a bot's character: its own scene per action, tagged with its role", () => {
    const { container, rerender } = render(<Mascot action="carry" size={32} costume={tester} />)
    const art = container.querySelector('.ui-mascot') as HTMLImageElement
    expect(art.tagName).toBe('IMG')
    expect(art.getAttribute('src')).toBe('data:image/svg+xml,carry')
    expect([art.dataset.role, art.dataset.action]).toEqual(['t', 'carry'])
    expect(art.getAttribute('aria-hidden')).toBe('true')
    rerender(<Mascot action="done" size={32} costume={tester} label="完成" />)
    expect(container.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('完成')
    expect(container.querySelector('.ui-mascot')?.getAttribute('src')).toBe('data:image/svg+xml,done')
    rerender(<Mascot action="ask" size={96} costume={tester} />)
    expect(container.querySelector('.ui-mascot')?.getAttribute('src')).toBe('data:image/svg+xml,ask+words')
  })
})

describe('runMascot', () => {
  it('maps what a run is doing to an action', () => {
    // Only the status and streaming pick the move, so fast-changing step text never flickers it.
    expect(runMascot('running', true)).toEqual({ action: 'type', label: '正在回复' })
    expect(runMascot('running', false)).toEqual({ action: 'carry', label: '正在工作' })
    expect(runMascot('queued', false)).toEqual({ action: 'wait', label: '排队中' })
    expect(runMascot('awaiting_approval', false)).toEqual({ action: 'raise', label: '等待审批' })
    expect(runMascot('awaiting_answer', false)).toEqual({ action: 'ask', label: '等待回答' })
    expect(runMascot('completed', false)).toBeNull()
  })
})

describe('splash', () => {
  it('shows 共字君 waiting while the session connects', () => {
    useSession.setState({ user: null, status: 'loading' })
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    const splash = screen.getByRole('status')
    expect(splash.querySelector('.ui-mascot')?.getAttribute('data-action')).toBe('wait')
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
