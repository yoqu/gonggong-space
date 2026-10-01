import type { MessageDto } from '@gonggong/protocol'
import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  localStorage.setItem('gg.locale', 'en')
  vi.resetModules()
})

afterAll(() => {
  localStorage.setItem('gg.locale', 'zh')
  vi.resetModules()
})

const event = (o: Partial<MessageDto>): MessageDto => ({
  id: 'e1',
  seq: 1,
  groupId: 'g1',
  kind: 'event',
  authorId: null,
  authorName: '系统',
  body: '小王 撤回了一条消息',
  mentions: [],
  runId: null,
  createdAt: new Date().toISOString(),
  attachments: [],
  quote: null,
  ...o,
})

describe('chat in English', () => {
  it('renders an event from its translatable source, falling back to the Chinese body', async () => {
    const { EventRow, eventText } = await import('../src/features/chat/TimelineItems')
    render(<EventRow m={event({ i18n: { key: '{name} 撤回了一条消息', params: { name: '小王' } } })} />)
    expect(screen.getByText('小王 recalled a message')).toBeTruthy()
    expect(eventText(event({}))).toBe('小王 撤回了一条消息')
  })

  it('shows the group-list preview and a run step from their translatable sources', async () => {
    const { lastText } = await import('../src/app/workspace')
    const { stepText } = await import('../src/features/runs/mcp')
    const i18n = { key: '{name} 撤回了一条消息', params: { name: '小王' } }
    expect(lastText({ last: '小王 撤回了一条消息', lastI18n: i18n })).toBe('小王 recalled a message')
    expect(lastText({ last: '小王：你好' })).toBe('小王：你好')
    expect(stepText({ step: '小王 撤回了一条消息', stepI18n: i18n })).toBe('小王 recalled a message')
    expect(stepText({ step: 'pnpm test' })).toBe('pnpm test')
  })

  it('spells run process texts in English', async () => {
    const { buildItems, fmtWorked } = await import('../src/features/runs/activity')
    expect(fmtWorked(65_000)).toBe('1m 5s')
    const step = (key: string, kind: string, mono: string) => ({ key, kind, label: kind, mono, title: mono })
    const [group] = buildItems(
      [step('a', 'edit', 'a.ts'), step('b', 'execute', 'pnpm test'), step('c', 'edit', 'b.ts')],
      null,
      true,
      null,
    )
    expect(group).toMatchObject({ kind: 'group', title: 'Edited files, ran commands' })
  })
})
