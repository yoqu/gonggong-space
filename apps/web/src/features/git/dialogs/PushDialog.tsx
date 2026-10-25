import {
  type GitActionInput,
  type GitChange,
  type GitCommit,
  type GitCompareDto,
  type GitLogDto,
  isGitRefName,
} from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../../app/workspace'
import { t } from '../../../i18n'
import { api, errorText } from '../../../lib/api'
import { ago } from '../../../lib/time'
import {
  Alert,
  AlertDialog,
  Button,
  Checkbox,
  ComboBox,
  Dialog,
  EmptyState,
  Icon,
  PopUpButton,
  Presence,
  PullDownButton,
  Spinner,
} from '../../../ui'
import { GitFileDiff } from '../../diff/GitFileDiff'
import { useGitStamp } from '../../diff/useWorkspaceDiff'
import { type GitTarget, gitBase, gitUrls, runGitAction, useGitGet, useGitRefs } from '../api'
import { ChangeTree, type TreeChange, useChangeLayout } from '../ChangeTree'
import { type CommitInfo, inTarget } from '../commands'
import { useOwner } from '../owner'
import { EMPTY_TREE } from '../StashView'
import { GitError, OwnerNote, useActionLabel, useGitRun, useRepoStatus } from './common'

/** git's words for a push the remote refused because it moved on. */
const REJECTED = /rejected|non-fast-forward|fetch first|stale info/i

/** A file as the commits picked change it: from before the first of them to after the last. */
export interface PushedFile extends TreeChange {
  from: string
  to: string
}

/**
 * IDEA's zipChanges: each commit's changes (oldest first) joined per file, following renames; a file added and then
 * deleted drops out.
 */
export function zipChanges(commits: { from: string; to: string; changes: GitChange[] }[]): PushedFile[] {
  const files = new Map<string, PushedFile & { before: string | null }>()
  for (const c of commits)
    for (const ch of c.changes) {
      const prev = files.get(ch.oldPath ?? ch.path)
      if (prev) files.delete(ch.oldPath ?? ch.path)
      const before = prev ? prev.before : ch.change === 'added' ? null : (ch.oldPath ?? ch.path)
      if (!before && ch.change === 'deleted') continue
      const change = !before
        ? 'added'
        : ch.change === 'deleted'
          ? 'deleted'
          : before !== ch.path
            ? 'renamed'
            : 'modified'
      files.set(ch.path, {
        path: ch.path,
        change,
        oldPath: change === 'renamed' ? before : null,
        before,
        from: prev?.from ?? c.from,
        to: c.to,
      })
    }
  return [...files.values()].map(({ before: _, ...f }) => f)
}

/** Each commit's changes against its first parent (an error's text when unreadable), read once per commit. */
function useCommitChanges(target: GitTarget, commits: GitCommit[]) {
  const base = gitBase(target.groupId, target.botId)
  const [read, setRead] = useState<Record<string, GitChange[] | string>>({})
  const asked = useRef(new Set<string>())
  const key = commits.map((c) => c.hash).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: the hashes say which commits to read
  useEffect(() => {
    for (const c of commits) {
      if (asked.current.has(c.hash)) continue
      asked.current.add(c.hash)
      const put = (v: GitChange[] | string) => setRead((r) => ({ ...r, [c.hash]: v }))
      api.get<GitCompareDto>(gitUrls.compare(base, c.parents[0] ?? EMPTY_TREE, c.hash, target.repo)).then(
        (d) => put(d.changes),
        (e: unknown) => put(errorText(e)),
      )
    }
  }, [key, base, target.repo])
  return read
}

/**
 * IDEA's Push Commits: `branch → remote : target` (the remote picked, the target edited in place, marked new when the
 * remote lacks it), the commits going out and the files the picked ones change, tags, and a force push (with lease)
 * from the button's menu, never to the protected base branch. `upTo` pushes only up to that commit. A push the remote
 * rejects offers the owner to merge or rebase the current branch first, then pushes again.
 */
export function PushDialog({
  target,
  branch: start,
  upTo,
  onClose,
}: {
  target: GitTarget
  branch: string | null
  upTo?: CommitInfo
  onClose: () => void
}) {
  const status = useRepoStatus(target)
  const group = useWorkspace((s) => s.groups.find((g) => g.id === target.groupId))
  const stamp = useGitStamp(target.groupId, target.botId)
  const { refs } = useGitRefs(target.groupId, target.botId, target.repo, stamp)
  const { owner } = useOwner(target.botId)
  const [remote, setRemote] = useState<string | null>(null)
  const [typed, setTyped] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [tags, setTags] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [file, setFile] = useState<string | null>(null)
  const [diff, setDiff] = useState<PushedFile | null>(null)
  const [askForce, setAskForce] = useState(false)
  const [forced, setForced] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const { busy, error, submit } = useGitRun(target, onClose)
  const label = useActionLabel(target.botId)
  const base = gitBase(target.groupId, target.botId)

  const name = start ?? status?.branch ?? ''
  const remotes = refs?.remotes ?? []
  const local = refs?.branches.find((b) => b.kind === 'local' && b.name === name)
  const upstreamRemote = local?.upstream
    ? remotes.find((r) => local.upstream?.startsWith(`${r.name}/`))?.name
    : null
  const at =
    remote ?? upstreamRemote ?? remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name ?? 'origin'
  // As IDEA (and the daemon): a branch goes to its upstream when that is on the remote picked, else to its own name.
  const onto =
    typed?.trim() || (upstreamRemote === at && local?.upstream ? local.upstream.slice(at.length + 1) : name)
  const valid = isGitRefName(onto)
  const dest = `${at}/${onto}`
  const onRemote = (refs?.branches ?? [])
    .filter((b) => b.kind === 'remote' && b.name.startsWith(`${at}/`) && !b.name.endsWith('/HEAD'))
    .map((b) => b.name.slice(at.length + 1))
  const published = onRemote.includes(onto)
  const mainline = group?.repo?.branch ?? null
  const protectedBase = group?.protectBase ? mainline : null
  const tip = upTo?.hash ?? name
  const range =
    !name || !valid ? null : published ? `${dest}..${tip}` : mainline ? `${at}/${mainline}..${tip}` : null
  const log = useGitGet<GitLogDto>(range ? gitUrls.log(base, range, 0, target.repo) : null, stamp)
  const commits = log.data?.commits ?? []
  const shown = picked.size ? commits.filter((c) => picked.has(c.hash)) : commits
  const read = useCommitChanges(target, shown)
  const failed = shown.map((c) => read[c.hash]).find((r) => typeof r === 'string')
  const loaded = shown.every((c) => Array.isArray(read[c.hash]))
  const changes = loaded
    ? zipChanges(
        [...shown].reverse().map((c) => ({
          from: c.parents[0] ?? EMPTY_TREE,
          to: c.hash,
          changes: read[c.hash] as GitChange[],
        })),
      )
    : null
  const layout = useChangeLayout((s) => s.layout)
  const toggleLayout = useChangeLayout((s) => s.toggle)
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())

  const toBase = !!protectedBase && onto === protectedBase
  const rejected = !!error && REJECTED.test(error) && !forced
  // Merging or rebasing helps only the current branch, pushed whole: a rebase rewrites the commit pushed up to.
  const canUpdate = owner && !!name && name === status?.branch && !upTo
  const push = (force: boolean): GitActionInput => ({
    action: 'push',
    remote: at,
    branch: name,
    ...(onto !== name && { target: onto }),
    confirmBase: toBase,
    force,
    tags,
    ...(upTo && { commit: upTo.hash }),
  })
  const send = (force: boolean) => {
    setForced(force)
    setDismissed(false)
    void submit(push(force))
  }
  const updateAndPush = (mode: 'merge' | 'rebase') => {
    setDismissed(true)
    const from = dest !== local?.upstream ? dest : null
    void submit({ action: 'pull', mode, ...(from && { from }) }, () =>
      runGitAction(target.groupId, target.botId, inTarget(target, push(false))),
    )
  }
  const pick = (hash: string, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    const hashes = commits.map((c) => c.hash)
    if (e.shiftKey && anchor.current) {
      const [a, b] = [hashes.indexOf(anchor.current), hashes.indexOf(hash)].sort((x, y) => x - y)
      return setPicked(new Set(hashes.slice(a, (b ?? 0) + 1)))
    }
    anchor.current = hash
    if (!(e.metaKey || e.ctrlKey)) return setPicked(new Set([hash]))
    const next = new Set(picked)
    if (!next.delete(hash)) next.add(hash)
    setPicked(next)
  }
  const listKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = commits.findIndex((c) => c.hash === anchor.current)
    const next = commits[Math.max(0, Math.min(commits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    pick(next.hash, { metaKey: false, ctrlKey: false, shiftKey: false })
    e.currentTarget.querySelector<HTMLElement>(`[data-hash="${next.hash}"]`)?.focus()
  }
  const title = upTo ? t('推送到 {hash} 为止', { hash: upTo.shortHash }) : t('推送提交')

  const editor = (
    <TargetEditor
      value={onto}
      options={onRemote}
      onDone={(v) => {
        setTyped(v.trim() ? v : null)
        setEditing(false)
      }}
    />
  )

  return (
    <Dialog
      open
      title={title}
      width={880}
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        <div className="git-push__foot">
          <Checkbox label={t('推送标签#tags')} checked={tags} onChange={setTags} />
          <span className="spacer" />
          <Button onClick={onClose}>{t('取消')}</Button>
          <div className="git-push__split">
            <Button
              variant={toBase ? 'destructive' : 'primary'}
              disabled={busy || !name || !valid || editing || (toBase && !confirmed)}
              onClick={() => send(false)}
            >
              {label(upTo ? title : t('推送'))}
            </Button>
            <PullDownButton
              variant={toBase ? 'destructive' : 'primary'}
              aria-label={t('更多选项')}
              align="end"
              portal
              disabled={busy || !name || !valid || editing}
              items={[{ value: 'force', label: t('强制推送'), destructive: true, disabled: toBase }]}
              onSelect={() => setAskForce(true)}
            />
          </div>
        </div>
      }
    >
      <div className="git-form">
        <OwnerNote botId={target.botId} />
        <div className="git-push">
          <section className="git-push__pane" aria-label={t('提交')}>
            <fieldset className="git-push__route" aria-label={t('推送目标')}>
              <span className="git-push__ref">{name}</span>
              <span className="git-push__sep">→</span>
              {remotes.length > 1 ? (
                <PopUpButton
                  size="small"
                  aria-label={t('远程')}
                  value={at}
                  onChange={setRemote}
                  options={remotes.map((r) => ({ value: r.name, label: r.name }))}
                />
              ) : (
                <span className="git-push__ref">{at}</span>
              )}
              <span className="git-push__sep">:</span>
              {editing ? (
                editor
              ) : (
                <button
                  type="button"
                  className="git-push__target"
                  aria-label={t('编辑目标分支')}
                  title={t('编辑目标分支')}
                  onClick={() => setEditing(true)}
                >
                  {onto}
                </button>
              )}
              {refs && valid && !published && !editing ? (
                <span className="git-push__new">{t('新')}</span>
              ) : null}
            </fieldset>
            {!valid ? <p className="git-push__invalid">{t('无效的分支名')}</p> : null}
            {(!refs || log.loading) && valid ? (
              <div className="git-refs__note">
                <Spinner size={14} />
              </div>
            ) : commits.length ? (
              <div
                role="listbox"
                tabIndex={-1}
                aria-label={t('待推送的提交')}
                aria-multiselectable
                className="git-push__list"
                onKeyDown={listKey}
              >
                {commits.map((c) => (
                  <button
                    key={c.hash}
                    type="button"
                    role="option"
                    aria-selected={picked.has(c.hash)}
                    data-hash={c.hash}
                    className="git-push__commit"
                    onClick={(e) => pick(c.hash, e)}
                  >
                    <span className="git-push__subject">{c.subject}</span>
                    <span className="git-push__meta">
                      {c.author} · {ago(c.at)}
                    </span>
                    <span className="git-push__hash">{c.shortHash}</span>
                  </button>
                ))}
                {log.data?.hasMore ? <p className="git-push__more">{t('还有更多提交…')}</p> : null}
              </div>
            ) : valid ? (
              <p className="git-push__empty">
                {!published
                  ? t('首次推送，会在远程创建 {branch} 并设为上游', { branch: onto })
                  : t('{dest} 已包含全部提交，没有新的提交可推送', { dest })}
              </p>
            ) : null}
          </section>
          <div className="git-push__pane">
            <div className="git-push__bar">
              <span className="git-push__caption">{t('{n} 个提交的改动', { n: shown.length })}</span>
              <button
                type="button"
                className="git-push__tool"
                aria-label={layout === 'tree' ? t('平铺显示') : t('按目录分组')}
                title={layout === 'tree' ? t('平铺显示') : t('按目录分组')}
                onClick={toggleLayout}
              >
                <Icon name={layout === 'tree' ? 'list' : 'folder'} size={14} />
              </button>
            </div>
            {failed ? (
              <EmptyState compact icon="warning" title={t('无法读取变更')} description={failed} />
            ) : !commits.length ? null : !changes ? (
              <div className="git-refs__note">
                <Spinner size={14} />
              </div>
            ) : (
              <ChangeTree
                groups={[{ key: 'files', label: t('变更文件'), changes }]}
                layout={layout}
                selected={file}
                onSelect={(c) => setFile(c.path)}
                onOpen={(c) => setDiff(c as PushedFile)}
                closed={closed}
                onToggleFolder={(key) =>
                  setClosed((s) => {
                    const next = new Set(s)
                    if (!next.delete(key)) next.add(key)
                    return next
                  })
                }
                label={t('变更文件')}
              />
            )}
          </div>
        </div>
        {toBase ? (
          <Alert
            variant="warning"
            description={t('{branch} 是受保护的基准分支，推送会直接改动它', { branch: onto })}
          >
            <Checkbox label={t('我确认推送到基准分支')} checked={confirmed} onChange={setConfirmed} />
          </Alert>
        ) : null}
        {rejected ? (
          <Alert variant="warning" description={t('远程有新的提交：先更新再推送，或改写过历史时强制推送')} />
        ) : (
          <GitError error={error} />
        )}
      </div>
      <Presence>
        {diff ? (
          <Dialog open title={diff.path} width={960} onClose={() => setDiff(null)}>
            <div className="git-push__diff">
              <GitFileDiff
                url={gitUrls.diff(base, diff.from, diff.to, diff.path, target.repo, diff.oldPath)}
                path={diff.path}
              />
            </div>
          </Dialog>
        ) : null}
      </Presence>
      <Presence>
        {askForce ? (
          <AlertDialog
            open
            title={t('强制推送 {branch}？', { branch: name })}
            message={t(
              '{dest} 会被改成本地的历史；别人已推送但你还没获取的提交会让推送被拒绝（--force-with-lease）',
              {
                dest,
              },
            )}
            onClose={() => setAskForce(false)}
            actions={[
              { label: t('取消'), onClick: () => setAskForce(false) },
              {
                label: label(t('强制推送')),
                variant: 'destructive',
                onClick: () => {
                  setAskForce(false)
                  send(true)
                },
              },
            ]}
          />
        ) : null}
      </Presence>
      <Presence>
        {rejected && !dismissed && !busy ? (
          <AlertDialog
            open
            title={t('推送被拒绝')}
            message={
              canUpdate
                ? t('远程有新的提交：先把 {dest} 合并或变基到 {branch}，然后自动再推送', {
                    dest,
                    branch: name,
                  })
                : t('远程有新的提交：先更新再推送，或改写过历史时强制推送')
            }
            onClose={() => setDismissed(true)}
            actions={
              canUpdate
                ? [
                    { label: t('合并'), variant: 'primary', onClick: () => updateAndPush('merge') },
                    { label: t('变基'), onClick: () => updateAndPush('rebase') },
                    { label: t('取消'), onClick: () => setDismissed(true) },
                  ]
                : [{ label: t('知道了'), onClick: () => setDismissed(true) }]
            }
          />
        ) : null}
      </Presence>
    </Dialog>
  )
}

/** The target branch typed in place, the remote's branches suggested; Enter or leaving keeps it, Escape drops it. */
function TargetEditor({
  value,
  options,
  onDone,
}: {
  value: string
  options: string[]
  onDone: (value: string) => void
}) {
  const [text, setText] = useState(value)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.querySelector('input')?.focus(), [])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys and focus of the combo box inside
    <div
      ref={box}
      className="git-push__edit"
      onKeyDown={(e) => {
        if (e.defaultPrevented) return
        if (e.key === 'Enter') {
          e.preventDefault()
          onDone(text)
        } else if (e.key === 'Escape') {
          // Only the editor closes, not the dialog.
          e.preventDefault()
          onDone(value)
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDone(text)
      }}
    >
      <ComboBox
        aria-label={t('目标分支')}
        options={options}
        value={text}
        onInput={setText}
        onChange={(v) => onDone(v)}
      />
    </div>
  )
}
