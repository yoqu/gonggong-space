import {
  canPausePreview,
  canStopService,
  mergePreviewsAndServices,
  previewTechInfo,
  shouldStopServiceOnClose,
} from '@web/features/previews/merge'
import {
  PREVIEW_BADGE,
  PreviewTechDetails,
  previewKindLabel,
  SERVICE_STATE,
} from '@web/features/previews/meta'
import {
  Alert,
  AlertDialog,
  Button,
  EmptyState,
  GroupBox,
  Icon,
  PullDownButton,
  Skeleton,
  Tag,
  toast,
} from '@web/ui'
import { useEffect, useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { ipc, type Tunnels } from '../ipc'
import { fail, Section } from '../lib/ui'
import { useIpc } from '../lib/useIpc'
import type { PageProps } from '.'

/** The Web may change them at any time; this page follows without a push channel. */
const REFRESH_MS = 5000

type PreviewItem = Tunnels['previews'][number]
type ServiceItem = Tunnels['services'][number]
type ConfirmTarget =
  | { kind: 'stop' | 'close_stopped'; id: string; fallback: PreviewItem }
  | { kind: 'stop_service'; id: string; fallback: ServiceItem }

const previewConfirmStillValid = (kind: 'stop' | 'close_stopped', preview: PreviewItem | null) =>
  !!preview &&
  (kind === 'stop'
    ? preview.status !== 'stopped' && preview.status !== 'offline'
    : preview.status === 'stopped')

/** 在线预览: what this machine exposes and hosts; actions match the Web's 在线预览 view. */
export function TunnelsPage(_: PageProps) {
  const { data, error, loading, reload } = useIpc(ipc.tunnels, { pollMs: REFRESH_MS })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Kept after closing so the alert keeps its text while it animates out; live state is resolved from `data`.
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  const liveConfirmPreview =
    confirmTarget && confirmTarget.kind !== 'stop_service'
      ? (data?.previews.find((p) => p.id === confirmTarget.id) ?? null)
      : null
  const confirmPreview =
    confirmTarget && confirmTarget.kind !== 'stop_service'
      ? (liveConfirmPreview ?? confirmTarget.fallback)
      : null
  const liveConfirmService =
    confirmTarget?.kind === 'stop_service'
      ? (data?.services.find((s) => s.id === confirmTarget.id) ?? null)
      : null
  const confirmService =
    confirmTarget?.kind === 'stop_service' ? (liveConfirmService ?? confirmTarget.fallback) : null

  useEffect(() => {
    if (!confirmOpen || confirmBusy || !confirmTarget || !data) return
    if (confirmTarget.kind === 'stop_service') {
      if (!liveConfirmService || !canStopService(liveConfirmService)) setConfirmOpen(false)
    } else if (!previewConfirmStillValid(confirmTarget.kind, liveConfirmPreview)) {
      setConfirmOpen(false)
    }
  }, [confirmOpen, confirmBusy, confirmTarget, data, liveConfirmPreview, liveConfirmService])

  const act = async (key: string, op: () => Promise<void>, done?: string) => {
    if (busyKey === key) return
    setBusyKey(key)
    try {
      await op()
      if (done) toast({ type: 'success', message: done })
    } catch (e) {
      fail(e)
    }
    await reload()
    setBusyKey((cur) => (cur === key ? null : cur))
  }

  const askPreviewConfirm = (kind: 'stop' | 'close_stopped', preview: PreviewItem) => {
    setConfirmTarget({ kind, id: preview.id, fallback: preview })
    setConfirmError('')
    setConfirmOpen(true)
  }

  const askServiceConfirm = (service: ServiceItem) => {
    setConfirmTarget({ kind: 'stop_service', id: service.id, fallback: service })
    setConfirmError('')
    setConfirmOpen(true)
  }

  const closeConfirm = () => {
    if (!confirmBusy) {
      setConfirmOpen(false)
      setConfirmError('')
    }
  }

  const runConfirm = async () => {
    if (!confirmTarget || confirmBusy) return
    setConfirmBusy(true)
    setConfirmError('')
    try {
      if (confirmTarget.kind === 'stop_service') {
        if (!confirmService) return
        await ipc.stopService(confirmService.id)
        toast({ type: 'success', message: t('已停止「{name}」', { name: confirmService.name }) })
      } else {
        if (!confirmPreview) return
        if (confirmTarget.kind === 'stop') {
          await ipc.closeTunnel(confirmPreview.id, shouldStopServiceOnClose(confirmPreview))
          toast({
            type: 'success',
            message: t('已停止「{title}」的在线预览', { title: confirmPreview.title }),
          })
        } else {
          await ipc.closeTunnel(confirmPreview.id, false)
          toast({ type: 'success', message: t('已彻底关闭「{title}」', { title: confirmPreview.title }) })
        }
      }
      setConfirmOpen(false)
      await reload()
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfirmBusy(false)
    }
  }

  const toggleTech = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  if (!data) {
    if (error)
      return <Alert variant="error" description={error} retrying={loading} onRetry={() => void reload()} />
    return <Skeleton count={3} />
  }

  const { items, backgroundServices } = mergePreviewsAndServices(data.previews, data.services)
  const empty = items.length === 0 && backgroundServices.length === 0
  const stopWithService =
    confirmTarget?.kind === 'stop' && !!confirmPreview && shouldStopServiceOnClose(confirmPreview)

  return (
    <>
      {error ? (
        <Alert variant="error" description={error} retrying={loading} onRetry={() => void reload()} />
      ) : null}
      {empty ? (
        <GroupBox>
          <EmptyState
            compact
            icon="globe"
            title={t('本机没有在线预览')}
            description={t('让 Bot 把网页或服务跑起来（比如「起个预览给我看看」），就会出现在这里。')}
          />
        </GroupBox>
      ) : null}
      {items.length > 0 ? (
        <Section title={t('在线预览')}>
          <GroupBox>
            {items.map(({ preview: p, service }) => {
              const badge = PREVIEW_BADGE[p.status]
              const tech = previewTechInfo(p, service)
              const showTech = Boolean(expanded[p.id] && tech)
              const rowBusy =
                busyKey === `start:${p.id}` ||
                busyKey === `close:${p.id}` ||
                (service != null && busyKey === `stop-svc:${service.id}`)
              const menuItems = [
                ...(canPausePreview(p, service)
                  ? [{ label: t('仅暂停后台进程（保留卡片）'), value: 'pause', disabled: rowBusy }]
                  : []),
                ...(tech ? [{ label: showTech ? t('收起技术详情') : t('查看技术详情'), value: 'tech' }] : []),
              ]
              return (
                <div key={p.id} className="dk-row-item">
                  <div className="dk-row">
                    <span className="dk-tile" style={{ background: 'var(--system-teal)' }}>
                      <Icon name="globe" size={16} />
                    </span>
                    <div className="dk-row__main">
                      <span className="dk-row__title">
                        <span className="dk-strong dk-ellipsis">{p.title}</span>
                        <Tag tone={badge.tone}>{badge.text}</Tag>
                      </span>
                      <span className="dk-sub dk-ellipsis">
                        {[
                          p.groupName,
                          p.botName,
                          previewKindLabel(p),
                          p.status === 'stopped' ? t('卡片保留中') : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {p.status === 'stopped' ? (
                      <>
                        <Button
                          size="small"
                          disabled={rowBusy}
                          loading={busyKey === `start:${p.id}`}
                          onClick={() =>
                            void act(
                              `start:${p.id}`,
                              () => ipc.startPreview(p.id),
                              t('已重新启动「{title}」', { title: p.title }),
                            )
                          }
                        >
                          {t('重新启动')}
                        </Button>
                        <Button
                          size="small"
                          disabled={rowBusy}
                          onClick={() => askPreviewConfirm('close_stopped', p)}
                        >
                          {t('彻底关闭')}
                        </Button>
                      </>
                    ) : (
                      <>
                        {p.status === 'online' && p.port ? (
                          <Button
                            size="small"
                            disabled={rowBusy}
                            onClick={() => {
                              if (p.port != null) void ipc.openLocal(p.port, p.path).catch(fail)
                            }}
                          >
                            {t('本机打开')}
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          disabled={rowBusy}
                          loading={busyKey === `close:${p.id}`}
                          onClick={() => {
                            if (rowBusy) return
                            if (p.status === 'offline') {
                              void act(
                                `close:${p.id}`,
                                () => ipc.closeTunnel(p.id, false),
                                t('已关闭「{title}」', { title: p.title }),
                              )
                            } else {
                              askPreviewConfirm('stop', p)
                            }
                          }}
                        >
                          {p.status === 'offline' ? t('关闭') : p.serviceId ? t('停止') : t('停止预览')}
                        </Button>
                      </>
                    )}
                    {menuItems.length ? (
                      <PullDownButton
                        variant="ghost"
                        size="small"
                        icon="more"
                        indicator={false}
                        aria-label={t('{name} 的更多操作', { name: p.title })}
                        align="end"
                        portal
                        items={menuItems}
                        onSelect={(value) => {
                          if (value === 'pause' && service)
                            void act(
                              `stop-svc:${service.id}`,
                              () => ipc.stopService(service.id),
                              t('已暂停「{title}」的后台进程', { title: p.title }),
                            )
                          else if (value === 'tech') toggleTech(p.id)
                        }}
                      />
                    ) : null}
                  </div>
                  {showTech && tech ? <PreviewTechDetails tech={tech} className="dk-tech" /> : null}
                </div>
              )
            })}
          </GroupBox>
        </Section>
      ) : null}
      {backgroundServices.length > 0 ? (
        <Section title={t('仅后台运行（未开放预览）')}>
          <GroupBox>
            {backgroundServices.map((s) => (
              <div key={s.id} className="dk-row-item">
                <div className="dk-row">
                  <span className="dk-tile" style={{ background: 'var(--system-teal)' }}>
                    <Icon name="server" size={16} />
                  </span>
                  <div className="dk-row__main">
                    <span className="dk-row__title">
                      <span className="dk-strong dk-ellipsis">{s.name}</span>
                      <Tag tone={SERVICE_STATE[s.status].tone}>{SERVICE_STATE[s.status].text}</Tag>
                    </span>
                    <span className="dk-sub dk-ellipsis">
                      {[s.groupName, s.botName, s.port ? t('端口 {port}', { port: s.port }) : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span
                      className="dk-mono dk-sub dk-ellipsis"
                      title={`${s.cwd ? `${s.cwd}$ ` : '$ '}${s.command}`}
                    >
                      $ {s.command}
                    </span>
                  </div>
                  {canStopService(s) ? (
                    <Button
                      size="small"
                      disabled={busyKey === `stop-svc:${s.id}`}
                      onClick={() => askServiceConfirm(s)}
                    >
                      {t('停止')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </GroupBox>
        </Section>
      ) : null}
      <p className="dk-footnote">
        {t(
          'Bot 开放的网页与后台服务由这台电脑运行。在这里操作与在网页端群里效果相同，群成员会立即看到变化。',
        )}
      </p>
      <AlertDialog
        open={confirmOpen}
        onClose={closeConfirm}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title={
          confirmTarget?.kind === 'stop_service' && confirmService
            ? t('要停止后台服务「{name}」吗？', { name: confirmService.name })
            : confirmTarget && confirmPreview
              ? confirmTarget.kind === 'stop'
                ? t('要停止「{title}」的在线预览吗？', { title: confirmPreview.title })
                : t('要彻底关闭「{title}」吗？', { title: confirmPreview.title })
              : ''
        }
        message={
          confirmTarget?.kind === 'stop_service'
            ? t('停止后该服务进程会立即结束，如需恢复请让 Bot 重新启动。')
            : confirmTarget && confirmPreview
              ? confirmTarget.kind === 'stop'
                ? stopWithService
                  ? t('停止后，群成员将无法继续打开这个预览链接，相关后台服务也会一并停止。')
                  : t('停止后，群成员将无法继续打开这个预览链接。')
                : t('关闭后该预览卡片会移除，之后无法再从这里重新启动。')
              : null
        }
        detail={confirmError ? <Alert variant="error" description={confirmError} /> : null}
        actions={[
          { label: t('取消'), disabled: confirmBusy, onClick: closeConfirm },
          {
            label:
              confirmTarget?.kind === 'stop_service'
                ? t('停止服务')
                : confirmTarget?.kind === 'close_stopped'
                  ? t('彻底关闭')
                  : stopWithService
                    ? t('停止预览和服务')
                    : t('停止预览'),
            variant: 'destructive',
            disabled: confirmBusy,
            loading: confirmBusy,
            onClick: () => void runConfirm(),
          },
        ]}
      />
    </>
  )
}
