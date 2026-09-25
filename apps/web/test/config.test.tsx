import type { McpServerDto, UserDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { mockApi } from './mockApi'

const admin: UserDto = {
  id: 'u0',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
}

const wiki: McpServerDto = {
  id: 'm1',
  enabled: true,
  config: {
    transport: 'stdio',
    name: 'wiki-search',
    command: 'npx',
    args: ['@corp/mcp-wiki'],
    env: { TOKEN: 'x' },
  },
  updatedAt: '2026-09-23T01:00:00Z',
}
const grafana: McpServerDto = {
  id: 'm2',
  enabled: false,
  config: { transport: 'http', name: 'grafana', url: 'https://mcp.corp/grafana', headers: {} },
  updatedAt: '2026-09-23T01:00:00Z',
}

class NoopSocket {
  close() {}
}

const renderConfig = () =>
  render(
    <MemoryRouter initialEntries={['/admin/config']}>
      <App />
    </MemoryRouter>,
  )

const row = (name: string) => screen.getByText(name).closest('[data-testid="cfg-item"]') as HTMLElement

beforeEach(() => {
  vi.stubGlobal('WebSocket', NoopSocket)
  useSession.setState({ user: admin, status: 'ready' })
})
afterEach(() => vi.unstubAllGlobals())

describe('配置中心', () => {
  it('shows the layers and types of the prototype; only the global MCP list is live in P1', async () => {
    mockApi({
      'GET /admin/mcp': [wiki, grafana],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
    })
    renderConfig()
    expect(await screen.findByRole('heading', { name: '配置中心' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '服务器全局层' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '服务器群层' }).hasAttribute('disabled')).toBe(true)
    await screen.findByText('wiki-search')
    expect(row('wiki-search').textContent).toContain('npx @corp/mcp-wiki · env TOKEN')
    expect(row('grafana').textContent).toContain('https://mcp.corp/grafana')
    expect(within(row('wiki-search')).getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(within(row('grafana')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    const builtin = row('gonggong')
    expect(builtin.textContent).toContain('系统内置 · 始终注入，不受层级影响')
    expect(builtin.textContent).toContain(
      '向群成员提问、读取聊天记录、检索聊天记录、群信息与成员、查看运行记录、提问卡片历史、下载历史附件',
    )
    expect((within(builtin).getByRole('switch') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/合并预览/)).toBeTruthy()
    expect(screen.getByText(/MCP 在新建会话时经 ACP 注入不落盘/)).toBeTruthy()
    expect(
      (screen.getByRole('checkbox', { name: '强制相关 Bot 下一轮开新会话' }) as HTMLInputElement).checked,
    ).toBe(false)

    fireEvent.click(screen.getByRole('tab', { name: 'Skill' }))
    expect(screen.getByText('暂不支持 Skill')).toBeTruthy()
    expect(screen.queryByText(/一期|二期|三期/)).toBeNull()
    expect(screen.queryByText('wiki-search')).toBeNull()
  })

  it('saves toggles, additions and removals; forcing a new session is opt-in', async () => {
    const calls = mockApi({
      'GET /admin/mcp': [wiki, grafana],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
      'PATCH /admin/mcp/m1': (b: unknown) => ({ ...wiki, ...(b as object) }),
      'DELETE /admin/mcp/m2?forceNewSession=true': undefined,
      'POST /admin/mcp': (b: unknown) => ({ id: 'm3', updatedAt: '', ...(b as object) }),
    })
    renderConfig()
    await screen.findByText('wiki-search')
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(within(row('wiki-search')).getByRole('switch'))
    fireEvent.click(within(row('grafana')).getByRole('button', { name: '删除 grafana' }))
    expect(screen.queryByText('grafana')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '添加 MCP' }))
    const dialog = await screen.findByRole('dialog', { name: '添加 MCP' })
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'gonggong-echo' } })
    fireEvent.change(within(dialog).getByLabelText('命令'), { target: { value: 'node' } })
    fireEvent.change(within(dialog).getByLabelText('参数（每行一个）'), {
      target: { value: '/opt/echo/server.js' },
    })
    fireEvent.change(within(dialog).getByLabelText('环境变量（每行 KEY=VALUE）'), {
      target: { value: 'A=1\nB=x=y' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(row('gonggong-echo').textContent).toContain('node /opt/echo/server.js · env A, B')

    fireEvent.click(screen.getByRole('checkbox', { name: '强制相关 Bot 下一轮开新会话' }))
    fireEvent.click(save)
    expect(await screen.findByText('已保存，全员下一轮新会话生效')).toBeTruthy()
    expect(screen.getByText('已要求相关 Bot 下一轮开新会话，卡片会提示原因。')).toBeTruthy()
    const writes = calls.filter((c) => c.method !== 'GET')
    expect(writes).toEqual(
      expect.arrayContaining([
        {
          method: 'PATCH',
          path: '/admin/mcp/m1',
          body: { enabled: false, config: wiki.config, forceNewSession: true },
        },
        { method: 'DELETE', path: '/admin/mcp/m2?forceNewSession=true', body: undefined },
        {
          method: 'POST',
          path: '/admin/mcp',
          body: {
            enabled: true,
            forceNewSession: true,
            config: {
              transport: 'stdio',
              name: 'gonggong-echo',
              command: 'node',
              args: ['/opt/echo/server.js'],
              env: { A: '1', B: 'x=y' },
            },
          },
        },
      ]),
    )
    expect(writes).toHaveLength(3)
    await waitFor(() => expect(save.disabled).toBe(true))
  })

  it('describes the unforced save and rejects the reserved built-in name in the add dialog', async () => {
    mockApi({
      'GET /admin/mcp': [wiki],
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
      'PATCH /admin/mcp/m1': (b: unknown) => ({ ...wiki, ...(b as object) }),
    })
    renderConfig()
    await screen.findByText('wiki-search')
    fireEvent.click(screen.getByRole('button', { name: '添加 MCP' }))
    const dialog = await screen.findByRole('dialog', { name: '添加 MCP' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'HTTP' }))
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: 'gonggong' } })
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: 'https://x' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(within(dialog).getByText('gonggong 是系统内置 MCP 的名称')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    fireEvent.click(within(row('wiki-search')).getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('运行中的轮次不受影响；已有会话继续使用旧配置。')).toBeTruthy()
  })

  it('shows a failed load inline with one message and retries', async () => {
    let down = true
    mockApi({
      'GET /admin/mcp': () => (down ? new Response('', { status: 502, statusText: 'Bad Gateway' }) : [wiki]),
      'GET /bots': [],
      'GET /machines': [],
      'GET /notifications': [],
    })
    renderConfig()
    const alert = await screen.findByText('配置加载失败')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText(/Bad Gateway/)).toBeNull()
    expect(alert).toBeTruthy()
    down = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('wiki-search')).toBeTruthy()
    expect(screen.queryByText('配置加载失败')).toBeNull()
  })
})
