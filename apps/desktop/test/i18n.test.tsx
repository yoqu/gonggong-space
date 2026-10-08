import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import './ipc-mock'

afterEach(() => localStorage.setItem('gg.locale', 'zh'))

it('renders English when the saved locale is en, and switching back stores Chinese', async () => {
  localStorage.setItem('gg.locale', 'en')
  vi.resetModules()
  const { ipc } = await import('../src/ipc')
  vi.mocked(ipc.settings).mockResolvedValue({
    autoUpgrade: true,
    launchAtLogin: false,
    mirror: { kind: 'npmmirror' },
    proxy: null,
    env: {},
  })
  const { SettingsPage } = await import('../src/pages/Settings')
  render(<SettingsPage go={() => {}} />)
  expect(await screen.findByRole('switch', { name: 'Auto upgrade' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Unbind…' })).toBeTruthy()
  expect(screen.getByText('Taobao mirror (npmmirror)')).toBeTruthy()

  fireEvent.click(screen.getByRole('radio', { name: '中文' }))
  expect(localStorage.getItem('gg.locale')).toBe('zh')
}, 30_000)
