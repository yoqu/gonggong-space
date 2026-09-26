import { Alert, Badge, Button, EmptyState, GroupBox, Icon } from '@web/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { type DaemonStatus, ipc, type MachineBot, type Overview } from '../ipc'
import { CONN_STAT, connKind, runBadge } from '../lib/labels'
import { Section } from '../lib/ui'
import { useDaemon, useNow } from '../store'
import type { PageProps } from '.'
import { RunDetail } from './RunDetail'

const REFRESH_MS = 15_000

export function OverviewPage(_: PageProps) {
  const snapshot = useDaemon((s) => s.snapshot)
  const info = useDaemon((s) => s.info)
  const status = snapshot.phase === 'running' ? snapshot.status : null
  const runs = status?.runs ?? []
  const [bots, setBots] = useState<MachineBot[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const kind = connKind(snapshot)

  // Bot bindings and workspaces change elsewhere: refetch now and then, and as soon as runs start / finish.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs.length is a refetch trigger
  useEffect(() => {
    if (kind !== 'ok') return
    const load = () => {
      ipc.bots().then(setBots, () => {})
      ipc.overview().then(setOverview, () => {})
    }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [kind, runs.length])

  const running = runs.filter((r) => !r.queued)
  const queued = runs.filter((r) => r.queued)
  const bound = bots.filter((b) => b.binding === 'bound')
  const capacity = bound.reduce((n, b) => n + b.concurrency, 0)
  const agents = status?.agents ?? []
  const secure = info?.server?.startsWith('https')
    ? info.certPinned
      ? 'WSS · 证书固定'
      : 'WSS'
    : 'WS · 未加密'

  if (detail) return <RunDetail runId={detail} onBack={() => setDetail(null)} />
  return (
    <>
      {status ? <ConnAlert status={status} version={info?.version} protocol={info?.protocol} /> : null}
      {snapshot.phase === 'blocked' ? <BlockedAlert message={snapshot.message} /> : null}
      <div className="dk-stats" data-testid="stats">
        <Stat k="连接" v={CONN_STAT[kind]} s={secure} />
        <Stat
          k="Bot"
          v={`${bound.length} 已绑定`}
          s={`agent 可用 ${agents.filter((a) => a.available).length} / ${agents.length}`}
        />
        <Stat k="并发" v={`${running.length} / ${capacity}`} s={`本机队列 ${queued.length}`} />
        <Stat
          k="工作区"
          v={overview ? `${overview.workspaces.count} 个` : '—'}
          s={overview?.workspaces.detail ?? ''}
        />
      </div>
      <Section title="正在运行">
        <GroupBox>
          <div data-testid="running">
            {running.length === 0 ? <EmptyState compact icon="bot" title="当前没有运行中的轮次" /> : null}
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
                        {r.groupName} · {r.triggeredBy} 触发
                      </span>
                    </span>
                    <span className="dk-mono dk-sub dk-ellipsis">{r.step}</span>
                  </div>
                  <Badge variant={badge.variant}>{badge.text}</Badge>
                  <Icon name="chevron-right" size={12} color="var(--label-tertiary)" />
                </button>
              )
            })}
          </div>
        </GroupBox>
      </Section>
      <Section title="本机队列">
        <GroupBox>
          {queued.length === 0 ? <EmptyState compact icon="tray" title="本机队列为空" /> : null}
          {queued.map((r, i) => (
            <div key={r.runId} className="dk-row">
              <span className="dk-row__main">
                {r.botName} · {r.groupName} · {r.triggeredBy} 触发 · 排第 {i + 1}
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
      重新绑定
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
        title={`服务器不可用 · 指数退避重连中（下次 ${sec} 秒后）`}
        description="运行中的轮次在本地继续并缓存输出，重连后补传；强制同步群该轮结束后的提交等服务器恢复后执行。"
      />
    )
  }
  if (c.state !== 'rejected') return null
  if (c.reason === 'protocol') {
    return (
      <Alert
        variant="error"
        title="协议版本不兼容 · 服务器拒绝连接"
        description={`本机 daemon v${version} 使用协议 v${protocol}，服务器：${c.message}。升级 daemon 后重启生效；升级前本机 Bot 显示离线。`}
      />
    )
  }
  if (c.reason === 'revoked') {
    const workspaces = c.wiped.filter((p) => !p.endsWith('config.json')).length
    return (
      <Alert
        variant="error"
        title="token 已被吊销 · 账号已停用"
        description={`已清除本机团队密钥与 ${workspaces} 个托管工作区（尽力而非保证）；/cd 绑定的目录与本机备份目录不动。如有误，请联系系统管理员后重新绑定。`}
      >
        <Rebind />
      </Alert>
    )
  }
  return (
    <Alert variant="error" title="token 无效 · 服务器拒绝连接" description={c.message}>
      <Rebind />
    </Alert>
  )
}

function BlockedAlert({ message }: { message: string }) {
  return (
    <Alert variant="error" title="daemon 未运行" description={message}>
      <Button size="small" onClick={() => ipc.startDaemon().catch(() => {})}>
        重试
      </Button>
    </Alert>
  )
}
