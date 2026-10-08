import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc, type Update } from '../src/ipc'
import { SettingsPage } from '../src/pages/Settings'
import { UpdateBanner } from '../src/shell/UpdateBanner'
import { useDaemon } from '../src/store'
import { startUpdater, useUpdate } from '../src/updater'
import { INFO, run, status } from './ipc-mock'

const m = vi.mocked(ipc)

function fakeUpdate(calls: string[]) {
  return {
    version: '0.2.0',
    download: vi.fn(async () => {
      calls.push('download')
    }),
    install: vi.fn(async () => {
      calls.push('install')
    }),
  } as unknown as Update
}

let calls: string[]

beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  useUpdate.setState({ state: { phase: 'idle' }, dismissed: false })
  useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: status() } })
  m.settings.mockResolvedValue({
    autoUpgrade: true,
    launchAtLogin: false,
    mirror: { kind: 'npmmirror' },
    proxy: null,
    env: {},
  })
  m.checkUpdate.mockResolvedValue(fakeUpdate(calls))
  m.stopDaemon.mockImplementation(async () => {
    calls.push('stop')
  })
  m.relaunch.mockImplementation(async () => {
    calls.push('relaunch')
  })
})

it('downloads an update at launch, offers a restart and can be put off', async () => {
  render(<UpdateBanner />)
  const stop = startUpdater()
  const banner = await screen.findByRole('alert')
  expect(banner.textContent).toContain('新版本 v0.2.0 已下载，重启以更新')
  expect(calls).toEqual(['download'])
  fireEvent.click(within(banner).getByRole('button', { name: '稍后' }))
  expect(screen.queryByRole('alert')).toBeNull()
  stop()
})

it('does not check by itself while 自动升级 is off', async () => {
  m.settings.mockResolvedValue({
    autoUpgrade: false,
    launchAtLogin: false,
    mirror: { kind: 'npmmirror' },
    proxy: null,
    env: {},
  })
  const stop = startUpdater()
  await act(async () => {})
  expect(m.checkUpdate).not.toHaveBeenCalled()
  stop()
})

it('installs, stops the daemon and relaunches when nothing runs', async () => {
  render(<UpdateBanner />)
  startUpdater()()
  fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '立即重启' }))
  await waitFor(() => expect(calls).toEqual(['download', 'install', 'stop', 'relaunch']))
})

it('warns before interrupting running tasks', async () => {
  useDaemon.setState({ snapshot: { phase: 'running', status: status({ runs: [run({})] }) } })
  render(<UpdateBanner />)
  startUpdater()()
  fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: '立即重启' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog.textContent).toContain('有运行中的任务，重启会中断')
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  expect(m.relaunch).not.toHaveBeenCalled()

  fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '立即重启' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '仍然重启' }))
  await waitFor(() => expect(calls).toEqual(['download', 'install', 'stop', 'relaunch']))
})

it('checks by hand in Settings and shows the version and the outcome', async () => {
  m.checkUpdate.mockResolvedValueOnce(null).mockRejectedValueOnce('network down')
  render(<SettingsPage go={() => {}} />)
  expect(screen.getByText('v0.1.0')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('已是最新版本')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('检查更新失败：network down')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
  expect(await screen.findByText('v0.2.0 已下载，重启以更新')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '立即重启' }))
  await waitFor(() => expect(calls).toEqual(['download', 'install', 'stop', 'relaunch']))
})
