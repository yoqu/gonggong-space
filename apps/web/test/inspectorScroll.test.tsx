import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'
import { InspectorPortal, InspectorSlot, useInspector } from '../src/app/inspector'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { Workbench } from '../src/features/workbench/Workbench'

vi.mock('../src/features/workbench/tabs/WebTab', () => ({
  WebTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useWebTabMeta: (t: { previewId: string }) => ({ icon: 'desktop', title: `网页 ${t.previewId}` }),
}))

const web = (id: string): WorkbenchTab => ({ kind: 'web', previewId: id, path: '/' })
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })

function resetSubtreeScroll(node: Node) {
  if (!(node instanceof HTMLElement)) return
  node.scrollTop = 0
  node.scrollLeft = 0
  for (const child of node.querySelectorAll<HTMLElement>('*')) {
    child.scrollTop = 0
    child.scrollLeft = 0
  }
}

/**
 * jsdom keeps scrollTop across DOM detach/re-parent, whereas Chromium/WebKit/Gecko reset every
 * scrollable descendant's scrollTop and scrollLeft to 0 whenever a node is removed or moved via appendChild.
 */
function simulateBrowserScrollReset() {
  const origRemove = Node.prototype.removeChild
  const origAppend = Node.prototype.appendChild
  const removeSpy = vi.spyOn(Node.prototype, 'removeChild').mockImplementation(function <T extends Node>(
    this: Node,
    child: T,
  ): T {
    const res = origRemove.call(this, child) as T
    resetSubtreeScroll(child)
    return res
  })
  const appendSpy = vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <T extends Node>(
    this: Node,
    child: T,
  ): T {
    const moving = child.parentNode !== null && child.parentNode !== this
    const res = origAppend.call(this, child) as T
    if (moving) resetSubtreeScroll(child)
    return res
  })
  return () => {
    removeSpy.mockRestore()
    appendSpy.mockRestore()
  }
}

let restoreDom: (() => void) | null = null

beforeEach(() => {
  localStorage.clear()
  setWidth(1440)
  useWorkbench.setState({
    groupId: 'g1',
    open: true,
    mode: 'split',
    previous: 'split',
    benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
  })
  act(() => useInspector.getState().open('thread', 'root-1'))
  restoreDom = simulateBrowserScrollReset()
})

afterEach(() => {
  restoreDom?.()
  restoreDom = null
  act(() => useInspector.getState().close())
  localStorage.clear()
})

function setMetrics(
  el: HTMLElement,
  m: { scrollHeight: number; clientHeight: number; clientWidth?: number },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: m.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: m.clientHeight })
  if (m.clientWidth !== undefined) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: m.clientWidth })
  }
}

function renderWithThread(benchOpen: boolean) {
  const tree = (open: boolean) => (
    <MemoryRouter>
      <ChatLayout
        sidebar={<div>完整会话列表</div>}
        workbench={open ? <Workbench /> : undefined}
        rail={<InspectorSlot />}
        railOpen
        railKind="thread"
        mobileView="chat"
      >
        <InspectorPortal view="thread">
          <div data-testid="thread-scroll">
            <div data-msg-id="m1">第一条回复</div>
            <div data-msg-id="m2">第二条回复</div>
            <div data-msg-id="m3">第三条回复</div>
          </div>
        </InspectorPortal>
        <div>聊天内容</div>
      </ChatLayout>
    </MemoryRouter>
  )
  const view = render(tree(benchOpen))
  return {
    rerenderBench: (open: boolean) => view.rerender(tree(open)),
    scroller: () => screen.getByTestId('thread-scroll'),
  }
}

describe('inspector scroll preservation across workbench transitions', () => {
  it('keeps the thread scroll position when closing the right-hand workbench tab', () => {
    const { rerenderBench, scroller } = renderWithThread(true)
    const el = scroller()
    setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 400 })
    el.scrollTop = 640
    el.scrollLeft = 12
    fireEvent.scroll(el)

    rerenderBench(false)

    expect(scroller()).toBe(el)
    expect(el.scrollTop).toBe(640)
    expect(el.scrollLeft).toBe(12)
  })

  it('keeps the thread scroll position when opening the workbench tab (even without a prior scroll event)', () => {
    const { rerenderBench, scroller } = renderWithThread(false)
    const el = scroller()
    setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 400 })
    // Programmatic scroll (e.g. jump to a message) before any scroll event has fired.
    el.scrollTop = 520

    rerenderBench(true)

    expect(scroller()).toBe(el)
    expect(el.scrollTop).toBe(520)
  })

  it('keeps the thread scroll position when railTakesChat switches dock position on narrow desktop', () => {
    setWidth(1600)
    const { rerenderBench, scroller } = renderWithThread(true)
    const el = scroller()
    setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 400 })
    el.scrollTop = 780
    fireEvent.scroll(el)
    expect(screen.getByRole('complementary', { name: '侧栏' }).className).not.toContain('chat__dock--in-chat')

    // Shrink window so railTakesChat flips true (dock moves before the splitter).
    act(() => {
      setWidth(1100)
      window.dispatchEvent(new Event('resize'))
    })
    rerenderBench(true)
    expect(screen.getByRole('complementary', { name: '侧栏' }).className).toContain('chat__dock--in-chat')
    expect(el.scrollTop).toBe(780)

    // Widen back so railTakesChat flips false.
    act(() => {
      setWidth(1600)
      window.dispatchEvent(new Event('resize'))
    })
    rerenderBench(true)
    expect(screen.getByRole('complementary', { name: '侧栏' }).className).not.toContain('chat__dock--in-chat')
    expect(el.scrollTop).toBe(780)
  })

  it('keeps the thread scroll position on phones when workbench opens over it and later closes', () => {
    setWidth(390)
    const { rerenderBench, scroller } = renderWithThread(false)
    const el = scroller()
    setMetrics(el, { scrollHeight: 1800, clientHeight: 650, clientWidth: 390 })
    el.scrollTop = 430
    fireEvent.scroll(el)

    rerenderBench(true)
    rerenderBench(false)

    expect(scroller()).toBe(el)
    expect(el.scrollTop).toBe(430)
  })

  it('stays pinned to the bottom when the thread was at the bottom and reflows taller', () => {
    const { rerenderBench, scroller } = renderWithThread(false)
    const el = scroller()
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => (el.closest('.chat__dock') ? 2100 : 1600),
    })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => (el.closest('.chat__dock') ? 380 : 520),
    })
    el.scrollTop = 1000
    fireEvent.scroll(el)

    rerenderBench(true)
    expect(el.scrollTop).toBe(2100)
  })

  it('keeps scroll at top when user intentionally scrolled back to 0', () => {
    const { rerenderBench, scroller } = renderWithThread(true)
    const el = scroller()
    setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 400 })
    el.scrollTop = 500
    fireEvent.scroll(el)
    el.scrollTop = 0
    fireEvent.scroll(el)

    rerenderBench(false)
    expect(el.scrollTop).toBe(0)
  })

  it('anchors the visible message when inspector width changes across dock/undock', () => {
    const { rerenderBench, scroller } = renderWithThread(true)
    const el = scroller()
    const m2 = screen.getByText('第二条回复')
    setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 380 })
    el.scrollTop = 500
    const m2Top = 120
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 700,
      height: 600,
      left: 0,
      right: 380,
      width: 380,
      x: 0,
      y: 100,
      toJSON: () => {},
    })
    vi.spyOn(m2, 'getBoundingClientRect').mockImplementation(() => ({
      top: m2Top,
      bottom: m2Top + 80,
      height: 80,
      left: 0,
      right: 380,
      width: 380,
      x: 0,
      y: m2Top,
      toJSON: () => {},
    }))
    vi.spyOn(screen.getByText('第一条回复'), 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 90,
      height: 80,
      left: 0,
      right: 380,
      width: 380,
      x: 0,
      y: 10,
      toJSON: () => {},
    })
    fireEvent.scroll(el)

    // Before undocking, simulate wider layout where m2 shifted up by 60px after reflow.
    // Note: width changes only after re-parenting; emulate via getter checking parent class.
    Object.defineProperty(el, 'clientWidth', {
      configurable: true,
      get: () => (el.closest('.chat__dock') ? 380 : 520),
    })
    // In undocked wider layout, before anchor compensation m2 renders 60px higher (top = 60 instead of 120).
    vi.spyOn(m2, 'getBoundingClientRect').mockImplementation(() => {
      const base = el.closest('.chat__dock') ? 120 : 60 + (500 - el.scrollTop)
      return {
        top: base,
        bottom: base + 80,
        height: 80,
        left: 0,
        right: 520,
        width: 520,
        x: 0,
        y: base,
        toJSON: () => {},
      }
    })

    rerenderBench(false)
    // m2 was 20px below container top (120 - 100). Wider layout put it at 60 (-40px), so scrollTop adjusts by -60 => 440.
    expect(el.scrollTop).toBe(440)
  })

  it('re-applies scroll in rAF if synchronous layout was not ready, and cancels rAF on user interaction', () => {
    let rafCb: FrameRequestCallback | null = null
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb
      return 42
    })
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      rafCb = null
    })
    try {
      const { rerenderBench, scroller } = renderWithThread(true)
      const el = scroller()
      setMetrics(el, { scrollHeight: 2000, clientHeight: 600, clientWidth: 400 })
      el.scrollTop = 680
      fireEvent.scroll(el)

      rerenderBench(false)
      // Simulate synchronous clamp to 0 before first paint; rAF restores it once layout settles.
      el.scrollTop = 0
      expect(rafCb).not.toBeNull()
      act(() => rafCb?.(16))
      expect(el.scrollTop).toBe(680)

      // Next transition: user scrolls via wheel before rAF fires -> rAF must cancel and keep user's position.
      rerenderBench(true)
      expect(rafCb).not.toBeNull()
      fireEvent.wheel(el)
      expect(cancelSpy).toHaveBeenCalledWith(42)
      el.scrollTop = 120
      act(() => rafCb?.(32))
      expect(el.scrollTop).toBe(120)
    } finally {
      rafSpy.mockRestore()
      cancelSpy.mockRestore()
    }
  })
})
