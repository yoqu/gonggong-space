import { CastRetry } from '@web/features/previews/CastRetry'
import { DevtoolsGuide } from '@web/features/previews/DevtoolsGuide'
import {
  Alert,
  AlertDialog,
  Button,
  EmptyState,
  GroupBox,
  Icon,
  ProgressIndicator,
  Skeleton,
  Tag,
  type TagTone,
} from '@web/ui'
import { Fragment, useCallback, useState } from 'react'
import logo from '../assets/logo.svg'
import { t } from '../i18n'
import { type CastComponent, ipc, type Tunnels } from '../ipc'
import { fail, PathValue, Section } from '../lib/ui'
import { useIpc } from '../lib/useIpc'
import { openGuide, PERMISSIONS, usePermissions } from '../permissions'
import type { PageProps } from '.'

type LivePreview = Tunnels['previews'][number]

/** Watchers come and go on the Web; this page follows without a push channel. */
const REFRESH_MS = 5000

export const isLive = (p: LivePreview) => p.kind === 'gui' || p.kind === 'miniprogram'

const STATE: Record<NonNullable<LivePreview['live']>['state'] | 'idle', { text: string; tone: TagTone }> = {
  idle: { text: t('无人观看'), tone: 'gray' },
  starting: { text: t('启动中'), tone: 'orange' },
  live: { text: t('推流中'), tone: 'green' },
  failed: { text: t('推流失败'), tone: 'red' },
}
const WAITING = { text: t('等待操作'), tone: 'orange' } satisfies (typeof STATE)[keyof typeof STATE]

const COMPONENT: Record<CastComponent['source'], { text: string; tone: TagTone; desc: string }> = {
  bundled: { text: t('已内置'), tone: 'green', desc: t('随共工空间一起安装与升级，无需单独下载') },
  local: { text: t('本地构建'), tone: 'blue', desc: t('使用 GG_CAST_BIN 指定的开发构建') },
  download: {
    text: t('未内置'),
    tone: 'orange',
    desc: t('当前是开发版共工空间：首次推流时从服务器下载，请先在管理后台「客户端发布」上传实时画面组件'),
  },
}

/** 实时画面: everything live previews need on this machine — the gg-cast publisher, permissions and what is live. */
export function LivePage(_: PageProps) {
  const componentQ = useIpc(ipc.castComponent)
  const loadLive = useCallback(() => ipc.tunnels().then((all) => all.previews.filter(isLive)), [])
  const previewsQ = useIpc(loadLive, { pollMs: REFRESH_MS })
  const permissions = usePermissions((s) => s.list)
  const component = componentQ.data
  const previews = previewsQ.data
  const load = previewsQ.reload
  // Kept after closing so the dialog keeps its text while it animates out.
  const [doomed, setDoomed] = useState<LivePreview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [closing, setClosing] = useState(false)

  const close = async (p: LivePreview) => {
    try {
      await ipc.closeTunnel(p.id, true)
    } catch (e) {
      fail(e)
    }
    await load()
  }

  const closeConfirm = () => {
    if (!closing) setConfirming(false)
  }

  const confirmClose = async () => {
    if (!doomed || closing) return
    setClosing(true)
    try {
      await close(doomed)
    } finally {
      setClosing(false)
      setConfirming(false)
    }
  }

  const c = component && COMPONENT[component.source]
  return (
    <>
      <Section title={t('推流组件')}>
        {!component && componentQ.error ? (
          <Alert
            variant="error"
            description={componentQ.error}
            retrying={componentQ.loading}
            onRetry={() => void componentQ.reload()}
          />
        ) : (
          <GroupBox>
            {c && component ? (
              <div className="dk-row">
                <span className="dk-tile" style={{ background: 'var(--system-red)' }}>
                  <Icon name="record" size={16} />
                </span>
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{t('实时画面组件')}</span>
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
        )}
      </Section>
      {permissions.length ? (
        <Section title={t('系统权限')}>
          <GroupBox>
            {permissions.map((p) => (
              <div key={p.kind} className="dk-row">
                <span className="dk-tile" style={{ background: 'var(--system-indigo)' }}>
                  <Icon name={PERMISSIONS[p.kind].icon} size={16} />
                </span>
                <div className="dk-row__main">
                  <span className="dk-row__title">
                    <span className="dk-strong">{PERMISSIONS[p.kind].label}</span>
                    <Tag tone={p.granted ? 'green' : 'orange'}>{p.granted ? t('已授权') : t('未授权')}</Tag>
                  </span>
                  <span className="dk-sub">{PERMISSIONS[p.kind].why}</span>
                </div>
                {p.granted ? null : (
                  <Button size="small" onClick={openGuide}>
                    {t('去授权')}
                  </Button>
                )}
              </div>
            ))}
          </GroupBox>
        </Section>
      ) : null}
      <Section title={t('Bot 开放的实时画面')}>
        {previews ? (
          <GroupBox>
            {previews.length === 0 ? <EmptyState compact icon="video" title={t('本机没有实时画面')} /> : null}
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
                          <ProgressIndicator variant="spinner" aria-label={t('正在启动推流')} />
                        ) : null}
                        <Tag tone={state.tone}>{state.text}</Tag>
                      </span>
                      <span className="dk-sub dk-ellipsis">
                        {[
                          p.groupName,
                          p.botName,
                          p.kind === 'miniprogram' ? t('小程序') : t('桌面应用'),
                          controller ? t('{name} 正在远程操作', { name: controller }) : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {p.live?.state === 'failed' && p.live.error && !p.live.devtools ? (
                        <span className="dk-sub dk-danger">{p.live.error}</span>
                      ) : null}
                      {p.live?.state === 'failed' && !p.live.devtools ? (
                        <CastRetry
                          retryAt={p.live.retryAt}
                          attempt={p.live}
                          retry={() => ipc.retryCast(p.id).then(load)}
                        />
                      ) : null}
                    </div>
                    {p.live?.missing.length ? (
                      <Button size="small" onClick={openGuide}>
                        {t('去授权')}
                      </Button>
                    ) : null}
                    {p.serviceId ? (
                      <Button
                        size="small"
                        onClick={() => {
                          setDoomed(p)
                          setConfirming(true)
                        }}
                      >
                        {t('关闭并停止应用')}
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => void close(p)}>
                        {t('关闭')}
                      </Button>
                    )}
                  </div>
                  {p.live?.devtools ? <DevtoolsGuide blocker={p.live.devtools} /> : null}
                </Fragment>
              )
            })}
          </GroupBox>
        ) : previewsQ.error ? (
          <Alert
            variant="error"
            description={previewsQ.error}
            retrying={previewsQ.loading}
            onRetry={() => void previewsQ.reload()}
          />
        ) : (
          <Skeleton count={2} />
        )}
      </Section>
      <p className="dk-footnote">
        {t(
          '群成员在网页端打开实时画面时，这台电脑才开始推送对应窗口；没人看时自动停止。推送失败会自动重试，原因会显示在这里。',
        )}
      </p>
      <AlertDialog
        open={confirming}
        onClose={closeConfirm}
        icon={<img src={logo} alt="" width={48} height={48} />}
        title={doomed ? t('要关闭「{title}」并停止应用吗？', { title: doomed.title }) : ''}
        message={t('关闭后群成员将看不到这个实时画面，Bot 启动的应用也会一并停止。')}
        actions={[
          { label: t('取消'), disabled: closing, onClick: closeConfirm },
          {
            label: t('关闭并停止应用'),
            variant: 'destructive',
            disabled: closing,
            loading: closing,
            onClick: () => void confirmClose(),
          },
        ]}
      />
    </>
  )
}
