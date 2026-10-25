import type { BotDto, GitActionKind, GitOperationDto } from '@gonggong/protocol'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { type ToastAction, toast } from '../../ui'
import { type GitTarget, runGitAction, shortRev } from './api'
import { type GitDialog, gitCommands, inTarget, ownsBot, useGitDialogs } from './commands'

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
  apply: t('应用所选改动'),
  restore: t('从修订获取'),
}

/** The POST answer and the realtime event both report the end of an operation: toast it once. */
const told = new Set<string>()

/**
 * Success notices a caller words itself (runGitAction's `succeeded`), by bot and action until the operation settles:
 * the realtime event usually beats the POST answer, the only one that knows the operation's id.
 */
const worded = new Map<string, () => void>()
const wordedKey = (groupId: string, botId: string, action: GitActionKind) => `${groupId}:${botId}:${action}`
/** Words the next settling of `action` on the bot with `succeeded`; none forgets an earlier one. */
export function wordSettled(groupId: string, botId: string, action: GitActionKind, succeeded?: () => void) {
  const key = wordedKey(groupId, botId, action)
  if (succeeded) worded.set(key, succeeded)
  else worded.delete(key)
}

/**
 * The remote branches local ones being deleted track, as the delete dialog saw them: by the time the deletion is told
 * the branch is gone with its config, and IDEA offers to delete the tracked one too.
 */
const tracked = new Map<string, string>()
const branchKey = (at: GitTarget, branch: string) => JSON.stringify([at.groupId, at.botId, at.repo, branch])
export function trackDeleted(at: GitTarget, branch: string, upstream: string | null) {
  if (upstream) tracked.set(branchKey(at, branch), upstream)
  else tracked.delete(branchKey(at, branch))
}

const targetOf = (op: GitOperationDto): GitTarget => ({ groupId: op.groupId, botId: op.botId, repo: op.repo })
/** git's error as a toast says it: its first line. */
const firstLine = (text: string | null) =>
  text
    ?.split('\n')
    .find((l) => l.trim())
    ?.trim() ?? ''

/**
 * Tells the requester how their operation ended, as IDEA's notifications word it; `succeeded` says it its own way when
 * it worked. A checkout git refused for changes in the way or diverged commits asks what to do instead: the owner at
 * once, anyone else from the failure toast (to request it).
 */
export function gitOperationSettled(
  op: GitOperationDto,
  bots: Pick<BotDto, 'id' | 'name'>[],
  succeeded?: () => void,
) {
  if (op.requestedBy.id !== useSession.getState().user?.id || told.has(op.id)) return
  const key = wordedKey(op.groupId, op.botId, op.action)
  const own = succeeded ?? worded.get(key)
  if (op.status === 'succeeded' || op.status === 'failed' || op.status === 'rejected') worded.delete(key)
  const bot = bots.find((b) => b.id === op.botId)?.name ?? 'Bot'
  const action = ACTION_LABEL[op.action]
  if (op.status === 'succeeded' && own) own()
  else if (op.status === 'succeeded')
    toast(doneNotice(op) ?? { type: 'success', message: t('{bot}：{action}完成', { bot, action }) })
  else if (op.status === 'failed') {
    const retry = retryOf(op)
    const ask = () => retry && useGitDialogs.getState().show(targetOf(op), retry.dialog)
    if (retry && ownsBot(op.botId)) ask()
    else
      toast({
        type: 'error',
        title: t('{bot}：{action}失败', { bot, action }),
        message: firstLine(op.error),
        action: retry ? { label: retry.label, onClick: ask } : undefined,
      })
  } else if (op.status === 'rejected')
    toast({ type: 'warning', message: t('{bot} 的主人拒绝了{action}申请', { bot, action }) })
  else return
  told.add(op.id)
}

/** The question a checkout git refused asks instead, and the way to it from the failure toast. */
function retryOf(op: GitOperationDto): { dialog: GitDialog; label: string } | null {
  if (op.action !== 'checkout') return null
  if (op.detail?.code === 'overwritten')
    return { dialog: { kind: 'checkout-problem', op }, label: t('智能检出…') }
  if (op.detail?.code === 'diverged') return { dialog: { kind: 'diverged', op }, label: t('处理分叉…') }
  return null
}

type Notice = Parameters<typeof toast>[0]

/** What `op` did, as IDEA says it; null for the actions without a notice of their own. */
function doneNotice(op: GitOperationDto): Notice | null {
  const cmd = gitCommands(targetOf(op))
  const branch = shortRev(op.branch ?? '')
  const args = op.args ?? {}
  const detail = op.detail
  const ok = (message: string, action?: Notice['action']): Notice => ({ type: 'success', message, action })
  const conflicts = (message: string): Notice => {
    const first = detail?.paths[0]
    return {
      type: 'warning',
      message,
      action: first ? { label: t('解决冲突'), onClick: () => cmd.openMerge(first) } : undefined,
    }
  }
  const n = detail?.paths.length ?? 0
  switch (op.action) {
    case 'checkout':
      return detail?.code === 'conflicts'
        ? conflicts(t('已检出 {branch}，恢复本地改动时 {n} 个文件有冲突', { branch, n }))
        : ok(t('已检出 {branch}', { branch }))
    case 'pull': {
      if (detail?.code === 'conflicts') return conflicts(t('已更新，恢复本地改动时 {n} 个文件有冲突', { n }))
      const u = detail?.updated
      if (!u) return null
      return u.commits
        ? ok(t('已更新 {files} 个文件（{commits} 个提交）', { files: u.files, commits: u.commits }), {
            label: t('查看提交'),
            onClick: () => cmd.openLog({ ref: `${u.from}..${u.to}` }),
          })
        : ok(t('已是最新'))
    }
    case 'push':
      return ok(t('已推送到 {remote}/{branch}', { remote: op.remote ?? '', branch: args.target ?? branch }))
    case 'branch-create':
      return ok(t('已创建分支 {name}', { name: branch }))
    case 'branch-rename':
      return ok(t('已将分支 {branch} 重命名为 {name}', { branch, name: args.name ?? '' }))
    case 'branch-delete':
      return ok(t('已删除分支 {branch}', { branch }), deletedActions(op))
    case 'merge':
      return ok(t('已合并 {branch}', { branch }))
    case 'rebase':
      return ok(t('已变基到 {onto}', { onto: shortRev(args.onto ?? '') }))
    case 'cherry-pick':
      return ok(t('已优选 {n} 个提交', { n: args.commits?.length ?? 0 }))
    case 'revert':
      return ok(t('已还原 {n} 个提交', { n: args.commits?.length ?? 0 }))
    case 'tag-create':
      return ok(t('已创建标签 {name}', { name: args.name ?? '' }))
    case 'tag-delete':
      return ok(t('已删除标签 {name}', { name: args.name ?? '' }))
    case 'tag-push':
      return ok(t('已推送标签 {name} 到 {remote}', { name: args.name ?? '', remote: op.remote ?? '' }))
    default:
      return null
  }
}

/** IDEA's Restore (the branch again where git says it `was`) and Delete Tracked Branch. */
function deletedActions(op: GitOperationDto): ToastAction[] {
  const at = targetOf(op)
  const branch = op.branch ?? ''
  const was = /\(was ([0-9a-f]+)\)/.exec(op.output ?? '')?.[1]
  const upstream = tracked.get(branchKey(at, branch))
  return [
    ...(was
      ? [
          {
            label: t('恢复#restore'),
            onClick: () =>
              void runGitAction(
                op.groupId,
                op.botId,
                inTarget(at, { action: 'branch-create', name: branch, from: was, checkout: false }),
              ),
          },
        ]
      : []),
    ...(upstream
      ? [{ label: t('删除跟踪分支'), onClick: () => gitCommands(at).deleteBranch(upstream) }]
      : []),
  ]
}
