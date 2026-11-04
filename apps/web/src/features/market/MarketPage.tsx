import type { ListingType, MarketListingDto, MarketSource } from '@gonggong/protocol'
import { type ComponentProps, useState } from 'react'
import { useSearchParams } from 'react-router'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import {
  Button,
  Drawer,
  EmptyState,
  Presence,
  SearchField,
  SegmentedControl,
  Spinner,
  Tabs,
  Tag,
} from '../../ui'
import { TYPE_LABEL } from './InstallList'
import { InstallRequests } from './InstallRequests'
import { InstallTargetDialog } from './InstallTargetDialog'
import { byline, ListingDetail, SOURCE_LABEL } from './ListingDetail'
import { MyListings } from './MyListings'
import '../works/works.css'
import './market.css'

const TABS = ['market', 'requests', 'mine'] as const
type Tab = (typeof TABS)[number]
type TypeFilter = 'all' | ListingType
type SourceFilter = 'all' | MarketSource

const marketPath = (q: string, type: TypeFilter, source: SourceFilter) => {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  if (type !== 'all') params.set('type', type)
  if (source !== 'all') params.set('source', source)
  const s = params.toString()
  return s ? `/market?${s}` : '/market'
}

/**
 * 市场: listings with an approved version I may see, their details and 引入到…; 引入申请 to decide or follow;
 * 我的发布 for authors. `?tab=` opens one (notifications link to it).
 */
export function MarketPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.find((x) => x === params.get('tab')) ?? 'market'
  const setTab = (next: Tab) => setParams(next === 'market' ? {} : { tab: next }, { replace: true })
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TypeFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [open, setOpen] = useState<MarketListingDto | null>(null)
  const [installing, setInstalling] = useState<ComponentProps<typeof InstallTargetDialog>['listing'] | null>(
    null,
  )
  const { data, error } = useGet<MarketListingDto[]>(
    tab === 'market' ? marketPath(query, type, source) : null,
  )

  return (
    <section className="works" aria-label={t('市场')}>
      <header className="works__head">
        <h1 className="works__title">{t('市场')}</h1>
        <Tabs
          aria-label={t('市场')}
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'market', label: t('全部条目') },
            { value: 'requests', label: t('引入申请#tab') },
            { value: 'mine', label: t('我的发布') },
          ]}
        />
      </header>
      {tab === 'mine' ? (
        <div className="mkt-body">
          <MyListings />
        </div>
      ) : tab === 'requests' ? (
        <div className="mkt-body">
          <InstallRequests />
        </div>
      ) : (
        <>
          <div className="works__head mkt-filters">
            <SegmentedControl<TypeFilter>
              aria-label={t('类型')}
              size="small"
              value={type}
              onChange={setType}
              items={[
                { value: 'all', label: t('全部') },
                { value: 'skill', label: 'Skill' },
                { value: 'plugin', label: t('插件') },
              ]}
            />
            <SegmentedControl<SourceFilter>
              aria-label={t('来源')}
              size="small"
              value={source}
              onChange={setSource}
              items={[
                { value: 'all', label: t('全部') },
                { value: 'official', label: SOURCE_LABEL.official },
                { value: 'team', label: SOURCE_LABEL.team },
                { value: 'public', label: SOURCE_LABEL.public },
              ]}
            />
            <span className="spacer" />
            <SearchField
              className="works__search"
              placeholder={t('搜索市场')}
              aria-label={t('搜索市场')}
              value={query}
              onChange={setQuery}
            />
          </div>
          {error && !data ? (
            <div className="works__center">{error}</div>
          ) : !data ? (
            <div className="works__center">
              <Spinner />
            </div>
          ) : data.length ? (
            <ul className="works__grid" aria-label={t('市场')}>
              {data.map((l) => (
                <li key={l.id} className="works__card">
                  <button
                    type="button"
                    className="mkt-card"
                    aria-label={t('查看 {name}', { name: l.title })}
                    onClick={() => setOpen(l)}
                  >
                    <span className="mkt-card__head">
                      <strong className="works__name" title={l.title}>
                        {l.title}
                      </strong>
                      <Tag tone="blue">{TYPE_LABEL[l.type]}</Tag>
                    </span>
                    <span className="works__meta">{byline(l)}</span>
                    <span className="mkt-card__desc">{l.description}</span>
                    <span className="works__tags">
                      {l.agents.map((a) => (
                        <Tag key={a}>{a}</Tag>
                      ))}
                      <span className="mkt-card__count">{t('{n} 次引入', { n: l.installs })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="tag" title={t('没有符合条件的条目')} />
          )}
        </>
      )}
      <Drawer open={!!open} title={open?.title ?? ''} onClose={() => setOpen(null)}>
        {open ? (
          <ListingDetail
            id={open.id}
            actions={({ listedVersionId, listedRevision, ...d }) =>
              d.status === 'listed' && listedVersionId && listedRevision !== null ? (
                <Button
                  size="small"
                  variant="primary"
                  onClick={() => setInstalling({ ...d, listedVersionId, listedRevision })}
                >
                  {t('引入到…')}
                </Button>
              ) : null
            }
          />
        ) : null}
      </Drawer>
      <Presence>
        {installing ? <InstallTargetDialog listing={installing} onClose={() => setInstalling(null)} /> : null}
      </Presence>
    </section>
  )
}
