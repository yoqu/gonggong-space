import type { AdminTeamDto, BotDto, UserBriefDto, UserDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { useGet } from '../../lib/useGet'
import {
  Button,
  EmptyState,
  NoBotsArt,
  NoResultsArt,
  Presence,
  SearchField,
  Table,
  Tag,
  ToolbarButton,
  ToolbarGroup,
} from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { TeamFilter } from '../admin/TeamFilter'
import { BotAvatar } from './avatars'
import { BotDetail } from './BotSettings'
import { DeleteBotDialog } from './DeleteBotDialog'
import { agentLine, BINDING_LABEL, PRESENCE } from './model'
import { NewBotDialog } from './NewBotDialog'
import './bots.css'
import { t } from '../../i18n'

/** 管理后台 · Bot: every bot in the system; the selected row shows its detail on the right. */
export function BotsAdminPage() {
  // AdminLayout guarantees a sysadmin.
  const me = useSession((s) => s.user) as UserDto
  const [teamId, setTeamId] = useState('')
  const live = useWorkspace((s) => s.bots)
  const { data, reload } = useGet<BotDto[]>(`/admin/bots${teamId ? `?teamId=${teamId}` : ''}`)
  const teamNames = new Map((useGet<AdminTeamDto[]>('/admin/teams').data ?? []).map((x) => [x.id, x.name]))
  // biome-ignore lint/correctness/useExhaustiveDependencies: the open team's live bot updates re-fetch every team's list
  useEffect(() => reload(), [live, reload])
  const bots = data ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<BotDto | null>(null)
  const users = useGet<UserBriefDto[]>('/users').data ?? []
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = bots.filter(
    (b) => !q || `${b.name} ${b.ownerName} ${b.machineName ?? ''}`.toLowerCase().includes(q),
  )
  const selected = shown.find((b) => b.id === selectedId) ?? shown[0]

  return (
    <AdminPage
      title="Bot"
      desc={t('全部 Bot 的归属、绑定与状态；可为任何成员新建，新建时直接绑定归属人的机器与 agent。')}
      subtitle={t('{n} 个 Bot', { n: bots.length })}
      actions={
        <ToolbarGroup>
          <TeamFilter value={teamId} onChange={setTeamId} />
          <ToolbarButton
            icon="plus"
            label={t('新建 Bot…')}
            text={t('新建 Bot…')}
            onClick={() => setCreating(true)}
          />
        </ToolbarGroup>
      }
      search={<SearchField placeholder={t('搜索 Bot、归属人或机器')} value={query} onChange={setQuery} />}
    >
      {bots.length ? (
        <div className="bots-page__body">
          <Table<BotDto>
            aria-label={t('Bot 列表')}
            className="admin-grid bots-grid"
            rows={shown}
            multiple={false}
            selection={selected ? [selected.id] : []}
            onSelectionChange={(ids) => {
              if (ids[0] != null) setSelectedId(String(ids[0]))
            }}
            defaultSort={{ key: 'name', dir: 'asc' }}
            rowActions={() => [{ label: t('删除 Bot…'), value: 'delete', destructive: true }]}
            onRowAction={(_, b) => setDeleting(b)}
            emptyText={<EmptyState compact title={t('没有匹配的 Bot')} illustration={<NoResultsArt />} />}
            columns={[
              {
                key: 'name',
                title: 'Bot',
                // Beside the detail panel the name keeps its room; Agent and 机器 give way and truncate.
                width: 'minmax(160px, 1fr)',
                sortable: true,
                render: (b) => (
                  <>
                    <BotAvatar id={b.id} name={b.name} size={18} />
                    {b.name}
                  </>
                ),
              },
              {
                key: 'agent',
                title: 'Agent',
                width: 'minmax(0, 150px)',
                secondary: true,
                sortable: true,
                sortValue: agentLine,
                render: agentLine,
              },
              { key: 'ownerName', title: t('归属人'), width: 96, sortable: true },
              {
                key: 'teamId',
                title: t('团队'),
                width: 96,
                secondary: true,
                sortable: true,
                sortValue: (b) => teamNames.get(b.teamId) ?? '',
                render: (b) => teamNames.get(b.teamId) ?? '',
              },
              {
                key: 'binding',
                title: t('绑定'),
                width: 64,
                sortable: true,
                sortValue: (b) => BINDING_LABEL[b.binding],
                render: (b) =>
                  b.binding === 'bound' ? (
                    BINDING_LABEL[b.binding]
                  ) : (
                    <Tag tone="orange">{BINDING_LABEL[b.binding]}</Tag>
                  ),
              },
              {
                key: 'machineName',
                title: t('机器'),
                width: 'minmax(0, 200px)',
                mono: true,
                secondary: true,
                sortable: true,
              },
              {
                key: 'presence',
                title: t('状态'),
                width: 104,
                sortable: true,
                sortValue: (b) => PRESENCE[b.presence].label,
                render: (b) => (
                  <span className="admin-status">
                    <span className="admin-dot" style={{ background: PRESENCE[b.presence].color }} />
                    {PRESENCE[b.presence].label}
                  </span>
                ),
              },
            ]}
          />
          {selected ? <BotDetail key={selected.id} bot={selected} me={me} users={users} /> : null}
        </div>
      ) : (
        <EmptyState
          illustration={<NoBotsArt />}
          title={t('还没有 Bot')}
          description={t('Bot 绑定到成员的机器，在群里被 @ 后开工。')}
          action={<Button onClick={() => setCreating(true)}>{t('新建 Bot…')}</Button>}
        />
      )}
      <Presence>
        {deleting ? <DeleteBotDialog bot={deleting} onClose={() => setDeleting(null)} /> : null}
      </Presence>
      <Presence>
        {creating ? (
          <NewBotDialog me={me} onClose={() => setCreating(false)} onCreated={(b) => setSelectedId(b.id)} />
        ) : null}
      </Presence>
    </AdminPage>
  )
}
