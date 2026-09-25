import { type CSSProperties, type ReactNode, useId } from 'react'
import { cx } from '../lib/cx'
import { useControlled } from './controlled'
import { Icon } from './icon'
import './disclosure.css'

/** DisclosureGroup: a triangle title that reveals rarely used content; `summary` shows while collapsed. */
export function Disclosure({
  title,
  summary,
  open,
  defaultOpen = false,
  onToggle,
  variant = 'plain',
  children,
  className,
  style,
}: {
  title: ReactNode
  summary?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onToggle?: (open: boolean) => void
  /** `group` sits in a rounded box next to GroupBox. */
  variant?: 'plain' | 'group'
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const [isOpen, setOpen] = useControlled(open, defaultOpen)
  const id = useId()
  return (
    <div className={cx('ui-disc', variant === 'group' && 'ui-disc--group', className)} style={style}>
      <button
        type="button"
        className="ui-disc__head"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => {
          setOpen(!isOpen)
          onToggle?.(!isOpen)
        }}
      >
        <span className={cx('ui-disclosure', isOpen && 'ui-disclosure--open')}>
          <Icon name="chevron-right" weight={2} />
        </span>
        <span className="ui-disc__title">{title}</span>
        {summary && !isOpen ? <span className="ui-disc__summary">{summary}</span> : null}
      </button>
      {isOpen ? (
        <div id={id} className="ui-disc__body">
          {children}
        </div>
      ) : null}
    </div>
  )
}
