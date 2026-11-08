import type { ApprovalDto, QuestionSetDto, RunDto, RunStatus } from '@gonggong/protocol'
import { type RefObject, useEffect, useMemo, useState } from 'react'
import { useInspector } from '../../app/inspector'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { useNow } from '../../lib/now'
import { ago, fullTime } from '../../lib/time'
import { Button, Icon, Tag } from '../../ui'
import { BotAvatar } from '../bots/avatars'
import { stepText, toolTitle } from '../runs/mcp'
import { openTab } from '../workbench/open'
import { STATUS_LABEL } from './RunGraphics'
import './task-dock.css'

type PendingItem =
  | { key: string; run: RunDto; at: string; approval: ApprovalDto }
  | { key: string; run: RunDto; at: string; set: QuestionSetDto }

type TaskSection = 'attention' | 'running' | 'waiting'
type TaskRow =
  | { key: string; kind: 'run'; section: Exclude<TaskSection, 'attention'>; run: RunDto }
  | { key: string; kind: 'pending'; section: 'attention'; item: PendingItem }

const AWAITING: RunStatus[] = ['awaiting_approval', 'awaiting_answer']
const WAITING: RunStatus[] = ['queued', 'offline_wait']
const COLLAPSED_ROWS = 2

export function TaskDock({
  runs,
  root,
  onLocate,
}: {
  runs: RunDto[]
  root?: RefObject<HTMLElement | null>
  onLocate: (run: RunDto, pendingId?: string) => void
}) {
  const me = useSession((s) => s.user?.id)
  const bots = useWorkspace((s) => s.bots)
  const [visible, setVisible] = useState<Record<string, boolean> | null>(() => (root ? null : {}))
  /** The open thread panel lives in the inspector, outside `root`: its cards are watched too. */
  const threadHost = useInspector((s) => (s.view === 'thread' ? s.host : null))
  const [expanded, setExpanded] = useState(false)
  const pending = useMemo(() => {
    const owner = (run: RunDto) => bots.find((b) => b.id === run.botId)?.ownerId
    return runs
      .flatMap((run): PendingItem[] => [
        ...(me && me === owner(run) ? run.approvals : [])
          .filter((approval) => approval.status === 'pending')
          .map((approval) => ({ key: approval.id, run, at: approval.createdAt, approval })),
        ...run.questions
          .filter(
            (set) =>
              set.status === 'pending' &&
              !!me &&
              (me === run.originUserId || me === owner(run) || !!set.assigneeIds?.includes(me)),
          )
          .map((set) => ({ key: set.id, run, at: set.createdAt, set })),
      ])
      .sort((a, b) => a.at.localeCompare(b.at))
  }, [runs, me, bots])
  const pendingKeys = pending.map((item) => item.key).join('\n')
  useEffect(() => {
    if (!root) return
    const scopes = [root.current, threadHost].filter((scope) => !!scope)
    setVisible({})
    const wanted = new Set(pendingKeys ? pendingKeys.split('\n') : [])
    if (!scopes.length || !wanted.size) return
    const nodes = new Map<Element, string>()
    const observers = scopes.map(
      (scope) =>
        new IntersectionObserver(
          (entries) => {
            const changes: Record<string, boolean> = {}
            for (const entry of entries) {
              const key = nodes.get(entry.target)
              if (key) changes[key] = entry.isIntersecting
            }
            setVisible((current) => ({ ...current, ...changes }))
          },
          { root: scope },
        ),
    )
    // Cards mount later too (a thread loads after it opens).
    const scan = () =>
      scopes.forEach((scope, i) => {
        for (const node of scope.querySelectorAll<HTMLElement>('[data-pending-id]')) {
          const key = node.dataset.pendingId
          if (!key || !wanted.has(key) || nodes.has(node)) continue
          nodes.set(node, key)
          setVisible((current) => ({ ...current, [key]: current?.[key] ?? false }))
          observers[i]?.observe(node)
        }
      })
    scan()
    const mutations = new MutationObserver(scan)
    for (const scope of scopes) mutations.observe(scope, { childList: true, subtree: true })
    return () => {
      mutations.disconnect()
      for (const io of observers) io.disconnect()
    }
  }, [root, threadHost, pendingKeys])

  const rows = useMemo(() => {
    const pendingRows: TaskRow[] = pending
      .filter((item) => !root || (visible && visible[item.key] !== true))
      .map((item) => ({ key: item.key, kind: 'pending', section: 'attention', item }))
    const sorted = [...runs].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
    const runRows = sorted.flatMap((run): TaskRow[] => {
      if (AWAITING.includes(run.status)) {
        // My decision appears through its pending item; someone else's wait belongs in the waiting group.
        if (pending.some((item) => item.run.id === run.id)) return []
        return [{ key: run.id, kind: 'run', section: 'waiting', run }]
      }
      if (run.status === 'running') return [{ key: run.id, kind: 'run', section: 'running', run }]
      if (WAITING.includes(run.status)) return [{ key: run.id, kind: 'run', section: 'waiting', run }]
      return []
    })
    return [...pendingRows, ...runRows]
  }, [pending, root, runs, visible])
  if (!rows.length) return null

  const counts = {
    attention: rows.filter((row) => row.section === 'attention').length,
    running: rows.filter((row) => row.section === 'running').length,
    waiting: rows.filter((row) => row.section === 'waiting').length,
  }
  const attention = rows.filter((row) => row.section === 'attention')
  const other = rows.filter((row) => row.section !== 'attention')
  const shown = expanded ? rows : [...attention, ...other.slice(0, COLLAPSED_ROWS)]
  const remaining = rows.length - shown.length
  const collapsible = expanded || other.length > COLLAPSED_ROWS

  const locatePending = (item: PendingItem) => {
    const card = [root?.current, threadHost]
      .flatMap((scope) => [...(scope?.querySelectorAll<HTMLElement>('[data-pending-id]') ?? [])])
      .find((node) => node.dataset.pendingId === item.key)
    if (!card) return onLocate(item.run, item.key)
    card.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    // Restart the ring on a repeat click; it clears itself once played.
    delete card.dataset.flash
    void card.offsetWidth
    card.dataset.flash = ''
    const done = (e: AnimationEvent) => {
      if (e.target !== card) return
      delete card.dataset.flash
      card.removeEventListener('animationend', done)
    }
    card.addEventListener('animationend', done)
  }

  return (
    <div className="task-dock" data-testid="task-dock">
      <div className="task-dock__head">
        <span className="task-dock__title">
          <Icon name="tray" size={14} />
          {t('任务')}
        </span>
        <span className="task-dock__summary">
          {counts.attention ? (
            <span className="task-dock__count task-dock__count--attention">
              {t('待我处理 {n}', { n: counts.attention })}
            </span>
          ) : null}
          {counts.running ? (
            <span className="task-dock__count">{t('运行中 {n}', { n: counts.running })}</span>
          ) : null}
          {counts.waiting ? (
            <span className="task-dock__count">{t('等待中 {n}', { n: counts.waiting })}</span>
          ) : null}
        </span>
        {collapsible ? (
          <button
            type="button"
            className="task-dock__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t('收起') : t('展开 {n}', { n: remaining })}
            <Icon name="chevron-down" size={12} className="task-dock__chevron" />
          </button>
        ) : null}
      </div>
      <ul className="task-dock__rows">
        {shown.map((row) =>
          row.kind === 'pending' ? (
            <PendingRow key={row.key} item={row.item} onLocate={() => locatePending(row.item)} />
          ) : (
            <RunRow key={row.key} run={row.run} waiting={row.section === 'waiting'} onLocate={onLocate} />
          ),
        )}
      </ul>
    </div>
  )
}

function PendingRow({ item, onLocate }: { item: PendingItem; onLocate: () => void }) {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === item.run.botId)?.name ?? 'Bot')
  const approval = 'approval' in item
  const text = approval ? item.approval.title : (item.set.questions[0]?.title ?? '')
  return (
    <li className="task-dock__row task-dock__row--attention" data-testid="task-dock-pending">
      <button type="button" className="task-dock__main" onClick={onLocate}>
        <BotAvatar id={item.run.botId} name={name} size={18} />
        <span className="task-dock__kind task-dock__kind--attention">
          {approval ? t('待审批') : t('待回答')}
        </span>
        <span className="task-dock__text">{text}</span>
        <span className="task-dock__name">{name}</span>
        <Icon name="mappin" size={12} />
      </button>
    </li>
  )
}

/** A leaf, so the per-second tick re-renders only this text and not the row. */
function Ago({ iso }: { iso: string }) {
  const now = useNow(true)
  return ago(iso, now)
}

function RunRow({
  run,
  waiting,
  onLocate,
}: {
  run: RunDto
  waiting: boolean
  onLocate: (run: RunDto) => void
}) {
  const name = useWorkspace((s) => s.bots.find((b) => b.id === run.botId)?.name ?? 'Bot')
  const status = waiting ? STATUS_LABEL[run.status] : toolTitle(stepText(run)) || STATUS_LABEL.running
  return (
    <li className="task-dock__row" data-testid="task-dock-row">
      <button type="button" className="task-dock__main" onClick={() => onLocate(run)}>
        <BotAvatar id={run.botId} name={name} size={18} />
        <span className="task-dock__name">{name}</span>
        {run.threadRootId ? (
          <Tag tone="gray" icon="thread">
            {t('话题')}
          </Tag>
        ) : null}
        <span className="task-dock__status">
          <span className="task-dock__kind">{waiting ? status : t('运行中')}</span>
          {waiting ? null : <span className="task-dock__text">{status}</span>}
        </span>
        <span className="task-dock__time" title={fullTime(run.lastActivityAt)}>
          <Ago iso={run.lastActivityAt} />
        </span>
      </button>
      <Button
        size="small"
        variant="plain"
        icon="sidebar-right"
        aria-label={t('过程')}
        onClick={() => openTab({ kind: 'run', runId: run.id, view: 'process', file: null })}
      />
    </li>
  )
}
