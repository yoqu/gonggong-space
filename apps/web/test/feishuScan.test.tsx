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
    review: 'approved',
    updatedAt: '2026-10-01T00:00:00Z',
  },
}

// The dialog is lazy; a cold first import can outlast findBy's default timeout.
beforeAll(() => import('../src/features/feishu/FeishuScanDialog'))

describe('扫码创建或接入', () => {
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
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码创建或接入' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByTitle('飞书扫码')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: '在飞书中打开' }).getAttribute('href')).toBe(waiting.url)
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ update: false })

    view = bound
    session = { ...waiting, status: 'succeeded', app: bound.app }
    // Saved is not done: the dialog stays with what is left (the availability range at least).
    expect(await within(dialog).findByText('已接通')).toBeTruthy()
    expect(within(dialog).getByText(/新应用默认只有创建者可用/)).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: '打开飞书管理后台' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Connected and approved: one status line, scanning again tucked behind 更换应用….
    expect(await screen.findByText('已接通')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '扫码创建或接入' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '更换应用…' }))
    expect(screen.getByRole('button', { name: '扫码创建或接入' }).className).not.toContain('primary')
    expect(screen.getByLabelText('App ID')).toBeTruthy()
  })

  it('lists what is left while the first version awaits approval, and retries it', async () => {
    const pendingApp = {
      ...bound.app!,
      configError: '自动配置失败：no permission',
      review: 'pending' as const,
    }
    let view: FeishuAppView = { app: pendingApp }
    mockApi({
      'GET /bots/b1/feishu': () => view,
      'POST /bots/b1/feishu/register': waiting,
      'GET /feishu/register/s1': {
        ...waiting,
        status: 'succeeded',
        app: pendingApp,
        configError: '自动配置失败：no permission',
      },
      'POST /bots/b1/feishu/configure': () => {
        view = bound
        return view
      },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '更换应用…' }))
    fireEvent.click(screen.getByRole('button', { name: '扫码创建或接入' }))
    const dialog = await screen.findByRole('dialog')
    const steps = await within(dialog).findByRole('list', { name: '接入进度' })
    expect(within(steps).getByText('等待企业飞书管理员审核，通过后自动完成，无需回来操作')).toBeTruthy()
    expect(within(steps).getByText('自动配置失败：no permission')).toBeTruthy()
    fireEvent.click(within(steps).getByRole('button', { name: '重试' }))
    expect(await within(dialog).findByText('已接通')).toBeTruthy()
  })

  it('cannot tell approval of an app Feishu will not let us modify', async () => {
    mockApi({
      'GET /bots/b1/feishu': { app: { ...bound.app!, configError: '无法自动配置', review: 'unknown' } },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    const steps = await screen.findByRole('list', { name: '接入进度' })
    expect(within(steps).getByText('请在飞书开发者后台确认已发布')).toBeTruthy()
    // The status tag tells the same: not 已接通 until confirmed.
    expect(screen.getAllByText('待确认').length).toBeGreaterThan(0)
    expect(screen.queryByText('已接通')).toBeNull()
  })

  it('更新权限 re-confirms the bound app; closing cancels the session', async () => {
    const calls = mockApi({
      'GET /bots/b1/feishu': bound,
      'POST /bots/b1/feishu/register': waiting,
      'GET /feishu/register/s1': waiting,
      'DELETE /feishu/register/s1': undefined,
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
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
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    fireEvent.click(await screen.findByRole('button', { name: '扫码创建或接入' }))
    expect(await screen.findByText('二维码已过期')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新生成' })).toBeTruthy()
  })
})
