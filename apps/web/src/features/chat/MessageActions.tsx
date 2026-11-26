import {
  type BranchMessageRes,
  KNOWLEDGE_TITLE_MAX,
  type MessageDto,
  RECALL_WINDOW_MS,
  type RunDto,
  type RunStatus,
} from '@gonggong/protocol'
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ApiError, api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { AlertDialog, ContextMenu, Icon, MenuButton, type MenuItem, Presence, toast } from '../../ui'
import { attachmentUrl } from '../attachments/api'
import { KnowledgeEditor } from '../knowledge/KnowledgeEditor'
import { ReactionPicker } from '../reactions'
import { useSaveMenu } from '../saved/SaveMenu'
import { canEdit } from './editing'
import { pinsApi, usePins } from './PinnedMessages'
import { keepRecalled, type RecalledDraft } from './recalled'
import { markUnreadFrom } from './unreadMark'
import { applyLocal } from './useTimeline'

const LONG_PRESS_MS = 500
const ACTIVE_RECALL: RunStatus[] = [
  'running',
  'queued',
  'awaiting_approval',
  'awaiting_answer',
  'offline_wait',
]
export const STARTED_RECALL: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

export const startedRunIds = (runs: readonly RunDto[], messageId: string) =>
  runs.filter((r) => r.triggerMessageId === messageId && STARTED_RECALL.includes(r.status)).map((r) => r.id)

/** Latest runs of the active timeline (read on recall so active runs trigger confirmation). */
export const ActiveRunsContext = createContext<RefObject<RunDto[]> | null>(null)

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
    threadRootId: m.threadRootId ?? undefined,
    body: m.body,
    quote: m.quote ? { ...m.quote, groupId: m.groupId, threadRootId: m.threadRootId ?? undefined } : null,
    files: read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
  }
}

async function recall(m: MessageDto, getStarted: () => string[]) {
  const before = getStarted()
  const draft = await snapshot(m)
  try {
    await api.post(`/messages/${m.id}/recall`)
  } catch (e) {
    const late = e instanceof ApiError && e.code === 'recall_expired'
    toast({ type: 'error', message: late ? t('超过 24 小时，无法撤回') : (e as Error).message })
    return false
  }
  keepRecalled(m.id, draft)
  applyLocal({ t: 'message.recalled', groupId: m.groupId, messageId: m.id })
  // The server voids only runs that have not started; re-read after snapshot/recall so queued->running transitions are caught too.
  const ids = [...new Set([...before, ...getStarted()])]
  if (ids.length) {
    const results = await Promise.allSettled(ids.map((id) => api.post(`/runs/${id}/stop`, {})))
    if (results.some((r) => r.status === 'rejected'))
      toast({ type: 'error', message: t('消息已撤回，但未能停止正在运行的任务，请手动停止') })
  }
  return true
}

function RecallRunningDialog({
  message,
  bot,
  getStarted,
  onClose,
}: {
  message: MessageDto
  bot: string
  getStarted: () => string[]
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const close = () => {
    if (!busy) onClose()
  }
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    const ok = await recall(message, getStarted)
    if (ok) onClose()
    else setBusy(false)
  }
  return (
    <AlertDialog
      open
      title={t('要撤回这条消息并中断运行吗？')}
      message={t('{bot} 正在根据这条消息执行任务，撤回会立即中断当前运行。', { bot })}
      onClose={close}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('撤回并中断'),
          variant: 'destructive',
          disabled: busy,
          loading: busy,
          onClick: () => void confirm(),
        },
      ]}
    />
  )
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
  const close = () => {
    if (!busy) onClose()
  }
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    if (await hide(message)) onClose()
    else setBusy(false)
  }
  return (
    <AlertDialog
      open
      title={t('要删除这条消息吗？')}
      message={t('删除后仅对你隐藏，其他成员仍可见')}
      onClose={close}
      actions={[
        { label: t('取消'), disabled: busy, onClick: close },
        {
          label: t('删除'),
          variant: 'destructive',
          disabled: busy,
          loading: busy,
          onClick: () => void confirm(),
        },
      ]}
    />
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
  const [recallingBot, setRecallingBot] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmUnpin, setConfirmUnpin] = useState(false)
  const [unpinning, setUnpinning] = useState(false)
  const branching = useRef(false)
  const liveRuns = useContext(ActiveRunsContext)
  const navigate = useNavigate()
  const bar = useRef<HTMLDivElement>(null)
  // Tapping 复制 or opening the menu may clear the selection before the click lands, so it is read first.
  const picked = useRef('')
  const keepSelection = () => {
    picked.current = selectedIn(bar.current?.closest('.pn-msg'))
  }
  const mine = target.own && target.message ? target.message : null
  const recallable = !!mine && Date.now() - Date.parse(mine.createdAt) < RECALL_WINDOW_MS
  const editable = !!mine && !!target.onEdit && canEdit(mine)
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
  const getStarted = () => [
    ...new Set([
      ...(target.startedRuns?.() ?? []),
      ...(mine ? startedRunIds(liveRuns?.current ?? [], mine.id) : []),
    ]),
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
    else if (value === 'branch' && target.message) {
      if (branching.current) return
      branching.current = true
      void branch(target.message, (groupId) => navigate(`/g/${groupId}`)).finally(() => {
        branching.current = false
      })
    } else if (value === 'pin' && target.message)
      void pinsApi.pin(target.message.groupId, target.message.id).then((ok) => {
        if (ok) toast({ type: 'success', message: t('已置顶') })
      })
    else if (value === 'unpin' && target.message) setConfirmUnpin(true)
    else if (value === 'knowledge') setSaving(true)
    else if (value === 'edit') target.onEdit?.()
    else if (value === 'recall' && mine) {
      const started = getStarted()
      const activeRuns = (liveRuns?.current ?? []).filter(
        (r) => r.triggerMessageId === mine.id && ACTIVE_RECALL.includes(r.status),
      )
      if (activeRuns.length || started.length) {
        const allBots = useWorkspace.getState().bots
        const names = [
          ...new Set(activeRuns.map((r) => allBots.find((b) => b.id === r.botId)?.name ?? 'Bot')),
        ]
        setRecallingBot(names.length ? names.join(t('、')) : 'Bot')
      } else {
        void recall(mine, getStarted)
      }
    } else if (value === 'delete') setDeleting(true)
  }
  const dialog = (
    <>
      {later.dialog}
      <Presence>
        {mine && recallingBot ? (
          <RecallRunningDialog
            message={mine}
            bot={recallingBot}
            getStarted={getStarted}
            onClose={() => setRecallingBot(null)}
          />
        ) : null}
      </Presence>
      <Presence>
        {mine && deleting ? <DeleteDialog message={mine} onClose={() => setDeleting(false)} /> : null}
      </Presence>
      <Presence>
        {confirmUnpin && target.message ? (
          <AlertDialog
            open
            title={t('要取消置顶这条消息吗？')}
            message={t('所有群成员顶部将不再看到该置顶，并在群内留下一条记录。')}
            onClose={() => {
              if (!unpinning) setConfirmUnpin(false)
            }}
            actions={[
              { label: t('取消'), disabled: unpinning, onClick: () => setConfirmUnpin(false) },
              {
                label: t('取消置顶'),
                variant: 'destructive',
                disabled: unpinning,
                loading: unpinning,
                onClick: () => {
                  const msg = target.message
                  if (!msg || unpinning) return
                  setUnpinning(true)
                  void pinsApi.unpin(msg.groupId, msg.id).then((ok) => {
                    setUnpinning(false)
                    if (ok) {
                      setConfirmUnpin(false)
                      toast({ type: 'success', message: t('已取消置顶') })
                    }
                  })
                },
              },
            ]}
          />
        ) : null}
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
        portal
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
