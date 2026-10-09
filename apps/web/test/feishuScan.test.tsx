import type { FeishuAppView, FeishuRegisterDto } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FeishuAppForm } from '../src/features/feishu/FeishuAppForm'
import { FeishuScanDialog } from '../src/features/feishu/FeishuScanDialog'
import { mockApi } from './mockApi'

const waiting: FeishuRegisterDto = {
  id: 's1',
  url: 'https://open.feishu.cn/page/register?code=abc',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  status: 'waiting',
  error: null,
  app: null,
  configError: null,
}
const bound: FeishuAppView = {
  app: {
    appId: 'cli_bot01',
    status: 'connected',
    error: null,
    configError: null,
    updatedAt: '2026-10-01T00:00:00Z',
  },
}

// The dialog is lazy; a cold first import can outlast findBy's default timeout.
beforeAll(() => import('../src/features/feishu/FeishuScanDialog'))

describe('扫码创建或绑定', () => {
  it('handles success only once when parent callbacks change', async () => {
    mockApi({
      'POST /bots/b1/feishu/register': {
        ...waiting,
        status: 'succeeded',
        configError: 'no permission',
      },
    })
    const done = vi.fn()
    const view = render(
      <FeishuScanDialog path="/bots/b1/feishu" update={false} onDone={done} onClose={() => {}} />,
    )
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    view.rerender(<FeishuScanDialog path="/bots/b1/feishu" update={false} onDone={done} onClose={() => {}} />)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('waits for a slow poll and aborts it on unmount', async () => {
    vi.useFakeTimers()
    mockApi({ 'POST /bots/b1/feishu/register': waiting })
    const view = render(
      <FeishuScanDialog path="/bots/b1/feishu" update={false} onDone={() => {}} onClose={() => {}} />,
    )
    await act(async () => {})
    expect(screen.getByTitle('飞书扫码')).toBeTruthy()
    const fetchMock = vi.mocked(fetch)
    let signal: AbortSignal | undefined
    fetchMock.mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise(() => {})
    })
    fetchMock.mockClear()
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      view.unmount()
      expect(signal?.aborted).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the QR, then the created app once confirmed in Feishu', async () => {
    let view: FeishuAppView = { app: null }
    let session = waiting
    const calls = mockApi({
      'GET /bots/b1/feishu': () => view,
      'POST /bots/b1/feishu/register': () => waiting,
      'GET /feishu/register/s1': () => session,
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码创建或绑定' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByTitle('飞书扫码')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: '在飞书中打开' }).getAttribute('href')).toBe(waiting.url)
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ update: false })

    view = bound
    session = { ...waiting, status: 'succeeded', app: bound.app }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 4000 })
    expect(await screen.findByText('已连接')).toBeTruthy()
  })

  it('keeps the dialog open with the manual step when automatic configuration failed', async () => {
    mockApi({
      'GET /bots/b1/feishu': bound,
      'POST /bots/b1/feishu/register': waiting,
      'GET /feishu/register/s1': {
        ...waiting,
        status: 'succeeded',
        app: bound.app,
        configError: '自动配置失败：no permission',
      },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码创建或绑定' }))
    expect(await screen.findByText('自动配置失败：no permission', undefined, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByText(/飞书管理员审核通过后会自动完成/)).toBeTruthy()
  })

  it('更新权限 re-confirms the bound app; closing cancels the session', async () => {
    const calls = mockApi({
      'GET /bots/b1/feishu': bound,
      'POST /bots/b1/feishu/register': waiting,
      'GET /feishu/register/s1': waiting,
      'DELETE /feishu/register/s1': undefined,
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '更新权限' }))
    await screen.findByRole('dialog')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ update: true })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })

  it('reports an expired QR and offers a new one', async () => {
    mockApi({
      'GET /bots/b1/feishu': { app: null },
      'POST /bots/b1/feishu/register': waiting,
      'GET /feishu/register/s1': { ...waiting, status: 'expired' },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码创建或绑定' }))
    expect(await screen.findByText('二维码已过期', undefined, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy()
  })
})
