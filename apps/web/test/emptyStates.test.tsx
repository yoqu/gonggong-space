import type {
  BotDto,
  GroupKnowledgeDto,
  GroupPreviewsDto,
  GroupSchedulesDto,
  UserDto,
} from '@gonggong/protocol'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { BotsAdminPage } from '../src/features/bots/BotsAdminPage'
import { KnowledgeView } from '../src/features/knowledge/KnowledgeView'
import { PluginLayerList } from '../src/features/plugins/PluginLayer'
import { PreviewsView } from '../src/features/previews/PreviewsView'
import { resetPreviews } from '../src/features/previews/store'
import { SchedulesView } from '../src/features/schedules/SchedulesView'
import { resetSchedules } from '../src/features/schedules/store'
import { MySecrets } from '../src/features/secrets/MySecrets'
import { SecretLayerList } from '../src/features/secrets/SecretLayer'
import { mockApi } from './mockApi'

/** The empty state titled `title`, checked to carry 共字君's scene above it. */
const emptyWithArt = async (title: string) => {
  const empty = (await screen.findByText(title)).closest('.ui-empty') as HTMLElement
  expect(empty.querySelector('.ui-empty__art svg.ui-art .ui-mascot')).toBeTruthy()
  return empty
}

/** A reply held back for the whole test, so the view stays loading. */
const never = () => new Promise<never>(() => {})

class NoopSocket {
  close() {}
}
beforeEach(() => {
  resetSchedules()
  resetPreviews()
  vi.stubGlobal('WebSocket', NoopSocket)
  useWorkspace.setState({ groups: [], bots: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('empty states draw 共字君 and carry the page action', () => {
  it('定时任务', async () => {
    mockApi({ 'GET /groups/g1/schedules': { schedules: [] } satisfies GroupSchedulesDto })
    render(<SchedulesView groupId="g1" />)
    const empty = await emptyWithArt('还没有定时任务')
    expect(within(empty).getByRole('button', { name: '新建定时任务' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '新建定时任务' })).toHaveLength(1)
  })

  it('知识库', async () => {
    mockApi({ 'GET /groups/g1/knowledge': { entries: [], canManage: false } satisfies GroupKnowledgeDto })
    render(<KnowledgeView groupId="g1" />)
    const empty = await emptyWithArt('还没有知识')
    expect(within(empty).getByRole('button', { name: '新建条目' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '新建条目' })).toHaveLength(1)
  })

  it('预览与服务: one empty state when the group has neither', async () => {
    mockApi({
      'GET /groups/g1/previews': {
        previews: [],
        services: [],
        manageableBotIds: [],
      } satisfies GroupPreviewsDto,
    })
    render(<PreviewsView groupId="g1" />)
    await emptyWithArt('暂无预览和托管服务')
    expect(screen.queryByText('暂无预览')).toBeNull()
  })

  it('我的密钥', async () => {
    mockApi({ 'GET /me/secrets': [] })
    render(<MySecrets />)
    await emptyWithArt('没有需要你填写的密钥')
  })

  it('群密钥', async () => {
    mockApi({ 'GET /groups/g1/secrets': [], 'GET /me/secrets': [] })
    render(<SecretLayerList base="/groups/g1/secrets" scope="group" bots={[]} />)
    const empty = await emptyWithArt('暂无密钥')
    expect(within(empty).getByRole('button', { name: '新建密钥…' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '新建密钥…' })).toHaveLength(1)
  })

  it('插件', async () => {
    mockApi({ 'GET /admin/plugins': [] })
    render(<PluginLayerList base="/admin/plugins" />)
    const empty = await emptyWithArt('还没有插件')
    expect(within(empty).getByRole('button', { name: '上传文件夹…' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '上传 zip…' })).toHaveLength(1)
  })
})

describe('views show a loading state until their data arrives', () => {
  it('定时任务', () => {
    mockApi({ 'GET /groups/g1/schedules': never })
    render(<SchedulesView groupId="g1" />)
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
    expect(screen.queryByText('还没有定时任务')).toBeNull()
  })

  it('知识库', () => {
    mockApi({ 'GET /groups/g1/knowledge': never })
    render(<KnowledgeView groupId="g1" />)
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
    expect(screen.queryByText('还没有知识')).toBeNull()
  })

  it('预览与服务', () => {
    mockApi({ 'GET /groups/g1/previews': never })
    render(<PreviewsView groupId="g1" />)
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
  })

  it('管理后台 · Bot', () => {
    useSession.setState({ user: { id: 'u0', name: '陈晨', role: 'sysadmin' } as UserDto, status: 'ready' })
    mockApi({ 'GET /admin/bots': never, 'GET /admin/teams': [], 'GET /users': [] })
    render(
      <MemoryRouter>
        <BotsAdminPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status', { name: '加载中' })).toBeTruthy()
    expect(screen.queryByText('还没有 Bot')).toBeNull()
  })

  it('管理后台 · Bot still says so when there is none', async () => {
    useSession.setState({ user: { id: 'u0', name: '陈晨', role: 'sysadmin' } as UserDto, status: 'ready' })
    mockApi({ 'GET /admin/bots': [] satisfies BotDto[], 'GET /admin/teams': [], 'GET /users': [] })
    render(
      <MemoryRouter>
        <BotsAdminPage />
      </MemoryRouter>,
    )
    await emptyWithArt('还没有 Bot')
    expect(screen.queryByRole('status', { name: '加载中' })).toBeNull()
  })
})
