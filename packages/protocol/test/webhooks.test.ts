import { describe, expect, it } from 'vitest'
import {
  CreateWebhookReq,
  MessageDto,
  UpdateWebhookReq,
  WEBHOOK_MAX_BOTS,
  WebEvent,
  WebhookCallReq,
  WebhookCreateArgs,
  WebhookDeleteArgs,
  WebhookListArgs,
  WebhookUpdateArgs,
} from '../src/index.js'

describe('webhooks protocol', () => {
  it('validates create and update payloads', () => {
    expect(CreateWebhookReq.parse({ name: '  Jenkins 部署  ' })).toEqual({
      name: 'Jenkins 部署',
      botIds: [],
      runOptions: {},
      prompt: null,
    })
    expect(
      CreateWebhookReq.parse({
        name: 'Jenkins 部署',
        botIds: ['b1'],
        runOptions: { b1: { model: 'opus', effort: 'high' } },
      }).runOptions,
    ).toEqual({ b1: { model: 'opus', effort: 'high' } })
    expect(CreateWebhookReq.safeParse({ name: '   ' }).success).toBe(false)
    expect(
      CreateWebhookReq.safeParse({ name: 'x', botIds: Array(WEBHOOK_MAX_BOTS + 1).fill('b') }).success,
    ).toBe(false)
    expect(UpdateWebhookReq.safeParse({ enabled: false }).success).toBe(true)
    expect(UpdateWebhookReq.safeParse({ prompt: null }).success).toBe(true)
    expect(UpdateWebhookReq.safeParse({ prompt: '  ' }).success).toBe(false)
  })

  it('validates inbound call payloads', () => {
    expect(WebhookCallReq.parse({ text: '构建失败' })).toEqual({
      text: '构建失败',
      mention: false,
    })
    expect(
      WebhookCallReq.safeParse({
        text: '构建失败',
        mention: true,
        attachment: { name: 'console-tail.log', content: 'error line' },
        dedupeKey: 'job#42',
      }).success,
    ).toBe(true)
    expect(WebhookCallReq.safeParse({ text: '构建失败', mention: ['共字君'] }).success).toBe(true)
    expect(WebhookCallReq.safeParse({ text: '构建失败', mention: [] }).success).toBe(false)
    expect(WebhookCallReq.safeParse({ text: '  ' }).success).toBe(false)
    expect(WebhookCallReq.safeParse({ text: 'ok', attachment: { name: ' ', content: 'x' } }).success).toBe(
      false,
    )
  })

  it('validates MCP tool arguments', () => {
    expect(
      WebhookCreateArgs.safeParse({
        name: 'Jenkins 部署',
        bots: ['共字君'],
        run_options: [{ bot: '共字君', model: 'opus', effort: 'high' }],
      }).success,
    ).toBe(true)
    expect(WebhookCreateArgs.safeParse({ name: 'Jenkins 部署' }).success).toBe(true)
    expect(WebhookCreateArgs.safeParse({ name: '' }).success).toBe(false)
    expect(WebhookListArgs.safeParse({}).success).toBe(true)
    expect(WebhookUpdateArgs.safeParse({ id: 'w1', enabled: false, run_options: [] }).success).toBe(true)
    expect(WebhookUpdateArgs.safeParse({ id: 'w1', prompt: null }).success).toBe(true)
    expect(WebhookDeleteArgs.safeParse({ id: 'w1' }).success).toBe(true)
  })

  it('carries webhook marker on messages and group.webhooks realtime event', () => {
    const msg = MessageDto.safeParse({
      id: 'm1',
      seq: 1,
      groupId: 'g1',
      kind: 'user',
      authorId: 'u1',
      authorName: 'Jenkins 部署',
      body: '构建失败',
      mentions: [],
      runId: null,
      createdAt: '2026-11-19T00:00:00Z',
      attachments: [],
      quote: null,
      webhook: { id: 'w1', name: 'Jenkins 部署' },
    })
    expect(msg.success).toBe(true)
    const ev = WebEvent.safeParse({ t: 'group.webhooks', groupId: 'g1', webhooks: [] })
    expect(ev.success).toBe(true)
  })
})
