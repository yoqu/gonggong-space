import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { GLASS_STORAGE_KEY } from '@web/app/glass'
import { ipc } from '../src/ipc'
import { SettingsPage } from '../src/pages/Settings'
import { useDaemon } from '../src/store'
import { initTheme, THEME_STORAGE_KEY } from '../src/theme'
import { INFO } from './ipc-mock'

const stubSystemTheme = (dark: boolean) => {
  vi.stubGlobal('matchMedia', undefined)
  window.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.glass
  vi.mocked(ipc).settings.mockResolvedValue({
    autoUpgrade: true,
    launchAtLogin: false,
    mirror: { kind: 'npmmirror' },
    env: {},
  })
  useDaemon.setState({ info: INFO })
})

it('initTheme applies the stored preference before render', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  initTheme()
  expect(document.documentElement.dataset.theme).toBe('dark')
})

it('settings page shows the current appearance and switching applies instantly and persists', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  initTheme()
  render(<SettingsPage go={() => {}} />)

  expect(screen.getByRole('radio', { name: '深色' }).getAttribute('aria-checked')).toBe('true')

  fireEvent.click(screen.getByRole('radio', { name: '浅色' }))
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  expect(screen.getByRole('radio', { name: '浅色' }).getAttribute('aria-checked')).toBe('true')
})

it('settings page switches the glass level and persists it', () => {
  render(<SettingsPage go={() => {}} />)
  expect(screen.getByRole('radio', { name: '标准' }).getAttribute('aria-checked')).toBe('true')

  fireEvent.click(screen.getByRole('radio', { name: '清透' }))
  expect(document.documentElement.dataset.glass).toBe('clear')
  expect(window.localStorage.getItem(GLASS_STORAGE_KEY)).toBe('clear')
  expect(screen.getByRole('radio', { name: '清透' }).getAttribute('aria-checked')).toBe('true')
})

it('跟随系统 resolves through prefers-color-scheme', () => {
  stubSystemTheme(true)
  render(<SettingsPage go={() => {}} />)
  fireEvent.click(screen.getByRole('radio', { name: '跟随系统' }))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
})
