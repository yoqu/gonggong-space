import type { GitBranch, GitTag } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { IconName, MenuItem } from '../../ui'
import type { GitCommands } from './commands'

/** A branch or tag picked in the branch popup or the log's branches pane. */
export type PickedRef =
  | { kind: 'local'; name: string; branch: GitBranch }
  | { kind: 'remote'; name: string; branch: GitBranch }
  | { kind: 'tag'; name: string; tag: GitTag }

export type RefAction =
  | { value: string; label: string; icon?: IconName; destructive?: boolean; run: () => void }
  | { separator: true }

const SEP: RefAction = { separator: true }

/** Where the actions run: the current branch (null = detached), the remote tags go to, the repo's branches. */
export interface RefContext {
  current: string | null
  remote: string | null
  branches: readonly GitBranch[]
}

/**
 * IDEA's per-branch actions (VCS widget and Branches pane) for `ref`. Merging, rebasing and pulling into the current
 * branch run at once for the owner (commands decide); the current branch keeps New Branch, Update, Push and Rename.
 */
export function refActions(
  cmd: GitCommands,
  ref: PickedRef,
  { current, remote, branches }: RefContext,
): RefAction[] {
  const isCurrent = ref.kind === 'local' && ref.name === current
  const cur = current ?? 'HEAD'
  // A remote branch is checked out as the local branch tracking it.
  const local =
    ref.kind === 'local'
      ? ref.name
      : ref.kind === 'remote'
        ? branches.find((b) => b.kind === 'local' && b.upstream === ref.name)?.name
        : undefined
  const list: RefAction[] = []
  if (!isCurrent)
    list.push({
      value: 'checkout',
      label: t('检出'),
      icon: 'check',
      run: () => cmd.checkout(ref.name, ref.kind === 'tag'),
    })
  list.push({
    value: 'new-branch',
    label: t('从 {ref} 新建分支…', { ref: ref.name }),
    icon: 'git-branch',
    run: () => cmd.newBranch(ref.name),
  })
  if (local && current && local !== current)
    list.push({
      value: 'checkout-rebase',
      label: t('检出并变基到 {branch}', { branch: cur }),
      run: () => cmd.rebase(cur, local),
    })
  list.push(SEP)
  if (!isCurrent)
    list.push({
      value: 'compare',
      label: t('与 {branch} 比较', { branch: cur }),
      icon: 'git-compare',
      run: () => cmd.compare(cur, ref.name),
    })
  list.push({
    value: 'diff-work-tree',
    label: t('显示与工作区的差异'),
    icon: 'doc-text',
    run: () => cmd.compare(ref.name, null),
  })
  list.push({
    value: 'log',
    label: t('显示提交历史'),
    icon: 'clock',
    run: () => cmd.openLog({ ref: ref.name }),
  })
  if (!isCurrent && current) {
    list.push(SEP)
    list.push({
      value: 'rebase',
      label: t('将 {branch} 变基到 {ref}', { branch: cur, ref: ref.name }),
      run: () => cmd.rebaseCurrentOnto(ref.name),
    })
    list.push({
      value: 'merge',
      label: t('将 {ref} 合并到 {branch}', { ref: ref.name, branch: cur }),
      icon: 'git-merge',
      run: () => cmd.mergeIntoCurrent(ref.name),
    })
  }
  if (ref.kind === 'local') {
    list.push(SEP)
    // The current branch's Update is the Update Project dialog, which also says when there is no upstream.
    if (isCurrent || ref.branch.upstream)
      list.push({
        value: 'update',
        label: isCurrent ? t('更新…') : t('更新'),
        icon: 'arrow-down',
        run: () => (isCurrent ? cmd.pull() : cmd.updateBranch(ref.name)),
      })
    list.push({ value: 'push', label: t('推送…'), icon: 'arrow-up', run: () => cmd.push(ref.name) })
    list.push(SEP)
    list.push({ value: 'rename', label: t('重命名…'), run: () => cmd.renameBranch(ref.name) })
    if (!isCurrent)
      list.push({
        value: 'delete',
        label: t('删除…'),
        icon: 'trash',
        destructive: true,
        run: () => cmd.deleteBranch(ref.name),
      })
  } else if (ref.kind === 'remote') {
    if (current)
      list.push(
        SEP,
        {
          value: 'pull-merge',
          label: t('使用合并拉取到 {branch}', { branch: cur }),
          icon: 'arrow-down',
          run: () => cmd.pullFrom(ref.name, 'merge'),
        },
        {
          value: 'pull-rebase',
          label: t('使用变基拉取到 {branch}', { branch: cur }),
          run: () => cmd.pullFrom(ref.name, 'rebase'),
        },
      )
    list.push(SEP, {
      value: 'delete',
      label: t('在远程删除…'),
      icon: 'trash',
      destructive: true,
      run: () => cmd.deleteBranch(ref.name),
    })
  } else {
    list.push(SEP)
    if (remote)
      list.push({
        value: 'push-tag',
        label: t('推送到 {remote}', { remote }),
        icon: 'arrow-up',
        run: () => cmd.pushTag(ref.name, remote),
      })
    list.push({
      value: 'delete-tag',
      label: t('删除标签…'),
      icon: 'trash',
      destructive: true,
      run: () => cmd.deleteTag(ref.name),
    })
  }
  list.push(SEP, { value: 'copy', label: t('复制名称'), icon: 'copy', run: () => cmd.copy(ref.name) })
  return list
}

/** The actions as a ui Menu's items; select with `runAction`. */
export const actionItems = (actions: RefAction[]): MenuItem[] =>
  actions.map((a) =>
    'separator' in a ? a : { value: a.value, label: a.label, icon: a.icon, destructive: a.destructive },
  )

export function runAction(actions: RefAction[], value: string) {
  const a = actions.find((x) => !('separator' in x) && x.value === value)
  if (a && !('separator' in a)) a.run()
}
