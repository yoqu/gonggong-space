import type { GroupDto, MessageDto } from '@aiws/protocol'
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { Composer } from '../../app/ChatLayout'
import { useIsMobile } from '../../app/viewport'
import { ApiError, api } from '../../lib/api'
import { toast } from '../../ui'
import { AppendBanner } from '../runs/AppendBanner'
import { useAppend } from '../runs/append'
import { type Candidate, CandidatePopover, useCandidates } from './ComposerCandidates'

const RETRIES = 2

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
async function postMessage(
  groupId: string,
  body: string,
  clientId: string,
  appendTo: string | null,
): Promise<MessageDto> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post<MessageDto>(`/groups/${groupId}/messages`, { body, clientId, appendTo })
    } catch (e) {
      const transient = !(e instanceof ApiError) || e.status >= 500
      if (!transient || attempt >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

export function MessageComposer({ group, onSent }: { group: GroupDto; onSent: (m: MessageDto) => void }) {
  const mobile = useIsMobile()
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  /** Caret to restore right after a picked candidate is rendered, before any further keystroke. */
  const pendingCaret = useRef<number | null>(null)

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
    if (!candidates.length || e.nativeEvent.isComposing) return
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
    if (sending.current || !body.trim()) return
    sending.current = true
    setBusy(true)
    try {
      const target = useAppend.getState().target
      const appendTo = target?.groupId === group.id ? target.runId : null
      onSent(await postMessage(group.id, body, crypto.randomUUID(), appendTo))
      if (appendTo) useAppend.getState().clear()
      setDraft((d) => (d === body ? '' : d))
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
      inputRef={input}
      onKeyDown={onKeyDown}
      above={<AppendBanner groupId={group.id} />}
      hint={mobile ? null : '附件 ≤ 50 MB · 每条 ≤ 10 个 · 不 @ 不触发，会作为上下文补送'}
      popover={
        token && sections.length ? (
          <CandidatePopover
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
