import { describe, expect, it } from 'vitest'
import { type NotificationDto, notificationView } from '../src/index.js'

const n = (type: NotificationDto['type'], payload: Record<string, unknown>): NotificationDto => ({
  id: 'n1',
  type,
  payload,
  readAt: null,
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
    expect(
      notificationView(
        n('offline_expired', { groupId: 'g1', groupName: '支付', runId: 'r2', botName: 'C', waitMin: 30 }),
      ),
    ).toMatchObject({ label: 'bot 离线作废', text: '你 @C 的请求等待 30 分钟未上线，已作废' })
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
      label: '待确认 bot',
      text: '陈晨 为你创建了 B，请确认绑定',
      group: '',
      href: '/admin/bots',
    })
  })
})
