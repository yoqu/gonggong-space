import type { BotDto, GitActionKind, GitOperationDto } from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { toast } from '../../ui'

export const ACTION_LABEL: Record<GitActionKind, string> = {
  checkout: t('切换分支'),
  pull: t('拉取'),
  commit: t('提交'),
  push: t('推送'),
  'branch-create': t('新建分支'),
  'branch-rename': t('重命名分支'),
  'branch-delete': t('删除分支'),
  merge: t('合并'),
  rebase: t('变基'),
  'cherry-pick': t('优选'),
  revert: t('还原提交'),
  reset: t('重置'),
  discard: t('回滚'),
  stash: t('贮藏'),
  unstash: t('恢复贮藏'),
  'stash-drop': t('删除贮藏'),
  'tag-create': t('新建标签'),
  'tag-delete': t('删除标签'),
  'tag-push': t('推送标签'),
  continue: t('继续'),
  abort: t('中止'),
  skip: t('跳过'),
  resolve: t('解决冲突'),
  add: t('加入版本控制'),
  ignore: t('加入 .gitignore'),
}

/** The POST answer and the realtime event both report the end of an operation: toast it once. */
const told = new Set<string>()

/** Tells the requester how their operation ended; `succeeded` says it its own way when it worked. */
export function gitOperationSettled(
  op: GitOperationDto,
  bots: Pick<BotDto, 'id' | 'name'>[],
  succeeded?: () => void,
) {
  if (op.requestedBy.id !== useSession.getState().user?.id || told.has(op.id)) return
  const bot = bots.find((b) => b.id === op.botId)?.name ?? 'Bot'
  const action = ACTION_LABEL[op.action]
  if (op.status === 'succeeded' && succeeded) succeeded()
  else if (op.status === 'succeeded')
    toast({ type: 'success', message: t('{bot}：{action}完成', { bot, action }) })
  else if (op.status === 'failed')
    toast({ type: 'error', title: t('{bot}：{action}失败', { bot, action }), message: op.error ?? '' })
  else if (op.status === 'rejected')
    toast({ type: 'warning', message: t('{bot} 的主人拒绝了{action}申请', { bot, action }) })
  else return
  told.add(op.id)
}
