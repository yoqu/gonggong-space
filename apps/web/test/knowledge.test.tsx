import type {
  GroupKnowledgeDto,
  KnowledgeDetailDto,
  KnowledgeEntryDto,
  KnowledgeVersionDto,
  MessageDto,
} from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageActions } from '../src/features/chat/MessageActions'
import { KnowledgeView } from '../src/features/knowledge/KnowledgeView'
import { realtime } from '../src/lib/realtime'
import { apiError, mockApi } from './mockApi'

class NoopSocket {
  close() {}
}
beforeEach(() => vi.stubGlobal('WebSocket', NoopSocket))
afterEach(() => vi.unstubAllGlobals())

const recent = new Date(Date.now() - 5 * 60_000).toISOString()

const entry = (o: Partial<KnowledgeEntryDto> = {}): KnowledgeEntryDto => ({
  id: 'k1',
  title: '发布流程',
  excerpt: '先打 tag 再部署',
  tags: ['发布'],
  pinned: false,
  version: 2,
  updatedBy: { kind: 'user', id: 'u1', name: '王磊' },
  updatedAt: recent,
  ...o,
})
const detail = (o: Partial<KnowledgeDetailDto> = {}): KnowledgeDetailDto => {
  const { excerpt: _, ...rest } = entry()
  return { ...rest, body: '先打 tag 再部署', ...o }
}
const kb = (entries: KnowledgeEntryDto[], canManage = false): GroupKnowledgeDto => ({ entries, canManage })

const row = async (title: string) => (await screen.findByText(title)).closest('.kb-row') as HTMLElement

describe('group knowledge list', () => {
  it('shows pinned entries, tags, excerpts and marks bot edits', async () => {
    mockApi({
      'GET /groups/g1/knowledge': kb([
        entry({ id: 'k2', title: '编码约定', pinned: true, excerpt: '用 biome', tags: ['规范'] }),
        entry({ updatedBy: { kind: 'bot', id: 'b1', name: '小王的 Claude' } }),
      ]),
    })
    render(<KnowledgeView groupId="g1" />)
    const pinned = await row('编码约定')
    expect(within(pinned).getByText('置顶')).toBeTruthy()
    expect(within(pinned).getByText('规范')).toBeTruthy()
    expect(within(pinned).getByText('用 biome')).toBeTruthy()
    const byBot = await row('发布流程')
    expect(within(byBot).getByText('Bot')).toBeTruthy()
    expect(within(byBot).getByText(/小王的 Claude/)).toBeTruthy()
    expect(within(byBot).getByText(/5 分钟前/)).toBeTruthy()
  })

  it('explains what the knowledge base is for when empty', async () => {
    mockApi({ 'GET /groups/g1/knowledge': kb([]) })
    render(<KnowledgeView groupId="g1" />)
    expect(
      await screen.findByText(
        '把群里需要所有 Bot 记住的事实、约定写在这里，Bot 每次运行都能读到，也会自己补充。',
      ),
    ).toBeTruthy()
  })

  it('searches on the server', async () => {
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([entry()]),
      'GET /groups/g1/knowledge?q=%E7%BA%A6%E5%AE%9A': kb([entry({ id: 'k2', title: '编码约定' })]),
    })
    render(<KnowledgeView groupId="g1" />)
    await screen.findByText('发布流程')
    fireEvent.change(screen.getByPlaceholderText('搜索知识库'), { target: { value: '约定' } })
    await screen.findByText('编码约定')
    expect(calls.some((c) => c.path === '/groups/g1/knowledge?q=%E7%BA%A6%E5%AE%9A')).toBe(true)
  })

  it('refetches on a group.knowledge event of its group', async () => {
    let n = 0
    mockApi({ 'GET /groups/g1/knowledge': () => kb(n++ ? [entry({ title: '新条目' })] : [entry()]) })
    let push: ((e: never) => void) | undefined
    vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
      push = h as never
      return () => {}
    })
    render(<KnowledgeView groupId="g1" />)
    await screen.findByText('发布流程')
    act(() => push!({ t: 'group.knowledge', groupId: 'g2' } as never))
    act(() => push!({ t: 'group.knowledge', groupId: 'g1', entryId: 'k1' } as never))
    await screen.findByText('新条目')
    expect(n).toBe(2)
  })

  it('offers pin and delete only to group admins', async () => {
    mockApi({ 'GET /groups/g1/knowledge': kb([entry()]) })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(within(await row('发布流程')).getByRole('button', { name: '更多' }))
    await screen.findByText('历史版本')
    expect(screen.queryByText('置顶')).toBeNull()
    expect(screen.queryByText('删除')).toBeNull()
  })

  it('lets admins pin and delete (after confirming)', async () => {
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([entry()], true),
      'PATCH /knowledge/k1': detail({ pinned: true, version: 3 }),
      'DELETE /knowledge/k1': undefined,
    })
    render(<KnowledgeView groupId="g1" />)
    const r = await row('发布流程')
    fireEvent.click(within(r).getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('置顶'))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ baseVersion: 2, pinned: true }),
    )
    fireEvent.click(within(r).getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('删除'))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/knowledge/k1')).toBe(true),
    )
  })
})

describe('knowledge editor', () => {
  it('creates an entry with tags', async () => {
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([]),
      'POST /groups/g1/knowledge': detail(),
    })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '新建条目' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '发布流程' } })
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '# 步骤\n先打 tag' } })
    const tags = screen.getByLabelText('标签')
    fireEvent.change(tags, { target: { value: '发布' } })
    fireEvent.keyDown(tags, { key: 'Enter' })
    fireEvent.click(screen.getByRole('radio', { name: '预览' }))
    expect((await screen.findByRole('heading', { name: '步骤' })).tagName).toBe('H1')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        title: '发布流程',
        body: '# 步骤\n先打 tag',
        tags: ['发布'],
      }),
    )
  })

  it('asks before discarding a half-written entry', async () => {
    mockApi({ 'GET /groups/g1/knowledge': kb([]) })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(await screen.findByRole('button', { name: '新建条目' }))
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '写到一半' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    const ask = await screen.findByRole('alertdialog', { name: '要放弃未保存的更改吗？' })
    fireEvent.click(within(ask).getByRole('button', { name: '继续编辑' }))
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('写到一半')
  })

  it('edits against the version it loaded', async () => {
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([entry()]),
      'GET /knowledge/k1': detail(),
      'PATCH /knowledge/k1': detail({ version: 3 }),
    })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(await screen.findByText('发布流程'))
    fireEvent.click(await screen.findByRole('radio', { name: '编辑' }))
    fireEvent.change(await screen.findByLabelText('正文'), { target: { value: '先打 tag，再部署到预发' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        baseVersion: 2,
        title: '发布流程',
        body: '先打 tag，再部署到预发',
        tags: ['发布'],
      }),
    )
  })

  it('tells about a conflicting save and reloads the latest version', async () => {
    let gets = 0
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([entry()]),
      'GET /knowledge/k1': () => (gets++ ? detail({ version: 3, body: 'Bot 改过的内容' }) : detail()),
      'PATCH /knowledge/k1': apiError(409, 'conflict', '已被他人更新'),
    })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(await screen.findByText('发布流程'))
    fireEvent.click(await screen.findByRole('radio', { name: '编辑' }))
    fireEvent.change(await screen.findByLabelText('正文'), { target: { value: '我的修改' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('这条知识已被他人更新')
    fireEvent.click(screen.getByRole('button', { name: '载入最新版本' }))
    await waitFor(() =>
      expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('Bot 改过的内容'),
    )
    expect(screen.queryByText('这条知识已被他人更新')).toBeNull()
    expect(calls.filter((c) => c.path === '/knowledge/k1' && c.method === 'GET')).toHaveLength(2)
  })
})

describe('knowledge history', () => {
  const version = (o: Partial<KnowledgeVersionDto>): KnowledgeVersionDto => ({
    version: 1,
    title: '发布流程',
    body: '先打 tag',
    tags: [],
    action: 'create',
    by: { kind: 'user', id: 'u1', name: '王磊' },
    at: recent,
    current: false,
    ...o,
  })

  it('default-selects the latest version, confirms rollback with loading lock and reloads the list', async () => {
    let resolveRollback: (() => void) | null = null
    const calls = mockApi({
      'GET /groups/g1/knowledge': kb([entry()]),
      'GET /knowledge/k1/versions': [
        version({
          version: 2,
          body: '先打 tag\n再部署',
          action: 'update',
          by: { kind: 'bot', id: 'b1', name: '小王的 Claude' },
          current: true,
        }),
        version({}),
      ],
      'POST /knowledge/k1/rollback': () =>
        new Promise<Response>((resolve) => {
          resolveRollback = () => resolve(new Response(JSON.stringify(detail({ version: 3 }))))
        }),
    })
    render(<KnowledgeView groupId="g1" />)
    fireEvent.click(within(await row('发布流程')).getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('历史版本'))
    const v2 = (await screen.findByText('v2')).closest('.kb-version') as HTMLElement
    expect(within(v2).getByText('当前')).toBeTruthy()
    expect(within(v2).getByText('Bot')).toBeTruthy()
    expect(within(v2).getByRole('button', { name: '回滚到此版本' })).toHaveProperty('disabled', true)
    // Latest version (v2) is selected and previewed automatically on open.
    expect(await screen.findByText('+再部署')).toBeTruthy()

    const listLoadsBefore = calls.filter((c) => c.path === '/groups/g1/knowledge').length
    const v1 = screen.getByText('v1').closest('.kb-version') as HTMLElement
    fireEvent.click(within(v1).getByRole('button', { name: '回滚到此版本' }))
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    const confirm = await screen.findByRole('alertdialog', { name: '要回滚到版本 v1 吗？' })
    expect(
      within(confirm).getByText('当前内容会被替换为此版本。现有版本仍会保留在历史记录中，可随时切回。'),
    ).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    fireEvent.click(within(v1).getByRole('button', { name: '回滚到此版本' }))
    const confirm2 = await screen.findByRole('alertdialog', { name: '要回滚到版本 v1 吗？' })
    const okBtn = within(confirm2).getByRole('button', { name: '回滚到此版本' }) as HTMLButtonElement
    const cancelBtn = within(confirm2).getByRole('button', { name: '取消' }) as HTMLButtonElement
    expect(okBtn.className).toContain('ui-btn--destructive')
    fireEvent.click(okBtn)
    await waitFor(() => expect(okBtn.getAttribute('aria-busy')).toBe('true'))
    expect(cancelBtn.disabled).toBe(true)
    await act(async () => {
      resolveRollback?.()
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/knowledge/k1/rollback',
      body: { version: 1 },
    })
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/groups/g1/knowledge').length).toBeGreaterThan(listLoadsBefore),
    )
  })
})

describe('存入知识库 from a message', () => {
  const message = {
    id: 'm1',
    seq: 42,
    groupId: 'g1',
    kind: 'bot',
    authorId: 'b1',
    authorName: '小王的 Claude',
    body: '部署前先跑迁移\n然后重启服务',
    mentions: [],
    runId: 'r1',
    createdAt: new Date().toISOString(),
    attachments: [],
    quote: null,
  } as unknown as MessageDto

  it('opens the create form prefilled from the message', async () => {
    const calls = mockApi({ 'POST /groups/g1/knowledge': detail() })
    render(
      <MemoryRouter>
        <MessageActions message={message} link="" onQuote={() => {}} copyText={message.body} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('存入知识库'))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('部署前先跑迁移')
    const body = (screen.getByLabelText('正文') as HTMLTextAreaElement).value
    expect(body).toBe('部署前先跑迁移\n然后重启服务\n\n来源：#42 小王的 Claude')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ title: '部署前先跑迁移', body }),
    )
  })

  it('clips a long first line to the title limit', async () => {
    mockApi({})
    const long = { ...message, body: 'x'.repeat(150) } as MessageDto
    render(
      <MemoryRouter>
        <MessageActions message={long} link="" onQuote={() => {}} copyText={long.body} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByText('存入知识库'))
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toHaveLength(100)
  })
})
