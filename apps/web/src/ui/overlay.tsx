import {
  type AnimationEvent,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'
import { Button, Checkbox, CloseButton } from './controls'
import { usePresence } from './presence'
import './overlay.css'

/** Open overlays; Escape only reaches the one opened last (highest `seq`, taken at render so parents precede children). */
const escapeStack: { seq: number; close: () => void }[] = []
let nextSeq = 0

function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return
  const top = escapeStack.reduce<(typeof escapeStack)[number] | undefined>(
    (a, b) => (a && a.seq > b.seq ? a : b),
    undefined,
  )
  if (!top) return
  e.preventDefault()
  top.close()
}

/** Registers `onClose` on the shared Escape stack while `enabled`. */
export function useEscape(onClose: () => void, enabled = true) {
  const ref = useRef(onClose)
  ref.current = onClose
  const seq = useRef<number | null>(null)
  if (!enabled) seq.current = null
  else if (seq.current === null) seq.current = nextSeq++
  useEffect(() => {
    if (!enabled) return
    const entry = { seq: seq.current ?? nextSeq++, close: () => ref.current() }
    escapeStack.push(entry)
    if (escapeStack.length === 1) document.addEventListener('keydown', onEscape)
    return () => {
      escapeStack.splice(escapeStack.indexOf(entry), 1)
      if (!escapeStack.length) document.removeEventListener('keydown', onEscape)
    }
  }, [enabled])
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
const FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)'

/** Focuses the first field (or the container), keeps Tab inside, and refocuses the trigger on close. */
function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  const trigger = useRef<Element | null>(null)
  if (open && !trigger.current) trigger.current = document.activeElement
  useEffect(() => {
    const node = ref.current
    if (!open || !node) return
    if (!node.contains(document.activeElement)) (node.querySelector<HTMLElement>(FIELD) ?? node).focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items.at(-1)
      const at = document.activeElement
      if (!first || !last) e.preventDefault()
      else if (e.shiftKey && (at === first || at === node)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      const el = trigger.current
      trigger.current = null
      if (el instanceof HTMLElement && el.isConnected) el.focus()
    }
  }, [open, ref])
}

const PresenceOpen = createContext(true)

/**
 * Wraps a conditionally rendered overlay (`{cond ? <XDialog open … /> : null}`) so that, when the
 * condition clears, the last element stays mounted as closed and can play its exit animation.
 */
export function Presence({ children }: { children: ReactNode }) {
  const shown = children != null && children !== false
  const last = useRef(children)
  if (shown) last.current = children
  const { mounted } = usePresence(shown)
  return mounted ? <PresenceOpen.Provider value={shown}>{last.current}</PresenceOpen.Provider> : null
}

interface PanelProps {
  ref: RefObject<HTMLDivElement | null>
  onAnimationEnd: (e: AnimationEvent) => void
}

/** Centered modal shared by Dialog and AlertDialog: scrim, Escape, focus trap, enter/exit motion. */
function Modal({
  open,
  onClose,
  closeOnBackdrop,
  panel,
}: {
  open: boolean
  onClose: () => void
  closeOnBackdrop: boolean
  panel: (p: PanelProps) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = useContext(PresenceOpen)
  const visible = open && shown
  const presence = usePresence(visible)
  useEscape(onClose, visible)
  useFocusTrap(ref, visible)
  if (!presence.mounted) return null
  return createPortal(
    <div className="ui-overlay" data-state={presence.state}>
      <div
        className="ui-overlay__backdrop"
        data-testid="dialog-overlay"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      {panel({ ref, onAnimationEnd: presence.onAnimationEnd })}
    </div>,
    document.body,
  )
}

interface OverlayProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** Set false on form dialogs so a stray backdrop click doesn't discard input. */
  closeOnBackdrop?: boolean
}

export function Dialog({
  open,
  title,
  subtitle,
  footer,
  width = 460,
  onClose,
  closeOnBackdrop = true,
  children,
}: OverlayProps & { subtitle?: ReactNode; footer?: ReactNode; width?: number }) {
  const titleId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={closeOnBackdrop}
      panel={({ ref, onAnimationEnd }) => (
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="ui-dialog"
          style={{ maxWidth: width }}
          onAnimationEnd={onAnimationEnd}
        >
          <div className="ui-dialog__header">
            <div className="ui-dialog__titles">
              <h2 id={titleId} className="ui-dialog__title">
                {title}
              </h2>
              {subtitle ? <span className="ui-dialog__subtitle">{subtitle}</span> : null}
            </div>
            <CloseButton onClick={onClose} />
          </div>
          <div className="ui-dialog__body">{children}</div>
          {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
        </div>
      )}
    />
  )
}

export interface AlertAction {
  label: ReactNode
  variant?: 'default' | 'primary' | 'destructive'
  /** Receives the suppression checkbox state (false without one). */
  onClick?: (suppressed: boolean) => void
}

export interface AlertPanelProps {
  /** A question naming the consequence (Pane Alert). */
  title: ReactNode
  message?: ReactNode
  /** 48px image, usually the app icon. */
  icon?: ReactNode
  /** Label of a 「不再询问」 checkbox. */
  suppression?: ReactNode
  actions: AlertAction[]
}

function AlertContent({
  titleId,
  title,
  message,
  icon,
  suppression,
  actions,
}: AlertPanelProps & { titleId: string }) {
  const [suppressed, setSuppressed] = useState(false)
  return (
    <>
      {icon ? <div className="ui-alert__icon">{icon}</div> : null}
      <h2 id={titleId} className="ui-alert__title">
        {title}
      </h2>
      {message ? <p className="ui-alert__message">{message}</p> : null}
      {suppression ? (
        <div className="ui-alert__suppress">
          <Checkbox checked={suppressed} onChange={setSuppressed} label={suppression} />
        </div>
      ) : null}
      <div className={cx('ui-alert__actions', actions.length > 2 && 'ui-alert__actions--stack')}>
        {actions.map((a, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed, ordered list
          <Button key={i} variant={a.variant ?? 'default'} onClick={() => a.onClick?.(suppressed)}>
            {a.label}
          </Button>
        ))}
      </div>
    </>
  )
}

/** Pane Alert as a static panel (the gallery shows it in place; apps use AlertDialog). */
export function AlertPanel(props: AlertPanelProps) {
  const titleId = useId()
  return (
    <div role="alertdialog" aria-labelledby={titleId} className="ui-alert-panel">
      <AlertContent titleId={titleId} {...props} />
    </div>
  )
}

/** Modal Pane Alert: two actions side by side at equal width, three or more stacked. Escape calls `onClose`. */
export function AlertDialog({
  open,
  onClose,
  ...props
}: AlertPanelProps & { open: boolean; onClose: () => void }) {
  const titleId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      panel={({ ref, onAnimationEnd }) => (
        <div
          ref={ref}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="ui-alert-panel ui-alert-panel--modal"
          onAnimationEnd={onAnimationEnd}
        >
          <AlertContent titleId={titleId} {...props} />
        </div>
      )}
    />
  )
}

export function Drawer({
  open,
  title,
  label,
  leading,
  onClose,
  closeOnBackdrop = true,
  children,
}: OverlayProps & {
  leading?: ReactNode
  /** Fixed accessible name for drawers whose visible title changes with the sub-view. */
  label?: string
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const shown = useContext(PresenceOpen)
  const visible = open && shown
  const presence = usePresence(visible)
  useEscape(onClose, visible)
  useFocusTrap(ref, visible)
  if (!presence.mounted) return null
  return createPortal(
    <>
      <div
        className="ui-drawer-overlay"
        data-state={presence.state}
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        tabIndex={-1}
        className="ui-drawer"
        data-state={presence.state}
        onAnimationEnd={presence.onAnimationEnd}
      >
        <div className="ui-drawer__header">
          {leading}
          <h2 id={titleId} className="ui-drawer__title">
            {title}
          </h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="ui-drawer__body">{children}</div>
      </div>
    </>,
    document.body,
  )
}
