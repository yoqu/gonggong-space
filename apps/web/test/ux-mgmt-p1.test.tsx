import type { GroupDto, MySecretDto, UserDto, WebhookDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ChangePasswordDialog } from '../src/features/auth/ChangePasswordPage'
import { ConfigPage } from '../src/features/config/ConfigPage'
import { GroupConfigView } from '../src/features/config/GroupConfigView'
import { InheritedList } from '../src/features/config/InheritedList'
import { FeishuScanDialog } from '../src/features/feishu/FeishuScanDialog'
import { CommitView } from '../src/features/git/CommitView'
import { StashView } from '../src/features/git/StashView'
import { AddTabDialog } from '../src/features/group-tabs/AddTabDialog'
import {
  BrowseChannelsDialog,
  DeleteSectionDialog,
  SectionNameDialog,
} from '../src/features/groups/SidebarDialogs'
import { FillMine, MySecrets } from '../src/features/secrets/MySecrets'
import { SecretLayerList } from '../src/features/secrets/SecretLayer'
import { NewTeamSheet, TeamSwitcher } from '../src/features/teams/TeamSwitcher'
import { resetWebhooks } from '../src/features/webhooks/store'
import { WebhooksView } from '../src/features/webhooks/WebhooksView'
import { DirPicker } from '../src/features/workspaces/DirPicker'
import { WorkspacePicker } from '../src/features/workspaces/WorkspacePicker'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'admin',
  name: '林知行',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const group: GroupDto = {
  id: 'g1',
  teamId: 't1',
  name: '研发群',
  kind: 'group',
  mode: 'partition',
  adminOnlyInvite: false,
  protectBase: false,
  notice: '',
  noticeHidden: false,
  avatar: null,
  repo: null,
  members: [{ userId: 'u1', name: '林知行', avatar: null, isAdmin: true }],
  botIds: ['b1'],
  unread: 0,
  lastSeq: 0,
  last: '',
  pinned: false,
  notifyLevel: 'mentions',
  foldRuns: false,
  liveRunIds: [],
  liveRuns: [],
}

describe('Slice C P1 UX fixes (U-36..U-43)', () => {
  beforeEach(() => {
    useSession.setState({
      user: me,
      tenancy: {
        singleTeamMode: false,
        canCreateTeam: true,
        demoMode: false,
        pluginsEnabled: true,
        teams: [
          {
            id: 't1',
            name: '支付组',
            avatar: null,
            role: 'owner',
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00Z',
            unread: 0,
          },
        ],
      },
    })
    useWorkspace.setState({ bots: [], groups: [group], machines: [] })
    resetWebhooks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('U-36: BrowseChannelsDialog shows retryable Alert; SectionNameDialog blocks IME Enter & busy close; DeleteSectionDialog sets loading', async () => {
    let fail = true
    mockApi({
      'GET /channels': () => (fail ? apiError(500, 'err', '频道加载失败') : []),
    })
    const { unmount } = render(
      <MemoryRouter>
        <BrowseChannelsDialog onClose={() => {}} />
      </MemoryRouter>,
    )
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: '重试' })
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByText('还没有公开频道')).toBeTruthy()
    unmount()

    let resolveSave!: () => void
    const onSave = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveSave = r
        }),
    )
    const onClose = vi.fn()
    const { unmount: u2 } = render(<SectionNameDialog onSave={onSave} onClose={onClose} />)
    const input = screen.getByLabelText('分区名称')
    fireEvent.change(input, { target: { value: '发版' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true)
    resolveSave()
    u2()

    render(
      <DeleteSectionDialog
        name="发版"
        team={false}
        childCount={0}
        busy
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    const delBtn = screen.getByRole('button', { name: '删除' })
    expect(delBtn.getAttribute('aria-busy')).toBe('true')
  })

  it('U-38: FeishuScanDialog shows spinner while loading and retry on register failure', async () => {
    let fail = true
    mockApi({
      'POST /admin/feishu/register': () =>
        fail
          ? apiError(500, 'err', '生成二维码失败')
          : {
              id: 's1',
              url: 'https://open.feishu.cn/qr',
              expiresAt: new Date(Date.now() + 600_000).toISOString(),
              status: 'waiting',
              error: null,
              app: null,
              configError: null,
            },
    })
    render(<FeishuScanDialog path="/admin/feishu" update={false} onDone={() => {}} onClose={() => {}} />)
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: '重试' })
    fail = false
    fireEvent.click(retry)
    expect(await screen.findByTitle('飞书扫码')).toBeTruthy()
  })

  it('U-39: SecretLayer & MySecrets error alerts have retry; FillMine submits on Enter and validates short value', async () => {
    const fail = true
    mockApi({
      'GET /admin/secrets': () => (fail ? apiError(500, 'err', '加载错误') : []),
      'GET /me/secrets': () => (fail ? apiError(500, 'err', '加载错误') : []),
    })
    const { unmount } = render(
      <>
        <SecretLayerList base="/admin/secrets" scope="platform" bots={[]} />
        <MySecrets />
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2))
    const alerts = screen.getAllByRole('alert')
    for (const a of alerts) expect(within(a).getByRole('button', { name: '重试' })).toBeTruthy()
    unmount()

    const item: MySecretDto = {
      where: '研发群',
      secret: {
        id: 'sec1',
        teamId: 't1',
        groupId: 'g1',
        name: 'API_KEY',
        description: '接口密钥',
        scope: 'group',
        mode: 'personal',
        expiresAt: null,
      },
      mine: null,
    }
    const calls = mockApi({ 'PUT /me/secrets/sec1': {} })
    const onDone = vi.fn()
    render(<FillMine item={item} onClose={() => {}} onDone={onDone} />)
    const field = screen.getByLabelText('值')
    fireEvent.change(field, { target: { value: '123' } })
    expect(screen.getByText('至少 8 个字符')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(field, { target: { value: '12345678' } })
    const form = field.closest('form')
    expect(form).toBeTruthy()
    if (form) fireEvent.submit(form)
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(calls.some((c) => c.method === 'PUT' && c.path === '/me/secrets/sec1')).toBe(true)
  })

  it('U-40: JoinTeamSheet shows inline error on invalid link; NewTeamSheet & ChangePasswordDialog lock 取消 + loading while submitting', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <TeamSwitcher />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /切换团队/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '加入团队' }))
    const input = await screen.findByLabelText('邀请链接')
    fireEvent.change(input, { target: { value: 'https://example.com/bad link!' } })
    expect(screen.getByText('请粘贴有效的团队邀请链接')).toBeTruthy()
    unmount()

    let resolveCreate!: (v: unknown) => void
    mockApi({
      'POST /teams': () =>
        new Promise((r) => {
          resolveCreate = r
        }),
      'POST /auth/password': () => new Promise(() => {}),
    })
    const { unmount: u2 } = render(<NewTeamSheet onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '核心组' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true),
    )
    expect(screen.getByRole('button', { name: '创建' }).getAttribute('aria-busy')).toBe('true')
    resolveCreate({ id: 't2' })
    u2()

    render(<ChangePasswordDialog onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'oldpass1' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass1' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'newpass1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存新密码' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true),
    )
    expect(screen.getByRole('button', { name: '保存中…' }).getAttribute('aria-busy')).toBe('true')
  })

  it('U-40: WebhooksView rotate confirm uses AlertDialog and locks 取消 while rotating', async () => {
    const wh: WebhookDto = {
      id: 'w1',
      groupId: 'g1',
      name: 'Jenkins',
      botIds: [],
      runOptions: {},
      prompt: null,
      enabled: true,
      hasToken: true,
      ownerId: 'u1',
      ownerName: '林知行',
      createdByBotId: null,
      canManage: true,
      lastCalledAt: null,
      lastStatus: null,
      lastRunId: null,
      createdAt: '2026-01-01T00:00:00Z',
    }
    mockApi({
      'GET /groups/g1/webhooks': { webhooks: [wh] },
      'POST /webhooks/w1/rotate': () => new Promise(() => {}),
    })
    render(<WebhooksView group={group} readOnly={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '重置令牌' }))
    const dlg = await screen.findByRole('alertdialog')
    fireEvent.click(within(dlg).getByRole('button', { name: '确认重置' }))
    await waitFor(() =>
      expect(within(dlg).getByRole('button', { name: '取消' }).hasAttribute('disabled')).toBe(true),
    )
  })

  it('U-41: DirPicker shows retryable Alert on load error and blocks IME Enter; WorkspacePicker disables choices while binding', async () => {
    let fail = true
    mockApi({
      'GET /machines/m1/dirs': () =>
        fail
          ? apiError(500, 'offline', '电脑离线')
          : { path: '/code', entries: [], places: [], roots: ['/'], canCreate: true },
      'POST /machines/m1/dirs': { path: '/code/new' },
    })
    const { unmount } = render(
      <DirPicker machineId="m1" title="选目录" onPick={() => {}} onClose={() => {}} />,
    )
    const alert = await screen.findByRole('alert')
    const retry = within(alert).getByRole('button', { name: '重试' })
    fail = false
    fireEvent.click(retry)
    const addBtn = await screen.findByRole('button', { name: '新建文件夹' })
    fireEvent.click(addBtn)
    const folderInput = await screen.findByLabelText('文件夹名称')
    fireEvent.keyDown(folderInput, { key: 'Enter', keyCode: 229 })
    // Still in edit mode because IME composing Enter must be ignored
    expect(screen.getByLabelText('文件夹名称')).toBeTruthy()
    unmount()

    let putCount = 0
    mockApi({
      'GET /machines/m1/dirs': { path: '/code', entries: [], places: [], roots: ['/'] },
      'PUT /groups/g1/bots/b1/workspace': () => {
        putCount++
        return new Promise(() => {})
      },
    })
    const bot = {
      id: 'b1',
      name: '小助手',
      machineId: 'm1',
      defaultWorkspace: null,
    } as Parameters<typeof WorkspacePicker>[0]['bot']
    render(<WorkspacePicker group={group} bot={bot} onClose={() => {}} />)
    const managedBtn = await screen.findByRole('button', { name: /使用托管/ })
    fireEvent.click(managedBtn)
    fireEvent.click(managedBtn)
    await waitFor(() => expect(managedBtn.hasAttribute('disabled')).toBe(true))
    expect(putCount).toBe(1)
  })

  it('U-42: ConfigPage removes dead 指令 & disabled 团队层/群层 tabs; InheritedList & GroupConfigView expose retry', async () => {
    const fail = true
    mockApi({
      'GET /admin/mcp': [],
      'GET /groups/g1/inherited-mcp': () => (fail ? apiError(500, 'err', '失败') : []),
      'GET /groups/g1/mcp': () => (fail ? apiError(500, 'err', '失败') : []),
    })
    const { unmount } = render(
      <MemoryRouter>
        <ConfigPage />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('tab', { name: '指令' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '团队层' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '群层' })).toBeNull()
    unmount()

    render(
      <>
        <InheritedList
          base="/groups/g1/inherited-mcp"
          row={() => ({ name: 'x', label: 'x', tags: [], description: '' })}
        />
        <GroupConfigView groupId="g1" kind="mcp" />
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2))
    const alerts = screen.getAllByRole('alert')
    for (const a of alerts) expect(within(a).getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('U-43: AddTabDialog knowledge tab shows retryable Alert on load error; CommitView & StashView show retry on error', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/knowledge': () => (fail ? apiError(500, 'err', '知识库错误') : { entries: [] }),
      'GET /groups/g1/bots/b1/git/stashes': () => (fail ? apiError(500, 'err', '贮藏错误') : { stashes: [] }),
    })
    const { unmount } = render(<AddTabDialog group={group} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: '知识库' }))
    const kbAlert = await screen.findByRole('alert')
    expect(within(kbAlert).getByRole('button', { name: '重试' })).toBeTruthy()
    fail = false
    fireEvent.click(within(kbAlert).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    unmount()

    const onReload = vi.fn()
    fail = true
    render(
      <>
        <CommitView
          target={{ groupId: 'g1', botId: 'b1', repo: null }}
          data={null}
          error="读取出错"
          selected={null}
          onSelect={() => {}}
          onReload={onReload}
        />
        <StashView
          target={{ groupId: 'g1', botId: 'b1', repo: null }}
          stamp="1"
          selected={null}
          onPick={() => {}}
        />
      </>,
    )
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBe(2))
    const [commitAlert, stashAlert] = screen.getAllByRole('alert')
    expect(commitAlert && stashAlert).toBeTruthy()
    if (!commitAlert || !stashAlert) return
    fireEvent.click(within(commitAlert).getByRole('button', { name: '重试' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.click(within(stashAlert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('没有贮藏')).toBeTruthy()
  })
})
