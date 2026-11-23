import type { GitAccountDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useGitAccounts } from '../src/features/settings/api'
import { SettingsDialog } from '../src/features/settings/SettingsDialog'
import { useToasts } from '../src/ui/toast'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'zhangsan',
  name: '郑晓佳',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'https',
  email: null,
  avatar: null,
}

const account: GitAccountDto = {
  id: 'a1',
  provider: 'gitlab',
  baseUrl: 'https://gitlab.internal.example.com',
  login: 'zhangsan-frontend',
  status: 'ok',
}

beforeEach(() => {
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({ user: me, status: 'ready' })
  useGitAccounts.setState({ accounts: null })
  useToasts.setState({ items: [] })
})

describe('Git 与仓库 on a narrow screen', () => {
  it('lets a long account line shrink while 断开 keeps its size, with the full text on hover', async () => {
    mockApi({ 'GET /me/git-accounts': [account] })
    render(<SettingsDialog page="git" onClose={() => {}} />)
    const login = await screen.findByText('zhangsan-frontend')
    const row = login.closest('.ui-group__row') as HTMLElement
    expect(row.classList).toContain('settings-account-row')
    expect(row.querySelector('.settings-account')?.getAttribute('title')).toBe(
      'gitlab.internal.example.com zhangsan-frontend',
    )
    expect(row.querySelector('.ui-group__desc [title]')?.getAttribute('title')).toBe(account.baseUrl)
    expect(screen.getByRole('button', { name: '断开' }).closest('.settings-account__ops')).toBeTruthy()
  })
})

describe('个人设置 navigation', () => {
  it('remounts the section per page so it settles in, and keeps the current tab in sight on phones', () => {
    mockApi({})
    const reveal = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = reveal
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original
    })
    render(<SettingsDialog page="appearance" onClose={() => {}} />)
    const body = () => document.querySelector('.gs-settings__body') as HTMLElement
    const first = body()
    expect(reveal).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '我的密钥' }))
    expect(body()).not.toBe(first)
    expect(reveal).toHaveBeenCalledTimes(2)
  })
})

describe('Git 与仓库 error recovery and disconnect confirmation', () => {
  it('shows an error alert with retry when loading accounts fails, and recovers on retry', async () => {
    let attempt = 0
    const calls = mockApi({
      'GET /me/git-accounts': () => {
        attempt += 1
        return attempt === 1 ? apiError(500, 'internal', '加载 Git 账号失败') : [account]
      },
    })
    render(<SettingsDialog page="git" onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('加载 Git 账号失败')
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('zhangsan-frontend')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/me/git-accounts')).toHaveLength(2)
  })

  it('asks for confirmation before disconnecting, skips DELETE on cancel, and toasts on confirm', async () => {
    const calls = mockApi({
      'GET /me/git-accounts': [account],
      'DELETE /me/git-accounts/a1': undefined,
    })
    render(<SettingsDialog page="git" onClose={() => {}} />)
    await screen.findByText('zhangsan-frontend')

    fireEvent.click(screen.getByRole('button', { name: '断开' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm.textContent).toContain('将不再自动列出该账号的仓库和分支')
    expect(confirm.textContent).toContain('已在群里绑定的仓库不受影响')
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)

    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    expect(screen.getByText('zhangsan-frontend')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '断开' }))
    const confirmAgain = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirmAgain).getByRole('button', { name: '断开账号' }))

    await waitFor(() => {
      expect(calls.filter((c) => c.method === 'DELETE' && c.path === '/me/git-accounts/a1')).toHaveLength(1)
    })
    expect(screen.queryByText('zhangsan-frontend')).toBeNull()
    expect(useToasts.getState().items).toEqual([
      expect.objectContaining({ type: 'success', message: '已断开账号' }),
    ])
  })
})

describe('Settings sheets submit locking and feedback', () => {
  it('locks cancel and Escape while AddAccountSheet is submitting and shows loading state', async () => {
    let resolveAdd!: (value: GitAccountDto) => void
    mockApi({
      'GET /me/git-accounts': [],
      'POST /me/git-accounts': () =>
        new Promise<GitAccountDto>((resolve) => {
          resolveAdd = resolve
        }),
    })
    render(<SettingsDialog page="git" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '添加账号…' }))

    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'github_pat_123' } })
    fireEvent.click(screen.getByRole('button', { name: '连接' }))

    const submitBtn = await screen.findByRole('button', { name: /验证中…/ })
    expect(submitBtn.hasAttribute('disabled')).toBe(true)
    expect(submitBtn.getAttribute('aria-busy')).toBe('true')
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    expect(cancelBtn.hasAttribute('disabled')).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('heading', { name: '添加 Git 账号' })).toBeTruthy()

    resolveAdd({
      id: 'a2',
      provider: 'github',
      baseUrl: 'https://github.com',
      login: 'octocat',
      status: 'ok',
    })
    expect(await screen.findByText('octocat')).toBeTruthy()
  })

  it('locks cancel and Escape while ProfileSheet is submitting, shows loading, and toasts on success', async () => {
    let resolvePatch!: (value: UserDto) => void
    mockApi({
      'GET /me/feishu': { identity: null },
      'PATCH /me': () =>
        new Promise<UserDto>((resolve) => {
          resolvePatch = resolve
        }),
    })
    render(
      <MemoryRouter>
        <SettingsDialog page="account" onClose={() => {}} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '修改显示名…' }))

    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: '郑小佳' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    const saveBtn = await screen.findByRole('button', { name: /保存/ })
    expect(saveBtn.hasAttribute('disabled')).toBe(true)
    expect(saveBtn.getAttribute('aria-busy')).toBe('true')
    const cancelBtn = screen.getByRole('button', { name: '取消' })
    expect(cancelBtn.hasAttribute('disabled')).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('heading', { name: '修改显示名' })).toBeTruthy()

    resolvePatch({ ...me, name: '郑小佳' })
    await waitFor(() => {
      expect(useSession.getState().user?.name).toBe('郑小佳')
    })
    expect(useToasts.getState().items).toEqual([
      expect.objectContaining({ type: 'success', message: '已更新显示名' }),
    ])
  })
})
