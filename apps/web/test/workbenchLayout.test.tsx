import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatLayout } from '../src/app/ChatLayout'
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
    expect(screen.getByText('完整会话列表')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '专注' }))
    expect(useWorkbench.getState().mode).toBe('focus')
    expect(screen.queryByText('完整会话列表')).toBeNull()
    expect(screen.getByText('会话图标条')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '全屏' }))
    expect(screen.queryByText('会话图标条')).toBeNull()
    expect(chat().hidden).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展开聊天' }))
    expect(chat().hidden).toBe(false)
    expect(chat().className).toContain('chat__center--over')
  })

  it('Esc closes the chat overlay, then returns from full to the previous mode', () => {
    useWorkbench.setState({ mode: 'focus' })
    render(layout())
    fireEvent.click(screen.getByRole('button', { name: '全屏' }))
    fireEvent.click(screen.getByRole('button', { name: '展开聊天' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chat().hidden).toBe(true)
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
    expect(screen.queryByText('完整会话列表')).toBeNull()
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
  it('floats as a drawer over the workbench without remounting its frames', () => {
    const view = render(layout())
    expect(mounts.web).toBe(1)
    view.rerender(layout({ rail: <div>群信息</div> }))
    const drawer = screen.getByRole('complementary', { name: '侧栏' })
    expect(drawer.className).toContain('chat__drawer')
    expect(drawer.textContent).toContain('群信息')
    view.rerender(layout())
    expect(screen.queryByRole('complementary', { name: '侧栏' })).toBeNull()
    expect(mounts.web).toBe(1)
  })

  it('stays a column when the workbench is closed', () => {
    render(layout({ bench: false, rail: <div>群信息</div> }))
    expect(screen.getByRole('complementary', { name: '侧栏' }).className).toContain('chat__rail')
  })
})
