import { type MessageDto, RECALL_WINDOW_MS } from '@gonggong/protocol'
import { Copy, Ellipsis, Link, PanelRightOpen, Quote, Trash2, Undo2 } from 'lucide-react'
import { type RefObject, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { Button, Dialog, Presence, toast, useEscape, usePresence } from '../../ui'
import { ReactionPicker } from '../reactions'
import { applyWithdrawn } from './useTimeline'
import './recall.css'

const LONG_PRESS_MS = 500

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast({ type: 'success', message: done })
  } catch {
    toast({ type: 'error', message: '复制失败' })
  }
}

async function recall(m: MessageDto) {
  try {
    await api.post(`/messages/${m.id}/recall`)
    applyWithdrawn({ t: 'message.recalled', groupId: m.groupId, messageId: m.id })
  } catch (e) {
    const late = e instanceof ApiError && e.code === 'recall_expired'
    toast({ type: 'error', message: late ? '超过 24 小时，无法撤回' : (e as Error).message })
  }
}

async function hide(m: MessageDto) {
  try {
    await api.post(`/messages/${m.id}/hide`)
    applyWithdrawn({ t: 'message.hidden', groupId: m.groupId, messageId: m.id })
    return true
  } catch (e) {
    toast({ type: 'error', message: (e as Error).message })
    return false
  }
}

function DeleteDialog({ message, onClose }: { message: MessageDto; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open
      title="删除消息"
      width={400}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              if (await hide(message)) onClose()
              else setBusy(false)
            }}
          >
            删除
          </Button>
        </>
      }
    >
      <p className="msg-delete-note">删除后仅对你隐藏，其他成员仍可见</p>
    </Dialog>
  )
}

/** Keeps the bar of its parent open after a touch long-press, until the next touch elsewhere. */
function useLongPress(bar: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = bar.current?.parentElement
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

/**
 * Feishu-style hover bar at the top-right of its parent (which must be `position: relative`); shown on hover,
 * keyboard focus inside the parent, or a touch long-press.
 */
export function MessageActions({
  message,
  link,
  quoteTitle,
  onQuote,
  copyText,
  onProcess,
  own = false,
}: {
  /** The message the actions act on; null for a run card without its reply yet (no reactions). */
  message: MessageDto | null
  link: string
  quoteTitle?: string
  onQuote: () => void
  copyText?: string
  /** Run cards only. */
  onProcess?: () => void
  /** My own user message: 撤回 (within the window) and 删除. */
  own?: boolean
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const mine = own && message ? message : null
  const recallable = !!mine && Date.now() - Date.parse(mine.createdAt) < RECALL_WINDOW_MS
  const [picking, setPicking] = useState(false)
  const menu = usePresence(more)
  useLongPress(bar)
  useEscape(() => setMore(false), more)
  useEffect(() => {
    if (!more) return
    const outside = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setMore(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [more])

  return (
    <div
      ref={bar}
      className="msg-actions"
      role="toolbar"
      aria-label="消息操作"
      data-message-id={message?.id}
      data-open={more || picking || undefined}
    >
      {message ? <ReactionPicker message={message} onOpenChange={setPicking} /> : null}
      <button
        type="button"
        className="msg-actions__btn"
        aria-label="引用回复"
        title={quoteTitle ?? '引用回复'}
        onClick={onQuote}
      >
        <Quote size={14} />
      </button>
      {copyText !== undefined ? (
        <button
          type="button"
          className="msg-actions__btn"
          aria-label="复制"
          title="复制"
          onClick={() => void copy(copyText, '已复制')}
        >
          <Copy size={14} />
        </button>
      ) : null}
      {onProcess ? (
        <button
          type="button"
          className="msg-actions__btn"
          aria-label="查看过程"
          title="查看过程"
          onClick={onProcess}
        >
          <PanelRightOpen size={14} />
        </button>
      ) : null}
      <button
        type="button"
        className="msg-actions__btn"
        aria-label="更多"
        title="更多"
        aria-haspopup="menu"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        <Ellipsis size={14} />
      </button>
      {menu.mounted ? (
        <div
          className="msg-actions__menu ui-popover"
          role="menu"
          data-state={menu.state}
          onAnimationEnd={menu.onAnimationEnd}
        >
          <button
            type="button"
            role="menuitem"
            className="msg-actions__item"
            onClick={() => {
              setMore(false)
              void copy(link, '链接已复制')
            }}
          >
            <Link size={13} />
            复制链接
          </button>
          {mine && recallable ? (
            <button
              type="button"
              role="menuitem"
              className="msg-actions__item"
              onClick={() => {
                setMore(false)
                void recall(mine)
              }}
            >
              <Undo2 size={13} />
              撤回
            </button>
          ) : null}
          {mine ? (
            <button
              type="button"
              role="menuitem"
              className="msg-actions__item"
              onClick={() => {
                setMore(false)
                setDeleting(true)
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          ) : null}
        </div>
      ) : null}
      <Presence>
        {mine && deleting ? <DeleteDialog message={mine} onClose={() => setDeleting(false)} /> : null}
      </Presence>
    </div>
  )
}
