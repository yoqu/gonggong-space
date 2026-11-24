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
import { humanError, linksTo } from '../src/features/connectors/cli'
import { useConnectorStore } from '../src/features/connectors/store'
import { realtime } from '../src/lib/realtime'
import { bot, box, connector, group, manifest, me, openMenu, renderChat, routes } from './connectorFixtures'
import { mockApi } from './mockApi'

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

async function openDialog(name = '飞书') {
  const menu = await openMenu()
  fireEvent.click(await within(menu).findByRole('button', { name }))
  return screen.findByRole('dialog', { name })
}

describe('CLI 连接器 · 状态', () => {
  it('reads the machines’ state: a ready login is connected, others ask to connect', async () => {
    mockApi(
      routes([
        lark(ready()),
        lark(view(), { id: 'c6', manifest: manifest({ name: 'meegle', title: '飞书项目' }) }),
        lark(view({ state: 'no_machine', machines: [], target: null }), {
          id: 'c7',
          manifest: manifest({ name: 'x', title: '某系统' }),
        }),
      ]),
    )
    renderChat()
    const menu = await openMenu()
    const rows = await within(menu).findAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      '飞书已连接 · 王磊',
      '飞书项目未登录连接',
      '某系统需要一台在线电脑连接',
    ])
    expect(within(rows[0]!).getByRole('switch')).toBeTruthy()
  })

  it('maps known errors to a plain reason and finds links of a host', () => {
    expect(humanError('spawn node ENOENT: node not found')).toMatch(/缺少 Node.js/)
    expect(humanError('npm registry request timed out')).toMatch(/超时/)
    expect(humanError('keychain is locked')).toMatch(/钥匙串/)
    expect(humanError('app has not been enabled')).toMatch(/飞书应用还没启用/)
    expect(humanError('boom')).toBe('boom')
    expect(linksTo('看下 https://abc.feishu.cn/docx/1 这篇', ['feishu.cn'])).toBe(true)
    expect(linksTo('https://notfeishu.cn/x', ['feishu.cn'])).toBe(false)
  })
})

describe('CLI 连接器 · 一站式连接', () => {
  it('connects: installs, two steps with a QR code, then turns green without posting to chat', async () => {
    let answer!: (v: unknown) => void
    const calls = mockApi({
      ...routes([lark(view({ state: 'not_installed', machines: [machine({ state: 'not_installed' })] }))]),
      'POST /groups/g1/connectors/c5/cli': () => new Promise((r) => (answer = r)),
    })
    renderChat()
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/groups/g1/connectors/c5/cli')?.body).toEqual({
        action: 'connect',
        domains: [],
      }),
    )
    // Events can beat the 202.
    emit({ t: 'connector.cli.progress', requestId: 'r1', stage: 'install', line: 'added 12 packages' })
    await act(async () => answer({ requestId: 'r1', machineId: 'mc1' }))
    expect(await within(dialog).findByText('正在安装命令行工具…')).toBeTruthy()
    expect(within(dialog).getByText('创建飞书应用')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '查看日志' }))
    expect(within(dialog).getByText('added 12 packages')).toBeTruthy()

    emit({ t: 'connector.cli.progress', requestId: 'other', stage: 'login', line: 'not mine' })
    emit({
      t: 'connector.cli.auth',
      requestId: 'r1',
      step: 'init',
      url: 'https://open.feishu.cn/app/new?x=1',
      userCode: null,
      expiresAt: null,
    })
    expect(within(dialog).getByTitle('授权二维码')).toBeTruthy()
    expect(within(dialog).getByText('用飞书扫码，创建你自己的飞书应用')).toBeTruthy()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    fireEvent.click(within(dialog).getByRole('button', { name: '在浏览器中打开' }))
    expect(open).toHaveBeenCalledWith('https://open.feishu.cn/app/new?x=1', '_blank', 'noopener,noreferrer')

    emit({
      t: 'connector.cli.auth',
      requestId: 'r1',
      step: 'login',
      url: 'https://accounts.feishu.cn/device?code=ABCD',
      userCode: 'ABCD-1234',
      expiresAt: null,
    })
    expect(within(dialog).getByText('ABCD-1234')).toBeTruthy()
    expect(within(dialog).getByText('授权登录').className).toContain('is-current')
    expect(within(dialog).getByText('创建飞书应用').className).toContain('is-done')

    emit({
      t: 'connector.cli.result',
      requestId: 'r1',
      ok: true,
      error: null,
      probe: null,
      connector: lark(ready()),
    })
    expect(await within(dialog).findByText('已连接 · 王磊')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: '去试试' })).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('/messages'))).toBe(false)
  })

  it('a failed connect says why in plain words and retries', async () => {
    let n = 0
    mockApi({
      ...routes([lark(view())]),
      'POST /groups/g1/connectors/c5/cli': () => ({ requestId: `r${++n}`, machineId: 'mc1' }),
    })
    renderChat()
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await within(dialog).findByText('正在连接…')
    emit({
      t: 'connector.cli.result',
      requestId: 'r1',
      ok: false,
      error: 'security: keychain locked',
      probe: null,
      connector: lark(view()),
    })
    expect(await within(dialog).findByText('这台电脑的 macOS 钥匙串已锁定，解锁后重试')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(n).toBe(2))
  })

  it('closing mid-way cancels the login on the machine', async () => {
    const calls = mockApi({
      ...routes([lark(view())]),
      'POST /groups/g1/connectors/c5/cli': (b: unknown) =>
        (b as { action: string }).action === 'connect' ? { requestId: 'r1', machineId: 'mc1' } : lark(view()),
    })
    renderChat()
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await within(dialog).findByText('正在连接…')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === '/groups/g1/connectors/c5/cli').map((c) => c.body),
      ).toContainEqual({
        action: 'cancel',
        machineId: 'mc1',
      }),
    )
  })

  it('ready: checks again, signs out after confirming, warns of someone else’s login', async () => {
    const cli = view({
      state: 'ready',
      readyBotIds: ['b1'],
      machines: [
        machine({ state: 'ready', account: '王磊', verified: true }),
        machine({
          machineId: 'mc2',
          machineName: '办公室电脑',
          own: false,
          state: 'ready',
          account: '李四',
          verified: false,
        }),
        machine({ machineId: 'mc3', machineName: '测试机', own: false, state: 'needs_init' }),
      ],
    })
    const calls = mockApi({
      ...routes([lark(cli)]),
      'POST /groups/g1/connectors/c5/cli': (b: unknown) =>
        (b as { action: string }).action === 'logout'
          ? lark(view())
          : (b as { action: string }).action === 'connect'
            ? { requestId: 'r1', machineId: 'mc3' }
            : lark(cli),
    })
    renderChat()
    const dialog = await openDialog()
    expect(within(dialog).getByText('办公室电脑 登录的是 李四，不是你')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '重新检测' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ action: 'detect', machineId: 'mc1' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: '电脑 · 3' }))
    const list = within(dialog).getByRole('list', { name: '各电脑的连接状态' })
    expect(within(list).getByText('已连接 · 李四')).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: '在 测试机 上连接' }))
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { machineId?: string })?.machineId === 'mc3')).toBe(true),
    )
    emit({
      t: 'connector.cli.result',
      requestId: 'r1',
      ok: true,
      error: null,
      probe: null,
      connector: lark(cli),
    })

    fireEvent.click(await within(dialog).findByRole('button', { name: '退出登录' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: '退出登录' }))
    await waitFor(() =>
      expect(calls.some((c) => (c.body as { action?: string })?.action === 'logout')).toBe(true),
    )
    expect(await within(dialog).findByRole('button', { name: '连接' })).toBeTruthy()
  })

  it('no machine: guides to the desktop app or the owner’s switch', async () => {
    mockApi(routes([lark(view({ state: 'no_machine', machines: [], target: null }))]))
    renderChat()
    const dialog = await openDialog()
    expect(within(dialog).getByText(/允许群成员在本机连接/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: '连接' })).toBeNull()
  })

  it('an old daemon (no cli view) still connects in the chat', async () => {
    mockApi(routes([lark(null)]))
    renderChat()
    const dialog = await openDialog()
    expect(within(dialog).getByRole('button', { name: '在对话里连接' })).toBeTruthy()
  })
})

describe('CLI 连接器 · 输入框', () => {
  it('a Feishu link in the draft asks to connect first, keeping the draft', async () => {
    mockApi(routes([lark(view())]))
    renderChat()
    await openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(box(), { target: { value: '@设计助手 总结 https://x.feishu.cn/docx/abc' } })
    const hint = await screen.findByText('连接飞书后 Bot 才能读这篇文档')
    fireEvent.click(within(hint.parentElement!).getByRole('button', { name: '连接' }))
    expect(await screen.findByRole('dialog', { name: '飞书' })).toBeTruthy()
    expect(box().value).toBe('@设计助手 总结 https://x.feishu.cn/docx/abc')
  })
})

describe('CLI 连接器 · 选 Bot', () => {
  it('@-ing a bot whose machine has no login of mine offers the one that has', async () => {
    const other = { ...bot, id: 'b2', name: '研发助手', machineId: 'mc2' }
    mockApi({
      ...routes([lark(ready())]),
      'GET /groups': [{ ...group, botIds: ['b1', 'b2'] }],
      'GET /bots': [bot, other],
    })
    renderChat()
    await openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(box(), { target: { value: '@研发助手 看看我今天的日程' } })
    expect(await screen.findByText('研发助手 所在电脑还没连接飞书')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换到 @设计助手' }))
    expect(box().value).toBe('@设计助手 看看我今天的日程')
    expect(screen.queryByText('研发助手 所在电脑还没连接飞书')).toBeNull()
  })
})

describe('就地连接卡', () => {
  const card = (o: Partial<ConnectorCard> = {}): ConnectorCard => ({
    id: 'cc1',
    pluginId: 'c5',
    connector: 'feishu',
    title: '飞书',
    userId: me.id,
    reason: 'missing_scope',
    domains: ['calendar', 'docs'],
    resolved: false,
    ...o,
  })
  const show = (c: ConnectorCard) =>
    render(
      <MemoryRouter>
        <ConnectorCardView m={{ id: 'm1', groupId: 'g1' } as MessageDto} card={c} />
      </MemoryRouter>,
    )
  beforeEach(() => useSession.setState({ user: me }))

  it('only the requester connects, for the missing domains', async () => {
    const calls = mockApi({
      'GET /groups/g1/connectors': { connectors: [lark(view())] },
      'POST /groups/g1/connectors/c5/cli': { requestId: 'r1', machineId: 'mc1' },
    })
    useConnectorStore.setState({ lists: {} })
    show(card())
    expect(screen.getByText('飞书 · 缺少权限：calendar、docs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '连接' }))
    const dialog = await screen.findByRole('dialog', { name: '飞书' })
    expect(within(dialog).getByText('需要补充权限：calendar、docs')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: '连接' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'connect',
        domains: ['calendar', 'docs'],
      }),
    )
  })

  it('others wait; a resolved card says it goes on', () => {
    show(card({ userId: 'u9' }))
    expect(screen.getByText('仅发起人可连接')).toBeTruthy()
    show(card({ resolved: true }))
    expect(screen.getByText('已连接，正在继续')).toBeTruthy()
  })
})
