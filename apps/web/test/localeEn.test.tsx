import type { GroupDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { mockApi } from './mockApi'

// Set before the app modules load: the locale is fixed per page load.
localStorage.setItem('gg.locale', 'en')
const { LoginPage } = await import('../src/features/auth/LoginPage')
const { SettingsHost } = await import('../src/features/settings/SettingsHost')
const { useSettings } = await import('../src/features/settings/store')

it('renders the login page in English, offering 中文 to switch back', () => {
  mockApi({ 'GET /auth/options': { registrationOpen: false } })
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { name: 'Log in' })).toBeTruthy()
  expect(screen.getByLabelText('Account')).toBeTruthy()
  expect(screen.getByText('No account yet? Ask a system admin to create one')).toBeTruthy()
  expect(screen.getByRole('button', { name: '中文' })).toBeTruthy()
})

it('renders settings in English with English selected', async () => {
  useSettings.getState().open('appearance')
  render(<SettingsHost />)
  expect(await screen.findByRole('dialog', { name: 'Appearance' })).toBeTruthy()
  const english = screen.getByRole('radio', { name: 'English' })
  expect(english.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
})

it('renders the not-found page in English', async () => {
  const { NotFound } = await import('../src/app/NotFound')
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  )
  expect(screen.getByText('Page not found')).toBeTruthy()
  expect(screen.getByText("The link may have expired, or you don't have access.")).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to messages' })).toBeTruthy()
})

it('titles the sidebar section of starred conversations "Starred"', async () => {
  const { Sidebar } = await import('../src/app/Sidebar')
  const g = {
    id: 'g1',
    teamId: 't1',
    name: 'g1',
    kind: 'group',
    mode: 'partition',
    adminOnlyInvite: false,
    protectBase: false,
    notice: '',
    noticeHidden: false,
    avatar: null,
    repo: null,
    members: [],
    botIds: [],
    unread: 0,
    lastSeq: 1,
    last: '',
    lastAt: '2026-09-23T03:00:00.000Z',
    pinned: true,
    notifyLevel: 'mentions',
    foldRuns: false,
    liveRunIds: [],
    liveRuns: [],
  } satisfies GroupDto
  render(
    <MemoryRouter>
      <Sidebar groups={[g]} bots={[]} machines={[]} loaded guide={false} />
    </MemoryRouter>,
  )
  expect(screen.getAllByText('Starred').length).toBeGreaterThan(0)
  expect(screen.queryByText('Star')).toBeNull()
})
