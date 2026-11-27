import type {
  BotCapabilitiesDto,
  BotCapabilityItemDto,
  BotDto,
  SecretNeedDto,
  UserDto,
} from '@gonggong/protocol'
import { useEffect, useMemo, useState } from 'react'
import { Link, useInRouterContext, useNavigate, useSearchParams } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  GroupBox,
  Icon,
  type IconName,
  Presence,
  SegmentedControl,
  Select,
  Skeleton,
  Tag,
  toast,
} from '../../ui'
import { previewUrl } from '../plugins/model'
import { NeedsDialog } from '../secrets/SecretNeeds'

function sceneIcon(item: BotCapabilityItemDto): IconName {
  if (item.scene === 'connect' || item.capabilities.includes('connect')) return 'link'
  if (item.scene === 'create' || item.createsArtifacts) return 'sparkle'
  if (item.scene === 'dev') return 'terminal'
  if (item.scene === 'office') return 'doc-text'
  return 'plug'
}

function CapIcon({ item }: { item: BotCapabilityItemDto }) {
  if (item.icon) {
    const src = /^(https?:|\/|data:)/.test(item.icon) ? item.icon : previewUrl(item.pluginId, item.icon)
    return <img className="bot-cap__img" src={src} alt="" aria-hidden="true" />
  }
  return (
    <span className="bot-cap__tile" aria-hidden="true">
      <Icon name={sceneIcon(item)} size={16} />
    </span>
  )
}

function RouterBotCapabilitiesPanel({ bot, me }: { bot: BotDto; me: UserDto }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  return (
    <BotCapabilitiesPanelInner
      bot={bot}
      me={me}
      initialGroup={params.get('groupId')}
      nav={(to) => navigate(to)}
    />
  )
}

/**
 * Bot Details signature section: 已装配能力 — shows what plugins and capabilities this Bot can currently call,
 * scoped to a specific group or across all groups the Bot belongs to, with plain-language blockers and actions.
 */
export function BotCapabilitiesPanel({ bot, me }: { bot: BotDto; me: UserDto }) {
  const inRouter = useInRouterContext()
  if (inRouter) return <RouterBotCapabilitiesPanel bot={bot} me={me} />
  return (
    <BotCapabilitiesPanelInner
      bot={bot}
      me={me}
      initialGroup={null}
      nav={(to) => window.location.assign(to)}
    />
  )
}

function BotCapabilitiesPanelInner({
  bot,
  me,
  initialGroup,
  nav,
}: {
  bot: BotDto
  me: UserDto
  initialGroup: string | null
  nav: (to: string) => void
}) {
  const storeGroups = useWorkspace((s) => s.groups)
  const [mode, setMode] = useState<'group' | 'all'>(initialGroup ? 'group' : 'all')
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(initialGroup)
  const [fillTarget, setFillTarget] = useState<{ groupId: string; missing: string[] } | null>(null)
  const [notifyingId, setNotifyingId] = useState<string | null>(null)
  const [notifiedIds, setNotifiedIds] = useState<Record<string, boolean>>({})
  const fillNeeds = useGet<SecretNeedDto[]>(
    fillTarget ? `/groups/${fillTarget.groupId}/secret-needs` : null,
  ).data

  useEffect(() => {
    if (initialGroup) {
      setPickedGroupId(initialGroup)
      setMode('group')
    }
  }, [initialGroup])

  const queryPath =
    mode === 'group' && pickedGroupId
      ? `/bots/${bot.id}/capabilities?groupId=${encodeURIComponent(pickedGroupId)}`
      : `/bots/${bot.id}/capabilities`

  const { data, error, loading, reload } = useGet<BotCapabilitiesDto>(queryPath)

  const groups = useMemo(() => {
    if (data?.groups?.length) return data.groups
    return storeGroups.filter((g) => g.botIds.includes(bot.id)).map((g) => ({ id: g.id, name: g.name }))
  }, [data?.groups, storeGroups, bot.id])

  const activeGroupId =
    pickedGroupId && groups.some((g) => g.id === pickedGroupId)
      ? pickedGroupId
      : (data?.groupId ?? groups[0]?.id ?? null)
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null

  if (data && !data.pluginsEnabled) return null

  const targetGroupOf = (item: BotCapabilityItemDto) => {
    if (mode === 'group' && activeGroup) return activeGroup
    if (item.groupId) {
      const found =
        item.groups.find((g) => g.id === item.groupId) ?? groups.find((g) => g.id === item.groupId)
      if (found) return found
      return { id: item.groupId, name: item.groupId }
    }
    return item.groups[0] ?? activeGroup
  }

  const itemKeyOf = (item: BotCapabilityItemDto) => `${item.pluginId}:${item.blocker ?? 'none'}`

  const notifyOwner = async (item: BotCapabilityItemDto, action: 'notify_trust' | 'notify_connector') => {
    const machineId = item.machineId ?? bot.machineId
    const key = itemKeyOf(item)
    if (!machineId || notifyingId) return
    const target = targetGroupOf(item)
    setNotifyingId(key)
    try {
      await api.post(`/market/${item.pluginId}/readiness/action`, {
        action,
        machineId,
        scope: target ? 'group' : undefined,
        scopeId: target?.id,
        versionId: item.versionId ?? undefined,
      })
      setNotifiedIds((prev) => ({ ...prev, [key]: true }))
      toast({
        type: 'success',
        message: item.machineOwnerName
          ? t('已提醒 {owner} 处理「{name}」', { owner: item.machineOwnerName, name: item.title })
          : t('已发送提醒，等待电脑主人处理「{name}」', { name: item.title }),
      })
    } catch (e) {
      toastError(e)
    } finally {
      setNotifyingId(null)
    }
  }

  const renderAction = (item: BotCapabilityItemDto) => {
    const target = targetGroupOf(item)
    const isOwner = item.machineId ? item.ownMachine : me.id === bot.ownerId
    const key = itemKeyOf(item)
    const notified = !!notifiedIds[key]
    const busy = notifyingId === key

    switch (item.action) {
      case 'fill-secret':
        return (
          <Button
            size="small"
            variant="primary"
            onClick={() => {
              if (target) setFillTarget({ groupId: target.id, missing: item.missingSecrets })
              else nav('/market?tab=installed')
            }}
          >
            {t('去填写')}
          </Button>
        )
      case 'connect-account':
        if (!isOwner && item.machineOwnerName && item.machineId) {
          return (
            <Button
              size="small"
              disabled={notified || busy}
              loading={busy}
              onClick={() => void notifyOwner(item, 'notify_connector')}
            >
              {notified ? t('已提醒') : t('提醒电脑主人')}
            </Button>
          )
        }
        return (
          <Button
            size="small"
            variant="primary"
            onClick={() =>
              nav(
                target
                  ? `/g/${target.id}?connector=${encodeURIComponent(item.pluginId)}`
                  : '/market?scene=connect',
              )
            }
          >
            {t('去连接')}
          </Button>
        )
      case 'trust-machine':
        if (isOwner) {
          const machineId = item.machineId ?? bot.machineId
          return (
            <Button
              size="small"
              variant="primary"
              onClick={() => nav(machineId ? `/machine/${machineId}?tab=trusts` : '/machines')}
            >
              {t('去授权')}
            </Button>
          )
        }
        return (
          <Button
            size="small"
            disabled={notified || busy}
            loading={busy}
            onClick={() => void notifyOwner(item, 'notify_trust')}
          >
            {notified ? t('已提醒') : t('提醒电脑主人')}
          </Button>
        )
      case 'upgrade-daemon': {
        const machineId = item.machineId ?? bot.machineId
        return (
          <Button size="small" onClick={() => nav(machineId ? `/machine/${machineId}` : '/machines')}>
            {t('查看电脑')}
          </Button>
        )
      }
      default:
        return null
    }
  }

  const ready = data?.ready ?? []
  const unavailable = data?.unavailable ?? []
  const marketPath =
    mode === 'group' && activeGroup ? `/market?fromGroup=${encodeURIComponent(activeGroup.id)}` : '/market'

  return (
    <section className="usage-card bot-cap" aria-label={t('已装配能力')}>
      <div className="bot-cap__head">
        <div className="bot-cap__titles">
          <span className="usage-card__title">{t('已装配能力')}</span>
          <span className="bot-cap__sub">{t('这个 Bot 在所选范围内已经装好并可调用的插件与能力')}</span>
        </div>
        {groups.length > 0 ? (
          <div className="bot-cap__scope">
            <SegmentedControl<'group' | 'all'>
              size="small"
              aria-label={t('查看范围')}
              value={mode}
              onChange={(next) => {
                if (next === 'group' && !pickedGroupId && groups[0]) setPickedGroupId(groups[0].id)
                setMode(next)
              }}
              items={[
                { value: 'group', label: activeGroup?.name ?? groups[0]?.name ?? '' },
                { value: 'all', label: t('全部所在群（{n}）', { n: groups.length }) },
              ]}
            />
            {mode === 'group' && groups.length > 1 ? (
              <Select
                label={t('切换所在群')}
                value={activeGroup?.id ?? ''}
                onChange={(v) => setPickedGroupId(v)}
                options={groups.map((g) => ({ value: g.id, label: g.name }))}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="error" description={error} retrying={loading} onRetry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : !ready.length && !unavailable.length ? (
        <div className="bot-cap__empty ui-panel-swap">
          <span className="bot-page__muted">{t('当前范围还没有启用插件')}</span>
          <Link to={marketPath} className="bot-cap__link">
            {t('去插件市场看看')}
          </Link>
        </div>
      ) : (
        <div className="bot-cap__sections ui-panel-swap">
          {ready.length ? (
            <div className="bot-cap__sec">
              <div className="bot-cap__sec-head">
                <span className="bot-cap__sec-title">
                  {t('已就绪 · 现在就能用（{n}）', { n: ready.length })}
                </span>
              </div>
              <div className="bot-cap__grid">
                {ready.map((item) => {
                  const target = targetGroupOf(item)
                  return (
                    <article key={item.pluginId} className="bot-cap-card">
                      <div className="bot-cap-card__head">
                        <CapIcon item={item} />
                        <div className="bot-cap-card__meta">
                          <span className="bot-cap-card__title">{item.title}</span>
                          <span className="bot-cap-card__source">
                            {[
                              item.sourceLabel,
                              mode === 'all' && item.groups.length
                                ? item.groups.map((g) => g.name).join(t('、'))
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <Tag tone="green">{item.statusLabel || t('已就绪')}</Tag>
                      </div>
                      {item.description ? <p className="bot-cap-card__desc">{item.description}</p> : null}
                      {item.chatCommand || target ? (
                        <div className="bot-cap-card__foot">
                          {item.chatCommand ? (
                            <span className="bot-cap-card__cmd">
                              {item.chatCommand.startsWith('/') ? item.chatCommand : `/${item.chatCommand}`}
                            </span>
                          ) : (
                            <span />
                          )}
                          {target ? (
                            <Link to={`/g/${target.id}`} className="bot-cap__link">
                              {t('去群里试试')}
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </div>
          ) : null}

          {unavailable.length ? (
            <div className="bot-cap__sec">
              <div className="bot-cap__sec-head">
                <span className="bot-cap__sec-title">
                  {t('待处理 / 暂不可用（{n}）', { n: unavailable.length })}
                </span>
              </div>
              <GroupBox>
                {unavailable.map((item) => (
                  <div key={itemKeyOf(item)} className="bot-cap-row">
                    <CapIcon item={item} />
                    <div className="bot-cap-row__main">
                      <div className="bot-cap-row__title">
                        <span className="bot-cap-card__title">{item.title}</span>
                        <Tag tone={item.action === 'none' ? 'gray' : 'orange'}>
                          {item.reasonLabel || item.statusLabel || t('待处理')}
                        </Tag>
                        {item.sourceLabel || (mode === 'all' && item.groups.length) ? (
                          <span className="bot-cap-card__source">
                            {[
                              item.sourceLabel,
                              mode === 'all' && item.groups.length
                                ? item.groups.map((g) => g.name).join(t('、'))
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      {item.reason ? <span className="bot-cap-row__reason">{item.reason}</span> : null}
                    </div>
                    <div className="bot-cap-row__action">{renderAction(item)}</div>
                  </div>
                ))}
              </GroupBox>
            </div>
          ) : null}
        </div>
      )}

      <Presence>
        {fillTarget && fillNeeds ? (
          <NeedsDialog
            groupId={fillTarget.groupId}
            needs={
              fillTarget.missing.length && fillNeeds.some((n) => fillTarget.missing.includes(n.spec.name))
                ? fillNeeds.filter((n) => fillTarget.missing.includes(n.spec.name))
                : fillNeeds
            }
            onDone={() => {
              setFillTarget(null)
              reload()
            }}
            onClose={() => setFillTarget(null)}
          />
        ) : null}
      </Presence>
    </section>
  )
}
