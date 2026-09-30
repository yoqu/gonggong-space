import type { BotDto, GroupDto, WebEvent } from '@gonggong/protocol'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspace } from '../src/app/workspace'
import { ProviderBanner } from '../src/features/chat/ProviderBanner'
import { realtime } from '../src/lib/realtime'
import { mockApi } from './mockApi'

const group = { id: 'g1', name: '前端组', botIds: ['b1', 'b2'] } as GroupDto
const bot = (id: string, name: string) => ({ id, name }) as BotDto

let handlers: Set<(e: WebEvent) => void>
const emit = (e: WebEvent) =>
  act(() => {
    for (const h of handlers) h(e)
  })

beforeEach(() => {
  handlers = new Set()
  vi.spyOn(realtime, 'subscribe').mockImplementation((h) => {
    handlers.add(h)
    return () => handlers.delete(h)
  })
  useWorkspace.setState({ bots: [bot('b1', '小王的 Claude'), bot('b2', '审查员'), bot('b3', '别群的')] })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('provider banner', () => {
  it('names the session and the new provider of each bot in the group', async () => {
    mockApi({
      'GET /groups/g1/provider-state': {
        items: [
          { botId: 'b1', session: '官方登录', effective: 'Kimi' },
          { botId: 'b3', session: 'A', effective: 'B' },
        ],
      },
    })
    render(<ProviderBanner group={group} />)
    expect(
      await screen.findByText('小王的 Claude 本会话使用 官方登录；已切换为 Kimi，开启新会话后生效'),
    ).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '开启新会话' })).toHaveLength(1)
  })

  it('replaces its items from group.providerState of this group only', async () => {
    mockApi({ 'GET /groups/g1/provider-state': { items: [] } })
    const { container } = render(<ProviderBanner group={group} />)
    await waitFor(() => expect(container.textContent).toBe(''))
    emit({
      t: 'group.providerState',
      groupId: 'g1',
      items: [{ botId: 'b2', session: 'Kimi', effective: 'GLM' }],
    })
    expect(screen.getByText('审查员 本会话使用 Kimi；已切换为 GLM，开启新会话后生效')).toBeTruthy()
    emit({ t: 'group.providerState', groupId: 'g2', items: [] })
    expect(screen.getByText(/审查员 本会话使用 Kimi/)).toBeTruthy()
    emit({ t: 'group.providerState', groupId: 'g1', items: [] })
    expect(screen.queryByText(/本会话使用/)).toBeNull()
  })

  it('开启新会话 sends /new to that bot like the Agent command', async () => {
    const calls = mockApi({
      'GET /groups/g1/provider-state': { items: [{ botId: 'b1', session: '官方登录', effective: 'Kimi' }] },
      'POST /groups/g1/messages': { id: 'msg1' },
    })
    render(<ProviderBanner group={group} />)
    fireEvent.click(await screen.findByRole('button', { name: '开启新会话' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        body: '/new @小王的 Claude',
        attachmentIds: [],
        quote: null,
        appendTo: null,
      }),
    )
  })
})
