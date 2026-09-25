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
import { Button, type ButtonVariant, Checkbox, CloseButton } from './controls'
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

/** Calls `onOutside` for a mouse press outside every given element while `enabled`. */
export function useOutsidePress(
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
  enabled: boolean,
) {
  const cb = useRef(onOutside)
  cb.current = onOutside
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable ref objects
  useEffect(() => {
    if (!enabled) return
    const down = (e: MouseEvent) => {
      if (!refs.some((r) => r.current?.contains(e.target as Node))) cb.current()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [enabled])
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
const FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)'

/**
 * While `open`: focuses `[data-autofocus]`, else the first field, else the container; keeps Tab inside;
 * refocuses the element that had focus before opening once it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  const trigger = useRef<Element | null>(null)
  if (open && !trigger.current) trigger.current = document.activeElement
  useEffect(() => {
    const node = ref.current
    if (!open || !node) return
    if (!node.contains(document.activeElement))
      (
        node.querySelector<HTMLElement>('[data-autofocus]') ??
        node.querySelector<HTMLElement>(FIELD) ??
        node
      ).focus()
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

/** Modal layer shared by Dialog, AlertDialog and Sheet: scrim, Escape, focus trap, enter/exit motion. */
function Modal({
  open,
  onClose,
  closeOnScrim,
  trapFocus = true,
  layer = 'ui-overlay',
  portal = true,
  panel,
}: {
  open: boolean
  onClose: () => void
  closeOnScrim: boolean
  trapFocus?: boolean
  layer?: string
  portal?: boolean
  panel: (p: PanelProps) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = useContext(PresenceOpen)
  const visible = open && shown
  const presence = usePresence(visible)
  useEscape(onClose, visible)
  useFocusTrap(ref, visible && trapFocus)
  if (!presence.mounted) return null
  const node = (
    <div className={layer} data-state={presence.state}>
      <div
        className="ui-scrim"
        data-testid="dialog-overlay"
        onClick={closeOnScrim ? onClose : undefined}
        aria-hidden="true"
      />
      {panel({ ref, onAnimationEnd: presence.onAnimationEnd })}
    </div>
  )
  return portal ? createPortal(node, document.body) : node
}

export interface ModalAction {
  label: ReactNode
  variant?: ButtonVariant
  onClick?: () => void
  disabled?: boolean
  /** Receives focus on open; never set it on a destructive action. */
  autoFocus?: boolean
}

export interface SheetProps {
  open: boolean
  /** Escape and 「取消」 should both call this. */
  onClose?: () => void
  title?: ReactNode
  /** One sentence under the title. */
  message?: ReactNode
  children?: ReactNode
  /** Left to right, the primary one last: 「取消」「创建」. */
  actions?: ModalAction[]
  /** Secondary content at the bottom left, e.g. 「了解更多…」. */
  footer?: ReactNode
  width?: number | string
  closeOnScrim?: boolean
  /** False only for static demos. */
  trapFocus?: boolean
  'aria-label'?: string
}

const noop = () => {}

/** Title, message, content and action row shared by Sheet and Dialog; `onClose` adds a header close button. */
function ModalBody({
  titleId,
  title,
  message,
  children,
  actions,
  footer,
  onClose,
}: Omit<SheetProps, 'open'> & { titleId: string }) {
  return (
    <>
      {title || message || onClose ? (
        <div className="ui-dialog__header">
          <div className="ui-dialog__titles">
            {title ? (
              <h2 id={titleId} className="ui-dialog__title">
                {title}
              </h2>
            ) : null}
            {message ? <p className="ui-dialog__message">{message}</p> : null}
          </div>
          {onClose ? <CloseButton onClick={onClose} /> : null}
        </div>
      ) : null}
      {children != null ? <div className="ui-dialog__body">{children}</div> : null}
      {actions?.length ? (
        <div className="ui-dialog__actions">
          {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
          {actions.map((a, i) => (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed, ordered list
              key={i}
              variant={a.variant}
              disabled={a.disabled}
              onClick={a.onClick}
              data-autofocus={a.autoFocus || undefined}
              className="ui-dialog__action"
            >
              {a.label}
            </Button>
          ))}
        </div>
      ) : footer ? (
        <div className="ui-dialog__actions">{footer}</div>
      ) : null}
    </>
  )
}

/**
 * Pane Sheet: window-modal panel dropping from under the toolbar of the nearest positioned ancestor
 * (a `Window` or `AppFrame`), for a small set of inputs to confirm. The scrim does not close it by default.
 */
export function Sheet({
  open,
  onClose = noop,
  width = 480,
  closeOnScrim = false,
  trapFocus,
  ...props
}: SheetProps) {
  const titleId = useId()
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnScrim={closeOnScrim}
      trapFocus={trapFocus}
      layer="ui-sheet-layer"
      portal={false}
      panel={({ ref, onAnimationEnd }) => (
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={props.title ? titleId : undefined}
          aria-label={props.title ? undefined : props['aria-label']}
          tabIndex={-1}
          className="ui-dialog ui-sheet"
          style={{ width }}
          onAnimationEnd={onAnimationEnd}
        >
          <ModalBody titleId={titleId} {...props} />
        </div>
      )}
    />
  )
}

export interface DialogProps extends Omit<SheetProps, 'onClose'> {
  onClose: () => void
  /** No panel: only scrim, centering and focus management, e.g. around an `AlertPanel`. */
  bare?: boolean
  /** Confined to the nearest positioned ancestor instead of the viewport (demos). */
  contained?: boolean
  role?: 'dialog' | 'alertdialog'
  /** Pre-Pane name of `message`. */
  subtitle?: ReactNode
  /** Pre-Pane name of `closeOnScrim`; set false on form dialogs so a stray click doesn't discard input. */
  closeOnBackdrop?: boolean
}

/**
 * Page-modal dialog (Pane Dialog), for pages without a window to hold a Sheet. Without `actions` it keeps the
 * pre-Pane layout: a close button in the header and `footer` as the button row.
 */
export function Dialog({
  open,
  onClose,
  bare,
  contained,
  role = 'dialog',
  subtitle,
  closeOnBackdrop,
  closeOnScrim = closeOnBackdrop ?? true,
  trapFocus,
  width = 460,
  message = subtitle,
  children,
  ...props
}: DialogProps) {
  const titleId = useId()
  const labelled = props.title != null && !bare
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnScrim={closeOnScrim}
      trapFocus={trapFocus}
      layer={cx('ui-overlay', contained && 'ui-overlay--contained')}
      portal={!contained}
      panel={({ ref, onAnimationEnd }) => (
        // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is dialog or alertdialog, both modal roles
        <div
          ref={ref}
          role={role}
          aria-modal="true"
          aria-labelledby={labelled ? titleId : undefined}
          aria-label={labelled ? undefined : props['aria-label']}
          tabIndex={-1}
          className={cx('ui-dialog', bare && 'ui-dialog--bare')}
          style={bare ? undefined : { maxWidth: width }}
          onAnimationEnd={onAnimationEnd}
        >
          {bare ? (
            children
          ) : (
            <ModalBody
              titleId={titleId}
              message={message}
              onClose={props.actions?.length ? undefined : onClose}
              {...props}
            >
              {children}
            </ModalBody>
          )}
        </div>
      )}
    />
  )
}

export interface AlertAction {
  label: ReactNode
  variant?: 'default' | 'primary' | 'destructive'
  disabled?: boolean
  /** Receives the suppression checkbox state (false without one). */
  onClick?: (suppressed: boolean) => void
}

export interface AlertPanelProps {
  /** A question naming the consequence (Pane Alert). */
  title: ReactNode
  message?: ReactNode
  /** Extra content under the message, e.g. a `ui-consequences` list; widens the panel. */
  detail?: ReactNode
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
  detail,
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
      {detail ? <div className="ui-alert__detail">{detail}</div> : null}
      {suppression ? (
        <div className="ui-alert__suppress">
          <Checkbox checked={suppressed} onChange={setSuppressed} label={suppression} />
        </div>
      ) : null}
      <div className={cx('ui-alert__actions', actions.length > 2 && 'ui-alert__actions--stack')}>
        {actions.map((a, i) => (
          <Button
            // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed, ordered list
            key={i}
            size="large"
            variant={a.variant ?? 'default'}
            disabled={a.disabled}
            onClick={() => a.onClick?.(suppressed)}
          >
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
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      className={cx('ui-alert-panel', props.detail != null && 'ui-alert-panel--wide')}
    >
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
      closeOnScrim={false}
      panel={({ ref, onAnimationEnd }) => (
        <div
          ref={ref}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cx(
            'ui-alert-panel ui-alert-panel--modal',
            props.detail != null && 'ui-alert-panel--wide',
          )}
          onAnimationEnd={onAnimationEnd}
        >
          <AlertContent titleId={titleId} {...props} />
        </div>
      )}
    />
  )
}

/** Glass side panel over the page (pre-Pane; new pages dock an `AppFrame` inspector instead). */
export function Drawer({
  open,
  title,
  label,
  leading,
  onClose,
  closeOnBackdrop = true,
  children,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  closeOnBackdrop?: boolean
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
