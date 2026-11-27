import { readFileSync } from 'node:fs'
import type { AgentState, GroupDto, GroupThreadItemDto, MachineDto, MessageDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import type { AgentLoginDriver, AgentLoginEvent } from '../src/features/agents/source'
import { CandidateBotPicker } from '../src/features/bots/CandidateBotPicker'
import { GroupThreads } from '../src/features/chat/GroupThreads'
import { AgentLoginDialog } from '../src/features/machines/AgentLoginDialog'
import { api } from '../src/lib/api'

const GROUP: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '开发群',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '张三', avatar: null, isAdmin: true }],
  botIds: [],
  unread: 0,
  lastSeq: 9,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

const item = (id: string, body: string): GroupThreadItemDto => ({
  root: {
    id,
    groupId: 'g1',
    seq: 1,
    kind: 'bot',
    authorId: 'b1',
    authorName: '共字君',
    body,
    mentions: [],
    createdAt: '2026-11-21T06:00:00.000Z',
    editedAt: null,
    recalled: false,
    hidden: false,
    runId: null,
    quote: null,
    attachments: [],
    reactions: [],
    threadRootId: null,
    thread: { replyCount: 2, lastReplyAt: '2026-11-21T06:05:00.000Z', participants: [] },
  } as MessageDto,
  state: { rootId: id, groupId: 'g1', following: false, lastReadSeq: 0, unread: 0, mentioned: false },
  live: false,
})

describe('thread search motion', () => {
  beforeEach(() => useWorkspace.setState({ groups: [GROUP], bots: [] }))
  afterEach(() => vi.restoreAllMocks())

  it('keeps the same list mounted (dimmed) while typing, and swaps only when results cross to none', async () => {
    const pending = new Map<string, (v: unknown) => void>()
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (!path.includes('q='))
        return Promise.resolve({ threads: [item('m1', '架构讨论'), item('m2', '发布计划')], next: null })
      return new Promise((resolve) => pending.set(decodeURIComponent(path.split('q=')[1] ?? ''), resolve))
    })
    const { container } = render(
      <MemoryRouter>
        <GroupThreads group={GROUP} onClose={() => {}} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('架构讨论')).toBeTruthy())
    const list = container.querySelector('.group-threads__list') as HTMLElement
    const kept = screen.getByText('发布计划').closest('button')
    const box = screen.getByRole('searchbox', { name: '搜索话题' })

    fireEvent.change(box, { target: { value: '发' } })
    await waitFor(() => expect(list.getAttribute('aria-busy')).toBe('true'))
    expect(screen.queryByLabelText('加载中')).toBeNull()
    fireEvent.change(box, { target: { value: '发布' } })
    await waitFor(() => expect(pending.has('发布')).toBe(true))
    act(() => pending.get('发布')?.({ threads: [item('m2', '发布计划')], next: null }))

    await waitFor(() => expect(screen.queryByText('架构讨论')).toBeNull())
    expect(container.querySelector('.group-threads__list')).toBe(list)
    expect(list.hasAttribute('aria-busy')).toBe(false)
    expect(screen.getByText('发布计划').closest('button')).toBe(kept)

    fireEvent.change(box, { target: { value: '不存在' } })
    await waitFor(() => expect(pending.has('不存在')).toBe(true))
    act(() => pending.get('不存在')?.({ threads: [], next: null }))
    const none = await screen.findByText('没有匹配的话题')
    expect(none.closest('.group-threads__center')?.classList.contains('ui-panel-swap')).toBe(true)
  })
})

const machine: MachineDto = {
  id: 'm1',
  ownerId: 'u1',
  name: 'win-box',
  os: 'windows',
  arch: 'x86_64',
  online: true,
  agents: [],
  daemonVersion: '0.4.35',
  features: ['agent_login'],
  lastSeenAt: null,
  hostname: 'win-box',
  system: null,
  boundAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
}

const cb = {
  kind: 'codebuddy',
  available: true,
  version: '2.0.0',
  path: '/tools/codebuddy',
  minVersion: null,
  catalog: null,
  latest: '2.0.0',
  managed: true,
  upgradeCommand: null,
  installCommand: null,
  loginState: 'logged_out',
  loginFlow: 'acp',
} as AgentState

describe('agent login dialog motion', () => {
  it('fades each phase in as a fresh panel (not the first idle one) and pops the success check', async () => {
    let emit: (e: AgentLoginEvent) => void = () => {}
    const driver: AgentLoginDriver = {
      mode: 'web',
      supportsAcp: true,
      startAcp: vi.fn(async () => ({ opId: 'op-1' })),
      cancelAcp: vi.fn(async () => {}),
      subscribeAcp: (fn) => {
        emit = fn
        return () => {}
      },
      refresh: vi.fn(async () => {}),
    }
    render(
      <AgentLoginDialog
        machine={machine}
        agent="codebuddy"
        agentState={cb}
        loginDriver={driver}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('dialog')
    const idle = within(dialog).getByText('选择登录方式').closest('.ag-login__phase') as HTMLElement
    expect(idle.classList.contains('ui-panel-swap')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: '开始登录授权' }))
    await waitFor(() => expect(driver.startAcp).toHaveBeenCalled())
    act(() =>
      emit({
        t: 'agent.login.auth',
        opId: 'op-1',
        kind: 'codebuddy',
        url: 'https://x.test/a',
        methodId: 'internal',
      }),
    )
    const qr = await within(dialog).findByTitle('授权二维码')
    expect(qr.closest('.ag-login__phase')?.classList.contains('ui-panel-swap')).toBe(true)
    expect(within(dialog).getByRole('button', { name: '在浏览器中打开' })).toBeTruthy()

    act(() => emit({ t: 'agent.login.result', opId: 'op-1', kind: 'codebuddy', ok: true, user: 'a@b.cn' }))
    const status = await within(dialog).findByRole('status')
    expect(within(status).getByText('登录成功')).toBeTruthy()
    expect(status.querySelector('.ui-check-pop svg')).toBeTruthy()
    expect(status.closest('.ag-login__phase')?.classList.contains('ui-panel-swap')).toBe(true)
  })
})

describe('reduced motion in these areas', () => {
  const FILES = [
    'features/chat/group-threads.css',
    'features/machines/agent-login.css',
    'features/machines/machines.css',
    'features/workspaces/workspaces.css',
    'features/groups/groups.css',
    'features/groups/pickers.css',
    'features/bots/bots.css',
    'features/bots/CandidateBotPicker.css',
    'features/agents/agents.css',
    'features/connectors/connectors.css',
    'features/runs/runs.css',
  ]
  it('moves only through the shared ui-enter keyframes on spring tokens, which collapse under reduced motion', () => {
    for (const f of FILES) {
      const css = readFileSync(`src/${f}`, 'utf8')
      for (const [, frames] of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?)\n\}/g))
        expect(frames, f).not.toMatch(/transform|scale|translate/)
      for (const [, body] of css.matchAll(/animation:([^;]+);/g)) {
        if (body?.includes('ui-enter'))
          expect(body, f).toMatch(/var\(--spring-\w+\) ui-enter|ui-enter var\(--spring-\w+\)/)
        if (body?.includes('ui-fade-in')) expect(body, f).toMatch(/--fade-(in|fast)\)/)
      }
    }
  })
})

describe('candidate bot picker motion', () => {
  it('animates only the rows and chips the user just moved, not the ones there on open', () => {
    useWorkspace.setState({
      bots: [
        { id: 'b1', name: '甲', presence: 'online', avatar: 'role-no', agentKind: 'claude' },
        { id: 'b2', name: '乙', presence: 'online', avatar: 'role-no', agentKind: 'claude' },
      ] as never,
    })
    function Host() {
      const [c, setC] = useState(['b1'])
      return (
        <CandidateBotPicker
          group={undefined}
          botIds={['b1', 'b2']}
          candidates={c}
          onCandidatesChange={setC}
          picks={{}}
          onPicksChange={() => {}}
          title="候选"
        />
      )
    }
    const { container } = render(<Host />)
    expect(container.querySelector('.bot-pick__row--new')).toBeNull()
    expect(screen.getByRole('button', { name: '添加 乙' }).classList.contains('ui-pop-in')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '添加 乙' }))
    expect(container.querySelectorAll('.bot-pick__row--new')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '移除 甲' }))
    expect(screen.getByRole('button', { name: '添加 甲' }).classList.contains('ui-pop-in')).toBe(true)
  })
})
