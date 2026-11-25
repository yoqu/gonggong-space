import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { App } from '../src/App'
import { ipc, onOpenLinks } from '../src/ipc'
import { useDaemon } from '../src/store'
import { INFO, status } from './ipc-mock'

const m = vi.mocked(ipc)
const LINK = 'gonggong://bind?server=https%3A%2F%2Fevil.example&code=K7QM-4X2P'

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: null, snapshot: { phase: 'unbound' }, botGuideDismissed: false })
  m.snapshot.mockResolvedValue({ phase: 'unbound' })
  m.readClipboard.mockResolvedValue('')
  m.parseLink.mockResolvedValue({ server: 'https://evil.example', code: 'K7QM-4X2P' })
  m.bots.mockResolvedValue([])
  m.overview.mockResolvedValue({ workspaces: { count: 0, detail: '' } })
  m.openWeb.mockResolvedValue()
  vi.mocked(onOpenLinks).mockImplementation(async (cb) => {
    cb([LINK])
    return () => {}
  })
})

it('asks to unbind first when a link opens the app while bound', async () => {
  m.appInfo.mockResolvedValue(INFO)
  render(<App />)
  await screen.findByText('本机已绑定到 gonggong.corp.cn，请先在设置中解绑')
  expect(m.login).not.toHaveBeenCalled()
  expect(screen.queryByLabelText('接入链接')).toBeNull()
})

it('prefills the onboarding with a link that opened the app while unbound', async () => {
  m.appInfo.mockResolvedValue({ ...INFO, server: null, ownerName: null })
  render(<App />)
  await screen.findByText('evil.example')
  expect((screen.getByLabelText('接入链接') as HTMLInputElement).value).toBe(LINK)
  expect(m.login).not.toHaveBeenCalled()
})

it('shows the inline create-Bot guide on Overview after binding without auto-launching the browser', async () => {
  useDaemon.setState({ botGuideDismissed: true })
  m.appInfo.mockResolvedValue({ ...INFO, server: null, ownerName: null })
  m.login.mockResolvedValue()
  m.startDaemon.mockResolvedValue()
  render(<App />)
  await screen.findByText('evil.example')
  m.appInfo.mockResolvedValue(INFO)
  fireEvent.click(screen.getByRole('button', { name: '绑定' }))
  await screen.findByText('这台电脑的连接状态与正在运行的任务')
  useDaemon.setState({ snapshot: { phase: 'running', status: status() } })
  expect(await screen.findByText('电脑已接入，接下来创建你的第一个 Bot')).toBeTruthy()
  expect(m.openWeb).not.toHaveBeenCalled()
})
