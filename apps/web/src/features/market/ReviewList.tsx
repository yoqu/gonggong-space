import type { MarketListingDetailDto, ReviewItemDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Alert, Button, Disclosure, EmptyState, Spinner, Tag, TextField, toast } from '../../ui'
import { byline, ListingDetail, ListingIcon } from './ListingDetail'
import { VersionDiff } from './VersionDiff'
import '../config/config.css'
import './market.css'
import './market-manage.css'

/**
 * 上架审核工作台: left pending queue + right review pane (card summary, security & permission audit,
 * file diff, collapsible full inspector, inline approve/reject decision bar).
 * Used both in MarketPage and embedded in ConfigPage / TeamAdminTabs.
 */
export function MarketReviewList({
  path,
  queueLabel,
  onReviewed,
  onBackMarket,
}: {
  path: string
  queueLabel?: string
  onReviewed?: () => void
  onBackMarket?: () => void
}) {
  const { data, error, loading, reload } = useGet<ReviewItemDto[]>(path)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const first = data?.[0]
    if (!first) setSelectedId(null)
    else if (!data.some((x) => x.version.id === selectedId)) setSelectedId(first.version.id)
  }, [data, selectedId])

  if (!data) {
    return error ? <Alert variant="error" title={error} retrying={loading} onRetry={reload} /> : <Spinner />
  }

  if (data.length === 0) {
    return (
      <div className="mkt-empty-box">
        <EmptyState
          icon="checkmark-circle"
          title={onBackMarket ? t('待审核队列已清空') : t('没有待审核的版本')}
          description={t('所有提交的插件版本都已处理完成，团队成员现在可以在市场中看到最新上架的插件。')}
          action={
            onBackMarket ? (
              <Button variant="primary" onClick={onBackMarket}>
                {t('去市场看看')}
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  const active = data.find((x) => x.version.id === selectedId) ?? data[0]
  if (!active) return null

  return (
    <section className="mkt-review-work" aria-label={t('上架审核工作台')}>
      <aside className="mkt-review-queue" aria-label={t('待审核队列')}>
        <div className="mkt-review-queue__title">
          {queueLabel
            ? t('{label} · {n} 条待审', { label: queueLabel, n: data.length })
            : t('{n} 条待审核', { n: data.length })}
        </div>
        {data.map((r) => {
          const on = r.version.id === active.version.id
          return (
            <button
              key={r.version.id}
              type="button"
              className={`mkt-q-item${on ? ' mkt-q-item--on' : ''}`}
              aria-current={on ? 'true' : undefined}
              onClick={() => setSelectedId(r.version.id)}
            >
              <ListingIcon type={r.listing.type} size={36} listing={r.listing} />
              <div>
                <div className="mkt-row__name">
                  {r.listing.title} r{r.version.revision}
                </div>
                <div className="mkt-row__meta">
                  {[r.version.createdBy || byline(r.listing), ago(r.version.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </button>
          )
        })}
      </aside>

      <ReviewWorkbenchPane
        key={active.version.id}
        item={active}
        onDone={() => {
          reload()
          onReviewed?.()
        }}
      />
    </section>
  )
}

function ReviewWorkbenchPane({ item, onDone }: { item: ReviewItemDto; onDone: () => void }) {
  const detail = useGet<MarketListingDetailDto>(
    `/market/${item.listing.id}?versionId=${encodeURIComponent(item.version.id)}`,
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')
  const isBusy = busy !== null

  const review = async (approve: boolean) => {
    if (isBusy) return
    if (!approve && !note.trim()) return
    setBusy(approve ? 'approve' : 'reject')
    setError('')
    try {
      await api.post(`/market/${item.listing.id}/versions/${item.version.id}/review`, {
        approve,
        note: note.trim(),
      })
      toast({ type: 'success', message: approve ? t('已通过并上架') : t('已驳回') })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(null)
    }
  }

  const d = detail.data
  const hasExec = !!d?.permissions.includes('exec')
  const hasNetwork = !!d?.permissions.includes('network') || (d?.mcp.length ?? 0) > 0
  const secretCount = d?.secretSpecs.length ?? 0
  const isFirst = item.listing.listedVersionId === null

  return (
    <div className="mkt-review-pane ui-panel-swap">
      {error ? <Alert variant="error" title={error} /> : null}

      <div className="mkt-review-top">
        <div className="mkt-row__head">
          <ListingIcon type={item.listing.type} size={42} listing={item.listing} />
          <div>
            <div className="cfg__name-line">
              <strong className="mkt-row__name">
                {item.listing.title} r{item.version.revision}
              </strong>
              <Tag tone="blue">
                {isFirst ? t('首次上架') : t('版本更新')} ·{' '}
                {item.listing.visibility === 'public' ? t('公开社区') : t('仅本团队')}
              </Tag>
            </div>
            <div className="mkt-row__meta">{item.listing.description || t('（没有描述）')}</div>
          </div>
        </div>
        <Tag tone={hasExec ? 'orange' : 'green'} icon={hasExec ? 'warning' : 'check'}>
          {hasExec ? t('含本机运行程序') : t('安全检查通过')}
        </Tag>
      </div>

      <section aria-label={t('安全与权限核查')}>
        <div className="cfg__eyebrow">{t('安全与权限核查')}</div>
        <div className="mkt-audit-grid">
          <div className="mkt-audit-box">
            <small>{t('本机程序权限')}</small>
            <strong className="mkt-row__name">
              {hasExec ? t('会在电脑上运行代码（需机主确认）') : t('无（不会运行本机程序）')}
            </strong>
          </div>
          <div className="mkt-audit-box">
            <small>{t('外部网络 / 凭据')}</small>
            <strong className="mkt-row__name">
              {hasNetwork || secretCount
                ? t('{net} · {n} 项凭据', {
                    net: hasNetwork ? t('访问外部服务') : t('无外部地址'),
                    n: secretCount,
                  })
                : t('无外部地址 · 无凭据声明')}
            </strong>
          </div>
          <div className="mkt-audit-box">
            <small>{t('提交人与说明')}</small>
            <strong className="mkt-row__name">
              {byline(item.listing)} · {item.version.changelog || t('（无更新说明）')}
            </strong>
          </div>
        </div>
      </section>

      <section aria-label={t('文件变更')}>
        <div className="cfg__eyebrow">
          {t('更新说明与文件变更')}
          {d ? <span className="mkt-detail__n">{t('共 {n} 个文件', { n: d.files.length })}</span> : null}
        </div>
        <VersionDiff listingId={item.listing.id} versionId={item.version.id} />
      </section>

      <Disclosure variant="group" title={t('查看完整插件详情与源码文件')}>
        <ListingDetail id={item.listing.id} versionId={item.version.id} onChanged={onDone} />
      </Disclosure>

      <div className="mkt-review-decision">
        <TextField
          aria-label={t('审核意见')}
          placeholder={t('审核备注（驳回时必填，作者会看到）')}
          maxLength={500}
          disabled={isBusy}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          variant="destructive"
          disabled={isBusy || !note.trim()}
          loading={busy === 'reject'}
          onClick={() => void review(false)}
        >
          {t('驳回')}
        </Button>
        <Button
          variant="primary"
          icon="check"
          disabled={isBusy}
          loading={busy === 'approve'}
          onClick={() => void review(true)}
        >
          {t('通过并上架')}
        </Button>
      </div>
    </div>
  )
}
