import type { MessageDto } from '@gonggong/protocol'
import { describe, expect, it } from 'vitest'
import { messageSnippet } from '../src/features/chat/snippet'

const msg = (o: Partial<MessageDto>): MessageDto => ({
  id: 'm1',
  seq: 1,
  groupId: 'g1',
  kind: 'user',
  authorId: 'u1',
  authorName: '王磊',
  body: '',
  mentions: [],
  runId: null,
  createdAt: '2026-11-07T08:00:00Z',
  attachments: [],
  quote: null,
  reactions: [],
  ...o,
})

describe('messageSnippet', () => {
  it('names hidden and recalled messages instead of showing their body', () => {
    expect(messageSnippet(msg({ body: '秘密', hidden: true }))).toBe('你已删除这条消息')
    expect(messageSnippet(msg({ body: '秘密', recalled: true }))).toBe('该消息已撤回')
  })

  it('strips markdown line by line and collapses whitespace', () => {
    expect(messageSnippet(msg({ body: '## 结论\n耗时 **39s**，见 `run.ts`\n- 先拆分' }))).toBe(
      '结论 耗时 39s，见 run.ts 先拆分',
    )
  })

  it('truncates to 140 characters', () => {
    expect(messageSnippet(msg({ body: '字'.repeat(200) }))).toHaveLength(140)
  })

  it('falls back to [附件] for an attachment-only message', () => {
    const attachments = [{ id: 'a1' }] as unknown as MessageDto['attachments']
    expect(messageSnippet(msg({ attachments }))).toBe('[附件]')
    expect(messageSnippet(msg({}))).toBe('')
  })
})
