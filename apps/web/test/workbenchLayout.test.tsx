import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'
import { InspectorPortal, InspectorSlot, useInspector } from '../src/app/inspector'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { Workbench } from '../src/features/workbench/Workbench'

const mounts = vi.hoisted(() => ({ web: 0 }))

vi.mock('../src/features/workbench/tabs/WebTab', async () => {
  const { useEffect } = await import('react')
  return {
    WebTab: ({ tabKey }: { tabKey: string }) => {
      useEffect(() => {
        mounts.web++
      }, [])
      return <div data-testid={`body-${tabKey}`} />
    },
    useWebTabMeta: (t: { previewId: string }) => ({ icon: 'desktop', title: `网页 ${t.previewId}` }),
  }
})

const web = (id: string): WorkbenchTab => ({ kind: 'web', previewId: id, path: '/' })

const layout = (opts: { bench?: boolean; rail?: ReactNode } = {}) => (
  <MemoryRouter>
    <ChatLayout
      sidebar={<div>完整会话列表</div>}
      strip={<div>会话图标条</div>}
      chatStrip={<span>聊天竖条</span>}
      workbench={opts.bench === false ? undefined : <Workbench />}
      rail={opts.rail}
      railOpen={!!opts.rail}
      railKind="info"
      mobileView="chat"
    >
      <div>聊天内容</div>
    </ChatLayout>
  </MemoryRouter>
)

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
const bench = () => screen.queryByRole('region', { name: '工作台' })
const chat = () => screen.getByText('聊天内容').closest('main') as HTMLElement

beforeEach(() => {
  localStorage.clear()
  setWidth(1440)
  mounts.web = 0
  useWorkbench.setState({
    groupId: 'g1',
    open: true,
    mode: 'split',
    previous: 'split',
    benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
  })
})
afterEach(() => localStorage.clear())

describe('workbench column', () => {
  it('shows right of the chat, which narrows to the default width', () => {
    render(layout())
    expect(bench()).not.toBeNull()
    expect(chat().style.width).toBe('380px')
    expect(screen.getByTestId('body-web:p1')).toBeTruthy()
  })

  it('is absent without a workbench, and the chat takes the room', () => {
    render(layout({ bench: false }))
    expect(bench()).toBeNull()
    expect(chat().style.width).toBe('')
    expect(screen.getByText('完整会话列表')).toBeTruthy()
  })

  it('split keeps the list, focus folds it into the icon strip, full hides it and collapses the chat', () => {
    render(layout())
    const sidebar = screen.getByRole('navigation', { name: '会话列表' })
    expect(screen.getByText('完整会话列表')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '专注' }))
    expect(useWorkbench.getState().mode).toBe('focus')
    expect(screen.getByText('完整会话列表').closest('nav')).toBe(sidebar)
    expect(sidebar.hidden).toBe(true)
    expect(screen.getByText('会话图标条')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全屏' }))
    expect(screen.queryByText('会话图标条')).toBeNull()
    expect(screen.getByText('完整会话列表').closest('nav')).toBe(sidebar)
    // Out of view but mounted: its composer floats over the workbench.
    expect(chat().className).toContain('chat__center--float')
    fireEvent.click(screen.getByRole('button', { name: '展开聊天' }))
    expect(chat().className).not.toContain('chat__center--float')
    expect(chat().className).toContain('chat__center--over')
  })

  it('Esc closes the chat overlay, then returns from full to the previous mode', () => {
    useWorkbench.setState({ mode: 'focus' })
    render(layout())
    fireEvent.click(screen.getByRole('button', { name: '全屏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开聊天' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chat().className).toContain('chat__center--float')
    expect(useWorkbench.getState().mode).toBe('full')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useWorkbench.getState().mode).toBe('focus')
    expect(screen.getByText('会话图标条')).toBeTruthy()
  })

  it('groups the three modes into one segmented control, apart from the close button', () => {
    render(layout())
    const modes = screen.getByRole('group', { name: '布局' })
    expect(
      within(modes)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['分栏', '专注', '全屏'])
    expect(within(modes).queryByRole('button', { name: '隐藏工作台' })).toBeNull()
  })

  it('renders split as focus below 1100px', () => {
    setWidth(1000)
    render(layout())
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(true)
    expect(screen.getByText('会话图标条')).toBeTruthy()
    expect(screen.getByRole('button', { name: '专注' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('hides the workbench from its close button', () => {
    render(layout())
    fireEvent.click(screen.getByRole('button', { name: '隐藏工作台' }))
    expect(useWorkbench.getState().open).toBe(false)
  })

  it('switches modes from the keyboard, but not while typing', () => {
    render(layout())
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true })
    expect(useWorkbench.getState().mode).toBe('focus')
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', ctrlKey: true })
    expect(useWorkbench.getState().mode).toBe('split')
    fireEvent.keyDown(window, { key: '|', code: 'Backslash', metaKey: true, shiftKey: true })
    expect(useWorkbench.getState().mode).toBe('full')
    fireEvent.keyDown(window, { key: '|', code: 'Backslash', metaKey: true, shiftKey: true })
    expect(useWorkbench.getState().mode).toBe('split')
    const input = document.createElement('textarea')
    document.body.append(input)
    fireEvent.keyDown(input, { key: '\\', code: 'Backslash', metaKey: true })
    expect(useWorkbench.getState().mode).toBe('split')
    input.remove()
  })
})

describe('chat splitter', () => {
  const handle = () => screen.getByRole('separator', { name: '调整聊天栏宽度' })

  it('drags and remembers the chat width per mode', () => {
    const { unmount } = render(layout())
    fireEvent.pointerDown(handle(), { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 600, pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(chat().style.width).toBe('480px')
    unmount()
    render(layout())
    expect(chat().style.width).toBe('480px')
    act(() => useWorkbench.getState().setMode('focus'))
    expect(chat().style.width).toBe('380px')
  })

  it('clamps to 320–560 and resizes from the keyboard', async () => {
    render(layout())
    fireEvent.pointerDown(handle(), { clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 100, pointerId: 1 })
    await waitFor(() => expect(chat().style.width).toBe('320px'))
    fireEvent.pointerMove(window, { clientX: 1400, pointerId: 1 })
    await waitFor(() => expect(chat().style.width).toBe('560px'))
    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' })
    expect(chat().style.width).toBe('544px')
    fireEvent.keyDown(handle(), { key: 'ArrowRight' })
    expect(chat().style.width).toBe('560px')
  })
})

describe('inspector while the workbench is open', () => {
  it('docks between the chat and the workbench without remounting its frames', () => {
    const view = render(layout())
    const before = bench()
    const frame = screen.getByTestId('body-web:p1')
    expect(mounts.web).toBe(1)
    view.rerender(layout({ rail: <div>群信息</div> }))
    const dock = screen.getByRole('complementary', { name: '侧栏' })
    expect(dock.className).toContain('chat__dock')
    expect(dock.textContent).toContain('群信息')
    expect(dock.compareDocumentPosition(bench() as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bench()).toBe(before)
    expect(screen.getByTestId('body-web:p1')).toBe(frame)
    expect(chat().hidden).toBe(false)
    view.rerender(layout())
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
    expect(bench()).toBe(before)
    expect(mounts.web).toBe(1)
  })

  it('takes the chat column when the workbench would get under 400px', () => {
    setWidth(1100)
    const view = render(layout({ rail: <div>群信息</div> }))
    expect(chat().hidden).toBe(true)
    expect(screen.getByRole('complementary', { name: '侧栏' })).toBeTruthy()
    view.rerender(layout())
    expect(chat().hidden).toBe(false)
  })

  it('folds the list to the icon strip when that leaves room for the chat, without changing the stored mode', () => {
    setWidth(1300)
    const view = render(layout({ rail: <div>群信息</div> }))
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(true)
    expect(screen.getByText('会话图标条')).toBeTruthy()
    expect(chat().hidden).toBe(false)
    expect(screen.getByRole('button', { name: '分栏' }).getAttribute('aria-pressed')).toBe('true')
    expect(useWorkbench.getState().mode).toBe('split')
    view.rerender(layout())
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(false)
    expect(screen.queryByText('会话图标条')).toBeNull()
  })

  it('keeps split when the rail fits beside the full list', () => {
    setWidth(1500)
    render(layout({ rail: <div>群信息</div> }))
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(false)
    expect(chat().hidden).toBe(false)
  })

  it('never grows past what leaves the workbench 400px, and gets its stored width back once undocked', () => {
    setWidth(1100)
    localStorage.setItem('gonggong.railWidth.info', '600')
    const view = render(layout({ rail: <div>群信息</div> }))
    // 1100 - list 281 - 400 (no nav here)
    expect(screen.getByRole('complementary', { name: '侧栏' }).style.width).toBe('419px')
    view.rerender(layout({ bench: false, rail: <div>群信息</div> }))
    expect(screen.getByRole('complementary', { name: '侧栏' }).style.width).toBe('600px')
  })

  it('resizes from the splitter on its left edge', () => {
    render(layout({ rail: <div>群信息</div> }))
    const handle = screen.getByRole('separator', { name: '调整侧栏宽度' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(screen.getByRole('complementary', { name: '侧栏' }).style.width).toBe('336px')
    expect(localStorage.getItem('gonggong.railWidth.info')).toBe('336')
  })

  it('keeps the inspector body mounted when it moves between the column and the dock', () => {
    const body = { mounts: 0 }
    const Body = () => {
      useEffect(() => {
        body.mounts++
      }, [])
      return <input aria-label="话题输入" />
    }
    const tree = (benchOpen: boolean) => (
      <MemoryRouter>
        <ChatLayout
          sidebar={<div>完整会话列表</div>}
          workbench={benchOpen ? <Workbench /> : undefined}
          rail={<InspectorSlot />}
          railOpen
          railKind="thread"
          mobileView="chat"
        >
          <InspectorPortal view="thread">
            <Body />
          </InspectorPortal>
          <div>聊天内容</div>
        </ChatLayout>
      </MemoryRouter>
    )
    act(() => useInspector.getState().open('thread'))
    const view = render(tree(false))
    fireEvent.change(screen.getByLabelText('话题输入'), { target: { value: '草稿' } })
    const input = screen.getByLabelText('话题输入')
    view.rerender(tree(true))
    expect(body.mounts).toBe(1)
    expect(screen.getByLabelText('话题输入')).toBe(input)
    expect(screen.getByRole('complementary', { name: '侧栏' }).contains(input)).toBe(true)
    act(() => useInspector.getState().close())
  })
})
