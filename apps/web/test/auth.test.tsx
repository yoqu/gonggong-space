import type { UserDto } from '@aiws/protocol'
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

describe('account menu appearance', () => {
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
    fireEvent.click(await screen.findByRole('button', { name: '账户菜单' }))
    return screen.getByTestId('account-menu')
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
    expect(within(menu).getByText('外观')).toBeTruthy()
    expect(within(menu).getByRole('menuitemradio', { name: '浅色' }).getAttribute('aria-checked')).toBe(
      'false',
    )
    expect(within(menu).getByRole('menuitemradio', { name: '深色' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(within(menu).getByRole('menuitemradio', { name: '跟随系统' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  it('applies the choice immediately and persists across reload and remount', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '深色' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    // simulate a reload: startup code re-applies the stored preference
    document.documentElement.removeAttribute('data-theme')
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')

    cleanup()
    const remounted = await openMenu()
    expect(within(remounted).getByRole('menuitemradio', { name: '深色' }).getAttribute('aria-checked')).toBe(
      'true',
    )

    fireEvent.click(within(remounted).getByRole('menuitemradio', { name: '浅色' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('follows the OS appearance in system mode', async () => {
    setSystemDark(true)
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '跟随系统' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setSystemDark(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('offers clear / standard / tinted glass with standard marked by default', async () => {
    const menu = await openMenu()
    expect(within(menu).getByText('玻璃效果')).toBeTruthy()
    const checked = (name: string) =>
      within(menu).getByRole('menuitemradio', { name }).getAttribute('aria-checked')
    expect(checked('清透')).toBe('false')
    expect(checked('标准')).toBe('true')
    expect(checked('着色')).toBe('false')
  })

  it('applies the glass choice immediately and persists across remount', async () => {
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '着色' }))
    expect(document.documentElement.dataset.glass).toBe('tinted')
    expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('tinted')

    cleanup()
    const remounted = await openMenu()
    expect(within(remounted).getByRole('menuitemradio', { name: '着色' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(within(remounted).getByRole('menuitemradio', { name: '清透' }))
    expect(document.documentElement.dataset.glass).toBe('clear')
  })
})
