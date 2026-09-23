import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CloseButton } from './controls'

function useEscape(active: boolean, onClose: () => void) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active])
}

interface OverlayProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
}

export function Dialog({
  open,
  title,
  subtitle,
  footer,
  width = 460,
  onClose,
  children,
}: OverlayProps & { subtitle?: ReactNode; footer?: ReactNode; width?: number }) {
  const titleId = useId()
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="ui-overlay">
      <div
        className="ui-overlay__backdrop"
        data-testid="dialog-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-dialog"
        style={{ maxWidth: width }}
      >
        <div className="ui-dialog__header">
          <CloseButton onClick={onClose} />
          <h2 id={titleId} className="ui-dialog__title">
            {title}
          </h2>
          {subtitle ? <span className="ui-dialog__subtitle">{subtitle}</span> : null}
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({
  open,
  title,
  label,
  leading,
  onClose,
  children,
}: OverlayProps & {
  leading?: ReactNode
  /** Fixed accessible name for drawers whose visible title changes with the sub-view. */
  label?: string
}) {
  const titleId = useId()
  useEscape(open, onClose)
  if (!open) return null
  return createPortal(
    <>
      <div className="ui-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        className="ui-drawer"
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
