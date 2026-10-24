import type { GitCommit, GitDiffDto, GitHeadCommit, GitShowDto } from '@gonggong/protocol'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { toastError } from '../../../lib/errors'
import { type MenuItem, toast } from '../../../ui'
import { type GitTarget, gitBase, gitUrls } from '../api'
import type { CommitInfo, GitCommands } from '../commands'
import { parseRefs } from '../refs'
import { EMPTY_TREE } from '../StashView'
import { childOf } from './CommitTable'

export const commitInfo = (c: GitCommit): CommitInfo => ({
  hash: c.hash,
  shortHash: c.shortHash,
  subject: c.subject,
})

export const isHead = (c: GitCommit, remotes: readonly string[]) =>
  parseRefs(c.refs, remotes).some((r) => r.kind === 'head')

/**
 * IDEA's commit context menu for the commits picked (list order, newest first): what works on several stays on, the
 * rest needs one; undo and reword only for HEAD.
 */
export function commitMenu(
  picked: GitCommit[],
  all: readonly GitCommit[],
  o: { remotes: readonly string[]; rootRepo: boolean },
): MenuItem[] {
  const [c] = picked
  const one = picked.length === 1 && !!c
  const head = one && isHead(c, o.remotes)
  return [
    { value: 'copy-hash', label: t('复制提交哈希'), icon: 'copy' },
    { value: 'copy-message', label: t('复制提交说明') },
    { value: 'patch', label: t('创建补丁'), icon: 'download', disabled: !one },
    { separator: true },
    { value: 'cherry-pick', label: t('优选'), icon: 'cherry' },
    { value: 'revert', label: t('还原提交') },
    { separator: true },
    { value: 'checkout', label: t('检出此修订'), icon: 'check', disabled: !one },
    { value: 'browse', label: t('显示此修订的仓库'), icon: 'folder', disabled: !one || !o.rootRepo },
    { value: 'compare', label: t('与本地比较'), icon: 'git-compare', disabled: !one },
    { separator: true },
    { value: 'reset', label: t('将当前分支重置到此处…'), disabled: !one },
    ...(head
      ? ([
          { value: 'undo', label: t('撤销提交…'), icon: 'undo' },
          { value: 'reword', label: t('编辑提交说明…') },
        ] as MenuItem[])
      : []),
    { separator: true },
    { value: 'branch', label: t('新建分支…'), icon: 'git-branch', disabled: !one },
    { value: 'tag', label: t('新建标签…'), icon: 'tag', disabled: !one },
    { separator: true },
    { value: 'parent', label: t('转到父提交'), icon: 'arrow-down', disabled: !one || !c.parents.length },
    { value: 'child', label: t('转到子提交'), icon: 'arrow-up', disabled: !one || !childOf(all, c.hash) },
  ]
}

interface Context {
  target: GitTarget
  cmd: GitCommands
  remotes: readonly string[]
  /** Every commit listed, newest first. */
  all: readonly GitCommit[]
  /** git/show of the commit shown in the details, when loaded. */
  shown: GitShowDto | null
  select: (hash: string) => void
}

/** The commit's whole message, committer and branches; null from daemons without git/show. */
async function showOf(c: GitCommit, ctx: Context) {
  if (ctx.shown?.commit.hash === c.hash) return ctx.shown
  const base = gitBase(ctx.target.groupId, ctx.target.botId)
  return api.get<GitShowDto>(gitUrls.show(base, c.hash, ctx.target.repo)).catch(() => null)
}

async function headOf(c: GitCommit, ctx: Context): Promise<GitHeadCommit> {
  const d = await showOf(c, ctx)
  return {
    hash: c.hash,
    shortHash: c.shortHash,
    message: d?.body.trim() || c.subject,
    pushed: !!d?.branches.some((b) => ctx.remotes.some((r) => b.startsWith(`${r}/`))),
  }
}

/** Downloads the commit's changes against its first parent as `<short hash>.patch`. */
async function createPatch(c: GitCommit, ctx: Context) {
  const base = gitBase(ctx.target.groupId, ctx.target.botId)
  try {
    const d = await api.get<GitDiffDto>(
      gitUrls.diff(base, c.parents[0] ?? EMPTY_TREE, c.hash, null, ctx.target.repo),
    )
    if (d.truncated) return void toast({ type: 'error', message: t('改动过大，无法创建补丁') })
    const url = URL.createObjectURL(new Blob([d.patch ?? ''], { type: 'text/x-diff' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.shortHash}.patch`
    document.body.append(a)
    a.click()
    a.remove()
    // Revoked at once, some browsers drop the download before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    toastError(e)
  }
}

export async function runCommitAction(value: string, picked: GitCommit[], ctx: Context) {
  const { cmd } = ctx
  const [c] = picked
  if (!c) return
  // Oldest first, as they were made (the daemon reverts the newest first, so each one applies cleanly).
  const oldest = [...picked].reverse().map(commitInfo)
  switch (value) {
    case 'copy-hash':
      return cmd.copy(picked.map((x) => x.hash).join(' '))
    case 'copy-message':
      return cmd.copy(
        picked.length === 1
          ? (await showOf(c, ctx))?.body.trim() || c.subject
          : picked.map((x) => x.subject).join('\n'),
      )
    case 'patch':
      return createPatch(c, ctx)
    case 'cherry-pick':
      return cmd.cherryPick(oldest)
    case 'revert':
      return cmd.revert(oldest)
    case 'checkout':
      return cmd.checkout(c.hash, true)
    case 'browse':
      return cmd.browse(c.hash)
    case 'compare':
      return cmd.compare(c.hash, null)
    case 'reset':
      return cmd.reset(commitInfo(c))
    case 'undo':
      return cmd.undoCommit(await headOf(c, ctx))
    case 'reword':
      return cmd.reword(await headOf(c, ctx))
    case 'branch':
      return cmd.newBranch(c.hash)
    case 'tag':
      return cmd.newTag(commitInfo(c))
    case 'parent':
      return c.parents[0] && ctx.select(c.parents[0])
    case 'child': {
      const child = childOf(ctx.all, c.hash)
      return child && ctx.select(child.hash)
    }
  }
}
