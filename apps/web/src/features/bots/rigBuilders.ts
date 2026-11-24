import type { MascotAction } from '../../ui'
import type { Persona } from './personaModel'
import { profileOf } from './rigHops'
import {
  ARMS,
  bubble,
  compactWord,
  fitSize,
  GAITS,
  heart,
  kf,
  lbl,
  lines,
  note,
  type RigActResult,
  type RigOpts,
  speedCss,
  star,
  uid,
} from './rigPrimitives'

export type ActFn = (f: Persona, T: number, opts: RigOpts) => RigActResult

export function A(sel: string, frames: string, d: number, ease = 'ease-in-out', extra = '') {
  const k = uid('ra')
  return `${sel}{animation:${k} ${d}s ${ease} infinite ${extra}}${kf(k, frames)}`
}

export const S = (sel: string, t: string) => `${sel}{transform:${t}}`

/** Merges multiple string CSS snippets or partial rig results into one object without accumulating spreads. */
export function M(...parts: (string | RigActResult)[]): RigActResult {
  const out: RigActResult = { css: '', back: '', held: '', front: '' }
  for (const p of parts) {
    if (typeof p === 'string') {
      out.css = `${out.css}${p}`
      continue
    }
    if (p.css) out.css = `${out.css}${p.css}`
    if (p.back) out.back = `${out.back}${p.back}`
    if (p.held) out.held = `${out.held}${p.held}`
    if (p.front) out.front = `${out.front}${p.front}`
    if (p.face !== undefined) out.face = p.face
    if (p.own !== undefined) out.own = p.own
    if (p.noOwn !== undefined) out.noOwn = p.noOwn
  }
  return out
}

export function W(f: Persona, act: MascotAction, opts: RigOpts = {}) {
  const raw = f.acts[act]?.[1] || ''
  return opts.compact ? compactWord(act, raw) : raw
}

export const arms = (la: number, ra: number) =>
  S('.r-la', `rotate(${la}deg)`) + S('.r-ra', `rotate(${ra}deg)`)
export const hide = '.r-la,.r-ra{opacity:0}'
export const bob = (amp: number, d: number, sel = '.r-root') =>
  A(sel, `50%{transform:translateY(-${amp}px)}`, d)
export const sway = (deg: number, d: number, sel = '.r-body') =>
  A(sel, `25%{transform:rotate(-${deg}deg)}75%{transform:rotate(${deg}deg)}`, d)
export const pendulum = (deg: number, d: number) =>
  '.r-root{transform-origin:20px -12px}' +
  A('.r-root', `0%,100%{transform:rotate(-${deg}deg)}50%{transform:rotate(${deg}deg)}`, d)
export const tilt = (deg: number, d: number, hold = '40%,70%') =>
  A('.r-body', `0%,100%{transform:rotate(0)}${hold}{transform:rotate(${deg}deg)}`, d)
export const shake = (px: number, d: number, sel = '.r-root') =>
  A(
    sel,
    `0%,50%,100%{transform:translateX(0)}10%,30%{transform:translateX(-${px}px)}20%,40%{transform:translateX(${px}px)}`,
    d,
  )
export const hops = (h: number, d: number) =>
  A(
    '.r-root',
    `0%,100%{transform:translateY(0)}50%{transform:translateY(-${h}px)}`,
    d,
    'cubic-bezier(.3,0,.5,1)',
  )
export const breathe = (d: number) => A('.r-body', '50%{transform:scale(1.03,.97)}', d)
export const float = (a: number, b: number, d: number) =>
  `${A('.r-root', `0%,100%{transform:translateY(-${a}px)}50%{transform:translateY(-${b}px)}`, d)}.r-shadow{transform:scale(.65);opacity:.5}`
export const ticks = (deg: number, d: number) =>
  A('.r-body', `from{transform:rotate(-${deg}deg)}to{transform:rotate(${deg}deg)}`, d, 'steps(2)')
export const swing = (side: 'la' | 'ra', a: number, b: number, d: number, ease = 'ease-in-out') =>
  A(`.r-${side}`, `from{transform:rotate(${a}deg)}to{transform:rotate(${b}deg)}`, d, ease, 'alternate')
export const armKeys = (side: 'la' | 'ra', frames: string, d: number, ease = 'ease-in-out') =>
  A(`.r-${side}`, frames, d, ease)
export const footTap = (side: 'lf' | 'rf', d: number) =>
  A(`.r-${side}`, '0%,100%{transform:translateY(0)}50%{transform:translateY(-2px) rotate(-12deg)}', d)
export const look = (d: number) =>
  A(
    '.r-body',
    '0%,40%{transform:scaleX(1)}50%,90%{transform:scaleX(-1)}100%{transform:scaleX(1)}',
    d,
    'steps(1)',
  )
export const fadeLoop = (sel: string, d: number) => A(sel, '0%,100%{opacity:.15}50%{opacity:1}', d)

export const pop = (sel: string, d: number, from = 10, to = 80) =>
  `${sel}{transform-box:fill-box;transform-origin:center}` +
  A(
    sel,
    `0%,${from}%{transform:scale(.2);opacity:0}${from + 12}%,${to}%{transform:scale(1);opacity:1}100%{transform:scale(1.1);opacity:0}`,
    d,
    'ease-out',
  )

export const rise = (sel: string, d: number, dy = -9, delay = 0) =>
  A(
    sel,
    `from{transform:translateY(2px);opacity:0}30%{opacity:1}to{transform:translateY(${dy}px);opacity:0}`,
    d,
    'ease-out',
    delay ? `;animation-delay:-${delay}s` : '',
  )

export function zzz(c: string, z = 'Z', d = 3): RigActResult {
  const k = uid('zz')
  return {
    css:
      `.zz text{animation:${k} ${d}s ease-in-out infinite}.zz text:nth-child(2){animation-delay:${d / 3}s}.zz text:nth-child(3){animation-delay:${(2 * d) / 3}s}` +
      kf(
        k,
        '0%{opacity:0;transform:translateY(3px)}30%,70%{opacity:1}100%{opacity:0;transform:translateY(-3px)}',
      ),
    front: `<g class="zz">${lbl(z, 40, 2, c, 7)}${lbl(z, 45, -4, c, 8.5)}${lbl(z, 50, -11, c, 10)}</g>`,
  }
}

export const bub = (f: Persona, t: string, cls = 'bb'): RigActResult => ({
  css: A('.fx-c', '50%{opacity:.4}', 1.6),
  front: `<g class="${cls}">${bubble(f.to, t)}</g>`,
})

interface SignOpts {
  la?: number
  bg?: string
  fg?: string
  bd?: string
  pole?: string
}

export function raiseSign(f: Persona, t: string, d = 0.7, opts: SignOpts = {}): RigActResult {
  const bg = opts.bg || '#fff'
  const fg = opts.fg || f.to
  const bd = opts.bd || f.to
  const pole = opts.pole || f.to
  return {
    css:
      S('.r-la', `rotate(${opts.la ?? -42}deg)`) +
      A('.r-ra', '0%,100%{transform:rotate(-66deg)}50%{transform:rotate(-78deg)}', d) +
      A('.sg', '0%,100%{transform:translateY(0)}50%{transform:translateY(-2.2px)}', d),
    held:
      `<g class="sg"><path d="M39 2v14" stroke="${pole}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<rect x="30" y="-9.5" width="18" height="11" rx="2.4" fill="${bg}" stroke="${bd}" stroke-width="1"/>${lbl(t, 39, -3.8, fg, fitSize(t))}</g>`,
  }
}

export function raiseFlag(f: Persona, fill: string, d = 1.2): RigActResult {
  return {
    css:
      S('.r-la', 'rotate(-42deg)') +
      A('.r-ra', '0%,100%{transform:rotate(-68deg)}50%{transform:rotate(-76deg)}', d) +
      A('.sg', '0%,100%{transform:rotate(0)}50%{transform:rotate(-5deg)}', d) +
      '.sg{transform-origin:39px 16px}',
    held: `<g class="sg"><path d="M39 -12v28" stroke="${f.to}" stroke-width="1.4" stroke-linecap="round"/><path d="M39 -12l10 3.6-10 3.6z" fill="${fill}"/></g>`,
  }
}

interface LaptopOpts {
  screenBg?: string
  screenFg?: string
  screenBd?: string
  extraScreen?: string
  pause?: boolean
  oneHand?: boolean
  peck?: boolean
}

export function laptop(
  f: Persona,
  t: string,
  d: number,
  ease = 'ease-in-out',
  opts: LaptopOpts = {},
): RigActResult {
  const bg = opts.screenBg || '#fff'
  const fg = opts.screenFg || f.to
  const bd = opts.screenBd || f.to
  const pause = opts.pause
  const oneHand = opts.oneHand
  const peck = opts.peck
  const h1 = oneHand
    ? ''
    : pause
      ? A(
          '.h1',
          '0%,40%{transform:none}45%,55%,65%{transform:translateY(-1.6px)}50%,60%,70%,100%{transform:none}',
          d,
        )
      : A('.h1', 'to{transform:translateY(-1.6px)}', d, ease, 'alternate')
  const h2 = pause
    ? A(
        '.h2',
        '0%,42%{transform:none}48%,58%,68%{transform:translateY(-1.6px)}53%,63%,73%,100%{transform:none}',
        d,
      )
    : A('.h2', 'to{transform:translateY(-1.6px)}', d, ease, 'alternate-reverse')
  return {
    css:
      (oneHand ? `${S('.r-la', 'translate(2px,6px) rotate(-55deg)')}.r-ra{opacity:0}` : hide) +
      h1 +
      h2 +
      A('.cu', '50%{opacity:0}', 0.8, 'steps(1)') +
      (peck ? A('.r-body', '0%,100%{transform:none}45%{transform:rotate(11deg) translate(1px,1px)}', d) : ''),
    held:
      `<g class="lp"><rect x="31.8" y="14.6" width="18.4" height="14.4" rx="1.8" fill="${bg}" stroke="${bd}" stroke-width="1"/>` +
      `${opts.extraScreen || lbl(t, 41, 20.6, fg, fitSize(t) - 0.5)}` +
      `<rect class="cu" x="43.2" y="24.8" width="3" height="1.1" fill="${fg}"/>` +
      '<path d="M31.2 29.6h19.6l3.2 6H28z" fill="#eef1f6" stroke="#c9d1dd" stroke-width=".8" stroke-linejoin="round"/>' +
      (oneHand
        ? ''
        : `<g class="h1"><ellipse cx="35.4" cy="31.4" rx="2.6" ry="2" fill="${f.to}" stroke="#fff" stroke-width=".9"/></g>`) +
      `<g class="h2"><ellipse cx="45.8" cy="31.4" rx="2.6" ry="2" fill="${f.to}" stroke="#fff" stroke-width=".9"/></g></g>`,
  }
}

interface LoadOpts {
  hover?: boolean
  bg?: string
  fg?: string
  bd?: string
  inner?: string
}

export function load(f: Persona, t: string, w = 28, opts: LoadOpts = {}): RigActResult {
  const floatY = opts.hover ? -3 : 0
  const bg = opts.bg || '#fff'
  const fg = opts.fg || f.to
  const bd = opts.bd || f.to
  return {
    css:
      (opts.hover ? ARMS.out : '.r-la,.r-ra{display:none}') +
      (opts.hover ? A('.ld', '50%{transform:translateY(-1.8px)}', 1.4) : ''),
    held:
      `<g class="ld" transform="translate(0 ${floatY})">` +
      `<rect x="${20 - w / 2}" y="-13" width="${w}" height="10" rx="2.4" fill="${bg}" stroke="${bd}" stroke-width="1.1"/>` +
      `${opts.inner || lbl(t, 20, -7.8, fg, fitSize(t) - 0.4)}` +
      (opts.hover
        ? ''
        : `<circle cx="${20 - w / 2 - 2}" cy="-6" r="3.4" fill="${f.to}" stroke="#fff" stroke-width="1.2"/>` +
          `<circle cx="${20 + w / 2 + 2}" cy="-6" r="3.4" fill="${f.to}" stroke="#fff" stroke-width="1.2"/>`) +
      '</g>',
  }
}

export function gait(f: Persona, T: number, k: number): RigActResult {
  const g = GAITS[profileOf(f.key).gait](f, T * k)
  return { css: g.css, back: g.back || '', held: g.held || '', front: g.front || '' }
}

export function carry(f: Persona, T: number, t: string, w = 28, opts: LoadOpts = {}): RigActResult {
  const g = gait(f, T, 1.35)
  return M({ css: g.css, back: g.back, held: g.held, front: g.front }, load(f, t, w, opts))
}

export function run(f: Persona, T: number, extra: string | RigActResult = ''): RigActResult {
  const g = gait(f, T, 0.55)
  return M(
    {
      css: (g.css ?? '') + speedCss(T),
      back: (g.back ?? '') + lines(f.from, [14, 22, 30], -15),
      held: g.held,
      front: g.front,
    },
    extra,
  )
}

export const sweat = (x = 43, y = 5, d = 1.2): RigActResult => ({
  css: A(
    '.sw',
    'from{transform:translateY(0);opacity:1}to{transform:translateY(5px);opacity:0}',
    d,
    'ease-in',
  ),
  front: `<path class="sw" d="M${x} ${y}q2.6 3.4 0 5.2-2.6-1.8 0-5.2z" fill="#6fc3ff"/>`,
})

export function steam(d = 0.9): RigActResult {
  const k = uid('stm')
  return {
    css:
      `.st path{animation:${k} ${d}s ease-out infinite}.st path:nth-child(2){animation-delay:${d * 0.33}s}.st path:nth-child(3){animation-delay:${d * 0.66}s}` +
      kf(
        k,
        'from{transform:translateY(2px);opacity:0}50%{opacity:1}to{transform:translateY(-4px);opacity:0}',
      ),
    front:
      '<g class="st" fill="none" stroke="#b8c0cc" stroke-width="1.6" stroke-linecap="round"><path d="M14 -2q-2-3 0-6"/><path d="M20 -3q2-3 0-6"/><path d="M26 -2q-2-3 0-6"/></g>',
  }
}

export const bang = (t: string, c = '#ff453a', d = 0.9): RigActResult => ({
  css: pop('.bg', d, 5, 85),
  front: `<g class="bg">${lbl(t, 45, -5, c, t.length > 2 ? 6 : 10)}</g>`,
})

export const dizzy = (c: string): RigActResult => ({
  css: `.dz{transform-origin:20px -2px}${A('.dz', 'to{transform:rotate(360deg)}', 1.2, 'linear')}`,
  front: `<g class="dz">${star(10, -2, 2.4, c)}${star(30, -2, 2.4, c)}${star(20, -7, 2, '#ffd84a')}</g>`,
})

export const hourglass = (c: string, d: number): RigActResult => ({
  css: `.hg{transform-origin:-5.5px 30.4px}${A('.hg', '0%,60%{transform:rotate(0)}80%,100%{transform:rotate(180deg)}', d)}`,
  back: `<g class="hg"><path d="M-9 26h7l-3.5 4.4 3.5 4.4h-7l3.5-4.4z" fill="#fff" stroke="${c}" stroke-linejoin="round"/><path d="M-7.6 27h4.2l-2.1 2.6z" fill="#ffd84a"/></g>`,
})

export const hearts = (d = 1.2): RigActResult => ({
  css: rise('.ht', d, -10) + rise('.ht2', d, -12, d / 2),
  front: `<g class="ht">${heart(44, 4, 0.8, '#ff6b8a')}</g><g class="ht2">${heart(-4, 8, 0.6, '#ff6b8a')}</g>`,
})

export const notes = (c: string, d = 1.4): RigActResult => ({
  css: rise('.nt', d, -10) + rise('.nt2', d, -10, d / 2),
  front: `<g class="nt">${note(-6, 10, c)}</g><g class="nt2">${note(46, 6, c)}</g>`,
})

export const lyingDown = (deg = -80) =>
  '.r-lean{transform-origin:20px 20px}' +
  S(
    '.r-lean',
    `translateY(${Math.abs(deg) > 40 ? 9 : 2}px) rotate(${deg}deg) scale(${Math.abs(deg) > 40 ? 0.82 : 0.95})`,
  ) +
  '.r-shadow{transform:scale(1.2,1)}'

export const hammockHooks = (c: string) =>
  `<g class="hm" stroke="${c}" stroke-width="1" stroke-linecap="round" opacity=".65"><path d="M-7 -11L4 6M47 -11 36 6"/><circle cx="-7" cy="-11" r="1.4" fill="${c}"/><circle cx="47" cy="-11" r="1.4" fill="${c}"/></g>`
