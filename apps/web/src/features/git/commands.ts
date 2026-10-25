import type {
  GitActionInput,
  GitChangesDto,
  GitDiffDto,
  GitHeadCommit,
  GitOngoing,
  GitOperationDto,
  GitStash,
} from '@gonggong/protocol'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { type GitLogTabFilter, logScope, tabKey, useWorkbench, type WorkbenchTab } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'
import { openTab } from '../workbench/open'
import { type GitTarget, gitBase, gitUrls, repoStatus, runGitAction, shortRev } from './api'
import type { TreeChange } from './ChangeTree'

/** A commit as the dialogs name it. */
export interface CommitInfo {
  hash: string
  shortHash: string
  subject: string
}

/** A confirmation before an action: destructive ones (losing work) get a red button. */
export interface GitConfirm {
  title: string
  message: string
  consequences?: string[]
  label: string
  destructive?: boolean
  req: GitActionInput
}

export type GitDialog =
  | { kind: 'checkout'; ref: string; detach: boolean }
  /** A checkout git refused (`op` failed with detail overwritten, or diverged), asked again as chosen. */
  | { kind: 'checkout-problem'; op: GitOperationDto }
  | { kind: 'diverged'; op: GitOperationDto }
  | { kind: 'revision' }
  | { kind: 'branch-create'; from: string | null }
  | { kind: 'branch-rename'; branch: string }
  | { kind: 'branch-delete'; branch: string }
  | { kind: 'merge'; branch: string | null }
  | { kind: 'rebase'; onto: string | null; branch: string | null }
  | { kind: 'rebase-todo'; commit: CommitInfo; pushed: boolean }
  | { kind: 'pull' }
  /** IDEA's Pull…: a remote branch picked, the upstream's by default. */
  | { kind: 'pull-remote' }
  /** `upTo`: IDEA's Push All up to Here, only the branch's commits up to that one. */
  | { kind: 'push'; branch: string | null; upTo?: CommitInfo }
  | { kind: 'reset'; commit: CommitInfo }
  | { kind: 'reword'; head: GitHeadCommit }
  | { kind: 'continue'; ongoing: GitOngoing }
  | { kind: 'tag-create'; commit: CommitInfo | null }
  | { kind: 'tag-delete'; name: string }
  | { kind: 'stash'; paths: string[] | null }
  | { kind: 'unstash'; stash: GitStash }
  | { kind: 'rollback'; changes: TreeChange[] }
  | { kind: 'confirm'; confirm: GitConfirm }

interface DialogState {
  open: { target: GitTarget; dialog: GitDialog } | null
  show: (target: GitTarget, dialog: GitDialog) => void
  close: () => void
}

/** The one git dialog shown at a time (GitDialogHost renders it). */
export const useGitDialogs = create<DialogState>()((set) => ({
  open: null,
  show: (target, dialog) => set({ open: { target, dialog } }),
  close: () => set({ open: null }),
}))

/** Whether the signed-in user owns the bot: owners run actions, everyone else requests them. */
export function ownsBot(botId: string) {
  const me = useSession.getState().user?.id
  return !!me && useWorkspace.getState().bots.find((b) => b.id === botId)?.ownerId === me
}

/** The action as sent for `target`: its repo filled in. */
export const inTarget = (target: GitTarget, req: GitActionInput): GitActionInput =>
  target.repo ? { ...req, repo: target.repo } : req

const ONGOING: Record<GitOngoing['kind'], string> = {
  merge: t('合并'),
  rebase: t('变基'),
  'cherry-pick': t('优选'),
  revert: t('还原提交'),
}
export const ongoingLabel = (kind: GitOngoing['kind']) => ONGOING[kind]

/**
 * Every git command of a repo, IDEA's actions: most open their dialog, quick ones run at once; anything a non-owner
 * starts becomes a request to the bot's owner.
 */
export function gitCommands(target: GitTarget) {
  const show = (dialog: GitDialog) => useGitDialogs.getState().show(target, dialog)
  const confirm = (c: GitConfirm) => show({ kind: 'confirm', confirm: c })
  const run = (req: GitActionInput) => runGitAction(target.groupId, target.botId, inTarget(target, req))
  const status = () => {
    const git = useWorkspace.getState().botStates[target.groupId]?.[target.botId]?.git
    return git ? repoStatus(git, target.repo) : null
  }
  const current = () => status()?.branch ?? 'HEAD'
  const names = (commits: CommitInfo[]) => commits.map((c) => c.shortHash).join(', ')
  // The workbench names files from the workspace root, where a sub-repo is a folder.
  const inWorkspace = (path: string) => (target.repo ? `${target.repo}/${path}` : path)
  return {
    /**
     * As IDEA, the owner's branch checkout runs at once, changes or not: changes in the way ask then (see notify). A
     * detached one (what that means said first) or a request opens its dialog.
     */
    checkout(ref: string, detach = false) {
      if (ownsBot(target.botId) && !detach) return void run({ action: 'checkout', branch: ref })
      show({ kind: 'checkout', ref, detach })
    },
    checkoutRevision: () => show({ kind: 'revision' }),
    newBranch: (from: string | null = null) => show({ kind: 'branch-create', from }),
    renameBranch: (branch: string) => show({ kind: 'branch-rename', branch }),
    deleteBranch: (branch: string) => show({ kind: 'branch-delete', branch }),
    merge: (branch: string | null = null) => show({ kind: 'merge', branch }),
    rebase: (onto: string | null = null, branch: string | null = null) =>
      show({ kind: 'rebase', onto, branch }),
    /** IDEA's Interactively Rebase from Here: `commit` is the exclusive base of the plan. */
    rebaseInteractive: (commit: CommitInfo, pushed = false) => show({ kind: 'rebase-todo', commit, pushed }),
    pull: () => show({ kind: 'pull' }),
    pullRemote: () => show({ kind: 'pull-remote' }),
    /** Fast-forwards a local branch other than the current one from its upstream. */
    updateBranch: (branch: string) => void run({ action: 'pull', branch }),
    /** IDEA's Merge into Current from a branch's menu: the owner's runs at once, anyone else asks in the dialog. */
    mergeIntoCurrent: (branch: string) =>
      ownsBot(target.botId) ? void run({ action: 'merge', branch }) : show({ kind: 'merge', branch }),
    /** IDEA's Rebase Current onto, as mergeIntoCurrent. */
    rebaseCurrentOnto: (onto: string) =>
      ownsBot(target.botId)
        ? void run({ action: 'rebase', onto })
        : show({ kind: 'rebase', onto, branch: null }),
    /** IDEA's Pull into Current Using Merge / Rebase: the remote branch `from` instead of the upstream. */
    pullFrom: (from: string, mode: 'merge' | 'rebase') => {
      const req: GitActionInput = { action: 'pull', from, mode }
      if (ownsBot(target.botId)) return void run(req)
      const branch = current()
      confirm({
        title:
          mode === 'merge'
            ? t('使用合并拉取到 {branch}', { branch })
            : t('使用变基拉取到 {branch}', { branch }),
        message:
          mode === 'merge'
            ? t('获取 {ref}，合并到 {branch}', { ref: from, branch })
            : t('获取 {ref}，把 {branch} 变基到它之上', { ref: from, branch }),
        label: t('拉取'),
        req,
      })
    },
    push: (branch: string | null = null, upTo?: CommitInfo) => show({ kind: 'push', branch, upTo }),
    cherryPick: (commits: CommitInfo[]) =>
      confirm({
        title: t('优选提交'),
        message: t('将 {commits} 应用到 {branch}', { commits: names(commits), branch: current() }),
        label: t('优选'),
        req: { action: 'cherry-pick', commits: commits.map((c) => c.hash) },
      }),
    revert: (commits: CommitInfo[]) =>
      confirm({
        title: t('还原提交'),
        message: t('在 {branch} 上新建提交，撤销 {commits} 的改动', {
          commits: names(commits),
          branch: current(),
        }),
        label: t('还原'),
        req: { action: 'revert', commits: commits.map((c) => c.hash) },
      }),
    reset: (commit: CommitInfo) => show({ kind: 'reset', commit }),
    /** IDEA's Undo Commit: the last commit's changes go back to the work tree. */
    undoCommit: (head: GitHeadCommit) =>
      confirm({
        title: t('撤销提交'),
        message: t('撤销 {hash}，它的改动回到未提交的更改', { hash: head.shortHash }),
        consequences: head.pushed ? [t('该提交已推送，撤销后需要强制推送才能更新远程')] : undefined,
        label: t('撤销提交'),
        // HEAD~1 of the HEAD shown: an Undo Commit approved after another commit landed is refused, not run on it.
        req: { action: 'reset', commit: 'HEAD~1', mode: 'soft', expectHead: head.hash },
      }),
    reword: (head: GitHeadCommit) => show({ kind: 'reword', head }),
    /** Edit Commit Message for HEAD as it is now, e.g. the commit just made. */
    rewordLast: async () => {
      try {
        const { head } = await api.get<GitChangesDto>(
          gitUrls.changes(gitBase(target.groupId, target.botId), target.repo),
        )
        if (head) show({ kind: 'reword', head })
      } catch (e) {
        toastError(e)
      }
    },
    newTag: (commit: CommitInfo | null = null) => show({ kind: 'tag-create', commit }),
    deleteTag: (name: string) => show({ kind: 'tag-delete', name }),
    pushTag: (name: string, remote = 'origin') => void run({ action: 'tag-push', name, remote }),
    stash: (paths: string[] | null = null) => show({ kind: 'stash', paths }),
    unstash: (stash: GitStash) => show({ kind: 'unstash', stash }),
    dropStash: (stash: GitStash) =>
      confirm({
        title: t('删除贮藏'),
        message: t('删除 {ref}：{message}', { ref: `stash@{${stash.index}}`, message: stash.message }),
        consequences: [t('删除后无法恢复')],
        label: t('删除'),
        destructive: true,
        req: { action: 'stash-drop', stash: stash.index, expect: stash.hash },
      }),
    clearStashes: (n: number) =>
      confirm({
        title: t('清空贮藏'),
        message: t('删除全部 {n} 个贮藏', { n }),
        consequences: [t('删除后无法恢复')],
        label: t('清空'),
        destructive: true,
        req: { action: 'stash-drop' },
      }),
    /** IDEA's Rollback Changes dialog for tracked `changes`. */
    rollback: (changes: TreeChange[]) => show({ kind: 'rollback', changes }),
    /** IDEA's Delete for untracked files: nothing to roll back to, so they go. */
    deleteFiles: (paths: string[]) =>
      confirm({
        title: t('删除未跟踪的文件'),
        message: t('从磁盘删除 {n} 个未跟踪的文件', { n: paths.length }),
        consequences: [...paths, t('删除后无法恢复')],
        label: t('删除'),
        destructive: true,
        req: { action: 'discard', paths },
      }),
    /** IDEA's Add to VCS: untracked files staged as added. */
    addToVcs: (paths: string[]) => void run({ action: 'add', paths }),
    /** IDEA's Add to .gitignore: each file as a `/path` line of the repo's .gitignore. */
    ignore: (paths: string[]) =>
      confirm({
        title: t('加入 .gitignore'),
        message: t('在 .gitignore 末尾添加 {n} 行', { n: paths.length }),
        consequences: paths.map((p) => `/${p}`),
        label: t('添加'),
        req: { action: 'ignore', paths },
      }),
    /** The work tree's changes of `paths` against HEAD as one patch on the clipboard. */
    copyPatch: async (paths: string[]) => {
      const base = gitBase(target.groupId, target.botId)
      try {
        const diffs = await Promise.all(
          paths.map((p) => api.get<GitDiffDto>(gitUrls.diff(base, 'HEAD', null, p, target.repo))),
        )
        if (diffs.some((d) => d.truncated))
          return void toast({ type: 'error', message: t('改动过大，无法创建补丁') })
        await copyWithToast(diffs.map((d) => d.patch ?? '').join(''), t('已复制补丁'))
      } catch (e) {
        toastError(e)
      }
    },
    continueOngoing: (ongoing: GitOngoing) =>
      ongoing.kind === 'merge' ? show({ kind: 'continue', ongoing }) : void run({ action: 'continue' }),
    abortOngoing: (ongoing: GitOngoing | null) =>
      confirm({
        title: ongoing ? t('中止{op}', { op: ongoingLabel(ongoing.kind) }) : t('放弃解决冲突'),
        message: ongoing
          ? t('回到{op}之前的状态', { op: ongoingLabel(ongoing.kind) })
          : t('冲突的文件恢复到 HEAD，其他改动保留'),
        consequences: [t('已解决的冲突会丢失')],
        label: ongoing ? t('中止') : t('放弃'),
        destructive: true,
        req: { action: 'abort' },
      }),
    skipCommit: () => void run({ action: 'skip' }),
    /** Takes a side for conflicted files; several in one request (gitOps4), one as before. */
    resolve: ([path, ...more]: [string, ...string[]], side: 'ours' | 'theirs') =>
      run({ action: 'resolve', path, side, ...(more.length > 0 && { paths: more }) }),
    /** IDEA's Cherry-Pick / Revert Selected Changes: uncommitted, only the changes to `paths`. */
    applyChanges: (commit: CommitInfo, paths: string[], reverse: boolean) =>
      confirm({
        title: reverse ? t('还原所选改动') : t('优选所选改动'),
        message: reverse
          ? t('在工作区撤销 {hash} 的所选文件改动', { hash: commit.shortHash })
          : t('把 {hash} 的所选文件改动应用到工作区，不创建提交', { hash: commit.shortHash }),
        label: reverse ? t('还原') : t('优选'),
        req: { action: 'apply', commit: commit.hash, paths, reverse },
      }),
    /** IDEA's Get from Revision: replaces the chosen work-tree paths, deleting ones absent at that revision. */
    restoreFrom: (commit: CommitInfo, paths: string[]) =>
      confirm({
        title: t('从该版本取回文件'),
        message: t('用 {hash} 的内容替换所选 {n} 个文件', { hash: commit.shortHash, n: paths.length }),
        consequences: [...paths, t('这些文件中未提交的改动会被覆盖')],
        label: t('取回文件'),
        destructive: true,
        req: { action: 'restore', commit: commit.hash, paths },
    }),
    /** Two versions side by side; `to` null = the work tree. */
    compare: (from: string, to: string | null) =>
      openTab({ kind: 'git-compare', botId: target.botId, repo: target.repo, from, to, file: null }),
    /**
     * The repo's log, or a file's or folder's history (`path`), each in a tab of its own; asked for with nothing to
     * show, an open one is only brought forward, its filters and selection kept.
     */
    openLog: (opts: {
      ref?: string | null
      commit?: string | null
      path?: string | null
      filter?: GitLogTabFilter
    }) => {
      const tab: WorkbenchTab = {
        kind: 'git-log',
        botId: target.botId,
        scope: logScope(target.repo, opts.path),
        repo: target.repo,
        ref: opts.ref ?? null,
        commit: opts.commit ?? null,
        file: null,
        path: opts.path ?? null,
        filter: opts.filter ?? null,
      }
      const { groupId, benches } = useWorkbench.getState()
      const key = tabKey(tab)
      const open = groupId ? benches[groupId]?.tabs.find((x) => tabKey(x) === key) : undefined
      return openTab(open && !opts.ref && !opts.commit && !opts.filter ? open : tab)
    },
    openMerge: (path: string) => openTab({ kind: 'git-merge', botId: target.botId, repo: target.repo, path }),
    /** A work tree change in the bot's diff tab. */
    openChange: (path: string) =>
      openTab({
        kind: 'diff',
        botId: target.botId,
        scope: 'uncommitted',
        file: inWorkspace(path),
        repo: target.repo,
      }),
    /** A work tree file in its own tab; `annotate` shows who changed each line (each request anew). */
    openFile: (path: string, annotate = false) =>
      openTab({
        kind: 'file',
        source: { botId: target.botId, path: inWorkspace(path), ...(annotate && { annotate: Date.now() }) },
      }),
    /** The file at `path` as of `rev`; `annotate` shows who changed each line. */
    openVersion: (path: string, rev: string, annotate = false) =>
      openTab({
        kind: 'file',
        source: {
          botId: target.botId,
          path: inWorkspace(path),
          rev,
          ...(annotate && { annotate: Date.now() }),
        },
      }),
    /** A work tree file opened at a line (IDEA's Jump to Source). */
    openLine: (path: string, line: number) =>
      openTab({
        kind: 'file',
        source: { botId: target.botId, path: inWorkspace(path), line: { from: line, to: line } },
      }),
    /** The work tree's files at a version. */
    browse: (rev: string) =>
      openTab({ kind: 'files', botId: target.botId, dir: '', selected: null, rev, base: null }),
    copy: (text: string, done = t('已复制')) => copyWithToast(text, done),
    shortRev,
  }
}

export type GitCommands = ReturnType<typeof gitCommands>
