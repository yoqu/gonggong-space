import {
  type MessageDto,
  RECALLED_QUOTE,
  type RunDto,
  type TimelineDto,
  type WebEvent,
} from '@gonggong/protocol'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { realtime } from '../../lib/realtime'

const PAGE = 50
/** Streaming text kept per run; only the tail is shown on the card. */
const DELTA_KEEP = 400

interface TimelineState {
  messages: MessageDto[]
  runs: Record<string, RunDto>
  deltas: Record<string, string>
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
  deltas: {},
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

const local = new Set<(e: Withdrawn) => void>()
/** Applies my confirmed recall / delete at once instead of waiting for its realtime echo. */
export const applyWithdrawn = (e: Withdrawn) => {
  for (const h of local) h(e)
}

const mergeRuns = (runs: Record<string, RunDto>, list: RunDto[]) => {
  const next = { ...runs }
  for (const r of list) next[r.id] = r
  return next
}

/** Messages + run cards of one group, kept live from realtime events. */
export function useTimeline(groupId: string) {
  const [state, setState] = useState<TimelineState>(EMPTY)
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [attempt, setAttempt] = useState(0)
  const loadingOlder = useRef(false)

  const fetchPage = useCallback(
    (before?: number) =>
      api.get<TimelineDto>(`/groups/${groupId}/timeline?limit=${PAGE}${before ? `&before=${before}` : ''}`),
    [groupId],
  )

  const applyPage = useCallback((page: TimelineDto, older: boolean) => {
    setState((s) => ({
      ...s,
      messages: mergeMessages(s.messages, page.messages),
      runs: mergeRuns(s.runs, page.runs),
      hasMore: older || !s.loaded ? page.messages.length === PAGE : s.hasMore,
      loaded: true,
      failed: false,
    }))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the first load on retry
  useEffect(() => {
    setState(EMPTY)
    let alive = true
    const latest = () =>
      fetchPage().then(
        (page) => alive && applyPage(page, false),
        // A failed refill after reconnect keeps what is shown; only a failed first page is an error.
        () => alive && setState((s) => (s.loaded ? s : { ...s, failed: true })),
      )
    void latest()
    const onWithdrawn = (e: Withdrawn) => {
      if (e.groupId === groupId) setState((s) => withdraw(s, e))
    }
    local.add(onWithdrawn)
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'message.new' && e.message.groupId === groupId) setState((s) => addLive(s, e.message))
      else if (e.t === 'message.recalled' || e.t === 'message.hidden') onWithdrawn(e)
      else if (e.t === 'run.updated' && e.run.groupId === groupId)
        setState((s) => ({ ...s, runs: mergeRuns(s.runs, [e.run]) }))
      else if (e.t === 'run.delta')
        setState((s) =>
          s.runs[e.runId]
            ? {
                ...s,
                deltas: { ...s.deltas, [e.runId]: ((s.deltas[e.runId] ?? '') + e.text).slice(-DELTA_KEEP) },
              }
            : s,
        )
    })
    // Refill anything missed while the socket was down.
    let wasOpen = realtime.getStatus() === 'open'
    const offStatus = realtime.onStatus((st) => {
      if (st === 'open' && wasOpen) void latest()
      if (st === 'open') wasOpen = true
    })
    return () => {
      alive = false
      local.delete(onWithdrawn)
      offEvents()
      offStatus()
    }
  }, [groupId, fetchPage, applyPage, attempt])

  const loadOlder = useCallback(async () => {
    const first = state.messages[0]
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
  }, [state.hasMore, state.messages, fetchPage, applyPage])

  const addMessage = useCallback((m: MessageDto) => setState((s) => addLive(s, m)), [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { ...state, older, loadOlder, addMessage, retry }
}
