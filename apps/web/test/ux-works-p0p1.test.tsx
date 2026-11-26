import type {
  ArtifactDto,
  ArtifactThreadDto,
  BotDto,
  GgArtifactManifest,
  PreviewDto,
  UserDto,
  WorkDto,
} from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { ArtifactMembers } from '../src/features/artifacts/ArtifactMembers'
import { ArtifactTab } from '../src/features/artifacts/ArtifactTab'
import { useArtifactBot } from '../src/features/artifacts/actions'
import { CanvasBotPicker, useCanvasBot } from '../src/features/artifacts/CanvasBotPicker'
import { CanvasPageChips } from '../src/features/artifacts/ContextChips'
import { ArtifactPage } from '../src/features/artifacts/host'
import { PageRail } from '../src/features/artifacts/PageRail'
import { RulesPanel } from '../src/features/artifacts/RulesPanel'
import { resetShares, ShareDialog, useShareAccess } from '../src/features/artifacts/share'
import { SiteStage } from '../src/features/artifacts/shell/SiteStage'
import { ThreadsSidebar } from '../src/features/artifacts/shell/ThreadsSidebar'
import { resetArtifacts } from '../src/features/artifacts/store'
import { DiffPane } from '../src/features/diff/DiffPane'
import { PreviewActions } from '../src/features/previews/PreviewActions'
import { PreviewsView } from '../src/features/previews/PreviewsView'
import { resetPreviews } from '../src/features/previews/store'
import { resetWorks, WorksPage } from '../src/features/works/WorksPage'
import { Toaster } from '../src/ui'
import { mockApi } from './mockApi'

const me = { id: 'u1', name: '姜维川', role: 'member' } as UserDto
const bot = (o: Partial<BotDto>): BotDto =>
  ({
    id: 'b1',
    name: '共字君',
    ownerId: 'u2',
    presence: 'online',
    agentKind: 'claude',
    ...o,
  }) as BotDto

const artifact = (o: Partial<ArtifactDto> = {}): ArtifactDto =>
  ({
    id: 'a1',
    groupId: 'g-works',
    botId: 'b1',
    title: '未命名作品',
    kind: 'prototype',
    site: false,
    visibility: 'private',
    createdBy: 'u1',
    canManage: true,
    access: 'edit',
    headVersionId: null,
    head: null,
    manifest: null,
    running: false,
    queued: false,
    queuedRunCount: 0,
    runner: null,
    favorites: [],
    dir: null,
    undoVersionId: null,
    redoVersionId: null,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
    ...o,
  }) as ArtifactDto

const work = (o: Partial<WorkDto> = {}): WorkDto => ({
  id: 'a1',
  groupId: 'g-works',
  groupTitle: '作品空间',
  groupKind: 'works',
  groupVisibility: 'private',
  title: '独立原型',
  pluginTitle: '产品原型',
  site: false,
  visibility: 'private',
  createdBy: 'u1',
  creatorName: '姜维川',
  thumbnailUrl: null,
  updatedAt: '2026-11-26T00:00:00Z',
  access: 'edit',
  ...o,
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gg.locale', 'zh')
  useSession.setState({ user: me, tenancy: null, status: 'ready' })
  useWorkspace.setState({
    notifCount: 0,
    groups: [],
    bots: [bot({ id: 'b1', name: '共字君', presence: 'online' })],
  })
  resetWorks()
  resetArtifacts()
  resetShares()
  resetPreviews()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('U-01: Empty newly-created prototype work renders rail and CanvasComposer', () => {
  it('renders CanvasComposer and updated empty canvas guidance when headVersionId is null', async () => {
    mockApi({
      'GET /artifacts/a1': artifact({ headVersionId: null }),
      'GET /artifacts/a1/versions': [],
      'POST /artifacts/a1/chat': {
        rootId: 'm-root',
        group: { id: 'g-works', name: '作品空间', kind: 'group', members: [], botIds: ['b1'] },
      },
      'GET /groups/g-works/messages': [],
      'GET /artifacts/a1/commands': [],
    })
    render(
      <MemoryRouter>
        <ArtifactTab
          tab={{ kind: 'artifact', artifactId: 'a1', title: '未命名作品' }}
          tabKey="work:a1"
          active
        />
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('art-composer')).toBeTruthy()
    expect(screen.queryByText('在左侧 AI 对话里说要做什么，AI 会做出第一版')).toBeNull()
  })
})

describe('U-02: Standalone work bot resolution & unified copy', () => {
  it('resolves bot from workspace/artifact bots when groupId is not in useWorkspace.groups', () => {
    const resolved: { bot: BotDto | null } = { bot: null }
    function Probe() {
      resolved.bot = useArtifactBot('g-works', 'b1').bot
      return null
    }
    render(<Probe />)
    expect(resolved.bot?.id).toBe('b1')
  })

  it('uses 暂无可用 Bot instead of 群里没有 Bot in ThreadsSidebar when no bots exist', () => {
    useWorkspace.setState({ bots: [], groups: [] })
    render(
      <ThreadsSidebar
        threads={[
          {
            id: 'th1',
            artifactId: 'a1',
            versionId: 'v1',
            anchor: { kind: 'site', path: '/', point: { x: 10, y: 20 } },
            status: 'open',
            createdBy: 'u1',
            createdByName: '姜维川',
            messages: [
              { id: 'm1', authorId: 'u1', authorName: '姜维川', text: '改颜色', at: '2026-11-26T00:00:00Z' },
            ],
            createdAt: '2026-11-26T00:00:00Z',
            updatedAt: '2026-11-26T00:00:00Z',
          } as unknown as ArtifactThreadDto,
        ]}
        activeId={null}
        bots={[]}
        bot={null}
        meId="u1"
        readOnly={false}
        onPickBot={() => {}}
        onSelect={() => {}}
        onReply={async () => true}
        onStatus={async () => {}}
        onDelete={async () => {}}
        onSend={async () => true}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '暂无可用 Bot' })).toBeTruthy()
  })
})

describe('U-03: Standalone work creator can enable public sharing', () => {
  it('grants share access to artifact creator even when not bot owner and not in group', () => {
    let denied: string | null = 'init'
    function Probe() {
      denied = useShareAccess('g-works', 'b1', 'u1', true)
      return null
    }
    render(<Probe />)
    expect(denied).toBeNull()
  })

  it('enables 开启分享 switch and hides 本群 for standalone works in ShareDialog', async () => {
    mockApi({
      'GET /artifacts/a1/share': {
        enabled: false,
        url: null,
        expiresAt: null,
        version: null,
        latest: 1,
        password: null,
      },
      'GET /artifacts/a1/members': [],
    })
    render(
      <ArtifactPage.Provider value={{ leave: () => {}, groupKind: 'works' }}>
        <ShareDialog
          artifactId="a1"
          groupId="g-works"
          botId="b1"
          visibility="private"
          createdBy="u1"
          canManage
          onClose={() => {}}
        />
      </ArtifactPage.Provider>,
    )
    const sw = await screen.findByRole('switch', { name: '开启分享' })
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('radio', { name: '本群' })).toBeNull()
  })
})

describe('U-05: CanvasBotPicker prefers online bot, handles empty options, syncs on artifactId change', () => {
  it('prefers online bot over offline bot and re-syncs when artifactId changes', () => {
    useWorkspace.setState({
      bots: [
        bot({ id: 'b-off', name: '共字君', presence: 'offline' }),
        bot({ id: 'b-on', name: '姜维川的 Claude Code', presence: 'online' }),
      ],
    })
    localStorage.setItem('gg.canvasBot.a2', 'b-off')
    const current: { bot: BotDto | null } = { bot: null }
    function Probe({ id }: { id: string }) {
      current.bot = useCanvasBot(id).bot
      return null
    }
    const { rerender } = render(<Probe id="a1" />)
    expect(current.bot?.id).toBe('b-on')
    rerender(<Probe id="a2" />)
    expect(current.bot?.id).toBe('b-off')
  })

  it('renders disabled chip with 暂无可用 Bot when options is empty and uses 执行的 Bot aria-label', () => {
    const { rerender } = render(<CanvasBotPicker bot={null} options={[]} onPick={() => {}} />)
    const emptyBtn = screen.getByRole('button', { name: '执行的 Bot' })
    expect((emptyBtn as HTMLButtonElement).disabled).toBe(true)
    expect(emptyBtn.textContent).toContain('暂无可用 Bot')

    const off = bot({ id: 'b-off', name: '共字君', presence: 'offline' })
    rerender(<CanvasBotPicker bot={off} options={[off]} onPick={() => {}} />)
    expect(screen.getByRole('button', { name: '执行的 Bot' }).textContent).toContain('共字君')
  })
})

describe('U-15 & L-1: Works standalone copy, single toolbar, and empty head share disable', () => {
  it('hides 作品空间 on standalone card and uses 全部来源 / 独立作品 in source filter', async () => {
    mockApi({
      'GET /works/groups': [],
      'GET /works': [
        work({ id: 'a1', title: '独立原型', groupKind: 'works', groupTitle: '作品空间' }),
        work({ id: 'a2', title: '群原型', groupId: 'g1', groupKind: 'group', groupTitle: '产品群' }),
      ],
    })
    render(
      <MemoryRouter initialEntries={['/works']}>
        <Routes>
          <Route path="works" element={<WorksPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const grid = await screen.findByRole('list', { name: '作品' })
    expect(grid.textContent).not.toContain('作品空间')
    fireEvent.click(screen.getByRole('button', { name: '来源' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: '全部来源' })).toBeTruthy()
    expect(screen.getByRole('menuitemcheckbox', { name: '独立作品' })).toBeTruthy()
  })

  it('renders single toolbar in WorkEditor and disables 分享 & 发送到群 when head is null', async () => {
    mockApi({
      'GET /works/groups': [],
      'GET /works': [work({ id: 'a1', title: '未命名作品', groupKind: 'works' })],
      'GET /artifacts/a1': artifact({ id: 'a1', title: '未命名作品', headVersionId: null }),
      'GET /artifacts/a1/versions': [],
      'POST /artifacts/a1/chat': {
        rootId: 'm-root',
        group: { id: 'g-works', name: '作品空间', kind: 'group', members: [], botIds: ['b1'] },
      },
      'GET /groups/g-works/messages': [],
      'GET /artifacts/a1/commands': [],
    })
    const { container } = render(
      <MemoryRouter initialEntries={['/works/a1']}>
        <Routes>
          <Route path="works/:artifactId" element={<WorksPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('art-composer')
    expect(container.querySelector('.works__head')).toBeNull()
    const shareBtn = screen.getByRole('button', { name: '分享' }) as HTMLButtonElement
    const sendBtn = screen.getByRole('button', { name: '发送到群' }) as HTMLButtonElement
    expect(shareBtn.disabled).toBe(true)
    expect(sendBtn.disabled).toBe(true)
  })
})

describe('U-16: Destructive confirmation & RulesPanel undo toast', () => {
  it('RulesPanel deletes rule immediately and provides 撤销 toast restoring rules', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <>
        <Toaster />
        <RulesPanel
          screens={[{ id: 's1', title: '首页' }]}
          screenId="s1"
          onScreen={() => {}}
          data={{
            title: null,
            rules: [{ anchor: 'btn', label: '按钮', text: '点击登录', pending: false }],
            md: '',
          }}
          gone={() => false}
          canEdit
          selected={null}
          onSelect={() => {}}
          onSaveRules={onSave}
          onSaveSource={async () => true}
          adding={null}
          onAdd={() => {}}
          onCreate={async () => true}
          onCancelAdd={() => {}}
          onShared={() => {}}
          ai={{ disabled: false, hint: null }}
          onComplete={() => {}}
          onClose={() => {}}
        />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]))
    const undoBtn = await screen.findByRole('button', { name: '撤销' })
    fireEvent.click(undoBtn)
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith([
        { anchor: 'btn', label: '按钮', text: '点击登录', pending: false },
      ]),
    )
  })

  it('ThreadsSidebar requires confirmation before deleting own thread', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <ThreadsSidebar
        threads={[
          {
            id: 'th1',
            artifactId: 'a1',
            versionId: 'v1',
            anchor: { kind: 'site', path: '/', point: { x: 10, y: 20 } },
            status: 'open',
            createdBy: 'u1',
            createdByName: '姜维川',
            messages: [
              { id: 'm1', authorId: 'u1', authorName: '姜维川', text: '改颜色', at: '2026-11-26T00:00:00Z' },
            ],
            createdAt: '2026-11-26T00:00:00Z',
            updatedAt: '2026-11-26T00:00:00Z',
          } as unknown as ArtifactThreadDto,
        ]}
        activeId={null}
        bots={[bot({})]}
        bot={bot({})}
        meId="u1"
        readOnly={false}
        onPickBot={() => {}}
        onSelect={() => {}}
        onReply={async () => true}
        onStatus={async () => {}}
        onDelete={onDelete}
        onSend={async () => true}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })
})

describe('U-17: ArtifactMembers loading, error retry, and 0-candidate role disable', () => {
  it('shows error alert with retry when members load fails, and disables 权限 select when no candidates', async () => {
    mockApi({
      'GET /artifacts/a1/members': () => {
        throw new Error('网络异常')
      },
      'GET /teams/t1/members': [],
    })
    render(<ArtifactMembers artifactId="a1" teamId="t1" createdBy="u1" canManage />)
    expect(await screen.findByRole('button', { name: '重试' })).toBeTruthy()
    const roleSelect = screen.getByRole('button', { name: '权限' }) as HTMLButtonElement
    expect(roleSelect.disabled).toBe(true)
  })
})

describe('U-18: SiteStage & ThreadsSidebar preserve draft on failed submit', () => {
  it('SiteStage keeps draft text when onCreatePin fails', async () => {
    const onCreatePin = vi.fn().mockResolvedValue(false)
    render(
      <SiteStage
        title="官网"
        src="https://preview.test/"
        versionKey="v1"
        frameRef={{ current: null }}
        threads={[]}
        annotating
        readOnly={false}
        activeThreadId={null}
        onCreatePin={onCreatePin}
        onSelectThread={() => {}}
      />,
    )
    fireEvent.click(screen.getByTestId('shell-site-overlay'), { clientX: 50, clientY: 60 })
    const ta = await screen.findByPlaceholderText('写下对这处页面的修改意见…')
    fireEvent.change(ta, { target: { value: '保留这条草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '提交批注' }))
    await waitFor(() => expect(onCreatePin).toHaveBeenCalled())
    expect((screen.getByPlaceholderText('写下对这处页面的修改意见…') as HTMLTextAreaElement).value).toBe(
      '保留这条草稿',
    )
  })
})

describe('U-19: PreviewActions status gating and 停止预览 wording', () => {
  it('hides 打开/重新截图/托管到服务器 when offline and uses 停止预览和服务 when online', () => {
    const base: PreviewDto = {
      id: 'p1',
      groupId: 'g1',
      botId: 'b1',
      botName: '共字君',
      kind: 'http',
      title: '前端开发服',
      port: 3000,
      path: '/',
      status: 'offline',
      canManage: true,
      serviceId: 's1',
      createdAt: '2026-11-26T00:00:00Z',
    } as PreviewDto
    const { rerender } = render(<PreviewActions preview={base} />)
    expect(screen.queryByRole('link', { name: '打开' })).toBeNull()
    expect(screen.queryByRole('button', { name: '重新截图' })).toBeNull()
    expect(screen.queryByRole('button', { name: '托管到服务器' })).toBeNull()

    rerender(<PreviewActions preview={{ ...base, status: 'online' }} />)
    expect(screen.getByRole('button', { name: '停止预览和服务' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止穿透和服务' })).toBeNull()
  })

  it('PreviewsView renders non-primary 重新启动 button for stopped preview', async () => {
    mockApi({
      'GET /groups/g1/previews': {
        previews: [
          {
            id: 'p1',
            groupId: 'g1',
            botId: 'b1',
            botName: '共字君',
            kind: 'http',
            title: '前端',
            port: 3000,
            path: '/',
            status: 'stopped',
            canManage: true,
            serviceId: 's1',
            createdAt: '2026-11-26T00:00:00Z',
          },
        ],
        services: [],
      },
    })
    render(<PreviewsView groupId="g1" />)
    const restart = await screen.findByRole('button', { name: '重新启动' })
    expect(restart.className).not.toContain('ui-btn--primary')
  })
})

describe('U-20: CanvasPageChips folder/clear and PageRail IME guard', () => {
  it('CanvasPageChips renders clear button when onClearPage is passed', () => {
    const onClear = vi.fn()
    render(<CanvasPageChips context={null} page="登录流程" pageKind="folder" onClearPage={onClear} />)
    const clearBtn = screen.getByRole('button', { name: /移除|返回全部/ })
    fireEvent.click(clearBtn)
    expect(onClear).toHaveBeenCalled()
  })

  it('PageRail ignores Safari IME keyCode 229 on rename Enter', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined)
    const manifest: GgArtifactManifest = {
      title: '测试',
      device: 'mobile',
      entry: 's1',
      screens: [{ id: 's1', title: '首页', file: 's1.html' }],
      groups: [],
    }
    mockApi({
      'POST /artifacts/a1/chat': {
        rootId: 'm-root',
        group: { id: 'g1', name: '产品群', kind: 'group', members: [], botIds: ['b1'] },
      },
      'GET /groups/g1/messages': [],
      'GET /artifacts/a1/commands': [],
    })
    render(
      <PageRail
        artifactId="a1"
        groupId="g1"
        manifest={manifest}
        readOnly={false}
        canEdit
        narrow={false}
        refreshKey="v1|0"
        onEdit={onEdit}
        onClose={() => {}}
        versionId={null}
        onPicked={() => {}}
      />,
    )
    fireEvent.doubleClick(screen.getByRole('button', { name: /首页/ }))
    const input = await screen.findByRole('textbox', { name: '页面名称' })
    fireEvent.change(input, { target: { value: '拼音输入中' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('U-21: Error recovery retry in DiffPane', () => {
  it('renders 重试 button in DiffPane when diff.error and diff.retry exist', () => {
    const retry = vi.fn()
    render(
      <DiffPane
        diff={{
          patch: null,
          files: [],
          repos: [],
          base: null,
          branch: null,
          error: '连接超时',
          loading: false,
          retry,
        }}
        scope="uncommitted"
        turn={false}
        file={null}
        onScope={() => {}}
        onFile={() => {}}
        onLocate={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalled()
  })
})
