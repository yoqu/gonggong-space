import type { UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { AdminPlaceholder } from '../src/features/admin/AdminPage'
import {
  ComingSoonArt,
  EmptyState,
  NoBotsArt,
  NoChangesArt,
  NoDataArt,
  NoGroupsArt,
  NoMachinesArt,
  NoMembersArt,
  NoNotificationsArt,
  NoResultsArt,
  UnsupportedArt,
} from '../src/ui'
import { mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
}

/** The decorative art drawn above an empty state's title. */
const emptyArt = (title: string) =>
  screen.getByText(title).closest('.ui-empty')?.querySelector('.ui-empty__art svg.ui-art[aria-hidden="true"]')

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.stubGlobal(
    'WebSocket',
    class {
      close() {}
    },
  )
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('empty state illustrations', () => {
  it('are decorative svgs on the shared canvas', () => {
    for (const Art of [
      NoBotsArt,
      NoMembersArt,
      NoNotificationsArt,
      NoResultsArt,
      NoDataArt,
      NoMachinesArt,
      NoGroupsArt,
      NoChangesArt,
      ComingSoonArt,
      UnsupportedArt,
    ]) {
      const { container, unmount } = render(<Art />)
      const svg = container.querySelector('svg.ui-art')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      expect(svg?.getAttribute('viewBox')).toBe('0 0 160 120')
      unmount()
    }
  })

  it('shrink in compact empty states', () => {
    render(<EmptyState compact title="暂无通知" illustration={<NoNotificationsArt />} />)
    expect(emptyArt('暂无通知')?.closest('.ui-empty--compact')).toBeTruthy()
  })

  it('mark pages that are not delivered yet', () => {
    render(<AdminPlaceholder item={{ path: 'x', label: '占位', icon: 'gear', color: 'red', desc: '说明' }} />)
    expect(emptyArt('即将上线')).toBeTruthy()
  })

  it('fill empty admin tables, telling "none yet" from "no match"', async () => {
    mockApi({
      'GET /admin/groups': [],
      'GET /admin/machines': [],
      'GET /admin/audit?limit=50': [],
      'GET /admin/params': {},
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
    })
    for (const [path, title] of [
      ['/admin/groups', '还没有群'],
      ['/admin/machines', '还没有机器'],
      ['/admin/audit', '暂无记录'],
    ] as const) {
      const { unmount } = renderAt(path)
      await screen.findByText(title)
      expect(emptyArt(title)).toBeTruthy()
      unmount()
    }
    renderAt('/admin/groups')
    await screen.findByText('还没有群')
    fireEvent.change(screen.getByPlaceholderText('搜索群或仓库'), { target: { value: 'zzz' } })
    expect(emptyArt('没有匹配的群')).toBeTruthy()
  })

  it('invite creating the first bot', async () => {
    mockApi({ 'GET /bots': [], 'GET /machines': [], 'GET /notifications': [], 'GET /users': [] })
    renderAt('/admin/bots')
    await screen.findByText('还没有 Bot')
    expect(emptyArt('还没有 Bot')).toBeTruthy()
  })
})
