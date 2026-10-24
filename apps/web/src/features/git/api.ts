import type {
  GitActionInput,
  GitLogQuery,
  GitOperationDto,
  GitRefsDto,
  GitStatus,
  RepoStatus,
} from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { putGitOperation, useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { toast } from '../../ui'
import { gitOperationSettled } from './notify'

export const gitBase = (groupId: string, botId: string) => `/groups/${groupId}/bots/${botId}/git`

/** One repo of a bot's workspace: the root when `repo` is null, else a sub-repo as GitStatus.repos lists it. */
export interface GitTarget {
  groupId: string
  botId: string
  repo: string | null
}

const enc = encodeURIComponent
/** `&repo=…`, or nothing for the root repo. */
const inRepo = (repo: string | null | undefined, first = false) =>
  repo ? `${first ? '?' : '&'}repo=${enc(repo)}` : ''

/** Log filters as query parameters; flags as 1, unset ones left out. */
export type LogFilter = Omit<GitLogQuery, 'repo' | 'ref' | 'skip'>

const filterQuery = (f: LogFilter | undefined) =>
  Object.entries(f ?? {})
    .filter(([, v]) => v !== undefined && v !== false && v !== '')
    .map(([k, v]) => `&${k}=${v === true ? '1' : enc(String(v))}`)
    .join('')

export const gitUrls = {
  refs: (base: string, repo?: string | null) => `${base}/refs${inRepo(repo, true)}`,
  log: (base: string, ref: string | null, skip: number, repo?: string | null, filter?: LogFilter) =>
    `${base}/log?${ref ? `ref=${enc(ref)}&` : ''}skip=${skip}${inRepo(repo)}${filterQuery(filter)}`,
  show: (base: string, commit: string, repo?: string | null) =>
    `${base}/show?commit=${enc(commit)}${inRepo(repo)}`,
  tree: (base: string, ref: string, path: string, repo?: string | null) =>
    `${base}/tree?ref=${enc(ref)}&path=${enc(path)}${inRepo(repo)}`,
  text: (base: string, ref: string, path: string, repo?: string | null) =>
    `${base}/text?ref=${enc(ref)}&path=${enc(path)}${inRepo(repo)}`,
  compare: (base: string, from: string, to: string | null, repo?: string | null) =>
    `${base}/compare?from=${enc(from)}${to ? `&to=${enc(to)}` : ''}${inRepo(repo)}`,
  /** `to` null = the work tree; `path` null = every file. */
  diff: (base: string, from: string, to: string | null, path: string | null, repo?: string | null) =>
    `${base}/diff?from=${enc(from)}${to ? `&to=${enc(to)}` : ''}${path ? `&path=${enc(path)}` : ''}${inRepo(repo)}`,
  changes: (base: string, repo?: string | null) => `${base}/changes${inRepo(repo, true)}`,
  blame: (base: string, path: string, ref: string | null, repo?: string | null) =>
    `${base}/blame?path=${enc(path)}${ref ? `&ref=${enc(ref)}` : ''}${inRepo(repo)}`,
  stashes: (base: string, repo?: string | null) => `${base}/stashes${inRepo(repo, true)}`,
  conflict: (base: string, path: string, repo?: string | null) =>
    `${base}/conflict?path=${enc(path)}${inRepo(repo)}`,
}

/** Re-reads a bot's git status (it arrives as a bot state update); `fetch` fetches the remotes first. */
export async function refreshGit(groupId: string, botId: string, fetch = false) {
  await api.post(`${gitBase(groupId, botId)}/refresh`, { fetch })
}

/** A refresh on opening a git view: the view works on the last status anyway, so a failure stays silent. */
export const refreshGitQuietly = (groupId: string, botId: string) => {
  refreshGit(groupId, botId).catch(() => {})
}

/** A full commit hash reads better shortened; branch names stay as they are. */
export const shortRev = (rev: string) => (/^[0-9a-f]{40}$/i.test(rev) ? rev.slice(0, 7) : rev)

/**
 * GETs `url` (null = nothing) and again whenever `stamp` changes; a new stamp keeps the shown data until the fresh one
 * arrives, a new url starts empty.
 */
export function useGitGet<T>(url: string | null, stamp = '') {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({
    url: null,
    data: null,
    error: null,
  })
  const [tick, setTick] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new stamp or tick reads again
  useEffect(() => {
    if (!url) return
    let live = true
    api.get<T>(url).then(
      (data) => live && setState({ url, data, error: null }),
      (e: unknown) =>
        live && setState((s) => ({ url, data: s.url === url ? s.data : null, error: errorText(e) })),
    )
    return () => {
      live = false
    }
  }, [url, stamp, tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  const mine = state.url === url
  return {
    data: mine ? state.data : null,
    error: mine ? state.error : null,
    loading: !!url && (!mine || (state.data == null && state.error == null)),
    reload,
  }
}

/** Branches, remotes, tags and recent branches of a repo, read again when `stamp` (the git status) changes. */
export function useGitRefs(groupId: string, botId: string, repo?: string | null, stamp = '') {
  const { data, error } = useGitGet<GitRefsDto>(gitUrls.refs(gitBase(groupId, botId), repo), stamp)
  return { refs: data, error }
}

/** The status line of one repo: the root's, or a sub-repo's from GitStatus.repos; null when it is not a repo. */
export function repoStatus(git: GitStatus, repo: string | null): RepoStatus | null {
  if (!repo)
    return git.branch != null || git.head != null || !git.repos.length
      ? { path: '', kind: 'root', branch: git.branch, ahead: git.ahead, behind: git.behind, dirty: git.dirty }
      : null
  return git.repos.find((r) => r.path === repo) ?? null
}

/**
 * Runs (owner) or requests (anyone else) a git action; resolves the operation, or null when the server refused it
 * (a busy bot's 409 and other refusals toast the server's message). `succeeded` replaces the plain 「…完成」 toast.
 */
export async function runGitAction(
  groupId: string,
  botId: string,
  req: GitActionInput,
  succeeded?: () => void,
): Promise<GitOperationDto | null> {
  try {
    const op = await api.post<GitOperationDto>(`${gitBase(groupId, botId)}/actions`, req)
    putGitOperation(op)
    const { bots } = useWorkspace.getState()
    if (op.status === 'pending_approval') {
      const owner = bots.find((b) => b.id === botId)?.ownerName ?? ''
      toast({ type: 'info', message: t('已提交申请，等待 Bot 主人 {name} 审批', { name: owner }) })
    } else gitOperationSettled(op, bots, succeeded)
    return op
  } catch (e) {
    toastError(e)
    return null
  }
}

/** Whether a dialog can close: a failed or refused operation keeps it open, to fix and try again. */
export const gitActionTaken = (op: GitOperationDto | null) => !!op && op.status !== 'failed'

export async function decideGitOperation(id: string, approve: boolean) {
  try {
    putGitOperation(await api.post<GitOperationDto>(`/git-operations/${id}/decide`, { approve }))
  } catch (e) {
    toastError(e)
  }
}
