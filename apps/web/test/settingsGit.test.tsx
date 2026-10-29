import type { GitAccountDto, UserDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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
