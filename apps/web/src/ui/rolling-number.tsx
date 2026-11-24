import { type CSSProperties, useLayoutEffect, useRef } from 'react'
import './rolling-number.css'

const SPLIT_RE = /^([^\d]*)(\d[\d.,:]*\d|\d)(.*)$/

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function splitParts(text: string): [prefix: string, numeric: string, suffix: string] {
  const m = SPLIT_RE.exec(text)
  return m ? [m[1]!, m[2]!, m[3]!] : [text, '', '']
}

/**
 * Text whose digits roll to their new value when it changes, like an odometer; prefix and trailing units stay static.
 * Places inside the numeric part are keyed from the right, so 9 → 10 rolls the units and adds a tens column, while
 * unit/magnitude changes like 980 → 1.0k swap cleanly without scrambling keys or rolling.
 */
export function RollingNumber({ value }: { value: string | number }) {
  const text = String(value)
  const [prefix, numeric, suffix] = splitParts(text)
  const prev = useRef<{ suffix: string } | null>(null)
  const isStatic = prev.current === null || prev.current.suffix !== suffix || reducedMotion()
  useLayoutEffect(() => {
    prev.current = { suffix }
  }, [suffix])

  const preChars = [...prefix]
  const numChars = [...numeric]
  const sufChars = [...suffix]

  return (
    <span className="ui-roll" data-static={isStatic ? '' : undefined}>
      <span className="ui-roll__text">{text}</span>
      <span className="ui-roll__face" aria-hidden="true">
        {preChars.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static prefix characters indexed from left
          <span key={`p-${i}`} className="ui-roll__char" data-c={c} />
        ))}
        {numChars.map((c, i) => {
          const place = numChars.length - i
          return /\d/.test(c) ? (
            <span key={`n-${place}`} className="ui-roll__digit" style={{ '--d': c } as CSSProperties} />
          ) : (
            <span key={`n-${place}`} className="ui-roll__char" data-c={c} />
          )
        })}
        {sufChars.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static unit suffix characters indexed from left
          <span key={`s-${i}`} className="ui-roll__char" data-c={c} />
        ))}
      </span>
    </span>
  )
}
