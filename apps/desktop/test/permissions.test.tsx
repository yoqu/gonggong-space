import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { App } from '../src/App'
import { ipc, onOpenLinks, type PermissionState } from '../src/ipc'
import { PermissionsGuide } from '../src/onboarding/Permissions'
import { OverviewPage } from '../src/pages/Overview'
import { usePermissions } from '../src/permissions'
import { useDaemon } from '../src/store'
import { INFO, status } from './ipc-mock'

const m = vi.mocked(ipc)
const NONE: PermissionState[] = [
  { kind: 'screen_recording', granted: false },
  { kind: 'accessibility', granted: false },
]
const ALL: PermissionState[] = NONE.map((p) => ({ ...p, granted: true }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  usePermissions.setState({ list: [], guide: false })
  useDaemon.setState({ info: null, snapshot: { phase: 'unbound' } })
  m.permissions.mockResolvedValue(NONE)
  m.requestPermission.mockResolvedValue()
  m.snapshot.mockResolvedValue({ phase: 'unbound' })
  m.readClipboard.mockResolvedValue('')
  m.overview.mockResolvedValue({ workspaces: { count: 0, detail: '' } })
  m.bots.mockResolvedValue([])
  vi.mocked(onOpenLinks).mockResolvedValue(() => {})
})

const row = (label: string) => screen.getByText(label).closest('[data-testid="permission"]') as HTMLElement

describe('permissions guide', () => {
  it('says why each permission is needed, asks for it and follows its status when the app comes back', async () => {
    const onDone = vi.fn()
    render(<PermissionsGuide onDone={onDone} />)
    await screen.findByText('授予系统权限')
    await waitFor(() => expect(within(row('屏幕录制')).getByText('未授权')).toBeTruthy())
    expect(within(row('屏幕录制')).getByText(/实时画面/)).toBeTruthy()
    expect(within(row('辅助功能')).getByText(/远程操作/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重启共工空间' })).toBeNull()

    fireEvent.click(within(row('屏幕录制')).getByRole('button', { name: '去授权' }))
    await waitFor(() => expect(m.requestPermission).toHaveBeenCalledWith('screen_recording'))
    // Screen recording only takes effect once the app restarts.
    fireEvent.click(await screen.findByRole('button', { name: '重启共工空间' }))
    expect(m.restartApp).toHaveBeenCalled()

    m.permissions.mockResolvedValue([NONE[0] as PermissionState, { kind: 'accessibility', granted: true }])
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(within(row('辅助功能')).getByText('已授权')).toBeTruthy())
    expect(within(row('辅助功能')).queryByRole('button', { name: '去授权' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    expect(onDone).toHaveBeenCalled()
  })

  it('offers 完成 once everything is granted', async () => {
    m.permissions.mockResolvedValue(ALL)
    render(<PermissionsGuide onDone={() => {}} />)
    await screen.findByRole('button', { name: '完成' })
  })
})

describe('reminders', () => {
  it('overview shows what is missing and reopens the guide', async () => {
    usePermissions.setState({ list: NONE })
    useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: status() } })
    render(<OverviewPage go={() => {}} />)
    await screen.findByText('未授权：屏幕录制、辅助功能')
    fireEvent.click(screen.getByRole('button', { name: '去授权' }))
    expect(usePermissions.getState().guide).toBe(true)
  })

  it('overview says nothing when nothing is needed (Windows, Linux) or all is granted', () => {
    useDaemon.setState({ info: INFO, snapshot: { phase: 'running', status: status() } })
    usePermissions.setState({ list: ALL })
    render(<OverviewPage go={() => {}} />)
    expect(screen.queryByText(/未授权/)).toBeNull()
  })
})

describe('app', () => {
  it('opens the guide on the first launch that finds a permission missing, then only on request', async () => {
    m.appInfo.mockResolvedValue(INFO)
    const first = render(<App />)
    await screen.findByText('授予系统权限')
    fireEvent.click(screen.getByRole('button', { name: '稍后' }))
    await screen.findByText('本机执行端状态与正在运行的轮次')
    first.unmount()

    usePermissions.setState({ list: [], guide: false })
    render(<App />)
    await screen.findByText('本机执行端状态与正在运行的轮次')
    expect(screen.queryByText('授予系统权限')).toBeNull()
  })

  it('shows no guide where nothing is needed', async () => {
    m.appInfo.mockResolvedValue(INFO)
    m.permissions.mockResolvedValue([])
    render(<App />)
    await screen.findByText('本机执行端状态与正在运行的轮次')
    expect(screen.queryByText('授予系统权限')).toBeNull()
  })

  it('goes on to the guide right after binding', async () => {
    localStorage.setItem('gg.permissionsGuide', 'seen')
    m.appInfo.mockResolvedValue({ ...INFO, server: null, ownerName: null })
    m.parseLink.mockResolvedValue({
      server: 'https://gonggong.corp.cn',
      code: 'K7QM-4X2P',
      fingerprint: null,
    })
    m.login.mockResolvedValue()
    m.startDaemon.mockResolvedValue()
    render(<App />)
    const input = await screen.findByLabelText('接入链接')
    fireEvent.change(input, {
      target: { value: 'gg login --server https://gonggong.corp.cn --code k7qm-4x2p' },
    })
    await screen.findByText('K7QM-4X2P')
    m.appInfo.mockResolvedValue(INFO)
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))
    await screen.findByText('授予系统权限')
  })
})
