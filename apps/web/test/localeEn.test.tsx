import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { mockApi } from './mockApi'

// Set before the app modules load: the locale is fixed per page load.
localStorage.setItem('gg.locale', 'en')
const { LoginPage } = await import('../src/features/auth/LoginPage')
const { SettingsHost } = await import('../src/features/settings/SettingsDialog')
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

it('renders settings in English with English selected', () => {
  useSettings.getState().open('appearance')
  render(<SettingsHost />)
  expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeTruthy()
  const english = screen.getByRole('radio', { name: 'English' })
  expect(english.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy()
})
