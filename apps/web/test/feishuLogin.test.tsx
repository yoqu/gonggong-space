import type { FeishuIdentityView, FeishuTicketDto, SystemParams, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

class NoopSocket {
  close() {}
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const UA = navigator.userAgent
const setUserAgent = (ua: string) =>
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })

// The admin area is a lazy route; a cold first import can outlast findBy's default timeout.
beforeAll(() => import('../src/features/admin/AdminRoutes'))

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: null, status: 'idle' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUserAgent(UA)
})

const options = (
  feishuLogin: boolean,
  extra: { registrationOpen?: boolean; feishuAutoSignup?: boolean } = {},
) => ({
  registrationOpen: false,
  feishuLogin,
  ...extra,
})

describe('login page · 飞书登录', () => {
  it('places 飞书登录 as a quiet card below the primary submit button without redundant hints', async () => {
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'GET /auth/options': options(true) })
    renderAt('/login?next=/g/abc')
    const submit = await screen.findByRole('button', { name: '登录' })
    const link = await screen.findByRole('link', { name: '飞书登录' })
    expect(link.getAttribute('href')).toBe('/api/auth/feishu/start?next=%2Fg%2Fabc')
    expect(link.classList.contains('feishu-card')).toBe(true)
    expect(submit.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/首次使用飞书/)).toBeNull()
  })

  it('shows a quiet Feishu-only footer on login when password registration is closed and 飞书自动开户 is on', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': options(true, { registrationOpen: false, feishuAutoSignup: true }),
    })
    renderAt('/login')
    expect(await screen.findByRole('link', { name: '飞书登录' })).toBeTruthy()
    expect(screen.getByText('本空间通过飞书开户，点击上方飞书登录即可进入')).toBeTruthy()
    expect(screen.queryByText(/首次使用飞书/)).toBeNull()
    expect(screen.queryByText('还没有账号？请联系系统管理员开通')).toBeNull()
  })

  it('offers 使用飞书注册 on /register even when password sign-up is closed', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': options(true, { registrationOpen: false, feishuAutoSignup: true }),
    })
    renderAt('/register')
    const feishuSignup = await screen.findByRole('link', { name: '使用飞书注册' })
    expect(feishuSignup.getAttribute('href')).toBe('/api/auth/feishu/start?next=%2F')
    expect(screen.queryByRole('button', { name: '注册并进入' })).toBeNull()
  })

  it('places 使用飞书注册 card below 注册并进入 and preserves invite token across pages', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': options(true, { registrationOpen: true, feishuAutoSignup: true }),
    })
    renderAt('/register?invite=ggi_123')
    const submit = await screen.findByRole('button', { name: '注册并进入' })
    const feishuSignup = await screen.findByRole('link', { name: '使用飞书注册' })
    expect(feishuSignup.getAttribute('href')).toBe('/api/auth/feishu/start?next=%2Fjoin%2Fggi_123')
    expect(feishuSignup.classList.contains('feishu-card')).toBe(true)
    expect(submit.compareDocumentPosition(feishuSignup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/免填表单/)).toBeNull()
    const toLogin = screen.getByRole('link', { name: '去登录' })
    expect(toLogin.getAttribute('href')).toBe('/login?next=%2Fjoin%2Fggi_123')
  })

  it('places 飞书登录并加入 as a quiet card below 登录后加入 on /join/:token', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': options(true, { registrationOpen: false, feishuAutoSignup: true }),
      'GET /invites/inv1': { valid: true, teamName: '研发组', inviterName: '陈晨' },
    })
    renderAt('/join/inv1')
    const primary = await screen.findByRole('button', { name: '登录后加入' })
    const feishuJoin = await screen.findByRole('link', { name: '飞书登录并加入' })
    expect(feishuJoin.getAttribute('href')).toBe('/api/auth/feishu/start?next=%2Fjoin%2Finv1')
    expect(feishuJoin.classList.contains('feishu-card')).toBe(true)
    expect(primary.compareDocumentPosition(feishuJoin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/授权飞书后可一键创建账号/)).toBeNull()
  })

  it('has no 飞书登录 without the main app', async () => {
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'GET /auth/options': options(false) })
    renderAt('/login')
    await screen.findByRole('heading', { name: '登录' })
    await waitFor(() => expect(screen.queryByRole('link', { name: '飞书登录' })).toBeNull())
  })

  it('explains why a 飞书登录 came back', async () => {
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'GET /auth/options': options(true) })
    renderAt('/login?feishu=disabled')
    expect(await screen.findByText('账号已停用，请联系系统管理员')).toBeTruthy()
  })

  it('signs in through Feishu by itself inside the Feishu client (回链免登)', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh) Lark/7.30.0 LarkLocale/zh_CN')
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace })
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'GET /auth/options': options(true) })
    renderAt('/g/abc')
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/api/auth/feishu/start?mode=silent&next=%2Fg%2Fabc'),
    )
  })

  it('does not loop back into Feishu after a failed attempt', async () => {
    setUserAgent('Mozilla/5.0 Feishu/7.30.0')
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace })
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'GET /auth/options': options(true) })
    renderAt('/login?feishu=denied')
    expect(await screen.findByText('已取消飞书授权')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('first 飞书登录', () => {
  const ticket: FeishuTicketDto = {
    name: '王磊',
    email: 'wanglei@corp.com',
    avatar: null,
    canCreate: true,
    next: '/',
  }

  it('guides first-time Feishu users to choose between creating a new account or binding an existing one', async () => {
    const calls = mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/ft_1': ticket,
      'POST /auth/feishu/ticket/ft_1/bind': me,
      'GET /teams': [],
    })
    renderAt('/feishu/choose?ticket=ft_1')
    // Compact identity strip (no redundant green badge) + concise two-choice cards.
    expect(await screen.findByRole('heading', { name: '确认账号' })).toBeTruthy()
    expect(screen.getByText('王磊', { ignore: '.ui-avatar__text' })).toBeTruthy()
    expect(screen.queryByText('飞书已授权')).toBeNull()
    expect(screen.queryByLabelText('密码')).toBeNull()

    // Picking "绑定已有账号" opens the bind form with a clean top back button.
    fireEvent.click(screen.getByRole('button', { name: /绑定已有账号/ }))
    expect(screen.getByLabelText('账号')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回选择' }))
    expect(screen.queryByLabelText('密码')).toBeNull()

    // Re-enter bind and submit.
    fireEvent.click(screen.getByRole('button', { name: /绑定已有账号/ }))
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'wanglei' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: '绑定并登录' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/auth/feishu/ticket/ft_1/bind')?.body).toEqual({
        account: 'wanglei',
        password: 'password123',
      }),
    )
    await waitFor(() => expect(useSession.getState().user).toBeTruthy())
  })

  it('creates a new account in one click from the guided choice', async () => {
    const calls = mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/ft_1': ticket,
      'POST /auth/feishu/ticket/ft_1/create': me,
      'GET /teams': [],
    })
    renderAt('/feishu/choose?ticket=ft_1')
    fireEvent.click(await screen.findByRole('button', { name: /创建新账号/ }))
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/feishu/ticket/ft_1/create')).toBe(true))
    await waitFor(() => expect(useSession.getState().user).toBeTruthy())
  })

  it('promotes the bind card with an inline account pill when suggestedAccount matches email', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/ft_1': { ...ticket, suggestedAccount: 'wanglei' },
    })
    renderAt('/feishu/choose?ticket=ft_1')
    const bindBtn = await screen.findByRole('button', { name: /绑定已有账号/ })
    const createBtn = screen.getByRole('button', { name: /创建新账号/ })
    expect(within(bindBtn).getByText('wanglei')).toBeTruthy()
    expect(bindBtn.compareDocumentPosition(createBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('检测到邮箱匹配的已有账号')).toBeNull()

    fireEvent.click(bindBtn)
    expect((screen.getByLabelText('账号') as HTMLInputElement).value).toBe('wanglei')
    expect(screen.getByText('邮箱匹配')).toBeTruthy()
  })

  it('goes straight to binding with a concise note while 飞书自动开户 is off', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/ft_1': { ...ticket, canCreate: false },
    })
    renderAt('/feishu/choose?ticket=ft_1')
    expect(await screen.findByRole('button', { name: '绑定并登录' })).toBeTruthy()
    expect(screen.getByText('当前未开启自动开户，请绑定管理员开通的账号。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '返回选择' })).toBeNull()
    expect(screen.queryByRole('button', { name: /创建新账号/ })).toBeNull()
  })

  it('offers one-click Feishu retry and login link when a ticket has expired', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/ft_1': () => apiError(410, 'code_expired', '飞书登录已过期，请重新登录'),
      'GET /auth/options': options(true),
    })
    renderAt('/feishu/choose?ticket=ft_1')
    expect(await screen.findByRole('heading', { name: '授权已过期' })).toBeTruthy()
    expect(screen.getByText('飞书登录已过期，请重新登录')).toBeTruthy()
    expect(screen.getByRole('link', { name: '重新使用飞书登录' }).getAttribute('href')).toBe(
      '/api/auth/feishu/start?next=%2F',
    )
    expect(screen.getByRole('link', { name: '返回登录' })).toBeTruthy()
  })
})

describe('设置 · 账户 · 飞书', () => {
  async function openAccount() {
    fireEvent.click(await screen.findByRole('button', { name: '账户菜单' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '设置…' }))
    const dialog = await screen.findByRole('dialog', { name: '外观' })
    fireEvent.click(within(dialog).getByRole('button', { name: /账户/ }))
    return dialog
  }
  const workspace = { 'GET /me': me }

  it('links Feishu from the current page', async () => {
    mockApi({
      ...workspace,
      'GET /me/feishu': { identity: null } satisfies FeishuIdentityView,
      'GET /auth/options': options(true),
    })
    renderAt('/')
    await openAccount()
    const link = await screen.findByRole('link', { name: '绑定飞书' })
    expect(link.getAttribute('href')).toBe('/api/auth/feishu/start?mode=link&next=%2F')
  })

  it('shows the linked identity and unlinks it', async () => {
    let view: FeishuIdentityView = {
      identity: {
        name: '王磊',
        avatar: null,
        email: 'wanglei@corp.com',
        boundAt: '2026-10-01T00:00:00Z',
        notify: false,
      },
    }
    const calls = mockApi({
      ...workspace,
      'GET /me/feishu': () => view,
      'DELETE /me/feishu': () => {
        view = { identity: null }
      },
      'GET /auth/options': options(true),
    })
    renderAt('/')
    await openAccount()
    expect(await screen.findByText('wanglei@corp.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '解绑' }))
    fireEvent.click(await screen.findByRole('button', { name: '解绑飞书' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/me/feishu')).toBe(true),
    )
    expect(await screen.findByRole('link', { name: '绑定飞书' })).toBeTruthy()
  })
})

describe('管理后台 · 飞书 · 对外地址', () => {
  it('saves the public URL and shows the redirect URL to register in Feishu', async () => {
    useSession.setState({ user: { ...me, role: 'sysadmin' }, status: 'ready' })
    let params = { feishuAutoSignup: true, publicUrl: '' } as SystemParams
    const calls = mockApi({
      'GET /admin/feishu': { app: null },
      'GET /admin/params': () => params,
      'PUT /admin/params': (body: unknown) => {
        params = { ...params, ...(body as Partial<SystemParams>) }
        return params
      },
    })
    renderAt('/admin/feishu')
    const field = await screen.findByLabelText('对外地址')
    fireEvent.change(field, { target: { value: 'https://gg.example.com/' } })
    fireEvent.click(screen.getByRole('button', { name: '保存对外地址' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT' && c.path === '/admin/params')?.body).toEqual({
        publicUrl: 'https://gg.example.com',
      }),
    )
    expect(await screen.findByText('https://gg.example.com/api/auth/feishu/callback')).toBeTruthy()
  })
})
