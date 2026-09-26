import type { AuditDto } from '@gonggong/protocol'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Form,
  FormRow,
  NoDataArt,
  NoResultsArt,
  PopUpButton,
  Presence,
  SearchField,
  SegmentedControl,
  Spinner,
  Table,
  Tag,
  type TagTone,
} from '../../ui'
import { errorText } from '../auth/AuthCard'
import { AdminPage } from './AdminPage'

const PAGE = 50
const ALL = 'all'
const FILTERS: { label: string; category?: string }[] = [
  { label: '全部' },
  { label: '审批', category: 'approval' },
  { label: '提问', category: 'question' },
  { label: '锁与同步', category: 'lock' },
  { label: '管理', category: 'admin' },
  { label: '运行', category: 'run' },
]
const TONE: Record<string, TagTone> = {
  approval: 'orange',
  question: 'purple',
  lock: 'blue',
  run: 'green',
}
const TYPE: Record<string, string> = Object.fromEntries(
  FILTERS.filter((f) => f.category).map((f) => [f.category, f.label]),
)

const SYSTEM = '系统'
const actorOf = (a: AuditDto) => a.actorName ?? SYSTEM
const detailText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Full record: the table truncates summaries to one line. */
function AuditDialog({ record, onClose }: { record: AuditDto; onClose: () => void }) {
  const extra = Object.entries(record.detail)
  return (
    <Dialog
      open
      title="审计记录"
      message={new Date(record.at).toLocaleString()}
      width={520}
      onClose={onClose}
      actions={[{ label: '完成', variant: 'primary', onClick: onClose, autoFocus: true }]}
    >
      <Form>
        <FormRow label="类型">
          <Tag tone={TONE[record.category] ?? 'gray'}>{TYPE[record.category] ?? record.category}</Tag>
        </FormRow>
        <FormRow label="操作人">{actorOf(record)}</FormRow>
        {record.groupName ? <FormRow label="群">{record.groupName}</FormRow> : null}
        <FormRow label="摘要" align="top">
          <span className="admin-audit__summary">{record.summary}</span>
        </FormRow>
        {extra.length ? (
          <FormRow label="详情" align="top">
            <dl className="admin-audit__detail">
              {extra.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{detailText(v)}</dd>
                </div>
              ))}
            </dl>
          </FormRow>
        ) : null}
      </Form>
    </Dialog>
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
  const [open, setOpen] = useState<AuditDto | null>(null)

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
    <AdminPage
      title="审计记录"
      desc="审批、提问、锁与同步事件、管理员操作，永久保存。"
      subtitle={rows ? `已载入 ${rows.length} 条` : undefined}
      search={
        <SearchField
          aria-label="搜索审计记录"
          placeholder="搜索摘要、群或操作人"
          value={keyword}
          onChange={setKeyword}
        />
      }
    >
      <div className="admin-filters">
        <SegmentedControl
          aria-label="类型"
          items={FILTERS.map((f) => ({ value: f.category ?? ALL, label: f.label }))}
          value={category ?? ALL}
          onChange={(v) => setCategory(v === ALL ? undefined : v)}
        />
        <PopUpButton
          aria-label="操作人"
          value={actor}
          options={[{ value: '', label: '全部操作人' }, ...actors.map((n) => ({ value: n, label: n }))]}
          onChange={setActor}
        />
      </div>
      {error ? <Alert variant="error" description={error} /> : null}
      <div className="admin-grid" data-testid="audit-list">
        {shown ? (
          <Table<AuditDto>
            aria-label="审计记录列表"
            rows={shown}
            multiple={false}
            sortRows={false}
            onOpen={setOpen}
            emptyText={
              <EmptyState
                compact
                title={rows?.length ? '没有匹配的记录' : '暂无记录'}
                illustration={rows?.length ? <NoResultsArt /> : <NoDataArt />}
              />
            }
            columns={[
              {
                key: 'at',
                title: '时间',
                width: 128,
                mono: true,
                secondary: true,
                render: (a) => stamp(a.at),
              },
              {
                key: 'category',
                title: '类型',
                width: 88,
                render: (a) => <Tag tone={TONE[a.category] ?? 'gray'}>{TYPE[a.category] ?? a.category}</Tag>,
              },
              { key: 'actor', title: '操作人', width: 96, render: actorOf },
              {
                key: 'summary',
                title: '摘要',
                render: (a) => <span title={a.summary}>{a.summary}</span>,
              },
            ]}
          />
        ) : error ? null : (
          <Spinner size={18} />
        )}
      </div>
      {more ? (
        <Button className="admin-more" onClick={() => void loadMore()}>
          加载更多
        </Button>
      ) : null}
      <Presence>{open ? <AuditDialog record={open} onClose={() => setOpen(null)} /> : null}</Presence>
    </AdminPage>
  )
}
