import { type CSSProperties, type ReactNode, useId } from 'react'
import { cx } from '../lib/cx'
import './mascot.css'

export const MASCOT_ACTIONS = [
  'idle',
  'wave',
  'think',
  'ask',
  'raise',
  'wait',
  'type',
  'carry',
  'run',
  'done',
  'error',
  'sleep',
] as const
export type MascotAction = (typeof MASCOT_ACTIONS)[number]

const INK = '#16213E'
const HEAD_BOX = '26 0 68 68'

/**
 * A limb pivots at (ox, oy); `rest` is its drawn angle measured from hanging straight down, so every action's keyframes
 * name absolute poses and the same animation drives arms, legs and strokes alike.
 */
function Limb({
  part,
  ox,
  oy,
  rest,
  children,
}: {
  part: string
  ox: number
  oy: number
  rest: number
  children: ReactNode
}) {
  return (
    <g
      className={`ui-mascot__${part}`}
      style={{ transformOrigin: `${ox}px ${oy}px`, '--rest': `${rest}deg` } as CSSProperties}
    >
      {children}
    </g>
  )
}

const EYES = [55.5, 64.5]

function Face() {
  return (
    <>
      <g className="ui-mascot__eyes ui-mascot__eyes--open" fill={INK}>
        {EYES.map((x) => (
          <ellipse key={x} className="ui-mascot__eye" cx={x} cy="50.5" rx="2.2" ry="2.8" />
        ))}
      </g>
      <g fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round">
        <g className="ui-mascot__eyes ui-mascot__eyes--happy">
          {EYES.map((x) => (
            <path key={x} d={`M${x - 2.4} 51.6q2.4-4.4 4.8 0`} />
          ))}
        </g>
        <g className="ui-mascot__eyes ui-mascot__eyes--closed">
          {EYES.map((x) => (
            <path key={x} d={`M${x - 2.4} 50.6q2.4 3 4.8 0`} />
          ))}
        </g>
        <g className="ui-mascot__eyes ui-mascot__eyes--x">
          {EYES.map((x) => (
            <path key={x} d={`M${x - 2} 48.5l4 4m0-4-4 4`} />
          ))}
        </g>
        <path
          className="ui-mascot__mouth ui-mascot__mouth--smile"
          d="M58.2 56.4q1.8 1.6 3.6 0"
          strokeWidth="1.4"
        />
        <path
          className="ui-mascot__mouth ui-mascot__mouth--wobble"
          d="M57.4 57.4l1.3-1 1.3 1 1.3-1 1.3 1"
          strokeWidth="1.3"
        />
      </g>
      <path
        className="ui-mascot__mouth ui-mascot__mouth--open"
        d="M57.8 55.4h4.4a2.2 2.2 0 0 1-4.4 0Z"
        fill={INK}
      />
      <circle cx="52.4" cy="56" r="1.6" fill="#FF8FB1" />
      <circle cx="67.6" cy="56" r="1.6" fill="#FF8FB1" />
    </>
  )
}

const CONFETTI: [number, number, string][] = [
  [-34, -26, 'var(--system-blue)'],
  [30, -34, 'var(--system-teal)'],
  [-42, 6, 'var(--system-orange)'],
  [42, -4, 'var(--system-green)'],
  [-16, -42, 'var(--system-pink, #FF8FB1)'],
  [18, -46, 'var(--system-blue)'],
  [44, 22, 'var(--system-orange)'],
  [-44, 24, 'var(--system-teal)'],
]

function Bubble({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <g className={`ui-mascot__prop ui-mascot__prop--${kind}`}>
      <circle className="ui-mascot__bubble" cx="82" cy="27" r="2.2" />
      <circle className="ui-mascot__bubble" cx="86.5" cy="21.5" r="3.2" />
      <rect className="ui-mascot__bubble" x="84" y="2" width="32" height="18" rx="9" />
      {children}
    </g>
  )
}

function Props({ jade }: { jade: string }) {
  return (
    <>
      <line
        className="ui-mascot__prop ui-mascot__prop--ground"
        x1="-10"
        x2="130"
        y1="112"
        y2="112"
        strokeDasharray="6 8"
      />
      <Bubble kind="think">
        {[93, 100, 107].map((x, i) => (
          <circle
            key={x}
            className="ui-mascot__fx"
            cx={x}
            cy="11"
            r="2.1"
            fill="var(--system-blue)"
            style={{ '--dd': `${i * 0.15}s` } as CSSProperties}
          />
        ))}
      </Bubble>
      <Bubble kind="ask">
        <text className="ui-mascot__glyph" x="100" y="15.5" textAnchor="middle">
          ?
        </text>
      </Bubble>
      <Bubble kind="raise">
        <path
          className="ui-mascot__fx"
          d="M100 4.6l5.6 2.1v4.4c0 3.5-2.4 6-5.6 7.2-3.2-1.2-5.6-3.7-5.6-7.2V6.7z"
          fill="var(--system-orange)"
        />
        <path d="M100 8v4M100 14.6v.1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </Bubble>
      <Bubble kind="wait">
        <path
          className="ui-mascot__fx ui-mascot__hourglass"
          d="M95.5 5h9M95.5 17h9M96.8 5c0 4.2 3.2 4.4 3.2 6s-3.2 1.8-3.2 6M103.2 5c0 4.2-3.2 4.4-3.2 6s3.2 1.8 3.2 6"
          fill="none"
          stroke="var(--label)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </Bubble>
      <g
        className="ui-mascot__prop ui-mascot__prop--run"
        stroke="var(--separator)"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        {[
          [6, 20, 46, 0],
          [2, 14, 62, -0.15],
          [8, 18, 78, -0.28],
        ].map(([x1, x2, y, d]) => (
          <line
            key={y}
            className="ui-mascot__fx"
            x1={x1}
            x2={x2}
            y1={y}
            y2={y}
            style={{ '--dd': `${d}s` } as CSSProperties}
          />
        ))}
      </g>
      <g className="ui-mascot__prop ui-mascot__prop--carry">
        <g className="ui-mascot__brick">
          <rect x="40" y="7" width="40" height="15" rx="3.5" fill="var(--system-orange)" />
          <rect x="40" y="7" width="40" height="4" rx="2" fill="#fff" opacity=".25" />
          <text className="ui-mascot__code" x="60" y="18" textAnchor="middle" fill="#fff">
            {'</>'}
          </text>
        </g>
        <path className="ui-mascot__fx ui-mascot__sweat" d="M89 30q3 4 0 6q-3-2 0-6Z" fill="#6FC3FF" />
      </g>
      <g className="ui-mascot__prop ui-mascot__prop--type">
        <rect className="ui-mascot__laptop" x="34" y="78" width="52" height="28" rx="5" />
        <path className="ui-mascot__glow" d="M60 85 66 92 60 99 54 92Z" fill={jade} />
        <rect className="ui-mascot__laptop-base" x="28" y="104" width="64" height="5" rx="2.5" />
        {(
          [
            ['{ }', 40, 0, 'var(--system-blue)'],
            ['</>', 60, -0.6, 'var(--system-teal)'],
            ['01', 80, -1.2, 'var(--system-orange)'],
          ] as const
        ).map(([t, x, d, c]) => (
          <text
            key={t}
            className="ui-mascot__fx ui-mascot__code"
            x={x}
            y="76"
            textAnchor="middle"
            fill={c}
            style={{ '--dd': `${d}s` } as CSSProperties}
          >
            {t}
          </text>
        ))}
      </g>
      <g className="ui-mascot__prop ui-mascot__prop--done">
        {CONFETTI.map(([x, y, c], i) => {
          const style = { '--x': `${x}px`, '--y': `${y}px`, '--dd': `${-i * 0.06}s` } as CSSProperties
          return i % 2 ? (
            <path
              key={`${x}${y}`}
              className="ui-mascot__fx"
              d="M60 38 63 41 60 44 57 41Z"
              fill={c}
              style={style}
            />
          ) : (
            <rect
              key={`${x}${y}`}
              className="ui-mascot__fx"
              x="58.5"
              y="38"
              width="3"
              height="6"
              rx="1"
              fill={c}
              style={style}
            />
          )
        })}
      </g>
      <g className="ui-mascot__prop ui-mascot__prop--error">
        <g className="ui-mascot__fx ui-mascot__bang">
          <circle cx="94" cy="20" r="8" fill="var(--system-red)" />
          <rect x="92.8" y="15" width="2.4" height="6.5" rx="1.2" fill="#fff" />
          <circle cx="94" cy="24" r="1.3" fill="#fff" />
        </g>
        <path
          className="ui-mascot__fx ui-mascot__sweat"
          d="M27 34q3 4 0 6q-3-2 0-6Z"
          fill="#6FC3FF"
          style={{ '--dd': '-.4s' } as CSSProperties}
        />
      </g>
      <g className="ui-mascot__prop ui-mascot__prop--sleep">
        {[0, 1, 2].map((i) => (
          <text
            key={i}
            className="ui-mascot__fx ui-mascot__z"
            x="84"
            y="28"
            fontSize={9 + i * 2}
            style={{ '--dd': `${-i}s` } as CSSProperties}
          >
            z
          </text>
        ))}
      </g>
    </>
  )
}

/** A bot's character playing the mascot: one self-contained animated scene per action. */
export interface MascotCostume {
  role: string
  /** `words` is false when too small to read the props' captions. */
  scene: (action: MascotAction, words: boolean) => string
}

/**
 * 共字君, the brand mascot: the glyph 共 whose two bottom dots are its legs, whose long stroke breaks into arms and
 * whose two raised verticals hold the jade of the logo. `crop="head"` frames it for avatars and drops the props;
 * a `costume` puts a bot's character in its place, acting out the same states its own way.
 */
export function Mascot({
  action = 'idle',
  size = 120,
  crop,
  costume,
  label,
  className,
}: {
  action?: MascotAction
  size?: number
  crop?: 'head'
  costume?: MascotCostume
  label?: string
  className?: string
}) {
  const id = useId()
  if (costume)
    return (
      <img
        className={cx('ui-mascot', 'ui-mascot--role', className)}
        src={costume.scene(action, size >= 64)}
        width={size}
        height={size}
        data-action={action}
        data-role={costume.role}
        alt={label ?? ''}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    )
  const body = `${id}b`
  const jade = `${id}j`
  const full = crop !== 'head'
  const compact = size < 48
  return (
    <svg
      className={cx('ui-mascot', !full && 'ui-mascot--head', compact && 'ui-mascot--compact', className)}
      data-action={action}
      width={size}
      height={size}
      viewBox={full ? '0 0 120 120' : HEAD_BOX}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={body} gradientUnits="userSpaceOnUse" x1="40" y1="20" x2="80" y2="106">
          <stop stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#0FA3A0" />
        </linearGradient>
        <linearGradient id={jade} gradientUnits="userSpaceOnUse" x1="54" y1="5" x2="66" y2="18">
          <stop stopColor="#B8F5EA" />
          <stop offset="1" stopColor="#14B3AE" />
        </linearGradient>
      </defs>
      {full ? <ellipse className="ui-mascot__shadow" cx="60" cy="109" rx="24" ry="3" /> : null}
      <g className="ui-mascot__fig">
        <g className="ui-mascot__bob" fill={`url(#${body})`}>
          <Limb part="lf" ox={50} oy={78} rest={19}>
            <path
              d="M50 78 41 103"
              fill="none"
              stroke={`url(#${body})`}
              strokeWidth="9"
              strokeLinecap="round"
            />
          </Limb>
          <Limb part="rf" ox={70} oy={78} rest={-19}>
            <path
              d="M70 78 79 103"
              fill="none"
              stroke={`url(#${body})`}
              strokeWidth="9"
              strokeLinecap="round"
            />
          </Limb>
          <Limb part="la" ox={40} oy={66.5} rest={90}>
            <rect x="22" y="62" width="22" height="9" rx="4.5" />
          </Limb>
          <Limb part="ra" ox={80} oy={66.5} rest={-90}>
            <rect x="76" y="62" width="22" height="9" rx="4.5" />
          </Limb>
          <rect className="ui-mascot__window" x="48" y="41" width="24" height="23" rx="4" />
          <rect x="41" y="22" width="9" height="44" rx="4.5" />
          <rect x="70" y="22" width="9" height="44" rx="4.5" />
          <rect x="31" y="34" width="58" height="9" rx="4.5" />
          <rect x="38" y="62" width="44" height="9" rx="4.5" />
          <Face />
          <g className="ui-mascot__jade">
            <path className="ui-mascot__gem" d="M60 4.5 67 11.5 60 18.5 53 11.5Z" fill={`url(#${jade})`} />
            <path d="M60 4.5 67 11.5H60Z" fill="#fff" opacity=".45" />
          </g>
        </g>
      </g>
      {full ? <Props jade={`url(#${jade})`} /> : null}
    </svg>
  )
}
