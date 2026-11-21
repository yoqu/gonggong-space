import { mergePreviewsAndServices, previewTechInfo } from '@web/features/previews/merge'
import {
  Button,
  EmptyState,
  GroupBox,
  Icon,
  PullDownButton,
  Skeleton,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc, type Tunnels } from '../ipc'
import { Section } from '../lib/ui'
import type { PageProps } from '.'
import { isLive } from './Live'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
/** The Web may change them at any time; this page follows without a push channel. */
const REFRESH_MS = 5000

const PREVIEW: Record<Tunnels['previews'][number]['status'], { text: string; tone: TagTone }> = {
  online: { text: t('在线'), tone: 'green' },
  stopped: { text: t('服务已停止'), tone: 'orange' },
  offline: { text: t('离线'), tone: 'gray' },
}

const SERVICE: Record<Tunnels['services'][number]['status'], { text: string; tone: TagTone }> = {
  starting: { text: t('启动中'), tone: 'orange' },
  running: { text: t('运行中'), tone: 'green' },
  exited: { text: t('已退出'), tone: 'gray' },
  failed: { text: t('启动失败'), tone: 'red' },
}

function kindLabel(p: Tunnels['previews'][number]) {
  if (p.kind === 'static') return t('静态页面')
  return p.serviceId ? t('网页应用') : p.port ? t('外部端口 {port}', { port: p.port }) : t('外部端口')
}

/** 在线预览: what this machine exposes and hosts; actions match the Web's 在线预览 view. */
export function TunnelsPage(_: PageProps) {
  const [data, setData] = useState<Tunnels | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // Live previews (gui / miniprogram) have their own page, 实时画面.
  const load = useCallback(() => ipc.tunnels().then(setData, fail), [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const act = async (op: Promise<void>) => {
    try {
      await op
    } catch (e) {
      fail(e)
    }
    await load()
  }

  const toggleTech = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  if (!data) return <Skeleton count={3} />
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
              const badge = PREVIEW[p.status]
              const tech = previewTechInfo(p, service)
              const showTech = Boolean(expanded[p.id] && tech)
              const menuItems = [
                ...(service && p.status !== 'stopped'
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
                        {[p.groupName, p.botName, kindLabel(p), p.status === 'stopped' ? t('卡片保留中') : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {p.status === 'stopped' ? (
                      <>
                        <Button variant="primary" size="small" onClick={() => act(ipc.startPreview(p.id))}>
                          {t('重新启动')}
                        </Button>
                        <Button size="small" onClick={() => act(ipc.closeTunnel(p.id, false))}>
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
                        <Button size="small" onClick={() => act(ipc.closeTunnel(p.id, Boolean(p.serviceId)))}>
                          {p.serviceId ? t('停止') : t('停止穿透')}
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
                          if (value === 'pause' && service) void act(ipc.stopService(service.id))
                          else if (value === 'tech') toggleTech(p.id)
                        }}
                      />
                    ) : null}
                  </div>
                  {showTech && tech ? (
                    <div className="dk-tech">
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
                      <Tag tone={SERVICE[s.status].tone}>{SERVICE[s.status].text}</Tag>
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
                  <Button size="small" onClick={() => act(ipc.stopService(s.id))}>
                    {t('停止')}
                  </Button>
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
