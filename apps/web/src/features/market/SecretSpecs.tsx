import {
  SECRET_MIN_LENGTH,
  type SecretDto,
  type SecretMode,
  type SecretRequirement,
  type SecretScope,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { ApiError } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Checkbox,
  GroupBox,
  GroupRow,
  Link,
  RadioGroup,
  SecureField,
  Spinner,
  Tag,
  TextField,
} from '../../ui'
import { MODE_LABEL, SCOPE_LABEL, secretsApi } from '../secrets/api'

const MODES: SecretMode[] = ['personal', 'shared', 'shared_overridable']

const hostOf = (url: string) => new URL(url).host

/** Title, name, 必需/可选 and the suggested mode of one declared secret. */
function SpecLabel({ spec }: { spec: SecretRequirement }) {
  return (
    <span className="cfg__name-line">
      <span className="cfg__name">{spec.title ?? spec.name}</span>
      {spec.title ? <code className="gs-mono">{spec.name}</code> : null}
      <Tag tone={spec.required ? 'orange' : 'gray'}>{spec.required ? t('必需') : t('可选')}</Tag>
      <Tag tone="gray">{t('建议：{mode}', { mode: MODE_LABEL[spec.mode] })}</Tag>
    </span>
  )
}

const ApplyLink = ({ url }: { url: string }) => (
  <Link external href={url}>
    {t('前往 {host} 申请', { host: hostOf(url) })}
  </Link>
)

/** 需要的密钥 in a listing's detail: what its shown version declares. */
export function SecretSpecList({ specs }: { specs: SecretRequirement[] }) {
  return (
    <section className="mkt-detail__section" aria-label={t('需要的密钥')}>
      <div className="cfg__eyebrow">
        {t('需要的密钥')} <span className="mkt-detail__n">{specs.length}</span>
      </div>
      <GroupBox>
        {specs.map((s) => (
          <GroupRow
            key={s.name}
            label={<SpecLabel spec={s} />}
            description={
              <>
                {s.description ? <div>{s.description}</div> : null}
                {s.url ? <ApplyLink url={s.url} /> : null}
              </>
            }
          />
        ))}
      </GroupBox>
      <div className="gs-note">
        {t('名称是脚本读取的环境变量名，不能改。由发布者声明，引入时可建好定义。')}
      </div>
    </section>
  )
}

/** create: make a definition here; reuse: the one already there (or above); skip: neither; cancel: don't install. */
type Action = 'create' | 'reuse' | 'skip' | 'cancel'
interface Choice {
  action: Action
  description: string
  mode: SecretMode
  value: string
}
interface Item {
  spec: SecretRequirement
  /** Where a new definition goes: per-member ones in the team, whatever the install target (plan §5). */
  layer: SecretScope
  /** Whether I may make it there: a group admin may not administer the team. */
  canCreate: boolean
  /** A same-named definition on the target layer. */
  own?: SecretDto
  /** …or above it (a group install over a team or platform one). */
  upper?: SecretDto
  choice: Choice
}

/** The secrets endpoint of the layer an install under `base` makes its definitions in: a repo's are its team's. */
export const secretsBaseOf = (base: string) =>
  base.startsWith('/groups/') || base.startsWith('/teams/')
    ? `${base.replace(/\/repos\/[^/]+$/, '')}/secrets`
    : null

const layerOf = (secretsBase: string): SecretScope => (secretsBase.startsWith('/groups/') ? 'group' : 'team')

const RANK: Record<SecretScope, number> = { platform: 0, team: 1, group: 2 }

const differs = (spec: SecretRequirement, def: SecretDto) =>
  def.mode !== spec.mode ||
  def.description.trim() !== [spec.title, spec.description].filter(Boolean).join('：')

/**
 * The declared secrets against the target layer's definitions (plan Skill密钥声明 §5), and what to make there once the
 * install went through. `secretsBase` null (personal installs, requests) leaves it all out.
 */
export function useSecretPlan(specs: SecretRequirement[], secretsBase: string | null, teamId: string | null) {
  const base = specs.length ? secretsBase : null
  const { data, error } = useGet<SecretDto[]>(base)
  const [edits, setEdits] = useState<Record<string, Partial<Choice>>>({})
  const sysadmin = useSession((s) => s.user?.role === 'sysadmin')
  const teamAdmin = useSession(
    (s) => sysadmin || !!s.tenancy?.teams.some((x) => x.id === teamId && x.role !== 'member'),
  )
  const layer = base ? layerOf(base) : 'team'
  const layerFor = (mode: SecretMode): SecretScope => (mode === 'personal' ? 'team' : layer)
  const items: Item[] | null =
    base && data
      ? specs.map((spec) => {
          const target = layerFor(spec.mode)
          // The nearest same-named definition: at or below where a new one would go it is shared, above it reused.
          const near = data
            .filter((s) => s.name === spec.name)
            .sort((a, b) => RANK[b.scope] - RANK[a.scope])[0]
          const own = near && RANK[near.scope] >= RANK[target] ? near : undefined
          const upper = own ? undefined : near
          const canCreate = target === layer || teamAdmin
          const choice: Choice = {
            action: own || upper ? 'reuse' : canCreate ? 'create' : 'skip',
            description: [spec.title, spec.description].filter(Boolean).join('：'),
            mode: spec.mode,
            value: '',
            ...edits[`${base}|${spec.name}`],
          }
          return { spec, layer: target, canCreate, own, upper, choice }
        })
      : null
  const set = (name: string, c: Partial<Choice>) =>
    setEdits((e) => ({ ...e, [`${base}|${name}`]: { ...e[`${base}|${name}`], ...c } }))
  const creating = items?.filter((i) => i.choice.action === 'create') ?? []
  const short = creating.find(
    (i) => i.choice.mode !== 'personal' && i.choice.value && i.choice.value.length < SECRET_MIN_LENGTH,
  )
  /** Makes the chosen definitions; one made meanwhile (409) is the one to use. A failure is toasted. */
  const apply = async () => {
    if (!base) return
    for (const { spec, choice } of creating) {
      const shared = choice.mode !== 'personal' && choice.value
      const where = layerFor(choice.mode) === layer || !teamId ? base : `/teams/${teamId}/secrets`
      try {
        await secretsApi.create(where, {
          name: spec.name,
          description: choice.description.trim(),
          mode: choice.mode,
          botIds: null,
          enabled: true,
          expiresAt: null,
          ...(shared ? { value: choice.value } : {}),
        })
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) toastError(e)
      }
    }
  }
  return {
    base,
    layer,
    layerFor,
    items,
    error,
    set,
    loading: !!base && !data && !error,
    cancelled: !!items?.some((i) => i.choice.action === 'cancel'),
    invalid: short ? t('{name} 的统一值至少 8 个字符', { name: short.spec.name }) : '',
    apply,
  }
}

export type SecretPlan = ReturnType<typeof useSecretPlan>

/** 需要的密钥 in an install dialog: each declared secret, the target layer's state and what to do about it. */
export function InstallSecrets({ plan }: { plan: SecretPlan }) {
  if (!plan.base) return null
  return (
    <section className="mkt-secrets" aria-label={t('需要的密钥')}>
      <div className="cfg__eyebrow">{t('需要的密钥')}</div>
      {plan.error ? (
        <Alert variant="error" title={t('密钥加载失败')} description={plan.error} />
      ) : !plan.items ? (
        <Spinner />
      ) : (
        plan.items.map(({ spec, own, upper, choice, canCreate }) => {
          const def = own ?? upper
          const above = upper ? SCOPE_LABEL[upper.scope] : ''
          const set = (c: Partial<Choice>) => plan.set(spec.name, c)
          const inGroup = plan.layerFor(choice.mode) === 'group'
          return (
            <div key={spec.name} className="mkt-secret">
              <SpecLabel spec={spec} />
              {def ? (
                <>
                  <div className="mkt-secret__compare">
                    <div>
                      <div className="cfg__hint">{t('声明')}</div>
                      <div>{[spec.title, spec.description].filter(Boolean).join('：') || '—'}</div>
                      <div className="cfg__hint">{MODE_LABEL[spec.mode]}</div>
                    </div>
                    <div>
                      <div className="cfg__hint">
                        {t('{layer}现有定义', { layer: SCOPE_LABEL[def.scope] })}
                      </div>
                      <div>{def.description || '—'}</div>
                      <div className="cfg__hint">{MODE_LABEL[def.mode]}</div>
                    </div>
                  </div>
                  {differs(spec, def) ? <div className="cfg__danger">{t('用途可能不一致')}</div> : null}
                  <RadioGroup<Action>
                    aria-label={t('{name} 的处理', { name: spec.name })}
                    value={choice.action}
                    onChange={(action) => set({ action })}
                    options={
                      own
                        ? [
                            { value: 'reuse', label: t('共用现有定义（说明和模式不变）') },
                            { value: 'cancel', label: t('取消引入') },
                          ]
                        : [
                            {
                              value: 'reuse',
                              label: t('复用{layer}现有定义', { layer: above }),
                            },
                            ...(canCreate
                              ? [
                                  {
                                    value: 'create' as const,
                                    label: inGroup
                                      ? t('在本群新建同名定义（仅本群生效，覆盖{layer}）', {
                                          layer: above,
                                        })
                                      : t('在本团队新建同名定义（仅本团队生效，覆盖{layer}）', {
                                          layer: above,
                                        }),
                                  },
                                ]
                              : []),
                          ]
                    }
                  />
                </>
              ) : canCreate ? (
                <Checkbox
                  label={inGroup ? t('在本群创建定义') : t('在本团队创建定义')}
                  checked={choice.action === 'create'}
                  onChange={(on) => set({ action: on ? 'create' : 'skip' })}
                />
              ) : (
                <div className="cfg__hint">
                  {t(
                    '每人自填的密钥建在团队层，一个团队只建一次；需团队管理员创建，成员用到时会提醒团队管理员。',
                  )}
                </div>
              )}
              {choice.action === 'create' ? (
                <div className="mkt-secret__form">
                  <TextField
                    multiline
                    rows={2}
                    maxLength={500}
                    aria-label={t('{name} 的用途', { name: spec.name })}
                    placeholder={t('用途')}
                    value={choice.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                  <RadioGroup<SecretMode>
                    aria-label={t('{name} 的模式', { name: spec.name })}
                    direction="row"
                    value={choice.mode}
                    onChange={(mode) => set({ mode })}
                    options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
                  />
                  {choice.mode === 'personal' ? null : (
                    <SecureField
                      aria-label={t('{name} 的统一值', { name: spec.name })}
                      autoComplete="new-password"
                      placeholder={spec.placeholder ?? t('统一值，可稍后填写')}
                      value={choice.value}
                      onChange={(e) => set({ value: e.target.value })}
                    />
                  )}
                </div>
              ) : null}
              {spec.url ? <ApplyLink url={spec.url} /> : null}
            </div>
          )
        })
      )}
    </section>
  )
}

/** Required secrets `to` declares that `from` did not require: what an upgrade leaves without a value. */
export const newlyRequired = (from: SecretRequirement[], to: SecretRequirement[]) =>
  to.filter((s) => s.required && !from.some((f) => f.name === s.name && f.required)).map((s) => s.name)
