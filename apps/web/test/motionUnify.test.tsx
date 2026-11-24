import type { GroupDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/app/Sidebar'
import { Badge, Button, Disclosure, TabView, TextField } from '../src/ui'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty('--spring-smooth')
})

const reduce = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q === '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  }))

describe('Disclosure', () => {
  it('removes the body at once on collapse, so nothing in it stays reachable', () => {
    render(<Disclosure title="高级">硬件加速</Disclosure>)
    const head = screen.getByRole('button', { name: /高级/ })
    fireEvent.click(head)
    const body = document.getElementById(head.getAttribute('aria-controls') ?? '')!
    expect(body.isConnected).toBe(true)
    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(body.isConnected).toBe(false)
  })
})

describe('Button glyph', () => {
  it('replays the glyph pop when a string icon changes, not on other renders', () => {
    const { container, rerender } = render(<Button icon="copy">复制</Button>)
    const first = container.querySelector('.ui-btn__glyph')
    rerender(<Button icon="copy">复制 </Button>)
    expect(container.querySelector('.ui-btn__glyph')).toBe(first)
    rerender(<Button icon="check">已复制</Button>)
    expect(container.querySelector('.ui-btn__glyph')).not.toBe(first)
  })
})

describe('Badge', () => {
  it('keeps the last count on its way out when cleared', () => {
    const { container, rerender } = render(<Badge count={3} />)
    rerender(<Badge count={0} />)
    const badge = container.querySelector<HTMLElement>('.ui-badge')!
    expect(badge.dataset.state).toBe('closed')
    expect(badge.textContent).toContain('3')
    expect(badge.getAttribute('aria-hidden')).toBe('true')
    fireEvent.animationEnd(badge)
    expect(container.querySelector('.ui-badge')).toBeNull()
  })
})

describe('TabView and Field', () => {
  it('remounts the panel per tab so it fades in', () => {
    render(
      <TabView
        tabs={[
          { value: 'a', label: '概览', content: <p>甲</p> },
          { value: 'b', label: '详情', content: <p>乙</p> },
        ]}
      />,
    )
    const panel = screen.getByRole('tabpanel')
    fireEvent.click(screen.getByRole('tab', { name: '详情' }))
    expect(screen.getByRole('tabpanel')).not.toBe(panel)
    expect(screen.getByText('乙')).toBeTruthy()
  })

  it('replays the error fade when the error message changes', () => {
    const { container, rerender } = render(<TextField label="名称" error="不能为空" />)
    const note = container.querySelector('.ui-field__hint')
    rerender(<TextField label="名称" error="太长了" />)
    expect(container.querySelector('.ui-field__hint')).not.toBe(note)
  })
})

const group = (id: string, lastAt: string): GroupDto => ({
  id,
  teamId: 't1',
  name: id,
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 1,
  last: '',
  lastAt,
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
})

describe('Sidebar reorder glide', () => {
  /** Rows sit 40px apart in DOM order; the scroll box shows all of them. */
  function layout() {
    const animate = vi.fn()
    Element.prototype.animate = animate as unknown as Element['animate']
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const rows = [...document.querySelectorAll('.pn-conv[data-id]')]
      const i = rows.indexOf(this)
      const top = i < 0 ? 0 : i * 40
      return { top, bottom: i < 0 ? 1000 : top + 40, left: 0, right: 200, width: 200, height: 40 } as DOMRect
    })
    return animate
  }
  const ui = (list: GroupDto[]) => (
    <MemoryRouter>
      <Sidebar groups={list} bots={[]} machines={[]} loaded guide={false} />
    </MemoryRouter>
  )
  const a = group('g1', '2026-09-23T03:00:00.000Z')
  const b = group('g2', '2026-09-23T02:00:00.000Z')
  const bumped = { ...b, lastAt: '2026-09-23T04:00:00.000Z', lastSeq: 2 }

  it('glides rows a new message re-sorted from their old places', () => {
    reduce(false)
    document.documentElement.style.setProperty('--spring-smooth', '379ms ease-out')
    const animate = layout()
    const { rerender } = render(ui([a, b]))
    rerender(ui([a, bumped]))
    const moved = animate.mock.contexts.map((el) => (el as HTMLElement).dataset.id).sort()
    expect(moved).toEqual(['g1', 'g2'])
    const g2 =
      animate.mock.calls[animate.mock.contexts.findIndex((el) => (el as HTMLElement).dataset.id === 'g2')]!
    expect(g2[0]).toEqual([{ translate: '0 40px' }, { translate: '0 0' }])
  })

  it('stays put under reduced motion', () => {
    reduce(true)
    document.documentElement.style.setProperty('--spring-smooth', '379ms ease-out')
    const animate = layout()
    const { rerender } = render(ui([a, b]))
    rerender(ui([a, bumped]))
    expect(animate).not.toHaveBeenCalled()
  })
})

describe('Spinner', () => {
  it('waits a moment before showing, so quick work never flashes it', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/ui/display.css', 'utf8')
    const start = css.indexOf('.ui-spinner {')
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/ui-fade-in var\(--fade-in\) 300ms backwards/)
  })

  it('shows at once inside a loading button, so a press always answers', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/ui/controls.css', 'utf8')
    const start = css.indexOf('.ui-btn--loading .ui-spinner {')
    expect(css.slice(start, css.indexOf('}', start))).toMatch(/animation: ui-spin 1s steps\(8\) infinite;/)
  })
})
