import type { GroupDto } from '@gonggong/protocol'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '../src/app/Sidebar'
import { trackWindowFocus } from '../src/app/windowFocus'
import { Toolbar } from '../src/ui'

class FakeObserver {
  static all: FakeObserver[] = []
  targets: Element[] = []
  constructor(readonly cb: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(el: Element) {
    this.targets.push(el)
  }
  unobserve() {}
  disconnect() {
    this.targets = []
  }
  fire(isIntersecting: boolean) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry)
    this.cb(entries, this as unknown as IntersectionObserver)
  }
}

describe('Toolbar scroll edge', () => {
  beforeEach(() => {
    FakeObserver.all = []
    vi.stubGlobal('IntersectionObserver', FakeObserver)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the scroll edge only while its sentinel is out of view', () => {
    render(<Toolbar data-testid="bar">标题</Toolbar>)
    const bar = screen.getByTestId('bar')
    expect(bar.dataset.scrolled).toBeUndefined()
    const io = FakeObserver.all.find((o) => o.targets.length)
    expect(io).toBeDefined()
    act(() => io?.fire(false))
    expect(bar.dataset.scrolled).toBe('')
    act(() => io?.fire(true))
    expect(bar.dataset.scrolled).toBeUndefined()
  })

  it('follows an external scrolled state without its own sentinel', () => {
    const { rerender } = render(
      <Toolbar data-testid="bar" scrolled={false}>
        标题
      </Toolbar>,
    )
    expect(FakeObserver.all.some((o) => o.targets.length)).toBe(false)
    rerender(
      <Toolbar data-testid="bar" scrolled>
        标题
      </Toolbar>,
    )
    expect(screen.getByTestId('bar').dataset.scrolled).toBe('')
  })
})

describe('window focus', () => {
  it('marks the document inactive on blur and active again on focus', () => {
    const stop = trackWindowFocus()
    const root = document.documentElement
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(root.dataset.windowInactive).toBe('')
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(root.dataset.windowInactive).toBeUndefined()
    stop()
    window.dispatchEvent(new Event('blur'))
    expect(root.dataset.windowInactive).toBeUndefined()
  })
})

const group = (id: string, name: string, kind: GroupDto['kind'] = 'group'): GroupDto => ({
  id,
  teamId: 't1',
  name,
  kind,
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: null,
  members: [],
  botIds: [],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
})

describe('Sidebar rows', () => {
  it("tags Bot DMs with their workspace path, prefixes another group's unsent draft and keeps it off the open one", () => {
    sessionStorage.setItem('gonggong:draft:g1', '周报晚点补')
    sessionStorage.setItem('gonggong:draft:g2', '当前草稿')
    try {
      render(
        <MemoryRouter initialEntries={['/g/g2']}>
          <Sidebar
            groups={[
              group('g1', '前端'),
              group('g2', '后端'),
              {
                ...group('d1', '脚本实验', 'dm'),
                last: '设计师大象：**快速开始**',
                workspacePath: '/Users/wang/.gonggong/workspaces/t1/g1/d1/scripts',
              },
            ]}
            bots={[]}
            machines={[]}
          />
        </MemoryRouter>,
      )
      expect(within(screen.getByTestId('group-item-d1')).getByText('Bot')).toBeTruthy()
      expect(within(screen.getByTestId('group-item-g1')).queryByText('Bot')).toBeNull()
      const preview = (id: string) => screen.getByTestId(id).querySelector('.pn-conv__preview')?.textContent
      expect(preview('group-item-g1')).toBe('[草稿] 周报晚点补')
      expect(preview('group-item-g2')).toBe('0 人 · 分区模式')
      expect(preview('group-item-d1')).toBe('/Users/wang/.gonggo…es/t1/g1/d1/scripts')
    } finally {
      sessionStorage.clear()
    }
  })
})

describe('Sidebar selection capsule', () => {
  it('keeps aria-current on the open conversation and moves the capsule to it', () => {
    const saved = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.testid === 'group-item-g2' ? 60 : 0
      },
    })
    try {
      render(
        <MemoryRouter initialEntries={['/g/g2']}>
          <Sidebar
            groups={[group('g1', '前端'), group('g2', '后端'), group('d1', '王磊', 'dm')]}
            bots={[]}
            machines={[]}
          />
        </MemoryRouter>,
      )
      const active = screen.getByTestId('group-item-g2')
      expect(active.getAttribute('aria-current')).toBe('page')
      expect(screen.getByTestId('group-item-g1').getAttribute('aria-current')).toBeNull()
      const scroll = active.closest('.sidebar__scroll') as HTMLElement
      expect(scroll.style.getPropertyValue('--capsule-y')).toBe('60px')
    } finally {
      if (saved) Object.defineProperty(HTMLElement.prototype, 'offsetTop', saved)
    }
  })
})
