import type { ReactNode } from 'react'


function Art({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true">
      <ellipse className="art-wash" cx="80" cy="62" rx="66" ry="52" />
      {children}
    </svg>
  )
}

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      className="art-accent-soft"
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-7C.8-2 2-.8 7 0 2 .8.8 2 0 7-.8 2-2 .8-7 0-2-.8-.8-2 0-7Z"
    />
  )
}

export function EmptyChatArt() {
  return (
    <Art>
      <rect className="art-card" x="26" y="28" width="92" height="68" rx="14" />
      <rect className="art-muted" x="38" y="42" width="46" height="12" rx="6" />
      <rect className="art-accent-soft" x="60" y="60" width="46" height="12" rx="6" />
      <rect className="art-muted" x="38" y="78" width="28" height="8" rx="4" />
      <path className="art-stroke-accent" d="M120 16v6" />
      <circle className="art-accent" cx="120" cy="14" r="3" />
      <rect className="art-accent" x="104" y="22" width="32" height="26" rx="10" />
      <rect className="art-ink" x="112" y="31" width="4" height="7" rx="2" />
      <rect className="art-ink" x="124" y="31" width="4" height="7" rx="2" />
      <circle className="art-accent" cx="30" cy="92" r="12" />
      <text className="art-ink art-glyph" x="30" y="96.5" textAnchor="middle">
        @
      </text>
      <Sparkle x={142} y={70} />
      <Sparkle x={16} y={40} s={0.6} />
    </Art>
  )
}

export function PickChatArt() {
  return (
    <Art>
      <rect className="art-card" x="24" y="18" width="80" height="86" rx="14" />
      {[38, 61, 84].map((y, i) => (
        <g key={y}>
          {i === 1 ? <rect className="art-accent-soft" x="30" y={y - 10} width="68" height="20" rx="8" /> : null}
          <circle className={i === 1 ? 'art-accent' : 'art-muted'} cx="42" cy={y} r="7" />
          <rect className="art-muted" x="54" y={y - 5} width={i === 1 ? 36 : 30} height="4" rx="2" />
          <rect className="art-muted" x="54" y={y + 2} width={i === 1 ? 24 : 20} height="4" rx="2" />
        </g>
      ))}
      <circle className="art-ripple" cx="90" cy="62" r="9" />
      <path
        className="art-pointer"
        d="M90 62v19l5-4.6 3.6 7.6 3.4-1.6-3.5-7.4h7z"
      />
      <path className="art-accent" d="M114 30h26a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8h-18l-8 6v-6a8 8 0 0 1-8-8v-8a8 8 0 0 1 8-8Z" />
      {[122, 130, 138].map((x) => (
        <circle key={x} className="art-ink" cx={x - 3} cy="42" r="2" />
      ))}
      <Sparkle x={134} y={82} s={0.8} />
    </Art>
  )
}

export function DeniedArt() {
  return (
    <Art>
      <rect className="art-card" x="26" y="24" width="84" height="70" rx="14" />
      {[50, 64, 78].map((x) => (
        <circle key={x} className="art-muted art-cutout" cx={x} cy="46" r="10" />
      ))}
      <rect className="art-muted" x="40" y="66" width="56" height="5" rx="2.5" />
      <rect className="art-muted" x="40" y="77" width="36" height="5" rx="2.5" />
      <path className="art-stroke-accent art-shackle" d="M110 70v-8a12 12 0 0 1 24 0v8" />
      <rect className="art-accent" x="100" y="66" width="44" height="34" rx="10" />
      <circle className="art-ink" cx="122" cy="80" r="4.5" />
      <rect className="art-ink" x="120" y="82" width="4" height="9" rx="2" />
      <Sparkle x={20} y={100} s={0.7} />
    </Art>
  )
}

export function FailedArt() {
  return (
    <Art>
      <path
        className="art-card"
        d="M50 86h62a19 19 0 0 0 1.6-37.9A27 27 0 0 0 62.5 42 22 22 0 0 0 50 86Z"
      />
      <path className="art-stroke-muted" d="M80 86v8m0 8v6" />
      <path className="art-stroke-muted" d="M70 100l-6 4m26-4 6 4" />
      <rect className="art-muted" x="62" y="60" width="36" height="5" rx="2.5" />
      <rect className="art-muted" x="68" y="70" width="24" height="5" rx="2.5" />
      <circle className="art-warn" cx="118" cy="40" r="13" />
      <rect className="art-ink" x="116" y="32" width="4" height="10" rx="2" />
      <circle className="art-ink" cx="118" cy="47" r="2.2" />
      <Sparkle x={28} y={44} s={0.7} />
    </Art>
  )
}
