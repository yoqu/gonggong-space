import type { GitActionInput, GitChangesDto, GitCommit, GitOperationDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api } from '../../../lib/api'
import { ago } from '../../../lib/time'
import { Alert, ComboBox } from '../../../ui'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import {
  type GitTarget,
  gitActionTaken,
  gitBase,
  gitUrls,
  repoStatus,
  runGitAction,
  useGitRefs,
} from '../api'
import { inTarget } from '../commands'
import { useOwner } from '../owner'

/**
 * Sends a dialog's action: taken (done, running or requested) closes the dialog, a failure stays with git's reason
 * shown in it; `after` runs once it is taken, before closing (a follow-up action).
 */
export function useGitRun(target: GitTarget, onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (req: GitActionInput, after?: (op: GitOperationDto) => unknown) => {
    setBusy(true)
    setError(null)
    const op = await runGitAction(target.groupId, target.botId, inTarget(target, req))
    if (op && gitActionTaken(op)) {
      await after?.(op)
      onClose()
    } else if (op && (await stoppedOnConflicts(target))) {
      // A merge, rebase, pick or unstash that stopped on conflicts goes on in the Git tab's banner.
      onClose()
    } else {
      setBusy(false)
      setError(op?.error ?? null)
    }
    return op
  }
  return { busy, error, submit }
}

async function stoppedOnConflicts(target: GitTarget) {
  try {
    const c = await api.get<GitChangesDto>(
      gitUrls.changes(gitBase(target.groupId, target.botId), target.repo),
    )
    return !!c.ongoing || c.conflicts.length > 0
  } catch {
    return false
  }
}

/** The primary button: the owner runs it, anyone else asks for it. */
export function useActionLabel(botId: string) {
  const { owner } = useOwner(botId)
  return (label: string) => (owner ? label : t('提交申请'))
}

/** Tells a non-owner the action waits for the owner's approval. */
export function OwnerNote({ botId }: { botId: string }) {
  const { owner, ownerName } = useOwner(botId)
  if (owner) return null
  return <Alert description={t('需要 Bot 主人 {name} 批准后才会执行', { name: ownerName })} />
}

export function GitError({ error }: { error: string | null }) {
  return error ? <Alert variant="error" description={error} /> : null
}

/** Commits a dialog is about, one per line; `more`: the list goes on. */
export function CommitList({ commits, more }: { commits: GitCommit[]; more: boolean }) {
  return (
    <ul className="git-push__list">
      {commits.map((c) => (
        <li key={c.hash} className="git-push__commit">
          <span className="git-push__subject">{c.subject}</span>
          <span className="git-push__meta">
            {c.author} · {ago(c.at)}
          </span>
          <span className="git-push__hash">{c.shortHash}</span>
        </li>
      ))}
      {more ? <li className="git-push__more">{t('还有更多提交…')}</li> : null}
    </ul>
  )
}

/** The repo's status line from the live git status. */
export function useRepoStatus(target: GitTarget) {
  const git = useWorkspace((s) => s.botStates[target.groupId]?.[target.botId]?.git ?? null)
  return git ? repoStatus(git, target.repo) : null
}

/** A branch, tag or any revision typed in, the repo's refs suggested. */
export function RefCombo({
  target,
  label,
  value,
  onChange,
  tags = true,
}: {
  target: GitTarget
  label: string
  value: string
  onChange: (ref: string) => void
  tags?: boolean
}) {
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const options = [
    ...(refs?.branches ?? [])
      .filter((b) => !b.name.endsWith('/HEAD'))
      .map((b) => ({ value: b.name, label: b.name, detail: b.kind === 'local' ? t('本地') : t('远程') })),
    ...(tags
      ? (refs?.tags ?? []).map((tag) => ({ value: tag.name, label: tag.name, detail: t('标签') }))
      : []),
  ]
  return (
    <ComboBox
      label={label}
      options={options}
      value={value}
      placeholder={t('分支、标签或提交哈希')}
      onInput={onChange}
      onChange={(v) => onChange(v)}
    />
  )
}

/** What `git check-ref-format --branch` refuses, checked before asking (the daemon checks again). */
export function badRefName(name: string): string | null {
  const n = name.trim()
  if (!n) return null
  if (/\s/.test(n)) return t('名称不能包含空格')
  const control = [...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  if (control || /(^[-/.])|([/.]$)|\.\.|\/\/|@\{|[~^:?*[\\]|\.lock$|\/\./.test(n) || n === '@')
    return t('名称不合法：{name}', { name: n })
  return null
}
