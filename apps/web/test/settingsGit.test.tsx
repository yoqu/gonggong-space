import type { GitAccountDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { SettingsDialog } from '../src/features/settings/SettingsDialog'
import { mockApi } from './mockApi'

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
