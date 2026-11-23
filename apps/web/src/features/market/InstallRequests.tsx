import type { InstallRequestDto, InstallRequestStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  GroupBox,
  GroupRow,
  Presence,
  Spinner,
  Tag,
  TextArea,
  toast,
} from '../../ui'
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
export function InstallRequests({ onDecided }: { onDecided?: () => void }) {
  const todo = useGet<InstallRequestDto[]>('/install-requests?view=todo')
  const decided = () => {
    todo.reload()
    onDecided?.()
  }
  const mine = useGet<InstallRequestDto[]>('/install-requests?view=mine')
  const [rejecting, setRejecting] = useState<InstallRequestDto | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const approve = async (r: InstallRequestDto) => {
    if (busyId === r.id) return
    setBusyId(r.id)
    try {
      const ok = await attempt(() =>
        api.post(`/install-requests/${r.id}/decide`, { approve: true, note: '' }),
      )
      if (!ok) return
      toast({ type: 'success', message: t('已引入到「{name}」', { name: r.targetLabel }) })
      decided()
    } finally {
      setBusyId((id) => (id === r.id ? null : id))
    }
  }
  const cancel = async (r: InstallRequestDto) => {
    if (busyId === r.id) return
    setBusyId(r.id)
    try {
      const ok = await attempt(() => api.del(`/install-requests/${r.id}`))
      if (!ok) return
      toast({ type: 'success', message: t('已撤回') })
      mine.reload()
    } finally {
      setBusyId((id) => (id === r.id ? null : id))
    }
  }

  return (
    <>
      <section className="mkt-section" aria-label={t('待我处理')}>
        <div className="cfg__eyebrow">
          {t('待我处理')}
          {todo.data?.length ? <span className="mkt-detail__n">{todo.data.length}</span> : null}
        </div>
        {!todo.data ? (
          todo.error ? (
            <Alert variant="error" title={todo.error} onRetry={todo.reload} />
          ) : (
            <Spinner />
          )
        ) : todo.data.length ? (
          <GroupBox>
            {todo.data.map((r) => (
              <GroupRow
                key={r.id}
                className="cfg__item"
                label={what(r)}
                description={
                  <>
                    {r.note ? <span>{t('申请说明：{note}', { note: r.note })}</span> : null}
                    <span className="mkt-row__meta">{ago(r.createdAt)}</span>
                  </>
                }
              >
                <span className="cfg__controls">
                  <Button size="small" disabled={busyId === r.id} onClick={() => setRejecting(r)}>
                    {t('拒绝')}
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    loading={busyId === r.id}
                    disabled={busyId === r.id}
                    onClick={() => void approve(r)}
                  >
                    {t('通过')}
                  </Button>
                </span>
              </GroupRow>
            ))}
          </GroupBox>
        ) : (
          <EmptyState compact icon="checkmark-circle" title={t('没有待你处理的申请')} />
        )}
      </section>
      <section className="mkt-section" aria-label={t('我的申请')}>
        <div className="cfg__eyebrow">{t('我的申请')}</div>
        {!mine.data ? (
          mine.error ? (
            <Alert variant="error" title={mine.error} onRetry={mine.reload} />
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
                  <>
                    {r.decisionNote ? (
                      <span>{t('{by}：{note}', { by: r.decidedBy ?? '', note: r.decisionNote })}</span>
                    ) : r.note ? (
                      <span>{t('申请说明：{note}', { note: r.note })}</span>
                    ) : null}
                    <span className="mkt-row__meta">{ago(r.createdAt)}</span>
                  </>
                }
              >
                {r.status === 'pending' ? (
                  <Button
                    size="small"
                    variant="plain"
                    loading={busyId === r.id}
                    disabled={busyId === r.id}
                    onClick={() => void cancel(r)}
                  >
                    {t('撤回')}
                  </Button>
                ) : null}
              </GroupRow>
            ))}
          </GroupBox>
        ) : (
          <EmptyState
            compact
            icon="tray"
            title={t('你还没有提交过引入申请')}
            description={t('在市场里把条目引入到你不是管理员的群、团队或仓库时，会向管理员提交申请。')}
          />
        )}
      </section>
      <Presence>
        {rejecting ? (
          <RejectDialog
            request={rejecting}
            onClose={() => setRejecting(null)}
            onDone={() => {
              setRejecting(null)
              decided()
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
    if (busy) return
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
  const close = () => {
    if (!busy) onClose()
  }
  return (
    <Dialog
      open
      title={t('拒绝引入申请')}
      width={480}
      closeOnScrim={false}
      onClose={busy ? () => {} : onClose}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('拒绝'),
          variant: 'destructive',
          disabled: busy || !note.trim(),
          loading: busy,
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
