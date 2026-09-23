import type { AdminGroupDto } from '@aiws/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Badge, type BadgeVariant, Spinner } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'
import { useSystemParams } from './ParamsPage'

const DAY_MS = 86_400_000

function mode(g: AdminGroupDto): [string, BadgeVariant] {
  if (g.archivedAt) return ['已归档', 'outline']
  return g.mode === 'force' ? ['强制同步', 'info'] : ['分区模式', 'secondary']
}

/** 管理后台 · 群: every group incl. archived ones. The authoritative copy only exists in force sync (P2). */
export function GroupsPage() {
  const [groups, setGroups] = useState<AdminGroupDto[] | null>(null)
  const [error, setError] = useState('')
  const params = useSystemParams()
  useEffect(() => {
    api
      .get<AdminGroupDto[]>('/admin/groups')
      .then(setGroups)
      .catch((e) => setError(errorText(e)))
  }, [])

  const copy = (g: AdminGroupDto) => {
    if (!g.archivedAt) return '—'
    if (!params) return '归档'
    const left = params.archiveRetentionDays - Math.floor((Date.now() - Date.parse(g.archivedAt)) / DAY_MS)
    return `归档 · ${Math.max(0, left)} 天后清除`
  }

  return (
    <AdminPage title="群" desc="所有群的模式、仓库与权威副本状态。">
      {error ? <Alert variant="error" description={error} /> : null}
      {groups ? (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>群</th>
                <th>模式</th>
                <th>仓库</th>
                <th>成员</th>
                <th>bot</th>
                <th>权威副本</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const [label, variant] = mode(g)
                return (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.kind === 'dm' ? `私聊 · ${g.name}` : g.name}</strong>
                    </td>
                    <td>
                      <Badge variant={variant}>{label}</Badge>
                    </td>
                    <td className="admin-table__mono admin-table__clip">{g.repo ?? '未绑定'}</td>
                    <td>{g.members}</td>
                    <td>{g.bots}</td>
                    <td className="admin-table__mono">{copy(g)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
