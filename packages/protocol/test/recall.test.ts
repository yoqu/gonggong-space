import { describe, expect, it } from 'vitest'
import { ApiError, MessageDto, RECALL_WINDOW_MS, WebEvent } from '../src/index.js'

describe('message recall & delete', () => {
  it('parses the realtime events', () => {
    const recalled = { t: 'message.recalled', groupId: 'g1', messageId: 'm1' }
    expect(WebEvent.parse(recalled)).toEqual(recalled)
    const hidden = { t: 'message.hidden', groupId: 'g1', messageId: 'm1' }
    expect(WebEvent.parse(hidden)).toEqual(hidden)
  })

  it('flags recalled messages and has an explicit error code for late recalls', () => {
    const m = MessageDto.parse({
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u1',
      authorName: '王磊',
      body: '',
      mentions: [],
      runId: null,
      createdAt: '2026-09-24T00:00:00.000Z',
      attachments: [],
      quote: null,
      recalled: true,
    })
    expect(m.recalled).toBe(true)
    expect(ApiError.parse({ error: 'recall_expired', message: '超过 24 小时，无法撤回' }).error).toBe(
      'recall_expired',
    )
    expect(RECALL_WINDOW_MS).toBe(24 * 3600_000)
  })
})
