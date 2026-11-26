import type { PreviewDto, ServiceDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import {
  Alert,
  Button,
  EmptyState,
  GroupBox,
  NoTabsArt,
  Presence,
  PullDownButton,
  Spinner,
  Tag,
  toast,
} from '../../ui'
import { ClosePreviewConfirm } from './ClosePreviewConfirm'
import {
  canPausePreview,
  canStopService,
  mergePreviewsAndServices,
  previewTechInfo,
  shouldStopServiceOnClose,
} from './merge'
import { PREVIEW_BADGE, PreviewTechDetails, previewKindLabel, SERVICE_STATE, startPreview } from './meta'
import './previews.css'
import { openInWorkbench, openUrl, usePreviews } from './store'

/**
 * 群设置 · 在线预览: previews and orphan background services in this group; managers can open, stop, pause or restart.
 */
export function PreviewsView({ groupId, onOpen }: { groupId: string; onOpen?: () => void }) {
  const list = usePreviews(groupId)
  const error = usePreviews.useError(groupId)
  if (!list) {
    if (error)
      return (
        <Alert
          variant="error"
          title={t('加载失败')}
          description={error}
          onRetry={() => usePreviews.reload(groupId)}
        />
      )
    return <Spinner />
  }
  const { items, backgroundServices } = mergePreviewsAndServices(list.previews, list.services)
  return (
    <>
      {items.length || backgroundServices.length ? (
        <Lists items={items} backgroundServices={backgroundServices} onOpen={onOpen} />
      ) : (
        <EmptyState
          compact
          illustration={<NoTabsArt />}
          title={t('暂无在线预览')}
          description={t('让 Bot 把网页或服务跑起来（比如「起个预览给我看看」），就会出现在这里。')}
        />
      )}
      <div className="gs-foot">
        {t(
          'Bot 开放的网页与后台服务由这台电脑运行；预览 24 小时无人访问会自动关闭。点击「停止」会同时关闭群预览并停掉进程，也可在菜单里仅暂停进程保留卡片。',
        )}
      </div>
    </>
  )
}

function Lists({
  items,
  backgroundServices,
  onOpen,
}: {
  items: { preview: PreviewDto; service: ServiceDto | null }[]
  backgroundServices: ServiceDto[]
  onOpen?: () => void
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [closing, setClosing] = useState<{ preview: PreviewDto; mode: 'stop' | 'close' } | null>(null)
  const toggleTech = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  const act = async (key: string, request: () => Promise<unknown>) => {
    if (busyKey === key) return
    setBusyKey(key)
    await attempt(request)
    setBusyKey((cur) => (cur === key ? null : cur))
  }

  return (
    <>
      {items.length ? (
        <>
          <div className="gs-toolbar">
            <span className="gs-toolbar__text">{t('在线预览 {n} 个', { n: items.length })}</span>
          </div>
          <GroupBox>
            {items.map(({ preview: p, service }) => {
              const badge = PREVIEW_BADGE[p.status]
              const tech = previewTechInfo(p, service)
              const showTech = Boolean(expanded[p.id] && tech)
              const menuItems = [
                ...(p.canManage && canPausePreview(p, service)
                  ? [{ label: t('仅暂停后台进程（保留卡片）'), value: 'pause' }]
                  : []),
                ...(tech ? [{ label: showTech ? t('收起技术详情') : t('查看技术详情'), value: 'tech' }] : []),
              ]
              return (
                <div key={p.id} className="pv-item">
                  <div className="pv-row">
                    <span className="pv-row__main">
                      <span className="pv-row__title-line">
                        {p.status === 'online' ? (
                          <a
                            href={openUrl(p.id, p.path)}
                            target="_blank"
                            rel="noreferrer"
                            className="pv-row__title"
                          >
                            {p.title}
                          </a>
                        ) : (
                          <span className="pv-row__title">{p.title}</span>
                        )}
                        <Tag tone={badge.tone}>{badge.text}</Tag>
                      </span>
                      <span className="pv-muted">
                        {[p.botName, previewKindLabel(p), p.status === 'stopped' ? t('卡片保留中') : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="pv-item__actions">
                      {p.status === 'stopped' && p.canManage ? (
                        <>
                          <Button
                            size="small"
                            loading={busyKey === `start:${p.id}`}
                            disabled={busyKey === `start:${p.id}`}
                            onClick={() => void act(`start:${p.id}`, () => startPreview(p.id))}
                          >
                            {t('重新启动')}
                          </Button>
                          <Button
                            variant="plain"
                            size="small"
                            onClick={() => setClosing({ preview: p, mode: 'close' })}
                          >
                            {t('彻底关闭')}
                          </Button>
                        </>
                      ) : (
                        <>
                          {p.status === 'online' ? (
                            <Button
                              variant="plain"
                              size="small"
                              onClick={() => {
                                if (openInWorkbench(p)) onOpen?.()
                              }}
                            >
                              {t('在工作台打开')}
                            </Button>
                          ) : null}
                          {p.canManage ? (
                            <Button
                              variant="plain"
                              size="small"
                              loading={busyKey === `close:${p.id}`}
                              disabled={busyKey === `close:${p.id}`}
                              onClick={() =>
                                p.status === 'offline'
                                  ? void act(`close:${p.id}`, async () => {
                                      await api.post(`/previews/${p.id}/close`, { stopService: false })
                                      toast({ type: 'success', message: t('已关闭预览') })
                                    })
                                  : setClosing({ preview: p, mode: 'stop' })
                              }
                            >
                              {p.status === 'offline'
                                ? t('关闭#close')
                                : p.serviceId
                                  ? t('停止')
                                  : t('停止预览')}
                            </Button>
                          ) : null}
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
                              void act(`stop-svc:${service.id}`, () =>
                                api.post(`/services/${service.id}/stop`),
                              )
                            else if (value === 'tech') toggleTech(p.id)
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                  {showTech && tech ? <PreviewTechDetails tech={tech} /> : null}
                </div>
              )
            })}
          </GroupBox>
        </>
      ) : null}
      {backgroundServices.length ? (
        <>
          <div className="gs-toolbar">
            <span className="gs-toolbar__text">
              {t('仅后台运行（未开放预览） · {n} 个', { n: backgroundServices.length })}
            </span>
          </div>
          <GroupBox>
            {backgroundServices.map((s) => (
              <div key={s.id} className="pv-item">
                <div className="pv-row">
                  <span className="pv-row__main">
                    <span className="pv-row__title-line">
                      <span className="pv-row__title">{s.name}</span>
                      <Tag tone={SERVICE_STATE[s.status].tone}>{SERVICE_STATE[s.status].text}</Tag>
                    </span>
                    <span className="pv-muted pv-mono">
                      {[
                        s.botName,
                        s.port ? t('端口 {port}', { port: s.port }) : '',
                        `${s.cwd ? `${s.cwd}$ ` : '$ '}${s.command}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {s.canManage && canStopService(s) ? (
                    <Button
                      variant="plain"
                      size="small"
                      disabled={busyKey === `stop-svc:${s.id}`}
                      onClick={() => void act(`stop-svc:${s.id}`, () => api.post(`/services/${s.id}/stop`))}
                    >
                      {t('停止')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </GroupBox>
        </>
      ) : null}
      <Presence>
        {closing ? (
          <ClosePreviewConfirm
            preview={closing.preview}
            mode={closing.mode}
            stopService={closing.mode === 'stop' && shouldStopServiceOnClose(closing.preview)}
            onClose={() => setClosing(null)}
          />
        ) : null}
      </Presence>
    </>
  )
}
