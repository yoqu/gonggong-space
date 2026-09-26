import type { ReactNode } from 'react'
import './illustrations.css'

function Art({ children }: { children: ReactNode }) {
  return (
    <svg className="ui-art" viewBox="0 0 160 120" aria-hidden="true">
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
          {i === 1 ? (
            <rect className="art-accent-soft" x="30" y={y - 10} width="68" height="20" rx="8" />
          ) : null}
          <circle className={i === 1 ? 'art-accent' : 'art-muted'} cx="42" cy={y} r="7" />
          <rect className="art-muted" x="54" y={y - 5} width={i === 1 ? 36 : 30} height="4" rx="2" />
          <rect className="art-muted" x="54" y={y + 2} width={i === 1 ? 24 : 20} height="4" rx="2" />
        </g>
      ))}
      <circle className="art-ripple" cx="90" cy="62" r="9" />
      <path className="art-pointer" d="M90 62v19l5-4.6 3.6 7.6 3.4-1.6-3.5-7.4h7z" />
      <path
        className="art-accent"
        d="M114 30h26a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8h-18l-8 6v-6a8 8 0 0 1-8-8v-8a8 8 0 0 1 8-8Z"
      />
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
      <path className="art-card" d="M50 86h62a19 19 0 0 0 1.6-37.9A27 27 0 0 0 62.5 42 22 22 0 0 0 50 86Z" />
      <path className="art-stroke-muted" d="M80 86v8m0 8v6" />
      <path className="art-stroke-muted" d="M70 100l-6 4m26-4 6 4" />
      <rect className="art-muted" x="62" y="60" width="36" height="5" rx="2.5" />
      <rect className="art-muted" x="68" y="70" width="24" height="5" rx="2.5" />
      <circle className="art-danger" cx="118" cy="40" r="13" />
      <rect className="art-ink" x="116" y="32" width="4" height="10" rx="2" />
      <circle className="art-ink" cx="118" cy="47" r="2.2" />
      <Sparkle x={28} y={44} s={0.7} />
    </Art>
  )
}

export function NoBotsArt() {
  return (
    <Art>
      <path className="art-stroke-accent" d="M80 22v8" />
      <circle className="art-accent" cx="80" cy="19" r="4" />
      <rect className="art-card" x="46" y="30" width="68" height="56" rx="16" />
      <rect className="art-accent-soft" x="56" y="42" width="48" height="24" rx="10" />
      <rect className="art-accent" x="66" y="49" width="6" height="10" rx="3" />
      <rect className="art-accent" x="88" y="49" width="6" height="10" rx="3" />
      <rect className="art-muted" x="68" y="73" width="24" height="5" rx="2.5" />
      <rect className="art-muted" x="36" y="50" width="8" height="18" rx="4" />
      <rect className="art-muted" x="116" y="50" width="8" height="18" rx="4" />
      <circle className="art-accent" cx="118" cy="90" r="12" />
      <path className="art-stroke-ink" d="M118 84v12m-6-6h12" />
      <Sparkle x={30} y={30} s={0.7} />
      <Sparkle x={140} y={36} />
    </Art>
  )
}

export function NoMembersArt() {
  return (
    <Art>
      <circle className="art-muted" cx="56" cy="46" r="11" />
      <path className="art-muted" d="M34 88a22 22 0 0 1 44 0Z" />
      <circle className="art-card" cx="86" cy="44" r="14" />
      <path className="art-card" d="M58 92a28 28 0 0 1 56 0Z" />
      <circle className="art-accent" cx="118" cy="40" r="12" />
      <path className="art-stroke-ink" d="M118 34v12m-6-6h12" />
      <Sparkle x={28} y={36} s={0.7} />
      <Sparkle x={136} y={84} s={0.8} />
    </Art>
  )
}

export function NoNotificationsArt() {
  return (
    <Art>
      <path className="art-card" d="M80 26a24 24 0 0 0-24 24v18l-8 12h64l-8-12V50a24 24 0 0 0-24-24Z" />
      <path className="art-accent" d="M71 84a9 9 0 0 0 18 0Z" />
      <rect className="art-muted" x="68" y="48" width="24" height="5" rx="2.5" />
      <rect className="art-muted" x="72" y="58" width="16" height="5" rx="2.5" />
      <text className="art-accent-text art-glyph" x="116" y="38">
        z
      </text>
      <text className="art-accent-text art-glyph art-glyph--sm" x="128" y="26">
        z
      </text>
      <Sparkle x={34} y={40} s={0.7} />
      <Sparkle x={130} y={86} s={0.8} />
    </Art>
  )
}

export function NoResultsArt() {
  return (
    <Art>
      <rect className="art-card" x="30" y="22" width="70" height="80" rx="12" />
      <rect className="art-muted" x="42" y="36" width="40" height="5" rx="2.5" />
      <rect className="art-muted" x="42" y="48" width="30" height="5" rx="2.5" />
      <rect className="art-muted" x="42" y="60" width="36" height="5" rx="2.5" />
      <path className="art-stroke-accent art-handle" d="M118 78l16 16" />
      <circle className="art-lens" cx="104" cy="64" r="18" />
      <path className="art-stroke-accent" d="M98 58l12 12m0-12-12 12" />
      <Sparkle x={136} y={30} />
      <Sparkle x={20} y={92} s={0.6} />
    </Art>
  )
}

export function NoDataArt() {
  return (
    <Art>
      <rect className="art-card" x="26" y="24" width="96" height="72" rx="14" />
      <path className="art-stroke-muted" d="M40 82h68" />
      {[46, 62, 78, 94].map((x) => (
        <rect key={x} className="art-muted" x={x} y="74" width="10" height="8" rx="3" />
      ))}
      <path className="art-stroke-accent art-dash" d="M40 60h68" />
      <rect className="art-muted" x="40" y="36" width="30" height="5" rx="2.5" />
      <circle className="art-accent" cx="122" cy="30" r="12" />
      <rect className="art-ink" x="116" y="28.5" width="12" height="3" rx="1.5" />
      <Sparkle x={20} y={50} s={0.7} />
      <Sparkle x={140} y={90} s={0.8} />
    </Art>
  )
}

export function NoMachinesArt() {
  return (
    <Art>
      <rect className="art-card" x="36" y="24" width="88" height="58" rx="10" />
      <rect className="art-muted" x="44" y="32" width="72" height="42" rx="5" />
      <text className="art-accent-text art-glyph" x="50" y="54">
        {'>_'}
      </text>
      <path className="art-card" d="M28 88h104l-6 10H34Z" />
      <circle className="art-accent" cx="122" cy="28" r="10" />
      <path className="art-stroke-ink art-thin" d="M118 24l8 8m0-8-8 8" />
      <Sparkle x={22} y={40} s={0.7} />
      <Sparkle x={142} y={70} s={0.8} />
    </Art>
  )
}

export function NoGroupsArt() {
  return (
    <Art>
      <rect className="art-card" x="22" y="30" width="72" height="44" rx="14" />
      <rect className="art-muted" x="34" y="42" width="40" height="6" rx="3" />
      <rect className="art-muted" x="34" y="54" width="26" height="6" rx="3" />
      <path
        className="art-accent-soft"
        d="M76 58h54a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H96l-10 8v-8h-10a10 10 0 0 1-10-10V68a10 10 0 0 1 10-10Z"
      />
      {[92, 104, 116].map((x, i) => (
        <circle key={x} className={i === 1 ? 'art-accent' : 'art-muted'} cx={x} cy="76" r="5" />
      ))}
      <circle className="art-accent" cx="116" cy="30" r="12" />
      <text className="art-ink art-glyph" x="116" y="34.5" textAnchor="middle">
        #
      </text>
      <Sparkle x={24} y={94} s={0.7} />
    </Art>
  )
}

export function NoChangesArt() {
  return (
    <Art>
      <rect className="art-card" x="30" y="20" width="76" height="84" rx="12" />
      {[36, 48, 60, 72, 84].map((y, i) => (
        <g key={y}>
          <rect className="art-muted" x="40" y={y} width="8" height="5" rx="2.5" />
          <rect className="art-muted" x="54" y={y} width={[38, 28, 42, 22, 34][i]} height="5" rx="2.5" />
        </g>
      ))}
      <circle className="art-accent" cx="112" cy="84" r="16" />
      <path className="art-stroke-ink" d="M105 84l5 5 9-10" />
      <Sparkle x={130} y={36} />
      <Sparkle x={20} y={60} s={0.6} />
    </Art>
  )
}

export function ComingSoonArt() {
  return (
    <Art>
      <rect className="art-card" x="26" y="30" width="80" height="64" rx="14" />
      <rect className="art-muted" x="38" y="44" width="44" height="6" rx="3" />
      <rect className="art-muted" x="38" y="56" width="56" height="5" rx="2.5" />
      <rect className="art-accent-soft" x="38" y="70" width="32" height="12" rx="6" />
      <circle className="art-accent" cx="112" cy="40" r="20" />
      <path className="art-stroke-ink" d="M112 30v10l7 5" />
      <Sparkle x={140} y={78} />
      <Sparkle x={18} y={50} s={0.6} />
    </Art>
  )
}

export function UnsupportedArt() {
  return (
    <Art>
      <rect className="art-card" x="22" y="42" width="44" height="36" rx="10" />
      <rect className="art-muted" x="32" y="54" width="4" height="12" rx="2" />
      <rect className="art-muted" x="52" y="54" width="4" height="12" rx="2" />
      <path className="art-stroke-muted art-dash" d="M68 60h18" />
      <path className="art-stroke-accent" d="M88 52h-8m8 16h-8" />
      <rect className="art-accent" x="88" y="42" width="30" height="36" rx="10" />
      <path className="art-stroke-accent" d="M118 60h10a8 8 0 0 1 8 8v24" />
      <rect className="art-ink" x="96" y="56" width="14" height="4" rx="2" />
      <Sparkle x={36} y={28} s={0.7} />
      <Sparkle x={138} y={34} />
    </Art>
  )
}
