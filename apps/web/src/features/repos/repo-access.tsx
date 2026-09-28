import type { BotProbeDto, GitProvider, RepoProbeRes } from '@gonggong/protocol'
import { cx } from '../../lib/cx'
import { Icon, type IconName } from '../../ui'

export interface RepoDraft {
  url: string
  branch: string
  check: 'checking' | RepoProbeRes | null
}

/** GitHub / GitLab mark by provider, else guessed from the URL's host; other hosts get the generic repo icon. */
export function repoIcon(url: string, provider?: GitProvider): IconName {
  if (provider) return provider
  const host = /^(?:[a-z]+:\/\/)?(?:[^@/\s]+@)?([^:/\s]+)/i.exec(url.trim())?.[1]?.toLowerCase() ?? ''
  return host.includes('github') ? 'github' : host.includes('gitlab') ? 'gitlab' : 'folder-git'
}

export const emptyRepo = (branch = 'main'): RepoDraft => ({ url: '', branch, check: null })

const settled = (d: RepoDraft) => (d.check && d.check !== 'checking' ? d.check : null)

/** Bots whose machine could not use the repo; they join paused (offline ones are checked when they come online). */
export const repoUnavailable = (d: RepoDraft) =>
  settled(d)?.results.filter((r) => !r.ok && r.reason !== 'offline' && r.reason !== 'branch_missing')
    .length ?? 0

export const branchMissing = (d: RepoDraft) =>
  !!settled(d)?.results.some((r) => r.reason === 'branch_missing')

/** Checked, and the branch exists: unreachable bots don't block binding, they are paused. */
export const repoValidated = (d: RepoDraft) => !!settled(d) && !branchMissing(d)

export const repoBody = (d: RepoDraft) => ({ url: d.url.trim(), branch: d.branch.trim() || 'main' })

export const RESULT: Record<
  NonNullable<BotProbeDto['reason']> | 'ok',
  { icon: IconName; text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }
> = {
  ok: { icon: 'checkmark-circle', text: '可访问', tone: 'ok' },
  denied: { icon: 'warning', text: '无权限 · 进群后暂停', tone: 'warn' },
  network: { icon: 'warning', text: '网络或证书 · 进群后暂停', tone: 'warn' },
  timeout: { icon: 'warning', text: '超时 · 进群后暂停', tone: 'warn' },
  branch_missing: { icon: 'xmark-circle', text: '分支不存在', tone: 'bad' },
  offline: { icon: 'moon', text: '离线 · 上线后验证', tone: 'muted' },
}

/** Badge for the URL a machine actually used; none for local (file://) repos. */
export const protocolOf = (url: string | null) =>
  url?.startsWith('http') ? 'HTTPS' : url?.startsWith('ssh://') || /^[^@/\s]+@/.test(url ?? '') ? 'SSH' : null

/** One bot's access check result, for the bot rows of the new-group form and the repo settings. */
export function AccessResult({ result }: { result: BotProbeDto }) {
  const v = RESULT[result.ok ? 'ok' : (result.reason ?? 'denied')]
  const proto = result.ok ? protocolOf(result.usedUrl) : null
  return (
    <span className={cx('repo-access', `repo-access--${v.tone}`)} title={result.detail ?? undefined}>
      <Icon name={v.icon} size={13} />
      {proto ? `${v.text} · ${proto}` : v.text}
    </span>
  )
}

/** 「2 个 Bot 可访问 · 1 个进群后暂停」 */
export function checkSummary(d: RepoDraft) {
  const c = settled(d)
  if (!c) return null
  if (!c.results.length) return '没有可检查的 Bot · 进群后由各 Bot 的机器验证'
  const count = (f: (r: BotProbeDto) => boolean) => c.results.filter(f).length
  const ok = count((r) => r.ok)
  const paused = repoUnavailable(d)
  const offline = count((r) => r.reason === 'offline')
  return [
    branchMissing(d) ? `分支 ${d.branch.trim() || 'main'} 不存在` : null,
    ok ? `${ok} 个 Bot 可访问` : null,
    paused ? `${paused} 个进群后暂停` : null,
    offline ? `${offline} 个离线` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
