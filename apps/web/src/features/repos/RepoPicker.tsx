import { type ProviderRepoDto, REPO_URL, type RepoDto, type RepoProbeRes } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import {
  Button,
  ComboBox,
  GroupRow,
  Icon,
  type IconName,
  Popover,
  SearchField,
  SegmentedControl,
  Spinner,
} from '../../ui'
import { accountLabel, gitAccountsApi, useGitAccounts } from '../settings/api'
import { useSettings } from '../settings/store'
import { checkSummary, type RepoDraft, repoBody, repoIcon } from './repo-access'
import './repos.css'
import { t } from '../../i18n'

const SEARCH_DEBOUNCE_MS = 200
const CHECK_DEBOUNCE_MS = 400
const SOURCE_KEY = 'gonggong.repoSource'

/** `git@x:team/pay.git` → `team/pay`, the part people recognise. */
export const repoPath = (url: string) =>
  url
    .trim()
    .replace(/\.git$/, '')
    .replace(/^[a-z]+:\/\/[^/]+\//, '')
    .replace(/^[^@/\s]+@[^:/\s]+:/, '')

const readSource = () => {
  try {
    return localStorage.getItem(SOURCE_KEY) ?? 'recent'
  } catch {
    return 'recent'
  }
}
const saveSource = (s: string) => {
  try {
    localStorage.setItem(SOURCE_KEY, s)
  } catch {}
}

interface Row {
  key: string
  icon: IconName
  url: string
  title: string
  detail: string
  locked?: boolean
  pick: () => void
}

/** The account repo picked last, so its branches come from the provider instead of the access check. */
interface Picked {
  accountId: string
  fullName: string
}

/**
 * Repo (popover with the team history and my GitHub / GitLab accounts) + base branch rows, and an automatic access
 * check from each bot's own machine: `botIds`, or the caller's bots when none are picked. Per-bot results are
 * rendered by the caller; only a summary shows here.
 */
export function RepoPicker({
  draft: d,
  set,
  botIds,
  clearable,
}: {
  draft: RepoDraft
  set: (o: Partial<RepoDraft>) => void
  botIds: string[]
  /** New groups may stay unbound; a bound group cannot be unbound. */
  clearable?: boolean
}) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [accountBranches, setAccountBranches] = useState<string[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const branchTouched = useRef(false)
  // Answers for an address, branch or bot set that has since changed are dropped.
  const edits = useRef(0)
  const latest = useRef(d)
  latest.current = d
  const botKey = botIds.join()

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check exactly when the inputs change; `set` and `botIds` are fresh every render
  useEffect(() => {
    const at = ++edits.current
    setFailure(null)
    const url = d.url.trim()
    if (!url) {
      if (latest.current.check) set({ check: null })
      return
    }
    set({ check: 'checking' })
    const timer = setTimeout(async () => {
      const body = { ...repoBody(latest.current), botIds }
      let res: RepoProbeRes
      try {
        res = await api.post<RepoProbeRes>('/repos/probe', body)
      } catch (e) {
        if (at !== edits.current) return
        setFailure(e instanceof ApiError ? e.message : t('检查失败，请稍后重试'))
        return set({ check: null })
      }
      if (at !== edits.current) return
      const fallback = res.defaultBranch
      const missing = !res.results.some((r) => r.ok) && res.results.some((r) => r.reason === 'branch_missing')
      // An untouched branch field follows the repo's default branch when it lacks the one filled in.
      if (!branchTouched.current && fallback && fallback !== body.branch && missing)
        return set({ branch: fallback })
      set({ check: res })
    }, CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [d.url, d.branch, botKey, retry])

  useEffect(() => {
    setAccountBranches(null)
    if (!picked) return
    let current = true
    gitAccountsApi.branches(picked.accountId, picked.fullName).then(
      (b) => current && setAccountBranches(b),
      () => {},
    )
    return () => {
      current = false
    }
  }, [picked])

  const choose = (o: { url: string; branch: string | null; touched: boolean; from: Picked | null }) => {
    branchTouched.current = o.touched
    setPicked(o.from)
    set({ url: o.url, branch: o.branch ?? d.branch })
  }
  const check = d.check && d.check !== 'checking' ? d.check : null
  const branches = accountBranches ?? check?.branches ?? []
  const summary = d.check === 'checking' ? t('正在检查访问…') : checkSummary(d)

  return (
    <>
      <GroupRow
        label={t('仓库')}
        description={
          failure ? (
            <span className="repo-picker__failure">
              {failure}
              <Button size="small" variant="plain" onClick={() => setRetry((n) => n + 1)}>
                {t('重新检查')}
              </Button>
            </span>
          ) : (
            summary
          )
        }
      >
        <Popover
          width={360}
          placement="bottom-end"
          aria-label={t('选择仓库')}
          trigger={
            <button
              type="button"
              className="repo-picker__trigger"
              title={d.url || undefined}
              aria-label={t('仓库')}
            >
              {d.url ? (
                <>
                  <Icon name={repoIcon(d.url)} size={14} />
                  <span className="repo-picker__path">{repoPath(d.url)}</span>
                </>
              ) : (
                <span className="repo-picker__none">{t('不绑定 · 各 Bot 使用本机目录')}</span>
              )}
              {d.check === 'checking' ? <Spinner size={12} /> : null}
              <Icon name="chevron-updown" size={12} />
            </button>
          }
        >
          {(close) => (
            <RepoPanel
              bound={!!d.url}
              clearable={clearable}
              onPick={(o) => {
                choose(o)
                close()
              }}
              onClear={() => {
                choose({ url: '', branch: null, touched: false, from: null })
                close()
              }}
            />
          )}
        </Popover>
      </GroupRow>
      {d.url ? (
        <GroupRow label={t('基准分支')}>
          <ComboBox
            className="repo-picker__branch"
            aria-label={t('基准分支')}
            value={d.branch}
            placeholder="main"
            options={branches}
            onInput={(branch) => {
              branchTouched.current = true
              set({ branch })
            }}
            onChange={(branch) => {
              branchTouched.current = true
              set({ branch })
            }}
          />
        </GroupRow>
      ) : null}
    </>
  )
}

function RepoPanel({
  bound,
  clearable,
  onPick,
  onClear,
}: {
  bound: boolean
  clearable?: boolean
  onPick: (o: { url: string; branch: string | null; touched: boolean; from: Picked | null }) => void
  onClear: () => void
}) {
  const { accounts, load } = useGitAccounts()
  const openSettings = useSettings((s) => s.open)
  const usable = (accounts ?? []).filter((a) => a.status === 'ok')
  const [source, setSource] = useState(readSource)
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [active, setActive] = useState(0)
  const account = usable.find((a) => a.id === source)
  const from = account ? account.id : 'recent'

  // Fresh on every open: an account may have just been connected or marked invalid.
  useEffect(() => {
    load().catch(() => {})
  }, [load])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` retries the same request
  useEffect(() => {
    let current = true
    setError(null)
    const timer = setTimeout(async () => {
      try {
        const q = query.trim()
        const next = account
          ? (await gitAccountsApi.repos(account.id, q)).map((r: ProviderRepoDto) => ({
              key: r.url,
              icon: repoIcon(r.url, account.provider),
              url: r.url,
              title: r.fullName,
              detail: r.defaultBranch ?? '',
              locked: r.private,
              pick: () =>
                onPick({
                  url: r.url,
                  branch: r.defaultBranch,
                  touched: false,
                  from: { accountId: account.id, fullName: r.fullName },
                }),
            }))
          : (await api.get<RepoDto[]>(`/repos?q=${encodeURIComponent(q)}`)).map((r) => ({
              key: r.id,
              icon: repoIcon(r.url),
              url: r.url,
              title: repoPath(r.url),
              detail: [
                r.groups ? t('{n} 个群在用', { n: r.groups }) : null,
                r.lastBranch,
                r.localPaths.length ? t('本机已有') : null,
              ]
                .filter(Boolean)
                .join(' · '),
              pick: () => onPick({ url: r.url, branch: r.lastBranch, touched: !!r.lastBranch, from: null }),
            }))
        if (current) setRows(next)
      } catch (e) {
        if (!current) return
        setRows([])
        setError(e instanceof ApiError ? e.message : t('加载失败'))
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [from, query, reload])

  const typed = query.trim()
  const direct: Row | null = REPO_URL.test(typed)
    ? {
        key: `direct:${typed}`,
        icon: 'link',
        url: typed,
        title: t('使用地址 {url}', { url: typed }),
        detail: '',
        pick: () => onPick({ url: typed, branch: null, touched: false, from: null }),
      }
    : null
  const list = [...(direct ? [direct] : []), ...(rows ?? [])]
  const shown = Math.min(active, Math.max(0, list.length - 1))

  const sameHost = (host: string) => usable.filter((a) => accountLabel(a) === host).length > 1
  const sources = [
    { value: 'recent', label: t('最近') },
    ...usable.map((a) => {
      const label = accountLabel(a)
      return {
        value: a.id,
        icon: <Icon name={a.provider} size={12} />,
        label: sameHost(label) ? `${label} · ${a.login}` : label,
      }
    }),
  ]

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, Math.min(list.length - 1, shown + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter' && list[shown]) {
      e.preventDefault()
      list[shown].pick()
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys bubble up from the search field
    <div className="repo-panel" onKeyDown={onKey}>
      {sources.length > 1 ? (
        <SegmentedControl
          aria-label={t('来源')}
          size="small"
          items={sources}
          value={from}
          onChange={(v) => {
            setSource(v)
            saveSource(v)
            setRows(null)
            setActive(0)
          }}
        />
      ) : null}
      <SearchField
        aria-label={t('搜索仓库')}
        placeholder={t('搜索仓库，或粘贴地址')}
        value={query}
        onChange={(q) => {
          setQuery(q)
          setActive(0)
        }}
      />
      <div className="repo-panel__list" role="listbox" aria-label={t('仓库')}>
        {list.map((r, i) => (
          <div
            key={r.key}
            role="option"
            tabIndex={-1}
            aria-selected={i === shown}
            data-active={i === shown || undefined}
            className="ui-float__item repo-panel__row"
            title={r.url}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              r.pick()
            }}
          >
            <Icon name={r.icon} size={14} />
            <span className="ui-float__label">{r.title}</span>
            {r.locked ? <Icon name="lock" size={12} label={t('私有')} /> : null}
            <span className="ui-float__detail">{r.detail}</span>
          </div>
        ))}
        {rows === null && !direct ? (
          <div className="repo-panel__empty">
            <Spinner size={14} />
          </div>
        ) : error ? (
          <div className="repo-panel__empty repo-panel__empty--error">
            {error}
            <Button size="small" variant="plain" onClick={() => setReload((n) => n + 1)}>
              {t('重试')}
            </Button>
          </div>
        ) : !list.length ? (
          <div className="repo-panel__empty">{t('没有匹配的仓库')}</div>
        ) : null}
      </div>
      {!usable.length || (clearable && bound) ? (
        <div className="repo-panel__foot">
          {usable.length ? null : (
            <button type="button" className="repo-panel__action" onClick={() => openSettings('git')}>
              {t('连接 GitHub / GitLab 账号…')}
            </button>
          )}
          {clearable && bound ? (
            <button type="button" className="repo-panel__action" onClick={onClear}>
              {t('不绑定仓库')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
