import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FeishuTicketDto, InvitePreviewDto, TeamDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { FeishuChoosePage } from '../src/features/feishu/FeishuChoosePage'
import { JoinPage } from '../src/features/teams/JoinPage'
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

const team: TeamDto = {
  id: 't1',
  name: '研发组',
  avatar: null,
  role: 'member',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
}

class NoopSocket {
  close() {}
}

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  )

let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  vi.stubGlobal('WebSocket', NoopSocket)
  assign = vi.fn()
  vi.stubGlobal('location', { ...window.location, origin: 'http://10.0.0.5', assign })
  useSession.setState({ user: null, tenancy: null, status: 'idle' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('JoinPage UX', () => {
  it('keeps submit button and footer visible after accept failure and allows direct retry', async () => {
    useSession.setState({
      user: me,
      tenancy: {
        teams: [team],
        singleTeamMode: false,
        canCreateTeam: false,
        demoMode: false,
        pluginsEnabled: false,
      },
      status: 'ready',
    })
    let attempts = 0
    mockApi({
      'GET /invites/inv1': {
        valid: true,
        teamName: '研发组',
        inviterName: '陈晨',
      } satisfies InvitePreviewDto,
      'POST /invites/inv1/accept': () => {
        attempts += 1
        if (attempts === 1) return apiError(500, 'internal', '网络波动，请稍后重试')
        return team
      },
    })

    renderAt('/join/inv1')
    const submit = await screen.findByRole('button', { name: '加入团队' })
    fireEvent.click(submit)

    expect(await screen.findByText('网络波动，请稍后重试')).toBeTruthy()
    // Should not become a dead-end: submit button and footer link remain visible.
    expect(screen.getByRole('button', { name: '加入团队' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回消息' })).toBeTruthy()

    // Retrying clears the error and succeeds.
    fireEvent.click(screen.getByRole('button', { name: '加入团队' }))
    await waitFor(() => expect(attempts).toBe(2))
    await waitFor(() => expect(screen.queryByText('网络波动，请稍后重试')).toBeNull())
    expect(assign).toHaveBeenCalledWith('/')
  })

  it('resets state and ignores stale preview responses when token changes', async () => {
    useSession.setState({
      user: me,
      tenancy: {
        teams: [team],
        singleTeamMode: false,
        canCreateTeam: false,
        demoMode: false,
        pluginsEnabled: false,
      },
      status: 'ready',
    })
    const first = deferred<InvitePreviewDto>()
    const second = deferred<InvitePreviewDto>()
    mockApi({
      'GET /invites/old': () => first.promise,
      'GET /invites/new': () => second.promise,
    })

    function Switcher() {
      const navigate = useNavigate()
      return (
        <>
          <button type="button" onClick={() => navigate('/join/new')}>
            switch-token
          </button>
          <Routes>
            <Route path="/join/:token" element={<JoinPage />} />
          </Routes>
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/join/old']}>
        <Switcher />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch-token' }))
    second.resolve({ valid: true, teamName: '新团队', inviterName: '李娜' })
    expect(await screen.findByRole('heading', { name: '新团队' })).toBeTruthy()

    // Stale response from the previous token must not overwrite the new token's preview.
    first.resolve({ valid: true, teamName: '旧团队', inviterName: '王磊' })
    await waitFor(() => expect(screen.getByRole('heading', { name: '新团队' })).toBeTruthy())
    expect(screen.queryByRole('heading', { name: '旧团队' })).toBeNull()
  })
})

describe('WelcomePage UX', () => {
  it('shows inline error, focuses input, and clears error on change for empty or invalid invite links', async () => {
    useSession.setState({
      user: { ...me, role: 'sysadmin' },
      tenancy: {
        teams: [],
        singleTeamMode: false,
        canCreateTeam: false,
        demoMode: false,
        pluginsEnabled: false,
      },
      status: 'ready',
    })
    mockApi({})

    renderAt('/welcome')
    const input = await screen.findByLabelText('邀请链接')
    const nextBtn = screen.getByRole('button', { name: '下一步' })

    // Empty submit
    nextBtn.focus()
    fireEvent.click(nextBtn)
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('auth-error')).toBe(true)
    expect(alert.textContent).toContain('请输入邀请链接')
    expect(alert.querySelector('svg')).toBeTruthy()
    expect(document.activeElement).toBe(input)

    // Typing clears error
    fireEvent.change(input, { target: { value: 'https://example.com/@@@' } })
    expect(screen.queryByText('请输入邀请链接')).toBeNull()

    // Invalid invite link submit
    nextBtn.focus()
    fireEvent.click(nextBtn)
    expect((await screen.findByRole('alert')).textContent).toContain('邀请链接格式不正确')
    expect(document.activeElement).toBe(input)

    // Typing valid link clears error and navigates
    fireEvent.change(input, { target: { value: 'http://10.0.0.5/join/inv_ok' } })
    expect(screen.queryByText('邀请链接格式不正确')).toBeNull()
  })
})

describe('RegisterPage UX', () => {
  it('redirects signed-in users with an invite param to /join/:invite instead of /', async () => {
    useSession.setState({
      user: me,
      tenancy: {
        teams: [team],
        singleTeamMode: false,
        canCreateTeam: false,
        demoMode: false,
        pluginsEnabled: false,
      },
      status: 'ready',
    })
    mockApi({
      'GET /invites/inv%2B1': {
        valid: true,
        teamName: '研发组',
        inviterName: '陈晨',
      } satisfies InvitePreviewDto,
    })

    renderAt('/register?invite=inv%2B1')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/join/inv%2B1'))
  })
})

describe('FeishuChoosePage UX', () => {
  it('shows check icon instead of spinner after create succeeds', async () => {
    const ticketDto: FeishuTicketDto = {
      name: '王磊',
      email: 'wanglei@example.com',
      avatar: null,
      canCreate: true,
      suggestedAccount: null,
      next: '/',
    }
    mockApi({
      'GET /me': () => apiError(401, 'unauthorized'),
      'GET /auth/feishu/ticket/tk1': ticketDto,
      'POST /auth/feishu/ticket/tk1/create': me,
    })

    const { container } = renderAt('/feishu/choose?ticket=tk1')
    const createBtn = await screen.findByRole('button', { name: /创建新账号/ })
    fireEvent.click(createBtn)

    await waitFor(() => {
      const end = createBtn.querySelector('.feishu-choice__end')
      expect(end?.querySelector('.ui-spinner')).toBeNull()
      expect(end?.querySelector('svg')).toBeTruthy()
      expect(
        container.querySelector('[data-testid="feishu-choose-page"]')?.getAttribute('data-leaving'),
      ).toBe('true')
    })
  })

  it('shows expired state immediately when ticket is missing without calling API', async () => {
    const calls = mockApi({ 'GET /me': () => apiError(401, 'unauthorized') })
    renderAt('/feishu/choose')

    expect(await screen.findByRole('heading', { name: '授权已过期' })).toBeTruthy()
    expect(screen.getByText('飞书登录已过期，请重新登录')).toBeTruthy()
    expect(calls.filter((c) => c.path.startsWith('/auth/feishu/ticket'))).toHaveLength(0)
  })

  it('ignores stale ticket responses when ticket changes', async () => {
    const first = deferred<FeishuTicketDto>()
    const second = deferred<FeishuTicketDto>()
    mockApi({
      'GET /auth/feishu/ticket/t1': () => first.promise,
      'GET /auth/feishu/ticket/t2': () => second.promise,
    })

    function Switcher() {
      const navigate = useNavigate()
      return (
        <>
          <button type="button" onClick={() => navigate('/auth/feishu/choose?ticket=t2')}>
            switch-ticket
          </button>
          <Routes>
            <Route path="/auth/feishu/choose" element={<FeishuChoosePage />} />
          </Routes>
        </>
      )
    }

    render(
      <MemoryRouter initialEntries={['/auth/feishu/choose?ticket=t1']}>
        <Switcher />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'switch-ticket' }))
    second.resolve({
      name: '新用户',
      email: null,
      avatar: null,
      canCreate: true,
      suggestedAccount: null,
      next: '/',
    })
    expect(await screen.findByText('新用户')).toBeTruthy()

    first.resolve({
      name: '旧用户',
      email: null,
      avatar: null,
      canCreate: true,
      suggestedAccount: null,
      next: '/',
    })
    await waitFor(() => expect(screen.getByText('新用户')).toBeTruthy())
    expect(screen.queryByText('旧用户')).toBeNull()
  })
})

describe('auth.css layout fixes', () => {
  const css = readFileSync(resolve(__dirname, '../src/features/auth/auth.css'), 'utf8')

  it('adds flex gap to .auth__foot, resets margin on .auth__or, and aligns mobile .auth__brand .auth__logo', () => {
    expect(css).toMatch(/\.auth__foot\s*\{[^}]*display:\s*flex;[^}]*gap:\s*var\(--space-12\);/s)
    expect(css).toMatch(/\.auth__or\s*\{[^}]*margin:\s*0;/s)
    expect(css).toMatch(/\.auth__brand\s+\.auth__logo\s*\{[^}]*margin-bottom:\s*0;/s)
  })
})
