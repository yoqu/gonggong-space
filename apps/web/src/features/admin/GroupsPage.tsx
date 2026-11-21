import type { AdminGroupDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { useGet } from '../../lib/useGet'
import {
  Alert,
  Button,
  EmptyState,
  NoGroupsArt,
  NoResultsArt,
  SearchField,
  SegmentedControl,
  Spinner,
  Table,
  Tag,
  type TagTone,
} from '../../ui'
import { AdminPage, countLine } from './AdminPage'
import { useSystemParams } from './ParamsPage'
import { TeamFilter } from './TeamFilter'

const DAY_MS = 86_400_000

function mode(g: AdminGroupDto): [string, TagTone] | null {
  if (g.archivedAt) return [t('已归档'), 'gray']
  return g.mode === 'force' ? [t('强制同步'), 'blue'] : null
}

/** A DM's `name` is its Bot's current name. */
const title = (g: AdminGroupDto) => (g.kind === 'dm' ? `${g.ownerName ?? ''} ⇄ ${g.name}` : g.name)

/** 管理后台 · 群: every group incl. archived ones. */
export function GroupsPage() {
  const [teamId, setTeamId] = useState('')
  const [kind, setKind] = useState<'group' | 'dm'>('group')
  const {
    data: groups,
    error,
    loading,
    reload,
  } = useGet<AdminGroupDto[]>(`/admin/groups${teamId ? `?teamId=${teamId}` : ''}`)
  const [query, setQuery] = useState('')
  const params = useSystemParams()

  const copy = (g: AdminGroupDto) => {
    if (!g.archivedAt) return null
    if (!params) return t('归档')
    const left = params.archiveRetentionDays - Math.floor((Date.now() - Date.parse(g.archivedAt)) / DAY_MS)
    return t('归档 · {n} 天后清除', { n: Math.max(0, left) })
  }
  const byKind = groups?.filter((g) => g.kind === kind)
  const q = query.trim().toLowerCase()
  const shown = byKind?.filter((g) => !q || `${title(g)} ${g.repo ?? ''}`.toLowerCase().includes(q))

  return (
    <AdminPage
      title={t('群#nav')}
      desc={t('所有群的模式、仓库与存档状态。')}
      subtitle={
        byKind
          ? countLine(
              kind === 'dm' ? t('{n} 个私聊', { n: byKind.length }) : t('{n} 个群', { n: byKind.length }),
              shown?.length,
              byKind.length,
            )
          : undefined
      }
      actions={
        <div className="admin-filters">
          <SegmentedControl<'group' | 'dm'>
            aria-label={t('会话类型')}
            size="small"
            value={kind}
            onChange={setKind}
            items={[
              { value: 'group', label: t('群#nav') },
              { value: 'dm', label: t('私聊#nav') },
            ]}
          />
          <TeamFilter value={teamId} onChange={setTeamId} />
        </div>
      }
      search={<SearchField placeholder={t('搜索群或仓库')} value={query} onChange={setQuery} />}
    >
      {error ? (
        <Alert variant="error" description={error}>
          <div style={{ marginTop: 'var(--space-8)' }}>
            <Button size="small" loading={loading} onClick={reload}>
              {t('重试')}
            </Button>
          </div>
        </Alert>
      ) : null}
      {shown ? (
        <Table<AdminGroupDto>
          aria-label={t('群列表')}
          className="admin-grid"
          rows={shown}
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText={
            <EmptyState
              compact
              title={q ? t('没有匹配的群') : kind === 'dm' ? t('还没有私聊') : t('还没有群')}
              illustration={q ? <NoResultsArt /> : <NoGroupsArt />}
            />
          }
          columns={[
            {
              key: 'name',
              title: kind === 'dm' ? t('私聊#nav') : t('群'),
              sortable: true,
              sortValue: title,
              render: title,
            },
            { key: 'teamName', title: t('团队'), width: 120, secondary: true, sortable: true },
            {
              key: 'mode',
              title: t('模式'),
              width: 104,
              sortable: true,
              sortValue: (g) => mode(g)?.[0] ?? '',
              render: (g) => {
                const m = mode(g)
                return m ? <Tag tone={m[1]}>{m[0]}</Tag> : null
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
