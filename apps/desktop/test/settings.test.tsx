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
  m.settings.mockResolvedValue({ autoUpgrade: true, launchAtLogin: false, mirror: { kind: 'npmmirror' } })
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

it('switches the download mirror, a custom one only with both addresses', async () => {
  m.setMirror.mockResolvedValue()
  render(<SettingsPage go={() => {}} />)
  const mirror = await screen.findByRole('button', { name: '镜像源' })
  expect(mirror.textContent).toContain('淘宝镜像（npmmirror）')
  fireEvent.click(mirror)
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '官方源' }))
  await waitFor(() => expect(m.setMirror).toHaveBeenCalledWith({ kind: 'official' }))

  fireEvent.click(screen.getByRole('button', { name: '镜像源' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '自定义' }))
  expect(m.setMirror).toHaveBeenCalledTimes(1)
  const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'npm registry' }), {
    target: { value: 'https://r.corp.cn' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Node.js 下载地址' }), {
    target: { value: 'https://r.corp.cn/node' },
  })
  fireEvent.click(save)
  await waitFor(() =>
    expect(m.setMirror).toHaveBeenLastCalledWith({
      kind: 'custom',
      registry: 'https://r.corp.cn',
      node: 'https://r.corp.cn/node',
    }),
  )
})
