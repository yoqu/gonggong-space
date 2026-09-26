import type { ReactNode } from 'react'
import { Mascot, type MascotAction } from './mascot'
import './illustrations.css'

function Sparkle({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <path
      className="art-accent-soft"
      transform={`translate(${x} ${y}) scale(${s})`}
      d="M0-7C.8-2 2-.8 7 0 2 .8.8 2 0 7-.8 2-2 .8-7 0-2-.8-.8-2 0-7Z"
    />
  )
}

/** Every empty state is 共字君 on the left acting out the situation, next to one prop on the right. */
function Scene({ action, children }: { action: MascotAction; children: ReactNode }) {
  return (
    <svg className="ui-art" viewBox="0 0 160 120" aria-hidden="true">
      <ellipse className="art-wash" cx="80" cy="62" rx="66" ry="52" />
      {children}
      <g transform="translate(-2 14)">
        <Mascot action={action} size={96} />
      </g>
    </svg>
  )
}

export function EmptyChatArt() {
  return (
    <Scene action="wave">
      <rect className="art-card" x="94" y="44" width="54" height="40" rx="12" />
      <rect className="art-muted" x="104" y="56" width="28" height="6" rx="3" />
      <rect className="art-accent-soft" x="104" y="68" width="34" height="6" rx="3" />
      <circle className="art-accent" cx="144" cy="42" r="10" />
      <text className="art-ink art-glyph" x="144" y="46.5" textAnchor="middle">
        @
      </text>
    </Scene>
  )
}

export function PickChatArt() {
  return (
    <Scene action="think">
      <rect className="art-card" x="96" y="38" width="52" height="62" rx="12" />
      {[52, 69, 86].map((y, i) => (
        <g key={y}>
          {i === 1 ? (
            <rect className="art-accent-soft" x="100" y={y - 7} width="44" height="14" rx="6" />
          ) : null}
          <circle className={i === 1 ? 'art-accent' : 'art-muted'} cx="108" cy={y} r="4.5" />
          <rect className="art-muted" x="116" y={y - 2.5} width={i === 1 ? 22 : 18} height="5" rx="2.5" />
        </g>
      ))}
    </Scene>
  )
}

export function DeniedArt() {
  return (
    <Scene action="raise">
      <path className="art-stroke-accent art-stroke-muted art-shackle" d="M112 66v-8a10 10 0 0 1 20 0v8" />
      <rect className="art-card" x="102" y="64" width="40" height="34" rx="9" />
      <circle className="art-accent" cx="122" cy="78" r="4.5" />
      <rect className="art-accent" x="120" y="80" width="4" height="9" rx="2" />
    </Scene>
  )
}

export function FailedArt() {
  return (
    <Scene action="error">
      <path className="art-card" d="M100 92h34a13 13 0 0 0 1-26 18 18 0 0 0-34-4 15 15 0 0 0-1 30Z" />
      <path className="art-stroke-muted" d="M118 92v6m0 5v4" />
      <rect className="art-muted" x="108" y="74" width="22" height="5" rx="2.5" />
    </Scene>
  )
}

export function NoBotsArt() {
  return (
    <Scene action="wave">
      <rect className="art-card art-dash" x="96" y="46" width="50" height="50" rx="12" />
      <circle className="art-accent" cx="121" cy="71" r="12" />
      <path className="art-stroke-ink" d="M121 65v12m-6-6h12" />
      <Sparkle x={148} y={40} s={0.7} />
    </Scene>
  )
}

export function NoMembersArt() {
  return (
    <Scene action="wave">
      {[
        [110, 58],
        [134, 58],
        [110, 84],
      ].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} className="art-muted" cx={cx} cy={cy} r="10" />
      ))}
      <circle className="art-accent" cx="134" cy="84" r="10" />
      <path className="art-stroke-ink art-thin" d="M134 79v10m-5-5h10" />
    </Scene>
  )
}

export function NoNotificationsArt() {
  return (
    <Scene action="sleep">
      <path className="art-card" d="M104 88h40c-4-4-6-8-6-16v-8a14 14 0 0 0-28 0v8c0 8-2 12-6 16Z" />
      <path className="art-stroke-muted" d="M118 94a6 6 0 0 0 12 0" />
      <circle className="art-muted" cx="124" cy="48" r="3" />
    </Scene>
  )
}

export function NoResultsArt() {
  return (
    <Scene action="ask">
      <path className="art-stroke-accent art-handle" d="M132 84l12 12" />
      <circle className="art-lens" cx="120" cy="72" r="16" />
      <rect className="art-muted" x="112" y="70" width="16" height="4" rx="2" />
    </Scene>
  )
}

export function NoDataArt() {
  return (
    <Scene action="idle">
      <rect className="art-card" x="94" y="44" width="54" height="54" rx="12" />
      {[
        [104, 14],
        [116, 24],
        [128, 18],
      ].map(([x, h]) => (
        <rect key={x} className="art-muted" x={x} y={86 - (h ?? 0)} width="8" height={h} rx="2.5" />
      ))}
      <path className="art-stroke-muted art-dash art-thin" d="M102 90h38" />
    </Scene>
  )
}

export function NoMachinesArt() {
  return (
    <Scene action="wait">
      <rect className="art-card" x="98" y="54" width="46" height="32" rx="6" />
      <rect className="art-muted art-dash" x="104" y="60" width="34" height="20" rx="3" />
      <rect className="art-muted" x="92" y="88" width="58" height="6" rx="3" />
    </Scene>
  )
}

export function NoGroupsArt() {
  return (
    <Scene action="wave">
      <rect className="art-card" x="94" y="42" width="46" height="30" rx="10" />
      <rect className="art-muted" x="102" y="52" width="26" height="5" rx="2.5" />
      <rect className="art-accent" x="108" y="68" width="42" height="28" rx="10" />
      {[120, 129, 138].map((x) => (
        <circle key={x} className="art-ink" cx={x} cy="82" r="2.4" />
      ))}
    </Scene>
  )
}

export function NoChangesArt() {
  return (
    <Scene action="idle">
      <rect className="art-card" x="98" y="40" width="44" height="58" rx="10" />
      {[52, 62, 72].map((y, i) => (
        <rect key={y} className="art-muted" x="106" y={y} width={[26, 20, 24][i]} height="5" rx="2.5" />
      ))}
      <circle className="art-accent" cx="140" cy="90" r="11" />
      <path className="art-stroke-ink art-thin" d="M135 90l3.5 3.5 6-7" />
    </Scene>
  )
}

export function ComingSoonArt() {
  return (
    <Scene action="carry">
      <rect className="art-accent-soft" x="100" y="84" width="22" height="12" rx="3" />
      <rect className="art-accent-soft" x="124" y="84" width="22" height="12" rx="3" />
      <rect className="art-accent" x="112" y="70" width="22" height="12" rx="3" />
      <path className="art-stroke-muted art-dash" d="M112 62h22" />
      <Sparkle x={146} y={58} s={0.7} />
    </Scene>
  )
}

export function UnsupportedArt() {
  return (
    <Scene action="ask">
      <path
        className="art-card"
        d="M100 58h12a6 6 0 1 1 12 0h12v12a6 6 0 1 1 0 12v12h-36V82a6 6 0 1 0 0-12Z"
      />
      <path className="art-stroke-muted art-dash" d="M106 76h24" />
    </Scene>
  )
}
