import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import './ipc-mock'
import { ipc } from '../src/ipc'
import { Shell } from '../src/shell/Shell'
import { useDaemon } from '../src/store'
import { INFO, run, status } from './ipc-mock'

const m = vi.mocked(ipc)
const toolbar = () => document.querySelector('.dk-toolbar') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  m.bots.mockResolvedValue([])
  m.overview.mockResolvedValue({ workspaces: { count: 0, detail: '' } })
  m.settings.mockResolvedValue({ autoUpgrade: true, launchAtLogin: false })
  useDaemon.setState({
    info: INFO,
    snapshot: { phase: 'running', status: status({ runs: [run({ runId: 'r1', groupName: '官网改版' })] }) },
  })
})

it('titles 设置 in the toolbar like every other page', () => {
  render(<Shell />)
  fireEvent.click(screen.getByRole('button', { name: '设置' }))
  expect(within(toolbar()).getByRole('heading', { name: '设置' })).toBeTruthy()
  expect(within(toolbar()).getByText('外观、升级、启动项与存储位置')).toBeTruthy()
  expect(screen.getAllByRole('heading', { name: '设置' })).toHaveLength(1)
})

it('titles a run detail after the run instead of the overview', async () => {
  m.runProcess.mockResolvedValue({
    run: run({ runId: 'r1', groupName: '官网改版' }),
    events: [],
    endedMs: null,
    outcome: null,
  })
  render(<Shell />)
  fireEvent.click(within(screen.getByTestId('running')).getByRole('button', { name: /小王的 Claude/ }))
  expect(await within(toolbar()).findByRole('heading', { name: '小王的 Claude' })).toBeTruthy()
  expect(within(toolbar()).getByText('官网改版 · 王磊 触发')).toBeTruthy()
  expect(toolbar().textContent).not.toContain('本机执行端状态与正在运行的轮次')
  fireEvent.click(screen.getByRole('button', { name: '返回' }))
  expect(within(toolbar()).getByRole('heading', { name: '概览' })).toBeTruthy()
})
