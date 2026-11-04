import type { InstallRequestDto, InstallRequestStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Button, Dialog, GroupBox, GroupRow, Presence, Spinner, Tag, TextArea, toast } from '../../ui'
import '../config/config.css'

const STATUS: Record<InstallRequestStatus, { label: string; tone: 'orange' | 'green' | 'red' | 'gray' }> = {
  pending: { label: t('待处理'), tone: 'orange' },
  approved: { label: t('已通过'), tone: 'green' },
  rejected: { label: t('已拒绝'), tone: 'red' },
  cancelled: { label: t('已撤回'), tone: 'gray' },
}

const what = (r: InstallRequestDto) =>
  t('{by} 申请把 {listing} 引入到 {target}', {
    by: r.requester,
    listing: r.listing.title,
    target: r.targetLabel,
  })

/** 引入申请: requests waiting for me as an admin of their target (通过 / 拒绝), and my own (状态、结果、撤回). */
export function InstallRequests() {
  const todo = useGet<InstallRequestDto[]>('/install-requests?view=todo')
  const mine = useGet<InstallRequestDto[]>('/install-requests?view=mine')
  const [rejecting, setRejecting] = useState<InstallRequestDto | null>(null)
  const approve = (r: InstallRequestDto) =>
    attempt(() => api.post(`/install-requests/${r.id}/decide`, { approve: true, note: '' })).then((ok) => {
      if (!ok) return
      toast({ type: 'success', message: t('已引入到「{name}」', { name: r.targetLabel }) })
      todo.reload()
    })
  const cancel = (r: InstallRequestDto) =>
    attempt(() => api.del(`/install-requests/${r.id}`)).then(mine.reload)

  return (
    <>
      <section aria-label={t('待我处理')}>
        <div className="cfg__eyebrow">{t('待我处理')}</div>
        {!todo.data ? (
          todo.error ? (
            <Alert variant="error" title={todo.error} />
          ) : (
            <Spinner />
          )
        ) : todo.data.length ? (
          <GroupBox>
            {todo.data.map((r) => (
              <GroupRow key={r.id} className="cfg__item" label={what(r)} description={r.note || undefined}>
                <span className="cfg__controls">
                  <Button size="small" onClick={() => setRejecting(r)}>
                    {t('拒绝')}
                  </Button>
                  <Button size="small" variant="primary" onClick={() => void approve(r)}>
                    {t('通过')}
                  </Button>
                </span>
              </GroupRow>
            ))}
          </GroupBox>
        ) : (
          <div className="gs-note">{t('没有待你处理的申请')}</div>
        )}
      </section>
      <section aria-label={t('我的申请')}>
        <div className="cfg__eyebrow">{t('我的申请')}</div>
        {!mine.data ? (
          mine.error ? (
            <Alert variant="error" title={mine.error} />
          ) : (
            <Spinner />
          )
        ) : mine.data.length ? (
          <GroupBox>
            {mine.data.map((r) => (
              <GroupRow
                key={r.id}
                className="cfg__item"
                label={
                  <span className="cfg__name-line">
                    <span className="cfg__name">
                      {t('{listing} → {target}', { listing: r.listing.title, target: r.targetLabel })}
                    </span>
                    <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>
                  </span>
                }
                description={
                  r.decisionNote
                    ? t('{by}：{note}', { by: r.decidedBy ?? '', note: r.decisionNote })
                    : r.note || undefined
                }
              >
                {r.status === 'pending' ? (
                  <Button size="small" variant="plain" onClick={() => void cancel(r)}>
                    {t('撤回')}
                  </Button>
                ) : null}
              </GroupRow>
            ))}
          </GroupBox>
        ) : (
          <div className="gs-note">{t('你还没有提交过引入申请')}</div>
        )}
      </section>
      <Presence>
        {rejecting ? (
          <RejectDialog
            request={rejecting}
            onClose={() => setRejecting(null)}
            onDone={() => {
              setRejecting(null)
              todo.reload()
            }}
          />
        ) : null}
      </Presence>
    </>
  )
}

function RejectDialog({
  request,
  onClose,
  onDone,
}: {
  request: InstallRequestDto
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reject = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`/install-requests/${request.id}/decide`, { approve: false, note: note.trim() })
      toast({ type: 'success', message: t('已拒绝') })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      title={t('拒绝引入申请')}
      width={480}
      closeOnScrim={false}
      onClose={onClose}
      actions={[
        { label: t('取消'), onClick: onClose },
        {
          label: t('拒绝'),
          variant: 'destructive',
          disabled: busy || !note.trim(),
          onClick: () => void reject(),
        },
      ]}
    >
      {error ? <Alert variant="error" title={error} /> : null}
      <div className="gs-note">{what(request)}</div>
      <TextArea
        label={t('拒绝原因')}
        aria-label={t('拒绝原因')}
        placeholder={t('申请人会看到这个原因')}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Dialog>
  )
}
