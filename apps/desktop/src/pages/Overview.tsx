import { toolTitle } from '@web/features/runs/mcp'
import { Alert, Badge, Button, EmptyState, GroupBox, Icon } from '@web/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { t } from '../i18n'
import { type DaemonStatus, ipc, type MachineBot, type Tunnels } from '../ipc'
import { CONN_STAT, connKind, runBadge } from '../lib/labels'
import { Section } from '../lib/ui'
import { openGuide, PERMISSIONS, useMissing } from '../permissions'
import { useDaemon, useNow } from '../store'
import type { PageProps } from '.'
import { isLive } from './Live'
import { RunDetail } from './RunDetail'

const REFRESH_MS = 15_000

export function OverviewPage({ go }: PageProps) {
  const snapshot = useDaemon((s) => s.snapshot)
  const info = useDaemon((s) => s.info)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const runs = status?.runs ?? []
  const [bots, setBots] = useState<MachineBot[]>([])
  const [failedLive, setFailedLive] = useState<Tunnels['previews']>([])
  const overview = useDaemon((s) => s.overview)
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
  const bound = bots.filter((b) => b.binding === 'bound')
  const capacity = bound.reduce((n, b) => n + b.concurrency, 0)
  const agents = status?.agents ?? []
  const secure = info?.server?.startsWith('https') ? t('加密连接') : t('未加密连接')

  if (detail) return <RunDetail runId={detail} onBack={() => setDetail(null)} />
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
    <Button size="small" onClick={() => ipc.unbind()}>
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
  const now = useNow()
  const c = status.conn
  if (c.state === 'offline') {
    const sec = Math.max(0, Math.ceil((c.retryAtMs - now) / 1000))
    return (
      <Alert
        variant="warning"
        title={t('服务器不可用 · 指数退避重连中（下次 {sec} 秒后）', { sec })}
        description={t(
          '运行中的轮次在本地继续并缓存输出，重连后补传；强制同步群该轮结束后的提交等服务器恢复后执行。',
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
          '本机 daemon v{version} 使用协议 v{protocol}，服务器：{message}。升级 daemon 后重启生效；升级前本机 Bot 显示离线。',
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
        title={t('token 已被吊销 · 账号已停用')}
        description={t(
          '已清除本机团队密钥与 {n} 个托管工作区（尽力而非保证）；/cd 绑定的目录与本机备份目录不动。如有误，请联系系统管理员后重新绑定。',
          { n: workspaces },
        )}
      >
        <Rebind />
      </Alert>
    )
  }
  return (
    <Alert variant="error" title={t('token 无效 · 服务器拒绝连接')} description={c.message}>
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
    <Alert variant="error" title={t('daemon 未运行')} description={message}>
      <Button size="small" onClick={() => ipc.startDaemon().catch(() => {})}>
        {t('重试')}
      </Button>
    </Alert>
  )
}
