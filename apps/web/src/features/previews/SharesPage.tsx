import type { PreviewShareDto } from '@gonggong/protocol'
import { useState } from 'react'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useGet } from '../../lib/useGet'
import { Alert, EmptyState, SearchField, Spinner, Table, Tag } from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { shareState } from './ShareDialog'

const DAY = 86400_000
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

/** 管理后台 · 公开链接 (plan P8): every public preview link across groups; revoke or extend any of them. */
export function SharesPage() {
  const { data: rows, error, reload } = useGet<PreviewShareDto[]>('/admin/preview-shares')
  const [query, setQuery] = useState('')
  const act = async (action: string, s: PreviewShareDto) => {
    try {
      if (action === 'revoke') await api.post(`/preview-shares/${s.id}/revoke`)
      else {
        const expiresAt = new Date(Math.max(Date.parse(s.expiresAt), Date.now()) + 7 * DAY).toISOString()
        await api.patch(`/admin/preview-shares/${s.id}`, { expiresAt })
      }
      reload()
    } catch (e) {
      toastError(e)
    }
  }
  const q = query.trim().toLowerCase()
  const shown = rows?.filter(
    (s) => !q || `${s.previewTitle} ${s.groupName} ${s.botName} ${s.createdByName}`.toLowerCase().includes(q),
  )
  const active = rows?.filter((s) => s.active).length ?? 0
  return (
    <AdminPage
      title="公开链接"
      desc="Bot 预览的外部公开链接：拿到链接的人无需登录即可访问，到期或收回后立即失效。"
      subtitle={rows ? `${rows.length} 条 · ${active} 条有效` : undefined}
      search={<SearchField placeholder="搜索预览、群或创建人" value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <Table<PreviewShareDto>
          aria-label="公开链接列表"
          className="admin-grid"
          rows={shown}
          multiple={false}
          rowActions={(s) =>
            s.active
              ? [
                  { label: '延长 7 天', value: 'extend' },
                  { separator: true as const },
                  { label: '收回', value: 'revoke', destructive: true },
                ]
              : []
          }
          onRowAction={(action, s) => void act(action, s)}
          emptyText={<EmptyState compact title={q ? '没有匹配的公开链接' : '还没有公开链接'} />}
          columns={[
            { key: 'previewTitle', title: '预览', sortable: true },
            { key: 'groupName', title: '群', sortable: true, secondary: true },
            { key: 'botName', title: 'Bot', secondary: true },
            { key: 'createdByName', title: '创建人', width: 96, secondary: true },
            {
              key: 'expiresAt',
              title: '到期',
              width: 168,
              sortable: true,
              render: (s) => when(s.expiresAt),
            },
            {
              key: 'visitCount',
              title: '访问',
              width: 72,
              sortable: true,
              render: (s) => `${s.visitCount} 次`,
            },
            {
              key: 'state',
              title: '状态',
              width: 96,
              render: (s) => <Tag tone={s.active ? 'green' : 'gray'}>{shareState(s)}</Tag>,
            },
          ]}
        />
      ) : error ? null : (
        <Spinner />
      )}
    </AdminPage>
  )
}
