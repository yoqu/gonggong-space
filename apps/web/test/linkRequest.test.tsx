import type { LinkRequestDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkRequestPage } from '../src/features/machines/LinkRequestPage'
import { realtime } from '../src/lib/realtime'
import { apiError, mockApi } from './mockApi'

class FakeSocket {
  static last: FakeSocket
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket)
  realtime.start()
})
afterEach(() => {
  realtime.stop()
  vi.unstubAllGlobals()
})

const req = (o: Partial<LinkRequestDto> = {}): LinkRequestDto => ({
  id: 'r1',
  machine: { name: 'lixiao-MacBook-Pro', os: 'macos', arch: 'aarch64' },
  agent: 'claude',
  ip: '203.0.113.7',
  userCode: 'K7QM',
  status: 'pending',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  ...o,
})

const show = () =>
  render(
    <MemoryRouter initialEntries={['/link/r1']}>
      <Routes>
        <Route path="/link/:id" element={<LinkRequestPage />} />
        <Route path="/g/:id" element={<p>dm page</p>} />
        <Route path="/machines" element={<p>machines page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('/link/:id', () => {
  it('shows the machine and the code to check, allows it and opens the DM once the bot is made', async () => {
    const calls = mockApi({
      'GET /link-requests/r1': req(),
      'POST /link-requests/r1/approve': req({ status: 'approved' }),
    })
    show()
    const card = await screen.findByRole('region', { name: '机器接入申请' })
    expect(card.textContent).toContain('lixiao-MacBook-Pro')
    expect(card.textContent).toContain('macOS · aarch64')
    expect(card.textContent).toContain('Claude Code')
    expect(card.textContent).toContain('203.0.113.7')
    expect(screen.getByText('K7QM').className).toContain('link-card__code')
    expect(card.textContent).toContain('只在你本人刚发起接入、且核对码与终端一致时允许')
    fireEvent.click(screen.getByRole('button', { name: '允许接入' }))
    expect(await screen.findByText('已允许接入')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/link-requests/r1/approve')).toBe(true)
    act(() =>
      FakeSocket.last.onmessage?.({
        data: JSON.stringify({ t: 'machine.onboarded', machineId: 'm1', botId: 'b1', groupId: 'g1' }),
      }),
    )
    expect(await screen.findByText('dm page')).toBeTruthy()
  })

  it('points to the machines page after allowing a machine that makes no bot', async () => {
    mockApi({
      'GET /link-requests/r1': req({ agent: null }),
      'POST /link-requests/r1/approve': req({ agent: null, status: 'approved' }),
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: '允许接入' }))
    fireEvent.click(await screen.findByRole('link', { name: '查看我的机器' }))
    expect(await screen.findByText('machines page')).toBeTruthy()
  })

  it('denies', async () => {
    const calls = mockApi({
      'GET /link-requests/r1': req(),
      'POST /link-requests/r1/deny': req({ status: 'denied' }),
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: '拒绝' }))
    expect(await screen.findByText('已拒绝接入')).toBeTruthy()
    expect(calls.some((c) => c.path === '/link-requests/r1/deny')).toBe(true)
  })

  it('says expired, whether it already was or ran out while open', async () => {
    mockApi({ 'GET /link-requests/r1': req({ status: 'expired' }) })
    const { unmount } = show()
    expect(await screen.findByText('接入申请已过期')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '允许接入' })).toBeNull()
    unmount()
    mockApi({
      'GET /link-requests/r1': req(),
      'POST /link-requests/r1/approve': () => apiError(410, 'code_expired'),
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: '允许接入' }))
    expect(await screen.findByText('接入申请已过期')).toBeTruthy()
  })

  it('says it was handled already', async () => {
    mockApi({ 'GET /link-requests/r1': req({ status: 'consumed' }) })
    const { unmount } = show()
    expect(await screen.findByText('这个接入申请已处理过')).toBeTruthy()
    unmount()
    mockApi({
      'GET /link-requests/r1': req(),
      'POST /link-requests/r1/approve': () => apiError(409, 'conflict'),
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: '允许接入' }))
    expect(await screen.findByText('这个接入申请已处理过')).toBeTruthy()
  })

  it('says so when the request does not exist', async () => {
    mockApi({ 'GET /link-requests/r1': () => apiError(404, 'not_found', '接入申请不存在') })
    show()
    expect(await screen.findByText('无法打开接入申请')).toBeTruthy()
  })
})
