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
/** How long streamed text is gathered before it is shown. */
const DELTA_FLUSH_MS = 100

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

type Edited = Extract<WebEvent, { t: 'message.edited' }>

/** New text and 已编辑 for the message and quotes of it; reactions stay (theirs carry the editor's `mine`). */
const edit = (s: TimelineState, { message: e }: Edited): TimelineState => ({
  ...s,
  messages: s.messages.map((m) =>
    m.id === e.id
      ? { ...m, body: e.body, editedAt: e.editedAt }
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
    const onLocal = (e: Withdrawn | Edited) => {
      if (e.t === 'message.edited') {
        if (e.message.groupId === groupId) setState((s) => edit(s, e))
      } else if (e.groupId === groupId) setState((s) => withdraw(s, e))
    }
    local.add(onLocal)
    // Streamed text is applied in batches: each update re-renders the whole timeline and re-pins the scroll.
    const pending = new Map<string, string>()
    let flushTimer: ReturnType<typeof setTimeout> | undefined
    const flushDeltas = () => {
      flushTimer = undefined
      const batch = [...pending]
      pending.clear()
      setState((s) => {
        // Every group's runs stream over the one socket; another group's text must not re-render this one.
        const mine = batch.filter(([runId]) => s.runs[runId])
        if (!mine.length) return s
        const deltas = { ...s.deltas }
        for (const [runId, text] of mine) deltas[runId] = ((deltas[runId] ?? '') + text).slice(-DELTA_KEEP)
        return { ...s, deltas }
      })
    }
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'message.new' && e.message.groupId === groupId) setState((s) => addLive(s, e.message))
      else if (e.t === 'message.recalled' || e.t === 'message.hidden' || e.t === 'message.edited') onLocal(e)
      else if (e.t === 'run.updated' && e.run.groupId === groupId)
        setState((s) => ({ ...s, runs: mergeRuns(s.runs, [e.run]) }))
      else if (e.t === 'run.delta') {
        pending.set(e.runId, (pending.get(e.runId) ?? '') + e.text)
        flushTimer ??= setTimeout(flushDeltas, DELTA_FLUSH_MS)
      }
    })
    // Refill anything missed while the socket was down.
    let wasOpen = realtime.getStatus() === 'open'
    const offStatus = realtime.onStatus((st) => {
      if (st === 'open' && wasOpen) void latest()
      if (st === 'open') wasOpen = true
    })
    return () => {
      alive = false
      clearTimeout(flushTimer)
      local.delete(onLocal)
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
