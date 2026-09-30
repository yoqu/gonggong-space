import { DevtoolsGuide } from '@web/features/previews/DevtoolsGuide'
import {
  Button,
  EmptyState,
  GroupBox,
  Icon,
  ProgressIndicator,
  Skeleton,
  Tag,
  type TagTone,
  toast,
} from '@web/ui'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { type CastComponent, ipc, type Tunnels } from '../ipc'
import { PathValue, Section } from '../lib/ui'
import { openGuide, PERMISSIONS, usePermissions } from '../permissions'
import type { PageProps } from '.'

type LivePreview = Tunnels['previews'][number]

const fail = (e: unknown) => toast({ type: 'error', message: String(e) })
/** Watchers come and go on the Web; this page follows without a push channel. */
const REFRESH_MS = 5000

export const isLive = (p: LivePreview) => p.kind === 'gui' || p.kind === 'miniprogram'

const STATE: Record<NonNullable<LivePreview['live']>['state'] | 'idle', { text: string; tone: TagTone }> = {
  idle: { text: '无人观看', tone: 'gray' },
  starting: { text: '启动中', tone: 'orange' },
  live: { text: '推流中', tone: 'green' },
  failed: { text: '推流失败', tone: 'red' },
}
const WAITING = { text: '等待操作', tone: 'orange' } satisfies (typeof STATE)[keyof typeof STATE]

const COMPONENT: Record<CastComponent['source'], { text: string; tone: TagTone; desc: string }> = {
  bundled: { text: '已内置', tone: 'green', desc: '随共工一起安装与升级，无需单独下载' },
  local: { text: '本地构建', tone: 'blue', desc: '使用 GG_CAST_BIN 指定的开发构建' },
  download: {
    text: '未内置',
    tone: 'orange',
    desc: '当前是开发版共工：首次推流时从服务器下载，服务器需在「客户端发布」上传 gg-cast',
  },
}

/** 实时画面: everything live previews need on this machine — the gg-cast publisher, permissions and what is live. */
export function LivePage(_: PageProps) {
  const [component, setComponent] = useState<CastComponent | null>(null)
  const [previews, setPreviews] = useState<LivePreview[] | null>(null)
  const permissions = usePermissions((s) => s.list)
  const load = useCallback(() => ipc.tunnels().then((t) => setPreviews(t.previews.filter(isLive)), fail), [])

  useEffect(() => {
    ipc.castComponent().then(setComponent, fail)
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const close = async (p: LivePreview) => {
    try {
      await ipc.closeTunnel(p.id, true)
    } catch (e) {
      fail(e)
    }
    await load()
  }

  const c = component && COMPONENT[component.source]
  return (
    <>
      <Section title="推流组件">
        <GroupBox>
          {c && component ? (
            <div className="dk-row">
              <span className="dk-tile" style={{ background: 'var(--system-red)' }}>
                <Icon name="record" size={16} />
              </span>
              <div className="dk-row__main">
                <span className="dk-row__title">
                  <span className="dk-strong">gg-cast</span>
                  <Tag tone={c.tone}>{c.text}</Tag>
                </span>
                <span className="dk-sub">{c.desc}</span>
                {'path' in component ? <PathValue path={component.path} leaf="doc" /> : null}
              </div>
            </div>
          ) : (
            <Skeleton count={1} />
          )}
        </GroupBox>
      </Section>
      {permissions.length ? (
        <Section title="系统权限">
          <GroupBox>
            {permissions.map((p) => (
              <div key={p.kind} className="dk-row">
                <span className="dk-tile" style={{ background: 'var(--system-indigo)' }}>
                  <Icon name={PERMISSIONS[p.kind].icon} size={16} />
                </span>
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{PERMISSIONS[p.kind].label}</span>
                    <Tag tone={p.granted ? 'green' : 'orange'}>{p.granted ? '已授权' : '未授权'}</Tag>
                  </span>
                  <span className="dk-sub">{PERMISSIONS[p.kind].why}</span>
                </div>
                {p.granted ? null : (
                  <Button size="small" onClick={openGuide}>
                    去授权
                  </Button>
                )}
              </div>
            ))}
          </GroupBox>
        </Section>
      ) : null}
      <Section title="Bot 开放的实时画面">
        {previews ? (
          <GroupBox>
            {previews.length === 0 ? <EmptyState compact icon="video" title="本机没有实时画面" /> : null}
            {previews.map((p) => {
              const state = p.live?.devtools ? WAITING : STATE[p.live?.state ?? 'idle']
              const controller = p.control?.controller?.name
              return (
                <Fragment key={p.id}>
                  <div className="dk-row">
                    <span className="dk-tile" style={{ background: 'var(--system-teal)' }}>
                      <Icon name={p.kind === 'miniprogram' ? 'apps' : 'desktop'} size={16} />
                    </span>
                    <div className="dk-row__main">
                      <span className="dk-row__title">
                        <span className="dk-strong dk-ellipsis">{p.title}</span>
                        {p.live?.state === 'starting' ? (
                          <ProgressIndicator variant="spinner" aria-label="正在启动推流" />
                        ) : null}
                        <Tag tone={state.tone}>{state.text}</Tag>
                      </span>
                      <span className="dk-sub dk-ellipsis">
                        {[
                          p.groupName,
                          p.botName,
                          p.kind === 'miniprogram' ? '小程序' : '桌面应用',
                          controller ? `${controller} 正在远程操作` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {p.live?.state === 'failed' && p.live.error && !p.live.devtools ? (
                        <span className="dk-sub dk-danger">{p.live.error}</span>
                      ) : null}
                    </div>
                    {p.live?.missing.length ? (
                      <Button size="small" onClick={openGuide}>
                        去授权
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => void close(p)}>
                      {p.serviceId ? '关闭并停止应用' : '关闭'}
                    </Button>
                  </div>
                  {p.live?.devtools ? <DevtoolsGuide blocker={p.live.devtools} /> : null}
                </Fragment>
              )
            })}
          </GroupBox>
        ) : (
          <Skeleton count={2} />
        )}
      </Section>
      <p className="dk-footnote">
        群成员在 Web 打开实时画面时，本机才用 gg-cast
        推送对应窗口；没人看时自动停止。推流失败会自动重试，原因显示在这里。
      </p>
    </>
  )
}
