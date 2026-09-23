import type { AuditDto } from '@aiws/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Alert, Button, EmptyState, Spinner } from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'

const PAGE = 50
const FILTERS: { label: string; category?: string }[] = [
  { label: '全部' },
  { label: '审批', category: 'approval' },
  { label: '提问', category: 'question' },
  { label: '锁与同步', category: 'lock' },
  { label: '管理', category: 'admin' },
  { label: '运行', category: 'run' },
]
const TYPE: Record<string, string> = Object.fromEntries(
  FILTERS.filter((f) => f.category).map((f) => [f.category, f.label]),
)

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 管理后台 · 审计记录 (spec §9, §13): kept forever, newest first, filtered by category, paged by id. */
export function AuditPage() {
  const [category, setCategory] = useState<string | undefined>()
  const [rows, setRows] = useState<AuditDto[] | null>(null)
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')

  const fetchPage = useCallback(
    (before?: number) => {
      const q = new URLSearchParams()
      if (category) q.set('category', category)
      q.set('limit', String(PAGE))
      if (before) q.set('before', String(before))
      return api.get<AuditDto[]>(`/admin/audit?${q}`)
    },
    [category],
  )

  useEffect(() => {
    setRows(null)
    setError('')
    fetchPage()
      .then((page) => {
        setRows(page)
        setMore(page.length === PAGE)
      })
      .catch((e) => setError(errorText(e)))
  }, [fetchPage])

  async function loadMore() {
    try {
      const page = await fetchPage(rows?.at(-1)?.id)
      setRows((r) => [...(r ?? []), ...page])
      setMore(page.length === PAGE)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <AdminPage title="审计记录" desc="审批、提问、锁与同步事件、管理员操作，永久保存。">
      <div className="admin-chips">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className="admin-chip"
            aria-pressed={f.category === category}
            onClick={() => setCategory(f.category)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <div className="admin-list" data-testid="audit-list">
        {rows === null ? (
          error ? null : (
            <div className="admin-list__pad">
              <Spinner size={18} />
            </div>
          )
        ) : rows.length ? (
          rows.map((a) => (
            <div key={a.id} className="admin-audit" data-testid="audit-row">
              <span className="admin-audit__time">{stamp(a.at)}</span>
              <span>{TYPE[a.category] ?? a.category}</span>
              <span>{a.actorName ?? '系统'}</span>
              <span className="admin-audit__summary">{a.summary}</span>
            </div>
          ))
        ) : (
          <EmptyState bare title="暂无记录" />
        )}
      </div>
      {more ? (
        <Button variant="outline" size="sm" className="admin-more" onClick={() => void loadMore()}>
          加载更多
        </Button>
      ) : null}
    </AdminPage>
  )
}
