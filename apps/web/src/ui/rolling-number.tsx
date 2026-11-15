import type { CSSProperties } from 'react'
import './rolling-number.css'

/**
 * Text whose digits roll to their new value when it changes, like an odometer; other characters swap in place.
 * The face is drawn by CSS and hidden from assistive tech; the real text stays in one (visually hidden) node.
 * Places are keyed from the right, so 9 → 10 rolls the units and adds a tens column.
 */
export function RollingNumber({ value }: { value: string | number }) {
  const text = String(value)
  const chars = [...text]
  return (
    <span className="ui-roll">
      <span className="ui-roll__text">{text}</span>
      <span className="ui-roll__face" aria-hidden="true">
        {chars.map((c, i) => {
          const place = chars.length - i
          return /\d/.test(c) ? (
            <span key={place} className="ui-roll__digit" style={{ '--d': c } as CSSProperties} />
          ) : (
            <span key={place} className="ui-roll__char" data-c={c} />
          )
        })}
      </span>
    </span>
  )
}
