import type { MessageDto, RunDto, TimelineDto } from '@aiws/protocol'
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
  hasMore: boolean
  loaded: boolean
}

const EMPTY: TimelineState = { messages: [], runs: {}, deltas: {}, hasMore: false, loaded: false }

const mergeMessages = (a: MessageDto[], b: MessageDto[]) => {
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.seq - y.seq)
}

const mergeRuns = (runs: Record<string, RunDto>, list: RunDto[]) => {
  const next = { ...runs }
  for (const r of list) next[r.id] = r
  return next
}

/** Messages + run cards of one group, kept live from realtime events. */
export function useTimeline(groupId: string) {
  const [state, setState] = useState<TimelineState>(EMPTY)
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
    }))
  }, [])

  useEffect(() => {
    setState(EMPTY)
    let alive = true
    const latest = () =>
      fetchPage().then(
        (page) => alive && applyPage(page, false),
        () => {},
      )
    void latest()
    const offEvents = realtime.subscribe((e) => {
      if (e.t === 'message.new' && e.message.groupId === groupId)
        setState((s) => ({ ...s, messages: mergeMessages(s.messages, [e.message]) }))
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
      offEvents()
      offStatus()
    }
  }, [groupId, fetchPage, applyPage])

  const loadOlder = useCallback(async () => {
    const first = state.messages[0]
    if (!state.hasMore || !first || loadingOlder.current) return
    loadingOlder.current = true
    try {
      applyPage(await fetchPage(first.seq), true)
    } finally {
      loadingOlder.current = false
    }
  }, [state.hasMore, state.messages, fetchPage, applyPage])

  const addMessage = useCallback(
    (m: MessageDto) => setState((s) => ({ ...s, messages: mergeMessages(s.messages, [m]) })),
    [],
  )

  return { ...state, loadOlder, addMessage }
}
