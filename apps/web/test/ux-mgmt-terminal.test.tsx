import type { TerminalSpaceDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from '../src/ui'

const { mockRename, mockDelete } = vi.hoisted(() => ({
  mockRename: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('../src/features/terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="mock-terminal-view" />,
}))

vi.mock('../src/features/terminal/spaces', () => ({
  touchTerminalSpace: vi.fn(),
  renameTerminalSpace: (...args: unknown[]) => mockRename(...args),
  deleteTerminalSpace: (...args: unknown[]) => mockDelete(...args),
}))

import { TerminalSpacePage } from '../src/features/terminal/TerminalSpacePage'

const space: TerminalSpaceDto = {
  id: 'ts1',
  name: '构建终端',
  machineId: 'm1',
  machineName: 'Mac',
  cwd: '/code',
  createdAt: '2026-11-21T00:00:00Z',
  lastActiveAt: '2026-11-21T00:00:00Z',
}

describe('U-37: TerminalSpacePage UX fixes', () => {
  beforeEach(() => {
    mockRename.mockReset()
    mockDelete.mockReset()
    useToasts.setState({ items: [] })
  })
  afterEach(() => cleanup())

  it('uses ConfirmActionDialog with loading and emits success toast on delete', async () => {
    let resolveDel!: () => void
    mockDelete.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveDel = r
        }),
    )
    render(
      <MemoryRouter>
        <TerminalSpacePage space={space} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除终端' }))
    const dlg = await screen.findByRole('alertdialog', { name: '要删除终端「构建终端」吗？' })
    const delBtn = within(dlg).getByRole('button', { name: '删除' })
    fireEvent.click(delBtn)
    await waitFor(() => expect(delBtn.getAttribute('aria-busy')).toBe('true'))
    expect(within(dlg).getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    resolveDel()
    await waitFor(() => expect(useToasts.getState().items.some((x) => x.message === '终端已删除')).toBe(true))
  })

  it('RenameDialog blocks IME Enter (keyCode 229) and shows loading while saving', async () => {
    mockRename.mockImplementation(() => new Promise(() => {}))
    render(
      <MemoryRouter>
        <TerminalSpacePage space={space} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = await screen.findByLabelText('名称')
    fireEvent.change(input, { target: { value: '部署终端' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(mockRename).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(mockRename).toHaveBeenCalledTimes(1)
    const saveBtn = screen.getByRole('button', { name: '保存中…' })
    expect(saveBtn.getAttribute('aria-busy')).toBe('true')
  })
})
