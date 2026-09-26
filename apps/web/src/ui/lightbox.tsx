import { type ReactNode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/cx'
import { CloseButton } from './controls'
import { useEscape, useFocusTrap } from './overlay'
import './lightbox.css'

/** Full-window image viewer: fits the window, click the image for its natural size; Escape or the scrim closes. */
export function Lightbox({
  src,
  alt,
  onClose,
  actions,
}: {
  src: string
  alt: string
  onClose: () => void
  /** Extra toolbar items left of the close button, e.g. 下载. */
  actions?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [zoomed, setZoomed] = useState(false)
  useEscape(onClose)
  useFocusTrap(ref, true)
  return createPortal(
    <div ref={ref} className="ui-lightbox" role="dialog" aria-modal="true" aria-label={alt} tabIndex={-1}>
      <div className="ui-lightbox__scrim" onClick={onClose} aria-hidden="true" />
      <div className="ui-lightbox__bar">
        <span className="ui-lightbox__title">{alt}</span>
        {actions}
        <CloseButton onClick={onClose} />
      </div>
      <div className={cx('ui-lightbox__stage', zoomed && 'ui-lightbox__stage--zoomed')}>
        <button
          type="button"
          className="ui-lightbox__img"
          aria-label={zoomed ? '缩小' : '放大'}
          onClick={() => setZoomed((z) => !z)}
        >
          <img src={src} alt={alt} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
