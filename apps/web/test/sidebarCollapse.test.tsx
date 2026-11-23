import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/app/AppRail'
import { useShellOverlay } from '../src/app/AppShell'
import { ChatLayout } from '../src/app/ChatLayout'
import { useSidebarCollapse, useSidebarShortcut } from '../src/app/sidebarCollapse'
import { useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { Workbench } from '../src/features/workbench/Workbench'

vi.mock('../src/features/workbench/tabs/WebTab', () => ({
  WebTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useWebTabMeta: (t: { previewId: string }) => ({ icon: 'desktop', title: `网页 ${t.previewId}` }),
}))

const web = (id: string): WorkbenchTab => ({ kind: 'web', previewId: id, path: '/' })
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })

function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>
}

function ShortcutHost({ active }: { active: boolean }) {
  useSidebarShortcut(active)
  return null
}

beforeEach(() => {
  localStorage.clear()
  setWidth(1440)
  useSidebarCollapse.setState({ collapsed: false })
  useShellOverlay.setState({ overlay: null })
  useWorkbench.setState({
    groupId: null,
    open: false,
    mode: 'split',
    previous: 'split',
    benches: {},
  })
})

afterEach(() => {
  localStorage.clear()
  useSidebarCollapse.setState({ collapsed: false })
  useShellOverlay.setState({ overlay: null })
})

describe('AppRail 消息 click toggles conversation sidebar', () => {
  it('collapses and expands the sidebar on desktop when already in chat, persisting to localStorage', () => {
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <AppRail />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '消息' })
    expect(btn.getAttribute('aria-current')).toBe('page')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('title')).toBe('收起会话列表')

    fireEvent.click(btn)
    expect(useSidebarCollapse.getState().collapsed).toBe(true)
    expect(localStorage.getItem('gonggong.sidebarCollapsed')).toBe('1')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('title')).toBe('展开会话列表')

    fireEvent.click(btn)
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
    expect(localStorage.getItem('gonggong.sidebarCollapsed')).toBe('0')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('title')).toBe('收起会话列表')
  })

  it('navigates back to chat from another module without toggling collapsed state', () => {
    render(
      <MemoryRouter initialEntries={['/works']}>
        <AppRail />
        <PathProbe />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '消息' })
    expect(btn.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(btn)
    expect(screen.getByTestId('path').textContent).toBe('/')
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
  })

  it('only closes the notification overlay when notifications are open', () => {
    useShellOverlay.setState({ overlay: 'notif' })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <AppRail />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '消息' })
    fireEvent.click(btn)
    expect(useShellOverlay.getState().overlay).toBeNull()
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
  })

  it('does not collapse the sidebar on mobile bottom tab bar', () => {
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <AppRail orientation="horizontal" />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '消息' })
    expect(btn.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(btn)
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
  })

  it('exits workbench full mode and shows the sidebar when clicking 消息 in full mode', () => {
    useWorkbench.setState({
      groupId: 'g1',
      open: true,
      mode: 'full',
      previous: 'split',
      benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
    })
    useSidebarCollapse.setState({ collapsed: true })
    render(
      <MemoryRouter initialEntries={['/g/g1']}>
        <AppRail />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: '消息' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(useWorkbench.getState().mode).toBe('split')
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
  })
})

describe('ChatLayout sidebarCollapsed behavior', () => {
  it('hides the sidebar on desktop while keeping the main content visible', () => {
    const { container } = render(
      <MemoryRouter>
        <ChatLayout sidebar={<div>完整会话列表</div>} sidebarCollapsed mobileView="chat">
          <div>聊天内容</div>
        </ChatLayout>
      </MemoryRouter>,
    )
    expect(container.querySelector('.chat')?.className).toContain('chat--sidebar-collapsed')
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(true)
    expect(screen.getByText('聊天内容')).toBeTruthy()
  })

  it('ignores sidebarCollapsed on phones so list view remains accessible', () => {
    setWidth(390)
    const { container } = render(
      <MemoryRouter>
        <ChatLayout sidebar={<div>完整会话列表</div>} sidebarCollapsed mobileView="list">
          <div>聊天内容</div>
        </ChatLayout>
      </MemoryRouter>,
    )
    expect(container.querySelector('.chat')?.className).not.toContain('chat--sidebar-collapsed')
    expect(screen.getByRole('navigation', { name: '会话列表' }).hidden).toBe(false)
  })

  it('hides the focus icon strip when collapsed, and restores sidebar when clicking 分栏 or 专注 in Workbench', () => {
    useWorkbench.setState({
      groupId: 'g1',
      open: true,
      mode: 'focus',
      previous: 'split',
      benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
    })
    useSidebarCollapse.setState({ collapsed: true })
    function Host() {
      const collapsed = useSidebarCollapse((s) => s.collapsed)
      return (
        <MemoryRouter>
          <ChatLayout
            sidebar={<div>完整会话列表</div>}
            strip={<div>会话图标条</div>}
            sidebarCollapsed={collapsed}
            workbench={<Workbench />}
            mobileView="chat"
          >
            <div>聊天内容</div>
          </ChatLayout>
        </MemoryRouter>
      )
    }
    render(<Host />)
    expect(screen.queryByText('会话图标条')).toBeNull()
    expect(screen.getByText('完整会话列表').closest('nav')?.hidden).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '专注' }))
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
    expect(screen.getByText('会话图标条')).toBeTruthy()

    act(() => useSidebarCollapse.getState().setCollapsed(true))
    expect(screen.queryByText('会话图标条')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '分栏' }))
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
    expect(useWorkbench.getState().mode).toBe('split')
    expect(screen.getByRole('navigation', { name: '会话列表' }).hidden).toBe(false)
  })

  it('frees sidebar width in workbench room calculation so chat and inspector rail fit alongside workbench', () => {
    setWidth(1180)
    useWorkbench.setState({
      groupId: 'g1',
      open: true,
      mode: 'split',
      previous: 'split',
      benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
    })
    const tree = (collapsed: boolean) => (
      <MemoryRouter>
        <ChatLayout
          nav={() => <div />}
          sidebar={<div>完整会话列表</div>}
          strip={<div>会话图标条</div>}
          sidebarCollapsed={collapsed}
          workbench={<Workbench />}
          rail={<div>群信息</div>}
          railOpen
          railKind="info"
          mobileView="chat"
        >
          <div>聊天内容</div>
        </ChatLayout>
      </MemoryRouter>
    )
    const view = render(tree(false))
    const main = () => screen.getByText('聊天内容').closest('main') as HTMLElement
    // 1180 - 77 (nav) - 57 (folded strip) = 1046; 1046 - 381 (chat) - 320 (rail) = 345 < 400 => rail hides chat.
    expect(main().hidden).toBe(true)

    view.rerender(tree(true))
    // 1180 - 77 (nav) = 1103; 1103 - 381 (chat) - 320 (rail) = 402 >= 400 => chat, rail and workbench all fit.
    expect(main().hidden).toBe(false)
  })
})

describe('sidebar keyboard shortcut ⌘\\', () => {
  it('toggles sidebar when workbench is closed and ignores typing in inputs', () => {
    render(<ShortcutHost active />)
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true })
    expect(useSidebarCollapse.getState().collapsed).toBe(true)
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', ctrlKey: true })
    expect(useSidebarCollapse.getState().collapsed).toBe(false)

    const input = document.createElement('textarea')
    document.body.append(input)
    fireEvent.keyDown(input, { key: '\\', code: 'Backslash', metaKey: true })
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
    input.remove()
  })

  it('unfolds collapsed sidebar on ⌘\\ when workbench is open', () => {
    useWorkbench.setState({
      groupId: 'g1',
      open: true,
      mode: 'split',
      previous: 'split',
      benches: { g1: { tabs: [web('p1')], active: 'web:p1', used: { 'web:p1': 1 } } },
    })
    useSidebarCollapse.setState({ collapsed: true })
    render(
      <MemoryRouter>
        <ChatLayout
          sidebar={<div>完整会话列表</div>}
          sidebarCollapsed
          workbench={<Workbench />}
          mobileView="chat"
        >
          <div>聊天内容</div>
        </ChatLayout>
      </MemoryRouter>,
    )
    fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true })
    expect(useSidebarCollapse.getState().collapsed).toBe(false)
    expect(useWorkbench.getState().mode).toBe('split')
  })
})

describe('CSS contracts for collapsed sidebar', () => {
  it('hides .ui-frame__sidebar when .chat--sidebar-collapsed is set', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/app/dock.css'), 'utf8')
    expect(css).toContain('.chat--sidebar-collapsed > .ui-frame__sidebar')
  })

  it('styles active collapsed NavRail item distinctly', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/ui/nav-rail.css'), 'utf8')
    expect(css).toContain('.ui-rail__item[aria-current="page"][aria-expanded="false"] .ui-rail__tile')
  })
})
