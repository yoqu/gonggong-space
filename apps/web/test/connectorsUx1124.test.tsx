import type {
  ConnectorCard,
  ConnectorCliView,
  ConnectorDto,
  ConnectorMachineView,
  MessageDto,
  WebEvent,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { ConnectorCardView } from '../src/features/connectors/ConnectorCardView'
import { useConnectorStore } from '../src/features/connectors/store'
import { realtime } from '../src/lib/realtime'
import { Toaster } from '../src/ui'
import { connector, manifest, me, openMenu, renderChat, routes } from './connectorFixtures'
import { apiError, mockApi } from './mockApi'

const dw = connector()
const meegle = connector({
  id: 'c3',
  manifest: manifest({
    name: 'meegle',
    title: '飞书项目',
    description: '查需求、缺陷和排期',
    connector: { examples: ['我这周有哪些待办'] },
  }),
  connected: true,
  missing: [],
  status: 'ok',
})

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

const cliView = (o: Partial<ConnectorCliView> = {}): ConnectorCliView => ({
  state: 'needs_login',
  machines: [machine()],
  target: 'mc1',
  readyBotIds: [],
  ...o,
})

const lark = (cli: ConnectorCliView | null = cliView()): ConnectorDto =>
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
  })

describe('连接器 UX 修复 · ConnectorCardView', () => {
  const card = (o: Partial<ConnectorCard> = {}): ConnectorCard => ({
    id: 'cc1',
    pluginId: 'c5',
    connector: 'feishu',
    title: '飞书',
    userId: me.id,
    machineId: 'mc1',
    reason: 'unconnected',
    domains: [],
    resolved: false,
    ...o,
  })

  const renderCard = (c: ConnectorCard = card()) =>
    render(
      <MemoryRouter>
        <ConnectorCardView m={{ id: 'm1', groupId: 'g1' } as MessageDto} card={c} />
        <Toaster />
      </MemoryRouter>,
    )

  beforeEach(() => {
    useSession.setState({ user: me })
    useConnectorStore.setState({ lists: {}, errors: {} })
  })

  it('prevents double clicks with loading state while fetching connectors', async () => {
    let resolveList!: (v: unknown) => void
    const calls = mockApi({
      'GET /groups/g1/connectors': () => new Promise((r) => (resolveList = r)),
    })
    renderCard()
    const btn = screen.getByRole('button', { name: '连接' }) as HTMLButtonElement
    fireEvent.click(btn)
    await waitFor(() => expect(btn.disabled).toBe(true))
    fireEvent.click(btn)
    expect(calls.filter((c) => c.path === '/groups/g1/connectors')).toHaveLength(1)

    await act(async () => resolveList({ connectors: [lark()] }))
    expect(await screen.findByRole('dialog', { name: '飞书' })).toBeTruthy()
  })

  it('shows error toast instead of silently opening when load fails', async () => {
    mockApi({
      'GET /groups/g1/connectors': () => apiError(500, 'internal', '网络不可用'),
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    expect(await screen.findByText('网络不可用')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '飞书' })).toBeNull()
  })

  it('shows error toast when connector is missing after load', async () => {
    mockApi({
      'GET /groups/g1/connectors': { connectors: [dw] },
    })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    expect(await screen.findByText('无法打开连接器，请确认已在市场安装并启用')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '飞书' })).toBeNull()
  })
})

describe('连接器 UX 修复 · ConnectorDialog & CliConnect', () => {
  const handlers = new Set<(e: WebEvent) => void>()
  const emit = (e: WebEvent) =>
    act(() => {
      for (const h of handlers) h(e)
    })

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

  it('submits key form on Enter and uses type="submit" on connect button', async () => {
    const calls = mockApi({
      ...routes([dw]),
      'POST /groups/g1/connectors/c1/connect': connector({ connected: true, missing: [], status: 'ok' }),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '数仓' })
    const btn = within(dialog).getByRole('button', { name: '连接' }) as HTMLButtonElement
    expect(btn.type).toBe('submit')
    const input = within(dialog).getByLabelText('DW_MANAGER_API_KEY')
    fireEvent.change(input, { target: { value: 'sk-12345678' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/connectors/c1/connect')?.body).toEqual({
        values: { DW_MANAGER_API_KEY: 'sk-12345678' },
      }),
    )
  })

  it('allows backdrop close after clearing draft, and blocks closing while submitting', async () => {
    let finishConnect!: (v: unknown) => void
    mockApi({
      ...routes([dw]),
      'POST /groups/g1/connectors/c1/connect': () => new Promise((r) => (finishConnect = r)),
    })
    renderChat()
    let menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    let dialog = await screen.findByRole('dialog', { name: '数仓' })
    const input = within(dialog).getByLabelText('DW_MANAGER_API_KEY')

    // Typing blocks backdrop close.
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(screen.getByRole('dialog', { name: '数仓' })).toBeTruthy()

    // Clearing restores backdrop close.
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '数仓' })).toBeNull())

    // Reopen and submit: busy blocks backdrop and Escape close.
    menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '连接' }))
    dialog = await screen.findByRole('dialog', { name: '数仓' })
    fireEvent.change(within(dialog).getByLabelText('DW_MANAGER_API_KEY'), {
      target: { value: 'sk-12345678' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '连接' }).getAttribute('aria-busy')).toBe('true'),
    )
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '数仓' })).toBeTruthy()

    await act(async () => finishConnect(connector({ connected: true, missing: [], status: 'ok' })))
    expect(await within(dialog).findByRole('button', { name: '去试试' })).toBeTruthy()
  })

  it('locks in-group switch while toggling in ConnectorDialog and shows toast on success', async () => {
    let finishSwitch!: (v: unknown) => void
    const calls = mockApi({
      ...routes([meegle]),
      'PUT /groups/g1/connectors/c3/switch': () => new Promise((r) => (finishSwitch = r)),
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书项目' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书项目' })
    const sw = within(dialog).getByRole('switch') as HTMLInputElement
    fireEvent.click(sw)
    await waitFor(() => expect(sw.disabled).toBe(true))
    fireEvent.click(sw)
    expect(calls.filter((c) => c.path === '/groups/g1/connectors/c3/switch')).toHaveLength(1)

    await act(async () => finishSwitch({ ...meegle, on: false }))
    await waitFor(() => expect(sw.disabled).toBe(false))
    expect(await screen.findByText('已在本群停用「飞书项目」，Bot 处理你的消息时不再使用它')).toBeTruthy()
  })

  it('copies CLI userCode with one click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    mockApi({
      ...routes([lark()]),
      'POST /groups/g1/connectors/c5/cli': { requestId: 'r1', machineId: 'mc1' },
    })
    renderChat()
    const menu = await openMenu()
    fireEvent.click(await within(menu).findByRole('button', { name: '飞书' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await within(dialog).findByText('正在连接…')
    emit({
      t: 'connector.cli.auth',
      requestId: 'r1',
      step: 'login',
      url: 'https://accounts.feishu.cn/device?code=ABCD',
      userCode: 'ABCD-1234',
      expiresAt: null,
    })
    const copyBtn = within(dialog).getByRole('button', { name: '复制验证码' })
    fireEvent.click(copyBtn)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD-1234'))
    expect(await screen.findByText('已复制验证码')).toBeTruthy()
  })
})

describe('连接器 UX 修复 · ConnectorMenu', () => {
  it('shows Alert with retry button when loading connectors fails', async () => {
    let failed = true
    mockApi({
      ...routes([meegle]),
      'GET /groups/g1/connectors': () =>
        failed ? apiError(500, 'internal', '加载连接器失败') : { connectors: [meegle] },
    })
    renderChat()
    const menu = await openMenu()
    const alert = await within(menu).findByRole('alert')
    expect(within(alert).getByText('加载连接器失败')).toBeTruthy()
    failed = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await within(menu).findByText('飞书项目')).toBeTruthy()
  })

  it('locks switch per connector id in ConnectorMenu to prevent concurrent toggles', async () => {
    let finishSwitch!: (v: unknown) => void
    const calls = mockApi({
      ...routes([meegle]),
      'PUT /groups/g1/connectors/c3/switch': () => new Promise((r) => (finishSwitch = r)),
    })
    renderChat()
    const menu = await openMenu()
    const sw = (await within(menu).findByRole('switch', {
      name: '在本群启用「飞书项目」',
    })) as HTMLInputElement
    fireEvent.click(sw)
    await waitFor(() => expect(sw.disabled).toBe(true))
    fireEvent.click(sw)
    expect(calls.filter((c) => c.path === '/groups/g1/connectors/c3/switch')).toHaveLength(1)

    await act(async () => finishSwitch({ ...meegle, on: false }))
    await waitFor(() => expect(sw.disabled).toBe(false))
  })
})
