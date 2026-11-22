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
import { Alert, Button, EmptyState, GroupBox, Icon, PullDownButton, Skeleton, Tag } from '@web/ui'
import { useState } from 'react'
import { t } from '../i18n'
import { ipc } from '../ipc'
import { fail, Section } from '../lib/ui'
import { useIpc } from '../lib/useIpc'
import type { PageProps } from '.'
import { isLive } from './Live'

/** The Web may change them at any time; this page follows without a push channel. */
const REFRESH_MS = 5000

/** 在线预览: what this machine exposes and hosts; actions match the Web's 在线预览 view. */
export function TunnelsPage(_: PageProps) {
  // Live previews (gui / miniprogram) have their own page, 实时画面.
  const { data, error, loading, reload } = useIpc(ipc.tunnels, { pollMs: REFRESH_MS })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const act = async (key: string, op: () => Promise<void>) => {
    if (busyKey === key) return
    setBusyKey(key)
    try {
      await op()
    } catch (e) {
      fail(e)
    }
    await reload()
    setBusyKey((cur) => (cur === key ? null : cur))
  }

  const toggleTech = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  if (!data) {
    if (error)
      return <Alert variant="error" description={error} retrying={loading} onRetry={() => void reload()} />
    return <Skeleton count={3} />
  }
  const { items, backgroundServices } = mergePreviewsAndServices(
    data.previews,
    data.services,
    (p) => !isLive(p),
  )
  const empty = items.length === 0 && backgroundServices.length === 0

  return (
    <>
      {empty || items.length > 0 ? (
        <Section title={t('在线预览')}>
          <GroupBox>
            {empty ? <EmptyState compact icon="globe" title={t('本机没有在线预览')} /> : null}
            {items.map(({ preview: p, service }) => {
              const badge = PREVIEW_BADGE[p.status]
              const tech = previewTechInfo(p, service)
              const showTech = Boolean(expanded[p.id] && tech)
              const menuItems = [
                ...(canPausePreview(p, service)
                  ? [{ label: t('仅暂停后台进程（保留卡片）'), value: 'pause' }]
                  : []),
                ...(tech ? [{ label: showTech ? t('收起技术详情') : t('查看技术详情'), value: 'tech' }] : []),
              ]
              return (
                <div key={p.id} className="dk-row-item">
                  <div className="dk-row">
                    <span
                      className="dk-tile"
                      style={{
                        background: p.status === 'stopped' ? 'var(--system-orange)' : 'var(--system-blue)',
                      }}
                    >
                      <Icon name={p.kind === 'static' ? 'doc' : p.serviceId ? 'globe' : 'link'} size={16} />
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
                          variant="primary"
                          size="small"
                          disabled={busyKey === `start:${p.id}`}
                          onClick={() => void act(`start:${p.id}`, () => ipc.startPreview(p.id))}
                        >
                          {t('重新启动')}
                        </Button>
                        <Button
                          size="small"
                          disabled={busyKey === `close:${p.id}`}
                          onClick={() => void act(`close:${p.id}`, () => ipc.closeTunnel(p.id, false))}
                        >
                          {t('彻底关闭')}
                        </Button>
                      </>
                    ) : (
                      <>
                        {p.port && p.status === 'online' ? (
                          <Button
                            size="small"
                            onClick={() => ipc.openLocal(p.port as number, p.path).catch(fail)}
                          >
                            {t('本机打开')}
                          </Button>
                        ) : null}
                        <Button
                          size="small"
                          disabled={busyKey === `close:${p.id}`}
                          onClick={() =>
                            void act(`close:${p.id}`, () =>
                              ipc.closeTunnel(p.id, shouldStopServiceOnClose(p)),
                            )
                          }
                        >
                          {p.status === 'offline' ? t('关闭') : p.serviceId ? t('停止') : t('停止穿透')}
                        </Button>
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
                          if (value === 'pause' && service)
                            void act(`stop-svc:${service.id}`, () => ipc.stopService(service.id))
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
                    <span className="dk-mono dk-sub dk-ellipsis" title={s.cwd}>
                      $ {s.command}
                    </span>
                  </div>
                  {canStopService(s) ? (
                    <Button
                      size="small"
                      disabled={busyKey === `stop-svc:${s.id}`}
                      onClick={() => void act(`stop-svc:${s.id}`, () => ipc.stopService(s.id))}
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
        {t('Bot 开放的网页与后台服务由这台电脑运行。在这里操作与在 Web 群里效果相同，群成员会立即看到变化。')}
      </p>
    </>
  )
}
