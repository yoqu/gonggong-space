import type { InstallDto, ListingSummary, MarketListingDto } from '@gonggong/protocol'
import { StatusTag, statusNote, TYPE_LABEL, targetLabels, VersionTags } from '@web/features/market/status'
import { Alert, Button, Drawer, EmptyState, GroupBox, GroupRow, SearchField, Skeleton, Tag } from '@web/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { fail, Section } from '../lib/ui'
import type { PageProps } from '.'

type Load<T> = { data: T[] } | { error: string } | null

/** The tauri command's error, with the HTTP client's wording for an unreachable server put plainly. */
const errorText = (e: unknown) =>
  /error sending request|connection refused|timed out|dns error/i.test(String(e))
    ? t('连不上服务器，请检查网络后刷新')
    : String(e)

function useLoad<T>(load: () => Promise<T[]>, version: number): Load<T> {
  const [state, setState] = useState<Load<T>>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` asks for a reload
  useEffect(() => {
    load().then(
      (data) => setState({ data }),
      (e) => setState({ error: errorText(e) }),
    )
  }, [load, version])
  return state
}

const OpenButton = () => (
  <Button size="small" onClick={() => ipc.openMarketInWeb().catch(fail)}>
    {t('在网页中打开')}
  </Button>
)

const matches = (l: ListingSummary, q: string) =>
  !q || [l.title, l.name, l.description].some((s) => s.toLowerCase().includes(q))

function List<T>({
  state,
  query,
  listing,
  empty,
  noMatch,
  className,
  row,
}: {
  state: Load<T>
  query: string
  listing: (item: T) => ListingSummary
  empty: string
  noMatch: string
  className: string
  row: (item: T) => ReactNode
}) {
  if (!state) return <Skeleton count={2} />
  if ('error' in state) return <Alert variant="error" title={t('加载失败')} description={state.error} />
  const shown = state.data.filter((x) => matches(listing(x), query))
  return (
    <GroupBox className={className}>
      {state.data.length === 0 ? (
        <EmptyState compact icon="tag" title={empty} action={<OpenButton />} />
      ) : shown.length === 0 ? (
        <EmptyState compact icon="search" title={noMatch} />
      ) : (
        shown.map(row)
      )}
    </GroupBox>
  )
}

type Open = { listing: ListingSummary; install?: InstallDto; market?: MarketListingDto }

/** A listing read-only: what the list rows hold, and the way to it on the Web, where it is managed. */
function Detail({ open, onClose }: { open: Open; onClose: () => void }) {
  const { listing: l, install: i, market: m } = open
  const note = i ? statusNote(i) : null
  return (
    <Drawer open title={l.title} onClose={onClose}>
      <div className="dk-detail">
        <span className="dk-row__title">
          <Tag tone="blue">{TYPE_LABEL[l.type]}</Tag>
          <StatusTag status={l.status} />
        </span>
        <p className="dk-sub">{l.description}</p>
        {note ? <Alert variant={l.status === 'banned' ? 'error' : 'warning'} title={note} /> : null}
        <GroupBox>
          <GroupRow label={t('最新版本')} value={`r${m?.listedRevision ?? l.revision}`} />
          {i ? (
            <GroupRow label={t('我的 Skill')}>
              <span className="dk-row__title">
                <VersionTags install={i} />
                <Tag tone={i.enabled ? 'green' : 'gray'}>{i.enabled ? t('已启用') : t('已停用')}</Tag>
              </span>
            </GroupRow>
          ) : null}
          {m?.author || m?.teamName ? (
            <GroupRow label={t('作者')} value={[m.author, m.teamName].filter(Boolean).join(' · ')} />
          ) : null}
          {m ? <GroupRow label={t('引入次数')} value={m.installs} /> : null}
          {m?.agents.length ? <GroupRow label="Agent" value={m.agents.join(t('、'))} /> : null}
          {m?.installedIn?.length ? (
            <GroupRow label={t('已引入到')} value={targetLabels(m.installedIn)} wideValue />
          ) : null}
        </GroupBox>
        <p className="dk-sub">{t('引入、升级、移除与申请请在网页端操作。')}</p>
        <Button variant="primary" onClick={() => ipc.openMarketInWeb(l.id).catch(fail)}>
          {t('在网页中查看详情')}
        </Button>
      </div>
    </Drawer>
  )
}

/** 市场: the owner's personal skills and the market, read-only; installing, publishing and review stay on the Web. */
export function MarketPage(_: PageProps) {
  const [version, setVersion] = useState(0)
  const installs = useLoad(ipc.marketInstalls, version)
  const listings = useLoad(ipc.marketListings, version)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Open | null>(null)
  const q = query.trim().toLowerCase()
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const marketOf = (id: string) =>
    (listings && 'data' in listings ? listings.data : []).find((l) => l.id === id)
  return (
    <>
      <div className="dk-search">
        <SearchField
          className="dk-search__field"
          placeholder={t('搜索 Skill 和插件')}
          value={query}
          onChange={setQuery}
        />
        <Button size="small" onClick={reload}>
          {t('刷新')}
        </Button>
        <OpenButton />
      </div>
      <Section title={t('我的 Skill')}>
        <List<InstallDto>
          state={installs}
          query={q}
          listing={(i) => i.listing}
          className="dk-mine"
          empty={t('「我的 Skill」里还没有条目')}
          noMatch={t('「我的 Skill」里没有匹配的条目')}
          row={(i) => {
            const note = statusNote(i)
            return (
              <button
                type="button"
                key={i.listing.id}
                className="dk-row dk-row--button"
                onClick={() => setOpen({ listing: i.listing, install: i, market: marketOf(i.listing.id) })}
              >
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong dk-ellipsis">{i.listing.title}</span>
                    <Tag tone="blue">{TYPE_LABEL[i.listing.type]}</Tag>
                    <VersionTags install={i} />
                  </span>
                  <span className="dk-sub dk-ellipsis">{i.listing.description}</span>
                  {note ? <span className="dk-sub">{note}</span> : null}
                </div>
                <Tag tone={i.enabled ? 'green' : 'gray'}>{i.enabled ? t('已启用') : t('已停用')}</Tag>
              </button>
            )
          }}
        />
      </Section>
      <Section title={t('市场')}>
        <List<MarketListingDto>
          state={listings}
          query={q}
          listing={(l) => l}
          className="dk-market"
          empty={t('市场里还没有条目')}
          noMatch={t('没有匹配的条目')}
          row={(l) => (
            <button
              type="button"
              key={l.id}
              className="dk-row dk-row--button"
              onClick={() => setOpen({ listing: l, market: l })}
            >
              <div className="dk-row__main">
                <span className="dk-row__title">
                  <span className="dk-strong dk-ellipsis">{l.title}</span>
                  <Tag tone="blue">{TYPE_LABEL[l.type]}</Tag>
                  {l.installedIn?.length ? <Tag tone="green">{t('已引入')}</Tag> : null}
                </span>
                <span className="dk-sub">{l.description}</span>
                <span className="dk-sub dk-ellipsis">
                  {[l.author, l.teamName, t('{n} 次引入', { n: l.installs })].filter(Boolean).join(' · ')}
                </span>
              </div>
            </button>
          )}
        />
      </Section>
      {open ? <Detail open={open} onClose={() => setOpen(null)} /> : null}
    </>
  )
}
