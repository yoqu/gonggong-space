import type { InstallDto, ListingSummary, MarketListingDto } from '@gonggong/protocol'
import { Alert, Button, EmptyState, GroupBox, Skeleton, Tag } from '@web/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { fail, Section } from '../lib/ui'
import type { PageProps } from '.'

const TYPE: Record<ListingSummary['type'], string> = { skill: 'Skill', plugin: t('插件#type') }

function StatusTag({ status }: { status: ListingSummary['status'] }) {
  if (status === 'unlisted') return <Tag tone="orange">{t('已下架')}</Tag>
  if (status === 'banned') return <Tag tone="red">{t('已封禁')}</Tag>
  return null
}

type Load<T> = { data: T[] } | { error: string } | null

function useLoad<T>(load: () => Promise<T[]>): Load<T> {
  const [state, setState] = useState<Load<T>>(null)
  useEffect(() => {
    load().then(
      (data) => setState({ data }),
      (e) => setState({ error: String(e) }),
    )
  }, [load])
  return state
}

const open = () => ipc.openMarketInWeb().catch(fail)
const OpenButton = () => (
  <Button size="small" onClick={open}>
    {t('在网页中打开')}
  </Button>
)

function List<T>({
  state,
  empty,
  className,
  row,
}: {
  state: Load<T>
  empty: string
  className: string
  row: (item: T) => ReactNode
}) {
  if (!state) return <Skeleton count={2} />
  if ('error' in state) return <Alert variant="error" title={t('加载失败')} description={state.error} />
  return (
    <GroupBox className={className}>
      {state.data.length === 0 ? (
        <EmptyState compact icon="tag" title={empty} action={<OpenButton />} />
      ) : (
        state.data.map(row)
      )}
    </GroupBox>
  )
}

/** Skill: the owner's personal skills and the market, read-only; installing, publishing and review stay on the Web. */
export function MarketPage(_: PageProps) {
  const installs = useLoad(ipc.marketInstalls)
  const listings = useLoad(ipc.marketListings)
  return (
    <>
      <Section title={t('我的个人 Skill')} aside={<OpenButton />}>
        <List<InstallDto>
          state={installs}
          className="dk-mine"
          empty={t('还没有个人 Skill')}
          row={(i) => (
            <div key={i.listing.id} className="dk-row">
              <div className="dk-row__main">
                <span className="dk-row__title">
                  <span className="dk-strong dk-ellipsis">{i.listing.title}</span>
                  <Tag tone="blue">{TYPE[i.listing.type]}</Tag>
                  <Tag tone="gray">
                    {i.pinVersionId ? t('锁定 r{n}', { n: i.resolvedRevision }) : t('跟随最新')}
                  </Tag>
                  <StatusTag status={i.listing.status} />
                </span>
                <span className="dk-sub dk-ellipsis">{i.listing.description}</span>
              </div>
              <Tag tone={i.enabled ? 'green' : 'gray'}>{i.enabled ? t('已启用') : t('已停用')}</Tag>
            </div>
          )}
        />
      </Section>
      <Section title={t('市场')}>
        <List<MarketListingDto>
          state={listings}
          className="dk-market"
          empty={t('市场里还没有条目')}
          row={(l) => (
            <div key={l.id} className="dk-row">
              <div className="dk-row__main">
                <span className="dk-row__title">
                  <span className="dk-strong dk-ellipsis">{l.title}</span>
                  <Tag tone="blue">{TYPE[l.type]}</Tag>
                </span>
                <span className="dk-sub">{l.description}</span>
                <span className="dk-sub dk-ellipsis">
                  {[l.author, l.teamName, t('{n} 次安装', { n: l.installs })].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>
          )}
        />
      </Section>
    </>
  )
}
