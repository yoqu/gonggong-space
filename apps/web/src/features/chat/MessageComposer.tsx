import type { GroupDto, MessageDto } from '@gonggong/protocol'
import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useIsMobile } from '../../app/viewport'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { Composer } from '../../ui'
import { AttachmentChips, FilePickers, QuoteChip, useUploads } from '../attachments/ComposerAttachments'
import { useQuote } from '../attachments/quote'
import { AppendBanner } from '../runs/AppendBanner'
import { useAppend } from '../runs/append'
import { type Candidate, CandidatePopover, useCandidates } from './ComposerCandidates'
import { useCite } from './cite'
import { mentionedBots, type Picks, RunConfigChips } from './RunConfigChips'
import './composer.css'

/** The input grows with its content up to this height (and 40% of the window), then scrolls. */
const MAX_INPUT_PX = 240

/** Bare `@` / `/` only open the candidate list; they are not a message. */
const hasText = (value: string) => !['', '@', '/'].includes(value.trim())

const RETRIES = 2

/** sessionStorage key of a group's unsent draft. */
export const draftKey = (groupId: string) => `gonggong:draft:${groupId}`
function loadDraft(groupId: string) {
  try {
    return sessionStorage.getItem(draftKey(groupId)) ?? ''
  } catch {
    return ''
  }
}

/** UUID v4 without crypto.randomUUID, which only exists in secure contexts (plain-http LAN access lacks it). */
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

interface SendBody {
  body: string
  clientId: string
  attachmentIds: string[]
  quote: { kind: 'message' | 'run'; id: string } | null
  appendTo: string | null
  runOptions?: Picks
}

/** Retries network / 5xx failures with the same clientId, so the server stores the message at most once. */
export async function postMessage(groupId: string, req: SendBody): Promise<MessageDto> {
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

export function MessageComposer({
  group,
  onSent,
  dropFiles,
}: {
  group: GroupDto
  onSent: (m: MessageDto) => void
  /** Filled with the upload entry point, so files dropped anywhere on the chat attach here. */
  dropFiles?: RefObject<((files: File[]) => void) | null>
}) {
  const mobile = useIsMobile()
  const [draft, setDraft] = useState(() => loadDraft(group.id))
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(0)
  const [picks, setPicks] = useState<Picks>({})
  const groupBots = useWorkspace((s) => s.bots).filter((b) => group.botIds.includes(b.id))
  const appending = useAppend((s) => s.target?.groupId === group.id)
  const mentioned = mentionedBots(draft, groupBots)
  // Mirrors the server: a dm with a single bot needs no @ (appends excepted); run options skip commands.
  const soleDm = group.kind === 'dm' && groupBots.length === 1 && !appending
  const targets = !mentioned.length && soleDm && !draft.trimStart().startsWith('/') ? groupBots : mentioned
  const sending = useRef(false)
  const uploads = useUploads(group.id)
  useEffect(() => {
    if (dropFiles) dropFiles.current = uploads.add
  })
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
    names,
    sections,
    items: candidates,
  } = useCandidates(group, dismissed ? null : draft.slice(0, caret))
  const current = Math.min(active, candidates.length - 1)
  const open = sections.length > 0

  const focused = () => (document.activeElement === input.current ? input.current : null)

  const change = (value: string, at?: number) => {
    // Toolbar buttons edit while the input may not be focused: put the caret right after their insert.
    const typed = at === undefined && focused() !== null
    const pos = at ?? (typed ? (input.current?.selectionStart ?? value.length) : value.length)
    if (!typed) pendingCaret.current = pos
    setDraft(value)
    setCaret(pos)
    setDismissed(false)
    setActive(0)
  }

  const cited = useCite((s) => (s.pending?.groupId === group.id ? s.pending : null))
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per handed-over text, onto the draft it was rendered with
  useEffect(() => {
    if (!cited) return
    useCite.setState({ pending: null })
    change(`${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${cited.text} `)
  }, [cited])

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
      const runOptions: Picks = {}
      for (const b of targets) {
        const pick = picks[b.id]
        if (pick) runOptions[b.id] = pick
      }
      const req: SendBody = { body, clientId: uuid(), attachmentIds, quote: q, appendTo }
      if (Object.keys(runOptions).length) req.runOptions = runOptions
      onSent(await postMessage(group.id, req))
      setSent((n) => n + 1)
      if (appendTo) useAppend.getState().clear()
      setDraft((d) => (d === body ? '' : d))
      setPicks({})
      uploads.clear()
      if (q) useQuote.getState().clear()
    } catch (e) {
      toastError(e)
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const chips = appending || quote || uploads.items.length > 0
  return (
    <div className="composer">
      <FilePickers uploads={uploads} imageRef={imagePicker} fileRef={filePicker} />
      <Composer
        value={draft}
        onChange={change}
        onSend={() => void send()}
        canSend={(hasText(draft) || uploads.items.length > 0) && !uploads.uploading}
        busy={busy}
        sent={sent}
        onFiles={uploads.add}
        maxInputHeight={Math.min(MAX_INPUT_PX, window.innerHeight * 0.4)}
        placeholder={mobile ? '发消息，@ 触发 Bot' : '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'}
        tools={[
          {
            icon: 'at',
            label: '@ 提及',
            onClick: () => {
              const c = focused()?.selectionStart ?? draft.length
              const at = c > 0 && !/\s/.test(draft[c - 1] ?? '') ? ' @' : '@'
              change(draft.slice(0, c) + at + draft.slice(c), c + at.length)
            },
          },
          { icon: 'slash', label: '命令', onClick: () => change(`${draft}/`) },
          { icon: 'paperclip', label: '附件', onClick: () => filePicker.current?.click() },
          { icon: 'image', label: '图片', onClick: () => imagePicker.current?.click() },
        ]}
        hint={
          mobile || targets.length || soleDm ? false : '未 @ 的消息不会触发 Bot，会作为背景补充给下一次任务'
        }
        accessory={
          targets.length ? (
            <RunConfigChips group={group} bots={targets} picks={picks} onChange={setPicks} />
          ) : undefined
        }
        above={
          chips ? (
            <div className="composer__chips" data-testid="composer-chips">
              <AppendBanner groupId={group.id} />
              {quote ? <QuoteChip quote={quote} /> : null}
              <AttachmentChips uploads={uploads} />
            </div>
          ) : null
        }
        mentionNames={names}
        inputRef={input}
        onKeyDown={onKeyDown}
        textareaProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': open,
          'aria-controls': listId,
          'aria-activedescendant': open && current >= 0 ? `${listId}-${current}` : undefined,
        }}
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
    </div>
  )
}
