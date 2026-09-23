import { type AdminMachineDto, PROTOCOL_VERSION } from '@aiws/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Spinner } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'
import { useSystemParams } from './ParamsPage'

const OS: Record<AdminMachineDto['os'], string> = { macos: 'macOS', linux: 'Linux', windows: 'Windows' }

const outdated = (m: AdminMachineDto) => m.protocol !== null && m.protocol < PROTOCOL_VERSION

function heartbeat(m: AdminMachineDto) {
  if (m.online) return '在线'
  if (!m.lastSeenAt) return '从未连接'
  const min = Math.floor((Date.now() - Date.parse(m.lastSeenAt)) / 60_000)
  if (min < 60) return `离线 ${min} 分`
  return min < 1440 ? `离线 ${Math.floor(min / 60)} 小时` : `离线 ${Math.floor(min / 1440)} 天`
}

/** 管理后台 · 机器与网络 (spec §8.5). Network quality is only measured once force sync exists (P2). */
export function MachinesPage() {
  const [machines, setMachines] = useState<AdminMachineDto[] | null>(null)
  const [error, setError] = useState('')
  const params = useSystemParams()
  useEffect(() => {
    api
      .get<AdminMachineDto[]>('/admin/machines')
      .then(setMachines)
      .catch((e) => setError(errorText(e)))
  }, [])
  const old = machines?.filter(outdated) ?? []

  return (
    <AdminPage title="机器与网络" desc="每台 daemon 的版本、心跳与网络质量记录。">
      {error ? <Alert variant="error" description={error} /> : null}
      {machines ? (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>主人</th>
                <th>机器</th>
                <th>系统</th>
                <th>daemon</th>
                <th>延迟</th>
                <th>带宽</th>
                <th>心跳</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id}>
                  <td>{m.ownerName}</td>
                  <td className="admin-table__mono">{m.name}</td>
                  <td>{OS[m.os]}</td>
                  <td className={outdated(m) ? 'admin-table__mono admin-table__warn' : 'admin-table__mono'}>
                    {m.daemonVersion ? `v${m.daemonVersion}` : '—'}
                  </td>
                  <td>—</td>
                  <td>—</td>
                  <td>
                    <span className="admin-table__presence">
                      <span className={m.online ? 'admin-dot admin-dot--on' : 'admin-dot'} />
                      {heartbeat(m)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
      {old.length ? (
        <Alert
          variant="warning"
          title={`${old.length} 台 daemon 协议版本过旧`}
          description={`${old.map((m) => `${m.name} 运行 v${m.daemonVersion ?? '?'}（协议 v${m.protocol}）`).join('、')}，服务器已拒绝连接并提示升级。`}
        />
      ) : null}
      <p className="admin__foot">
        {params
          ? `网络质量仅在开启强制同步时测量并记录，不在群里展示。强制同步开启阈值：延迟 ≤ ${params.forceSyncMaxLatencyMs} ms，带宽 ≥ ${params.forceSyncMinBandwidthMbps} Mbps。`
          : '网络质量仅在开启强制同步时测量并记录，不在群里展示。'}
      </p>
    </AdminPage>
  )
}
