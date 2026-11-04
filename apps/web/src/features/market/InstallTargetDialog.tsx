import { type MarketListingDto, PERSONAL_BASE, type RepoDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Dialog, RadioGroup, SegmentedControl, Spinner, toast } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { type Policy, VersionPolicy } from './InstallList'

type Kind = 'me' | 'group' | 'team' | 'repo'
interface Target {
  /** The install scope's API base, e.g. `/groups/:id`. */
  base: string
  label: string
}

/** Repos of every team I administer, fetched once the dialog opens. */
function useAdminRepos(teams: { id: string; name: string }[]) {
  const [repos, setRepos] = useState<Target[] | null>(null)
  const [error, setError] = useState('')
  const key = teams.map((x) => x.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the team list
  useEffect(() => {
    let live = true
    Promise.all(
      teams.map(async (team) =>
        (await api.get<RepoDto[]>(`/teams/${team.id}/repos`)).map((r) => ({
          base: `/teams/${team.id}/repos/${r.id}`,
          label: `${team.name} / ${r.name}`,
        })),
      ),
    ).then(
      (all) => live && setRepos(all.flat()),
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [key])
  return { repos, error }
}

/**
 * 引入到…: install a market listing into my personal layer (skills only) or a group, team or repo I administer,
 * following or pinning its version.
 */
export function InstallTargetDialog({
  listing,
  onClose,
}: {
  listing: Pick<MarketListingDto, 'id' | 'type' | 'title' | 'listedVersionId' | 'listedRevision'>
  onClose: () => void
}) {
  const me = useSession((s) => s.user?.id)
  const adminTeams = (useSession((s) => s.tenancy?.teams) ?? []).filter((x) => x.role !== 'member')
  const groups = useWorkspace((s) => s.groups).filter((g) => g.kind === 'group' && isGroupAdmin(g, me))
  const { repos, error: reposError } = useAdminRepos(adminTeams)
  const [kind, setKind] = useState<Kind>('group')
  const [picked, setPicked] = useState<string | null>(null)
  const [policy, setPolicy] = useState<Policy>('follow')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const targets: Target[] | null =
    kind === 'me'
      ? [{ base: PERSONAL_BASE, label: t('我的个人') }]
      : kind === 'group'
        ? groups.map((g) => ({ base: `/groups/${g.id}`, label: g.name }))
        : kind === 'team'
          ? adminTeams.map((x) => ({ base: `/teams/${x.id}`, label: x.name }))
          : repos
  const target = targets?.find((x) => x.base === picked)
  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError('')
    try {
      await api.put(`${target.base}/installs/${listing.id}`, {
        enabled: true,
        pinVersionId: policy === 'pin' ? listing.listedVersionId : null,
      })
      toast({ type: 'success', message: t('已引入到「{name}」', { name: target.label }) })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('引入「{name}」', { name: listing.title })}
      width={520}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        { label: t('引入'), variant: 'primary', disabled: !target || busy, onClick: () => void submit() },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <SegmentedControl<Kind>
        aria-label={t('引入到')}
        value={kind}
        onChange={(k) => {
          setKind(k)
          setPicked(k === 'me' ? PERSONAL_BASE : null)
        }}
        items={[
          { value: 'me', label: t('我的个人'), disabled: listing.type === 'plugin' },
          { value: 'group', label: t('群') },
          { value: 'team', label: t('团队') },
          { value: 'repo', label: t('仓库') },
        ]}
      />
      {listing.type === 'plugin' ? <div className="gs-note">{t('插件不能引入到个人')}</div> : null}
      {kind === 'me' ? (
        <div className="gs-note">
          {t('只在你发起的运行里生效，跟着你进入所有群；优先级高于群、仓库、团队的同名 Skill。')}
        </div>
      ) : (
        <div className="cfg__eyebrow">{t('只列出你是管理员的群与团队')}</div>
      )}
      {kind === 'me' ? null : kind === 'repo' && reposError ? (
        <Alert variant="error" title={reposError} />
      ) : !targets ? (
        <Spinner />
      ) : targets.length ? (
        <RadioGroup
          aria-label={t('目标')}
          value={picked ?? undefined}
          onChange={setPicked}
          options={targets.map((x) => ({ value: x.base, label: x.label }))}
        />
      ) : (
        <div className="gs-note">{t('没有可引入的目标')}</div>
      )}
      <VersionPolicy value={policy} onChange={setPolicy} revision={listing.listedRevision} />
    </Dialog>
  )
}
