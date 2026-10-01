import { type MessageDto, RECALL_WINDOW_MS } from '@gonggong/protocol'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { copyWithToast } from '../../lib/clipboard'
import { toastError } from '../../lib/errors'
import { Button, ContextMenu, Dialog, Icon, MenuButton, type MenuItem, Presence, toast } from '../../ui'
import { ReactionPicker } from '../reactions'
import { applyLocal } from './useTimeline'
import './recall.css'
import { t } from '../../i18n'

const LONG_PRESS_MS = 500

async function recall(m: MessageDto) {
  try {
    await api.post(`/messages/${m.id}/recall`)
    applyLocal({ t: 'message.recalled', groupId: m.groupId, messageId: m.id })
  } catch (e) {
    const late = e instanceof ApiError && e.code === 'recall_expired'
    toast({ type: 'error', message: late ? t('超过 24 小时，无法撤回') : (e as Error).message })
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

/** Keeps the bar of its message row open after a touch long-press, until the next touch elsewhere. */
function useLongPress(bar: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = bar.current?.closest<HTMLElement>('.pn-msg')
    if (!host) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => clearTimeout(timer)
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      cancel()
      timer = setTimeout(() => {
        host.dataset.actions = 'open'
      }, LONG_PRESS_MS)
    }
    const outside = (e: PointerEvent) => {
      if (!host.contains(e.target as Node)) host.dataset.actions = ''
    }
    host.dataset.actions = ''
    host.addEventListener('pointerdown', down)
    for (const t of ['pointerup', 'pointercancel', 'pointermove'] as const) host.addEventListener(t, cancel)
    document.addEventListener('pointerdown', outside)
    return () => {
      cancel()
      host.removeEventListener('pointerdown', down)
      for (const t of ['pointerup', 'pointercancel', 'pointermove'] as const)
        host.removeEventListener(t, cancel)
      document.removeEventListener('pointerdown', outside)
    }
  }, [bar])
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
}

/**
 * One action set for both the hover bar and the right-click menu (Pane `messageMenuItems` order: reply first,
 * destructive last); the menu is the bar's superset since it also lists what the bar keeps under 更多.
 */
function useMessageMenu(target: ActionTarget) {
  const [picking, setPicking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const mine = target.own && target.message ? target.message : null
  const recallable = !!mine && Date.now() - Date.parse(mine.createdAt) < RECALL_WINDOW_MS
  // Commands are not editable (the server refuses them too).
  const editable = recallable && !!target.onEdit && !!mine?.body && !mine.body.trimStart().startsWith('/')
  const more: MenuItem[] = [
    { value: 'link', label: t('复制链接'), icon: 'link' },
    ...(editable ? [{ value: 'edit', label: t('编辑'), icon: 'textformat' as const }] : []),
    ...(mine && recallable ? [{ value: 'recall', label: t('撤回'), icon: 'undo' as const }] : []),
    ...(mine ? [{ value: 'delete', label: t('删除'), icon: 'trash' as const, destructive: true }] : []),
  ]
  const all: MenuItem[] = [
    ...(target.message ? [{ value: 'react', label: t('表情回应'), icon: 'smile' as const }] : []),
    { value: 'quote', label: t('引用回复'), icon: 'quote' },
    ...(target.copyText !== undefined ? [{ value: 'copy', label: t('复制'), icon: 'copy' as const }] : []),
    { separator: true },
    ...more,
  ]
  const select = (value: string) => {
    if (value === 'react') setPicking(true)
    else if (value === 'quote') target.onQuote()
    else if (value === 'copy' && target.copyText !== undefined)
      void copyWithToast(target.copyText, t('已复制'))
    else if (value === 'link') void copyWithToast(target.link, t('链接已复制'))
    else if (value === 'edit') target.onEdit?.()
    else if (value === 'recall' && mine) void recall(mine)
    else if (value === 'delete') setDeleting(true)
  }
  const dialog = (
    <Presence>
      {mine && deleting ? <DeleteDialog message={mine} onClose={() => setDeleting(false)} /> : null}
    </Presence>
  )
  return { target, picking, setPicking, more, all, select, dialog }
}

type MessageMenuState = ReturnType<typeof useMessageMenu>

/** The Pane glass hover bar; kept visible while its menus are open or after a touch long-press. */
function Bar({ menu }: { menu: MessageMenuState }) {
  const { target } = menu
  const bar = useRef<HTMLDivElement>(null)
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
      <button
        type="button"
        aria-label={t('引用回复')}
        title={target.quoteTitle ?? t('引用回复')}
        onClick={target.onQuote}
      >
        <Icon name="quote" />
      </button>
      {target.copyText !== undefined ? (
        <button type="button" aria-label={t('复制')} title={t('复制')} onClick={() => menu.select('copy')}>
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
    <ContextMenu items={menu.all} onSelect={menu.select}>
      {children(<Bar menu={menu} />)}
      {menu.dialog}
    </ContextMenu>
  )
}
