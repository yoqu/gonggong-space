import type { UserDto } from '@aiws/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
}

class NoopSocket {
  close() {}
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

const fill = (label: string, value: string, exact = true) =>
  fireEvent.change(screen.getByLabelText(label, { exact }), { target: { value } })

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: null, status: 'idle' })
})
afterEach(() => vi.unstubAllGlobals())

describe('login page', () => {
  it('logs in and lands on the workspace', async () => {
    const calls = mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'POST /auth/login': me,
    })
    renderAt('/login')
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy()
    expect(screen.getByText('公司 SSO 登录 · 二期')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['登录'])
    fill('账号', 'wanglei')
    fill('密码', 'password123')
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('navigation', { name: '会话列表' })).toBeTruthy()
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      account: 'wanglei',
      password: 'password123',
    })
  })

  it('shows the server error', async () => {
    mockApi({ 'POST /auth/login': () => apiError(401, 'unauthorized', '账号或密码错误') })
    renderAt('/login')
    fill('账号', 'wanglei')
    fill('密码', 'nope')
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect((await screen.findByRole('alert')).textContent).toContain('账号或密码错误')
    expect(screen.getByTestId('login-page')).toBeTruthy()
  })
})

describe('forced password change', () => {
  it('blocks the app until the password is changed', async () => {
    const calls = mockApi({
      'GET /me': { ...me, mustChangePassword: true },
      'POST /auth/password': { ...me, mustChangePassword: false },
    })
    renderAt('/')
    await screen.findByLabelText('当前密码')
    expect(screen.queryByRole('navigation', { name: '会话列表' })).toBeNull()

    fill('当前密码', 'init-pass')
    fill('新密码', 'new-pass-1')
    fill('确认新密码', 'new-pass-2')
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('两次输入的新密码不一致')
    expect(calls.some((c) => c.path === '/auth/password')).toBe(false)

    fill('确认新密码', 'new-pass-1')
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(await screen.findByRole('navigation', { name: '会话列表' })).toBeTruthy()
    expect(calls.find((c) => c.path === '/auth/password')?.body).toEqual({
      oldPassword: 'init-pass',
      newPassword: 'new-pass-1',
    })
  })
})

describe('account menu', () => {
  it('shows who I am, links to binding and my bots, and logs out', async () => {
    const calls = mockApi({ 'GET /me': me, 'POST /auth/logout': undefined })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: '账户菜单' }))
    const menu = screen.getByTestId('account-menu')
    expect(within(menu).getByText('王磊')).toBeTruthy()
    expect(within(menu).getByText('普通成员 · wanglei')).toBeTruthy()
    expect(within(menu).getByRole('button', { name: '绑定新机器' })).toBeTruthy()
    expect(within(menu).getByRole('link', { name: '我的 bot 与用量' }).getAttribute('href')).toBe(
      '/admin/bots',
    )
    fireEvent.click(within(menu).getByRole('button', { name: '退出登录' }))
    expect(await screen.findByTestId('login-page')).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/logout')).toBe(true))
  })
})
