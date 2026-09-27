import type { BotDto, GroupBotStateDto, GroupDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBotStates, useWorkspace } from '../src/app/workspace'
import { GitBar } from '../src/features/chat/GitBar'
import { useDiffWindow } from '../src/features/diff/store'

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  name: '退款 v2 迁移',
  kind: 'group',
  mode: 'partition',
  notice: '',
  noticeHidden: false,
  repo: { url: 'git@git.corp:pay/refund.git', branch: 'main' },
  members: [],
  botIds: ['b1', 'b2', 'b3', 'b4'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  muted: false,
  foldRuns: false,
  liveRunIds: [],
  ...o,
})

const bot = (id: string, name: string) => ({ id, name }) as BotDto

const state = (botId: string, o: Partial<GroupBotStateDto> = {}): GroupBotStateDto => ({
  botId,
  workspace: 'managed',
  path: null,
  state: 'ready',
  git: null,
  error: null,
  reason: null,
  tier: null,
  model: null,
  effort: null,
  ...o,
})

const git = (o: Partial<NonNullable<GroupBotStateDto['git']>> = {}) => ({
  branch: 'main',
  ahead: 0,
  behind: 0,
  dirty: false,
  workspace: 'managed' as const,
  ...o,
})

beforeEach(() => {
  useWorkspace.setState({
    bots: [
      bot('b1', '小王的 Claude'),
      bot('b2', '老李的 Codex'),
      bot('b3', '阿杰的 Claude'),
      bot('b4', '小周的 Codex'),
    ],
    botStates: {},
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('git status bar', () => {
  it('loads the states and renders branch, behind/ahead, dirty, workspace kind and workspace hints', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git({ branch: 'feat/refund-v2', ahead: 3, dirty: true }) }),
              state('b2', { state: 'cloning' }),
              state('b3', { state: 'failed', error: 'Permission denied (publickey)' }),
              state('b4', {
                workspace: 'cd',
                git: git({ branch: null, ahead: null, behind: null, workspace: 'cd' }),
              }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group()} />)
    const b1 = await screen.findByTestId('git-b1')
    expect(fetch).toHaveBeenCalledWith('/api/groups/g1/bot-states', expect.anything())
    expect(b1.textContent).toBe('小王的 Claudefeat/refund-v23未提交托管')
    expect(within(b1).getByRole('img', { name: '领先 3 个提交' }).querySelector('svg')).toBeTruthy()
    expect(screen.getByTestId('git-b2').textContent).toBe('老李的 Codexclone 中…托管')
    expect(screen.getByTestId('git-b3').textContent).toBe('阿杰的 Claude工作区创建失败托管')
    expect(screen.getByText('工作区创建失败').getAttribute('title')).toBe('Permission denied (publickey)')
    expect(screen.getByTestId('git-b4').textContent).toBe('小周的 Codex—本机目录')
  })

  it('opens the bot workspace changes: uncommitted work first, else the branch against main', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              state('b1', { git: git({ dirty: true }) }),
              state('b2', { git: git({ branch: 'feat/x', dirty: false }) }),
              state('b3', { state: 'cloning' }),
            ]),
          ),
      ),
    )
    render(<GitBar group={group({ botIds: ['b1', 'b2', 'b3'] })} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看 小王的 Claude 的改动' }))
    expect(useDiffWindow.getState()).toMatchObject({
      source: { groupId: 'g1', botId: 'b1', runId: null },
      scope: 'uncommitted',
    })
    fireEvent.click(screen.getByRole('button', { name: '查看 老李的 Codex 的改动' }))
    expect(useDiffWindow.getState().scope).toBe('base')
    expect(
      (screen.getByRole('button', { name: '查看 阿杰的 Claude 的改动' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows 待创建 before the daemon reports and follows realtime updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([]))),
    )
    render(<GitBar group={group({ botIds: ['b1'] })} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claude待创建托管')
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      // A turn's git report counts even before a workspace.state arrives.
      state: state('b1', { state: 'pending', git: git({ behind: 2 }) }),
    })
    await waitFor(() => expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claudemain2托管'))
    expect(screen.getByRole('img', { name: '落后 2 个提交' })).toBeTruthy()
    useWorkspace
      .getState()
      .applyEvent({ t: 'group.botState', groupId: 'g1', state: state('b1', { state: 'unbound' }) })
    await waitFor(() => expect(screen.getByTestId('git-b1').textContent).toBe('小王的 Claude待绑定托管'))
  })

  it('is hidden outside partition groups with a repo; repo-less partition groups still load states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[]')),
    )
    const { unmount } = render(<GitBar group={group({ mode: 'force' })} />)
    expect(screen.queryByTestId('git-bar')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    unmount()
    render(<GitBar group={group({ repo: null })} />)
    expect(screen.queryByTestId('git-bar')).toBeNull()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/groups/g1/bot-states', expect.anything()))
  })
})

describe('bot state store', () => {
  it('keeps states per group and merges realtime updates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([state('b1'), state('b2')]))),
    )
    await loadBotStates('g1')
    useWorkspace.getState().applyEvent({ t: 'group.botState', groupId: 'g2', state: state('b1') })
    useWorkspace.getState().applyEvent({
      t: 'group.botState',
      groupId: 'g1',
      state: state('b2', { state: 'failed', error: 'x' }),
    })
    const s = useWorkspace.getState().botStates
    expect(Object.keys(s)).toEqual(['g1', 'g2'])
    expect(s.g1?.b1?.state).toBe('ready')
    expect(s.g1?.b2).toEqual(state('b2', { state: 'failed', error: 'x' }))
  })
})
