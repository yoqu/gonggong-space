import type { AuditDto } from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../../i18n'
import { api, errorText } from '../../lib/api'
import { matchAny } from '../../lib/match'
import { pad } from '../../lib/time'
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
import { AdminPage } from './AdminPage'
import { TeamFilter } from './TeamFilter'
import './audit.css'

const PAGE = 50
const ALL = 'all'
const FILTERS: { label: string; category?: string }[] = [
  { label: t('全部') },
  { label: t('审批'), category: 'approval' },
  { label: t('提问'), category: 'question' },
  { label: t('同步'), category: 'lock' },
  { label: t('管理'), category: 'admin' },
  { label: t('运行'), category: 'run' },
  { label: t('定时任务'), category: 'schedule' },
  { label: t('预览'), category: 'preview' },
]
const TONE: Record<string, TagTone> = {
  approval: 'orange',
  question: 'purple',
  lock: 'blue',
  run: 'green',
  schedule: 'blue',
  preview: 'gray',
  command: 'gray',
}
const TYPE: Record<string, string> = {
  ...Object.fromEntries(FILTERS.filter((f) => f.category).map((f) => [f.category, f.label])),
  command: t('命令'),
}

const SYSTEM = t('系统')
const actorOf = (a: AuditDto) => a.actorName ?? SYSTEM
const detailText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Full record: the table truncates summaries to one line. */
function AuditDialog({ record, onClose }: { record: AuditDto; onClose: () => void }) {
  const extra = Object.entries(record.detail)
  return (
    <Dialog
      open
      title={t('审计记录')}
      message={new Date(record.at).toLocaleString()}
      width={520}
      onClose={onClose}
      actions={[{ label: t('完成'), variant: 'primary', onClick: onClose, autoFocus: true }]}
    >
      <Form>
        <FormRow label={t('类型')}>
          <Tag tone={TONE[record.category] ?? 'gray'}>{TYPE[record.category] ?? record.category}</Tag>
        </FormRow>
        <FormRow label={t('操作人')}>{actorOf(record)}</FormRow>
        {record.groupName ? <FormRow label={t('群')}>{record.groupName}</FormRow> : null}
        <FormRow label={t('摘要')} align="top">
          <span className="admin-audit__summary">{record.summary}</span>
        </FormRow>
        {extra.length ? (
          <FormRow label={t('详情')} align="top">
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

const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Audit rows from `base` (spec §9, §13): kept forever, newest first, filtered by category (and `teamId`), paged by id.
 * Keyword and actor filters apply to the loaded pages; the API only filters by category and team.
 */
export function AuditPanel({
  base,
  teamId = '',
  keyword = '',
  onLoaded,
}: {
  base: string
  teamId?: string
  keyword?: string
  onLoaded?: (n: number | null) => void
}) {
  const [category, setCategory] = useState<string | undefined>()
  const [actor, setActor] = useState('')
  const [rows, setRows] = useState<AuditDto[] | null>(null)
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<AuditDto | null>(null)
  const [tick, setTick] = useState(0)
  const genRef = useRef(0)

  const fetchPage = useCallback(
    (before?: number) => {
      const q = new URLSearchParams()
      if (category) q.set('category', category)
      if (teamId) q.set('teamId', teamId)
      q.set('limit', String(PAGE))
      if (before) q.set('before', String(before))
      return api.get<AuditDto[]>(`${base}?${q}`)
    },
    [base, category, teamId],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset actor filter when query scope changes
  useEffect(() => {
    setActor('')
  }, [base, category, teamId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` triggers manual retry
  useEffect(() => {
    const gen = ++genRef.current
    setRows(null)
    setMore(false)
    setLoadingMore(false)
    setError('')
    setLoading(true)
    fetchPage()
      .then((page) => {
        if (gen !== genRef.current) return
        setRows(page)
        setMore(page.length === PAGE)
      })
      .catch((e) => {
        if (gen === genRef.current) setError(errorText(e))
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false)
      })
    return () => {
      genRef.current++
    }
  }, [fetchPage, tick])
  useEffect(() => {
    onLoaded?.(rows ? rows.length : null)
  }, [rows, onLoaded])

  async function loadMore() {
    if (loadingMore) return
    const gen = genRef.current
    setLoadingMore(true)
    setError('')
    try {
      const page = await fetchPage(rows?.at(-1)?.id)
      if (gen !== genRef.current) return
      setRows((r) => [...(r ?? []), ...page])
      setMore(page.length === PAGE)
    } catch (e) {
      if (gen === genRef.current) setError(errorText(e))
    } finally {
      if (gen === genRef.current) setLoadingMore(false)
    }
  }

  const actors = [...new Set(rows?.map(actorOf))]
  const shown = rows?.filter(
    (a) => (!actor || actorOf(a) === actor) && matchAny(keyword, a.summary, a.groupName ?? '', actorOf(a)),
  )

  return (
    <>
      <div className="admin-audit__filters">
        <SegmentedControl
          aria-label={t('类型')}
          items={FILTERS.map((f) => ({ value: f.category ?? ALL, label: f.label }))}
          value={category ?? ALL}
          onChange={(v) => setCategory(v === ALL ? undefined : v)}
        />
        <PopUpButton
          aria-label={t('操作人')}
          value={actor}
          options={[{ value: '', label: t('全部操作人') }, ...actors.map((n) => ({ value: n, label: n }))]}
          onChange={setActor}
        />
      </div>
      {error ? (
        <Alert
          variant="error"
          description={error}
          retrying={rows ? loadingMore : loading}
          onRetry={() => (rows ? void loadMore() : setTick((n) => n + 1))}
        />
      ) : null}
      <div data-testid="audit-list">
        {shown ? (
          <Table<AuditDto>
            className="admin-audit__table"
            aria-label={t('审计记录列表')}
            rows={shown}
            multiple={false}
            sortRows={false}
            onOpen={setOpen}
            emptyText={
              <EmptyState
                compact
                title={rows?.length ? t('没有匹配的记录') : t('暂无记录')}
                illustration={rows?.length ? <NoResultsArt /> : <NoDataArt />}
              />
            }
            columns={[
              {
                key: 'at',
                title: t('时间'),
                width: 128,
                mono: true,
                secondary: true,
                render: (a) => stamp(a.at),
              },
              {
                key: 'category',
                title: t('类型'),
                width: 88,
                render: (a) => <Tag tone={TONE[a.category] ?? 'gray'}>{TYPE[a.category] ?? a.category}</Tag>,
              },
              { key: 'actor', title: t('操作人'), width: 96, render: actorOf },
              {
                key: 'summary',
                title: t('摘要'),
                render: (a) => <span title={a.summary}>{a.summary}</span>,
              },
            ]}
          />
        ) : error ? null : (
          <Spinner size={18} />
        )}
      </div>
      {more ? (
        <Button
          className="admin-more"
          loading={loadingMore}
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? t('加载中') : t('加载更多')}
        </Button>
      ) : null}
      <Presence>{open ? <AuditDialog record={open} onClose={() => setOpen(null)} /> : null}</Presence>
    </>
  )
}

/** 管理后台 · 审计记录: every team and platform-level events, or one team's. */
export function AuditPage() {
  const [keyword, setKeyword] = useState('')
  const [teamId, setTeamId] = useState('')
  const [loaded, setLoaded] = useState<number | null>(null)
  return (
    <AdminPage
      title={t('审计记录')}
      desc={t('审批、提问、同步事件、管理员操作，永久保存。')}
      subtitle={loaded === null ? undefined : t('已载入 {n} 条', { n: loaded })}
      actions={<TeamFilter value={teamId} onChange={setTeamId} />}
      search={
        <SearchField
          aria-label={t('搜索审计记录')}
          placeholder={t('搜索摘要、群或操作人')}
          value={keyword}
          onChange={setKeyword}
        />
      }
    >
      <AuditPanel base="/admin/audit" teamId={teamId} keyword={keyword} onLoaded={setLoaded} />
    </AdminPage>
  )
}
