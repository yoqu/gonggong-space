import type { InstallRequestDto, InstallRequestStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Alert, Button, EmptyState, GroupBox, GroupRow, Presence, Spinner, Tag, toast } from '../../ui'
import '../config/config.css'
import { ReasonDialog } from './ReasonDialog'
import { useRowLocks } from './rowLocks'

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

type Loaded<T> = { data: T | null; error: string; loading: boolean; reload: () => void }

/**
 * 引入申请: requests waiting for me as an admin of their target (通过 / 拒绝), and my own (状态、结果、撤回). `todo` is
 * the market page's list, which also counts the tab.
 */
export function InstallRequests({ todo }: { todo: Loaded<InstallRequestDto[]> }) {
  const mine = useGet<InstallRequestDto[]>('/install-requests?view=mine')
  const [rejecting, setRejecting] = useState<InstallRequestDto | null>(null)
  const locks = useRowLocks()
  const approve = (r: InstallRequestDto) =>
    locks.run(r.id, async () => {
      const ok = await attempt(() =>
        api.post(`/install-requests/${r.id}/decide`, { approve: true, note: '' }),
      )
      if (!ok) return
      toast({ type: 'success', message: t('已引入到「{name}」', { name: r.targetLabel }) })
      todo.reload()
    })
  const cancel = (r: InstallRequestDto) =>
    locks.run(r.id, async () => {
      const ok = await attempt(() => api.del(`/install-requests/${r.id}`))
      if (!ok) return
      toast({ type: 'success', message: t('已撤回') })
      mine.reload()
    })

  return (
    <>
      <section className="mkt-section" aria-label={t('待我处理')}>
        <div className="cfg__eyebrow">
          {t('待我处理')}
          {todo.data?.length ? <span className="mkt-detail__n">{todo.data.length}</span> : null}
        </div>
        {todo.error ? (
          <Alert variant="error" title={todo.error} retrying={todo.loading} onRetry={todo.reload} />
        ) : null}
        {!todo.data ? (
          todo.error ? null : (
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
                  <Button size="small" disabled={locks.busy.has(r.id)} onClick={() => setRejecting(r)}>
                    {t('拒绝')}
                  </Button>
                  <Button
                    size="small"
                    variant="primary"
                    loading={locks.busy.has(r.id)}
                    disabled={locks.busy.has(r.id)}
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
        {mine.error ? (
          <Alert variant="error" title={mine.error} retrying={mine.loading} onRetry={mine.reload} />
        ) : null}
        {!mine.data ? (
          mine.error ? null : (
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
                    loading={locks.busy.has(r.id)}
                    disabled={locks.busy.has(r.id)}
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
          <ReasonDialog
            title={t('拒绝引入申请')}
            note={what(rejecting)}
            fieldLabel={t('拒绝原因')}
            placeholder={t('申请人会看到这个原因')}
            confirmLabel={t('拒绝')}
            done={t('已拒绝')}
            run={(note) => api.post(`/install-requests/${rejecting.id}/decide`, { approve: false, note })}
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
