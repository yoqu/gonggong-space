import type { AdminGroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, EmptyState, SearchField, Spinner, Tag, type TagTone } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'
import { useSystemParams } from './ParamsPage'

const DAY_MS = 86_400_000

function mode(g: AdminGroupDto): [string, TagTone] {
  if (g.archivedAt) return ['已归档', 'gray']
  return g.mode === 'force' ? ['强制同步', 'blue'] : ['分区模式', 'green']
}

const title = (g: AdminGroupDto) => (g.kind === 'dm' ? `${g.ownerName ?? g.name} 的私聊` : g.name)

/** 管理后台 · 群: every group incl. archived ones. */
export function GroupsPage() {
  const [groups, setGroups] = useState<AdminGroupDto[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
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
  const q = query.trim().toLowerCase()
  const shown = groups?.filter((g) => !q || `${title(g)} ${g.repo ?? ''}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title="群"
      desc="所有群的模式、仓库与存档状态。"
      subtitle={groups ? `${groups.length} 个群` : undefined}
      search={<SearchField placeholder="搜索群或仓库" value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <div className="admin-table">
          <table>
            <thead>
              <tr>
                <th>群</th>
                <th>模式</th>
                <th>仓库</th>
                <th>成员</th>
                <th>Bot</th>
                <th>存档</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const [label, tone] = mode(g)
                return (
                  <tr key={g.id}>
                    <td>
                      <strong>{title(g)}</strong>
                    </td>
                    <td>
                      <Tag tone={tone}>{label}</Tag>
                    </td>
                    <td className="admin-table__mono admin-table__clip">{g.repo ?? '未绑定'}</td>
                    <td>{g.members}</td>
                    <td>{g.bots}</td>
                    <td className="admin-table__muted">{copy(g)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {shown.length ? null : <EmptyState bare title={groups?.length ? '没有匹配的群' : '还没有群'} />}
        </div>
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
