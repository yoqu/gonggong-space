import {
  type InstalledHealth,
  type InstallScope,
  type ListingSummary,
  type MarketInstalledDto,
  type MarketSource,
  PERSONAL_BASE,
} from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  ConfirmActionDialog,
  EmptyState,
  Icon,
  NoPluginsArt,
  Presence,
  Skeleton,
  Switch,
  Tag,
} from '../../ui'
import type { InstallableListingInput } from './InstallTargetDialog'
import { ListingIcon } from './meta'
import { useRowLocks } from './rowLocks'
import './market-manage.css'

const HEALTH_LABEL: Record<InstalledHealth, string> = {
  ready: t('已就绪'),
  'needs-secret': t('待填凭据'),
  'needs-account': t('需连账号'),
  'needs-trust': t('待机主授权'),
  'update-available': t('有新版本'),
  disabled: t('已停用'),
  banned: t('已封禁'),
}

const HEALTH_TONE: Record<InstalledHealth, 'green' | 'orange' | 'blue' | 'gray' | 'red'> = {
  ready: 'green',
  'needs-secret': 'orange',
  'needs-account': 'orange',
  'needs-trust': 'gray',
  'update-available': 'blue',
  disabled: 'gray',
  banned: 'red',
}

const isPendingHealth = (h: InstalledHealth) =>
  h === 'needs-secret' || h === 'needs-account' || h === 'needs-trust'

const toInstallable = (
  listing: ListingSummary,
  source: MarketSource,
  teamName: string | null,
): InstallableListingInput => ({
  id: listing.id,
  type: listing.type,
  name: listing.name,
  title: listing.title,
  versionId: listing.versionId,
  icon: listing.icon,
  category: listing.category,
  source,
  teamName,
  listedVersionId: listing.versionId,
  listedRevision: listing.revision,
})

interface RemovingState {
  listing: ListingSummary
  base: string
  label: string
}

/**
 * Market 「已添加」 central management view (aligned with GET /api/market/installed):
 * top pending-action banner + 3 groups (我的插件 / 我所在群的插件 / 团队统一插件).
 */
export function InstalledView({
  onBrowseMarket,
  onOpenDetail,
  onConfigure,
  onChanged,
}: {
  onBrowseMarket: () => void
  onOpenDetail: (id: string, tab?: 'overview' | 'changelog') => void
  onConfigure: (
    listing: InstallableListingInput,
    target: { scope: InstallScope; scopeId: string; label: string; teamId?: string },
  ) => void
  onChanged?: () => void
}) {
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const { data, error, loading, reload } = useGet<MarketInstalledDto>('/market/installed')
  const locks = useRowLocks()
  const [removing, setRemoving] = useState<RemovingState | null>(null)

  const putInstall = async (
    key: string,
    base: string,
    listingId: string,
    enabled: boolean,
    pinVersionId: string | null,
  ) => {
    const ok = await locks.run(key, () =>
      attempt(() => api.put(`${base}/installs/${listingId}`, { enabled, pinVersionId })),
    )
    if (ok) {
      reload()
      onChanged?.()
    }
  }

  const upgradeGroups = async (
    key: string,
    listingId: string,
    versionId: string,
    targets: { groupId: string; enabled: boolean }[],
  ) => {
    const ok = await locks.run(key, () =>
      attempt(() =>
        Promise.all(
          targets.map((g) =>
            api.put(`/groups/${g.groupId}/installs/${listingId}`, {
              enabled: g.enabled,
              pinVersionId: versionId,
            }),
          ),
        ),
      ),
    )
    if (ok) {
      reload()
      onChanged?.()
    }
  }

  const total = data ? data.mine.length + data.groups.length + data.team.length : 0

  // Pending targets across mine, groups, and team for the top banner summary + 逐个处理 action.
  const pendingEntries: {
    title: string
    health: InstalledHealth
    installable: InstallableListingInput
    target: { scope: InstallScope; scopeId: string; label: string; teamId?: string }
  }[] = []
  if (data) {
    for (const item of data.mine) {
      if (isPendingHealth(item.health)) {
        pendingEntries.push({
          title: item.listing.title,
          health: item.health,
          installable: toInstallable(item.listing, item.source, item.teamName),
          target: { scope: 'user', scopeId: me ?? '', label: t('我的插件') },
        })
      }
    }
    for (const item of data.groups) {
      const g = item.groups.find((x) => isPendingHealth(x.health))
      if (g) {
        pendingEntries.push({
          title: item.listing.title,
          health: g.health,
          installable: toInstallable(item.listing, item.source, item.teamName),
          target: { scope: 'group', scopeId: g.groupId, label: g.groupName },
        })
      }
    }
    for (const item of data.team) {
      if (isPendingHealth(item.health)) {
        pendingEntries.push({
          title: item.listing.title,
          health: item.health,
          installable: toInstallable(item.listing, item.source, item.targetLabel),
          target: {
            scope: item.scope,
            scopeId: item.scopeId,
            label: item.targetLabel,
            teamId: item.teamId,
          },
        })
      }
    }
  }
  const firstPending = pendingEntries[0]
  const firstUpdateListing =
    data?.mine.find((x) => x.hasUpdate)?.listing ??
    data?.groups.find((x) => x.hasUpdate)?.listing ??
    data?.team.find((x) => x.hasUpdate)?.listing

  const pendingSummary = pendingEntries
    .slice(0, 2)
    .map((e) => `${e.title} ${HEALTH_LABEL[e.health]}`)
    .join(' · ')

  return (
    <div className="mkt-content mkt-content--narrow">
      <section className="mkt-head">
        <div className="mkt-head__titles">
          <h1 className="mkt-head__title">{t('已添加')}</h1>
          <p className="mkt-head__sub">{t('你和你所在的群用到的插件都在这里，待处理的排在前面。')}</p>
        </div>
        <Button icon="plus" onClick={onBrowseMarket}>
          {t('去市场添加')}
        </Button>
      </section>

      {error ? <Alert variant="error" title={error} retrying={loading} onRetry={reload} /> : null}

      {!data ? (
        error ? null : (
          <Skeleton variant="block" count={3} height={84} />
        )
      ) : total === 0 ? (
        <div className="mkt-empty-box">
          <EmptyState
            illustration={<NoPluginsArt />}
            title={t('还没有添加插件')}
            description={t('给群装上插件，Bot 就能连飞书、查数仓、做原型。')}
            action={
              <Button variant="primary" onClick={onBrowseMarket}>
                {t('去逛逛市场')}
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {data.todoCount > 0 || data.pendingUpdates > 0 ? (
            <section className="mkt-todo-banner" aria-label={t('待处理提醒')}>
              {data.todoCount > 0 ? (
                <div className="mkt-todo-line">
                  <Icon name="warning" size={15} />
                  <span className="mkt-todo-line__text">
                    <strong>{t('{n} 个插件还要配置', { n: data.todoCount })}</strong>
                    {pendingSummary ? `：${pendingSummary}` : null}
                  </span>
                  {firstPending ? (
                    <Button
                      size="small"
                      onClick={() => onConfigure(firstPending.installable, firstPending.target)}
                    >
                      {t('逐个处理')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {data.pendingUpdates > 0 ? (
                <div className={`mkt-todo-line${data.todoCount > 0 ? ' mkt-todo-line--update' : ''}`}>
                  <Icon name="arrow-up" size={15} />
                  <span className="mkt-todo-line__text">
                    <strong>{t('{n} 个插件有新版本', { n: data.pendingUpdates })}</strong>
                    {firstUpdateListing
                      ? `：${firstUpdateListing.title} r${firstUpdateListing.revision}`
                      : null}
                  </span>
                  {firstUpdateListing ? (
                    <Button size="small" onClick={() => onOpenDetail(firstUpdateListing.id, 'changelog')}>
                      {t('查看更新')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {data.mine.length ? (
            <section aria-label={t('我的插件')}>
              <div className="mkt-shelf__head">
                <h2 className="mkt-shelf__title">
                  {t('我的插件')}
                  <span className="mkt-shelf__sub">{t('随你进入所有群')}</span>
                </h2>
              </div>
              <div className="mkt-group-box">
                {data.mine.map((item) => {
                  const key = `me:${item.listing.id}`
                  const busy = locks.busy.has(key)
                  return (
                    <div key={item.listing.id} className="mkt-inst-row">
                      <ListingIcon type={item.listing.type} size={36} listing={item.listing} />
                      <div>
                        <button
                          type="button"
                          className="mkt-pcard__name"
                          onClick={() => onOpenDetail(item.listing.id)}
                        >
                          {item.listing.title}
                        </button>
                        <div className="mkt-inst-row__where">
                          {[
                            item.teamName || (item.source === 'official' ? t('官方') : ''),
                            item.pinVersionId
                              ? t('已锁定在 r{n}', { n: item.resolvedRevision })
                              : t('自动更新'),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <div className="mkt-inst-row__status">
                        <Tag tone={HEALTH_TONE[item.health]}>
                          {item.hasUpdate
                            ? t('有更新 r{n}', { n: item.latestRevision })
                            : item.healthDetail || HEALTH_LABEL[item.health]}
                        </Tag>
                      </div>
                      <div className="mkt-inst-row__ops">
                        {isPendingHealth(item.health) ? (
                          <Button
                            size="small"
                            className={item.health === 'needs-trust' ? undefined : 'mkt-btn-warn'}
                            onClick={() =>
                              onConfigure(toInstallable(item.listing, item.source, item.teamName), {
                                scope: 'user',
                                scopeId: me ?? '',
                                label: t('我的插件'),
                              })
                            }
                          >
                            {item.health === 'needs-trust' ? t('查看授权') : t('去配置')}
                          </Button>
                        ) : null}
                        {item.hasUpdate ? (
                          <Button
                            size="small"
                            className="mkt-btn-soft"
                            disabled={busy}
                            loading={busy}
                            onClick={() =>
                              void putInstall(
                                key,
                                PERSONAL_BASE,
                                item.listing.id,
                                item.enabled,
                                item.listing.versionId,
                              )
                            }
                          >
                            {t('升级')}
                          </Button>
                        ) : null}
                        <Switch
                          ariaLabel={t('启用 {name}', { name: item.listing.title })}
                          checked={item.enabled}
                          disabled={busy}
                          onChange={(on) =>
                            void putInstall(key, PERSONAL_BASE, item.listing.id, on, item.pinVersionId)
                          }
                        />
                        <Button
                          size="small"
                          variant="plain"
                          disabled={busy}
                          onClick={() =>
                            setRemoving({
                              listing: item.listing,
                              base: PERSONAL_BASE,
                              label: t('我的插件'),
                            })
                          }
                        >
                          {t('移除')}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {data.groups.length ? (
            <section aria-label={t('我所在群的插件')}>
              <div className="mkt-shelf__head">
                <h2 className="mkt-shelf__title">
                  {t('我所在群的插件')}
                  <span className="mkt-shelf__sub">{t('按插件列出启用的群')}</span>
                </h2>
              </div>
              <div className="mkt-group-box">
                {data.groups.map((item) => {
                  const pendingTarget = item.groups.find((g) => isPendingHealth(g.health))
                  const upgradableGroups = item.groups.filter((g) => g.hasUpdate && g.canManage)
                  const single = item.groups.length === 1 ? item.groups[0] : null
                  const first = item.groups[0]
                  const anyManage = item.groups.some((g) => g.canManage)
                  const lockKey = single
                    ? `group:${single.groupId}:${item.listing.id}`
                    : `groups:${item.listing.id}`
                  const busy = locks.busy.has(lockKey)
                  return (
                    <div key={item.listing.id} className="mkt-inst-row">
                      <ListingIcon type={item.listing.type} size={36} listing={item.listing} />
                      <div>
                        <button
                          type="button"
                          className="mkt-pcard__name"
                          onClick={() => onOpenDetail(item.listing.id)}
                        >
                          {item.listing.title}
                        </button>
                        <div className="mkt-inst-row__where">
                          {item.groups.map((g) => g.groupName).join(' · ')}
                        </div>
                      </div>
                      <div className="mkt-inst-row__status">
                        {item.groups.every((g) => g.health === 'ready') ? (
                          <Tag tone="green">
                            {item.groups.length > 1
                              ? t('{n} 个群已就绪', { n: item.groups.length })
                              : t('已就绪')}
                          </Tag>
                        ) : (
                          item.groups.map((g) => (
                            <Tag key={g.groupId} tone={HEALTH_TONE[g.health]}>
                              {g.healthDetail || `${g.groupName} ${HEALTH_LABEL[g.health]}`}
                            </Tag>
                          ))
                        )}
                      </div>
                      <div className="mkt-inst-row__ops">
                        {upgradableGroups.length ? (
                          <Button
                            size="small"
                            className="mkt-btn-soft"
                            disabled={busy}
                            loading={busy}
                            onClick={() =>
                              void upgradeGroups(
                                lockKey,
                                item.listing.id,
                                item.listing.versionId,
                                upgradableGroups,
                              )
                            }
                          >
                            {t('升级')}
                          </Button>
                        ) : null}
                        {pendingTarget ? (
                          <Button
                            size="small"
                            className={pendingTarget.health === 'needs-trust' ? undefined : 'mkt-btn-warn'}
                            onClick={() =>
                              onConfigure(toInstallable(item.listing, item.source, item.teamName), {
                                scope: 'group',
                                scopeId: pendingTarget.groupId,
                                label: pendingTarget.groupName,
                              })
                            }
                          >
                            {pendingTarget.health === 'needs-trust' ? t('查看授权') : t('去配置')}
                          </Button>
                        ) : item.groups.length > 1 && first ? (
                          <Button size="small" onClick={() => navigate(`/g/${first.groupId}`)}>
                            {t('群内管理')}
                          </Button>
                        ) : null}

                        {single?.canManage ? (
                          <>
                            <Switch
                              ariaLabel={t('启用 {name}', { name: item.listing.title })}
                              checked={single.enabled}
                              disabled={busy}
                              onChange={(on) =>
                                void putInstall(
                                  lockKey,
                                  `/groups/${single.groupId}`,
                                  item.listing.id,
                                  on,
                                  single.pinVersionId,
                                )
                              }
                            />
                            <Button
                              size="small"
                              variant="plain"
                              disabled={busy}
                              onClick={() =>
                                setRemoving({
                                  listing: item.listing,
                                  base: `/groups/${single.groupId}`,
                                  label: single.groupName,
                                })
                              }
                            >
                              {t('移除')}
                            </Button>
                          </>
                        ) : !anyManage ? (
                          <span className="mkt-managed">
                            <Icon name="lock" size={12} />
                            {t('群管理员管理')}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {data.team.length ? (
            <section aria-label={t('团队统一插件')}>
              <div className="mkt-shelf__head">
                <h2 className="mkt-shelf__title">
                  {t('团队统一插件')}
                  <span className="mkt-shelf__sub">{t('由团队管理员添加，所有群默认可用')}</span>
                </h2>
              </div>
              <div className="mkt-group-box">
                {data.team.map((item) => {
                  const base =
                    item.scope === 'repo'
                      ? `/teams/${item.teamId}/repos/${item.scopeId}`
                      : `/teams/${item.teamId}`
                  const key = `${item.scope}:${item.scopeId}:${item.listing.id}`
                  const busy = locks.busy.has(key)
                  return (
                    <div key={key} className="mkt-inst-row">
                      <ListingIcon type={item.listing.type} size={36} listing={item.listing} />
                      <div>
                        <button
                          type="button"
                          className="mkt-pcard__name"
                          onClick={() => onOpenDetail(item.listing.id)}
                        >
                          {item.listing.title}
                        </button>
                        <div className="mkt-inst-row__where">
                          {item.groupsCount > 0
                            ? t('{target} · {n} 个群在用', {
                                target: item.targetLabel,
                                n: item.groupsCount,
                              })
                            : item.targetLabel}
                        </div>
                      </div>
                      <div className="mkt-inst-row__status">
                        <Tag tone={HEALTH_TONE[item.health]}>
                          {item.hasUpdate
                            ? t('有更新 r{n}', { n: item.latestRevision })
                            : item.healthDetail || HEALTH_LABEL[item.health]}
                        </Tag>
                      </div>
                      <div className="mkt-inst-row__ops">
                        {isPendingHealth(item.health) ? (
                          <Button
                            size="small"
                            className={item.health === 'needs-trust' ? undefined : 'mkt-btn-warn'}
                            onClick={() =>
                              onConfigure(toInstallable(item.listing, item.source, item.targetLabel), {
                                scope: item.scope,
                                scopeId: item.scopeId,
                                label: item.targetLabel,
                                teamId: item.teamId,
                              })
                            }
                          >
                            {item.health === 'needs-trust' ? t('查看授权') : t('去配置')}
                          </Button>
                        ) : null}
                        {item.canManage ? (
                          <>
                            {item.hasUpdate ? (
                              <Button
                                size="small"
                                className="mkt-btn-soft"
                                disabled={busy}
                                loading={busy}
                                onClick={() =>
                                  void putInstall(
                                    key,
                                    base,
                                    item.listing.id,
                                    item.enabled,
                                    item.listing.versionId,
                                  )
                                }
                              >
                                {t('升级')}
                              </Button>
                            ) : null}
                            <Switch
                              ariaLabel={t('启用 {name}', { name: item.listing.title })}
                              checked={item.enabled}
                              disabled={busy}
                              onChange={(on) =>
                                void putInstall(key, base, item.listing.id, on, item.pinVersionId)
                              }
                            />
                            <Button
                              size="small"
                              variant="plain"
                              disabled={busy}
                              onClick={() =>
                                setRemoving({
                                  listing: item.listing,
                                  base,
                                  label: item.targetLabel,
                                })
                              }
                            >
                              {t('移除')}
                            </Button>
                          </>
                        ) : (
                          <span className="mkt-managed">
                            <Icon name="lock" size={12} />
                            {t('团队管理员管理')}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Presence>
        {removing ? (
          <ConfirmActionDialog
            title={t('移除 {name}？', { name: removing.listing.title })}
            message={t('只移除在「{target}」的添加，插件本身保留，可随时重新添加。', {
              target: removing.label,
            })}
            consequences={[t('相关 Bot 下一轮起不再加载它')]}
            label={t('移除')}
            done={t('已移除 {name}', { name: removing.listing.title })}
            run={() => api.del(`${removing.base}/installs/${removing.listing.id}`)}
            onDone={() => {
              setRemoving(null)
              reload()
              onChanged?.()
            }}
            onClose={() => setRemoving(null)}
          />
        ) : null}
      </Presence>
    </div>
  )
}
