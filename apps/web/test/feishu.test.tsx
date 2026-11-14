import type { FeishuAppView, SystemParams, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { FeishuAppForm } from '../src/features/feishu/FeishuAppForm'
import { apiError, mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

class NoopSocket {
  close() {}
}

// The admin area is a lazy route; a cold first import can outlast findBy's default timeout.
beforeAll(() => import('../src/features/admin/AdminRoutes'))

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

const connected: FeishuAppView = {
  app: {
    appId: 'cli_main01',
    status: 'connected',
    error: null,
    configError: null,
    review: 'approved',
    updatedAt: '2026-10-01T00:00:00Z',
  },
}

describe('管理后台 · 飞书', () => {
  it('saves the main app and toggles auto sign-up', async () => {
    let view: FeishuAppView = { app: null }
    let auto = true
    const calls = mockApi({
      'GET /admin/feishu': () => view,
      'PUT /admin/feishu': () => {
        view = connected
        return view
      },
      'GET /admin/params': () => ({ feishuAutoSignup: auto }) as SystemParams,
      'PUT /admin/params': (body: unknown) => {
        auto = (body as SystemParams).feishuAutoSignup
        return { feishuAutoSignup: auto }
      },
    })
    render(
      <MemoryRouter initialEntries={['/admin/feishu']}>
        <App />
      </MemoryRouter>,
    )
    expect((await screen.findAllByText('未接入')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: ' cli_main01 ' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '接入' }))
    expect((await screen.findAllByText('已接通')).length).toBeGreaterThan(0)
    expect(calls.find((c) => c.method === 'PUT' && c.path === '/admin/feishu')?.body).toEqual({
      appId: 'cli_main01',
      appSecret: 'secret',
    })

    const toggle = (await screen.findByRole('switch', { name: '飞书自动开户' })) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(auto).toBe(false))
  })
})

describe('管理后台 · 飞书 · 对外地址', () => {
  it('comes first, is prefilled with this address, and gates scanning until saved', async () => {
    let url = ''
    const calls = mockApi({
      'GET /admin/feishu': { app: null },
      'GET /admin/feishu/overview': () => ({
        publicUrl: url,
        main: null,
        linkedUsers: 0,
        othersLinked: false,
        bots: [],
        chats: [],
      }),
      'GET /admin/params': () => ({ feishuAutoSignup: true, publicUrl: url }) as SystemParams,
      'PUT /admin/params': (body: unknown) => {
        url = (body as SystemParams).publicUrl
        return { feishuAutoSignup: true, publicUrl: url }
      },
    })
    render(
      <MemoryRouter initialEntries={['/admin/feishu']}>
        <App />
      </MemoryRouter>,
    )
    const field = (await screen.findByLabelText('对外地址')) as HTMLInputElement
    expect(field.value).toBe(window.location.origin)
    await screen.findByRole('heading', { name: '接入进度' })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['接入进度', '对外地址', '主应用', 'Bot', '飞书群', '账号'])
    const scan = screen.getByRole('button', { name: '扫码创建或接入' }) as HTMLButtonElement
    expect(scan.disabled).toBe(true)
    expect(screen.getByText('先保存对外地址')).toBeTruthy()
    expect(screen.getByText('尚未保存，预填的是当前网址')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存对外地址' }))
    await waitFor(() => expect(scan.disabled).toBe(false))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ publicUrl: window.location.origin })
    expect(screen.queryByText('先保存对外地址')).toBeNull()
    expect(screen.queryByText('尚未保存，预填的是当前网址')).toBeNull()
  })
})

describe('FeishuAppForm', () => {
  it('shows the connection error and the refusal of bad credentials', async () => {
    mockApi({
      'GET /bots/b1/feishu': {
        app: {
          appId: 'cli_bot01',
          status: 'error',
          error: 'endpoint unreachable',
          configError: null,
          review: 'approved',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      },
      'PUT /bots/b1/feishu': apiError(400, 'invalid', '飞书校验失败：app secret invalid'),
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    // Said once: the tag, then the reason under the step that failed.
    expect(await screen.findByText('连接失败')).toBeTruthy()
    const steps = screen.getByRole('list', { name: '接入进度' })
    expect(within(steps).getByText('endpoint unreachable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '更换应用…' }))
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_bot02' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '更换' }))
    expect(await screen.findByText('飞书校验失败：app secret invalid')).toBeTruthy()
  })

  it('shows pending automatic configuration and retries it on demand', async () => {
    const pending: FeishuAppView = {
      app: {
        appId: 'cli_bot01',
        status: 'connected',
        error: null,
        configError: '自动配置失败：scope not granted',
        review: 'pending',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    }
    const done: FeishuAppView = { app: { ...pending.app!, configError: null, review: 'approved' } }
    let view = pending
    const calls = mockApi({
      'GET /bots/b1/feishu': () => view,
      'POST /bots/b1/feishu/configure': () => {
        view = done
        return view
      },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="移除飞书应用" />)
    const steps = await screen.findByRole('list', { name: '接入进度' })
    expect(within(steps).getByText('等待企业飞书管理员审核，通过后自动完成，无需回来操作')).toBeTruthy()
    expect(within(steps).getByText('自动配置失败：scope not granted')).toBeTruthy()
    expect(within(steps).getByText(/新应用默认只有创建者可用/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '飞书后台配置说明' }).getAttribute('href')).toBe(
      'https://yoqu.github.io/gonggong-space/admin/feishu',
    )
    fireEvent.click(within(steps).getByRole('button', { name: '重试' }))
    // Approved and connected: the checklist folds into one line.
    expect(await screen.findByText('已接通')).toBeTruthy()
    expect(screen.queryByRole('list', { name: '接入进度' })).toBeNull()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/bots/b1/feishu/configure')).toBe(true)
  })
})
