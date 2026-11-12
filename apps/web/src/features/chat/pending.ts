import type { MessageDto } from '@gonggong/protocol'
import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { ApiError, api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import type { artifactContextOf } from '../artifacts/context'
import type { UploadItem } from '../attachments/ComposerAttachments'
import type { QuoteDraft } from '../attachments/quote'
import type { AppendTarget } from '../runs/append'
import type { Picks } from './RunConfigChips'

const RETRIES = 2

export interface SendBody {
  body: string
  clientId: string
  attachmentIds: string[]
  quote: { kind: 'message' | 'run'; id: string } | null
  appendTo: string | null
  runOptions?: Picks
  artifactContext?: ReturnType<typeof artifactContextOf>
  threadRootId?: string
  alsoSent?: boolean
}

const transient = (e: unknown) => !(e instanceof ApiError) || e.status >= 500

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
export async function postMessage(groupId: string, req: SendBody): Promise<MessageDto> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post<MessageDto>(`/groups/${groupId}/messages`, req)
    } catch (e) {
      if (!transient(e) || attempt >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

/** A message shown in the timeline before the server has it; 重发 posts the very same request again. */
export interface PendingMessage {
  groupId: string
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
}

/**
 * Outside the views, so a send survives switching groups. `rejected`: a message the server refused (4xx), which 重发
 * cannot fix; its group's (or thread's) composer takes it back as a draft.
 */
export const usePending = create<{ list: PendingMessage[]; rejected: PendingMessage | null }>(() => ({
  list: [],
  rejected: null,
}))

const update = (clientId: string, p: Partial<PendingMessage> | null) =>
  usePending.setState((s) => ({
    list: p
      ? s.list.map((x) => (x.req.clientId === clientId ? { ...x, ...p } : x))
      : s.list.filter((x) => x.req.clientId !== clientId),
  }))

export const dropPending = (clientId: string) => update(clientId, null)

export async function sendPending(p: Omit<PendingMessage, 'status'>, onSent: (m: MessageDto) => void) {
  const id = p.req.clientId
  usePending.setState((s) => ({
    list: s.list.some((x) => x.req.clientId === id)
      ? s.list.map((x) => (x.req.clientId === id ? { ...x, status: 'sending' } : x))
      : [...s.list, { ...p, status: 'sending' }],
  }))
  try {
    onSent(await postMessage(p.groupId, p.req))
    dropPending(id)
  } catch (e) {
    toastError(e)
    if (transient(e)) return update(id, { status: 'failed' })
    dropPending(id)
    usePending.setState({ rejected: { ...p, status: 'failed' } })
  }
}

/** The pending rows of one timeline, without those whose server copy already arrived (by realtime or reply). */
export const pendingOf = (
  list: PendingMessage[],
  groupId: string,
  thread: string | undefined,
  messages: MessageDto[],
) =>
  list.filter(
    (p) =>
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
