import type { BotDto, RunDetailDto, RunDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { RunTab } from '../src/features/workbench/tabs/RunTab'
import { useToasts } from '../src/ui/toast'

vi.mock('../src/lib/realtime', () => ({
  realtime: { subscribe: () => () => {}, onReconnect: () => () => {} },
}))

const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u-wang',
  hop: 1,
  status: 'interrupted',
  step: 'agent 进程异常退出',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: '2026-10-18T02:00:00.000Z',
  startedAt: '2026-10-18T02:00:01.000Z',
  endedAt: '2026-10-18T02:03:20.000Z',
  lastActivityAt: '2026-10-18T02:03:20.000Z',
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u-wang',
  questions: [],
  approvals: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})
const detail = (r: RunDto): RunDetailDto => ({
  run: r,
  patch: null,
  purged: false,
  settings: null,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  events: [],
})

function serve(d: RunDetailDto, retry: () => Response = () => new Response(null, { status: 204 })) {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const path = input.replace(/^\/api/, '').split('?')[0]
    if (path === '/runs/r1/retry' && init?.method === 'POST') return retry()
    if (path === '/runs/r1') return new Response(JSON.stringify(d))
    if (path === '/runs/r1/session') return new Response(JSON.stringify({ rounds: [] }))
    return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const retried = (fetch: ReturnType<typeof serve>) =>
  fetch.mock.calls.filter(([url, init]) => url.includes('/retry') && init?.method === 'POST')
const me = (id: string) => useSession.setState({ user: { id, name: id } as UserDto, status: 'ready' })

beforeEach(() => {
  useWorkspace.setState({
    bots: [
      {
        id: 'b1',
        name: '小王的 Claude',
        ownerId: 'u-li',
        ownerName: '李建国',
        avatar: 'role-gong',
      } as BotDto,
    ],
  })
  useToasts.setState({ items: [] })
  me('u-wang')
})
afterEach(() => vi.unstubAllGlobals())

const props = {
  tab: { kind: 'run' as const, runId: 'r1', view: 'process' as const, file: null },
  tabKey: 'run:r1',
  active: true,
}

describe('run tab retry', () => {
  it('lets the trigger user rerun a failed run from the banner', async () => {
    const fetch = serve(detail(run()))
    render(<RunTab {...props} />)
    const button = (await screen.findByRole('button', { name: '重新运行' })) as HTMLButtonElement
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    await waitFor(() =>
      expect(useToasts.getState().items.map((i) => i.message)).toContain(
        '已重新运行，新的运行卡片会出现在群里',
      ),
    )
    expect(retried(fetch)).toHaveLength(1)
  })

  it('lets the bot owner rerun an expired run', async () => {
    me('u-li')
    serve(detail(run({ status: 'expired' })))
    render(<RunTab {...props} />)
    expect(await screen.findByRole('button', { name: '重新运行' })).toBeTruthy()
  })

  it('toasts the server error and lets the user try again', async () => {
    serve(detail(run()), () =>
      Response.json({ error: 'conflict', message: '原消息已撤回，无法重新运行' }, { status: 409 }),
    )
    render(<RunTab {...props} />)
    const button = (await screen.findByRole('button', { name: '重新运行' })) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(useToasts.getState().items[0]?.type).toBe('error'))
    expect(useToasts.getState().items[0]?.message).toContain('原消息已撤回')
    expect(button.disabled).toBe(false)
  })

  it('lets a manually stopped run be rerun too, the button with its icon', async () => {
    const fetch = serve(detail(run({ step: '王磊 执行了 /stop', stepI18n: undefined, stoppedBy: 'u-wang' })))
    render(<RunTab {...props} />)
    const banner = (await screen.findByText('运行已停止')).closest('.run-issue') as HTMLElement
    const button = within(banner).getByRole('button', { name: '重新运行' })
    expect(button.querySelector('svg')).toBeTruthy()
    fireEvent.click(button)
    await waitFor(() => expect(retried(fetch)).toHaveLength(1))
  })

  it.each([
    ['someone else', run(), 'u-zhao'],
    ['a relayed run', run({ hop: 2 }), 'u-wang'],
  ])('offers no rerun to %s', async (_, r, user) => {
    me(user)
    serve(detail(r))
    render(<RunTab {...props} />)
    await screen.findByTitle('开始 – 结束')
    expect(screen.queryByRole('button', { name: '重新运行' })).toBeNull()
  })
})
