import type { BotDto, GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { Workbench } from '../src/features/workbench/Workbench'

vi.mock('../src/features/workbench/tabs/WebTab', () => ({
  WebTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useWebTabMeta: (t: { previewId: string }) => ({
    icon: 'desktop',
    title: `网页 ${t.previewId}`,
    status: 'online',
  }),
}))
vi.mock('../src/features/workbench/tabs/GitTab', () => ({
  GitTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useGitTabMeta: (t: { botId: string }) => ({ icon: 'git-branch', title: `Git ${t.botId}` }),
}))
vi.mock('../src/features/workbench/tabs/FilesTab', () => ({
  FilesTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useFilesTabMeta: (t: { botId: string }) => ({ icon: 'folder', title: `文件 ${t.botId}` }),
}))
vi.mock('../src/features/workbench/tabs/RunTab', () => ({
  RunTab: ({ tabKey }: { tabKey: string }) => <div data-testid={`body-${tabKey}`} />,
  useRunTabMeta: (t: { runId: string }) => ({ icon: 'bot', title: `运行 ${t.runId}`, status: 'running' }),
}))

const web = (id: string): WorkbenchTab => ({ kind: 'web', previewId: id, path: '/' })
const run = (id: string): WorkbenchTab => ({ kind: 'run', runId: id, view: 'process', file: null })

const seed = (tabs: WorkbenchTab[], active: string | null = tabs[0] ? tabKey(tabs[0]) : null) =>
  useWorkbench.setState({
    groupId: 'g1',
    open: true,
    mode: 'split',
    previous: 'split',
    benches: {
      g1: { tabs, active, used: Object.fromEntries(tabs.map((t, i) => [tabKey(t), i + 1])) },
    },
  })
const state = () => useWorkbench.getState().benches.g1
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(name) })

beforeEach(() => {
  localStorage.clear()
  seed([run('r1'), web('p1'), run('r2')])
})

describe('tab bar', () => {
  it('lists the tabs with their titles and marks the active one', () => {
    render(<Workbench />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('运行 r1'),
      expect.stringContaining('网页 p1'),
      expect.stringContaining('运行 r2'),
    ])
    expect(tab('运行 r1').getAttribute('aria-selected')).toBe('true')
    expect(within(tab('运行 r1')).getByRole('status')).toBeTruthy()
  })

  it('activates on click and shows only the active body', () => {
    render(<Workbench />)
    fireEvent.click(tab('网页 p1'))
    expect(state()?.active).toBe('web:p1')
    expect(screen.getByTestId('body-web:p1').closest('[hidden]')).toBeNull()
    expect(screen.getByTestId('body-run:r1').closest('[hidden]')).not.toBeNull()
  })

  it('closes from the close button and with a middle click', () => {
    render(<Workbench />)
    fireEvent.click(screen.getByRole('button', { name: '关闭 运行 r2' }))
    expect(state()?.tabs.map(tabKey)).toEqual(['run:r1', 'web:p1'])
    fireEvent(tab('网页 p1'), new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(state()?.tabs.map(tabKey)).toEqual(['run:r1'])
  })

  it('offers 关闭 / 关闭其他标签页 / 关闭右侧标签页 on right click', () => {
    render(<Workbench />)
    fireEvent.contextMenu(tab('网页 p1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭右侧标签页' }))
    expect(state()?.tabs.map(tabKey)).toEqual(['run:r1', 'web:p1'])
    fireEvent.contextMenu(tab('网页 p1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭其他标签页' }))
    expect(state()?.tabs.map(tabKey)).toEqual(['web:p1'])
    fireEvent.contextMenu(tab('网页 p1'))
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭' }))
    expect(state()?.tabs).toEqual([])
  })

  it('closes every tab from the right-click menu, hiding the workbench', () => {
    render(<Workbench />)
    fireEvent.contextMenu(tab('运行 r2'))
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭全部标签页' }))
    expect(state()?.tabs).toEqual([])
    expect(useWorkbench.getState().open).toBe(false)
  })

  it("opens a web page, or a bot's files or Git, from ＋", () => {
    useWorkspace.setState({
      groups: [{ id: 'g1', botIds: ['b1', 'b2'] } as GroupDto],
      bots: [{ id: 'b1', name: '小王的 Claude' } as BotDto, { id: 'b2', name: '老李的 Codex' } as BotDto],
      botStates: { g1: { b1: { botId: 'b1', git: { branch: 'main' } } as GroupBotStateDto } },
    })
    render(<Workbench />)
    const add = () => fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    add()
    // Git only for the bots whose workspace is a repo.
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      '打开网页…',
      '添加群标签…',
      '小王的 Claude',
      '老李的 Codex',
      '小王的 Claude',
    ])
    fireEvent.click(screen.getAllByRole('menuitem', { name: '老李的 Codex' })[0] as HTMLElement)
    expect(state()?.tabs.at(-1)).toEqual({ kind: 'files', botId: 'b2', dir: '', selected: null })
    add()
    fireEvent.click(screen.getAllByRole('menuitem', { name: '小王的 Claude' })[1] as HTMLElement)
    expect(state()?.tabs.at(-1)).toEqual({ kind: 'git', botId: 'b1' })
    add()
    fireEvent.click(screen.getByRole('menuitem', { name: '打开网页…' }))
    const dialog = within(screen.getByRole('dialog', { name: '打开网页' }))
    const open = dialog.getByRole('button', { name: '打开' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    fireEvent.change(dialog.getByRole('textbox', { name: '网址' }), { target: { value: 'example.com/docs' } })
    fireEvent.click(open)
    expect(state()?.tabs.at(-1)).toEqual({
      kind: 'link',
      url: 'https://example.com/docs',
      title: 'example.com',
    })
    expect(state()?.active).toBe('link:https://example.com/docs')
  })

  it('shows an empty workbench with ＋ when opened without tabs', () => {
    seed([])
    render(<Workbench />)
    expect(screen.getByText('还没有打开的标签页')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '新建标签页' })).toHaveLength(2)
  })

  it('lists every tab in the overflow menu', () => {
    render(<Workbench />)
    fireEvent.click(screen.getByRole('button', { name: '全部标签页' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /运行 r2/ }))
    expect(state()?.active).toBe('run:r2')
  })

  it('reorders by dragging', () => {
    render(<Workbench />)
    fireEvent.dragStart(tab('运行 r2'))
    fireEvent.dragOver(tab('运行 r1'))
    fireEvent.drop(tab('运行 r1'))
    expect(state()?.tabs.map(tabKey)).toEqual(['run:r2', 'run:r1', 'web:p1'])
  })
})

describe('sleeping web tabs', () => {
  it('unmounts the frames beyond the live limit and marks their tabs', () => {
    seed([web('a'), web('b'), web('c'), web('d'), web('e')], 'web:e')
    render(<Workbench />)
    expect(screen.queryByTestId('body-web:a')).toBeNull()
    expect(screen.getByTestId('body-web:b')).toBeTruthy()
    expect(within(tab('网页 a')).getByLabelText('休眠')).toBeTruthy()
    expect(within(tab('网页 b')).queryByLabelText('休眠')).toBeNull()
    fireEvent.click(tab('网页 a'))
    expect(screen.getByTestId('body-web:a')).toBeTruthy()
    expect(screen.queryByTestId('body-web:b')).toBeNull()
  })
})

describe('tab shortcuts', () => {
  it('Ctrl+Tab / Ctrl+Shift+Tab cycle and Alt+W closes the active tab', () => {
    render(<Workbench />)
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true })
    expect(state()?.active).toBe('web:p1')
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true })
    expect(state()?.active).toBe('run:r2')
    fireEvent.keyDown(window, { key: '∑', code: 'KeyW', altKey: true })
    expect(state()?.tabs.map(tabKey)).toEqual(['run:r1', 'web:p1'])
  })
})
