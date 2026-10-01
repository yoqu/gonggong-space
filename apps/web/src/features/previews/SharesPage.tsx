import type { PreviewShareDto } from '@gonggong/protocol'
import { useState } from 'react'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { dateLocale } from '../../lib/time'
import { useGet } from '../../lib/useGet'
import { Alert, EmptyState, SearchField, Spinner, Table, Tag } from '../../ui'
import { AdminPage } from '../admin/AdminPage'
import { shareState } from './ShareDialog'

const DAY = 86400_000
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(dateLocale) : '—')

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
      title={t('公开链接#nav')}
      desc={t('Bot 预览的外部公开链接：拿到链接的人无需登录即可访问，到期或收回后立即失效。')}
      subtitle={rows ? t('{n} 条 · {active} 条有效', { n: rows.length, active }) : undefined}
      search={<SearchField placeholder={t('搜索预览、群或创建人')} value={query} onChange={setQuery} />}
    >
      {error ? <Alert variant="error" description={error} /> : null}
      {shown ? (
        <Table<PreviewShareDto>
          aria-label={t('公开链接列表')}
          className="admin-grid"
          rows={shown}
          multiple={false}
          rowActions={(s) =>
            s.active
              ? [
                  { label: t('延长 7 天'), value: 'extend' },
                  { separator: true as const },
                  { label: t('收回'), value: 'revoke', destructive: true },
                ]
              : []
          }
          onRowAction={(action, s) => void act(action, s)}
          emptyText={<EmptyState compact title={q ? t('没有匹配的公开链接') : t('还没有公开链接')} />}
          columns={[
            { key: 'previewTitle', title: t('预览'), sortable: true },
            { key: 'groupName', title: t('群'), sortable: true, secondary: true },
            { key: 'botName', title: 'Bot', secondary: true },
            { key: 'createdByName', title: t('创建人'), width: 96, secondary: true },
            {
              key: 'expiresAt',
              title: t('到期'),
              width: 168,
              sortable: true,
              render: (s) => when(s.expiresAt),
            },
            {
              key: 'visitCount',
              title: t('访问'),
              width: 72,
              sortable: true,
              render: (s) => t('{n} 次', { n: s.visitCount }),
            },
            {
              key: 'state',
              title: t('状态'),
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
