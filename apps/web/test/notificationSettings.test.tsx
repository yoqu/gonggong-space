import type { FeishuIdentityView, MeDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { AccountMenu } from '../src/features/auth/AccountMenu'
import { NotificationSettings } from '../src/features/notifications/NotificationSettings'
import { mockApi } from './mockApi'

afterEach(() => vi.unstubAllGlobals())

const identity = (notify: boolean): FeishuIdentityView => ({
  identity: { name: '王磊', avatar: null, email: null, boundAt: '2026-10-01T00:00:00Z', notify },
})

const show = () =>
  render(
    <MemoryRouter>
      <NotificationSettings />
    </MemoryRouter>,
  )

describe('设置 · 通知', () => {
  it('turns 飞书通知 on for a linked account', async () => {
    let view = identity(false)
    const calls = mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: true },
      'GET /me/feishu': () => view,
      'PUT /me/feishu/notify': (body: unknown) => {
        view = identity((body as { notify: boolean }).notify)
      },
    })
    show()
    const toggle = (await screen.findByRole('switch', { name: '飞书通知' })) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/me/feishu/notify', body: { notify: true } }),
    )
    await waitFor(() => expect(toggle.checked).toBe(true))
  })

  it('asks to link Feishu first when the account is not linked', async () => {
    mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: true },
      'GET /me/feishu': { identity: null },
    })
    show()
    expect(((await screen.findByRole('switch', { name: '飞书通知' })) as HTMLInputElement).disabled).toBe(
      true,
    )
    screen.getByText('绑定飞书')
  })
})

const me = (notifyPrefs: MeDto['notifyPrefs']): MeDto => ({
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
  teams: [],
  singleTeamMode: false,
  canCreateTeam: false,
  demoMode: false,
  pluginsEnabled: false,
  notifyPrefs,
})

describe('勿扰', () => {
  it('turns 免打扰时段 on in the browser’s time zone and edits its end', async () => {
    useSession.getState().setUser(me({}))
    const calls = mockApi({
      'GET /auth/options': { registrationOpen: false, feishuLogin: false },
      'GET /me/feishu': { identity: null },
      'PATCH /me': (body: unknown) => me((body as { notifyPrefs: MeDto['notifyPrefs'] }).notifyPrefs),
    })
    show()
    fireEvent.click(await screen.findByRole('switch', { name: '免打扰时段' }))
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        method: 'PATCH',
        path: '/me',
        body: { notifyPrefs: { quietHours: { start: '22:00', end: '08:00', timezone } } },
      }),
    )
    fireEvent.change(await screen.findByLabelText('结束时间'), { target: { value: '07:30' } })
    await waitFor(() =>
      expect(calls.at(-1)?.body).toEqual({
        notifyPrefs: { quietHours: { start: '22:00', end: '07:30', timezone } },
      }),
    )
  })

  it('pauses notifications from the account menu and resumes them', async () => {
    useSession.getState().setUser(me({}))
    const calls = mockApi({
      'PATCH /me': (body: unknown) => me((body as { notifyPrefs: MeDto['notifyPrefs'] }).notifyPrefs),
    })
    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '暂停通知' }))
    const before = Date.now()
    fireEvent.click(await screen.findByRole('menuitem', { name: '1 小时' }))
    await waitFor(() => expect(screen.getByLabelText('通知已暂停')).toBeTruthy())
    const patch = calls.at(-1)?.body as { notifyPrefs: { pausedUntil: string } }
    const until = Date.parse(patch.notifyPrefs.pausedUntil)
    expect(until - before).toBeGreaterThanOrEqual(3600_000 - 1000)

    fireEvent.click(screen.getByRole('button', { name: '账户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^恢复通知/ }))
    await waitFor(() => expect(calls.at(-1)?.body).toEqual({ notifyPrefs: { pausedUntil: null } }))
  })
})
