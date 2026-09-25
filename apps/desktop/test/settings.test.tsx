import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { SettingsPage } from '../src/pages/Settings'
import { useDaemon } from '../src/store'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.settings.mockResolvedValue({ autoUpgrade: true, launchAtLogin: false })
  m.setAutoUpgrade.mockResolvedValue()
  m.setLaunchAtLogin.mockResolvedValue()
  m.unbind.mockResolvedValue()
  m.reveal.mockResolvedValue()
  useDaemon.setState({ info: INFO })
})

it('shows local paths and the server, toggles preferences and unbinds after confirmation', async () => {
  render(<SettingsPage go={() => {}} />)
  expect(screen.getByRole('navigation', { name: '~/.gonggong/workspaces' })).toBeTruthy()
  const backups = screen.getByRole('navigation', { name: '~/.gonggong/backups' })
  fireEvent.click(within(backups).getByRole('button', { name: 'backups' }))
  expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/backups')
  expect(screen.getByText('gonggong.corp.cn')).toBeTruthy()

  const upgrade = screen.getByRole('switch', { name: '自动升级' })
  await waitFor(() => expect(upgrade).toHaveProperty('checked', true))
  fireEvent.click(upgrade)
  await waitFor(() => expect(upgrade).toHaveProperty('checked', false))
  expect(m.setAutoUpgrade).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('switch', { name: '开机启动' }))
  expect(m.setLaunchAtLogin).toHaveBeenCalledWith(true)

  fireEvent.click(screen.getByRole('button', { name: '解除绑定…' }))
  expect(m.unbind).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '解除绑定' }))
  expect(m.unbind).toHaveBeenCalled()
})
