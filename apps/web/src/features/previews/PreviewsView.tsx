import type { PreviewDto, ServiceDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Button, EmptyState, GroupBox, NoTabsArt, PullDownButton, Spinner, Tag, type TagTone } from '../../ui'
import { mergePreviewsAndServices, previewTechInfo } from './merge'
import './previews.css'
import { openInWorkbench, openUrl, usePreviews } from './store'

const PREVIEW_BADGE: Record<PreviewDto['status'], { text: string; tone: TagTone }> = {
  online: { text: t('在线'), tone: 'green' },
  stopped: { text: t('已暂停'), tone: 'orange' },
  offline: { text: t('离线'), tone: 'gray' },
}

const SERVICE_STATE: Record<ServiceDto['status'], { text: string; tone: TagTone }> = {
  starting: { text: t('启动中'), tone: 'orange' },
  running: { text: t('运行中'), tone: 'green' },
  exited: { text: t('已退出'), tone: 'gray' },
  failed: { text: t('启动失败'), tone: 'red' },
}

const act = (path: string, body?: unknown) => attempt(() => api.post(path, body))

function kindLabel(p: PreviewDto) {
  if (p.kind === 'static') return t('静态页面')
  if (p.kind === 'gui') return t('桌面应用')
  if (p.kind === 'miniprogram') return t('小程序')
  return p.serviceId ? t('网页应用') : p.port ? t('外部端口 {port}', { port: p.port }) : t('外部端口')
}

/**
 * 群设置 · 在线预览: previews and orphan background services in this group; managers can open, stop, pause or restart.
 */
export function PreviewsView({ groupId, onOpen }: { groupId: string; onOpen?: () => void }) {
  const list = usePreviews(groupId)
  if (!list) return <Spinner />
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
  const toggleTech = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

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
              const web = p.kind === 'http' || p.kind === 'static'
              const menuItems = [
                ...(p.canManage && service && p.status === 'online'
                  ? [{ label: t('仅暂停后台进程（保留卡片）'), value: 'pause' }]
                  : []),
                ...(tech ? [{ label: showTech ? t('收起技术详情') : t('查看技术详情'), value: 'tech' }] : []),
              ]
              return (
                <div key={p.id} className="pv-item">
                  <div className="pv-row">
                    <span className="pv-row__main">
                      <span className="pv-row__title-line">
                        {web ? (
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
                        {[p.botName, kindLabel(p), p.status === 'stopped' ? t('卡片保留中') : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="pv-item__actions">
                      {p.status === 'stopped' && p.canManage ? (
                        <>
                          <Button
                            variant="primary"
                            size="small"
                            onClick={() => void act(`/previews/${p.id}/start`)}
                          >
                            {t('重新启动')}
                          </Button>
                          <Button
                            variant="plain"
                            size="small"
                            onClick={() => void act(`/previews/${p.id}/close`, { stopService: false })}
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
                              onClick={() =>
                                void act(`/previews/${p.id}/close`, {
                                  stopService: p.status !== 'offline' && Boolean(p.serviceId),
                                })
                              }
                            >
                              {p.status === 'offline'
                                ? t('关闭#close')
                                : p.serviceId
                                  ? t('停止')
                                  : web
                                    ? t('停止穿透')
                                    : t('关闭#close')}
                            </Button>
                          ) : null}
                        </>
                      )}
                      {menuItems.length ? (
                        <PullDownButton
                          variant="plain"
                          size="small"
                          icon="more"
                          indicator={false}
                          aria-label={t('{name} 的更多操作', { name: p.title })}
                          align="end"
                          portal
                          items={menuItems}
                          onSelect={(value) => {
                            if (value === 'pause' && service) void act(`/services/${service.id}/stop`)
                            else if (value === 'tech') toggleTech(p.id)
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                  {showTech && tech ? (
                    <div className="pv-tech">
                      {tech.port !== null ? (
                        <span>{t('端口 {port}', { port: `127.0.0.1:${tech.port}` })}</span>
                      ) : null}
                      {tech.path ? <span>{t('路径 {path}', { path: tech.path })}</span> : null}
                      {tech.serviceName ? <span>{t('服务 {name}', { name: tech.serviceName })}</span> : null}
                      {tech.command ? <span>$ {tech.command}</span> : null}
                    </div>
                  ) : null}
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
                  {s.canManage && (s.status === 'running' || s.status === 'starting') ? (
                    <Button variant="plain" size="small" onClick={() => void act(`/services/${s.id}/stop`)}>
                      {t('停止')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </GroupBox>
        </>
      ) : null}
    </>
  )
}
