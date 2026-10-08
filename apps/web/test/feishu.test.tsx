import type { FeishuAppView, SystemParams, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(await screen.findByText('未配置')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('App ID'), { target: { value: ' cli_main01 ' } })
    fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))
    expect(await screen.findByText('已连接')).toBeTruthy()
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

describe('FeishuAppForm', () => {
  it('shows the connection error and the refusal of bad credentials', async () => {
    mockApi({
      'GET /bots/b1/feishu': {
        app: {
          appId: 'cli_bot01',
          status: 'error',
          error: 'endpoint unreachable',
          configError: null,
          updatedAt: '2026-10-01T00:00:00Z',
        },
      },
      'PUT /bots/b1/feishu': apiError(400, 'invalid', '飞书校验失败：app secret invalid'),
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    expect(await screen.findByText('连接失败')).toBeTruthy()
    expect(screen.getByText('endpoint unreachable')).toBeTruthy()
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
        updatedAt: '2026-10-01T00:00:00Z',
      },
    }
    const done: FeishuAppView = { app: { ...pending.app!, configError: null } }
    let view = pending
    const calls = mockApi({
      'GET /bots/b1/feishu': () => view,
      'POST /bots/b1/feishu/configure': () => {
        view = done
        return view
      },
    })
    render(<FeishuAppForm path="/bots/b1/feishu" removeLabel="解除飞书应用" />)
    expect(await screen.findByText('自动配置失败：scope not granted')).toBeTruthy()
    expect(screen.getByText(/点「更新权限」扫码补齐/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '飞书后台配置说明' }).getAttribute('href')).toBe(
      'https://yoqu.github.io/gonggong-space/admin/feishu',
    )
    fireEvent.click(screen.getByRole('button', { name: '重试自动配置' }))
    await waitFor(() => expect(screen.queryByText('自动配置失败：scope not granted')).toBeNull())
    expect(calls.some((c) => c.method === 'POST' && c.path === '/bots/b1/feishu/configure')).toBe(true)
  })
})
