import {
  type InstalledTarget,
  type InstallRequestReq,
  PERSONAL_BASE,
  type RepoDto,
  type RequestedTarget,
  type TargetRef,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Dialog, RadioGroup, SegmentedControl, Spinner, Tag, TextArea, toast } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { type Policy, VersionPolicy } from './InstallList'

type Kind = 'me' | 'group' | 'team' | 'repo'
interface Target {
  /** The install scope's API base, e.g. `/groups/:id`. */
  base: string
  /** The install scope's id, to tell where the listing already is. */
  scopeId: string
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
            scopeId: r.id,
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
  onInstalled,
}: {
  listing: {
    id: string
    type: 'plugin' | 'skill'
    name: string
    title: string
    listedVersionId: string
    listedRevision: number
    installedIn?: InstalledTarget[]
    requestedIn?: RequestedTarget[]
    nameTakenIn?: TargetRef[]
  }
  onClose: () => void
  /** A direct install went through (a request changes nothing yet). */
  onInstalled?: () => void
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
      ? [{ base: PERSONAL_BASE, scopeId: me ?? '', label: t('我的 Skill') }]
      : kind === 'group'
        ? groups.map((g) => ({
            base: `/groups/${g.id}`,
            scopeId: g.id,
            label: g.name,
            ask: isGroupAdmin(g, me) ? undefined : { scope: 'group', scopeId: g.id },
          }))
        : kind === 'team'
          ? teams.map((x) => ({
              base: `/teams/${x.id}`,
              scopeId: x.id,
              label: x.name,
              ask: x.role === 'member' ? { scope: 'team', scopeId: x.id } : undefined,
            }))
          : repos
  const installed = new Set(listing.installedIn?.map((x) => x.scopeId))
  const taken = new Set(listing.nameTakenIn?.map((x) => x.scopeId))
  const requested = new Map(listing.requestedIn?.map((x) => [x.scopeId, x]))
  /** Why the target can't take it: installed, a same-named skill, or a request already waiting there. */
  const blocked = (x: Target) =>
    installed.has(x.scopeId) || taken.has(x.scopeId) || (!!x.ask && requested.has(x.scopeId))
  const target = targets?.find((x) => x.base === picked)
  const there = !!target && blocked(target)
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
        onInstalled?.()
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
          disabled: !target || there || busy,
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
          { value: 'me', label: t('我的 Skill'), disabled: listing.type === 'plugin' },
          { value: 'group', label: t('群') },
          { value: 'team', label: t('团队') },
          { value: 'repo', label: t('仓库') },
        ]}
      />
      {listing.type === 'plugin' ? <div className="gs-note">{t('插件不能引入到个人')}</div> : null}
      {kind === 'me' ? (
        <div className="gs-note">
          {installed.has(me ?? '')
            ? t('已经引入到这里了')
            : taken.has(me ?? '')
              ? t('你的个人 Skill 里已有同名的「{name}」，先在「设置 · 我的 Skill」里移除它', {
                  name: listing.name,
                })
              : t('只在你发起的运行里生效，跟着你进入所有群；优先级高于群、仓库、团队的同名 Skill。')}
        </div>
      ) : kind === 'repo' && reposError ? (
        <Alert variant="error" title={reposError} />
      ) : !targets ? (
        <Spinner />
      ) : targets.length ? (
        <>
          <div className="cfg__eyebrow">{t('目标')}</div>
          <div className="mkt-targets">
            <RadioGroup
              aria-label={t('目标')}
              value={picked ?? undefined}
              onChange={setPicked}
              options={targets.map((x) => ({
                value: x.base,
                disabled: blocked(x),
                label: (
                  <>
                    {x.label}
                    <TargetTag
                      installed={installed.has(x.scopeId)}
                      taken={taken.has(x.scopeId)}
                      request={requested.get(x.scopeId)}
                      ask={!!x.ask}
                    />
                  </>
                ),
              }))}
            />
          </div>
          {targets.some((x) => taken.has(x.scopeId)) ? (
            <div className="gs-note">
              {t('标「同名冲突」的目标里已有同名的 Skill「{name}」，先在那里的设置中移除它再引入。', {
                name: listing.name,
              })}
            </div>
          ) : null}
          {targets.some((x) => x.ask && requested.has(x.scopeId)) ? (
            <div className="gs-note">
              {t('标「已申请」的目标已有待处理的申请，等管理员处理即可；你的申请可在「引入申请」里撤回。')}
            </div>
          ) : null}
          {targets.some((x) => x.ask && !blocked(x)) ? (
            <div className="gs-note">{t('标「需申请」的目标你不是管理员，引入会先提交给管理员审批。')}</div>
          ) : null}
        </>
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

function TargetTag({
  installed,
  taken,
  request,
  ask,
}: {
  installed: boolean
  taken: boolean
  request?: RequestedTarget
  ask: boolean
}) {
  const tag = installed ? (
    <Tag tone="green">{t('已引入')}</Tag>
  ) : taken ? (
    <Tag tone="red">{t('同名冲突')}</Tag>
  ) : request ? (
    <span title={t('{name} 已申请，等管理员处理', { name: request.requester })}>
      <Tag tone="blue">
        {request.mine ? t('你已申请') : ask ? t('已申请') : t('{name} 申请中', { name: request.requester })}
      </Tag>
    </span>
  ) : ask ? (
    <Tag tone="orange">{t('需申请')}</Tag>
  ) : null
  return tag ? (
    <span className="mkt-targets__ask" aria-hidden="true">
      {tag}
    </span>
  ) : null
}
