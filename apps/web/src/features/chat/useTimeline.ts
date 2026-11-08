import {
  type MessageDto,
  RECALLED_QUOTE,
  type RunDto,
  type ThreadDto,
  type ThreadStateDto,
  type TimelineDto,
  type WebEvent,
  withRunDelta,
  withRunProgress,
  withRunStep,
} from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'
import { useRunDeltas } from './deltas'

const PAGE = 50
/** Streaming text kept per run; only the tail is shown on the card. */
const DELTA_KEEP = 400
/** How long streamed text is gathered before it is shown. */
const DELTA_FLUSH_MS = 100

interface TimelineState {
  messages: MessageDto[]
  runs: Record<string, RunDto>
  /** Messages that arrived live after the first page; only these play the enter animation. */
  arrived: ReadonlySet<string>
  hasMore: boolean
  loaded: boolean
  /** The first page failed; realtime events still apply once a retry succeeds. */
  failed: boolean
}

const EMPTY: TimelineState = {
  messages: [],
  runs: {},
  arrived: new Set(),
  hasMore: false,
  loaded: false,
  failed: false,
}

const mergeMessages = (a: MessageDto[], b: MessageDto[]) => {
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.seq - y.seq)
}

/** Merges one message; a new one arriving after the first page is marked as arrived. */
const addLive = (s: TimelineState, m: MessageDto): TimelineState => ({
  ...s,
  messages: mergeMessages(s.messages, [m]),
  arrived: s.loaded && !s.messages.some((x) => x.id === m.id) ? new Set(s.arrived).add(m.id) : s.arrived,
})

type Withdrawn = Extract<WebEvent, { t: 'message.recalled' | 'message.hidden' }>

/** A recalled message keeps only its envelope; quotes of it say so. Deleted ones leave my timeline. */
const withdraw = (s: TimelineState, e: Withdrawn): TimelineState => ({
  ...s,
  messages:
    e.t === 'message.hidden'
      ? s.messages.filter((m) => m.id !== e.messageId)
      : s.messages.map((m) =>
          m.id === e.messageId
            ? { ...m, recalled: true, body: '', attachments: [], quote: null, mentions: [], reactions: [] }
            : m.quote?.kind === 'message' && m.quote.id === e.messageId
              ? { ...m, quote: { ...m.quote, text: RECALLED_QUOTE } }
              : m,
        ),
})

type Edited = Extract<WebEvent, { t: 'message.edited' }>

/**
 * New text, 已编辑 and live cards (secret, progress, answered actions) for the message, new text for quotes of it;
 * reactions stay (theirs carry the editor's `mine`).
 */
const edit = (s: TimelineState, { message: e }: Edited): TimelineState => ({
  ...s,
  messages: s.messages.map((m) =>
    m.id === e.id
      ? {
          ...m,
          body: e.body,
          editedAt: e.editedAt,
          mcpSecret: e.mcpSecret,
          secretCard: e.secretCard,
          progress: e.progress,
          card: e.card,
          actions: e.actions,
        }
      : m.quote?.kind === 'message' && m.quote.id === e.id
        ? { ...m, quote: { ...m.quote, text: e.body } }
        : m,
  ),
})

const local = new Set<(e: Withdrawn | Edited) => void>()
/** Applies my confirmed recall / delete / edit at once instead of waiting for its realtime echo. */
export const applyLocal = (e: Withdrawn | Edited) => {
  for (const h of local) h(e)
}

const mergeRuns = (runs: Record<string, RunDto>, list: RunDto[]) => {
  const next = { ...runs }
  for (const r of list) next[r.id] = r
  return next
}

/** A page and whether older ones remain (a thread's first page also holds its root). */
type Page = TimelineDto & { more: boolean }

/**
 * Messages + run cards of one group's main timeline, or of the thread of `thread` (plan 话题), kept live from
 * realtime events. The main timeline leaves out thread replies not also sent to the group.
 */
export function useTimeline(groupId: string, thread?: string) {
  const [state, setState] = useState<TimelineState>(EMPTY)
  const [threadState, setThreadState] = useState<ThreadStateDto | null>(null)
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  const loadingOlder = useRef(false)

  const fetchPage = useCallback(
    async (before?: number): Promise<Page> => {
      const query = `limit=${PAGE}${before ? `&before=${before}` : ''}`
      if (!thread) {
        const page = await api.get<TimelineDto>(`/groups/${groupId}/timeline?${query}`)
        return { ...page, more: page.messages.length === PAGE }
      }
      const page = await api.get<ThreadDto>(`/messages/${thread}/thread?${query}`)
      if (!before) setThreadState(page.state)
      return {
        messages: before ? page.replies : [page.root, ...page.replies],
        runs: page.runs,
        more: page.replies.length === PAGE,
      }
    },
    [groupId, thread],
  )
  const belongs = useCallback(
    (m: MessageDto) =>
      thread ? m.id === thread || m.threadRootId === thread : !m.threadRootId || !!m.alsoSent,
    [thread],
  )

  /**
   * This timeline's runs, kept outside state so a delta right after its run's first update is not dropped.
   * Deltas carry no group: those of other groups' runs would wake every streaming subscriber for nothing.
   */
  const runIds = useRef(new Set<string>())

  const applyPage = useCallback((page: Page, older: boolean) => {
    for (const r of page.runs) runIds.current.add(r.id)
    setState((s) => ({
      ...s,
      messages: mergeMessages(s.messages, page.messages),
      runs: mergeRuns(s.runs, page.runs),
      hasMore: older || !s.loaded ? page.more : s.hasMore,
      loaded: true,
      failed: false,
    }))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the first load on retry
  useEffect(() => {
    setState(EMPTY)
    setThreadState(null)
    runIds.current = new Set()
    let alive = true
    const latest = () =>
      fetchPage().then(
        (page) => alive && applyPage(page, false),
        // A failed refill after reconnect keeps what is shown; only a failed first page is an error.
        () => alive && setState((s) => (s.loaded ? s : { ...s, failed: true })),
      )
    void latest()
    const onLocal = (e: Withdrawn | Edited) => {
      if (e.t === 'message.edited') {
        if (e.message.groupId === groupId) setState((s) => edit(s, e))
      } else if (e.groupId === groupId) setState((s) => withdraw(s, e))
    }
    local.add(onLocal)
    // Streamed text is applied in batches: each update re-renders its run card and re-pins the scroll.
    const pending = new Map<string, string>()
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flushDeltas = () => {
      flushTimer = undefined
      const deltas = useRunDeltas.getState()
      const next: Record<string, string> = {}
      for (const [runId, text] of pending) next[runId] = ((deltas[runId] ?? '') + text).slice(-DELTA_KEEP)
      pending.clear()
      useRunDeltas.setState(next)
    }
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'message.new' && e.message.groupId === groupId) {
        if (belongs(e.message)) setState((s) => addLive(s, e.message))
      } else if (e.t === 'thread.updated' && e.groupId === groupId)
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === e.rootId ? { ...m, thread: e.thread ?? undefined } : m)),
        }))
      else if (e.t === 'thread.state' && e.rootId === thread) setThreadState(e)
      else if (e.t === 'message.recalled' || e.t === 'message.hidden' || e.t === 'message.edited') onLocal(e)
      else if (
        e.t === 'run.updated' &&
        e.run.groupId === groupId &&
        (!thread || e.run.threadRootId === thread)
      ) {
        runIds.current.add(e.run.id)
        setState((s) => ({ ...s, runs: mergeRuns(s.runs, [e.run]) }))
      } else if (e.t === 'run.step' && e.groupId === groupId)
        setState((s) => {
          const run = s.runs[e.runId]
          return run ? { ...s, runs: mergeRuns(s.runs, [withRunStep(run, e)]) } : s
        })
      else if (e.t === 'run.progress' && e.groupId === groupId)
        setState((s) => {
          const run = s.runs[e.runId]
          return run ? { ...s, runs: mergeRuns(s.runs, [withRunProgress(run, e)]) } : s
        })
      else if (e.t === 'run.delta' && runIds.current.has(e.runId)) {
        pending.set(e.runId, (pending.get(e.runId) ?? '') + e.text)
        flushTimer ??= setTimeout(flushDeltas, DELTA_FLUSH_MS)
        setState((s) => {
          const run = s.runs[e.runId]
          return run ? { ...s, runs: mergeRuns(s.runs, [withRunDelta(run, e)]) } : s
        })
      }
    })
    // Refill anything missed while the socket was down.
    const offStatus = realtime.onReconnect(() => void latest())
    return () => {
      alive = false
      clearTimeout(flushTimer)
      useRunDeltas.setState({}, true)
      local.delete(onLocal)
      offEvents()
      offStatus()
    }
  }, [groupId, fetchPage, applyPage, belongs, thread, attempt])

  const loadOlder = useCallback(async () => {
    // A thread pages its replies: its root always comes first.
    const first = state.messages.find((m) => m.id !== thread)
    if (!state.hasMore || !first || loadingOlder.current) return
    loadingOlder.current = true
    setOlder('loading')
    try {
      applyPage(await fetchPage(first.seq), true)
      setOlder('idle')
    } catch (e) {
      setOlder('failed')
      throw e
    } finally {
      loadingOlder.current = false
    }
  }, [state.hasMore, state.messages, fetchPage, applyPage, thread])

  const addMessage = useCallback((m: MessageDto) => setState((s) => addLive(s, m)), [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { ...state, threadState, older, loadOlder, addMessage, retry }
}
