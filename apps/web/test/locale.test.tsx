import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { LoginPage } from '../src/features/auth/LoginPage'
import { SettingsHost } from '../src/features/settings/SettingsDialog'
import { useSettings } from '../src/features/settings/store'
import { setLocale } from '../src/i18n'
import { mockApi } from './mockApi'

vi.mock('../src/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/i18n')>()),
  setLocale: vi.fn(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(setLocale).mockClear()
  localStorage.setItem('gg.locale', 'zh')
})

describe('language switch', () => {
  it('is offered in settings, each option named in its own language', () => {
    useSettings.getState().open('appearance')
    render(<SettingsHost />)
    const group = screen.getByRole('radiogroup', { name: '语言' })
    expect(within(group).getByRole('radio', { name: '中文' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: 'English' }))
    expect(setLocale).toHaveBeenCalledWith('en')
    useSettings.getState().close()
  })

  it('is offered on the login page', () => {
    mockApi({ 'GET /auth/options': { registrationOpen: false } })
    useSession.setState({ user: null, status: 'idle' })
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(setLocale).toHaveBeenCalledWith('en')
  })
})
