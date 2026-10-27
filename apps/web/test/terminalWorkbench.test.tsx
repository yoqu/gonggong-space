import type { BotDto, GroupDto, MachineDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { tabKey, useWorkbench, type WorkbenchTab } from '../src/app/workbench'
import { useWorkspace } from '../src/app/workspace'
import { patchTerminalSession } from '../src/features/terminal/TerminalView'
import { NewTabMenu } from '../src/features/workbench/NewTabMenu'
import { TabContent, TabLabel } from '../src/features/workbench/TabContent'

vi.mock('../src/features/terminal/TerminalView', async (orig) => {
  const actual = await orig<typeof import('../src/features/terminal/TerminalView')>()
  return {
    ...actual,
    TerminalViewGuard: ({ sessionId }: { sessionId?: string }) => (
      <div data-testid="terminal-body">{sessionId}</div>
    ),
  }
})

const tab = (sessionId?: string): WorkbenchTab => ({ kind: 'terminal', botId: 'b1', sessionId })
const sessionId = '7ca45f50-93a2-4f7f-b0c1-ff1dd24ef731'
const seed = () => {
  useSession.setState({ user: { id: 'owner', role: 'member' } as UserDto })
  useWorkspace.setState({
    groups: [{ id: 'g1', botIds: ['b1', 'b2'] } as GroupDto],
    bots: [
      { id: 'b1', name: '我的 Bot', ownerId: 'owner', machineId: 'm1' } as BotDto,
      { id: 'b2', name: '别人的 Bot', ownerId: 'other', machineId: 'm2' } as BotDto,
    ],
    machines: [
      { id: 'm1', online: true, os: 'macos', features: ['terminal-v1'] } as MachineDto,
      { id: 'm2', online: true, os: 'linux', features: ['terminal-v1'] } as MachineDto,
    ],
  })
}

beforeEach(async () => {
  seed()
  useWorkbench.setState({ groupId: 'g1', open: true, mode: 'split', benches: {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('terminal workbench integration', () => {
  it("opens only the current owner's capable macOS/Linux terminal", () => {
    render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    const item = screen
      .getAllByRole('menuitem', { name: '我的 Bot' })
      .find((el) => el.getAttribute('data-value') === 'terminal:b1')!
    fireEvent.click(item)
    expect(useWorkbench.getState().benches.g1?.tabs).toEqual([tab()])
    expect(tabKey(tab(sessionId))).toBe('terminal:b1')
  })

  it('does not offer terminals to a sysadmin who does not own the bot', async () => {
    useSession.setState({ user: { id: 'admin', role: 'sysadmin' } as UserDto })
    render(
      <NewTabMenu>
        <span>+</span>
      </NewTabMenu>,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建标签页' }))
    await waitFor(() => expect(screen.queryByText('新建终端')).toBeNull())
  })

  it('renders title and body and patches the original group without switching chats', async () => {
    useWorkbench.getState().show(tab())
    render(
      <>
        <TabLabel tab={tab()}>{(meta) => <span>{meta.title}</span>}</TabLabel>
        <TabContent tab={tab()} active />
      </>,
    )
    expect(screen.getByText('终端 · 我的 Bot')).toBeTruthy()
    expect(screen.getByTestId('terminal-body')).toBeTruthy()
    useWorkbench.getState().setGroup('g2')
    patchTerminalSession('g1', 'b1', sessionId)
    await waitFor(() => expect(useWorkbench.getState().benches.g1?.tabs).toEqual([tab(sessionId)]))
    expect(useWorkbench.getState().groupId).toBe('g2')
  })
})
