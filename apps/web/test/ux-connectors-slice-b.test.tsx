import type {
  ConnectorCard,
  ConnectorCliView,
  ConnectorDto,
  ConnectorMachineView,
  MessageDto,
  WebEvent,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ConnectorCardView } from '../src/features/connectors/ConnectorCardView'
import { useConnectorStore } from '../src/features/connectors/store'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { bot, connector, group, manifest, me, openMenu, renderChat, routes, Where } from './connectorFixtures'
import { apiError, mockApi } from './mockApi'

const machine = (o: Partial<ConnectorMachineView> = {}): ConnectorMachineView => ({
  machineId: 'mc1',
  machineName: 'Mac-mini',
  own: true,
  profile: 'default',
  state: 'needs_login',
  account: null,
  verified: null,
  botIds: ['b1'],
  ...o,
})

const view = (o: Partial<ConnectorCliView> = {}): ConnectorCliView => ({
  state: 'needs_login',
  machines: [machine()],
  target: 'mc1',
  readyBotIds: [],
  ...o,
})

const lark = (cli: ConnectorCliView | null, o: Partial<ConnectorDto> = {}) =>
  connector({
    id: 'c5',
    manifest: manifest({
      name: 'feishu',
      title: '飞书',
      description: '文档、表格、日历',
      secrets: [],
      secretSpecs: [],
      connector: {
        examples: ['看看我今天的日程'],
        login: '帮我连接飞书',
        cli: { driver: 'lark-cli', npm: '@larksuite/cli', urlHosts: ['feishu.cn'] },
      },
    }),
    personal: false,
    connected: false,
    missing: [],
    status: 'unchecked',
    cli,
    ...o,
  })

const ready = (o: Partial<ConnectorMachineView> = {}) =>
  view({
    state: 'ready',
    machines: [machine({ state: 'ready', account: '王磊', verified: true, ...o })],
    readyBotIds: ['b1'],
  })

describe('Slice B Connectors TDD (U-06, U-07, U-08, U-24, U-25, U-26)', () => {
  const handlers = new Set<(e: WebEvent) => void>()
  beforeEach(() => {
    const subscribe = realtime.subscribe
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      handlers.add(h)
      const off = subscribe(h)
      return () => {
        handlers.delete(h)
        off()
      }
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    handlers.clear()
  })

  it('U-06: missing_scope card on an already-ready machine offers 补充授权 instead of dead-end connected actions', async () => {
    const calls = mockApi({
      'GET /groups/g1/connectors': { connectors: [lark(ready())] },
      'POST /groups/g1/connectors/c5/cli': { requestId: 'r1', machineId: 'mc1' },
    })
    useSession.setState({ user: me })
    useConnectorStore.setState({ lists: {} })
    const card: ConnectorCard = {
      id: 'cc1',
      pluginId: 'c5',
      connector: 'feishu',
      title: '飞书',
      userId: me.id,
      machineId: 'mc1',
      reason: 'missing_scope',
      domains: ['calendar', 'docs'],
      resolved: false,
    }
    render(
      <MemoryRouter>
        <ConnectorCardView m={{ id: 'm1', groupId: 'g1', body: '' } as MessageDto} card={card} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    expect(within(dialog).getByText('需要补充权限：calendar、docs')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '补充授权' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'connect',
        machineId: 'mc1',
        domains: ['calendar', 'docs'],
      }),
    )
  })

  it('U-07: ?connector=<id> opens ConnectorDialog once loaded and strips the query param', async () => {
    mockApi(routes([lark(ready())]))
    render(
      <MemoryRouter initialEntries={['/g/g1?connector=c5']}>
        <App />
        <Where />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('dialog', { name: '飞书' })).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/g/g1'))
  })

  it('U-08: non-owner unconnected/offline/errored CLI connectors hide the per-group Switch in menu and dialog', async () => {
    mockApi(
      routes([
        lark(view({ state: 'needs_login', machines: [machine({ own: false })], target: null }), {
          id: 'c6',
          manifest: manifest({ name: 'meegle', title: '飞书项目' }),
        }),
        lark(view({ state: 'no_machine', machines: [], target: null }), {
          id: 'c7',
          manifest: manifest({ name: 'x', title: '某系统' }),
        }),
        lark(view({ state: 'error', machines: [machine({ own: false, state: 'error' })], target: null }), {
          id: 'c8',
          manifest: manifest({ name: 'y', title: '告警系统' }),
        }),
      ]),
    )
    renderChat()
    const menu = await openMenu()
    await within(menu).findByText('飞书项目')
    expect(within(menu).queryAllByRole('switch')).toHaveLength(0)

    fireEvent.click(within(menu).getByRole('button', { name: '飞书项目' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    expect(within(dialog).queryByRole('switch')).toBeNull()
  })

  it('U-24: closing ConnectorDialog while CLI run is active asks confirmation before canceling', async () => {
    const calls = mockApi({
      ...routes([lark(view())]),
      'POST /groups/g1/connectors/c5/cli': (b: unknown) =>
        (b as { action: string }).action === 'connect' ? { requestId: 'r1', machineId: 'mc1' } : lark(view()),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await within(dialog).findByText('正在连接…')

    // Pressing Escape prompts instead of immediately canceling.
    fireEvent.keyDown(document, { key: 'Escape' })
    const alert = await screen.findByRole('alertdialog', { name: '要取消当前连接吗？' })
    expect(calls.filter((c) => (c.body as { action?: string })?.action === 'cancel')).toHaveLength(0)

    // Keep waiting preserves the active run.
    fireEvent.click(within(alert).getByRole('button', { name: '继续连接' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(within(dialog).getByText('正在连接…')).toBeTruthy()

    // Confirm cancel aborts and closes.
    fireEvent.keyDown(document, { key: 'Escape' })
    const alert2 = await screen.findByRole('alertdialog', { name: '要取消当前连接吗？' })
    fireEvent.click(within(alert2).getByRole('button', { name: '取消连接' }))
    await waitFor(() =>
      expect(calls.filter((c) => (c.body as { action?: string })?.action === 'cancel')).toHaveLength(1),
    )
  })

  it('U-25: multi-machine CliConnect exposes per-machine detect/logout naming the computer, retries failed detect, and warns on partial-ready bots', async () => {
    const bot2 = { ...bot, id: 'b2', name: '研发助手', machineId: 'mc2' }
    const cli = view({
      state: 'ready',
      target: 'mc2',
      readyBotIds: ['b1'],
      machines: [
        machine({
          machineId: 'mc1',
          machineName: 'Mac-A',
          own: true,
          state: 'ready',
          account: '王磊',
          botIds: ['b1'],
        }),
        machine({ machineId: 'mc2', machineName: 'Mac-B', own: true, state: 'needs_login', botIds: ['b2'] }),
      ],
    })
    let failDetect = true
    const calls = mockApi({
      ...routes([lark(cli)]),
      'GET /groups': [{ ...group, botIds: ['b1', 'b2'] }],
      'GET /bots': [bot, bot2],
      'POST /groups/g1/connectors/c5/cli': (b: unknown) => {
        const body = b as { action: string }
        if (body.action === 'detect' && failDetect) return apiError(500, 'internal', '检测失败')
        return lark(cli)
      },
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    expect(within(dialog).getByText(/研发助手 所在电脑尚未连接飞书/)).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: '电脑 · 2' }))
    const list = within(dialog).getByRole('list', { name: '各电脑的连接状态' })
    fireEvent.click(within(list).getByRole('button', { name: '重新检测 Mac-A' }))
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('检测失败')).toBeTruthy()
    failDetect = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect(calls.filter((c) => (c.body as { action?: string })?.action === 'detect')).toHaveLength(2),
    )

    fireEvent.click(within(list).getByRole('button', { name: '退出 Mac-A 登录' }))
    expect(await screen.findByRole('alertdialog', { name: '退出 Mac-A 上的「飞书」登录？' })).toBeTruthy()
  })

  it('U-26: non-owner ConnectorCardView shows requesting Bot and computer owner name', () => {
    useSession.setState({ user: me })
    useWorkspace.setState({ groups: [group], bots: [bot] })
    const card: ConnectorCard = {
      id: 'cc2',
      pluginId: 'c5',
      connector: 'feishu',
      title: '飞书',
      userId: 'u9',
      machineId: 'mc2',
      reason: 'unconnected',
      domains: [],
      resolved: false,
    }
    const m = {
      id: 'm2',
      groupId: 'g1',
      body: '设计搭档 请 陈思远 连接飞书',
      i18n: {
        key: '{bot} 请 {user} 连接{title}',
        params: { bot: '设计搭档', user: '陈思远', title: '飞书' },
      },
    } as unknown as MessageDto
    render(
      <MemoryRouter>
        <ConnectorCardView m={m} card={card} />
        <Toaster />
      </MemoryRouter>,
    )
    expect(screen.getByText(/设计搭档/)).toBeTruthy()
    expect(screen.getByText('等待电脑主人 陈思远 连接')).toBeTruthy()
  })
})
