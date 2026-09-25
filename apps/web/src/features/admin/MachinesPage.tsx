import { type AdminMachineDto, PROTOCOL_VERSION } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, Presence, SearchField, Spinner, Table, ToolbarButton, ToolbarGroup } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { hardwareText, MachineDialog, osText } from '../machines/MachineDialog'
import '../machines/machines.css'
import { RevokeMachineDialog } from '../machines/RevokeMachineDialog'
import { AdminPage } from './AdminPage'
import { useSystemParams } from './ParamsPage'

const outdated = (m: AdminMachineDto) => m.protocol != null && m.protocol < PROTOCOL_VERSION

/** Machine events only reach their owner, so the list is also refreshed on a heartbeat-sized interval. */
const POLL_MS = 15_000

/** The server stamps lastSeenAt on connect and disconnect only, so an online machine is live by definition. */
function lastHeartbeat(m: AdminMachineDto) {
  if (m.online) return '刚刚'
  if (!m.lastSeenAt) return '从未连接'
  const min = Math.floor((Date.now() - Date.parse(m.lastSeenAt)) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  return min < 1440 ? `${Math.floor(min / 60)} 小时前` : `${Math.floor(min / 1440)} 天前`
}

/** Latest measurement reported by the daemon; red with a warning sign past the force-sync thresholds. */
function Net({ text, bad, at }: { text: string; bad: boolean; at: string | null }) {
  return (
    <span
      className={bad ? 'admin-table__bad' : undefined}
      title={at ? `测量于 ${new Date(at).toLocaleString()}` : undefined}
    >
      {text}
    </span>
  )
}

/** 管理后台 · 机器: every machine plus the network quality last measured by each daemon (spec §8.5). */
export function MachinesPage() {
  const [machines, setMachines] = useState<AdminMachineDto[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<AdminMachineDto | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const params = useSystemParams()
  const load = useCallback(
    () =>
      api
        .get<AdminMachineDto[]>('/admin/machines')
        .then((list) => {
          setMachines(list)
          setError('')
        })
        .catch((e) => setError(errorText(e))),
    [],
  )
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'machine.updated' || e.t === 'machine.removed') void load()
    })
    const offStatus = realtime.onStatus((st) => {
      if (st === 'open') void load()
    })
    return () => {
      clearInterval(timer)
      offEvents()
      offStatus()
    }
  }, [load])
  const old = machines?.filter(outdated) ?? []
  const open = machines?.find((m) => m.id === openId)
  const q = query.trim().toLowerCase()
  const shown = machines?.filter(
    (m) => !q || `${m.name} ${m.hostname} ${m.ownerName}`.toLowerCase().includes(q),
  )
  const online = machines?.filter((m) => m.online).length ?? 0

  return (
    <AdminPage
      title="机器与网络"
      desc="所有机器的系统、硬件、daemon 版本、在线状态与网络质量记录。"
      subtitle={machines ? `${machines.length} 台 · ${online} 台在线` : undefined}
      actions={
        <ToolbarGroup>
          <ToolbarButton
            icon="info"
            label="机器详情…"
            disabled={!selected}
            onClick={() => setOpenId(selected)}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder="搜索机器或主人" value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <Table<AdminMachineDto>
          aria-label="机器列表"
          className="admin-grid"
          rows={shown}
          multiple={false}
          selection={selected ? [selected] : []}
          onSelectionChange={(ids) => setSelected(ids[0] ? String(ids[0]) : null)}
          defaultSort={{ key: 'ownerName', dir: 'asc' }}
          onOpen={(m) => setOpenId(m.id)}
          rowActions={() => [
            { label: '机器详情…', value: 'open' },
            { separator: true },
            { label: '吊销机器…', value: 'revoke', destructive: true },
          ]}
          onRowAction={(action, m) => (action === 'open' ? setOpenId(m.id) : setRevoking(m))}
          emptyText={q ? '没有匹配的机器' : '还没有机器'}
          columns={[
            { key: 'ownerName', title: '主人', width: 88, sortable: true },
            {
              key: 'name',
              title: '机器',
              mono: true,
              sortable: true,
              render: (m) => <span title={m.name === m.hostname ? undefined : m.hostname}>{m.name}</span>,
            },
            { key: 'os', title: '系统', sortable: true, sortValue: osText, render: osText },
            { key: 'hardware', title: '硬件', secondary: true, render: (m) => hardwareText(m) },
            {
              key: 'daemonVersion',
              title: 'daemon',
              width: 84,
              mono: true,
              sortable: true,
              render: (m) =>
                m.daemonVersion ? (
                  <span className={outdated(m) ? 'admin-table__warn' : undefined}>v{m.daemonVersion}</span>
                ) : null,
            },
            {
              key: 'latencyMs',
              title: '延迟',
              width: 80,
              align: 'right',
              sortable: true,
              sortValue: (m) => m.latencyMs ?? Number.POSITIVE_INFINITY,
              render: (m) =>
                m.latencyMs == null ? null : (
                  <Net
                    text={`${m.latencyMs} ms`}
                    bad={!!params && m.latencyMs > params.forceSyncMaxLatencyMs}
                    at={m.netMeasuredAt}
                  />
                ),
            },
            {
              key: 'bandwidthMbps',
              title: '带宽',
              width: 96,
              align: 'right',
              sortable: true,
              sortValue: (m) => m.bandwidthMbps ?? -1,
              render: (m) =>
                m.bandwidthMbps == null ? null : (
                  <Net
                    text={`${Number(m.bandwidthMbps.toFixed(1))} Mbps`}
                    bad={!!params && m.bandwidthMbps < params.forceSyncMinBandwidthMbps}
                    at={m.netMeasuredAt}
                  />
                ),
            },
            {
              key: 'online',
              title: '状态',
              width: 72,
              sortable: true,
              sortValue: (m) => (m.online ? 0 : 1),
              render: (m) => (
                <span className="admin-status">
                  <span className={m.online ? 'admin-dot admin-dot--on' : 'admin-dot'} />
                  {m.online ? '在线' : '离线'}
                </span>
              ),
            },
            {
              key: 'lastSeenAt',
              title: '最后心跳',
              width: 96,
              secondary: true,
              sortable: true,
              sortValue: (m) => (m.online ? Number.POSITIVE_INFINITY : Date.parse(m.lastSeenAt ?? '') || 0),
              render: (m) => (
                <span title={m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : undefined}>
                  {lastHeartbeat(m)}
                </span>
              ),
            },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
      <Presence>
        {open ? (
          <MachineDialog
            key={open.id}
            machine={open}
            ownerName={open.ownerName}
            onChanged={() => void load()}
            onClose={() => setOpenId(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {revoking ? (
          <RevokeMachineDialog
            machine={revoking}
            onRevoked={() => {
              setRevoking(null)
              void load()
            }}
            onClose={() => setRevoking(null)}
          />
        ) : null}
      </Presence>
      {old.length ? (
        <Alert
          variant="warning"
          title={`${old.length} 台 daemon 协议版本过旧`}
          description={`${old.map((m) => `${m.name} 运行 v${m.daemonVersion ?? '?'}（协议 v${m.protocol}）`).join('、')}，服务器已拒绝连接并提示升级。`}
        />
      ) : null}
      <p className="admin__foot">
        {params
          ? `网络质量由成员在 daemon 中测量上报（gg net 或桌面端「测量延迟与带宽」），不在群里展示。强制同步开启阈值：延迟 ≤ ${params.forceSyncMaxLatencyMs} ms，带宽 ≥ ${params.forceSyncMinBandwidthMbps} Mbps。`
          : '网络质量由成员在 daemon 中测量上报（gg net 或桌面端「测量延迟与带宽」），不在群里展示。'}
      </p>
    </AdminPage>
  )
}
