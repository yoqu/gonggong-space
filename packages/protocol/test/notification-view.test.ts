import { describe, expect, it } from 'vitest'
import {
  createTranslator,
  type NotificationDto,
  PUSHED_NOTIFICATION_TYPES,
  protocolEn,
  notificationView as view,
} from '../src/index.js'

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
  it('links a mention to the message', () => {
    expect(
      notificationView(
        n('mention', { groupId: 'g1', groupName: '支付', messageId: 'm1', byName: '王磊', text: '看下这个' }),
      ),
    ).toEqual({ label: '有人@我', text: '王磊：看下这个', group: '支付', href: '/g/g1?msg=m1' })
  })

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
    expect(notificationView(n('bot_confirm', { botName: 'B', byName: '陈晨' }))).toEqual({
      label: '待确认 Bot',
      text: '陈晨 为你创建了 B，请确认绑定',
      group: '',
      href: '/admin/bots',
    })
    expect(notificationView(n('bot_shared', { botId: 'b1', botName: 'B', byName: '王磊' }))).toEqual({
      label: '共享 Bot',
      text: '王磊 将 B 共享给你，可以和它私聊',
      group: '',
      href: '/bot/b1',
    })
    expect(
      notificationView(n('sync_drift', { groupId: 'g1', groupName: '支付', botName: 'C', files: 3 })),
    ).toEqual({
      label: '本地有改动',
      text: 'C 的工作区有 3 个文件被本地修改，强制同步已暂停，请提交或丢弃',
      group: '支付',
      href: '/g/g1',
    })
    expect(
      notificationView(n('sync_drift', { groupId: 'g1', botId: 'b1', botName: 'C', files: 1 })).href,
    ).toBe('/g/g1?sync=b1')
    expect(
      notificationView(n('sync_conflict', { groupId: 'g1', botName: 'C', version: 15, files: 2 })),
    ).toMatchObject({ label: '同步冲突', text: '@C 的改动与 v15 冲突：2 个文件', href: '/g/g1' })
    expect(notificationView(n('sync_conflict', { groupId: 'g1', conflictId: 'c1', botName: 'C' })).href).toBe(
      '/g/g1?conflict=c1',
    )
  })
  it('says what happened to a market listing, with the reason, and opens it', () => {
    expect(
      notificationView(
        n('listing_submitted', {
          listingId: 'l1',
          versionId: 'v1',
          listingName: '幻灯片',
          revision: 2,
          byName: '安',
        }),
      ),
    ).toEqual({
      label: '待审核',
      text: '安 提交了 幻灯片 r2，等你审核',
      group: '',
      href: '/market?tab=reviews',
    })
    expect(
      notificationView({
        ...n('listing_submitted', { listingName: 'x', revision: 1, byName: '安' }),
        resolvedAt: 'x',
      }).label,
    ).toBe('审核请求')
    expect(
      notificationView(
        n('listing_reviewed', {
          listingId: 'l1',
          listingName: '幻灯片',
          revision: 2,
          approved: false,
          note: '缺说明',
        }),
      ),
    ).toEqual({
      label: '审核结果',
      text: '幻灯片 r2 被驳回：缺说明',
      group: '',
      href: '/market?tab=mine&listing=l1',
    })
    expect(
      notificationView(
        n('listing_reviewed', {
          listingId: 'l1',
          listingName: '幻灯片',
          revision: 2,
          approved: true,
          note: '',
        }),
      ).text,
    ).toBe('幻灯片 r2 审核通过')
    expect(
      notificationView(
        n('listing_banned', { listingId: 'l1', listingName: 'wiki', banned: true, reason: '恶意' }),
      ),
    ).toEqual({
      label: '封禁通知',
      text: 'wiki 已被封禁：恶意',
      group: '',
      href: '/market?tab=mine&listing=l1',
    })
    expect(
      notificationView(
        n('listing_banned', { listingId: 'l1', listingName: 'wiki', banned: false, reason: '' }),
      ).text,
    ).toBe('wiki 已解除封禁')
    expect(
      notificationView(
        n('install_request_decided', {
          listingName: 'wiki',
          targetLabel: 'A 群',
          approved: false,
          note: '已有同名',
        }),
      ).text,
    ).toBe('引入 wiki 到 A 群 的申请被拒绝：已有同名')
  })

  it('tells installers about upgrades and bans, linking to the listing', () => {
    expect(
      notificationView(
        n('listing_upgraded', {
          listingId: 'l1',
          listingName: 'wiki',
          revision: 3,
          changelog: '修复链接',
          targets: ['A 群', ''],
        }),
      ),
    ).toEqual({
      label: '版本更新',
      text: 'A 群、我的 Skill 引入的 wiki 已自动升级到 r3：修复链接',
      group: '',
      href: '/market?listing=l1',
    })
    expect(
      notificationView(
        n('listing_banned', {
          listingId: 'l1',
          listingName: 'wiki',
          banned: true,
          reason: '恶意',
          targets: ['A 群'],
        }),
      ),
    ).toEqual({
      label: '封禁通知',
      text: 'A 群 引入的 wiki 已被封禁，下一轮起停止加载，建议移除：恶意',
      group: '',
      href: '/market?listing=l1',
    })
    expect(
      notificationView(
        n('listing_banned', {
          listingId: 'l1',
          listingName: 'wiki',
          banned: false,
          reason: '',
          targets: [''],
        }),
      ).text,
    ).toBe('我的 Skill 引入的 wiki 已解除封禁，恢复加载')
  })

  it('says a cancelled install request was withdrawn', () => {
    const asked = n('install_request', {
      requestId: 'q1',
      requesterName: '米娅',
      listingName: 'wiki',
      targetLabel: 'A 群',
      cancelled: true,
    })
    expect(notificationView({ ...asked, resolvedAt: '2026-09-23T11:00:00Z' })).toMatchObject({
      label: '引入申请已撤回',
      text: '米娅 撤回了把 wiki 引入到 A 群 的申请',
    })
  })

  it('pushes the market notices people act on', () => {
    for (const type of [
      'install_request',
      'install_request_decided',
      'listing_submitted',
      'listing_reviewed',
      'listing_banned',
    ] as const)
      expect(PUSHED_NOTIFICATION_TYPES).toContain(type)
    expect(PUSHED_NOTIFICATION_TYPES).not.toContain('listing_upgraded')
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
