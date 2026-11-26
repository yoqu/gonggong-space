import type { FeishuAppView, TeamDto, TeamOnboardingDto, TeamParamsDto, UserDto } from '@gonggong/protocol'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { FeishuAppForm } from '../src/features/feishu/FeishuAppForm'
import {
  TeamGroupsTab,
  TeamOnboardingTab,
  TeamParamsTab,
  TeamReposTab,
} from '../src/features/teams/TeamAdminTabs'
import { TeamSettingsDialog } from '../src/features/teams/TeamSettingsDialog'
import { apiError, mockApi } from './mockApi'

const me: UserDto = {
  id: 'u1',
  account: 'admin',
  name: '林知行',
  role: 'member',
  mustChangePassword: false,
  disabled: false,
  gitProtocol: 'auto',
  email: null,
  avatar: null,
}

const team: TeamDto = {
  id: 't1',
  name: '支付组',
  avatar: null,
  role: 'admin',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  unread: 0,
}

const paramsData: TeamParamsDto = {
  overrides: {},
  platform: {
    offlineWaitMin: 5,
    approvalTimeoutMin: 10,
    chainMaxHops: 3,
    sessionReplayTokens: 4000,
    contextInlineTokens: 2000,
    attachmentsPerMessage: 5,
    questionsPerCard: 4,
    botConcurrencyDefault: 2,
  },
}

const onboardingData: TeamOnboardingDto = {
  groupId: 'g1',
  groupName: '新手群',
  botId: 'b1',
  botName: '小助手',
  feishuUrl: null,
  examples: ['问题一', '问题二', '问题三'],
  options: [{ id: 'g1', name: '新手群', bots: [{ id: 'b1', name: '小助手' }] }],
}

describe('Slice C P0 UX fixes (U-09, U-12)', () => {
  beforeEach(() => {
    useSession.setState({ user: me })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('U-09: FeishuAppForm hides create form and shows retryable Alert on load error', async () => {
    let fail = true
    const loaded: FeishuAppView = {
      app: {
        appId: 'cli_live01',
        status: 'connected',
        error: null,
        configError: null,
        review: 'approved',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    }
    mockApi({
      'GET /admin/feishu': () => (fail ? apiError(500, 'db_down', '数据库暂不可用') : loaded),
    })

    render(<FeishuAppForm path="/admin/feishu" removeLabel="移除主应用" />)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('飞书应用加载失败')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '扫码创建或接入' })).toBeNull()
    expect(screen.queryByLabelText('App ID')).toBeNull()

    fail = false
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }))
    expect(await screen.findByText('cli_live01')).toBeTruthy()
  })

  it('U-12: TeamParamsTab, TeamOnboardingTab, TeamReposTab, TeamGroupsTab show retryable Alert on load error', async () => {
    let fail = true
    mockApi({
      'GET /teams/t1/params': () => (fail ? apiError(500, 'err', '参数读取失败') : paramsData),
      'GET /teams/t1/onboarding': () => (fail ? apiError(500, 'err', '新手群读取失败') : onboardingData),
      'GET /teams/t1/repos': () => (fail ? apiError(500, 'err', '仓库读取失败') : []),
      'GET /teams/t1/groups': () => (fail ? apiError(500, 'err', '群列表读取失败') : []),
    })

    const { unmount } = render(
      <MemoryRouter>
        <TeamParamsTab team={team} />
        <TeamOnboardingTab team={team} />
        <TeamReposTab team={team} />
        <TeamGroupsTab team={team} onClose={() => {}} />
      </MemoryRouter>,
    )

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBe(4)
    for (const a of alerts) expect(within(a).getByRole('button', { name: '重试' })).toBeTruthy()

    fail = false
    for (const a of alerts) fireEvent.click(within(a).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByText('团队里还没有仓库')).toBeTruthy()
    expect(screen.getByText('团队里还没有群')).toBeTruthy()
    unmount()
  })

  it('U-12: TeamOnboardingTab disables 保存 when clean and guards unsaved edits on tab switch', async () => {
    mockApi({
      'GET /teams/t1/onboarding': onboardingData,
      'GET /teams/t1/members': [],
      'GET /teams/t1/params': paramsData,
      'GET /teams/t1/mcp': [],
    })

    render(
      <MemoryRouter>
        <TeamSettingsDialog team={team} tab="onboarding" onClose={() => {}} />
      </MemoryRouter>,
    )

    const saveBtn = await screen.findByRole('button', { name: '保存' })
    expect(saveBtn.hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByLabelText('示例问题 1'), { target: { value: '新的问题' } })
    expect(saveBtn.hasAttribute('disabled')).toBe(false)

    // Switching tabs should prompt discard dialog instead of silently dropping changes
    fireEvent.click(screen.getByRole('button', { name: '参数' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('U-12: TeamMcpTab guards unsaved edits on tab switch in TeamSettingsDialog', async () => {
    mockApi({
      'GET /teams/t1/mcp': [
        {
          id: 'm1',
          enabled: true,
          config: { transport: 'http', name: 'wiki', url: 'https://wiki.test', headers: {} },
        },
      ],
      'GET /teams/t1/members': [],
      'GET /teams/t1/params': paramsData,
    })

    render(
      <MemoryRouter>
        <TeamSettingsDialog team={team} tab="mcp" onClose={() => {}} />
      </MemoryRouter>,
    )

    const sw = await screen.findByRole('switch', { name: '启用 wiki' })
    fireEvent.click(sw)

    fireEvent.click(screen.getByRole('button', { name: '参数' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })
})
