import type { GroupDto, GroupFeishuView, MessageDto } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useSession } from '../src/app/session'
import { useWorkspace } from '../src/app/workspace'
import { FeishuIssueEventRow } from '../src/features/feishu/FeishuIssueEvent'
import { GroupFeishuTab } from '../src/features/feishu/GroupFeishuTab'
import { useToasts } from '../src/ui/toast'
import { mockApi } from './mockApi'

const group = { id: 'g1', name: '研发群', kind: 'group' } as GroupDto

const unbound: GroupFeishuView = {
  available: true,
  mainAppName: '共工助手',
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
            {
              botId: 'b1',
              name: 'codex',
              appId: 'cli_b1',
              inChat: false,
              issue: { code: 232017, message: 'operator has no permission' },
            },
            { botId: 'b2', name: 'claude', appId: null, inChat: false, issue: null },
          ],
        }
        return view
      },
      'POST /groups/g1/feishu/bots/b1': () => {
        view = {
          ...view,
          bots: view.bots.map((b) => (b.botId === 'b1' ? { ...b, inChat: true, issue: null } : b)),
        }
        return view
      },
    })
    render(<GroupFeishuTab group={group} />)
    // Only chats the main app's bot is in can be listed: say which bot, and let the admin refresh after adding it.
    expect(
      await screen.findByText(
        '只列出「共工助手」机器人已加入的群；看不到的群，请在飞书群设置 › 群机器人里添加它后点刷新',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2))
    fireEvent.click(await screen.findByRole('button', { name: '飞书群' }))
    fireEvent.click(await screen.findByText('飞书研发群'))
    fireEvent.click(screen.getByRole('button', { name: '关联' }))
    expect(await screen.findByText('未接入飞书')).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ chatId: 'oc_1' })
    // Bots are pulled in on binding; one Feishu refused shows why in plain words, its code second, and a retry.
    await waitFor(() =>
      expect(useToasts.getState().items.map((x) => x.message)).toContain(
        '已关联飞书群 · 1 个 Bot 没能拉入，原因见下方',
      ),
    )
    expect(
      screen.getByText(
        '没能拉入飞书群：飞书群设置了仅群主和管理员可添加成员。请飞书群主在群设置里改为所有人可添加，或把共工机器人设为群管理员。',
      ),
    ).toBeTruthy()
    expect(screen.getByText('飞书错误码 232017').getAttribute('title')).toBe('operator has no permission')
    expect(screen.queryByText(/未入群的 Bot 回复不会同步到飞书群/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('已在群中')).toBeTruthy()
    expect(screen.queryByText('飞书错误码 232017')).toBeNull()
  })

  it('creates a Feishu chat after listing who can and cannot be pulled in', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      bots: [
        { botId: 'b1', name: 'codex', appId: 'cli_b1', inChat: false, issue: null },
        { botId: 'b2', name: 'claude', appId: null, inChat: false, issue: null },
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
    expect(await screen.findByRole('button', { name: '取消关联' })).toBeTruthy()
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
    mockApi({
      'GET /groups/g1/feishu': {
        available: false,
        mainAppName: null,
        chat: null,
        chats: [],
        bots: [],
        members: [],
      },
    })
    render(<GroupFeishuTab group={group} />)
    expect(await screen.findByText('系统管理员尚未接入飞书，暂不能关联飞书群。')).toBeTruthy()
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
    fireEvent.click(await screen.findByRole('button', { name: '取消关联' }))
    const buttons = await screen.findAllByRole('button', { name: '取消关联' })
    fireEvent.click(buttons.at(-1) as HTMLElement)
    await waitFor(() => expect(screen.getByRole('button', { name: '关联' })).toBeTruthy())
  })
})

describe('飞书错误事件', () => {
  const event = (o: Partial<MessageDto>): MessageDto =>
    ({
      id: 'm1',
      groupId: 'g1',
      kind: 'event',
      body: '',
      createdAt: '2026-11-01T00:00:00Z',
      i18n: {
        key: '{bot} 的回复没有同步到飞书群：{what}{todo}',
        params: {
          bot: 'codex',
          what: { key: '机器人不在飞书群里。' },
          todo: { key: '请群管理员把它拉入飞书群，或在飞书群设置里添加该机器人。' },
        },
      },
      feishuIssue: { botId: 'b1', code: 230002, message: 'Bot/User can NOT be out of the chat.' },
      ...o,
    }) as MessageDto
  const asMember = (isAdmin: boolean) => {
    useSession.setState({ user: { id: 'u1' } as never, status: 'ready' })
    useWorkspace.setState({
      groups: [{ ...group, members: [{ userId: 'u1', isAdmin }] } as unknown as GroupDto],
    })
  }
  const issueOf = (m: MessageDto) => m.feishuIssue as NonNullable<MessageDto['feishuIssue']>

  it('says what happened in plain words, the code second, and lets an admin pull the bot in', async () => {
    asMember(true)
    const calls = mockApi({ 'POST /groups/g1/feishu/bots/b1': {} })
    const m = event({})
    render(<FeishuIssueEventRow m={m} issue={issueOf(m)} />)
    expect(
      screen.getByText(
        'codex 的回复没有同步到飞书群：机器人不在飞书群里。请群管理员把它拉入飞书群，或在飞书群设置里添加该机器人。',
      ),
    ).toBeTruthy()
    expect(screen.getByText('飞书错误码 230002').getAttribute('title')).toBe(
      'Bot/User can NOT be out of the chat.',
    )
    fireEvent.click(screen.getByRole('button', { name: '一键拉入' }))
    expect(await screen.findByText('已拉入飞书群')).toBeTruthy()
    expect(calls.some((c) => c.method === 'POST' && c.path === '/groups/g1/feishu/bots/b1')).toBe(true)
  })

  it('offers no pull-in to members, nor when pulling in would not help', () => {
    asMember(false)
    const m = event({})
    const { unmount } = render(<FeishuIssueEventRow m={m} issue={issueOf(m)} />)
    expect(screen.queryByRole('button', { name: '一键拉入' })).toBeNull()
    unmount()
    asMember(true)
    const muted = event({ feishuIssue: { botId: 'b1', code: 230035, message: 'no permission to send' } })
    render(<FeishuIssueEventRow m={muted} issue={issueOf(muted)} />)
    expect(screen.queryByRole('button', { name: '一键拉入' })).toBeNull()
  })
})
