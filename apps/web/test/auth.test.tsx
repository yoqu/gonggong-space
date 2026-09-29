import type { UserDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { GLASS_STORAGE_KEY } from '../src/app/glass'
import { useSession } from '../src/app/session'
import { initTheme, setTheme, THEME_STORAGE_KEY } from '../src/app/theme'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
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

/** Account menu → 设置…; resolves to the settings window. */
async function openSettings() {
  fireEvent.click(await screen.findByRole('button', { name: '账户菜单' }))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '设置…' }))
  return screen.findByRole('dialog', { name: '外观' })
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: null, status: 'idle' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('login page', () => {
  it('logs in and lands on the workspace', async () => {
    const calls = mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'POST /auth/login': me,
    })
    renderAt('/login')
    expect(screen.getByRole('heading', { name: '登录' })).toBeTruthy()
    // Accounts are issued by the sysadmin: no sign-up entry, only the form's own affordances.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      '切换到深色',
      '显示明文',
      '忘记密码？',
      '登录',
    ])
    fill('账号', 'wanglei')
    fill('密码', 'password123')
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('navigation', { name: '会话列表' }, { timeout: 3000 })).toBeTruthy()
    expect(calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      account: 'wanglei',
      password: 'password123',
    })
  })

  it('remembers the account, reveals the password and explains a forgotten password', async () => {
    mockApi({ 'GET /me': () => apiError(401, 'unauthorized'), 'POST /auth/login': me })
    renderAt('/login')
    fill('账号', 'wanglei')
    fill('密码', 'password123')
    fireEvent.click(screen.getByRole('button', { name: '显示明文' }))
    expect(screen.getByLabelText('密码', { exact: true }).getAttribute('type')).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    expect(screen.getByText(/请联系系统管理员重置密码/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('记住我'))
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await screen.findByRole('navigation', { name: '会话列表' }, { timeout: 3000 })
    expect(localStorage.getItem('gonggong.lastAccount')).toBe('wanglei')
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

describe('self sign-up', () => {
  it('shows 立即注册 only while the sysadmin has opened registration, and signs the new member in', async () => {
    const calls = mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': { registrationOpen: true },
      'POST /auth/register': { ...me, mustChangePassword: false },
    })
    renderAt('/login')
    fireEvent.click(await screen.findByRole('link', { name: '立即注册' }))
    expect(await screen.findByRole('heading', { name: '注册' })).toBeTruthy()
    fill('账号', 'wanglei')
    fill('姓名', '王磊')
    fill('密码', 'password123')
    fill('确认密码', 'password124')
    fireEvent.click(screen.getByRole('button', { name: '注册并进入' }))
    expect((await screen.findByRole('alert')).textContent).toContain('两次输入的密码不一致')
    fill('确认密码', 'password123')
    fireEvent.click(screen.getByRole('button', { name: '注册并进入' }))
    expect(await screen.findByRole('navigation', { name: '会话列表' }, { timeout: 3000 })).toBeTruthy()
    expect(calls.find((c) => c.path === '/auth/register')?.body).toEqual({
      account: 'wanglei',
      name: '王磊',
      password: 'password123',
    })
  })

  it('keeps the admin-contact line when registration is closed, and the register page says so', async () => {
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/options': { registrationOpen: false },
    })
    renderAt('/login')
    expect(await screen.findByText('还没有账号？请联系系统管理员开通')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '立即注册' })).toBeNull()
    cleanup()
    renderAt('/register')
    expect(await screen.findByText('当前未开放注册，请联系系统管理员创建账号。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '注册并进入' })).toBeNull()
  })
})

describe('forced password change', () => {
  it('blocks the app until the password is changed', async () => {
    const calls = mockApi({
      'GET /me': { ...me, mustChangePassword: true },
      'POST /auth/password': { ...me, mustChangePassword: false },
    })
    renderAt('/')
    await screen.findByLabelText('初始密码')
    expect(screen.queryByRole('navigation', { name: '会话列表' })).toBeNull()
    // The workspace endpoints refuse until then; loading early only raised an error toast.
    expect(calls.some((c) => c.path === '/bots')).toBe(false)

    fill('初始密码', 'init-pass')
    fill('新密码', 'new-pass-1')
    fill('确认新密码', 'new-pass-2')
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('两次输入的新密码不一致')
    expect(calls.some((c) => c.path === '/auth/password')).toBe(false)

    fill('确认新密码', 'new-pass-1')
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect(await screen.findByRole('navigation', { name: '会话列表' }, { timeout: 3000 })).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.path === '/bots')).toBe(true))
    expect(calls.find((c) => c.path === '/auth/password')?.body).toEqual({
      oldPassword: 'init-pass',
      newPassword: 'new-pass-1',
    })
  })
  it('checks the new password live and refuses reusing the current one', async () => {
    const calls = mockApi({ 'GET /me': { ...me, mustChangePassword: true } })
    renderAt('/')
    await screen.findByLabelText('初始密码')
    const rule = (name: string) => screen.getByText(name).closest('li')?.getAttribute('data-state')
    fill('初始密码', 'same-pass-1')
    fill('新密码', 'same-pass-1')
    fill('确认新密码', 'same-pass-1')
    expect([rule('至少 8 位'), rule('与原密码不同'), rule('两次输入一致')]).toEqual(['ok', 'bad', 'ok'])
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    expect((await screen.findByRole('alert')).textContent).toContain('新密码不能与原密码相同')
    expect(calls.some((c) => c.path === '/auth/password')).toBe(false)
  })
})

describe('account menu', () => {
  it('shows who I am, binding and my usage without leaving the chat, and logs out', async () => {
    const calls = mockApi({
      'GET /me': me,
      'POST /auth/logout': undefined,
      'GET /usage?by=bot&days=30': [
        { key: 'b1', name: '小王的 Claude', runs: 12, totalTokens: 98_000, unreported: 0 },
      ],
      [`GET /usage/daily?days=60&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`]:
        [{ day: '2026-09-25', runs: 12, totalTokens: 98_000, unreported: 0 }],
    })
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: '账户菜单' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('王磊')).toBeTruthy()
    expect(within(menu).getByText('普通成员 · wanglei')).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: '绑定新机器' })).toBeTruthy()
    expect(within(menu).queryAllByRole('link')).toEqual([])

    fireEvent.click(within(menu).getByRole('menuitem', { name: '我的用量' }))
    const usage = await screen.findByRole('dialog', { name: '我的用量' })
    const table = await within(usage).findByRole('grid', { name: '用量明细' })
    expect(within(table).getAllByRole('row')[1]?.textContent).toBe('小王的 Claude98k120')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '我的用量' })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '退出登录' }))
    expect(await screen.findByTestId('login-page')).toBeTruthy()
    await waitFor(() => expect(calls.some((c) => c.path === '/auth/logout')).toBe(true))
  })

  it('sets which git protocol my bots try first in settings', async () => {
    const calls = mockApi({
      'GET /me': me,
      'GET /me/git-accounts': [],
      'PATCH /me': { ...me, gitProtocol: 'https' },
    })
    renderAt('/')
    const settings = await openSettings()
    fireEvent.click(within(settings).getByRole('button', { name: /Git 与仓库/ }))
    const protocol = await within(settings).findByRole('button', { name: '协议偏好' })
    expect(protocol.textContent).toContain('按仓库地址')
    fireEvent.click(protocol)
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '优先 HTTPS' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ gitProtocol: 'https' }),
    )
    await waitFor(() => expect(protocol.textContent).toContain('优先 HTTPS'))
  })

  it('connects a git account, showing why a token was rejected', async () => {
    let attempts = 0
    const calls = mockApi({
      'GET /me': me,
      'GET /me/git-accounts': [],
      'POST /me/git-accounts': () =>
        ++attempts === 1
          ? apiError(400, 'invalid', 'Token 无效或已过期')
          : { id: 'a1', provider: 'gitlab', baseUrl: 'https://gl.corp', login: 'wanglei', status: 'ok' },
    })
    renderAt('/')
    const settings = await openSettings()
    fireEvent.click(within(settings).getByRole('button', { name: /Git 与仓库/ }))
    fireEvent.click(await within(settings).findByRole('button', { name: /添加账号/ }))
    const sheet = await screen.findByRole('dialog', { name: '添加 Git 账号' })
    const open = vi.fn()
    vi.stubGlobal('open', open)
    const guide = within(sheet).getByRole('region', { name: '如何获取 Token' })
    fireEvent.click(within(guide).getByRole('button', { name: '在 GitHub 创建 Token' }))
    const github = new URL(open.mock.calls[0]?.[0])
    expect(github.origin + github.pathname).toBe('https://github.com/settings/personal-access-tokens/new')
    expect(github.searchParams.get('contents')).toBe('read')
    expect(github.searchParams.get('name')).toBe('共工')
    expect(guide.textContent).toContain('All repositories')

    fireEvent.click(within(sheet).getByRole('radio', { name: 'GitLab' }))
    expect(within(guide).getByRole('button', { name: '在 GitLab 创建 Token' }).hasAttribute('disabled')).toBe(
      true,
    )
    fill('实例地址', 'https://gl.corp/')
    fireEvent.click(within(guide).getByRole('button', { name: '在 GitLab 创建 Token' }))
    const gitlab = new URL(open.mock.calls[1]?.[0])
    expect(gitlab.origin + gitlab.pathname).toBe('https://gl.corp/-/user_settings/personal_access_tokens')
    expect(gitlab.searchParams.get('scopes')).toBe('read_api')
    fill('Token', 'glpat-1')
    fireEvent.click(within(sheet).getByRole('button', { name: '连接' }))
    expect(await within(sheet).findByText('Token 无效或已过期')).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: '连接' }))
    expect(await within(settings).findByText('wanglei')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({
      provider: 'gitlab',
      baseUrl: 'https://gl.corp',
      token: 'glpat-1',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加 Git 账号' })).toBeNull())
  })

  it('changes my own password from settings without leaving the chat', async () => {
    const calls = mockApi({ 'GET /me': me, 'POST /auth/password': me })
    renderAt('/')
    const settings = await openSettings()
    fireEvent.click(within(settings).getByRole('button', { name: /账户/ }))
    fireEvent.click(within(settings).getByRole('button', { name: '修改密码…' }))
    const dialog = await screen.findByRole('dialog', { name: '修改密码' })
    fill('当前密码', 'old-pass-1')
    fill('新密码', 'new-pass-22')
    fill('确认新密码', 'new-pass-22')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存新密码' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改密码' })).toBeNull(), {
      timeout: 3000,
    })
    expect(calls.find((c) => c.path === '/auth/password')?.body).toEqual({
      oldPassword: 'old-pass-1',
      newPassword: 'new-pass-22',
    })
  })

  it('changes my own display name from settings and shows it at once', async () => {
    const calls = mockApi({ 'GET /me': me, 'PATCH /me': { ...me, name: '王小磊' } })
    renderAt('/')
    const settings = await openSettings()
    fireEvent.click(within(settings).getByRole('button', { name: /账户/ }))
    expect(within(settings).getByText('王磊')).toBeTruthy()
    fireEvent.click(within(settings).getByRole('button', { name: '修改显示名…' }))
    const sheet = await screen.findByRole('dialog', { name: '修改显示名' })
    const save = within(sheet).getByRole('button', { name: '保存' })
    fill('显示名', '   ')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fill('显示名', ' 王小磊 ')
    fireEvent.click(save)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改显示名' })).toBeNull())
    expect(calls.find((c) => c.method === 'PATCH' && c.path === '/me')?.body).toEqual({ name: '王小磊' })
    expect(useSession.getState().user?.name).toBe('王小磊')
    expect(within(settings).getByText('王小磊')).toBeTruthy()
  })
})

describe('appearance settings', () => {
  type ChangeListener = (event: { matches: boolean }) => void
  let systemDark = false
  let changeListeners: Set<ChangeListener> = new Set()

  // same matchMedia stub as theme.test.ts: jsdom has no implementation
  const installMatchMedia = () => {
    changeListeners = new Set()
    window.matchMedia = ((query: string) => ({
      media: query,
      get matches() {
        return systemDark
      },
      onchange: null,
      addEventListener: (_: string, cb: ChangeListener) => changeListeners.add(cb),
      removeEventListener: (_: string, cb: ChangeListener) => changeListeners.delete(cb),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }

  const setSystemDark = (dark: boolean) => {
    systemDark = dark
    for (const cb of changeListeners) cb({ matches: dark })
  }

  const openMenu = async () => {
    mockApi({ 'GET /me': me })
    renderAt('/')
    return openSettings()
  }

  beforeEach(() => {
    systemDark = false
    installMatchMedia()
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  afterEach(() => {
    // detach any system-mode listener the theme module installed, then reset DOM state
    setTheme('light')
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-glass')
  })

  it('offers light / dark / system with the current preference marked', async () => {
    setTheme('dark')
    const menu = await openMenu()
    expect(within(menu).getByRole('radiogroup', { name: '主题' })).toBeTruthy()
    expect(within(menu).getByRole('radio', { name: '浅色' }).getAttribute('aria-checked')).toBe('false')
    expect(within(menu).getByRole('radio', { name: '深色' }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('radio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe('false')
  })

  it('applies the choice immediately and persists across reload and remount', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('radio', { name: '深色' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    // simulate a reload: startup code re-applies the stored preference
    document.documentElement.removeAttribute('data-theme')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    cleanup()
    const remounted = await openMenu()
    expect(within(remounted).getByRole('radio', { name: '深色' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(within(remounted).getByRole('radio', { name: '浅色' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('follows the OS appearance in system mode', async () => {
    setSystemDark(true)
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('radio', { name: '跟随系统' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setSystemDark(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('offers clear / standard / tinted glass with standard marked by default', async () => {
    const menu = await openMenu()
    expect(within(menu).getByRole('radiogroup', { name: '玻璃效果' })).toBeTruthy()
    const checked = (name: string) => within(menu).getByRole('radio', { name }).getAttribute('aria-checked')
    expect(checked('清透')).toBe('false')
    expect(checked('标准')).toBe('true')
    expect(checked('着色')).toBe('false')
  })

  it('applies the glass choice immediately and persists across remount', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('radio', { name: '着色' }))
    expect(document.documentElement.dataset.glass).toBe('tinted')
    expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('tinted')

    cleanup()
    const remounted = await openMenu()
    expect(within(remounted).getByRole('radio', { name: '着色' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(remounted).getByRole('radio', { name: '清透' }))
    expect(document.documentElement.dataset.glass).toBe('clear')
  })
})
