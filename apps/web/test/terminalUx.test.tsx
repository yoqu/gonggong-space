import type { TerminalSpaceDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockProps, mockRename, mockDelete } = vi.hoisted(() => ({
  mockProps: [] as Array<{
    spaceId?: string
    onExit?: (code: number | null, reason: string | null) => void
    onError?: (message: string) => void
    onRestart?: () => void
  }>,
  mockRename: vi.fn(),
  mockDelete: vi.fn(),
}))

vi.mock('../src/features/terminal/TerminalView', () => ({
  TerminalView: (props: {
    spaceId?: string
    onExit?: (code: number | null, reason: string | null) => void
    onError?: (message: string) => void
    onRestart?: () => void
  }) => {
    mockProps.push(props)
    return (
      <div data-testid="mock-terminal-view">
        <button type="button" onClick={() => props.onExit?.(0, 'user')}>
          sim-exit
        </button>
        <button type="button" onClick={() => props.onError?.('连接失败')}>
          sim-error
        </button>
        <button type="button" onClick={() => props.onRestart?.()}>
          sim-restart
        </button>
      </div>
    )
  },
}))

vi.mock('../src/features/terminal/spaces', () => ({
  touchTerminalSpace: vi.fn(),
  renameTerminalSpace: (...args: unknown[]) => mockRename(...args),
  deleteTerminalSpace: (...args: unknown[]) => mockDelete(...args),
}))

import { TerminalSpacePage } from '../src/features/terminal/TerminalSpacePage'

const makeSpace = (id: string, name: string): TerminalSpaceDto => ({
  id,
  name,
  machineId: 'm-1',
  machineName: 'Mac mini',
  cwd: '/Users/dev/app',
  createdAt: '2026-11-21T00:00:00.000Z',
  lastActiveAt: '2026-11-21T00:00:00.000Z',
})

describe('TerminalSpacePage UX fixes', () => {
  beforeEach(() => {
    mockProps.length = 0
    mockRename.mockReset()
    mockDelete.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('resets ended/failed state when switching terminal spaces and enables restart on error', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <TerminalSpacePage space={makeSpace('t-1', '前端终端')} />
      </MemoryRouter>,
    )

    const newShellBtn = () => screen.getByRole('button', { name: '新开 Shell' }) as HTMLButtonElement
    expect(newShellBtn().disabled).toBe(true)

    // Exit enables 新开 Shell
    fireEvent.click(screen.getByText('sim-exit'))
    expect(newShellBtn().disabled).toBe(false)

    // Switching to another terminal space resets ended so 新开 Shell is disabled again
    rerender(
      <MemoryRouter>
        <TerminalSpacePage space={makeSpace('t-2', '后端终端')} />
      </MemoryRouter>,
    )
    await waitFor(() => {
      expect(newShellBtn().disabled).toBe(true)
    })

    // Error state also enables 新开 Shell so user can recover
    fireEvent.click(screen.getByText('sim-error'))
    expect(newShellBtn().disabled).toBe(false)
  })

  it('ignores Enter when rename is unchanged and prevents duplicate submits while saving', async () => {
    let resolveRename!: () => void
    mockRename.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveRename = r
        }),
    )

    render(
      <MemoryRouter>
        <TerminalSpacePage space={makeSpace('t-1', '前端终端')} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = await screen.findByLabelText('名称')

    // Pressing Enter without changing the name does nothing
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockRename).not.toHaveBeenCalled()

    // Changing name and submitting twice only triggers one request
    fireEvent.change(input, { target: { value: '主服务终端' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockRename).toHaveBeenCalledTimes(1)
    expect(mockRename).toHaveBeenCalledWith('t-1', '主服务终端')
    expect((screen.getByRole('button', { name: '保存中…' }) as HTMLButtonElement).disabled).toBe(true)

    resolveRename()
    await waitFor(() => {
      expect(screen.queryByText('重命名终端')).toBeNull()
    })
  })
})
