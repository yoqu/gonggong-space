import type { MessageDto } from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useSession } from '../../app/session'
import { ApiError, api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import type { artifactContextOf } from '../artifacts/context'
import type { UploadItem } from '../attachments/ComposerAttachments'
import type { QuoteDraft } from '../attachments/quote'
import type { AppendTarget } from '../runs/append'
import type { Picks } from './RunConfigChips'

const RETRIES = 2
/** Reconnecting resends a message cut off by the network only this long after it failed; older ones wait for the user. */
export const AUTO_RESEND_MS = 2 * 60_000

export interface SendBody {
  body: string
  clientId: string
  attachmentIds: string[]
  quote: { kind: 'message' | 'run'; id: string } | null
  appendTo: string | null
  runOptions?: Picks
  artifactContext?: ReturnType<typeof artifactContextOf>
  foregroundArtifactId?: string
  threadRootId?: string
  alsoSent?: boolean
}

/** No response at all (ApiError 0): the server may have stored the message, so only the same clientId may go again. */
const unreached = (e: unknown) => !(e instanceof ApiError) || e.status === 0
const transient = (e: unknown) => unreached(e) || (e as ApiError).status >= 500

/** Who is signed in: one account's queue is never shown to, nor sent by, another (rows are per group, so per team). */
export const pendingOwner = () => useSession.getState().user?.id ?? ''

/** Bumped by clearPending: sends started before it are dropped, even if the same account signs back in. */
let session = 0

/** A send started by an account that has since logged out or switched: neither posted again nor reported. */
class SendCancelled extends Error {}

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
export async function postMessage(groupId: string, req: SendBody): Promise<MessageDto> {
  const owner = pendingOwner()
  const started = session
  const check = () => {
    if (started !== session || owner !== pendingOwner()) throw new SendCancelled('session changed')
  }
  for (let attempt = 0; ; attempt++) {
    check()
    let m: MessageDto
    try {
      m = await api.post<MessageDto>(`/groups/${groupId}/messages`, req)
    } catch (e) {
      check()
      if (!transient(e) || attempt >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
      continue
    }
    check()
    return m
  }
}

/** A message shown in the timeline before the server has it; 重发 posts the very same request again. */
export interface PendingMessage {
  groupId: string
  owner: string
  req: SendBody
  /** The composer state it was sent from: shown in the bubble, and handed back when the server refuses it. */
  draft: {
    quote: QuoteDraft | null
    uploads: UploadItem[]
    append: AppendTarget | null
    picks: Picks
    alsoSent: boolean
  }
  status: 'sending' | 'failed'
  /** Failed without reaching the server (it may still have it); when, and whether reconnecting already resent it. */
  unreached?: { at: number; resent: boolean }
  /** Sending again on its own after the connection came back. */
  auto?: boolean
}

/**
 * Outside the views, so a send survives switching groups. `back`: a message handed back to its group's (or thread's)
 * composer as a draft; `refused` when the server rejected it (4xx, which 重发 cannot fix) rather than the user taking it.
 */
export const usePending = create<{
  list: PendingMessage[]
  back: { p: PendingMessage; refused: boolean } | null
  /** Messages taken back whose fate is unknown: sent again as the very same request, they keep their clientId. */
  reusable: Reusable[]
}>(() => ({ list: [], back: null, reusable: [] }))

interface Reusable {
  owner: string
  clientId: string
  request: string
}

/** The request as posted but for its clientId, keys sorted: equal strings are equal requests. */
const requestOf = (
  groupId: string,
  { clientId: _, ...req }: Omit<SendBody, 'clientId'> & { clientId?: string },
) =>
  JSON.stringify({ groupId, req }, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )

/** The clientId of a message taken back, when `req` is exactly what it posted; used once. */
export function reusedClientId(groupId: string, req: Omit<SendBody, 'clientId'>): string | null {
  const owner = pendingOwner()
  const request = requestOf(groupId, req)
  const hit = usePending.getState().reusable.find((r) => r.owner === owner && r.request === request)
  if (!hit) return null
  usePending.setState((s) => ({ reusable: s.reusable.filter((r) => r !== hit) }))
  return hit.clientId
}

/** On logout: forgets the leaving account's unsent messages and stops those still being sent. */
export function clearPending() {
  const owner = pendingOwner()
  session++
  usePending.setState((s) => ({
    list: s.list.filter((p) => p.owner !== owner),
    back: s.back?.p.owner === owner ? null : s.back,
    reusable: s.reusable.filter((r) => r.owner !== owner),
  }))
}

const update = (clientId: string, p: Partial<PendingMessage> | null) =>
  usePending.setState((s) => ({
    list: p
      ? s.list.map((x) => (x.req.clientId === clientId ? { ...x, ...p } : x))
      : s.list.filter((x) => x.req.clientId !== clientId),
  }))

export const dropPending = (clientId: string) => update(clientId, null)

/** 放回输入框: hands a failed message (network or 5xx: it may be stored) back to its composer as a draft. */
export function restorePending(p: PendingMessage) {
  dropPending(p.req.clientId)
  usePending.setState((s) => ({
    back: { p, refused: false },
    reusable: [
      ...s.reusable.filter((r) => r.clientId !== p.req.clientId),
      { owner: p.owner, clientId: p.req.clientId, request: requestOf(p.groupId, p.req) },
    ],
  }))
}

type NewPending = Omit<PendingMessage, 'status' | 'owner' | 'unreached' | 'auto'> & Partial<PendingMessage>

/** Sends (or resends, `auto` when reconnecting did) the very same request: a resend keeps its clientId. */
export async function sendPending(n: NewPending, onSent: (m: MessageDto) => void, auto = false) {
  const p: PendingMessage = { ...n, owner: n.owner ?? pendingOwner(), status: 'sending', auto }
  const id = p.req.clientId
  usePending.setState((s) => ({
    list: s.list.some((x) => x.req.clientId === id)
      ? s.list.map((x) => (x.req.clientId === id ? { ...x, status: 'sending', auto } : x))
      : [...s.list, p],
  }))
  try {
    onSent(await postMessage(p.groupId, p.req))
    dropPending(id)
  } catch (e) {
    // The session ended mid-send (logout clears the row; an expiry keeps it): a failed row its owner may resend, never
    // resent by itself since the server may hold it.
    if (e instanceof SendCancelled)
      return update(id, { status: 'failed', auto: false, unreached: { at: 0, resent: true } })
    toastError(e)
    if (transient(e))
      return update(id, {
        status: 'failed',
        auto: false,
        unreached: unreached(e) ? { at: Date.now(), resent: auto || !!p.unreached?.resent } : undefined,
      })
    dropPending(id)
    usePending.setState({ back: { p: { ...p, status: 'failed' }, refused: true } })
  }
}

/** Once the connection is back: resends, once, what the network cut off in the last two minutes. */
export const autoResendable = (p: PendingMessage, now = Date.now()) =>
  p.status === 'failed' && !!p.unreached && !p.unreached.resent && now - p.unreached.at < AUTO_RESEND_MS

/**
 * The current account's pending rows of one timeline, without those whose server copy already arrived (by realtime or
 * reply).
 */
export const pendingOf = (
  list: PendingMessage[],
  groupId: string,
  thread: string | undefined,
  messages: MessageDto[],
) =>
  list.filter(
    (p) =>
      p.owner === pendingOwner() &&
      p.groupId === groupId &&
      p.req.threadRootId === thread &&
      !messages.some((m) => m.clientId === p.req.clientId),
  )

/** Runs `fn` when a new message is queued, so a view can scroll down to its 发送中 row. */
export function useOnQueued(fn: () => void) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => usePending.subscribe((s, prev) => s.list.length > prev.list.length && latest.current()), [])
}
