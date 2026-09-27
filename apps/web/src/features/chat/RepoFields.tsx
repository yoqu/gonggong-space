import { type BotProbeDto, REPO_URL, type RepoDto, type RepoProbeRes } from '@gonggong/protocol'
import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Button, ComboBox, Icon } from '../../ui'
import type { IconName } from '../../ui/icon'
import './repo-fields.css'

export interface RepoDraft {
  url: string
  branch: string
  check: 'checking' | RepoProbeRes | null
}

const SEARCH_DEBOUNCE_MS = 200

/** Bots whose machine could not use the repo; they join paused (offline ones are checked when they come online). */
export const repoUnavailable = (d: RepoDraft) =>
  d.check && d.check !== 'checking'
    ? d.check.results.filter((r) => !r.ok && r.reason !== 'offline').length
    : 0

const branchMissing = (d: RepoDraft) =>
  !!d.check && d.check !== 'checking' && d.check.results.some((r) => r.reason === 'branch_missing')

/** Checked, and the branch exists: unreachable bots don't block binding, they are paused. */
export const repoValidated = (d: RepoDraft) => !!d.check && d.check !== 'checking' && !branchMissing(d)

export const repoBody = (d: RepoDraft) => ({ url: d.url.trim(), branch: d.branch.trim() || 'main' })

const RESULT: Record<
  NonNullable<BotProbeDto['reason']> | 'ok',
  { icon: IconName; text: string; tone: string }
> = {
  ok: { icon: 'checkmark-circle', text: '可访问', tone: 'ok' },
  denied: { icon: 'xmark-circle', text: '无权限或仓库不存在 · 进群后暂停', tone: 'bad' },
  network: { icon: 'warning', text: '网络或证书问题 · 进群后暂停', tone: 'bad' },
  timeout: { icon: 'clock', text: '连接超时 · 进群后暂停', tone: 'bad' },
  branch_missing: { icon: 'xmark-circle', text: '分支不存在', tone: 'bad' },
  offline: { icon: 'moon', text: '离线 · 上线后自动验证', tone: 'muted' },
}

/** Badge for the URL a machine actually used; none for local (file://) repos. */
const protocolOf = (url: string | null) =>
  url?.startsWith('http') ? 'HTTPS' : url?.startsWith('ssh://') || /^[^@/\s]+@/.test(url ?? '') ? 'SSH' : null

function repoOption(r: RepoDto) {
  const detail = [
    r.groups ? `${r.groups} 个群在用` : null,
    r.lastBranch,
    r.localPaths.length ? '本机已有' : null,
  ].filter(Boolean)
  return { value: r.id, label: r.url, detail: detail.join(' · ') }
}

/**
 * Remote URL (searchable team history) + base branch, and an access check from each bot's own machine: `botIds`, or
 * the caller's bots when none are picked yet.
 */
export function RepoFields({
  draft: d,
  set,
  botIds,
}: {
  draft: RepoDraft
  set: (o: Partial<RepoDraft>) => void
  botIds: string[]
}) {
  const bots = useWorkspace((s) => s.bots)
  const [history, setHistory] = useState<RepoDto[]>([])
  const [query, setQuery] = useState(d.url)
  const [failure, setFailure] = useState<string | null>(null)
  // Answers for an address or branch that has since been edited are dropped.
  const edits = useRef(0)
  const branchTouched = useRef(false)
  const edit = (o: Partial<RepoDraft>) => {
    edits.current += 1
    setFailure(null)
    set({ ...o, check: null })
  }
  // A check covers the bots picked when it ran; picking others drops it (and any answer still on its way).
  const botKey = botIds.join()
  const checkedBots = useRef(botKey)
  useEffect(() => {
    if (checkedBots.current === botKey) return
    checkedBots.current = botKey
    edit({})
  })
  const urlOk = REPO_URL.test(d.url.trim())
  const check = d.check === 'checking' ? null : d.check

  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      api.get<RepoDto[]>(`/repos?q=${encodeURIComponent(query.trim())}`).then(
        (list) => current && setHistory(list),
        () => current && setHistory([]),
      )
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  const validate = async (branch = d.branch) => {
    const at = edits.current
    set({ check: 'checking' })
    const body = { ...repoBody({ ...d, branch }), botIds }
    let res: RepoProbeRes
    try {
      res = await api.post<RepoProbeRes>('/repos/probe', body)
    } catch (e) {
      if (at !== edits.current) return
      setFailure(e instanceof ApiError ? e.message : '检查失败，请稍后重试')
      return set({ check: null })
    }
    if (at !== edits.current) return
    const fallback = res.defaultBranch
    const missing = !res.results.some((r) => r.ok) && res.results.some((r) => r.reason === 'branch_missing')
    // An untouched branch field follows the repo's default branch when it lacks the one filled in.
    if (!branchTouched.current && fallback && fallback !== branch && missing) {
      set({ branch: fallback })
      return validate(fallback)
    }
    set({ check: res })
  }

  const pick = (id: string) => {
    const r = history.find((h) => h.id === id)
    if (!r) return
    branchTouched.current = !!r.lastBranch
    edit({ url: r.url, branch: r.lastBranch ?? d.branch })
  }

  const name = (id: string) => bots.find((b) => b.id === id)?.name ?? 'Bot'
  return (
    <>
      <div className="ng-repo">
        <ComboBox
          className="repo-fields__url"
          aria-label="仓库地址"
          value={d.url}
          placeholder="git@git.corp:team/repo.git"
          options={history.map(repoOption)}
          onInput={(url) => {
            setQuery(url)
            edit({ url })
          }}
          onChange={pick}
        />
        <ComboBox
          className="repo-fields__branch"
          aria-label="基准分支"
          value={d.branch}
          placeholder="main"
          options={check?.branches ?? []}
          onInput={(branch) => {
            branchTouched.current = true
            edit({ branch })
          }}
          onChange={(branch) => {
            branchTouched.current = true
            edit({ branch })
          }}
        />
        <Button size="sm" disabled={!urlOk || d.check === 'checking'} onClick={() => void validate()}>
          {d.check === 'checking' ? '检查中…' : check ? '重新检查' : '检查访问'}
        </Button>
      </div>
      {d.url && !urlOk ? (
        <div className="ng-check ng-check--bad">
          <Icon name="xmark-circle" size={13} className="ng-check__icon" />
          地址格式不正确，支持 git@ / https:// / http:// / ssh://
        </div>
      ) : failure ? (
        <div className="ng-check ng-check--bad">
          <Icon name="xmark-circle" size={13} className="ng-check__icon" />
          {failure}
        </div>
      ) : null}
      {check ? (
        <ul className="repo-fields__results" aria-label="访问检查">
          {check.results.length ? null : (
            <li className="repo-fields__result repo-fields__result--muted">
              没有可用于检查的 Bot · 进群后由各 Bot 的机器 clone 时验证
            </li>
          )}
          {check.results.map((r) => {
            const v = RESULT[r.ok ? 'ok' : (r.reason ?? 'denied')]
            return (
              <li key={r.botId} className={cx('repo-fields__result', `repo-fields__result--${v.tone}`)}>
                <Icon name={v.icon} size={13} className="ng-check__icon" />
                <span className="repo-fields__bot">{name(r.botId)}</span>
                <span>{v.text}</span>
                {r.ok && protocolOf(r.usedUrl) ? (
                  <span className="repo-fields__proto">{protocolOf(r.usedUrl)}</span>
                ) : null}
                {!r.ok && r.detail ? <span className="repo-fields__detail">{r.detail}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}
