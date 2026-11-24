import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { SettingsPage } from '../src/pages/Settings'
import { useDaemon } from '../src/store'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)

beforeEach(() => {
  vi.clearAllMocks()
  m.settings.mockResolvedValue({
    autoUpgrade: true,
    launchAtLogin: false,
    hideDockOnClose: false,
    mirror: { kind: 'npmmirror' },
    env: { FOO: '1' },
  })
  m.setAutoUpgrade.mockResolvedValue()
  m.setLaunchAtLogin.mockResolvedValue()
  m.setHideDockOnClose.mockResolvedValue()
  m.unbind.mockResolvedValue()
  m.reveal.mockResolvedValue()
  useDaemon.setState({ info: INFO })
})

it('offers the menu-bar-only preference on macOS and saves it', async () => {
  render(<SettingsPage go={() => {}} />)
  const dock = await screen.findByRole('switch', { name: '关闭窗口后隐藏程序坞图标' })
  expect(dock).toHaveProperty('checked', false)
  fireEvent.click(dock)
  await waitFor(() => expect(dock).toHaveProperty('checked', true))
  expect(m.setHideDockOnClose).toHaveBeenCalledWith(true)
})

it('does not show the macOS dock preference on other platforms', async () => {
  useDaemon.setState({ info: { ...INFO, machine: { ...INFO.machine, os: 'windows' } } })
  render(<SettingsPage go={() => {}} />)
  await screen.findByRole('switch', { name: '自动升级' })
  expect(screen.queryByRole('switch', { name: '关闭窗口后隐藏程序坞图标' })).toBeNull()
})

it('shows local paths and the server, toggles preferences and unbinds after confirmation', async () => {
  render(<SettingsPage go={() => {}} />)
  expect(screen.getByRole('navigation', { name: '~/.gonggong/workspaces' })).toBeTruthy()
  const backups = screen.getByRole('navigation', { name: '~/.gonggong/backups' })
  fireEvent.click(within(backups).getByRole('button', { name: 'backups' }))
  expect(m.reveal).toHaveBeenCalledWith('/Users/wl/.gonggong/backups')
  expect(screen.getByText('gonggong.corp.cn')).toBeTruthy()
  expect(screen.getByText('由本机主动加密连接服务器')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '帮助' }))
  expect(screen.getByText('发现不兼容的旧版本时，会提示你升级后再连接。')).toBeTruthy()

  const upgrade = screen.getByRole('switch', { name: '自动升级' })
  await waitFor(() => expect(upgrade).toHaveProperty('checked', true))
  fireEvent.click(upgrade)
  await waitFor(() => expect(upgrade).toHaveProperty('checked', false))
  expect(m.setAutoUpgrade).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('switch', { name: '开机启动' }))
  expect(m.setLaunchAtLogin).toHaveBeenCalledWith(true)

  let resolveUnbind: () => void = () => {}
  m.unbind.mockImplementationOnce(() => new Promise<void>((r) => (resolveUnbind = r)))
  fireEvent.click(screen.getByRole('button', { name: '解除绑定…' }))
  expect(m.unbind).not.toHaveBeenCalled()
  const dialog = screen.getByRole('alertdialog')
  expect(dialog.textContent).toContain('要解除这台电脑与团队服务器的绑定吗？')
  expect(dialog.textContent).toContain(
    '这台电脑将断开连接，团队密钥和托管工作区会被清理，你手动选择的本机目录和本地备份会保留。此操作不可撤销。',
  )
  expect(dialog.textContent).not.toContain('/cd')
  fireEvent.click(within(dialog).getByRole('button', { name: '解除绑定' }))
  expect(within(dialog).getByRole('button', { name: '解除绑定' }).getAttribute('aria-busy')).toBe('true')
  expect((within(dialog).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  await act(async () => resolveUnbind())
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

  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已保存'))

  fireEvent.click(screen.getByRole('button', { name: '镜像源' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '自定义' }))
  expect(m.setMirror).toHaveBeenCalledTimes(1)
  // Saved by itself, like on the web, once both addresses are in.
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
  const registry = screen.getByRole('textbox', { name: 'npm registry' })
  fireEvent.change(registry, { target: { value: 'https://r.corp.cn' } })
  fireEvent.blur(registry)
  expect(screen.getByText('还需要填写 Node.js 下载地址')).toBeTruthy()
  expect(m.setMirror).toHaveBeenCalledTimes(1)
  const node = screen.getByRole('textbox', { name: 'Node.js 下载地址' })
  fireEvent.change(node, { target: { value: 'https://r.corp.cn/node' } })
  fireEvent.keyDown(node, { key: 'Enter' })
  await waitFor(() =>
    expect(m.setMirror).toHaveBeenLastCalledWith({
      kind: 'custom',
      registry: 'https://r.corp.cn',
      node: 'https://r.corp.cn/node',
    }),
  )
})

it('saves the agent environment as KEY=VALUE lines and refuses a malformed line', async () => {
  m.setEnv.mockResolvedValue()
  render(<SettingsPage go={() => {}} />)
  const env = (await screen.findByRole('textbox', { name: '环境变量' })) as HTMLTextAreaElement
  expect(env.value).toBe('FOO=1')
  const save = screen.getByRole('button', { name: '保存环境变量' }) as HTMLButtonElement
  fireEvent.change(env, { target: { value: 'FOO=1\nbroken' } })
  fireEvent.click(save)
  expect(await screen.findByText('环境变量每行一个 KEY=VALUE：broken')).toBeTruthy()
  expect(m.setEnv).not.toHaveBeenCalled()
  fireEvent.change(env, { target: { value: 'FOO=1\n BAR = a=b \n' } })
  fireEvent.click(save)
  await waitFor(() => expect(m.setEnv).toHaveBeenCalledWith({ FOO: '1', BAR: 'a=b' }))
})

it('opens 连接诊断 from Settings', async () => {
  render(<SettingsPage go={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '连接诊断' }))
  const dialog = screen.getByRole('dialog', { name: '连接诊断' })
  expect(dialog.textContent).toContain('gonggong.corp.cn')
})

it('immediately makes the unbind AlertDialog inert and ignores activation after Esc', () => {
  render(<SettingsPage go={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '解除绑定…' }))
  const dialog = screen.getByRole('alertdialog')
  const danger = within(dialog).getByRole('button', { name: '解除绑定' })
  fireEvent.keyDown(document, { key: 'Escape' })
  const overlay = dialog.closest('.ui-overlay') as HTMLElement
  expect(overlay.hasAttribute('inert')).toBe(true)
  expect(overlay.getAttribute('aria-hidden')).toBe('true')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  fireEvent.click(danger)
  expect(m.unbind).not.toHaveBeenCalled()
})
