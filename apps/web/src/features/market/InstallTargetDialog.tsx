import {
  type InstallDto,
  type InstalledTarget,
  type InstallRequestReq,
  type InstallScope,
  type MarketSource,
  PERSONAL_BASE,
  type PluginCategory,
  type PluginPermission,
  type RepoDto,
  type RequestedTarget,
  type ReusedSecretDto,
  type SecretRequirement,
  type TargetRef,
} from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { Alert, Dialog, Disclosure, Icon, paletteColor, Spinner, Tag, TextArea, toast } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { InstallReadyStep } from './InstallReadyStep'
import { ListingIcon, SOURCE_LABEL } from './meta'
import './market-detail.css'

interface ScopeOption {
  scope: InstallScope
  base: string
  scopeId: string
  label: string
  description: string
  isCurrentGroup?: boolean
  ask?: Pick<InstallRequestReq, 'scope' | 'scopeId'>
}

function useTeamRepos(teams: { id: string; name: string; role: string }[], enabled: boolean) {
  const [repos, setRepos] = useState<ScopeOption[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const key = teams.map((x) => x.id).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for team list, `tick` retries
  useEffect(() => {
    if (!enabled) return
    let live = true
    setLoading(true)
    Promise.all(
      teams.map(async (team) =>
        (await api.get<RepoDto[]>(`/teams/${team.id}/repos`)).map(
          (r): ScopeOption => ({
            scope: 'repo',
            base: `/teams/${team.id}/repos/${r.id}`,
            scopeId: r.id,
            label: `${team.name} / ${r.name}`,
            description:
              team.role === 'member'
                ? t('你是普通成员，需要团队管理员同意')
                : t('只在这个仓库里工作的群默认可用'),
            ask: team.role === 'member' ? { scope: 'repo', scopeId: r.id } : undefined,
          }),
        ),
      ),
    )
      .then(
        (all) => {
          if (!live) return
          setRepos(all.flat())
          setError('')
        },
        (e) => live && setError(errorText(e)),
      )
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [enabled, key, tick])
  return { repos, error, loading, reload: () => setTick((n) => n + 1) }
}

export interface InstallableListingInput {
  id: string
  type: 'plugin' | 'skill'
  name: string
  title: string
  versionId?: string
  icon?: string | null
  category?: PluginCategory | null
  source?: MarketSource
  teamName?: string | null
  listedVersionId: string
  listedRevision: number
  installedIn?: InstalledTarget[]
  requestedIn?: RequestedTarget[]
  nameTakenIn?: TargetRef[]
  secretSpecs?: SecretRequirement[]
  permissions?: PluginPermission[]
  examples?: string[]
}

/**
 * 2-step Add & Readiness Modal:
 * Step 1: smart scope list (personal only when supported, default source group, collapsed admin scopes,
 * auto-pin exec plugins with plain explanation, switch CTA to 提交申请 for non-admin scopes).
 * Step 2: in-place readiness checklist (secrets, CLI connector auth, local machine exec trust, try prompts).
 */
export function InstallTargetDialog({
  listing,
  sourceGroupId,
  initialReadyTarget,
  onClose,
  onChanged,
  onReusedSecrets,
  onGoInstalled,
}: {
  listing: InstallableListingInput
  sourceGroupId?: string
  /** Open straight into Step 2 for an already-installed target (from 去配置). */
  initialReadyTarget?: { scope: InstallScope; scopeId: string; label: string }
  onClose: () => void
  onChanged?: () => void
  onReusedSecrets?: (items: ReusedSecretDto[]) => void
  onGoInstalled?: () => void
}) {
  const me = useSession((s) => s.user?.id)
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const groups = useWorkspace((s) => s.groups).filter((g) => g.kind === 'group')

  const [moreOpen, setMoreOpen] = useState(false)
  const {
    repos,
    error: reposError,
    loading: reposLoading,
    reload: reloadRepos,
  } = useTeamRepos(teams, moreOpen)

  const keyOf = (scope: InstallScope, scopeId: string) => `${scope}:${scopeId}`
  const installed = new Set(listing.installedIn?.map((x) => keyOf(x.scope, x.scopeId)))
  const taken = new Set(listing.nameTakenIn?.map((x) => keyOf(x.scope, x.scopeId)))
  const requested = new Map(listing.requestedIn?.map((x) => [keyOf(x.scope, x.scopeId), x]))

  const isBlocked = (x: ScopeOption) => {
    const k = keyOf(x.scope, x.scopeId)
    return installed.has(k) || taken.has(k) || (!!x.ask && requested.has(k))
  }

  const supportsPersonal = listing.type === 'skill'
  const personalOption: ScopeOption | null = supportsPersonal
    ? {
        scope: 'user',
        base: PERSONAL_BASE,
        scopeId: me ?? '',
        label: t('仅我使用'),
        description: installed.has(keyOf('user', me ?? ''))
          ? t('已经添加过')
          : taken.has(keyOf('user', me ?? ''))
            ? t('已有同名插件，请先在设置中移除')
            : t('随你进入所有群，免审批，仅你 @ Bot 时生效'),
      }
    : null

  const groupOptions: ScopeOption[] = groups
    .map((g): ScopeOption => {
      const admin = isGroupAdmin(g, me)
      const k = keyOf('group', g.id)
      return {
        scope: 'group',
        base: `/groups/${g.id}`,
        scopeId: g.id,
        label: g.name,
        description: installed.has(k)
          ? t('已经添加过')
          : taken.has(k)
            ? t('已有同名插件，请先在设置中移除')
            : !admin
              ? t('你是普通成员，需要群管理员同意')
              : t('群里所有 Bot 都能用'),
        isCurrentGroup: g.id === sourceGroupId,
        ask: admin ? undefined : { scope: 'group', scopeId: g.id },
      }
    })
    .sort((a, b) => Number(!!b.isCurrentGroup) - Number(!!a.isCurrentGroup))

  const teamOptions: ScopeOption[] = teams.map((x) => ({
    scope: 'team',
    base: `/teams/${x.id}`,
    scopeId: x.id,
    label: x.name,
    description:
      x.role === 'member'
        ? t('你是普通成员，需要团队管理员同意')
        : t('团队所有群默认可用，群管理员可单独关闭'),
    ask: x.role === 'member' ? { scope: 'team', scopeId: x.id } : undefined,
  }))

  const primaryOptions: ScopeOption[] = [...(personalOption ? [personalOption] : []), ...groupOptions]
  const allOptions: ScopeOption[] = [...primaryOptions, ...teamOptions, ...(repos ?? [])]

  const defaultPick = (): string | null => {
    if (sourceGroupId) {
      const src = groupOptions.find((g) => g.scopeId === sourceGroupId && !isBlocked(g))
      if (src) return src.base
    }
    const first = primaryOptions.find((o) => !isBlocked(o))
    return first?.base ?? null
  }

  const [picked, setPicked] = useState<string | null>(() => defaultPick())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readyTarget, setReadyTarget] = useState<{
    scope: InstallScope
    scopeId: string
    label: string
  } | null>(initialReadyTarget ?? null)

  const target = allOptions.find((x) => x.base === picked) ?? null
  const blocked = !!target && isBlocked(target)
  const ask = target?.ask
  const isExec = !!listing.permissions?.includes('exec')
  const pinVersionId = isExec ? listing.listedVersionId : null

  const submit = async () => {
    if (!target || blocked || busy) return
    setBusy(true)
    setError('')
    try {
      if (ask) {
        const req: InstallRequestReq = {
          listingId: listing.id,
          ...ask,
          pinVersionId,
          note: note.trim(),
        }
        await api.post('/install-requests', req)
        toast({ type: 'success', message: t('已向「{name}」的管理员提交添加申请', { name: target.label }) })
        onChanged?.()
        onClose()
        return
      }
      const res = await api.put<InstallDto>(`${target.base}/installs/${listing.id}`, {
        enabled: true,
        pinVersionId,
      })
      if (res?.reusedSecrets?.length) onReusedSecrets?.(res.reusedSecrets)
      onChanged?.()
      setBusy(false)
      setReadyTarget({ scope: target.scope, scopeId: target.scopeId, label: target.label })
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const close = () => {
    if (!busy) onClose()
  }

  const step = readyTarget ? 2 : 1
  const sourceText = listing.teamName || (listing.source ? SOURCE_LABEL[listing.source] : '')

  const renderOption = (x: ScopeOption) => {
    const k = keyOf(x.scope, x.scopeId)
    const dis = isBlocked(x)
    const checked = picked === x.base
    const req = requested.get(k)
    const iconName =
      x.scope === 'user'
        ? 'person'
        : x.scope === 'group'
          ? 'hashtag'
          : x.scope === 'team'
            ? 'person-2'
            : 'folder-git'
    return (
      <label
        key={x.base}
        className={`mkt-scope-opt${checked ? ' mkt-scope-opt--selected' : ''}${dis ? ' mkt-scope-opt--disabled' : ''}`}
      >
        <input
          type="radio"
          name="mkt-install-target"
          checked={checked}
          disabled={dis || busy}
          onChange={() => {
            setPicked(x.base)
            setError('')
          }}
        />
        <span className="mkt-scope-opt__av" style={{ background: paletteColor(x.label) }} aria-hidden="true">
          <Icon name={iconName} size={14} />
        </span>
        <span className="mkt-scope-opt__text">
          <span className="mkt-scope-opt__title">{x.label}</span>
          <small className="mkt-scope-opt__sub">{x.description}</small>
        </span>
        {installed.has(k) ? (
          <Tag tone="green">{t('已添加')}</Tag>
        ) : taken.has(k) ? (
          <Tag tone="red">{t('同名冲突')}</Tag>
        ) : req ? (
          <Tag tone="blue">{req.mine ? t('你已申请') : t('已申请')}</Tag>
        ) : x.isCurrentGroup ? (
          <Tag tone="blue">{t('当前群')}</Tag>
        ) : x.ask ? (
          <Tag tone="gray">{t('需申请')}</Tag>
        ) : null}
      </label>
    )
  }

  return (
    <Dialog
      open
      aria-label={t('添加「{name}」', { name: listing.title })}
      title={
        <div className="mkt-modal-head">
          <ListingIcon
            type={listing.type}
            size={36}
            listing={{
              id: listing.id,
              versionId: listing.versionId ?? listing.listedVersionId,
              icon: listing.icon,
              name: listing.name,
              category: listing.category,
            }}
          />
          <div>
            <div>{t('添加 {name}', { name: listing.title })}</div>
            <div className="mkt-modal-head__sub">
              {readyTarget
                ? readyTarget.label
                : [sourceText, `r${listing.listedRevision}`].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      }
      width={520}
      closeOnScrim={false}
      onClose={busy ? () => {} : onClose}
      actions={
        step === 1
          ? [
              { label: t('取消'), disabled: busy, onClick: close },
              {
                label: ask ? t('提交申请') : t('添加'),
                variant: 'primary',
                disabled: !target || blocked || busy,
                loading: busy,
                onClick: () => void submit(),
              },
            ]
          : undefined
      }
    >
      <nav className="mkt-steps" aria-label={t('添加步骤')}>
        <span className={`mkt-steps__step ${step === 1 ? 'mkt-steps__step--on' : 'mkt-steps__step--done'}`}>
          <span className="mkt-steps__num">
            {step > 1 ? <Icon name="check" size={12} weight={2} /> : '1'}
          </span>
          {t('添加到哪里')}
        </span>
        <span className="mkt-steps__line" aria-hidden="true" />
        <span className={`mkt-steps__step ${step === 2 ? 'mkt-steps__step--on' : ''}`}>
          <span className="mkt-steps__num">2</span>
          {t('完成准备')}
        </span>
      </nav>

      {readyTarget ? (
        <InstallReadyStep
          listingId={listing.id}
          listingTitle={listing.title}
          scope={readyTarget.scope}
          scopeId={readyTarget.scopeId}
          targetLabel={readyTarget.label}
          fallbackExamples={listing.examples}
          onDone={onClose}
          onGoInstalled={onGoInstalled}
          onChanged={onChanged}
          onReusedSecrets={onReusedSecrets}
        />
      ) : (
        <>
          {error ? <Alert variant="error" title={error} /> : null}
          <div className="cfg__eyebrow">{t('给谁用？')}</div>
          {primaryOptions.length ? (
            <div className="mkt-scope-group" role="radiogroup" aria-label={t('添加位置')}>
              {primaryOptions.map(renderOption)}
            </div>
          ) : (
            <div className="gs-note">{t('你还没有加入群聊，可在下方展开团队范围。')}</div>
          )}

          {ask ? (
            <TextArea
              label={t('申请说明')}
              aria-label={t('申请说明')}
              placeholder={t('说一句为什么需要（选填），会发给群管理员')}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          ) : null}

          {teams.length ? (
            <Disclosure
              variant="group"
              title={t('更多范围（管理员）')}
              open={moreOpen}
              onToggle={setMoreOpen}
            >
              <div className="mkt-scope-group">
                {teamOptions.map(renderOption)}
                {reposError ? (
                  <Alert variant="error" title={reposError} retrying={reposLoading} onRetry={reloadRepos} />
                ) : reposLoading && !repos ? (
                  <Spinner />
                ) : (
                  (repos ?? []).map(renderOption)
                )}
              </div>
            </Disclosure>
          ) : null}

          {isExec ? (
            <div className="mkt-hint mkt-hint--lock">
              <Icon name="shield-check" size={15} />
              <span>
                {t(
                  '该插件会在电脑上运行本地检查程序，为确保安全，系统将自动固定在当前已审核版本 r{n}，后续升级需重新确认。',
                  { n: listing.listedRevision },
                )}
              </span>
            </div>
          ) : (
            <div className="mkt-hint">
              <Icon name="arrow-clockwise" size={15} />
              <span>{t('会自动保持最新版本，系统也会自动补齐所需凭据项，无需手动配置。')}</span>
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}
