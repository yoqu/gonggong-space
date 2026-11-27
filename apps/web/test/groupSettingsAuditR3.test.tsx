import { readFileSync } from 'node:fs'
import type {
  GroupDto,
  GroupFeishuView,
  GroupParams,
  GroupPluginDto,
  GroupWebhooksDto,
  McpServerDto,
  UserDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { GroupSettingsDialog } from '../src/features/groups/GroupSettingsDialog'
import { GroupPluginsTab } from '../src/features/plugins/PluginLayer'
import { usePluginStore } from '../src/features/plugins/store'
import { resetWebhooks } from '../src/features/webhooks/store'
import { WebhooksView } from '../src/features/webhooks/WebhooksView'
import { createGroupStore } from '../src/lib/groupStore'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'wanglei',
  name: '王磊',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const group = (o: Partial<GroupDto> = {}): GroupDto => ({
  id: 'g1',
  teamId: 't1',
  name: '支付服务重构',
  kind: 'group',
  visibility: 'private',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  extraRepos: [],
  members: [
    { userId: 'u1', name: '王磊', avatar: null, isAdmin: true },
    { userId: 'u2', name: '李建国', avatar: null, isAdmin: false },
  ],
  botIds: [],
  unread: 0,
  lastSeq: 1,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
  ...o,
})

const params: GroupParams = { approvalTimeoutMin: 30, chainMaxHops: 3, offlineWaitMin: 30 }

const wiki: McpServerDto = {
  id: 'm1',
  enabled: true,
  config: {
    transport: 'http',
    name: 'wiki-search',
    url: 'https://mcp.corp/wiki',
    headers: {},
  },
  updatedAt: '2026-11-20T00:00:00Z',
}

const feishuView: GroupFeishuView = {
  available: true,
  mainAppName: '共工',
  chat: null,
  feishuError: null,
  chats: [],
  bots: [],
  members: [{ userId: 'u1', name: '王磊', linked: true }],
}

const tenancy = {
  teams: [],
  singleTeamMode: true,
  canCreateTeam: false,
  demoMode: false,
  pluginsEnabled: true,
}

beforeEach(() => {
  resetWebhooks()
  usePluginStore.setState({ lists: {}, errors: {} })
  useSession.setState({ user: me, tenancy, status: 'ready' })
  useWorkspace.setState({ groups: [group()], bots: [], machines: [], activeGroupId: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('R3B P1-2: GroupSettingsDialog dirty-state protection', () => {
  it('closes on backdrop when clean and protects BasicTab across tab switch, × and Escape', async () => {
    mockApi({ 'GET /groups/g1/params': params })
    const onCloseClean = vi.fn()
    const cleanView = render(<GroupSettingsDialog group={group()} tab="basic" onClose={onCloseClean} />)
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onCloseClean).toHaveBeenCalledTimes(1)
    cleanView.unmount()

    const onClose = vi.fn()
    render(<GroupSettingsDialog group={group()} tab="basic" onClose={onClose} />)
    const dlg = screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })
    const nameInput = within(dlg).getByLabelText('群名称') as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: '重命名草稿' } })

    // Backdrop click is blocked while dirty (closeOnBackdrop={false}).
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // Tab switch opens the discard AlertDialog; 继续编辑 keeps edits in place.
    fireEvent.click(within(dlg).getByRole('button', { name: '成员' }))
    const alert1 = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    const discardBtn = within(alert1).getByRole('button', { name: '放弃更改' })
    expect(discardBtn.className).toContain('ui-btn--destructive')
    fireEvent.click(within(alert1).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })).toBeTruthy()
    expect(nameInput.value).toBe('重命名草稿')

    // Confirming 放弃更改 resets dirty state and switches to the target tab.
    fireEvent.click(within(dlg).getByRole('button', { name: '成员' }))
    const alert2 = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(alert2).getByRole('button', { name: '放弃更改' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: '成员 · 支付服务重构' })).toBeTruthy()

    // Returning to 基本信息 shows the saved name and stays clean.
    fireEvent.click(within(dlg).getByRole('button', { name: '基本信息' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const freshInput = within(dlg).getByLabelText('群名称') as HTMLInputElement
    expect(freshInput.value).toBe('支付服务重构')

    // Editing again and clicking × or pressing Escape prompts before closing.
    fireEvent.change(freshInput, { target: { value: '待放弃名称' } })
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    expect(onClose).not.toHaveBeenCalled()

    // Escape closes only the AlertDialog; a second Escape prompts again, then 放弃更改 closes.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    const alert3 = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(alert3).getByRole('button', { name: '放弃更改' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps a tab picked before the mount effects flush (Jenkins #679)', async () => {
    mockApi({ 'GET /groups/g1/params': params })
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      // Resolve on the commit's DOM mutation, before React's passive effects run.
      const committed = new Promise<void>((resolve) =>
        new MutationObserver((_, o) => {
          o.disconnect()
          resolve()
        }).observe(document.body, { childList: true, subtree: true }),
      )
      root.render(<GroupSettingsDialog group={group()} tab="basic" onClose={vi.fn()} />)
      await committed
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '群级参数' }))
      env.IS_REACT_ACT_ENVIRONMENT = true
      expect(await screen.findByLabelText('接力链长上限（跳）')).toBeTruthy()
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = true
      act(() => root.unmount())
      host.remove()
    }
  })

  it('protects unsaved params changes, resets draft on discard, and closes cleanly on save', async () => {
    mockApi({
      'GET /groups/g1/params': params,
      'PUT /groups/g1/params': (b: unknown) => b,
    })
    const onClose = vi.fn()
    render(<GroupSettingsDialog group={group()} tab="params" onClose={onClose} />)
    const dlg = screen.getByRole('dialog', { name: '群级参数 · 支付服务重构' })
    const hops = (await within(dlg).findByLabelText('接力链长上限（跳）')) as HTMLInputElement

    fireEvent.change(hops, { target: { value: '5' } })
    fireEvent.blur(hops)
    expect(within(dlg).getByText('有未保存的更改 · 保存后对新会话生效')).toBeTruthy()

    // Backdrop click does nothing while dirty.
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).not.toHaveBeenCalled()

    // Switching tabs prompts; 放弃更改 resets the params draft back to saved values.
    fireEvent.click(within(dlg).getByRole('button', { name: '基本信息' }))
    const alert = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(alert).getByRole('button', { name: '放弃更改' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })).toBeTruthy()

    fireEvent.click(within(dlg).getByRole('button', { name: '群级参数' }))
    const resetHops = (await within(dlg).findByLabelText('接力链长上限（跳）')) as HTMLInputElement
    expect(resetHops.value).toBe('3')
    expect(within(dlg).queryByText(/有未保存的更改/)).toBeNull()

    // Saving params stays open, flashes done state, clears dirty, and then closing skips DiscardChangesDialog.
    fireEvent.change(resetHops, { target: { value: '6' } })
    fireEvent.click(within(dlg).getByRole('button', { name: '保存' }))
    const doneBtn = await within(dlg).findByRole('button', { name: '已保存' })
    expect(doneBtn.className).toContain('ui-btn--done')
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dlg).queryByText(/有未保存的更改/)).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('omits empty footer bar on non-params tabs for admins while keeping it for params and read-only members', async () => {
    mockApi({ 'GET /groups/g1/params': params })
    const adminView = render(<GroupSettingsDialog group={group()} tab="basic" onClose={vi.fn()} />)
    const dlg = screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })
    expect(dlg.querySelector('.ui-dialog__actions')).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: '群级参数' }))
    expect(dlg.querySelector('.ui-dialog__actions')).toBeTruthy()
    adminView.unmount()

    const plain = group({
      members: [
        { userId: 'u2', name: '李建国', avatar: null, isAdmin: true },
        { userId: 'u1', name: '王磊', avatar: null, isAdmin: false },
      ],
    })
    render(<GroupSettingsDialog group={plain} tab="basic" onClose={vi.fn()} />)
    const roDlg = screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })
    expect(roDlg.querySelector('.ui-dialog__actions')).toBeTruthy()
    expect(within(roDlg).getByText('仅群管理员可修改')).toBeTruthy()
  })

  it('protects unsaved GroupMcpTab edits across tab switches and close', async () => {
    mockApi({
      'GET /groups/g1/params': params,
      'GET /groups/g1/mcp': [wiki],
      'GET /groups/g1/inherited-mcp': [],
    })
    const onClose = vi.fn()
    render(<GroupSettingsDialog group={group()} tab="mcp" onClose={onClose} />)
    const dlg = screen.getByRole('dialog', { name: 'MCP · 支付服务重构' })
    await within(dlg).findByText('wiki-search')

    fireEvent.click(within(dlg).getByRole('switch', { name: '启用 wiki-search' }))

    // Backdrop click blocked while MCP draft is dirty.
    fireEvent.click(screen.getByTestId('dialog-overlay'))
    expect(onClose).not.toHaveBeenCalled()

    // Switching tabs asks to confirm; 继续编辑 stays on MCP.
    fireEvent.click(within(dlg).getByRole('button', { name: '基本信息' }))
    const alert1 = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(alert1).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('dialog', { name: 'MCP · 支付服务重构' })).toBeTruthy()

    // Closing prompts and confirming 放弃更改 closes the dialog.
    fireEvent.click(within(dlg).getByRole('button', { name: '关闭' }))
    const alert2 = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(alert2).getByRole('button', { name: '放弃更改' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('R3B P1-3: Error and retry states replace silent infinite spinners and blank states', () => {
  it('createGroupStore tracks per-group error without retry loops and clears it on reload', async () => {
    let fail = true
    const load = vi.fn(async () => {
      if (fail) throw new Error('network down')
      return ['item-1']
    })
    const store = createGroupStore<string[]>({ load, onEvent: () => null })

    function Probe() {
      const value = store.use('g1')
      const err = store.useError('g1')
      return (
        <div>
          <span data-testid="val">{value ? value.join(',') : 'none'}</span>
          <span data-testid="err">{err ?? 'none'}</span>
          <button type="button" onClick={() => store.reload('g1')}>
            retry
          </button>
        </div>
      )
    }

    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('network down'))
    expect(screen.getByTestId('val').textContent).toBe('none')
    expect(load).toHaveBeenCalledTimes(1)

    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('item-1'))
    expect(screen.getByTestId('err').textContent).toBe('none')
    store.reset()
  })

  it('WebhooksView shows an error Alert with Retry instead of an infinite spinner', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/webhooks': () =>
        fail
          ? apiError(500, 'internal', 'Webhook 服务不可用')
          : ({ webhooks: [] } satisfies GroupWebhooksDto),
    })

    render(<WebhooksView group={group()} readOnly={false} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('加载失败')
    expect(alert.textContent).toContain('Webhook 服务不可用')
    expect(screen.queryByRole('status')).toBeNull()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('还没有 Webhook')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('GroupSettingsDialog params tab shows error Alert + Retry instead of infinite spinner', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/params': () => (fail ? apiError(500, 'internal', '参数读取失败') : params),
    })

    render(<GroupSettingsDialog group={group()} tab="params" onClose={vi.fn()} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('群级参数加载失败')
    expect(alert.textContent).toContain('参数读取失败')
    expect(screen.queryByRole('status')).toBeNull()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    const hops = (await screen.findByLabelText('接力链长上限（跳）')) as HTMLInputElement
    expect(hops.value).toBe('3')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('GroupPluginsTab renders Spinner, error Alert + Retry, and EmptyState when empty', async () => {
    let resolvePending: ((res: Response | GroupPluginDto[]) => void) | null = null
    let mode: 'pending' | 'empty' = 'pending'
    mockApi({
      'GET /groups/g1/plugins': () =>
        mode === 'pending'
          ? new Promise<Response | GroupPluginDto[]>((resolve) => {
              resolvePending = resolve
            })
          : [],
    })

    render(<GroupPluginsTab group={group()} />)
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()

    await act(async () => {
      resolvePending?.(apiError(500, 'internal', '插件目录暂时不可用'))
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('插件加载失败')
    expect(alert.textContent).toContain('插件目录暂时不可用')
    expect(screen.queryByRole('status')).toBeNull()
    expect(usePluginStore.getState().lists.g1).toBeUndefined()

    mode = 'empty'
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('还没有可用插件')).toBeTruthy()
    expect(document.querySelector('.ui-empty__art svg')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('plugins store still degrades HTTP 404 (legacy servers) cleanly to an empty list', async () => {
    mockApi({
      'GET /groups/g1/plugins': () => apiError(404, 'not_found', 'not found'),
    })

    render(<GroupPluginsTab group={group()} />)
    expect(await screen.findByText('还没有可用插件')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(usePluginStore.getState().lists.g1).toEqual([])
    expect(usePluginStore.getState().errors.g1).toBeNull()
  })
})

describe('R3B P1-4: Sticky nav scroll, mobile touch tabs, and responsive layout CSS contract', () => {
  const readCss = (p: string) => readFileSync(`${process.cwd()}/src/${p}`, 'utf8')
  const ruleOf = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`)
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('gives GroupSettingsDialog independent scroll, 36px touch tabs, and mobile row wrapping', () => {
    const gs = readCss('features/groups/groups.css')
    const dialogBody = ruleOf(gs, '.ui-dialog__body:has(> .gs-settings)')
    expect(dialogBody).toContain('overflow: hidden')
    expect(dialogBody).toContain('display: flex')
    expect(dialogBody).toContain('flex-direction: column')

    const settings = ruleOf(gs, '.gs-settings')
    expect(settings).toContain('flex: 1')
    expect(settings).toContain('min-height: 0')

    expect(ruleOf(gs, '.gs-settings__nav')).toContain('overflow-y: auto')
    expect(ruleOf(gs, '.gs-settings__body')).toContain('overflow-y: auto')
    expect(ruleOf(gs, '.gs-settings__body')).toContain('min-height: 0')

    expect(gs).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?\.gs-settings__nav \{[^}]*flex: none;/)
    expect(gs).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?\.gs-settings__tab \{[^}]*min-height: 36px;/)
    expect(gs).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*?\.gs-settings__body \.ui-group__row \{[^}]*flex-wrap: wrap;/,
    )
    expect(gs).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*?\.gs-member,\s*\.gs-row \{[^}]*flex-wrap: wrap;/,
    )
    expect(gs).toMatch(/@media \(pointer: coarse\) \{\s*\.gs-settings__tab \{[^}]*min-height: 36px;/)
  })

  it('wraps config rows on mobile and stacks SkillEditorDialog below 640px', () => {
    const cfg = readCss('features/config/config.css')
    expect(ruleOf(cfg, '.cfg__name-line')).toContain('flex-wrap: wrap')
    expect(cfg).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?\.cfg__item \{[^}]*flex-wrap: wrap;/)
    expect(cfg).toMatch(
      /@media \(max-width: 640px\) \{\s*\.skill-ed \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    )
  })
})

describe('R3B P1-7: GroupSettingsDialog activeTab fallback when current tab disappears', () => {
  it('falls back from 飞书 to 基本信息 when the admin is demoted to plain member', async () => {
    mockApi({
      'GET /groups/g1/params': params,
      'GET /groups/g1/feishu': feishuView,
    })

    const { rerender } = render(
      <MemoryRouter>
        <GroupSettingsDialog group={group()} tab="feishu" onClose={vi.fn()} />
      </MemoryRouter>,
    )
    const dlg = screen.getByRole('dialog', { name: '飞书 · 支付服务重构' })
    expect(within(dlg).getByRole('button', { name: '飞书' }).getAttribute('aria-current')).toBe('page')
    await within(dlg).findByText('关联前先确认')

    const demoted = group({
      members: [
        { userId: 'u2', name: '李建国', avatar: null, isAdmin: true },
        { userId: 'u1', name: '王磊', avatar: null, isAdmin: false },
      ],
    })
    rerender(
      <MemoryRouter>
        <GroupSettingsDialog group={demoted} tab="feishu" onClose={vi.fn()} />
      </MemoryRouter>,
    )

    const fallback = screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })
    expect(fallback.textContent).not.toContain('undefined')
    expect(within(fallback).getByRole('button', { name: '基本信息' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(fallback).queryByRole('button', { name: '飞书' })).toBeNull()
    expect(within(fallback).queryByText('关联前先确认')).toBeNull()
    expect((within(fallback).getByLabelText('群名称') as HTMLInputElement).readOnly).toBe(true)
    expect(within(fallback).getByText('仅群管理员可修改')).toBeTruthy()
  })

  it('falls back from 插件 to 基本信息 when the plugins master switch turns off', async () => {
    mockApi({
      'GET /groups/g1/params': params,
      'GET /groups/g1/plugins': [],
    })

    render(<GroupSettingsDialog group={group()} tab="plugins" onClose={vi.fn()} />)
    const dlg = screen.getByRole('dialog', { name: '插件 · 支付服务重构' })
    expect(await within(dlg).findByText('还没有可用插件')).toBeTruthy()

    act(() => {
      useSession.setState({ tenancy: { ...tenancy, pluginsEnabled: false } })
    })

    const fallback = screen.getByRole('dialog', { name: '基本信息 · 支付服务重构' })
    expect(within(fallback).getByRole('button', { name: '基本信息' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(within(fallback).queryByRole('button', { name: '插件' })).toBeNull()
    expect(within(fallback).queryByText('本群插件')).toBeNull()
  })
})
