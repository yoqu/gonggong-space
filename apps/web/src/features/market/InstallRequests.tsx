import type { InstallRequestDto, InstallRequestStatus } from '@gonggong/protocol'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { ago } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Alert, Button, EmptyState, Presence, Spinner, Tag, toast } from '../../ui'
import { isGroupAdmin } from '../groups/GroupNotice'
import { CapabilityChips, capabilitiesOfListing, ListingIcon, readinessOfListing } from './meta'
import { ReasonDialog } from './ReasonDialog'
import { useRowLocks } from './rowLocks'
import './market-manage.css'

const STATUS: Record<InstallRequestStatus, { label: string; tone: 'orange' | 'green' | 'red' | 'gray' }> = {
  pending: { label: t('待审批'), tone: 'orange' },
  approved: { label: t('已通过并添加'), tone: 'green' },
  rejected: { label: t('已拒绝'), tone: 'red' },
  cancelled: { label: t('已撤回'), tone: 'gray' },
}

const what = (r: InstallRequestDto) =>
  t('{by} 申请将「{listing}」添加到「{target}」', {
    by: r.requester,
    listing: r.listing.title,
    target: r.targetLabel,
  })

type Loaded<T> = { data: T | null; error: string; loading: boolean; reload: () => void }

/**
 * 申请与审批: admin approval cards (待我审批) + member requests list (我的申请).
 */
export function InstallRequests({
  todo,
  onOpenListing,
  onBackMarket,
}: {
  todo: Loaded<InstallRequestDto[]>
  onOpenListing?: (listingId: string) => void
  onBackMarket?: () => void
}) {
  const navigate = useNavigate()
  const me = useSession((s) => s.user?.id)
  const isAdmin = useSession(
    (s) => s.user?.role === 'sysadmin' || !!s.tenancy?.teams.some((x) => x.role !== 'member'),
  )
  const isAnyGroupAdmin = useWorkspace((s) => s.groups.some((g) => g.kind === 'group' && isGroupAdmin(g, me)))
  const canApprove = isAdmin || isAnyGroupAdmin || (todo.data?.length ?? 0) > 0

  const mine = useGet<InstallRequestDto[]>('/install-requests?view=mine')
  const [rejecting, setRejecting] = useState<InstallRequestDto | null>(null)
  const locks = useRowLocks()

  const approve = (r: InstallRequestDto) =>
    locks.run(r.id, async () => {
      const ok = await attempt(() =>
        api.post(`/install-requests/${r.id}/decide`, { approve: true, note: '' }),
      )
      if (!ok) return
      toast({ type: 'success', message: t('已添加到「{name}」', { name: r.targetLabel }) })
      todo.reload()
    })

  const cancel = (r: InstallRequestDto) =>
    locks.run(r.id, async () => {
      const ok = await attempt(() => api.del(`/install-requests/${r.id}`))
      if (!ok) return
      toast({ type: 'success', message: t('已撤回') })
      mine.reload()
    })

  const bothLoaded = !!mine.data && (!canApprove || !!todo.data)
  const bothEmpty = bothLoaded && (mine.data?.length ?? 0) === 0 && (todo.data?.length ?? 0) === 0

  return (
    <div className="mkt-content mkt-content--narrow">
      <section className="mkt-head">
        <div className="mkt-head__titles">
          <h1 className="mkt-head__title">{t('申请与审批')}</h1>
          <p className="mkt-head__sub">
            {canApprove
              ? t('群成员申请添加插件后会出现在这里；同意后立即生效，无需再手动配置。')
              : t('向你不是管理员的群提交插件申请后，可以在这里查看审批进度。')}
          </p>
        </div>
        {onBackMarket ? <Button onClick={onBackMarket}>{t('返回插件市场')}</Button> : null}
      </section>

      {bothEmpty ? (
        <div className="mkt-empty-box">
          <EmptyState
            icon="tray"
            title={t('暂时没有待处理的申请')}
            description={t('看到好用的插件但你不是该群管理员时，点击「申请添加」即可一键发给群管理员。')}
            action={
              onBackMarket ? (
                <Button variant="primary" onClick={onBackMarket}>
                  {t('去插件市场逛逛')}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          {canApprove ? (
            <section className="mkt-section" aria-label={t('待我审批')}>
              <div className="mkt-sec-head">
                <h2>{t('待我审批')}</h2>
                {todo.data?.length ? (
                  <Tag tone="orange">{t('{n} 条待处理', { n: todo.data.length })}</Tag>
                ) : null}
              </div>
              {todo.error ? (
                <Alert variant="error" title={todo.error} retrying={todo.loading} onRetry={todo.reload} />
              ) : null}
              {!todo.data ? (
                todo.error ? null : (
                  <Spinner />
                )
              ) : todo.data.length ? (
                <div className="mkt-req-stack">
                  {todo.data.map((r) => {
                    const caps = r.capabilities?.length ? r.capabilities : capabilitiesOfListing(r.listing)
                    const readiness = r.readiness ?? readinessOfListing(r.listing)
                    const needsExec = r.permissions?.includes('exec') || !!r.pinVersionId
                    const busy = locks.busy.has(r.id)
                    return (
                      <article key={r.id} className="mkt-req-card">
                        <div className="mkt-req-top">
                          <ListingIcon type={r.listing.type} size={38} listing={r.listing} />
                          <div className="mkt-req-who">
                            <div className="mkt-row__name">
                              {onOpenListing ? (
                                <>
                                  {t('{by} 申请将「', { by: r.requester })}
                                  <button
                                    type="button"
                                    className="mkt-pcard__name"
                                    style={{ display: 'inline' }}
                                    onClick={() => onOpenListing(r.listing.id)}
                                  >
                                    {r.listing.title}
                                  </button>
                                  {t('」添加到「{target}」', { target: r.targetLabel })}
                                </>
                              ) : (
                                what(r)
                              )}
                            </div>
                            <div className="mkt-req-meta">
                              {t('{time}提交', { time: ago(r.createdAt) })}
                              {r.pinVersionId
                                ? ` · ${t('锁定已审核版本 r{n}', { n: r.listing.revision })}`
                                : ` · ${t('自动保持最新')}`}
                            </div>
                          </div>
                        </div>
                        {r.note ? <div className="mkt-req-quote">“{r.note}”</div> : null}
                        <div className="mkt-req-foot">
                          <div className="mkt-chips">
                            <CapabilityChips capabilities={caps} readiness={readiness} />
                            {needsExec ? (
                              <Tag tone="orange" icon="laptop">
                                {t('含本机程序，需电脑主人确认')}
                              </Tag>
                            ) : (
                              <Tag tone="green" icon="shield-check">
                                {t('不运行本机程序')}
                              </Tag>
                            )}
                          </div>
                          <div className="mkt-row__controls">
                            <Button size="small" disabled={busy} onClick={() => setRejecting(r)}>
                              {t('拒绝')}
                            </Button>
                            <Button
                              size="small"
                              variant="primary"
                              icon="check"
                              loading={busy}
                              disabled={busy}
                              onClick={() => void approve(r)}
                            >
                              {t('同意并添加')}
                            </Button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              ) : (
                <EmptyState compact icon="checkmark-circle" title={t('没有待你处理的申请')} />
              )}
            </section>
          ) : null}

          <section className="mkt-section" aria-label={t('我的申请')}>
            <div className="mkt-sec-head">
              <h2>{t('我的申请')}</h2>
              <span className="mkt-shelf__sub">{t('通过后会自动加入对应群，无需重复操作')}</span>
            </div>
            {mine.error ? (
              <Alert variant="error" title={mine.error} retrying={mine.loading} onRetry={mine.reload} />
            ) : null}
            {!mine.data ? (
              mine.error ? null : (
                <Spinner />
              )
            ) : mine.data.length ? (
              <div className="mkt-group-box">
                {mine.data.map((r) => {
                  const busy = locks.busy.has(r.id)
                  return (
                    <div key={r.id} className="mkt-req-row">
                      <ListingIcon type={r.listing.type} size={38} listing={r.listing} />
                      <div>
                        <div className="cfg__name-line">
                          {onOpenListing ? (
                            <button
                              type="button"
                              className="mkt-pcard__name"
                              onClick={() => onOpenListing(r.listing.id)}
                            >
                              {r.listing.title}
                            </button>
                          ) : (
                            <span className="mkt-row__name">{r.listing.title}</span>
                          )}
                          <span>→ {r.targetLabel}</span>
                          <Tag tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Tag>
                        </div>
                        {r.decisionNote ? (
                          <div className="mkt-row__meta">
                            {t('{by}回复：{note}', { by: r.decidedBy ?? t('管理员'), note: r.decisionNote })}
                          </div>
                        ) : r.note ? (
                          <div className="mkt-row__meta">{t('申请理由：{note}', { note: r.note })}</div>
                        ) : null}
                        <div className="mkt-row__meta">{ago(r.createdAt)}</div>
                      </div>
                      <div className="mkt-row__controls">
                        {r.status === 'pending' ? (
                          <Button size="small" loading={busy} disabled={busy} onClick={() => void cancel(r)}>
                            {t('撤回申请')}
                          </Button>
                        ) : r.status === 'approved' && r.scope === 'group' ? (
                          <Button
                            size="small"
                            className="mkt-btn-soft"
                            onClick={() => navigate(`/g/${r.scopeId}`)}
                          >
                            {t('去群里用')}
                          </Button>
                        ) : onOpenListing ? (
                          <Button size="small" onClick={() => onOpenListing(r.listing.id)}>
                            {t('查看插件')}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <EmptyState
                compact
                icon="tray"
                title={t('你还没有提交过添加申请')}
                description={t('在市场里把插件添加到你不是管理员的群、团队或仓库时，会向管理员提交申请。')}
              />
            )}
          </section>
        </>
      )}

      <Presence>
        {rejecting ? (
          <ReasonDialog
            title={t('拒绝添加申请')}
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
    </div>
  )
}
