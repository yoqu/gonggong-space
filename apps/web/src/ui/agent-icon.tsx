import { AGENT_META, type AgentKind } from '@gonggong/protocol'
import { cx } from '../lib/cx'
import './agent-icon.css'

/** Relative luminance of a #rrggbb hex color (0–255); marks below 50 blend into dark surfaces. */
function isDarkColor(hex: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return false
  const [r, g, b] = [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
  return 0.299 * r + 0.587 * g + 0.114 * b < 50
}

/** An agent's official mark in white on its brand gradient; the colours are the brand's, the same in dark mode. */
export function AgentIcon({
  kind,
  size = 20,
  className,
}: {
  kind: AgentKind
  size?: number
  className?: string
}) {
  const m = AGENT_META[kind]
  const dark = isDarkColor(m.color.to)
  return (
    <span
      role="img"
      aria-label={m.name}
      data-dark={dark ? 'true' : undefined}
      className={cx('ui-agent-icon', className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: `linear-gradient(135deg, ${m.color.from}, ${m.color.to})`,
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} aria-hidden="true">
        {m.mark.map((d) => (
          <path key={d} d={d} fill="#fff" fillRule="evenodd" />
        ))}
      </svg>
    </span>
  )
}
