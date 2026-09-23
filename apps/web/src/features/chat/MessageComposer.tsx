import type { GroupDto, MessageDto } from '@aiws/protocol'
import { Bot, Terminal, User } from 'lucide-react'
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
  kind: 'bot' | 'member' | 'command'
  id: string
  name: string
  hint: string
}

/** Server-handled system commands (spec §8.7); skills and agent commands join this list later. */
const SYSTEM_COMMANDS: Candidate[] = (
  [
    ['stop', '停止运行（未 @ bot 时停止本群全部）'],
    ['hold', '连续占用群锁'],
    ['release', '释放群锁'],
    ['new', '开新会话'],
    ['cd', '绑定本机目录（仅分区）'],
  ] as const
).map(([name, hint]) => ({ kind: 'command', id: name, name, hint }))

const ICONS = { bot: Bot, member: User, command: Terminal }
const SECTIONS = [
  { kind: 'command', label: '系统命令' },
  { kind: 'bot', label: 'BOT' },
  { kind: 'member', label: '成员' },
] as const

/** The token being completed right before the caret: `@name` anywhere, `/command` only as the message's first word. */
function trigger(before: string) {
  const at = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (at) return { char: '@', query: at[1] ?? '' } as const
  const slash = /^\s*\/(\S*)$/.exec(before)
  return slash ? ({ char: '/', query: slash[1] ?? '' } as const) : null
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

  const token = dismissed ? null : trigger(draft.slice(0, caret))
  const candidates: Candidate[] = !token
    ? []
    : (token.char === '/'
        ? SYSTEM_COMMANDS
        : [
            ...bots
              .filter((b) => group.botIds.includes(b.id))
              .map((b) => ({ kind: 'bot' as const, id: b.id, name: b.name, hint: b.ownerName })),
            ...group.members.map((m) => ({ kind: 'member' as const, id: m.userId, name: m.name, hint: '' })),
          ]
      ).filter((c) => c.name.toLowerCase().includes(token.query.toLowerCase()))
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
    const insert = `${token.char}${c.name} `
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

  const sections = SECTIONS.map((s) => ({ ...s, items: candidates.filter((c) => c.kind === s.kind) })).filter(
    (s) => s.items.length,
  )

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
          <div className="mention-pop" role="listbox" aria-label={token?.char === '/' ? '/ 命令' : '@ 候选'}>
            {sections.map((s) => (
              <fieldset key={s.label} className="mention-pop__group" aria-label={s.label}>
                <div className="mention-pop__label">{s.label}</div>
                {s.items.map((c) => {
                  const Icon = ICONS[c.kind]
                  return (
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
                      <Icon size={13} />
                      <span className={cx(c.kind === 'command' && 'mention-pop__cmd')}>
                        {c.kind === 'command' ? `/${c.name}` : c.name}
                      </span>
                      <span className="spacer" />
                      <span className="mention-pop__hint">{c.hint}</span>
                    </button>
                  )
                })}
              </fieldset>
            ))}
          </div>
        ) : null
      }
    />
  )
}
