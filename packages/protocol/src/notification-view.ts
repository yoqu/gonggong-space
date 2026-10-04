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
    case 'lock':
      return {
        label: say('锁轮到你'),
        text: say('{bot} 在 {group} 拿到群锁', { bot, group }),
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
    case 'bot_confirm':
      return {
        label: say('待确认 Bot'),
        text: say('{by} 为你创建了 {bot}，请确认绑定', { by: p('byName'), bot }),
        group: '',
        href: '/admin/bots',
      }
  }
}
