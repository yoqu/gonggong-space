import type { MarketSort, MarketSource } from '@gonggong/protocol'
import { t } from '../../i18n'
import { cx } from '../../lib/cx'
import {
  Button,
  ComingSoonArt,
  EmptyState,
  Icon,
  NoResultsArt,
  PopUpButton,
  SegmentedControl,
  Skeleton,
} from '../../ui'
import {
  CAPABILITY_META,
  CapabilityChips,
  type CardActionKind,
  capabilitiesOfListing,
  cardActionOf,
  type MarketCapability,
  type MarketListingView,
  type MarketScene,
  PluginCard,
  readinessOfListing,
  SCENE_MAP,
  SOURCE_LABEL,
  sceneOfListing,
  usageLabel,
} from './meta'

export type SourceFilter = 'all' | MarketSource
export type CapabilityFilter = 'all' | MarketCapability
export type SortMode = MarketSort

function HeroArt({ variant }: { variant: 'create' | 'connect' }) {
  if (variant === 'create') {
    return (
      <div className="mkt-hero__art" aria-hidden="true">
        <svg aria-hidden="true" viewBox="0 0 248 156">
          <rect style={{ fill: 'var(--content-bg)' }} x="0" y="0" width="248" height="156" />
          <g style={{ fill: 'var(--window-bg)', stroke: 'var(--separator)' }}>
            <rect x="16" y="18" width="60" height="120" rx="8" />
            <rect x="94" y="18" width="60" height="120" rx="8" />
            <rect x="172" y="18" width="60" height="120" rx="8" />
          </g>
          <rect style={{ fill: 'var(--tint-blue)' }} x="24" y="28" width="44" height="28" rx="6" />
          <rect style={{ fill: 'var(--control-stroke)' }} x="24" y="64" width="32" height="5" rx="2.5" />
          <rect style={{ fill: 'var(--separator)' }} x="24" y="75" width="44" height="5" rx="2.5" />
          <rect style={{ fill: 'var(--accent-fill)' }} x="24" y="116" width="44" height="12" rx="6" />
          <rect style={{ fill: 'var(--tint-purple)' }} x="102" y="28" width="44" height="44" rx="6" />
          <rect style={{ fill: 'var(--control-stroke)' }} x="102" y="80" width="38" height="5" rx="2.5" />
          <rect style={{ fill: 'var(--separator)' }} x="102" y="91" width="44" height="5" rx="2.5" />
          <circle style={{ fill: 'var(--tint-green)' }} cx="202" cy="54" r="15" />
          <path
            style={{ stroke: 'var(--tint-green-text)' }}
            d="m195 54 5 5 9-10"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect style={{ fill: 'var(--control-stroke)' }} x="182" y="82" width="40" height="5" rx="2.5" />
          <path
            style={{ stroke: 'var(--accent)' }}
            d="M76 122 C 84 122, 86 106, 94 106 M154 122 C 162 122, 164 106, 172 106"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </svg>
      </div>
    )
  }
  return (
    <div className="mkt-hero__art" aria-hidden="true">
      <svg aria-hidden="true" viewBox="0 0 248 156">
        <rect style={{ fill: 'var(--content-bg)' }} width="248" height="156" />
        <rect style={{ fill: 'var(--bubble-out)' }} x="96" y="16" width="136" height="28" rx="12" />
        <rect
          style={{ fill: 'var(--tint-blue-text)', opacity: 0.45 }}
          x="112"
          y="27"
          width="96"
          height="6"
          rx="3"
        />
        <rect style={{ fill: 'var(--tint-blue)' }} x="16" y="58" width="22" height="22" rx="6" />
        <rect
          style={{ fill: 'var(--window-bg)', stroke: 'var(--separator)' }}
          x="46"
          y="56"
          width="186"
          height="84"
          rx="10"
        />
        <rect style={{ fill: 'var(--accent)' }} x="58" y="70" width="3" height="24" rx="1.5" />
        <rect style={{ fill: 'var(--control-stroke)' }} x="70" y="73" width="92" height="6" rx="3" />
        <rect style={{ fill: 'var(--separator)' }} x="70" y="85" width="64" height="5" rx="2.5" />
        <rect style={{ fill: 'var(--system-purple)' }} x="58" y="104" width="3" height="24" rx="1.5" />
        <rect style={{ fill: 'var(--control-stroke)' }} x="70" y="107" width="76" height="6" rx="3" />
        <rect style={{ fill: 'var(--separator)' }} x="70" y="119" width="52" height="5" rx="2.5" />
      </svg>
    </div>
  )
}

/** 精选推荐 home view: featured hero cards + 3 shelves. */
export function MarketHomeView({
  listings,
  loading,
  error,
  canInstallDirectly,
  intro = false,
  onRetry,
  onOpen,
  onAction,
  onViewScene,
  onPublish,
}: {
  listings: MarketListingView[] | null
  loading: boolean
  error: string
  canInstallDirectly: boolean
  /** Listings just arrived: cards stagger in once. */
  intro?: boolean
  onRetry: () => void
  onOpen: (l: MarketListingView) => void
  onAction: (l: MarketListingView, action: CardActionKind) => void
  onViewScene: (scene: 'all' | MarketScene) => void
  onPublish: () => void
}) {
  if (error && !listings) {
    return (
      <div className="mkt-content">
        <div className="mkt-empty-box">
          <EmptyState
            icon="warning"
            title={error}
            action={
              <Button size="small" onClick={onRetry}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  if (!listings) {
    return (
      <div className="mkt-content">
        <div className="mkt-head">
          <div className="mkt-head__titles">
            <h1 className="mkt-head__title">{t('精选推荐')}</h1>
            <p className="mkt-head__sub">{t('给 Bot 和群装上插件，让它会做更多事。')}</p>
          </div>
        </div>
        <Skeleton variant="block" count={6} height={156} className="mkt-cards" />
      </div>
    )
  }

  if (listings.length === 0) {
    return (
      <div className="mkt-content">
        <div className="mkt-head">
          <div className="mkt-head__titles">
            <h1 className="mkt-head__title">{t('精选推荐')}</h1>
            <p className="mkt-head__sub">{t('给 Bot 和群装上插件，让它会做更多事。')}</p>
          </div>
          <Button icon="plus" onClick={onPublish}>
            {t('发布插件')}
          </Button>
        </div>
        <div className="mkt-empty-box">
          <EmptyState
            illustration={<ComingSoonArt />}
            title={t('插件市场里还没有插件')}
            description={t('在「我的发布」里发布团队插件，审核通过后会出现在这里。')}
            action={
              <Button variant="primary" onClick={onPublish}>
                {t('去发布')}
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  // Pick up to 2 featured hero plugins (prefer explicitly featured, then creation + connect official picks).
  const explicitFeatured = listings.filter((l) => l.featured)
  const fallbackFeatured = [
    listings.find((l) => sceneOfListing(l) === 'create'),
    listings.find((l) => sceneOfListing(l) === 'connect'),
    ...listings,
  ].filter((l): l is MarketListingView => !!l)
  const heroPicks: MarketListingView[] = []
  for (const cand of [...explicitFeatured, ...fallbackFeatured]) {
    if (heroPicks.length >= 2) break
    if (!heroPicks.some((x) => x.id === cand.id)) heroPicks.push(cand)
  }

  const connectShelf = listings.filter((l) => sceneOfListing(l) === 'connect').slice(0, 3)
  const teamShelf = [...listings]
    .sort((a, b) => (b.teamGroupsCount ?? b.installs) - (a.teamGroupsCount ?? a.installs))
    .slice(0, 3)
  const latestShelf = [...listings]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3)

  return (
    <div className="mkt-content" aria-busy={loading || undefined}>
      <section className="mkt-head">
        <div className="mkt-head__titles">
          <h1 className="mkt-head__title">{t('精选推荐')}</h1>
          <p className="mkt-head__sub">{t('给 Bot 和群装上插件，让它会做更多事。')}</p>
        </div>
        <Button icon="plus" onClick={onPublish}>
          {t('发布插件')}
        </Button>
      </section>

      {heroPicks.length ? (
        <section className={cx('mkt-featured', intro && 'mkt-cards--intro')} aria-label={t('精选推荐')}>
          {heroPicks.map((l, idx) => {
            const scene = sceneOfListing(l)
            const caps = capabilitiesOfListing(l)
            const ready = readinessOfListing(l)
            const action = cardActionOf(l, canInstallDirectly)
            const ctaLabel =
              action === 'configure'
                ? t('去配置')
                : action === 'installed'
                  ? t('去使用')
                  : action === 'request'
                    ? t('申请添加')
                    : t('添加')
            const ctaClass =
              action === 'configure' ? 'mkt-btn-warn' : action === 'request' ? 'mkt-btn-soft' : undefined
            return (
              <article key={l.id} className="mkt-hero">
                <div className="mkt-hero__copy">
                  <div className="mkt-hero__kicker">
                    {t('{source}主推 · {scene}', {
                      source: SOURCE_LABEL[l.source],
                      scene: SCENE_MAP[scene].label,
                    })}
                  </div>
                  <button type="button" className="mkt-hero__title" onClick={() => onOpen(l)}>
                    {l.title}
                  </button>
                  <p className="mkt-hero__desc">{l.description || t('（没有描述）')}</p>
                  <div className="mkt-hero__chips">
                    <CapabilityChips capabilities={caps} readiness={ready} />
                  </div>
                  <div className="mkt-hero__foot">
                    <span
                      className={`mkt-hero__meta${action === 'configure' ? ' mkt-hero__meta--warn' : ''}`}
                    >
                      <Icon name={action === 'configure' ? 'lock' : 'person-2'} size={12} />
                      {action === 'configure' ? t('有群待配置') : usageLabel(l)}
                    </span>
                    <Button
                      size="small"
                      variant={action === 'add' || action === 'installed' ? 'primary' : 'default'}
                      className={ctaClass}
                      onClick={() => (action === 'installed' ? onOpen(l) : onAction(l, action))}
                    >
                      {ctaLabel}
                    </Button>
                  </div>
                </div>
                <HeroArt variant={scene === 'connect' || idx === 1 ? 'connect' : 'create'} />
              </article>
            )
          })}
        </section>
      ) : null}

      {connectShelf.length ? (
        <section className="mkt-shelf" aria-label={t('连接你的常用工具')}>
          <div className="mkt-shelf__head">
            <h2 className="mkt-shelf__title">
              {t('连接你的常用工具')}
              <span className="mkt-shelf__sub">{t('让 Bot 用上外部系统里的数据')}</span>
            </h2>
            <Button variant="plain" size="small" onClick={() => onViewScene('connect')}>
              {t('查看全部')}
            </Button>
          </div>
          <ul className={cx('mkt-cards', intro && 'mkt-cards--intro')}>
            {connectShelf.map((l) => (
              <PluginCard
                key={l.id}
                listing={l}
                canInstallDirectly={canInstallDirectly}
                onOpen={onOpen}
                onAction={onAction}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mkt-shelf" aria-label={t('本团队正在用')}>
        <div className="mkt-shelf__head">
          <h2 className="mkt-shelf__title">
            {t('本团队正在用')}
            <span className="mkt-shelf__sub">{t('按启用的群数排序')}</span>
          </h2>
          <Button variant="plain" size="small" onClick={() => onViewScene('all')}>
            {t('查看全部')}
          </Button>
        </div>
        <ul className={cx('mkt-cards', intro && 'mkt-cards--intro')}>
          {teamShelf.map((l) => (
            <PluginCard
              key={l.id}
              listing={l}
              canInstallDirectly={canInstallDirectly}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))}
        </ul>
      </section>

      <section className="mkt-shelf" aria-label={t('最新上架')}>
        <div className="mkt-shelf__head">
          <h2 className="mkt-shelf__title">{t('最新上架')}</h2>
          <Button variant="plain" size="small" onClick={() => onViewScene('all')}>
            {t('查看全部')}
          </Button>
        </div>
        <ul className={cx('mkt-cards', intro && 'mkt-cards--intro')}>
          {latestShelf.map((l) => (
            <PluginCard
              key={l.id}
              listing={l}
              canInstallDirectly={canInstallDirectly}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}

/** 全部插件 & 5 大场景分类 view with source/capability segmented filters + sort + empty search state. */
export function MarketCatalogView({
  scene,
  query,
  source,
  capability,
  sort,
  listings,
  loading,
  error,
  canInstallDirectly,
  intro = false,
  onSource,
  onCapability,
  onSort,
  onClear,
  onRetry,
  onOpen,
  onAction,
  onPublish,
}: {
  scene: 'all' | MarketScene
  query: string
  source: SourceFilter
  capability: CapabilityFilter
  sort: SortMode
  listings: MarketListingView[] | null
  loading: boolean
  error: string
  canInstallDirectly: boolean
  /** Listings just arrived: cards stagger in once. */
  intro?: boolean
  onSource: (v: SourceFilter) => void
  onCapability: (v: CapabilityFilter) => void
  onSort: (v: SortMode) => void
  onClear: () => void
  onRetry: () => void
  onOpen: (l: MarketListingView) => void
  onAction: (l: MarketListingView, action: CardActionKind) => void
  onPublish: () => void
}) {
  const title = scene === 'all' ? t('全部插件') : SCENE_MAP[scene].label
  const subtitle =
    scene === 'all'
      ? t('只展示能直接给群和 Bot 使用的能力插件；引擎和模型预设已归入电脑设置。')
      : SCENE_MAP[scene].description
  const trimmedQ = query.trim()
  const filtered = scene !== 'all' || source !== 'all' || capability !== 'all' || !!trimmedQ

  return (
    <div className="mkt-content">
      <section className="mkt-head">
        <div className="mkt-head__titles">
          <h1 className="mkt-head__title">
            {title}
            {listings ? <span className="mkt-count-pill">{listings.length}</span> : null}
          </h1>
          <p className="mkt-head__sub">{subtitle}</p>
        </div>
        <Button icon="plus" onClick={onPublish}>
          {t('发布插件')}
        </Button>
      </section>

      <section className="mkt-filters" aria-label={t('筛选')}>
        <SegmentedControl<SourceFilter>
          aria-label={t('来源筛选')}
          size="small"
          value={source}
          onChange={onSource}
          items={[
            { value: 'all', label: t('全部来源') },
            { value: 'official', label: SOURCE_LABEL.official },
            { value: 'team', label: SOURCE_LABEL.team },
            { value: 'public', label: SOURCE_LABEL.public },
          ]}
        />
        <SegmentedControl<CapabilityFilter>
          aria-label={t('能力筛选')}
          size="small"
          value={capability}
          onChange={onCapability}
          items={[
            { value: 'all', label: t('全部能力') },
            { value: 'do', label: CAPABILITY_META.do.label },
            { value: 'connect', label: CAPABILITY_META.connect.label },
            { value: 'create', label: CAPABILITY_META.create.label },
          ]}
        />
        <div className="mkt-filters__sort">
          <PopUpButton<SortMode>
            aria-label={t('排序')}
            size="small"
            value={sort}
            onChange={onSort}
            options={[
              { value: 'team', label: t('团队最常用') },
              { value: 'installs', label: t('最多添加') },
              { value: 'latest', label: t('最新上架') },
            ]}
          />
        </div>
      </section>

      {error && !listings ? (
        <div className="mkt-empty-box">
          <EmptyState
            icon="warning"
            title={error}
            action={
              <Button size="small" onClick={onRetry}>
                {t('重试')}
              </Button>
            }
          />
        </div>
      ) : !listings ? (
        <Skeleton variant="block" count={6} height={156} className="mkt-cards" />
      ) : listings.length ? (
        <ul
          className={cx('mkt-cards', intro ? 'mkt-cards--intro' : 'mkt-cards--fade')}
          aria-label={t('插件列表')}
          aria-busy={loading || undefined}
        >
          {listings.map((l) => (
            <PluginCard
              key={l.id}
              listing={l}
              canInstallDirectly={canInstallDirectly}
              onOpen={onOpen}
              onAction={onAction}
            />
          ))}
        </ul>
      ) : (
        <div className="mkt-empty-box">
          <EmptyState
            illustration={filtered ? <NoResultsArt /> : <ComingSoonArt />}
            title={
              trimmedQ
                ? t('没有找到与「{q}」匹配的插件', { q: trimmedQ })
                : filtered
                  ? t('没有符合条件的插件')
                  : t('插件市场里还没有插件')
            }
            description={
              filtered
                ? t('换个关键词试试，或直接发布一个团队专属插件。')
                : t('在「我的发布」里发布团队插件，审核通过后会出现在这里。')
            }
            action={
              <div className="mkt-empty-acts">
                {filtered ? (
                  <Button variant="primary" onClick={onClear}>
                    {t('清除筛选看全部')}
                  </Button>
                ) : null}
                <Button variant={filtered ? 'default' : 'primary'} onClick={onPublish}>
                  {t('发布一个新插件')}
                </Button>
              </div>
            }
          />
        </div>
      )}
    </div>
  )
}
