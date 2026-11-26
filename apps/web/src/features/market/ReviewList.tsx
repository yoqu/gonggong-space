import type { ReviewItemDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { useGet } from '../../lib/useGet'
import { Alert, Button, Dialog, GroupBox, GroupRow, Presence, Spinner, Tag, TextArea, toast } from '../../ui'
import { byline, ListingDetail } from './ListingDetail'
import { TYPE_LABEL } from './status'
import { VersionDiff } from './VersionDiff'
import '../config/config.css'
import '../groups/groups.css'

/** 待审核: the pending versions the caller reviews (`path` = `/market/reviews[?teamId=]`), approve or reject each. */
export function MarketReviewList({ path }: { path: string }) {
  const { data, error, reload } = useGet<ReviewItemDto[]>(path)
  const [open, setOpen] = useState<ReviewItemDto | null>(null)
  if (!data) return error ? <Alert variant="error" title={error} onRetry={reload} /> : <Spinner />
  return (
    <>
      <div className="gs-note">{t('公开条目由系统管理员审核，仅本团队可见的条目由团队管理员审核。')}</div>
      {data.length ? (
        <GroupBox>
          {data.map((r) => (
            <GroupRow
              key={r.version.id}
              className="cfg__item"
              label={
                <span className="cfg__name-line">
                  <span className="cfg__name">{r.listing.title}</span>
                  <Tag tone="blue">{TYPE_LABEL[r.listing.type]}</Tag>
                  <Tag tone="gray">r{r.version.revision}</Tag>
                  <Tag tone="gray">{r.listing.visibility === 'public' ? t('公开') : t('仅本团队')}</Tag>
                </span>
              }
              description={`${byline(r.listing)} · ${r.version.changelog || t('（无更新说明）')}`}
            >
              <Button size="small" onClick={() => setOpen(r)}>
                {t('审核')}
              </Button>
            </GroupRow>
          ))}
        </GroupBox>
      ) : (
        <div className="gs-note">{t('没有待审核的版本')}</div>
      )}
      <Presence>
        {open ? (
          <ReviewDialog
            item={open}
            onClose={() => setOpen(null)}
            onDone={() => {
              setOpen(null)
              reload()
            }}
          />
        ) : null}
      </Presence>
    </>
  )
}

function ReviewDialog({
  item,
  onClose,
  onDone,
}: {
  item: ReviewItemDto
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState('')
  const isBusy = busy !== null
  const review = async (approve: boolean) => {
    if (isBusy) return
    setBusy(approve ? 'approve' : 'reject')
    setError('')
    try {
      await api.post(`/market/${item.listing.id}/versions/${item.version.id}/review`, {
        approve,
        note: note.trim(),
      })
      toast({ type: 'success', message: approve ? t('已通过') : t('已驳回') })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(null)
    }
  }
  const close = () => {
    if (!isBusy) onClose()
  }
  return (
    <Dialog
      open
      title={t('审核 {name} r{n}', { name: item.listing.title, n: item.version.revision })}
      width={760}
      closeOnScrim={false}
      onClose={isBusy ? () => {} : onClose}
      actions={[
        { label: t('取消'), disabled: isBusy, onClick: close },
        {
          label: t('驳回'),
          variant: 'destructive',
          disabled: isBusy || !note.trim(),
          loading: busy === 'reject',
          onClick: () => void review(false),
        },
        {
          label: t('通过'),
          variant: 'primary',
          disabled: isBusy,
          loading: busy === 'approve',
          onClick: () => void review(true),
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <div className="gs-note">
        {t('更新说明：{text}', { text: item.version.changelog || t('（无更新说明）') })}
      </div>
      <div className="cfg__eyebrow">{t('变更')}</div>
      <VersionDiff listingId={item.listing.id} versionId={item.version.id} />
      <ListingDetail id={item.listing.id} versionId={item.version.id} onChanged={onDone} />
      <TextArea
        label={t('审核意见')}
        aria-label={t('审核意见')}
        placeholder={t('驳回时必填')}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Dialog>
  )
}
