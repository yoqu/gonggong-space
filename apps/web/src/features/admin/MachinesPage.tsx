import { type AdminMachineDto, PROTOCOL_VERSION } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { Alert, EmptyState, Presence, SearchField, Spinner } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { hardwareText, MachineDialog, osText } from '../machines/MachineDialog'
import '../machines/machines.css'
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

/** Latest measurement reported by the daemon; red past the force-sync thresholds. */
function NetCell({ text, bad, at }: { text: string | null; bad: boolean; at: string | null }) {
  if (text === null) return <td>—</td>
  return (
    <td
      className={bad ? 'admin-table__bad' : undefined}
      title={at ? `测量于 ${new Date(at).toLocaleString()}` : undefined}
    >
      {text}
    </td>
  )
}

/** 管理后台 · 机器: every machine plus the network quality last measured by each daemon (spec §8.5). */
export function MachinesPage() {
  const [machines, setMachines] = useState<AdminMachineDto[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
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
      search={<SearchField placeholder="搜索机器或主人" value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>主人</th>
                <th>机器</th>
                <th>系统</th>
                <th>硬件</th>
                <th>daemon</th>
                <th>延迟</th>
                <th>带宽</th>
                <th>状态</th>
                <th>最后心跳</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td>{m.ownerName}</td>
                  <td className="admin-table__mono" title={m.name === m.hostname ? undefined : m.hostname}>
                    <button type="button" className="machine__open" onClick={() => setOpenId(m.id)}>
                      {m.name}
                    </button>
                  </td>
                  <td>{osText(m)}</td>
                  <td>{hardwareText(m)}</td>
                  <td className={outdated(m) ? 'admin-table__mono admin-table__warn' : 'admin-table__mono'}>
                    {m.daemonVersion ? `v${m.daemonVersion}` : '—'}
                  </td>
                  <NetCell
                    text={m.latencyMs == null ? null : `${m.latencyMs} ms`}
                    bad={!!params && m.latencyMs != null && m.latencyMs > params.forceSyncMaxLatencyMs}
                    at={m.netMeasuredAt}
                  />
                  <NetCell
                    text={m.bandwidthMbps == null ? null : `${Number(m.bandwidthMbps.toFixed(1))} Mbps`}
                    bad={
                      !!params &&
                      m.bandwidthMbps != null &&
                      m.bandwidthMbps < params.forceSyncMinBandwidthMbps
                    }
                    at={m.netMeasuredAt}
                  />
                  <td>
                    <span className="admin-status">
                      <span className={m.online ? 'admin-dot admin-dot--on' : 'admin-dot'} />
                      {m.online ? '在线' : '离线'}
                    </span>
                  </td>
                  <td
                    className="admin-table__muted"
                    title={m.lastSeenAt ? new Date(m.lastSeenAt).toLocaleString() : undefined}
                  >
                    {lastHeartbeat(m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length ? null : (
            <EmptyState bare title={machines?.length ? '没有匹配的机器' : '还没有机器'} />
          )}
        </div>
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
