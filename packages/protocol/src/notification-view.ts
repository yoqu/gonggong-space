import type { NotificationDto } from './web.js'

export interface NotificationView {
  label: string
  text: string
  group: string
  /** In-app route that lets the recipient act on it. */
  href: string
}

/** Human text of a notification, shared by the in-app center and the browser push. */
export function notificationView(n: NotificationDto): NotificationView {
  const p = (k: string) => String(n.payload[k] ?? '')
  const group = p('groupName')
  const at = (runKey: string) => (p(runKey) ? `/g/${p('groupId')}?run=${p(runKey)}` : `/g/${p('groupId')}`)
  switch (n.type) {
    case 'approval':
      return { label: '待审批', text: `${p('botName')} 请求执行 ${p('title')}`, group, href: at('runId') }
    case 'question':
      return {
        label: '待回答',
        text: `${p('botName')} 向你提了 ${p('count')} 个问题`,
        group,
        href: at('runId'),
      }
    case 'lock':
      return { label: '锁轮到你', text: `${p('botName')} 在 ${group} 拿到群锁`, group, href: at('runId') }
    case 'offline_expired':
      return {
        label: 'bot 离线作废',
        text: `你 @${p('botName')} 的请求等待 ${p('waitMin')} 分钟未上线，已作废`,
        group,
        href: at('runId'),
      }
    case 'chain_done':
      return {
        label: '接力链结束',
        text: `${p('hops')} 跳${n.payload.stopped ? ' · 已被 /stop 中断' : '完成'}`,
        group,
        href: at('rootRunId'),
      }
    case 'bot_confirm':
      return {
        label: '待确认 bot',
        text: `${p('byName')} 为你创建了 ${p('botName')}，请确认绑定`,
        group: '',
        href: '/admin/bots',
      }
  }
}
