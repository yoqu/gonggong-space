import {
  type BranchMessageRes,
  KNOWLEDGE_TITLE_MAX,
  type MessageDto,
  RECALL_WINDOW_MS,
  type RunDto,
} from '@gonggong/protocol'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { Button, ContextMenu, Dialog, Icon, MenuButton, type MenuItem, Presence, toast } from '../../ui'
import { attachmentUrl } from '../attachments/api'
import { KnowledgeEditor } from '../knowledge/KnowledgeEditor'
import { ReactionPicker } from '../reactions'
import { useSaveMenu } from '../saved/SaveMenu'
import { keepRecalled, type RecalledDraft } from './recalled'
import { markUnreadFrom } from './unreadMark'
import { applyLocal } from './useTimeline'
import './recall.css'
import { t } from '../../i18n'
import { pinsApi, usePins } from './PinnedMessages'

const LONG_PRESS_MS = 500

/** Read before the recall, which erases the content for good: what 重新编辑 puts back. */
async function snapshot(m: MessageDto): Promise<RecalledDraft> {
  const read = await Promise.allSettled(
    m.attachments.map(async (a) => {
      const res = await fetch(attachmentUrl(a.id))
      if (!res.ok) throw new Error(a.name)
      return new File([await res.blob()], a.name, { type: a.mime })
    }),
  )
  const lost = m.attachments.filter((_, i) => read[i]?.status === 'rejected').map((a) => a.name)
  if (lost.length)
    toast({
      type: 'warning',
      message: t('{names} 未能保留，重新编辑时需重新添加', { names: lost.join('、') }),
    })
  return {
    groupId: m.groupId,
    body: m.body,
    quote: m.quote ? { ...m.quote, groupId: m.groupId } : null,
    files: read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
  }
}

async function recall(m: MessageDto, started: string[]) {
  const draft = await snapshot(m)
  try {
    await api.post(`/messages/${m.id}/recall`)
  } catch (e) {
    const late = e instanceof ApiError && e.code === 'recall_expired'
    toast({ type: 'error', message: late ? t('超过 24 小时，无法撤回') : (e as Error).message })
    return
  }
  keepRecalled(m.id, draft)
  applyLocal({ t: 'message.recalled', groupId: m.groupId, messageId: m.id })
  // The server voids only the runs that have not started; the started ones would go on with the recalled prompt.
  for (const id of started) api.post(`/runs/${id}/stop`, {}).catch(toastError)
}

async function branch(m: MessageDto, open: (groupId: string) => void) {
  try {
    open((await api.post<BranchMessageRes>(`/messages/${m.id}/branch`)).groupId)
  } catch (e) {
    toastError(e)
  }
}

async function hide(m: MessageDto) {
  try {
    await api.post(`/messages/${m.id}/hide`)
    applyLocal({ t: 'message.hidden', groupId: m.groupId, messageId: m.id })
    return true
  } catch (e) {
    toastError(e)
    return false
  }
}

function DeleteDialog({ message, onClose }: { message: MessageDto; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open
      title={t('删除消息？')}
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              if (await hide(message)) onClose()
              else setBusy(false)
            }}
          >
            {t('删除')}
          </Button>
        </>
      }
    >
      <p className="msg-delete-note">{t('删除后仅对你隐藏，其他成员仍可见')}</p>
    </Dialog>
  )
}

/** 存入知识库: the first line as the title, the whole text plus where it came from as the body. */
const knowledgeDraft = (m: MessageDto) => ({
  title: (m.body.trim().split('\n')[0] ?? '').trim().slice(0, KNOWLEDGE_TITLE_MAX),
  body: `${m.body.trim()}\n\n${t('来源：#{seq} {name}', { seq: m.seq, name: m.authorName })}`,
})

/** The text selected within `host`, if any. */
function selectedIn(host: Element | null | undefined) {
  const s = getSelection()
  if (!host || !s || s.isCollapsed || !host.contains(s.anchorNode) || !host.contains(s.focusNode)) return ''
  return s.toString()
}

/**
 * Keeps the bar of its message row open after a touch long-press, until the next touch elsewhere. Once the press
 * selects text (the browser's own long-press), the bar steps aside so the selection handles and menu stay usable.
 */
function useLongPress(bar: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = bar.current?.closest<HTMLElement>('.pn-msg')
    if (!host) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => clearTimeout(timer)
    // Listens on the document only from a touch press until closed: a long timeline would otherwise hold one
    // listener per row.
    const outside = (e: PointerEvent) => {
      if (!host.contains(e.target as Node)) close()
    }
    const close = () => {
      host.dataset.actions = ''
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('selectionchange', selecting)
    }
    const selecting = () => {
      if (!selectedIn(host)) return
      cancel()
      close()
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      cancel()
      document.addEventListener('selectionchange', selecting)
      timer = setTimeout(() => {
        if (selectedIn(host)) return close()
        host.dataset.actions = 'open'
        document.addEventListener('pointerdown', outside)
      }, LONG_PRESS_MS)
    }
    // A tap or swipe that does not open the bar leaves nothing behind on the document.
    const end = () => {
      cancel()
      if (host.dataset.actions !== 'open') document.removeEventListener('selectionchange', selecting)
    }
    host.dataset.actions = ''
    host.addEventListener('pointerdown', down)
    for (const t of ['pointerup', 'pointercancel', 'pointermove'] as const) host.addEventListener(t, end)
    return () => {
      cancel()
      host.removeEventListener('pointerdown', down)
      for (const t of ['pointerup', 'pointercancel', 'pointermove'] as const) host.removeEventListener(t, end)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('selectionchange', selecting)
    }
  }, [bar])
}

/**
 * The runs whose reply may branch: each owned bot's latest completed run in the group. Mirrors the server's check in
 * messages/branch.ts, so the menu is never offered where the server would refuse.
 */
export function branchableRuns(runs: RunDto[], isMine: (botId: string) => boolean): Set<string> {
  const latest = new Map<string, { id: string; at: number }>()
  for (const r of runs) {
    if (r.status !== 'completed' || !r.startedAt || !isMine(r.botId)) continue
    const at = Date.parse(r.startedAt)
    if ((latest.get(r.botId)?.at ?? -Infinity) < at) latest.set(r.botId, { id: r.id, at })
  }
  return new Set(Array.from(latest.values(), (v) => v.id))
}

export interface ActionTarget {
  /** The message the actions act on; null for a run card without its reply yet (no reactions). */
  message: MessageDto | null
  link: string
  quoteTitle?: string
  onQuote: () => void
  copyText?: string
  /** My own user message: 编辑 / 撤回 (within the window) and 删除. */
  own?: boolean
  /** Opens the inline editor of my own message (编辑). */
  onEdit?: () => void
  /** Ids of the runs my own message triggered that have started: 撤回 stops them too. */
  startedRuns?: () => string[]
  /** A bot reply on its owner's latest completed run: 分支到新聊天 (see branchableRuns). */
  branchable?: boolean
  /** A message that may start a thread: 回复话题 opens it. */
  onThread?: () => void
}

/**
 * One action set for both the hover bar and the right-click menu (Pane `messageMenuItems` order: reply first,
 * destructive last); the menu is the bar's superset since it also lists what the bar keeps under 更多.
 */
function useMessageMenu(target: ActionTarget) {
  const [picking, setPicking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const bar = useRef<HTMLDivElement>(null)
  // Tapping 复制 or opening the menu may clear the selection before the click lands, so it is read first.
  const picked = useRef('')
  const keepSelection = () => {
    picked.current = selectedIn(bar.current?.closest('.pn-msg'))
  }
  const mine = target.own && target.message ? target.message : null
  const recallable = !!mine && Date.now() - Date.parse(mine.createdAt) < RECALL_WINDOW_MS
  // Commands are not editable (the server refuses them too).
  const editable = recallable && !!target.onEdit && !!mine?.body && !mine.body.trimStart().startsWith('/')
  const branchable = !!target.branchable && !!target.message
  const savable = !!target.copyText?.trim() && !!target.message && target.message.kind !== 'event'
  const pinnable = !!target.message && target.message.kind !== 'event' && !target.message.recalled
  const pinned = usePins(target.message?.groupId ?? '').some((p) => p.messageId === target.message?.id)
  // Main-timeline messages only: the group's read cursor does not cover thread replies.
  const unreadable = !!target.message && !target.message.threadRootId && target.message.kind !== 'event'
  const later = useSaveMenu(target.message)
  const more: MenuItem[] = [
    ...later.item,
    { value: 'link', label: t('复制链接'), icon: 'link' },
    ...(unreadable ? [{ value: 'unread', label: t('从这里标为未读'), icon: 'eye-slash' as const }] : []),
    ...(pinnable
      ? [{ value: pinned ? 'unpin' : 'pin', label: pinned ? t('取消置顶') : t('置顶'), icon: 'pin' as const }]
      : []),
    ...(savable ? [{ value: 'knowledge', label: t('存入知识库'), icon: 'archive' as const }] : []),
    ...(branchable ? [{ value: 'branch', label: t('分支到新聊天'), icon: 'git-branch' as const }] : []),
    ...(editable ? [{ value: 'edit', label: t('编辑'), icon: 'textformat' as const }] : []),
    ...(mine && recallable ? [{ value: 'recall', label: t('撤回'), icon: 'undo' as const }] : []),
    ...(mine ? [{ value: 'delete', label: t('删除'), icon: 'trash' as const, destructive: true }] : []),
  ]
  const all: MenuItem[] = [
    ...(target.onThread ? [{ value: 'thread', label: t('回复话题'), icon: 'thread' as const }] : []),
    ...(target.message ? [{ value: 'react', label: t('表情回应'), icon: 'smile' as const }] : []),
    { value: 'quote', label: t('引用回复'), icon: 'quote' },
    ...(target.copyText !== undefined ? [{ value: 'copy', label: t('复制'), icon: 'copy' as const }] : []),
    { separator: true },
    ...more,
  ]
  const select = (value: string) => {
    if (later.select(value)) return
    if (value === 'thread') target.onThread?.()
    else if (value === 'react') setPicking(true)
    else if (value === 'quote') target.onQuote()
    else if (value === 'copy' && target.copyText !== undefined) {
      const part = picked.current || selectedIn(bar.current?.closest('.pn-msg'))
      picked.current = ''
      void copyWithToast(part || target.copyText, t('已复制'))
    } else if (value === 'link') void copyWithToast(target.link, t('链接已复制'))
    else if (value === 'unread' && target.message) void markUnreadFrom(target.message)
    else if (value === 'branch' && target.message)
      void branch(target.message, (groupId) => navigate(`/g/${groupId}`))
    else if (value === 'pin' && target.message) void pinsApi.pin(target.message.groupId, target.message.id)
    else if (value === 'unpin' && target.message)
      void pinsApi.unpin(target.message.groupId, target.message.id)
    else if (value === 'knowledge') setSaving(true)
    else if (value === 'edit') target.onEdit?.()
    else if (value === 'recall' && mine) void recall(mine, target.startedRuns?.() ?? [])
    else if (value === 'delete') setDeleting(true)
  }
  const dialog = (
    <>
      {later.dialog}
      <Presence>
        {mine && deleting ? <DeleteDialog message={mine} onClose={() => setDeleting(false)} /> : null}
      </Presence>
      <Presence>
        {saving && target.message ? (
          <KnowledgeEditor
            groupId={target.message.groupId}
            draft={knowledgeDraft(target.message)}
            onClose={() => setSaving(false)}
          />
        ) : null}
      </Presence>
    </>
  )
  return { target, picking, setPicking, more, all, select, dialog, bar, keepSelection }
}

type MessageMenuState = ReturnType<typeof useMessageMenu>

/** The Pane glass hover bar; kept visible while its menus are open or after a touch long-press. */
function Bar({ menu }: { menu: MessageMenuState }) {
  const { target, bar } = menu
  const [more, setMore] = useState(false)
  useLongPress(bar)
  return (
    <div
      ref={bar}
      className="pn-msgactions msg-actions"
      role="toolbar"
      aria-label={t('消息操作')}
      data-message-id={target.message?.id}
      data-open={more || menu.picking || undefined}
    >
      {target.message ? (
        <ReactionPicker message={target.message} open={menu.picking} onOpenChange={menu.setPicking} />
      ) : null}
      {target.onThread ? (
        <button type="button" aria-label={t('回复话题')} title={t('回复话题')} onClick={target.onThread}>
          <Icon name="thread" />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('引用回复')}
        title={target.quoteTitle ?? t('引用回复')}
        onClick={target.onQuote}
      >
        <Icon name="quote" />
      </button>
      {target.copyText !== undefined ? (
        <button
          type="button"
          aria-label={t('复制')}
          title={t('复制')}
          onPointerDown={menu.keepSelection}
          onClick={(e) => {
            // From the keyboard (no pointer down first) a closed menu's selection may linger: read it now.
            if (e.detail === 0) menu.keepSelection()
            menu.select('copy')
          }}
        >
          <Icon name="copy" />
        </button>
      ) : null}
      <MenuButton
        aria-label={t('更多')}
        title={t('更多')}
        align="end"
        items={menu.more}
        onSelect={menu.select}
        onOpenChange={setMore}
      >
        <Icon name="more" weight={2.6} />
      </MenuButton>
    </div>
  )
}

/** A standalone hover bar (no right-click menu). */
export function MessageActions(props: ActionTarget) {
  const menu = useMessageMenu(props)
  return (
    <>
      <Bar menu={menu} />
      {menu.dialog}
    </>
  )
}

/** Wraps a message row: right-click (or ⇧F10) opens the full action menu; `children` receives the hover bar. */
export function MessageMenu({
  children,
  ...target
}: ActionTarget & { children: (bar: ReactNode) => ReactNode }) {
  const menu = useMessageMenu(target)
  return (
    <ContextMenu items={menu.all} onSelect={menu.select} onOpen={menu.keepSelection} nativeTouch>
      {children(<Bar menu={menu} />)}
      {menu.dialog}
    </ContextMenu>
  )
}
