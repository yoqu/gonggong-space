import type { GroupDto, GroupFeishuView } from '@gonggong/protocol'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GroupFeishuTab } from '../src/features/feishu/GroupFeishuTab'
import { mockApi } from './mockApi'

const group = { id: 'g1', name: '研发群', kind: 'group' } as GroupDto

const unbound: GroupFeishuView = {
  available: true,
  chat: null,
  chats: [{ chatId: 'oc_1', name: '飞书研发群' }],
  bots: [],
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
          chat: { groupId: 'g1', chatId: 'oc_1', name: '飞书研发群', boundAt: '2026-10-01T00:00:00Z' },
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
    fireEvent.click(await screen.findByRole('button', { name: '飞书群' }))
    fireEvent.click(await screen.findByText('飞书研发群'))
    fireEvent.click(screen.getByRole('button', { name: '绑定' }))
    expect(await screen.findByText('未绑定飞书应用')).toBeTruthy()
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ chatId: 'oc_1' })

    fireEvent.click(screen.getByRole('button', { name: '拉入飞书群' }))
    expect(await screen.findByText('已在群中')).toBeTruthy()
  })

  it('offers to rename the group after its Feishu chat when the names differ', async () => {
    const bound: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: { groupId: 'g1', chatId: 'oc_1', name: '飞书研发群', boundAt: '2026-10-01T00:00:00Z' },
    }
    const calls = mockApi({ 'GET /groups/g1/feishu': bound, 'PATCH /groups/g1': group })
    const { rerender } = render(<GroupFeishuTab group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '改为飞书群名' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: '飞书研发群' }))
    rerender(<GroupFeishuTab group={{ ...group, name: '飞书研发群' }} />)
    expect(screen.queryByRole('button', { name: '改为飞书群名' })).toBeNull()
  })

  it('explains that the main app must be configured first', async () => {
    mockApi({ 'GET /groups/g1/feishu': { available: false, chat: null, chats: [], bots: [] } })
    render(<GroupFeishuTab group={group} />)
    expect(await screen.findByText('系统管理员尚未配置飞书主应用，暂不能绑定飞书群。')).toBeTruthy()
  })

  it('unbinds after confirmation', async () => {
    let view: GroupFeishuView = {
      ...unbound,
      chats: [],
      chat: { groupId: 'g1', chatId: 'oc_1', name: '飞书研发群', boundAt: '2026-10-01T00:00:00Z' },
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
