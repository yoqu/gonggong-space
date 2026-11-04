import type { InstallRequestDto, ListingType, MarketListingDto, MarketSource } from '@gonggong/protocol'
import { type ComponentProps, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import {
  Button,
  Drawer,
  EmptyState,
  Icon,
  PopUpButton,
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
import { byline, ListingDetail, ListingIcon, SOURCE_LABEL } from './ListingDetail'
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

type Sort = 'recent' | 'installs'

/** The search box settles before it asks the server, so typing doesn't fire a request per key. */
function useSettled<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return settled
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
  const [sort, setSort] = useState<Sort>('recent')
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null)
  const [installing, setInstalling] = useState<ComponentProps<typeof InstallTargetDialog>['listing'] | null>(
    null,
  )
  const q = useSettled(query)
  const { data, error } = useGet<MarketListingDto[]>(tab === 'market' ? marketPath(q, type, source) : null)
  // Keep the last results on screen while the next filter loads, instead of flashing a spinner.
  const last = useRef<MarketListingDto[] | null>(null)
  if (data) last.current = data
  const shown = data ?? last.current
  const todoList = useGet<InstallRequestDto[]>('/install-requests?view=todo')
  const todo = todoList.data?.length ?? 0
  const filtered = type !== 'all' || source !== 'all' || !!query.trim()
  const clear = () => {
    setType('all')
    setSource('all')
    setQuery('')
  }
  const sorted = shown && sort === 'installs' ? [...shown].sort((a, b) => b.installs - a.installs) : shown

  return (
    <section className="works" aria-label={t('市场')}>
      <header className="works__head">
        <h1 className="works__title">{t('市场')}</h1>
        <span className="spacer" />
        <Tabs
          aria-label={t('市场')}
          size="sm"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'market', label: t('全部条目') },
            {
              value: 'requests',
              label: (
                <>
                  {t('引入申请#tab')}
                  {todo ? (
                    <span className="mkt-tab-count" aria-hidden="true">
                      {todo}
                    </span>
                  ) : null}
                </>
              ),
            },
            { value: 'mine', label: t('我的发布') },
          ]}
        />
      </header>
      {tab === 'mine' ? (
        <div className="mkt-body">
          <div className="mkt-body__inner">
            <MyListings onOpen={(l) => setOpen(l)} />
          </div>
        </div>
      ) : tab === 'requests' ? (
        <div className="mkt-body">
          <div className="mkt-body__inner">
            <InstallRequests onDecided={todoList.reload} />
          </div>
        </div>
      ) : (
        <>
          <div className="works__bar">
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
            <PopUpButton<Sort>
              aria-label={t('排序')}
              size="small"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'recent', label: t('最近更新') },
                { value: 'installs', label: t('引入最多') },
              ]}
            />
            <span className="spacer" />
            <SearchField
              className="works__search"
              placeholder={t('搜索名称或描述')}
              aria-label={t('搜索市场')}
              value={query}
              onChange={setQuery}
            />
          </div>
          {error && !data ? (
            <div className="works__center">
              <EmptyState icon="warning" title={error} />
            </div>
          ) : !sorted ? (
            <div className="works__center">
              <Spinner />
            </div>
          ) : sorted.length ? (
            <ul className="works__grid mkt-grid" aria-label={t('市场')} aria-busy={!data}>
              {sorted.map((l) => (
                <li key={l.id} className="works__card">
                  <button
                    type="button"
                    className="mkt-card"
                    aria-label={t('查看 {name}', { name: l.title })}
                    onClick={() => setOpen(l)}
                  >
                    <span className="mkt-card__head">
                      <ListingIcon type={l.type} />
                      <span className="mkt-card__titles">
                        <strong className="works__name" title={l.title}>
                          {l.title}
                        </strong>
                        <span className="works__meta">
                          {l.source === 'official' ? (
                            <Icon name="shield-check" size={12} className="mkt-official" />
                          ) : null}
                          {byline(l)}
                        </span>
                      </span>
                      <Tag tone="blue">{TYPE_LABEL[l.type]}</Tag>
                    </span>
                    <span className="mkt-card__desc">{l.description || t('（没有描述）')}</span>
                    <span className="mkt-card__foot">
                      {l.agents.map((a) => (
                        <Tag key={a}>{a}</Tag>
                      ))}
                      <span className="mkt-card__count" title={t('{n} 次引入', { n: l.installs })}>
                        <Icon name="download" size={12} />
                        {t('{n} 次引入', { n: l.installs })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="works__center">
              <EmptyState
                icon="tag"
                title={filtered ? t('没有符合条件的条目') : t('市场里还没有条目')}
                description={
                  filtered ? undefined : t('在「我的发布」里发布 Skill 或插件，审核通过后会出现在这里')
                }
                action={
                  filtered ? (
                    <Button size="small" onClick={clear}>
                      {t('清除筛选')}
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => setTab('mine')}>
                      {t('去发布')}
                    </Button>
                  )
                }
              />
            </div>
          )}
        </>
      )}
      <Drawer open={!!open} title={open?.title ?? ''} width={600} onClose={() => setOpen(null)}>
        {open ? (
          <ListingDetail
            id={open.id}
            actions={({ listedVersionId, listedRevision, ...d }) =>
              d.status === 'listed' && listedVersionId && listedRevision !== null ? (
                <Button
                  size="small"
                  variant="primary"
                  icon="download"
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
