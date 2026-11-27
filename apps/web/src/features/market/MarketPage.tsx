import type {
  InstallRequestDto,
  InstallScope,
  MarketInstalledDto,
  ReusedSecretDto,
  ReviewItemDto,
} from '@gonggong/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useIsBuilder } from '../../app/builder'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import { Icon, Presence, SearchField, Sidebar, type SidebarItem } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { InstalledView } from './InstalledView'
import { InstallRequests } from './InstallRequests'
import { type InstallableListingInput, InstallTargetDialog } from './InstallTargetDialog'
import { type DetailTab, ListingDetail } from './ListingDetail'
import {
  type CapabilityFilter,
  MarketCatalogView,
  MarketHomeView,
  type SortMode,
  type SourceFilter,
} from './MarketExplore'
import { MyListings } from './MyListings'
import {
  type CardActionKind,
  capabilitiesOfListing,
  isSystemPreset,
  type MarketListingView,
  type MarketScene,
  SCENES,
  sceneOfListing,
} from './meta'
import { MarketReviewList } from './ReviewList'
import './market.css'
import './market-detail.css'
import './market-manage.css'

type MarketView = 'home' | 'catalog' | 'installed' | 'requests' | 'mine' | 'reviews'

const SCENE_IDS = new Set<MarketScene>(['connect', 'create', 'office', 'dev', 'tools'])

function parseScene(params: URLSearchParams): 'all' | MarketScene | null {
  const s = params.get('scene')
  if (s === 'all') return 'all'
  if (s && SCENE_IDS.has(s as MarketScene)) return s as MarketScene
  const shelf = params.get('shelf')
  if (shelf === 'connector') return 'connect'
  if (shelf === 'creation') return 'create'
  return null
}

function useSettled<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
}

/** The review queues I work through: each team I administer, and public listings for sysadmins. */
function useReviewQueues() {
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const sysadmin = useSession((s) => s.user?.role === 'sysadmin')
  return [
    ...teams
      .filter((x) => x.role === 'admin' || x.role === 'owner')
      .map((x) => ({ path: `/market/reviews?teamId=${x.id}`, label: x.name })),
    ...(sysadmin ? [{ path: '/market/reviews', label: t('公开条目') }] : []),
  ]
}

/**
 * 插件市场 (Pane shell):
 * Flush 224px sidebar (Discovery / 5 Scenarios / My / bottom shortcuts) + main view
 * (Featured Home, Catalog/Scene, 880px Plugin Detail, Installed, Requests, My Listings/Publish, Reviews).
 */
export function MarketPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const me = useSession((s) => s.user?.id)
  const sysadmin = useSession((s) => s.user?.role === 'sysadmin')
  const teams = useSession((s) => s.tenancy?.teams) ?? []
  const rawGroups = useWorkspace((s) => s.groups)
  const groups = useMemo(() => rawGroups.filter((g) => g.kind === 'group'), [rawGroups])
  const isBuilder = useIsBuilder()
  const queues = useReviewQueues()

  const sourceGroupId = params.get('fromGroup') || params.get('groupId') || undefined
  const sourceGroup = sourceGroupId ? groups.find((g) => g.id === sourceGroupId) : undefined
  const backGroup = sourceGroup ?? groups[0]

  const canInstallDirectly = useMemo(() => {
    if (sourceGroup) return isGroupAdmin(sourceGroup, me)
    if (sysadmin) return true
    if (teams.some((x) => x.role !== 'member')) return true
    return groups.some((g) => isGroupAdmin(g, me))
  }, [sourceGroup, me, sysadmin, teams, groups])

  // Derive active view & scene from URL params (supporting legacy ?tab= and ?shelf= links).
  const openId = params.get('listing')
  const detailTabParam = params.get('detailTab')
  const detailTab: DetailTab =
    detailTabParam === 'changelog' || detailTabParam === 'dev' ? detailTabParam : 'overview'
  const urlScene = parseScene(params)
  const rawTab = params.get('tab')
  const view: MarketView =
    rawTab === 'installed' || rawTab === 'requests' || rawTab === 'mine'
      ? rawTab
      : rawTab === 'reviews' && queues.length > 0
        ? 'reviews'
        : rawTab === 'catalog' || urlScene !== null
          ? 'catalog'
          : 'home'
  const activeScene: 'all' | MarketScene = urlScene ?? 'all'
  const publishMode: 'list' | 'create' = params.get('publish') === '1' ? 'create' : 'list'

  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [capability, setCapability] = useState<CapabilityFilter>('all')
  const [sort, setSort] = useState<SortMode>('team')
  const [modal, setModal] = useState<{
    listing: InstallableListingInput
    readyTarget?: { scope: InstallScope; scopeId: string; label: string }
  } | null>(null)
  const [reusedByListing, setReusedByListing] = useState<Record<string, ReusedSecretDto[]>>({})
  const [detailTick, setDetailTick] = useState(0)

  const q = useSettled(query)

  // Fetch all market listings once (default endpoint excludes agent/provider; we also filter defensively).
  const marketGet = useGet<MarketListingView[]>('/market')
  const lastAll = useRef<MarketListingView[] | null>(null)
  if (marketGet.data) lastAll.current = marketGet.data

  // Sidebar live counts & badges
  const installedGet = useGet<MarketInstalledDto>('/market/installed')
  const installedCount = installedGet.data
    ? installedGet.data.mine.length + installedGet.data.groups.length + installedGet.data.team.length
    : 0

  // Enrich market cards with live health & pending target from /market/installed so cards show 待配置/去配置 or 待授权/去授权.
  const pendingTargetByListing = useMemo(() => {
    const map = new Map<
      string,
      { scope: InstallScope; scopeId: string; label: string; needsTrust: boolean }
    >()
    const isTodo = (h: string) => h === 'needs-secret' || h === 'needs-account' || h === 'needs-trust'
    for (const item of installedGet.data?.mine ?? []) {
      if (isTodo(item.health)) {
        map.set(item.listing.id, {
          scope: 'user',
          scopeId: me ?? '',
          label: t('我的插件'),
          needsTrust: item.health === 'needs-trust',
        })
      }
    }
    for (const item of installedGet.data?.groups ?? []) {
      const g = item.groups.find((x) => isTodo(x.health))
      if (g) {
        map.set(item.listing.id, {
          scope: 'group',
          scopeId: g.groupId,
          label: g.groupName,
          needsTrust: g.health === 'needs-trust',
        })
      }
    }
    for (const item of installedGet.data?.team ?? []) {
      if (isTodo(item.health) && !map.has(item.listing.id)) {
        map.set(item.listing.id, {
          scope: item.scope,
          scopeId: item.scopeId,
          label: item.targetLabel,
          needsTrust: item.health === 'needs-trust',
        })
      }
    }
    return map
  }, [installedGet.data, me])

  const allListings = useMemo(() => {
    const raw = marketGet.data ?? lastAll.current
    if (!raw) return null
    return raw
      .filter((l) => !isSystemPreset(l))
      .map((l) => {
        const pending = pendingTargetByListing.get(l.id)
        return pending ? { ...l, needsConfig: !pending.needsTrust, needsTrust: pending.needsTrust } : l
      })
  }, [marketGet.data, pendingTargetByListing])
  const todoList = useGet<InstallRequestDto[]>('/install-requests?view=todo')
  const todoCount = todoList.data?.length ?? 0
  const primaryReviewQueue = useGet<ReviewItemDto[]>(queues[0]?.path ?? null)
  const reviewCount = primaryReviewQueue.data?.length ?? 0

  // Filtered + sorted catalog listings
  const catalogListings = useMemo(() => {
    if (!allListings) return null
    const needle = q.trim().toLowerCase()
    const filtered = allListings.filter((l) => {
      if (activeScene !== 'all' && sceneOfListing(l) !== activeScene) return false
      if (source !== 'all' && l.source !== source) return false
      if (capability !== 'all' && !capabilitiesOfListing(l).includes(capability)) return false
      if (needle) {
        const hay = `${l.title} ${l.name} ${l.description} ${l.teamName ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sort === 'installs') return b.installs - a.installs
      if (sort === 'latest') return Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      return (b.teamGroupsCount ?? b.installs) - (a.teamGroupsCount ?? a.installs)
    })
  }, [allListings, activeScene, source, capability, q, sort])

  const sceneCounts = useMemo(() => {
    const counts: Record<MarketScene, number> = { connect: 0, create: 0, office: 0, dev: 0, tools: 0 }
    for (const l of allListings ?? []) {
      counts[sceneOfListing(l)] += 1
    }
    return counts
  }, [allListings])

  // URL navigation helpers (preserve fromGroup when browsing market).
  const keepGroup = (next: URLSearchParams) => {
    if (sourceGroupId) next.set('fromGroup', sourceGroupId)
    return next
  }
  const goHome = () => setParams(keepGroup(new URLSearchParams()), { replace: true })
  const goScene = (sc: 'all' | MarketScene) => {
    const next = keepGroup(new URLSearchParams())
    next.set('tab', 'catalog')
    next.set('scene', sc)
    setParams(next, { replace: true })
  }
  const goTab = (tab: 'installed' | 'requests' | 'mine' | 'reviews', publish = false) => {
    const next = keepGroup(new URLSearchParams())
    next.set('tab', tab)
    if (tab === 'mine' && publish) next.set('publish', '1')
    setParams(next, { replace: true })
  }
  const openDetail = (id: string, tab?: DetailTab) => {
    const next = new URLSearchParams(params)
    next.set('listing', id)
    if (tab && tab !== 'overview') next.set('detailTab', tab)
    else next.delete('detailTab')
    setParams(next, { replace: true })
  }
  const closeDetail = () => {
    const next = new URLSearchParams(params)
    next.delete('listing')
    next.delete('detailTab')
    setParams(next, { replace: true })
  }

  // Deep-link ?configure=<listingId>&scope=<scope>&scopeId=<scopeId> into Step 2 directly.
  const configureId = params.get('configure')
  const configureScope = params.get('scope') as InstallScope | null
  const configureScopeId = params.get('scopeId')
  useEffect(() => {
    if (!configureId || !configureScope || !configureScopeId || !allListings) return
    const found = allListings.find((l) => l.id === configureId)
    if (!found) return
    const label =
      groups.find((g) => g.id === configureScopeId)?.name ??
      teams.find((x) => x.id === configureScopeId)?.name ??
      configureScopeId
    setModal({
      listing: found,
      readyTarget: { scope: configureScope, scopeId: configureScopeId, label },
    })
    const next = new URLSearchParams(params)
    next.delete('configure')
    next.delete('scope')
    next.delete('scopeId')
    setParams(next, { replace: true })
  }, [configureId, configureScope, configureScopeId, allListings, groups, teams, params, setParams])

  const handleCardAction = (l: MarketListingView, action: CardActionKind) => {
    if (action === 'installed') {
      goTab('installed')
      return
    }
    if (action === 'configure') {
      const pending = pendingTargetByListing.get(l.id)
      if (pending) {
        setModal({
          listing: l,
          readyTarget: { scope: pending.scope, scopeId: pending.scopeId, label: pending.label },
        })
        return
      }
      const target = l.installedIn?.find((x) => x.scope === 'group') ?? l.installedIn?.[0]
      if (target) {
        setModal({
          listing: l,
          readyTarget: {
            scope: target.scope,
            scopeId: target.scopeId,
            label: target.scope === 'user' ? t('我的插件') : target.label,
          },
        })
        return
      }
      if (l.needsTrust) {
        navigate('/machines')
        return
      }
    }
    setModal({ listing: l })
  }

  const sidebarSelected = openId
    ? undefined
    : view === 'home'
      ? 'home'
      : view === 'catalog'
        ? activeScene === 'all'
          ? 'all'
          : `scene:${activeScene}`
        : view

  const handleSidebarSelect = (id: string) => {
    if (id === 'home') goHome()
    else if (id === 'all') goScene('all')
    else if (id.startsWith('scene:')) goScene(id.slice(6) as MarketScene)
    else if (id === 'installed' || id === 'requests' || id === 'mine' || id === 'reviews') goTab(id)
  }

  const myItems: SidebarItem[] = [
    {
      id: 'installed',
      label: t('已添加'),
      icon: 'archive',
      color: 'var(--system-blue)',
      badge: installedCount > 0 ? installedCount : undefined,
    },
    {
      id: 'requests',
      label: t('申请与审批'),
      icon: 'tray',
      color: 'var(--system-orange)',
      badge: todoCount > 0 ? <span className="mkt-side__badge">{todoCount}</span> : undefined,
    },
    {
      id: 'mine',
      label: t('我的发布'),
      icon: 'upload',
      color: 'var(--system-purple)',
    },
    ...(queues.length > 0
      ? [
          {
            id: 'reviews',
            label: t('上架审核'),
            icon: 'shield-check' as const,
            color: 'var(--system-green)',
            badge: reviewCount > 0 ? <span className="mkt-side__badge">{reviewCount}</span> : undefined,
          },
        ]
      : []),
  ]

  const refreshAll = () => {
    marketGet.reload()
    installedGet.reload()
    todoList.reload()
    if (queues.length) primaryReviewQueue.reload()
  }

  return (
    <section className="mkt-shell" aria-label={t('插件市场')}>
      <aside className="mkt-side" aria-label={t('市场导航')}>
        <SearchField
          className="mkt-side__search"
          placeholder={t('搜索插件或你想做的事')}
          aria-label={t('搜索插件')}
          value={query}
          onChange={(v) => {
            setQuery(v)
            if (v.trim() && (view !== 'catalog' || openId)) {
              goScene(view === 'catalog' ? activeScene : 'all')
            }
          }}
        />

        <Sidebar
          className="mkt-side__nav"
          aria-label={t('插件分类')}
          selected={sidebarSelected}
          onSelect={handleSidebarSelect}
          sections={[
            {
              id: 'discover',
              title: t('发现'),
              items: [
                { id: 'home', label: t('精选推荐'), icon: 'star', color: 'var(--system-orange)' },
                {
                  id: 'all',
                  label: t('全部插件'),
                  icon: 'grid',
                  color: 'var(--system-blue)',
                  badge: allListings ? allListings.length : undefined,
                },
              ],
            },
            {
              id: 'scenes',
              title: t('场景分类'),
              items: SCENES.map((s) => ({
                id: `scene:${s.id}`,
                label: s.label,
                icon: s.icon,
                color: s.color,
                badge: allListings ? sceneCounts[s.id] : undefined,
              })),
            },
            {
              id: 'my',
              title: t('我的'),
              items: myItems,
            },
          ]}
        />

        {backGroup || isBuilder ? (
          <div className="mkt-side__foot">
            {backGroup ? (
              <button type="button" className="mkt-side__link" onClick={() => navigate(`/g/${backGroup.id}`)}>
                <span className="mkt-side__link-icon" aria-hidden="true">
                  <Icon name="message" size={15} />
                </span>
                <span className="mkt-side__link-text">{t('回到 {name}', { name: backGroup.name })}</span>
              </button>
            ) : null}
            {isBuilder ? (
              <button type="button" className="mkt-side__link" onClick={() => navigate('/machines')}>
                <span className="mkt-side__link-icon" aria-hidden="true">
                  <Icon name="laptop" size={15} />
                </span>
                <span className="mkt-side__link-text">{t('电脑引擎与模型')}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>

      <main className={`mkt-main${openId ? ' mkt-main--detail' : ''}`}>
        {openId ? (
          <ListingDetail
            key={`${openId}:${detailTick}`}
            id={openId}
            initialTab={detailTab}
            standalone
            canInstallDirectly={canInstallDirectly}
            reusedSecrets={reusedByListing[openId]}
            onBack={closeDetail}
            onChanged={refreshAll}
            onManageInstalled={() => goTab('installed')}
            onAdd={(d) => {
              if (d.listedVersionId && d.listedRevision !== null) {
                setModal({
                  listing: {
                    ...d,
                    listedVersionId: d.listedVersionId,
                    listedRevision: d.listedRevision,
                  },
                })
              }
            }}
            onConfigure={(d, target) => {
              if (d.listedVersionId && d.listedRevision !== null) {
                setModal({
                  listing: {
                    ...d,
                    listedVersionId: d.listedVersionId,
                    listedRevision: d.listedRevision,
                  },
                  readyTarget: target,
                })
              }
            }}
          />
        ) : view === 'installed' ? (
          <InstalledView
            onBrowseMarket={goHome}
            onOpenDetail={(id, tab) => openDetail(id, tab)}
            onConfigure={(listing, readyTarget) => setModal({ listing, readyTarget })}
            onChanged={refreshAll}
          />
        ) : view === 'requests' ? (
          <InstallRequests todo={todoList} onOpenListing={(id) => openDetail(id)} onBackMarket={goHome} />
        ) : view === 'mine' ? (
          <MyListings
            initialMode={publishMode}
            onModeChange={(m) => goTab('mine', m === 'create')}
            onOpen={(l) => openDetail(l.id)}
          />
        ) : view === 'reviews' ? (
          <div className="mkt-content">
            <section className="mkt-head">
              <div className="mkt-head__titles">
                <h1 className="mkt-head__title">{t('上架审核')}</h1>
                <p className="mkt-head__sub">
                  {t('团队内可见条目由团队管理员审核，公开条目由系统管理员审核。')}
                </p>
              </div>
            </section>
            {queues.map((x) => (
              <MarketReviewList
                key={x.path}
                path={x.path}
                queueLabel={x.label}
                onReviewed={refreshAll}
                onBackMarket={goHome}
              />
            ))}
          </div>
        ) : view === 'catalog' ? (
          <MarketCatalogView
            scene={activeScene}
            query={query}
            source={source}
            capability={capability}
            sort={sort}
            listings={catalogListings}
            loading={marketGet.loading}
            error={marketGet.error}
            canInstallDirectly={canInstallDirectly}
            onSource={setSource}
            onCapability={setCapability}
            onSort={setSort}
            onClear={() => {
              setQuery('')
              setSource('all')
              setCapability('all')
              goScene('all')
            }}
            onRetry={marketGet.reload}
            onOpen={(l) => openDetail(l.id)}
            onAction={handleCardAction}
            onPublish={() => goTab('mine', true)}
          />
        ) : (
          <MarketHomeView
            listings={allListings}
            loading={marketGet.loading}
            error={marketGet.error}
            canInstallDirectly={canInstallDirectly}
            onRetry={marketGet.reload}
            onOpen={(l) => openDetail(l.id)}
            onAction={handleCardAction}
            onViewScene={goScene}
            onPublish={() => goTab('mine', true)}
          />
        )}
      </main>

      <Presence>
        {modal ? (
          <InstallTargetDialog
            listing={modal.listing}
            sourceGroupId={sourceGroupId}
            initialReadyTarget={modal.readyTarget}
            onClose={() => setModal(null)}
            onGoInstalled={() => goTab('installed')}
            onReusedSecrets={(reusedSecrets) => {
              setReusedByListing((prev) => ({
                ...prev,
                [modal.listing.id]: reusedSecrets,
              }))
            }}
            onChanged={() => {
              setDetailTick((n) => n + 1)
              refreshAll()
            }}
          />
        ) : null}
      </Presence>
    </section>
  )
}
