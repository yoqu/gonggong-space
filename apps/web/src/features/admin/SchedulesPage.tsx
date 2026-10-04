import type { AdminScheduleDto, AdminSchedulesDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, Button, EmptyState, SearchField, SegmentedControl, Spinner, Switch, Table } from '../../ui'
import { lastText, stateText } from '../schedules/model'
import { timingText } from '../schedules/store'
import { AdminPage } from './AdminPage'
import { TeamFilter } from './TeamFilter'
import '../schedules/schedules.css'

type Filter = 'all' | 'on' | 'off'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: t('全部') },
  { value: 'on', label: t('启用中') },
  { value: 'off', label: t('已停用#off') },
]

/** 管理后台 · 定时任务: every group's scheduled tasks across teams; sysadmins may pause or delete any. */
export function SchedulesPage() {
  const [teamId, setTeamId] = useState('')
  const { data, error, reload } = useGet<AdminSchedulesDto>(
    `/admin/schedules${teamId ? `?teamId=${teamId}` : ''}`,
  )
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const q = query.trim().toLowerCase()
  const shown = data?.schedules.filter(
    (s) =>
      (filter === 'all' || s.enabled === (filter === 'on')) &&
      (!q || `${s.name} ${s.groupName} ${s.ownerName} ${s.botNames.join(' ')}`.toLowerCase().includes(q)),
  )
  const act = async (fn: () => Promise<unknown>) => {
    if (await attempt(fn)) reload()
  }
  const title = (s: AdminScheduleDto) =>
    s.groupKind === 'dm' ? t('{owner} 的私聊', { owner: s.ownerName }) : s.groupName

  return (
    <AdminPage
      title={t('定时任务')}
      desc={t('各群与私聊的定时任务：到点由候选 Bot 中第一个可用的执行。可在此停用或删除任意任务。')}
      subtitle={data ? t('{n} 个任务', { n: data.schedules.length }) : undefined}
      actions={
        <>
          <SegmentedControl<Filter>
            aria-label={t('状态')}
            items={FILTERS}
            value={filter}
            onChange={setFilter}
          />
          <TeamFilter value={teamId} onChange={setTeamId} />
        </>
      }
      search={<SearchField placeholder={t('搜索任务、群或 Bot')} value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {data ? (
        <div className="sc-stats">
          {[
            [data.stats.enabled, t('启用中')],
            [data.stats.fired24h, t('24 小时内触发')],
            [data.stats.failed24h, t('24 小时内失败')],
            [data.stats.autoPaused, t('已自动停用')],
          ].map(([n, label]) => (
            <div key={label} className="sc-stat">
              <span className="sc-stat__value">{n}</span>
              <span className="sc-muted">{label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {shown ? (
        <Table<AdminScheduleDto>
          aria-label={t('定时任务列表')}
          className="admin-grid"
          rows={shown}
          defaultSort={{ key: 'name', dir: 'asc' }}
          emptyText={
            <EmptyState compact title={q || filter !== 'all' ? t('没有匹配的任务') : t('还没有定时任务')} />
          }
          columns={[
            {
              key: 'name',
              title: t('任务'),
              sortable: true,
              render: (s) => (
                <span className="sc-row__main">
                  <span>{s.name}</span>
                  <span className="sc-muted">{timingText(s)}</span>
                </span>
              ),
            },
            {
              key: 'group',
              title: t('群'),
              width: 140,
              secondary: true,
              sortable: true,
              sortValue: title,
              render: title,
            },
            { key: 'teamName', title: t('团队'), width: 110, secondary: true, sortable: true },
            { key: 'bots', title: 'Bot', width: 150, secondary: true, render: (s) => s.botNames.join(' → ') },
            { key: 'ownerName', title: t('主人'), width: 90, secondary: true, sortable: true },
            {
              key: 'state',
              title: t('状态'),
              width: 220,
              secondary: true,
              render: (s) => {
                const last = lastText(s, (id) => s.botNames[s.botIds.indexOf(id)] ?? '')
                return (
                  <span className="sc-row__main">
                    <span>{stateText(s)}</span>
                    {last ? <span className="sc-muted">{last}</span> : null}
                  </span>
                )
              },
            },
            {
              key: 'ops',
              title: '',
              width: 150,
              render: (s) => (
                <span className="sc-row__ops">
                  <Switch
                    aria-label={t('启用「{name}」', { name: s.name })}
                    checked={s.enabled}
                    onChange={(enabled) => void act(() => api.patch(`/admin/schedules/${s.id}`, { enabled }))}
                  />
                  <Button
                    size="small"
                    variant={deleting === s.id ? 'destructive' : 'plain'}
                    onClick={() =>
                      deleting === s.id
                        ? void act(() => api.del(`/admin/schedules/${s.id}`))
                        : setDeleting(s.id)
                    }
                  >
                    {deleting === s.id ? t('确认删除') : t('删除')}
                  </Button>
                </span>
              ),
            },
          ]}
        />
      ) : error ? null : (
        <Spinner size={18} />
      )}
    </AdminPage>
  )
}
