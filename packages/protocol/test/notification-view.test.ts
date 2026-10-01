import { describe, expect, it } from 'vitest'
import { createTranslator, type NotificationDto, protocolEn, notificationView as view } from '../src/index.js'

const zh = createTranslator('zh', protocolEn).text
const notificationView = (n: NotificationDto) => view(n, zh)

const n = (type: NotificationDto['type'], payload: Record<string, unknown>): NotificationDto => ({
  id: 'n1',
  teamId: null,
  type,
  payload,
  readAt: null,
  resolvedAt: null,
  createdAt: '2026-09-23T10:00:00Z',
})

describe('notificationView', () => {
  it('describes each type with the prototype labels and a link to act on it', () => {
    expect(
      notificationView(
        n('approval', {
          groupId: 'g1',
          groupName: '支付',
          runId: 'r1',
          botName: '小王的 Claude',
          title: 'go build',
        }),
      ),
    ).toEqual({
      label: '待审批',
      text: '小王的 Claude 请求执行 go build',
      group: '支付',
      href: '/g/g1?run=r1',
    })
    expect(
      notificationView(
        n('question', { groupId: 'g1', groupName: '支付', runId: 'r1', botName: 'Codex', count: 4 }),
      ),
    ).toMatchObject({ label: '待回答', text: 'Codex 向你提了 4 个问题', href: '/g/g1?run=r1' })
    const done = (type: 'approval' | 'question') => ({ ...n(type, {}), resolvedAt: '2026-09-24T00:00:00Z' })
    expect(notificationView(done('approval')).label).toBe('审批请求')
    expect(notificationView(done('question')).label).toBe('提问')
    expect(
      notificationView(
        n('offline_expired', { groupId: 'g1', groupName: '支付', runId: 'r2', botName: 'C', waitMin: 30 }),
      ),
    ).toMatchObject({ label: 'Bot 离线作废', text: '你 @C 的请求等待 30 分钟未上线，已作废' })
    expect(
      notificationView(
        n('chain_done', { groupId: 'g1', groupName: '支付', rootRunId: 'r0', hops: 3, stopped: false }),
      ),
    ).toMatchObject({ label: '接力链结束', text: '3 跳完成', href: '/g/g1?run=r0' })
    expect(notificationView(n('chain_done', { groupId: 'g1', hops: 2, stopped: true })).text).toBe(
      '2 跳 · 已被 /stop 中断',
    )
    expect(notificationView(n('lock', { groupId: 'g2', groupName: '官网', botName: 'C' }))).toMatchObject({
      label: '锁轮到你',
      href: '/g/g2',
    })
    expect(notificationView(n('bot_confirm', { botName: 'B', byName: '陈晨' }))).toEqual({
      label: '待确认 Bot',
      text: '陈晨 为你创建了 B，请确认绑定',
      group: '',
      href: '/admin/bots',
    })
  })
  it("renders in the reader's language, nested reasons included", () => {
    const en = createTranslator('en', protocolEn).text
    expect(
      view(n('question', { groupId: 'g1', groupName: 'Pay', runId: 'r1', botName: 'Codex', count: 1 }), en),
    ).toMatchObject({ label: 'Awaiting answer', text: 'Codex asked you 1 question' })
    expect(
      view(n('repo_access', { groupId: 'g1', botName: 'C', repo: 'org/app', reason: '连接超时' }), en).text,
    ).toBe(
      'C\'s machine cannot reach org/app (connection timed out); fix it, then click "Recheck" in the group',
    )
  })
})
