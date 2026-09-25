import type { GroupDto, MessageDto } from '@gonggong/protocol'
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport'
import { ApiError, api } from '../../lib/api'
import { toast } from '../../ui'
import { AttachmentChips, FilePickers, QuoteChip, useUploads } from '../attachments/ComposerAttachments'
import { useQuote } from '../attachments/quote'
import { AppendBanner } from '../runs/AppendBanner'
import { useAppend } from '../runs/append'
import { Composer } from './Composer'
import { type Candidate, CandidatePopover, useCandidates } from './ComposerCandidates'

const RETRIES = 2

const draftKey = (groupId: string) => `gonggong:draft:${groupId}`
function loadDraft(groupId: string) {
  try {
    return sessionStorage.getItem(draftKey(groupId)) ?? ''
  } catch {
    return ''
  }
}

interface SendBody {
  body: string
  clientId: string
  attachmentIds: string[]
  quote: { kind: 'message' | 'run'; id: string } | null
  appendTo: string | null
}

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
async function postMessage(groupId: string, req: SendBody): Promise<MessageDto> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post<MessageDto>(`/groups/${groupId}/messages`, req)
    } catch (e) {
      const transient = !(e instanceof ApiError) || e.status >= 500
      if (!transient || attempt >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

export function MessageComposer({ group, onSent }: { group: GroupDto; onSent: (m: MessageDto) => void }) {
  const mobile = useIsMobile()
  const [draft, setDraft] = useState(() => loadDraft(group.id))
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)
  const sending = useRef(false)
  const uploads = useUploads(group.id)
  const quote = useQuote((s) => (s.quote?.groupId === group.id ? s.quote : null))
  const imagePicker = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const listId = useId()
  /** Caret to restore right after a picked candidate is rendered, before any further keystroke. */
  const pendingCaret = useRef<number | null>(null)

  // Drafts survive switching groups (ChatView remounts per group) and reloads of the tab.
  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(draftKey(group.id), draft)
      else sessionStorage.removeItem(draftKey(group.id))
    } catch {
      // Storage can be unavailable (private mode, quota); the draft then lives only in memory.
    }
  }, [group.id, draft])

  useLayoutEffect(() => {
    const pos = pendingCaret.current
    if (pos === null || !input.current) return
    pendingCaret.current = null
    input.current.focus()
    input.current.setSelectionRange(pos, pos)
  })

  const {
    token,
    sections,
    items: candidates,
  } = useCandidates(group, dismissed ? null : draft.slice(0, caret))
  const current = Math.min(active, candidates.length - 1)
  const open = sections.length > 0

  const change = (value: string) => {
    // Toolbar buttons (@ / 命令) append while the input is not focused: continue typing at the end.
    const typed = input.current !== null && document.activeElement === input.current
    const pos = typed ? (input.current?.selectionStart ?? value.length) : value.length
    if (!typed) pendingCaret.current = pos
    setDraft(value)
    setCaret(pos)
    setDismissed(false)
    setActive(0)
  }

  const pick = (c: Candidate) => {
    if (!token) return
    const start = draft.slice(0, caret).lastIndexOf(token.char)
    const insert = `${c.insert} `
    const next = draft.slice(0, start) + insert + draft.slice(caret)
    const pos = start + insert.length
    pendingCaret.current = pos
    setDraft(next)
    setCaret(pos)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!candidates.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + candidates.length) % candidates.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const c = candidates[current]
      if (c) pick(c)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
    }
  }

  const send = async () => {
    const body = draft
    const attachmentIds = uploads.ids
    if (sending.current || uploads.uploading || (!body.trim() && !attachmentIds.length)) return
    sending.current = true
    setBusy(true)
    try {
      const q = quote && { kind: quote.kind, id: quote.id }
      const target = useAppend.getState().target
      const appendTo = target?.groupId === group.id ? target.runId : null
      const req = { body, clientId: crypto.randomUUID(), attachmentIds, quote: q, appendTo }
      onSent(await postMessage(group.id, req))
      setSent((n) => n + 1)
      if (appendTo) useAppend.getState().clear()
      setDraft((d) => (d === body ? '' : d))
      uploads.clear()
      if (q) useQuote.getState().clear()
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '发送失败，请检查网络后重试' })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return (
    <Composer
      value={draft}
      onChange={change}
      onSend={() => void send()}
      busy={busy}
      sent={sent}
      attachments={uploads.items.length}
      uploading={uploads.uploading}
      onImage={() => imagePicker.current?.click()}
      onAttach={() => filePicker.current?.click()}
      above={
        <>
          <AppendBanner groupId={group.id} />
          <FilePickers uploads={uploads} imageRef={imagePicker} fileRef={filePicker} />
          {quote ? <QuoteChip quote={quote} /> : null}
          <AttachmentChips uploads={uploads} />
        </>
      }
      inputRef={input}
      onKeyDown={onKeyDown}
      onFiles={uploads.add}
      combobox={{
        controls: listId,
        expanded: open,
        active: open && current >= 0 ? `${listId}-${current}` : undefined,
      }}
      hint={mobile ? null : '未 @ 的消息不会触发 Bot，会作为背景补充给下一次任务'}
      popover={
        token && open ? (
          <CandidatePopover
            id={listId}
            char={token.char}
            sections={sections}
            active={candidates[current]}
            onPick={pick}
          />
        ) : null
      }
    />
  )
}
