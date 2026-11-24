import { toolTitle } from '@web/features/runs/mcp'
import { useNow } from '@web/lib/now'
import { Alert, Badge, Button, EmptyState, GroupBox, Icon } from '@web/ui'
import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type DaemonStatus, ipc, type MachineBot, type Tunnels } from '../ipc'
import { ContextBadge } from '../lib/ContextBadge'
import { CONN_STAT, connKind, runBadge } from '../lib/labels'
import { fail, Section } from '../lib/ui'
import { openGuide, PERMISSIONS, useMissing } from '../permissions'
import { useDaemon } from '../store'
import type { PageProps } from '.'
import { isLive } from './Live'

// The run process renders markdown and code: loaded only when a run is opened.
const RunDetail = lazy(() => import('./RunDetail').then((m) => ({ default: m.RunDetail })))

const REFRESH_MS = 15_000

export function OverviewPage({ go }: PageProps) {
  const snapshot = useDaemon((s) => s.snapshot)
  const info = useDaemon((s) => s.info)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const runs = status?.runs ?? []
  const [bots, setBots] = useState<MachineBot[] | null>(null)
  const [failedLive, setFailedLive] = useState<Tunnels['previews']>([])
  const overview = useDaemon((s) => s.overview)
  const botGuideDismissed = useDaemon((s) => s.botGuideDismissed)
  const [detail, setDetail] = useState<string | null>(null)
  const kind = connKind(snapshot)

  // Bot bindings and workspaces change elsewhere: refetch now and then, and as soon as runs start / finish.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs.length is a refetch trigger
  useEffect(() => {
    if (kind !== 'ok') return
    const load = () => {
      ipc.bots().then(setBots, () => {})
      ipc.tunnels().then(
        (all) => setFailedLive(all.previews.filter((p) => isLive(p) && p.live?.state === 'failed')),
        () => {},
      )
      ipc.overview().then(
        (overview) => useDaemon.setState({ overview }),
        () => {},
      )
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [kind, runs.length])

  const running = runs.filter((r) => !r.queued)
  const queued = runs.filter((r) => r.queued)
  const botList = bots ?? []
  const bound = botList.filter((b) => b.binding === 'bound')
  const capacity = bound.reduce((n, b) => n + b.concurrency, 0)
  const agents = status?.agents ?? []
  const secure = info?.server?.startsWith('https') ? t('加密连接') : t('未加密连接')
  const showBotGuide =
    kind === 'ok' && Boolean(info?.server) && bots !== null && bots.length === 0 && !botGuideDismissed

  if (detail)
    return (
      <Suspense>
        <RunDetail runId={detail} onBack={() => setDetail(null)} />
      </Suspense>
    )
  return (
    <>
      {status ? <ConnAlert status={status} version={info?.version} protocol={info?.protocol} /> : null}
      {snapshot.phase === 'blocked' ? <BlockedAlert message={snapshot.message} /> : null}
      <PermissionsAlert />
      {failedLive.length ? (
        <Alert
          variant="warning"
          title={t('实时画面推流失败：{list}', { list: failedLive.map((p) => p.title).join(t('、')) })}
          description={failedLive[0]?.live?.error ?? undefined}
        >
          <Button size="small" onClick={() => go('live')}>
            {t('查看')}
          </Button>
        </Alert>
      ) : null}
      {showBotGuide ? (
        <GroupBox>
          <div className="dk-guide" data-testid="create-bot-guide">
            <span className="dk-tile" style={{ background: 'var(--system-indigo)' }}>
              <Icon name="bot" size={16} />
            </span>
            <div className="dk-row__main">
              <span className="dk-strong">{t('电脑已接入，接下来创建你的第一个 Bot')}</span>
              <span className="dk-sub">{t('在网页端为这台电脑创建 Bot 后，就能在群里 @ 它开始干活。')}</span>
            </div>
            <div className="dk-guide__actions">
              <Button size="small" onClick={() => useDaemon.setState({ botGuideDismissed: true })}>
                {t('稍后再说')}
              </Button>
              <Button variant="primary" size="small" onClick={() => void ipc.openWeb().catch(fail)}>
                {t('去网页端创建 Bot')}
              </Button>
            </div>
          </div>
        </GroupBox>
      ) : null}
      <div className="dk-stats" data-testid="stats">
        <Stat k={t('连接')} v={CONN_STAT[kind]} s={secure} />
        <Stat
          k="Bot"
          v={t('{n} 已绑定', { n: bound.length })}
          s={t('Agent 可用 {ok} / {all}', {
            ok: agents.filter((a) => a.available).length,
            all: agents.length,
          })}
        />
        <Stat
          k={t('并发')}
          v={`${running.length} / ${capacity}`}
          s={t('本机队列 {n}', { n: queued.length })}
        />
        <Stat
          k={t('工作区')}
          v={overview ? t('{n} 个', { n: overview.workspaces.count }) : '—'}
          s={overview?.workspaces.detail ?? t('统计中…')}
        />
      </div>
      <Section title={t('正在运行')}>
        <GroupBox>
          <div data-testid="running">
            {running.length === 0 ? (
              <EmptyState compact icon="bot" title={t('当前没有运行中的轮次')} />
            ) : null}
            {running.map((r) => {
              const badge = runBadge(r.status)
              return (
                <button
                  key={r.runId}
                  type="button"
                  className="dk-row dk-row--button"
                  onClick={() => setDetail(r.runId)}
                >
                  <Icon name="bot" size={18} color="var(--system-indigo)" />
                  <div className="dk-row__main">
                    <span className="dk-row__title">
                      <span className="dk-strong">{r.botName}</span>
                      <span className="dk-sub">
                        {t('{group} · {user} 触发', { group: r.groupName, user: r.triggeredBy })}
                      </span>
                    </span>
                    <span className="dk-mono dk-sub dk-ellipsis">{toolTitle(r.step)}</span>
                  </div>
                  {r.context ? <ContextBadge inert bot={r.botName} context={r.context} /> : null}
                  <Badge variant={badge.variant}>{badge.text}</Badge>
                  <Icon name="chevron-right" size={12} color="var(--label-tertiary)" />
                </button>
              )
            })}
          </div>
        </GroupBox>
      </Section>
      <Section title={t('本机队列')}>
        <GroupBox>
          {queued.length === 0 ? <EmptyState compact icon="tray" title={t('本机队列为空')} /> : null}
          {queued.map((r, i) => (
            <div key={r.runId} className="dk-row">
              <span className="dk-row__main">
                {t('{bot} · {group} · {user} 触发 · 排第 {n}', {
                  bot: r.botName,
                  group: r.groupName,
                  user: r.triggeredBy,
                  n: i + 1,
                })}
              </span>
            </div>
          ))}
        </GroupBox>
      </Section>
    </>
  )
}

function Stat({ k, v, s }: { k: string; v: ReactNode; s: ReactNode }) {
  return (
    <div className="dk-stat">
      <span className="dk-stat__k">{k}</span>
      <span className="dk-stat__v">{v}</span>
      <span className="dk-stat__s">{s}</span>
    </div>
  )
}

function Rebind() {
  return (
    <Button size="small" onClick={() => void ipc.unbind().catch(fail)}>
      {t('重新绑定')}
    </Button>
  )
}

function ConnAlert({
  status,
  version,
  protocol,
}: {
  status: DaemonStatus
  version?: string
  protocol?: number
}) {
  const c = status.conn
  const now = useNow(c.state === 'offline')
  if (c.state === 'offline') {
    const sec = Math.max(0, Math.ceil((c.retryAtMs - now) / 1000))
    return (
      <Alert
        variant="warning"
        title={t('连不上服务器 · {sec} 秒后自动重连', { sec })}
        description={t(
          '运行中的任务会在本地继续并暂存输出，重连后自动补传；强制同步群的提交会等服务器恢复后继续。',
        )}
      />
    )
  }
  if (c.state !== 'rejected') return null
  if (c.reason === 'protocol') {
    return (
      <Alert
        variant="error"
        title={t('协议版本不兼容 · 服务器拒绝连接')}
        description={t(
          '这台电脑的共工客户端（v{version}）版本太旧，与服务器不兼容（{message}）。请升级后重启；升级前这台电脑上的 Bot 会显示离线。',
          { version: version ?? '', protocol: protocol ?? '', message: c.message },
        )}
      />
    )
  }
  if (c.reason === 'revoked') {
    const workspaces = c.wiped.filter((p) => !p.endsWith('config.json')).length
    return (
      <Alert
        variant="error"
        title={t('电脑已解绑 · 账号已停用')}
        description={t(
          '已清理这台电脑上的团队密钥和 {n} 个托管工作区；你手动选择的本机目录和本地备份保持不变。如有误，请联系系统管理员后重新绑定。',
          { n: workspaces },
        )}
      >
        <Rebind />
      </Alert>
    )
  }
  return (
    <Alert variant="error" title={t('绑定已失效 · 服务器拒绝连接')} description={c.message}>
      <Rebind />
    </Alert>
  )
}

function PermissionsAlert() {
  const missing = useMissing()
  if (!missing.length) return null
  return (
    <Alert
      variant="warning"
      title={t('未授权：{list}', { list: missing.map((p) => PERMISSIONS[p.kind].label).join(t('、')) })}
      description={t('Bot 推送的桌面应用、小程序实时画面或远程操作在本机不可用，授权后即可使用。')}
    >
      <Button size="small" onClick={openGuide}>
        {t('去授权')}
      </Button>
    </Alert>
  )
}

function BlockedAlert({ message }: { message: string }) {
  return (
    <Alert
      variant="error"
      title={t('共工客户端未运行')}
      description={message}
      onRetry={() => void ipc.startDaemon().catch(() => {})}
    />
  )
}
