import type { GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GroupFeishuTab } from '../src/features/feishu/GroupFeishuTab'
import { useToasts } from '../src/ui/toast'
import { mockApi } from './mockApi'

const group = { id: 'g1', name: '研发群', kind: 'group' } as GroupDto

const unbound: GroupFeishuView = {
  available: true,
  chat: null,
  chats: [{ chatId: 'oc_1', name: '飞书研发群' }],
  bots: [],
  members: [],
}

describe('群设置 · 飞书', () => {
  it('binds one of the main app chats, then adds a bot app missing from it', async () => {
    let view = unbound
    const calls = mockApi({
      'GET /groups/g1/feishu': () => view,
      'PUT /groups/g1/feishu': () => {
        view = {
          ...unbound,
          chats: [],
          chat: {
            groupId: 'g1',
            chatId: 'oc_1',
            name: '飞书研发群',
            boundAt: '2026-10-01T00:00:00Z',
            syncOutbound: true,
            syncAll: true,
          },
          bots: [
            { botId: 'b1', name: 'codex', appId: 'cli_b1', inChat: false },
            { botId: 'b2', name: 'claude', appId: null, inChat: false },
          ],
        }
        return view
      },
      'POST /groups/g1/feishu/bots/b1': () => {
        view = { ...view, bots: view.bots.map((b) => (b.botId === 'b1' ? { ...b, inChat: true } : b)) }
        return view
      },
    })
    render(<GroupFeishuTab group={group} />)
    expect(await screen.findByText('找不到群？请先把主应用拉进飞书群；已被其他群绑定的不显示')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '飞书群' }))
    fireEvent.click(await screen.findByText('飞书研发群'))
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))
    expect(await screen.findByText('未绑定飞书应用')).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ chatId: 'oc_1' })
    // A bot the binding could not add is pointed out, with why it matters and what to check.
    await waitFor(() =>
      expect(useToasts.getState().items.map((x) => x.message)).toContain(
        '已绑定飞书群 · 1 个 Bot 未入群，请在下方点「拉入飞书群」',
      ),
    )
    expect(screen.getByText('未在飞书群 · 回复不会同步到飞书')).toBeTruthy()
    expect(screen.getByText(/未入群的 Bot 回复不会同步到飞书群/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '拉入飞书群' }))
    expect(await screen.findByText('已在群中')).toBeTruthy()
    expect(screen.queryByText('未在飞书群 · 回复不会同步到飞书')).toBeNull()
  })

  it('creates a Feishu chat after listing who can and cannot be pulled in', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      bots: [
        { botId: 'b1', name: 'codex', appId: 'cli_b1', inChat: false },
        { botId: 'b2', name: 'claude', appId: null, inChat: false },
      ],
      members: [
        { userId: 'u1', name: '王磊', linked: true },
        { userId: 'u2', name: '李娜', linked: true },
        { userId: 'u3', name: '陈晨', linked: false },
      ],
    }
    const calls = mockApi({
      'GET /groups/g1/feishu': () => view,
      'POST /groups/g1/feishu/chat': () => {
        view = {
          ...view,
          chats: [],
          chat: {
            groupId: 'g1',
            chatId: 'oc_9',
            name: '研发群',
            boundAt: '2026-10-14T00:00:00Z',
            syncOutbound: true,
            syncAll: true,
          },
        }
        return view
      },
    })
    render(<GroupFeishuTab group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '创建飞书群' }))
    expect(await screen.findByText('拉入：王磊、李娜、codex')).toBeTruthy()
    expect(screen.getByText('未绑定飞书账号，不会拉入：陈晨')).toBeTruthy()
    expect(screen.getByText('没有飞书应用，不会拉入：claude')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByRole('button', { name: '解绑' })).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/feishu/chat')).toBe(true)
  })

  it('offers to rename the group after its Feishu chat when the names differ', async () => {
    const bound: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '飞书研发群',
        boundAt: '2026-10-01T00:00:00Z',
        syncOutbound: true,
        syncAll: true,
      },
    }
    const calls = mockApi({ 'GET /groups/g1/feishu': bound, 'PATCH /groups/g1': group })
    const { rerender } = render(<GroupFeishuTab group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '改为飞书群名' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: '飞书研发群' }))
    rerender(<GroupFeishuTab group={{ ...group, name: '飞书研发群' }} />)
    expect(screen.queryByRole('button', { name: '改为飞书群名' })).toBeNull()
  })

  it('syncs the Feishu chat members and reports who was left out', async () => {
    const bound: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '研发群',
        boundAt: '2026-10-01T00:00:00Z',
        syncOutbound: true,
        syncAll: true,
      },
    }
    const calls = mockApi({
      'GET /groups/g1/feishu': bound,
      'POST /groups/g1/feishu/sync-members': { added: 2, skippedUnlinked: 3, skippedNotInTeam: 1 },
    })
    render(<GroupFeishuTab group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '同步飞书群成员' }))
    await waitFor(() =>
      expect(useToasts.getState().items.map((i) => i.message)).toContain(
        '新加入 2 人；3 人未注册共工，1 人不在本团队',
      ),
    )
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/feishu/sync-members')).toBe(true)
  })

  it('turns off syncing web messages to the Feishu chat', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '研发群',
        boundAt: '2026-10-01T00:00:00Z',
        syncOutbound: true,
        syncAll: true,
      },
    }
    const calls = mockApi({
      'GET /groups/g1/feishu': () => view,
      'PATCH /groups/g1/feishu': (body: unknown) => {
        view = { ...view, chat: view.chat && { ...view.chat, ...(body as { syncOutbound: boolean }) } }
        return view
      },
    })
    render(<GroupFeishuTab group={group} />)
    const toggle = await screen.findByRole('switch', { name: '网页消息同步到飞书群' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ syncOutbound: false }),
    )
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '网页消息同步到飞书群' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    )
  })

  it('turns off 同步全部飞书消息, warning that senders outside 共工 are stored too', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '研发群',
        boundAt: '2026-10-01T00:00:00Z',
        syncOutbound: true,
        syncAll: true,
      },
    }
    const calls = mockApi({
      'GET /groups/g1/feishu': () => view,
      'PATCH /groups/g1/feishu': (body: unknown) => {
        view = { ...view, chat: view.chat && { ...view.chat, ...(body as { syncAll: boolean }) } }
        return view
      },
    })
    render(<GroupFeishuTab group={group} />)
    const toggle = await screen.findByRole('switch', { name: '同步全部飞书消息' })
    expect(screen.getByText(/没有共工账号的人发言也会保存到本群/)).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ syncAll: false }))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: '同步全部飞书消息' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    )
  })

  it('explains that the main app must be configured first', async () => {
    mockApi({ 'GET /groups/g1/feishu': { available: false, chat: null, chats: [], bots: [], members: [] } })
    render(<GroupFeishuTab group={group} />)
    expect(await screen.findByText('系统管理员尚未配置飞书主应用，暂不能绑定飞书群。')).toBeTruthy()
  })

  it('unbinds after confirmation', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: {
        groupId: 'g1',
        chatId: 'oc_1',
        name: '飞书研发群',
        boundAt: '2026-10-01T00:00:00Z',
        syncOutbound: true,
        syncAll: true,
      },
    }
    mockApi({
      'GET /groups/g1/feishu': () => view,
      'DELETE /groups/g1/feishu': () => {
        view = unbound
        return undefined
      },
    })
    render(<GroupFeishuTab group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '解绑' }))
    const buttons = await screen.findAllByRole('button', { name: '解绑' })
    fireEvent.click(buttons.at(-1) as HTMLElement)
    await waitFor(() => expect(screen.getByRole('button', { name: '绑定' })).toBeTruthy())
  })
})
