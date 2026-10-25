import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { GitConsole } from '../src/features/git/GitConsole'
import { op, resetStores } from './gitFixtures'

beforeEach(resetStores)

describe('Git console', () => {
  it('shows the controlled operations oldest first, with output and failures kept separate', () => {
    useWorkspace.setState({
      gitOps: {
        g1: [
          op({
            id: 'new',
            status: 'succeeded',
            output: 'To origin\nmain -> main',
            createdAt: '2026-10-25T02:00:00Z',
          }),
          op({
            id: 'old',
            action: 'pull',
            status: 'failed',
            error: 'conflict',
            createdAt: '2026-10-25T01:00:00Z',
          }),
        ],
      },
    })
    render(<GitConsole groupId="g1" botId="b1" />)
    const rows = screen.getAllByTestId(/^git-console-/)
    expect(rows[0]?.dataset.testid).toBe('git-console-old')
    expect(within(rows[0] as HTMLElement).getByText('拉取')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText('conflict')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText(/To origin\s+main -> main/)).toBeTruthy()
  })

  it('filters failures without losing approvals from the activity view', () => {
    useWorkspace.setState({
      gitOps: {
        g1: [op({ id: 'ok', status: 'succeeded' }), op({ id: 'bad', status: 'failed', error: 'denied' })],
      },
    })
    render(<GitConsole groupId="g1" botId="b1" />)
    fireEvent.click(screen.getByRole('button', { name: '仅失败' }))
    expect(screen.queryByTestId('git-console-ok')).toBeNull()
    expect(screen.getByTestId('git-console-bad')).toBeTruthy()
  })

  it('keeps long output folded until asked for, with the operation time visible', () => {
    useWorkspace.setState({
      gitOps: { g1: [op({ id: 'long', status: 'succeeded', output: 'line\n'.repeat(40) })] },
    })
    render(<GitConsole groupId="g1" botId="b1" />)
    expect(screen.queryByText(/line\s+line/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开输出' }))
    expect(screen.getByText(/line\s+line/)).toBeTruthy()
  })
})
