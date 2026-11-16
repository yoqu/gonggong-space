import { AGENT_META, type AgentKind } from '@gonggong/protocol'
import { cx } from '../lib/cx'
import './agent-icon.css'

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
  return (
    <span
      role="img"
      aria-label={m.name}
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
          <path key={d} d={d} fill="#fff" />
        ))}
      </svg>
    </span>
  )
}
