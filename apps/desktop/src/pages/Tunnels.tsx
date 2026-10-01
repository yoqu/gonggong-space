import { Button, EmptyState, GroupBox, Icon, Skeleton, Tag, type TagTone, toast } from '@web/ui'
import { useCallback, useEffect, useState } from 'react'
import { t } from '../i18n'
import { ipc, type Tunnels } from '../ipc'
import { Section } from '../lib/ui'
import type { PageProps } from '.'
import { isLive } from './Live'

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
/** The Web may change them at any time; this page follows without a push channel. */
const REFRESH_MS = 5000

const SERVICE: Record<Tunnels['services'][number]['status'], { text: string; tone: TagTone }> = {
  starting: { text: t('启动中'), tone: 'orange' },
  running: { text: t('运行中'), tone: 'green' },
  exited: { text: t('已退出'), tone: 'gray' },
  failed: { text: t('启动失败'), tone: 'red' },
}

/** 穿透与服务: what this machine exposes and hosts; stopping here is the same as 停止 on the Web. */
export function TunnelsPage(_: PageProps) {
  const [data, setData] = useState<Tunnels | null>(null)
  // Live previews (gui / miniprogram) have their own page, 实时画面.
  const load = useCallback(
    () =>
      ipc
        .tunnels()
        .then((all) => setData({ ...all, previews: all.previews.filter((p) => !isLive(p)) }), fail),
    [],
  )

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

  if (!data) return <Skeleton count={3} />
  return (
    <>
      <Section title={t('预览穿透')}>
        <GroupBox>
          {data.previews.length === 0 ? (
            <EmptyState compact icon="globe" title={t('本机没有开放的穿透')} />
          ) : null}
          {data.previews.map((p) => (
            <div key={p.id} className="dk-row">
              <span className="dk-tile" style={{ background: 'var(--system-blue)' }}>
                <Icon name="globe" size={16} />
              </span>
              <div className="dk-row__main">
                <span className="dk-row__title">
                  <span className="dk-strong dk-ellipsis">{p.title}</span>
                  <Tag tone={p.status === 'online' ? 'green' : 'gray'}>
                    {p.status === 'online' ? t('在线') : t('离线')}
                  </Tag>
                </span>
                <span className="dk-sub dk-ellipsis">
                  {[
                    p.groupName,
                    p.botName,
                    p.port ? t('端口 {port}', { port: p.port }) : '',
                    p.serviceName ? t('服务 {name}', { name: p.serviceName }) : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              {p.port ? (
                <Button size="small" onClick={() => ipc.openLocal(p.port as number, p.path).catch(fail)}>
                  {t('本机打开')}
                </Button>
              ) : null}
              <Button size="small" onClick={() => act(ipc.closeTunnel(p.id, true))}>
                {p.serviceId ? t('停止穿透和服务') : t('停止穿透')}
              </Button>
            </div>
          ))}
        </GroupBox>
      </Section>
      <Section title={t('托管服务')}>
        <GroupBox>
          {data.services.length === 0 ? (
            <EmptyState compact icon="server" title={t('本机没有托管服务')} />
          ) : null}
          {data.services.map((s) => (
            <div key={s.id} className="dk-row">
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
          ))}
        </GroupBox>
      </Section>
      <p className="dk-footnote">
        {t(
          'Bot 开放的预览与启动的后台服务由本机托管。在这里停止与在 Web 群里停止效果相同，群成员会立即看到变化。',
        )}
      </p>
    </>
  )
}
