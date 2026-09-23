import type { GroupDto, MessageDto } from '@aiws/protocol'
import { Bot, User } from 'lucide-react'
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import { Composer } from '../../app/ChatLayout'
import { useIsMobile } from '../../app/viewport'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { toast } from '../../ui'

const RETRIES = 2

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
async function postMessage(groupId: string, body: string, clientId: string): Promise<MessageDto> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api.post<MessageDto>(`/groups/${groupId}/messages`, { body, clientId })
    } catch (e) {
      const transient = !(e instanceof ApiError) || e.status >= 500
      if (!transient || attempt >= RETRIES) throw e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
}

interface Candidate {
  kind: 'bot' | 'member'
  id: string
  name: string
  hint: string
}

export function MessageComposer({ group, onSent }: { group: GroupDto; onSent: (m: MessageDto) => void }) {
  const mobile = useIsMobile()
  const bots = useWorkspace((s) => s.bots)
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

  const query = /(?:^|\s)@([^\s@]*)$/.exec(draft.slice(0, caret))?.[1]
  const candidates: Candidate[] =
    query === undefined || dismissed
      ? []
      : [
          ...bots
            .filter((b) => group.botIds.includes(b.id))
            .map((b) => ({ kind: 'bot' as const, id: b.id, name: b.name, hint: b.ownerName })),
          ...group.members.map((m) => ({ kind: 'member' as const, id: m.userId, name: m.name, hint: '' })),
        ].filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  const current = Math.min(active, candidates.length - 1)

  const change = (value: string) => {
    setDraft(value)
    setCaret(input.current?.selectionStart ?? value.length)
    setDismissed(false)
    setActive(0)
  }

  const pick = (c: Candidate) => {
    const start = draft.slice(0, caret).lastIndexOf('@')
    const insert = `@${c.name} `
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
      onSent(await postMessage(group.id, body, crypto.randomUUID()))
      setDraft((d) => (d === body ? '' : d))
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '发送失败，请检查网络后重试' })
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const sections = [
    { label: 'BOT', items: candidates.filter((c) => c.kind === 'bot') },
    { label: '成员', items: candidates.filter((c) => c.kind === 'member') },
  ].filter((s) => s.items.length)

  return (
    <Composer
      value={draft}
      onChange={change}
      onSend={() => void send()}
      busy={busy}
      inputRef={input}
      onKeyDown={onKeyDown}
      hint={mobile ? null : '附件 ≤ 50 MB · 每条 ≤ 10 个 · 不 @ 不触发，会作为上下文补送'}
      popover={
        sections.length ? (
          <div className="mention-pop" role="listbox" aria-label="@ 候选">
            {sections.map((s) => (
              <fieldset key={s.label} className="mention-pop__group" aria-label={s.label}>
                <div className="mention-pop__label">{s.label}</div>
                {s.items.map((c) => (
                  <button
                    key={`${c.kind}:${c.id}`}
                    type="button"
                    role="option"
                    aria-selected={candidates[current] === c}
                    className={cx(
                      'mention-pop__item',
                      candidates[current] === c && 'mention-pop__item--active',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                  >
                    {c.kind === 'bot' ? <Bot size={13} /> : <User size={13} />}
                    <span>{c.name}</span>
                    <span className="spacer" />
                    <span className="mention-pop__hint">{c.hint}</span>
                  </button>
                ))}
              </fieldset>
            ))}
          </div>
        ) : null
      }
    />
  )
}
