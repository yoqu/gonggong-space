import type {
  BotDto,
  FeishuChatChoicesDto,
  FeishuIdentityView,
  GroupDto,
  GroupFeishuView,
  GroupPreviewsDto,
  PreviewShareDto,
  ScheduleDto,
  UserDto,
} from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { FeishuGroupDialog } from '../src/features/feishu/FeishuGroupDialog'
import { PreviewsView } from '../src/features/previews/PreviewsView'
import { SharesPage } from '../src/features/previews/SharesPage'
import { resetPreviews } from '../src/features/previews/store'
import { ScheduleCard } from '../src/features/schedules/ScheduleCard'
import { resetSchedules } from '../src/features/schedules/store'
import { Toaster } from '../src/ui'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'chenchen',
  name: '陈晨',
  role: 'sysadmin',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const bot = {
  id: 'b1',
  name: '代码助手',
  avatar: 'role-gong',
  ownerId: 'u1',
  ownerName: '陈晨',
  machineId: 'm1',
  machineName: 'dev-mac',
  agentKind: 'claude',
  presence: 'online',
  binding: 'bound',
  model: null,
  reasoningEffort: null,
  systemPrompt: '',
  triggerScope: 'all',
  access: { trusted: 'ask', others: 'auto' },
  concurrency: 2,
  approvalMode: 'ask',
  teamId: 't1',
} as unknown as BotDto

const group = {
  id: 'g1',
  teamId: 't1',
  name: '前端群',
  kind: 'group',
  mode: 'partition',
  repo: null,
  notice: '',
  ownerId: 'u1',
  botIds: ['b1'],
  members: [{ userId: 'u1', name: '陈晨', avatar: null, isAdmin: true }],
  archivedAt: null,
  feishu: undefined,
} as unknown as GroupDto

beforeEach(() => {
  resetPreviews()
  resetSchedules()
  useSession.setState({ user: me, status: 'ready' })
  useWorkspace.setState({ groups: [group], bots: [bot] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Round 2 Consolidation — Slice 3 (Feishu, Previews, Schedules)', () => {
  it('R1-P0-3: SharesPage matches pinyin initials and avoids cross-field false positives', async () => {
    const share: PreviewShareDto = {
      id: 'sh1',
      previewId: 'p1',
      previewTitle: '产品原型预览',
      groupId: 'g1',
      groupName: '研发团队',
      botName: '设计助手',
      createdByName: '陈晨',
      createdAt: '2026-11-20T00:00:00Z',
      expiresAt: '2026-12-01T00:00:00Z',
      revokedAt: null,
      visitCount: 2,
      lastVisitAt: null,
      active: true,
    }
    mockApi({ 'GET /admin/preview-shares': () => [share] })
    render(
      <MemoryRouter>
        <SharesPage />
      </MemoryRouter>,
    )
    await screen.findByText('产品原型预览')
    const input = screen.getByPlaceholderText('搜索预览、群或创建人')
    fireEvent.change(input, { target: { value: 'cpyxyl' } })
    expect(screen.getByText('产品原型预览')).toBeTruthy()

    // Cross-field join ("产品原型预览 研发团队") must NOT match.
    fireEvent.change(input, { target: { value: '预览 研发' } })
    expect(screen.queryByText('产品原型预览')).toBeNull()
  })

  it('R1-P0-4: ScheduleCard displays per-bot model and effort overrides via botsText', async () => {
    const schedule: ScheduleDto = {
      id: 'sc1',
      groupId: 'g1',
      name: '每日巡检',
      prompt: '检查仓库',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      runAt: null,
      botIds: ['b1'],
      runOptions: { b1: { model: 'opus', effort: 'high' } },
      enabled: true,
      canManage: true,
      createdByBotId: null,
      nextRunAt: '2026-11-23T01:00:00Z',
      lastFiredAt: null,
      lastBotId: null,
      lastStatus: null,
      lastRunId: null,
      failStreak: 0,
      ownerId: 'u1',
      ownerName: '陈晨',
      pausedReason: null,
      createdAt: '2026-11-21T09:00:00Z',
    }
    mockApi({ 'GET /groups/g1/schedules': () => ({ schedules: [schedule] }) })
    render(<ScheduleCard scheduleId="sc1" groupId="g1" fallback="每日巡检" />)
    expect(await screen.findByText(/代码助手（opus · 高）/)).toBeTruthy()
  })

  it('R1-P0-5: PreviewsView renders Alert + Retry on store load error instead of infinite spinner', async () => {
    let fail = true
    mockApi({
      'GET /groups/g1/previews': () =>
        fail
          ? apiError(500, 'err', '预览列表故障')
          : ({ previews: [], services: [], manageableBotIds: [] } satisfies GroupPreviewsDto),
    })
    render(<PreviewsView groupId="g1" />)
    await screen.findByText('预览列表故障')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('暂无在线预览')).toBeTruthy()
  })

  it('R1-P0-6: FeishuGroupDialog link mode warns when bots failed to be pulled into Feishu chat', async () => {
    const chatsRes: FeishuChatChoicesDto = {
      available: true,
      mainAppName: '共工助手',
      chats: [{ chatId: 'oc_1', name: '飞书前端群' }],
    }
    const meRes: FeishuIdentityView = {
      identity: { name: '陈晨', avatar: null, email: null, boundAt: '2026-11-01T00:00:00Z', notify: true },
    }
    const bindRes: GroupFeishuView = {
      available: true,
      mainAppName: '共工助手',
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '飞书前端群',
        boundAt: '2026-11-21T09:00:00Z',
        syncOutbound: true,
        syncAll: false,
      },
      chats: [],
      members: [],
      bots: [{ botId: 'b1', name: '代码助手', appId: 'cli_1', inChat: false, issue: null }],
      feishuError: null,
    }
    mockApi({
      'GET /feishu/chats': () => chatsRes,
      'GET /me/feishu': () => meRes,
      'PUT /groups/g1/feishu': () => bindRes,
    })

    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <Toaster />
        <FeishuGroupDialog onClose={onClose} />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('radio', { name: '关联到已有群' }))
    fireEvent.click(screen.getByRole('button', { name: '飞书群' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '飞书前端群' }))
    fireEvent.click(screen.getByRole('button', { name: '共工群' }))
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '前端群' }))

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '关联' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(await screen.findByText('已关联飞书群 · 1 个 Bot 没能拉入，原因见下方')).toBeTruthy()
  })
})
