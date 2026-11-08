import type { I18nText } from './i18n.js'
import type { ProtocolKey } from './i18n-en.js'
import type { NotificationDto } from './web.js'

export interface NotificationView {
  label: string
  text: string
  group: string
  /** In-app route that lets the recipient act on it. */
  href: string
}

/** Human text of a notification, shared by the in-app center and the browser push; `tr` renders it in the reader's language. */
export function notificationView(n: NotificationDto, tr: (t: I18nText) => string): NotificationView {
  const p = (k: string) => String(n.payload[k] ?? '')
  const say = (key: ProtocolKey, params?: I18nText['params']) => tr({ key, params })
  const group = p('groupName')
  const at = (runKey: string) => (p(runKey) ? `/g/${p('groupId')}?run=${p(runKey)}` : `/g/${p('groupId')}`)
  const bot = p('botName')
  /** A decision with the reviewer's words after it. */
  const because = (text: string, reason: string) =>
    reason ? say('{text}：{reason}', { text, reason }) : text
  const mine = `/market?tab=mine&listing=${p('listingId')}`
  /** Where an installer has the listing: group, team or 「团队 / 仓库」 labels, '' for their personal layer. */
  const targets = Array.isArray(n.payload.targets)
    ? (n.payload.targets as string[]).map((l) => l || say('我的 Skill')).join(say('、'))
    : ''
  const listing = `/market?listing=${p('listingId')}`
  switch (n.type) {
    case 'approval':
      return {
        label: say(n.resolvedAt ? '审批请求' : '待审批'),
        text: say('{bot} 请求执行 {title}', { bot, title: p('title') }),
        group,
        href: at('runId'),
      }
    case 'question':
      return {
        label: say(n.resolvedAt ? '提问' : '待回答'),
        text: say('{bot} 向你提了 {n} 个问题', { bot, n: p('count') }),
        group,
        href: at('runId'),
      }
    case 'offline_expired':
      return {
        label: say('Bot 离线作废'),
        text: say('你 @{bot} 的请求等待 {n} 分钟未上线，已作废', { bot, n: p('waitMin') }),
        group,
        href: at('runId'),
      }
    case 'chain_done':
      return {
        label: say('接力链结束'),
        text: say(n.payload.stopped ? '{n} 跳 · 已被 /stop 中断' : '{n} 跳完成', { n: p('hops') }),
        group,
        href: at('rootRunId'),
      }
    case 'repo_access':
      return {
        label: say('Bot 无法访问仓库'),
        text: say('{bot} 所在机器无法访问 {repo}（{reason}），配置后在群里点「重新检查」', {
          bot,
          repo: p('repo'),
          reason: { key: p('reason') },
        }),
        group,
        href: at(''),
      }
    case 'schedule_paused':
      return {
        label: say('定时任务已停用'),
        text: say('定时任务「{name}」已停用：{reason}', {
          name: p('name'),
          reason: (n.payload.reason as I18nText | undefined) ?? '',
        }),
        group,
        href: at(''),
      }
    case 'sync_drift':
      return {
        label: say('本地有改动'),
        text: say('{bot} 的工作区有 {n} 个文件被本地修改，强制同步已暂停，请提交或丢弃', {
          bot,
          n: p('files'),
        }),
        group,
        href: p('botId') ? `/g/${p('groupId')}?sync=${p('botId')}` : at(''),
      }
    case 'sync_conflict':
      return {
        label: say('同步冲突'),
        text: say('@{bot} 的改动与 v{version} 冲突：{n} 个文件', {
          bot,
          version: p('version'),
          n: p('files'),
        }),
        group,
        href: p('conflictId') ? `/g/${p('groupId')}?conflict=${p('conflictId')}` : at(''),
      }
    case 'mention':
      return {
        label: say('有人@我'),
        text: `${p('byName')}：${p('text')}`,
        group,
        // An @ in a thread opens that thread.
        href: p('threadRootId')
          ? `/g/${p('groupId')}?thread=${p('threadRootId')}`
          : `/g/${p('groupId')}?msg=${p('messageId')}`,
      }
    case 'bot_share_request':
      return {
        label: say(n.resolvedAt ? '共享申请' : '待处理共享申请'),
        text: p('reason')
          ? say('{by} 申请使用 {bot}：{reason}', { by: p('byName'), bot, reason: p('reason') })
          : say('{by} 申请使用 {bot}', { by: p('byName'), bot }),
        group: '',
        href: `/bot/${p('botId')}`,
      }
    case 'join_request':
      return {
        label: say(n.resolvedAt ? '入群申请' : '待处理入群申请'),
        text: p('note')
          ? say('{by} 申请加入群：{reason}', { by: p('byName'), reason: p('note') })
          : say('{by} 申请加入群', { by: p('byName') }),
        group,
        href: at(''),
      }
    case 'join_decided':
      return n.payload.approved
        ? {
            label: say('入群申请已通过'),
            text: say('{by} 同意你加入群', { by: p('byName') }),
            group,
            href: at(''),
          }
        : {
            label: say('入群申请被拒绝'),
            text: say('{by} 拒绝了你的入群申请', { by: p('byName') }),
            group,
            href: at(''),
          }
    case 'git_operation_request':
      return {
        label: say(n.resolvedAt ? 'Git 操作申请' : '待审批 Git 操作'),
        text: say('{by} 申请让 {bot} {action}', { by: p('byName'), bot, action: p('summary') }),
        group,
        href: `/g/${p('groupId')}?git=${p('operationId')}`,
      }
    case 'bot_share_decided':
      return n.payload.approved
        ? {
            label: say('共享申请已通过'),
            text: say('{by} 同意共享 {bot}，已为你打开私聊', { by: p('byName'), bot }),
            group: '',
            href: `/g/${p('groupId')}`,
          }
        : {
            label: say('共享申请被拒绝'),
            text: say('{by} 拒绝共享 {bot}', { by: p('byName'), bot }),
            group: '',
            href: `/bot/${p('botId')}`,
          }
    case 'bot_confirm':
      return {
        label: say('待确认 Bot'),
        text: say('{by} 为你创建了 {bot}，请确认绑定', { by: p('byName'), bot }),
        group: '',
        href: '/admin/bots',
      }
    case 'bot_shared':
      return {
        label: say('共享 Bot'),
        text: say('{by} 将 {bot} 共享给你，可以和它私聊', { by: p('byName'), bot }),
        group: '',
        href: `/bot/${p('botId')}`,
      }
    case 'install_request': {
      const params = { by: p('requesterName'), listing: p('listingName'), target: p('targetLabel') }
      return {
        label: say(n.payload.cancelled ? '引入申请已撤回' : n.resolvedAt ? '引入申请' : '待处理的引入申请'),
        text: n.payload.cancelled
          ? say('{by} 撤回了把 {listing} 引入到 {target} 的申请', params)
          : say('{by} 申请把 {listing} 引入到 {target}', params),
        group: '',
        href: '/market?tab=requests',
      }
    }
    case 'install_request_decided':
      return {
        label: say('引入申请结果'),
        text: because(
          say(
            n.payload.approved ? '{listing} 已引入到 {target}' : '引入 {listing} 到 {target} 的申请被拒绝',
            { listing: p('listingName'), target: p('targetLabel') },
          ),
          n.payload.approved ? '' : p('note'),
        ),
        group: '',
        href: '/market?tab=requests',
      }
    case 'listing_reviewed':
      return {
        label: say('审核结果'),
        text: because(
          say(n.payload.approved ? '{listing} r{revision} 审核通过' : '{listing} r{revision} 被驳回', {
            listing: p('listingName'),
            revision: p('revision'),
          }),
          n.payload.approved ? '' : p('note'),
        ),
        group: '',
        href: mine,
      }
    case 'listing_submitted':
      return {
        label: say(n.resolvedAt ? '审核请求' : '待审核'),
        text: say('{by} 提交了 {listing} r{revision}，等你审核', {
          by: p('byName'),
          listing: p('listingName'),
          revision: p('revision'),
        }),
        group: '',
        href: '/market?tab=reviews',
      }
    case 'listing_banned': {
      const params = { listing: p('listingName'), targets }
      // With `targets` it went to an installer, else to a maintainer.
      return {
        label: say('封禁通知'),
        text: n.payload.banned
          ? because(
              targets
                ? say('{targets} 引入的 {listing} 已被封禁，下一轮起停止加载，建议移除', params)
                : say('{listing} 已被封禁', params),
              p('reason'),
            )
          : targets
            ? say('{targets} 引入的 {listing} 已解除封禁，恢复加载', params)
            : say('{listing} 已解除封禁', params),
        group: '',
        href: targets ? listing : mine,
      }
    }
    case 'listing_upgraded':
      return {
        label: say('版本更新'),
        text: because(
          say('{targets} 引入的 {listing} 已自动升级到 r{revision}', {
            targets,
            listing: p('listingName'),
            revision: p('revision'),
          }),
          p('changelog'),
        ),
        group: '',
        href: listing,
      }
  }
}
