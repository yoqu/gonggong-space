import { type InstallRequestReq, PERSONAL_BASE, type RepoDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Dialog, RadioGroup, SegmentedControl, Spinner, TextArea, toast } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { type Policy, VersionPolicy } from './InstallList'

type Kind = 'me' | 'group' | 'team' | 'repo'
interface Target {
  /** The install scope's API base, e.g. `/groups/:id`. */
  base: string
  label: string
  /** Set where I am not an admin: 申请引入 asks the admins of this scope instead. */
  ask?: Pick<InstallRequestReq, 'scope' | 'scopeId'>
}

/** Repos of every team I belong to, fetched once the dialog opens. */
function useRepos(teams: { id: string; name: string; role: string }[]) {
  const [repos, setRepos] = useState<Target[] | null>(null)
  const [error, setError] = useState('')
  const key = teams.map((x) => x.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the team list
  useEffect(() => {
    let live = true
    Promise.all(
      teams.map(async (team) =>
        (await api.get<RepoDto[]>(`/teams/${team.id}/repos`)).map(
          (r): Target => ({
            base: `/teams/${team.id}/repos/${r.id}`,
            label: `${team.name} / ${r.name}`,
            ask: team.role === 'member' ? { scope: 'repo', scopeId: r.id } : undefined,
          }),
        ),
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
 * following or pinning its version; for one I am only a member of, ask its admins (申请引入).
 */
export function InstallTargetDialog({
  listing,
  onClose,
}: {
  listing: {
    id: string
    type: 'plugin' | 'skill'
    title: string
    listedVersionId: string
    listedRevision: number
  }
  onClose: () => void
}) {
  const me = useSession((s) => s.user?.id)
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const groups = useWorkspace((s) => s.groups).filter((g) => g.kind === 'group')
  const { repos, error: reposError } = useRepos(teams)
  const [kind, setKind] = useState<Kind>('group')
  const [picked, setPicked] = useState<string | null>(null)
  const [policy, setPolicy] = useState<Policy>('follow')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const targets: Target[] | null =
    kind === 'me'
      ? [{ base: PERSONAL_BASE, label: t('我的个人') }]
      : kind === 'group'
        ? groups.map((g) => ({
            base: `/groups/${g.id}`,
            label: g.name,
            ask: isGroupAdmin(g, me) ? undefined : { scope: 'group', scopeId: g.id },
          }))
        : kind === 'team'
          ? teams.map((x) => ({
              base: `/teams/${x.id}`,
              label: x.name,
              ask: x.role === 'member' ? { scope: 'team', scopeId: x.id } : undefined,
            }))
          : repos
  const target = targets?.find((x) => x.base === picked)
  const ask = target?.ask
  const pinVersionId = policy === 'pin' ? listing.listedVersionId : null
  const submit = async () => {
    if (!target) return
    setBusy(true)
    setError('')
    try {
      if (ask) {
        const req: InstallRequestReq = { listingId: listing.id, ...ask, pinVersionId, note: note.trim() }
        await api.post('/install-requests', req)
        toast({ type: 'success', message: t('已向「{name}」的管理员提交引入申请', { name: target.label }) })
      } else {
        await api.put(`${target.base}/installs/${listing.id}`, { enabled: true, pinVersionId })
        toast({ type: 'success', message: t('已引入到「{name}」', { name: target.label }) })
      }
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
        {
          label: ask ? t('申请引入') : t('引入'),
          variant: 'primary',
          disabled: !target || busy,
          onClick: () => void submit(),
        },
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
        <div className="cfg__eyebrow">{t('你不是管理员的目标会向管理员提交引入申请')}</div>
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
      {ask ? (
        <TextArea
          label={t('申请说明')}
          aria-label={t('申请说明')}
          placeholder={t('为什么需要它（选填），管理员会看到')}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      ) : null}
    </Dialog>
  )
}
