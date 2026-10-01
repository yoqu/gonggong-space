import type { AdminGroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  EmptyState,
  NoGroupsArt,
  NoResultsArt,
  SearchField,
  Spinner,
  Table,
  Tag,
  type TagTone,
} from '../../ui'
import { AdminPage } from './AdminPage'
import { useSystemParams } from './ParamsPage'
import { TeamFilter } from './TeamFilter'

const DAY_MS = 86_400_000

function mode(g: AdminGroupDto): [string, TagTone] {
  if (g.archivedAt) return [t('已归档'), 'gray']
  return g.mode === 'force' ? [t('强制同步'), 'blue'] : [t('分区模式'), 'green']
}

/** A DM's `name` is its Bot's current name. */
const title = (g: AdminGroupDto) => (g.kind === 'dm' ? `${g.ownerName ?? ''} ⇄ ${g.name}` : g.name)

/** 管理后台 · 群: every group incl. archived ones. */
export function GroupsPage() {
  const [teamId, setTeamId] = useState('')
  const { data: groups, error } = useGet<AdminGroupDto[]>(`/admin/groups${teamId ? `?teamId=${teamId}` : ''}`)
  const [query, setQuery] = useState('')
  const params = useSystemParams()

  const copy = (g: AdminGroupDto) => {
    if (!g.archivedAt) return null
    if (!params) return t('归档')
    const left = params.archiveRetentionDays - Math.floor((Date.now() - Date.parse(g.archivedAt)) / DAY_MS)
    return t('归档 · {n} 天后清除', { n: Math.max(0, left) })
  }
  const q = query.trim().toLowerCase()
  const shown = groups?.filter((g) => !q || `${title(g)} ${g.repo ?? ''}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title={t('群#nav')}
      desc={t('所有群的模式、仓库与存档状态。')}
      subtitle={groups ? t('{n} 个群', { n: groups.length }) : undefined}
      actions={<TeamFilter value={teamId} onChange={setTeamId} />}
      search={<SearchField placeholder={t('搜索群或仓库')} value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <Table<AdminGroupDto>
          aria-label={t('群列表')}
          className="admin-grid"
          rows={shown}
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText={
            <EmptyState
              compact
              title={q ? t('没有匹配的群') : t('还没有群')}
              illustration={q ? <NoResultsArt /> : <NoGroupsArt />}
            />
          }
          columns={[
            { key: 'name', title: t('群'), sortable: true, sortValue: title, render: title },
            { key: 'teamName', title: t('团队'), width: 120, secondary: true, sortable: true },
            {
              key: 'mode',
              title: t('模式'),
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
              title: t('仓库'),
              mono: true,
              secondary: true,
              sortable: true,
              render: (g) => g.repo ?? t('未绑定'),
            },
            { key: 'members', title: t('成员'), width: 72, align: 'right', sortable: true },
            { key: 'bots', title: 'Bot', width: 72, align: 'right', sortable: true },
            { key: 'archive', title: t('存档'), width: 176, secondary: true, render: copy },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
