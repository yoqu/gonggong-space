import type { AdminGroupDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, SearchField, Spinner, Table, Tag, type TagTone } from '../../ui'
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
    if (!g.archivedAt) return null
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
        <Table<AdminGroupDto>
          aria-label="群列表"
          className="admin-grid"
          rows={shown}
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText={q ? '没有匹配的群' : '还没有群'}
          columns={[
            { key: 'name', title: '群', sortable: true, sortValue: title, render: title },
            {
              key: 'mode',
              title: '模式',
              width: 104,
              sortable: true,
              sortValue: (g) => mode(g)[0],
              render: (g) => {
                const [label, tone] = mode(g)
                return <Tag tone={tone}>{label}</Tag>
              },
            },
            {
              key: 'repo',
              title: '仓库',
              mono: true,
              secondary: true,
              sortable: true,
              render: (g) => g.repo ?? '未绑定',
            },
            { key: 'members', title: '成员', width: 72, align: 'right', sortable: true },
            { key: 'bots', title: 'Bot', width: 72, align: 'right', sortable: true },
            { key: 'archive', title: '存档', width: 176, secondary: true, render: copy },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
