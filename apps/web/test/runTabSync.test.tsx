import type { RunDetailDto, RunDto } from '@gonggong/protocol'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rt = vi.hoisted(() => {
  let status: 'connecting' | 'open' | 'closed' = 'connecting'
  const listeners = new Set<(s: 'connecting' | 'open' | 'closed') => void>()
  return {
    set(s: typeof status) {
      status = s
      for (const l of [...listeners]) l(s)
    },
    reset() {
      status = 'connecting'
      listeners.clear()
    },
    api: {
      subscribe: () => () => {},
      onStatus(l: (s: 'connecting' | 'open' | 'closed') => void) {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      getStatus: () => status,
    },
  }
})
vi.mock('../src/lib/realtime', () => ({ realtime: rt.api }))

import { RunTab } from '../src/features/workbench/tabs/RunTab'

const at = '2026-09-23T02:21:00.000Z'
const run = (o: Partial<RunDto> = {}): RunDto => ({
  id: 'r1',
  groupId: 'g1',
  botId: 'b1',
  triggerMessageId: 'm1',
  triggerUserId: 'u1',
  hop: 1,
  status: 'running',
  step: '',
  filesChanged: 0,
  usage: null,
  newSessionReason: null,
  queuedAt: at,
  startedAt: at,
  endedAt: null,
  parentRunId: null,
  hopMax: 3,
  offlineWaitMin: 30,
  originUserId: 'u1',
  questions: [],
  approvals: [],
  interrupt: null,
  stoppedBy: null,
  delegation: { subagents: 0, subagentsRunning: 0, tasksRunning: 0 },
  model: null,
  effort: null,
  ...o,
})
const text = (id: number, delta: string) => ({ id, at, event: { kind: 'text' as const, delta } })
const detail = (o: Partial<RunDetailDto> & { events: RunDetailDto['events'] }): RunDetailDto => ({
  run: run(),
  patch: null,
  purged: false,
  patchRepos: [],
  sessionId: null,
  retentionDays: 30,
  ...o,
})
const first = detail({ events: [text(1, '第一段'), text(3, '第三段')] })
const done = detail({
  run: run({ status: 'completed', endedAt: at }),
  events: [text(3, '第三段'), text(5, '终稿')],
})

type Pending = { url: string; resolve: (d: RunDetailDto) => void }
/** Every GET /runs/:id parks until the test answers it, so responses can arrive in any order. */
function stubRuns() {
  const pending: Pending[] = []
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const path = input.replace(/^\/api/, '')
      const [p] = path.split('?')
      if (/^\/runs\/r\d$/.test(p!)) {
        urls.push(path)
        return new Promise<Response>((res) =>
          pending.push({ url: path, resolve: (d) => res(new Response(JSON.stringify(d))) }),
        )
      }
      if (p!.endsWith('/session')) return new Response(JSON.stringify({ rounds: [] }))
      return new Response(JSON.stringify({ scope: 'turn', patch: null, base: null, branch: null, repos: [] }))
    }),
  )
  return { urls, pending }
}
const answer = (p: Pending | undefined, d: RunDetailDto) => act(async () => p!.resolve(d))

const props = (runId: string, active = true) => ({
  tab: { kind: 'run' as const, runId, view: 'process' as const, file: null },
  tabKey: `run:${runId}`,
  active,
})

beforeEach(() => rt.reset())
afterEach(() => vi.unstubAllGlobals())

describe('run tab sync', () => {
  it('refills from the last stored event after a reconnect, not on the first connect', async () => {
    const { urls, pending } = stubRuns()
    render(<RunTab {...props('r1')} />)
    await answer(pending.shift(), first)
    expect(await screen.findByText('第三段')).toBeTruthy()

    act(() => rt.set('open'))
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(urls).toEqual(['/runs/r1'])

    act(() => rt.set('closed'))
    act(() => rt.set('open'))
    await waitFor(() => expect(urls).toEqual(['/runs/r1', '/runs/r1?since=3']))
    await answer(pending.shift(), done)
    expect(await screen.findByText('终稿')).toBeTruthy()
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
  })

  it('treats an already open socket at mount as connected, so the first drop-and-return refills', async () => {
    rt.set('open')
    const { urls, pending } = stubRuns()
    render(<RunTab {...props('r1')} />)
    await answer(pending.shift(), first)
    act(() => rt.set('closed'))
    act(() => rt.set('open'))
    await waitFor(() => expect(urls).toHaveLength(2))
  })

  it('waits for the tab to be shown before refilling after a reconnect', async () => {
    const { urls, pending } = stubRuns()
    const { rerender } = render(<RunTab {...props('r1', false)} />)
    await answer(pending.shift(), first)
    act(() => rt.set('open'))
    act(() => rt.set('closed'))
    act(() => rt.set('open'))
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(urls).toEqual(['/runs/r1'])

    rerender(<RunTab {...props('r1', true)} />)
    await waitFor(() => expect(urls).toEqual(['/runs/r1', '/runs/r1?since=3']))
    await answer(pending.shift(), done)
    expect(await screen.findByText('终稿')).toBeTruthy()
  })

  it('drops a response that arrives after a newer request has been answered', async () => {
    const { urls, pending } = stubRuns()
    render(<RunTab {...props('r1')} />)
    await answer(pending.shift(), first)
    await screen.findByText('第三段')

    act(() => rt.set('open'))
    act(() => rt.set('closed'))
    act(() => rt.set('open'))
    act(() => rt.set('closed'))
    act(() => rt.set('open'))
    await waitFor(() => expect(urls).toHaveLength(3))
    const [older, newer] = pending
    await answer(newer, done)
    expect(await screen.findByText('终稿')).toBeTruthy()

    await answer(older, detail({ events: [text(3, '第三段'), text(4, '过时')] }))
    expect(screen.queryByText('过时')).toBeNull()
    expect(screen.getByText('终稿')).toBeTruthy()
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0)
  })

  it('keeps a superseded request from writing into the run that replaced it', async () => {
    const { pending } = stubRuns()
    const { rerender } = render(<RunTab {...props('r1')} />)
    rerender(<RunTab {...props('r2')} />)
    await waitFor(() => expect(pending).toHaveLength(2))
    const [r1, r2] = pending
    await answer(r2, detail({ run: run({ id: 'r2' }), events: [text(1, '第二个运行')] }))
    expect(await screen.findByText('第二个运行')).toBeTruthy()

    await answer(r1, detail({ events: [text(1, '第一个运行')] }))
    expect(screen.queryByText('第一个运行')).toBeNull()
    expect(screen.getByText('第二个运行')).toBeTruthy()
  })
})
