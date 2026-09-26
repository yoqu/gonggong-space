import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { App } from '../src/App'
import { ipc, onOpenLinks } from '../src/ipc'
import { useDaemon } from '../src/store'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)
const LINK = 'gonggong://bind?server=https%3A%2F%2Fevil.example&code=K7QM-4X2P'

beforeEach(() => {
  vi.clearAllMocks()
  useDaemon.setState({ info: null, snapshot: { phase: 'unbound' } })
  m.snapshot.mockResolvedValue({ phase: 'unbound' })
  m.readClipboard.mockResolvedValue('')
  m.parseLink.mockResolvedValue({ server: 'https://evil.example', code: 'K7QM-4X2P', fingerprint: null })
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
