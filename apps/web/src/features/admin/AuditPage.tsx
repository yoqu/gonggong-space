import type { AuditDto } from '@aiws/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { Alert, Button, EmptyState, Input, Select, Spinner } from '../../ui'
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

/** Summaries longer than this get a 展开 toggle; CSS clamps them to two lines. */
const LONG = 80
const SYSTEM = '系统'
const actorOf = (a: AuditDto) => a.actorName ?? SYSTEM

function Summary({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > LONG
  return (
    <span className="admin-audit__detail">
      <span className={cx('admin-audit__summary', long && !open && 'is-clamped')}>{text}</span>
      {long ? (
        <button type="button" className="admin-audit__toggle" onClick={() => setOpen(!open)}>
          {open ? '收起' : '展开'}
        </button>
      ) : null}
    </span>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 管理后台 · 审计记录 (spec §9, §13): kept forever, newest first, filtered by category, paged by id.
 * Keyword and actor filters apply to the loaded pages; the API only filters by category.
 */
export function AuditPage() {
  const [category, setCategory] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [actor, setActor] = useState('')
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

  const actors = [...new Set(rows?.map(actorOf))]
  const q = keyword.trim().toLowerCase()
  const shown = rows?.filter(
    (a) =>
      (!actor || actorOf(a) === actor) &&
      (!q || [a.summary, a.groupName ?? '', actorOf(a)].some((t) => t.toLowerCase().includes(q))),
  )

  return (
    <AdminPage title="审计记录" desc="审批、提问、锁与同步事件、管理员操作，永久保存。">
      <div className="admin-filters">
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
        <span className="spacer" />
        <div className="admin-filters__actor">
          <Select
            label="操作人"
            value={actor}
            options={[{ value: '', label: '全部操作人' }, ...actors.map((n) => ({ value: n, label: n }))]}
            onChange={setActor}
          />
        </div>
        <Input
          type="search"
          size="sm"
          className="admin-filters__search"
          aria-label="搜索审计记录"
          placeholder="搜索摘要、群或操作人"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <div className="admin-list" data-testid="audit-list">
        {shown === undefined ? (
          error ? null : (
            <div className="admin-list__pad">
              <Spinner size={18} />
            </div>
          )
        ) : shown.length ? (
          shown.map((a) => (
            <div key={a.id} className="admin-audit" data-testid="audit-row">
              <span className="admin-audit__time">{stamp(a.at)}</span>
              <span>{TYPE[a.category] ?? a.category}</span>
              <span>{actorOf(a)}</span>
              <Summary text={a.summary} />
            </div>
          ))
        ) : (
          <EmptyState bare title={rows?.length ? '没有匹配的记录' : '暂无记录'} />
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
