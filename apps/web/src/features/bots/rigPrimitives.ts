import type { MascotAction, MascotMove } from '../../ui'
import type { Face, Persona } from './personaModel'

export interface RigActResult {
  css?: string
  back?: string
  held?: string
  front?: string
  face?: Face
  own?: boolean
  noOwn?: boolean
}

export interface RigOpts {
  compact?: boolean
  still?: boolean
}

let kfSeq = 0

/** Generates a per-scene keyframe identifier so parallel SVGs cannot collide. */
export function uid(p = 'rg') {
  kfSeq += 1
  return `${p}${kfSeq}`
}

export const kf = (n: string, b: string) => `@keyframes ${n}{${b}}`

export function an(sel: string, base: string, frames: string, d: number, ease = 'ease-in-out', extra = '') {
  const k = uid(base)
  return `${sel}{animation:${k} ${d}s ${ease} infinite ${extra}}${kf(k, frames)}`
}

export const lbl = (t: string, x: number, y: number, c: string, s = 6.5) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,'PingFang SC',sans-serif" font-weight="700" font-size="${s}" fill="${c}">${t}</text>`

/** Picks a contrast-safe ink color for floating props on both light (#fff) and dark (#1c1d20) backgrounds. */
export function ink(f: Pick<Persona, 'from' | 'to'>) {
  const lum = (hex: string) => {
    const h = (hex || '').replace('#', '')
    if (h.length !== 6) return 200
    return (
      0.299 * Number.parseInt(h.slice(0, 2), 16) +
      0.587 * Number.parseInt(h.slice(2, 4), 16) +
      0.114 * Number.parseInt(h.slice(4, 6), 16)
    )
  }
  if (lum(f.to) >= 78) return f.to
  if (lum(f.from) >= 118) return f.from
  return '#94a0b8'
}

export const fitSize = (t: string) => (t.length > 4 ? 4.2 : t.length > 3 ? 4.6 : t.length > 2 ? 5.4 : 7)

export const bubble = (c: string, t: string) =>
  `<g class="fx-bub"><circle cx="37.5" cy="3.5" r="1.3" fill="#fff" stroke="#cfd6e2" stroke-width=".6"/><circle cx="40.5" cy="-.5" r="2" fill="#fff" stroke="#cfd6e2" stroke-width=".6"/><rect x="33" y="-13.5" width="18.5" height="11.5" rx="5.75" fill="#fff" stroke="#cfd6e2" stroke-width=".6"/><g class="fx-c">${lbl(t, 42.25, -7.6, c, fitSize(t))}</g></g>`

export const sign = (c: string, t: string, x = 44, y = -6) =>
  `<rect x="${x - 9}" y="${y - 5.5}" width="18" height="11" rx="2.4" fill="#fff" stroke="${c}" stroke-width="1"/>${lbl(t, x, y + 0.2, c, fitSize(t))}`

export const star = (x: number, y: number, r: number, c: string) =>
  `<path d="M${x} ${y - r}l${r * 0.3} ${r * 0.7} ${r * 0.7} ${r * 0.3}-${r * 0.7} ${r * 0.3}-${r * 0.3} ${r * 0.7}-${r * 0.3}-${r * 0.7}-${r * 0.7}-${r * 0.3} ${r * 0.7}-${r * 0.3}z" fill="${c}"/>`

export const heart = (x: number, y: number, s: number, c: string) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 3C-4-.5-3-4 0-2.2 3-4 4-.5 0 3z" fill="${c}"/>`

export const note = (x: number, y: number, c: string) =>
  `<g fill="${c}"><circle cx="${x}" cy="${y}" r="1.4"/><rect x="${x + 1}" y="${y - 5}" width=".8" height="5"/></g>`

export const lines = (c: string, ys: number[], x = -11) =>
  `<g stroke="${c}" stroke-width="1.6" stroke-linecap="round">${ys.map((y, i) => `<path class="fx-l fx-l${i}" d="M${x} ${y}h6"/>`).join('')}</g>`

export function speedCss(T: number) {
  const k = uid('sp')
  return `.fx-l{animation:${k} ${0.5 * T}s linear infinite}.fx-l1{animation-delay:-.15s}.fx-l2{animation-delay:-.3s}${kf(k, 'from{transform:translateX(5px);opacity:0}50%{opacity:1}to{transform:translateX(-5px);opacity:0}')}`
}

export function puffCss(sel: string, d: number) {
  const k = uid('pf')
  return `${sel}{transform-box:fill-box;transform-origin:center;animation:${k} ${d}s ease-out infinite}${kf(k, 'from{transform:scale(.3);opacity:.9}to{transform:scale(1.4) translateX(-3px);opacity:0}')}`
}

export function riseCss(sel: string, d: number, dy = -8) {
  const k = uid('rs')
  return `${sel}{animation:${k} ${d}s ease-out infinite}${kf(k, `from{transform:translateY(2px);opacity:0}30%{opacity:1}to{transform:translateY(${dy}px);opacity:0}`)}`
}

/**
 * Arm geometry around shoulder pivots `(7, 25)` and `(33, 25)` keeps gloves outside `[8..32] x [8..28]`.
 */
export const ARMS = {
  behind:
    '.r-la{transform:translate(4px,4px) rotate(-55deg);opacity:.45}.r-ra{transform:translate(-4px,4px) rotate(55deg);opacity:.45}',
  cross:
    '.r-la{transform:translate(5px,6px) rotate(-35deg)}.r-ra{transform:translate(-5px,6px) rotate(35deg)}',
  phones: '.r-la{transform:translate(4px,-8px)}.r-ra{transform:translate(-4px,-8px)}',
  flap: '.r-la{transform:rotate(25deg)}.r-ra{transform:rotate(-25deg)}',
  out: '.r-la{transform:rotate(14deg)}.r-ra{transform:rotate(-14deg)}',
  stiff: '.r-la{transform:rotate(-45deg)}.r-ra{transform:rotate(45deg)}',
  down: '.r-la{transform:rotate(-42deg)}.r-ra{transform:rotate(42deg)}',
  hug: '.r-la{transform:translate(4px,5px) rotate(-42deg)}.r-ra{transform:translate(-4px,5px) rotate(42deg)}',
  wave: '.r-la{transform:rotate(-42deg)}.r-ra{transform:rotate(-62deg)}',
  fin: '.r-la{transform:rotate(-18deg)}.r-ra{transform:rotate(18deg)}',
  cool: '.r-la{transform:translate(2px,6px) rotate(-55deg)}.r-ra{transform:rotate(-48deg)}',
  wing: '.r-la{transform:rotate(-8deg) translate(-1px,-4px)}.r-ra{transform:rotate(8deg) translate(1px,-4px)}',
} as const

export type ArmKey = keyof typeof ARMS

type GaitFn = (f: Persona, T: number) => RigActResult

export const GAITS = {
  amble: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an('.r-root', 'gb', '50%{transform:translateY(-.9px)}', 0.6 * T) +
        an('.r-body', 'gs', '25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}', 1.2 * T) +
        `.r-lf{animation:${kSt} ${1.2 * T}s linear infinite}.r-rf{animation:${kSt} ${1.2 * T}s linear -${0.6 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(2px,0)}50%{transform:translate(-2px,0)}75%{transform:translate(0,-1.2px)}100%{transform:translate(2px,0)}',
        ) +
        ARMS.behind +
        an(
          '.fx-o',
          'go',
          'from{transform:scale(.4);opacity:.9}to{transform:scale(1.5);opacity:0}',
          2.4 * T,
          'ease-out',
        ) +
        '.fx-o{transform-box:fill-box;transform-origin:center}',
      back: `<circle class="fx-o" cx="-6" cy="4" r="3" fill="none" stroke="${f.from}" stroke-width="1"/>`,
    }
  },
  sprint: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        '.r-lean{transform:rotate(11deg)}' +
        an('.r-root', 'gb', 'to{transform:translateY(-2px)}', 0.18 * T, 'ease-in-out', 'alternate') +
        `.r-lf{animation:${kSt} ${0.36 * T}s linear infinite}.r-rf{animation:${kSt} ${0.36 * T}s linear -${0.18 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(5px,0)}50%{transform:translate(-5px,0)}75%{transform:translate(0,-3.6px)}100%{transform:translate(5px,0)}',
        ) +
        an('.r-la', 'gpl', '0%,100%{transform:rotate(-50deg)}50%{transform:rotate(38deg)}', 0.36 * T) +
        an('.r-ra', 'gpr', '0%,100%{transform:rotate(-38deg)}50%{transform:rotate(50deg)}', 0.36 * T) +
        speedCss(T),
      back: lines('#9aa3af', [12, 20, 28]),
    }
  },
  headdown: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        '.r-lean{transform:rotate(7deg)}' +
        an('.r-body', 'gnod', '50%{transform:rotate(4deg) translateY(.8px)}', 0.5 * T) +
        `.r-lf{animation:${kSt} ${0.5 * T}s linear infinite}.r-rf{animation:${kSt} ${0.5 * T}s linear -${0.25 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}75%{transform:translate(0,-2px)}100%{transform:translate(3px,0)}',
        ) +
        ARMS.phones +
        riseCss('.fx-n', 1.4 * T, -10) +
        `.fx-n2{animation-delay:-${0.7 * T}s}`,
      front: `<g class="fx-n">${note(-6, 10, f.from)}</g><g class="fx-n fx-n2">${note(46, 6, f.from)}</g>`,
    }
  },
  skip: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an(
          '.r-root',
          'gb',
          'to{transform:translateY(-3px)}',
          0.2 * T,
          'cubic-bezier(.3,0,.5,1)',
          'alternate',
        ) +
        an(
          '.r-body',
          'gsq',
          'from{transform:scale(1.04,.96)}to{transform:scale(.98,1.03)}',
          0.2 * T,
          'ease-in-out',
          'alternate',
        ) +
        `.r-lf{animation:${kSt} ${0.4 * T}s linear infinite}.r-rf{animation:${kSt} ${0.4 * T}s linear -${0.2 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(2.4px,0)}50%{transform:translate(-2.4px,0)}75%{transform:translate(0,-2.6px)}100%{transform:translate(2.4px,0)}',
        ) +
        an(
          '.r-la',
          'gfl',
          'from{transform:rotate(-20deg)}to{transform:rotate(48deg)}',
          0.2 * T,
          'ease-in-out',
          'alternate',
        ) +
        an(
          '.r-ra',
          'gfr',
          'from{transform:rotate(20deg)}to{transform:rotate(-48deg)}',
          0.2 * T,
          'ease-in-out',
          'alternate',
        ) +
        puffCss('.fx-p', 0.4 * T) +
        `.fx-p2{animation-delay:-${0.2 * T}s}`,
      back: '<circle class="fx-p" cx="6" cy="45" r="2" fill="#dfe4ec"/><circle class="fx-p fx-p2" cx="2" cy="44" r="1.6" fill="#dfe4ec"/>',
    }
  },
  tiptoe: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an('.r-root', 'gb', '50%{transform:translateY(-1.6px)}', 0.8 * T) +
        `.r-lf{animation:${kSt} ${0.8 * T}s ease-in-out infinite}.r-rf{animation:${kSt} ${0.8 * T}s ease-in-out -${0.4 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(1.6px,0)}40%{transform:translate(-1.6px,0)}70%{transform:translate(0,-3px)}100%{transform:translate(1.6px,0)}',
        ) +
        ARMS.out +
        an('.fx-g', 'gg', '0%,100%{opacity:0}50%{opacity:.8}', 1.6 * T),
      back: `<path class="fx-g" d="M-12 47h64" stroke="${f.from}" stroke-width=".6" stroke-dasharray="2 2"/>`,
    }
  },
  march: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an('.r-root', 'gb', 'to{transform:translateY(-1px)}', 0.25 * T, 'steps(1)', 'alternate') +
        `.r-lf{animation:${kSt} ${0.5 * T}s cubic-bezier(.7,0,.3,1) infinite}.r-rf{animation:${kSt} ${0.5 * T}s cubic-bezier(.7,0,.3,1) -${0.25 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}70%{transform:translate(0,-3.4px)}100%{transform:translate(3px,0)}',
        ) +
        an(
          '.r-la',
          'gal',
          '0%,100%{transform:rotate(-45deg)}50%{transform:rotate(32deg)}',
          0.5 * T,
          'cubic-bezier(.7,0,.3,1)',
        ) +
        an(
          '.r-ra',
          'gar',
          '0%,100%{transform:rotate(-32deg)}50%{transform:rotate(45deg)}',
          0.5 * T,
          'cubic-bezier(.7,0,.3,1)',
        ),
    }
  },
  metronome: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        `.r-lf{animation:${kSt} ${0.6 * T}s steps(4,jump-none) infinite}.r-rf{animation:${kSt} ${0.6 * T}s steps(4,jump-none) -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}33%{transform:translate(0,0)}66%{transform:translate(-3px,0)}83%{transform:translate(0,-2px)}100%{transform:translate(3px,0)}',
        ) +
        an(
          '.r-body',
          'gtk',
          'from{transform:rotate(-1.5deg)}to{transform:rotate(1.5deg)}',
          0.6 * T,
          'steps(2)',
        ) +
        ARMS.down +
        an('.fx-t', 'gt', '0%{opacity:1}50%{opacity:.2}', 0.6 * T, 'steps(2)'),
      back: `<g class="fx-t" stroke="${f.from}" stroke-width="1"><path d="M-6 46v-3M-2 46v-2M2 46v-3"/></g>`,
    }
  },
  lookback: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an(
          '.r-body',
          'glk',
          '0%,55%{transform:scaleX(1)}62%,80%{transform:scaleX(-1) rotate(4deg)}88%,100%{transform:scaleX(1)}',
          2 * T,
        ) +
        an('.r-root', 'gb', '50%{transform:translateY(-1px)}', 0.6 * T) +
        `.r-lf{animation:${kSt} ${0.6 * T}s linear infinite}.r-rf{animation:${kSt} ${0.6 * T}s linear -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(2.4px,0)}50%{transform:translate(-2.4px,0)}75%{transform:translate(0,-1.6px)}100%{transform:translate(2.4px,0)}',
        ) +
        ARMS.down +
        an(
          '.fx-s',
          'gdr',
          'from{transform:translateY(0);opacity:1}to{transform:translateY(5px);opacity:0}',
          1.2 * T,
          'ease-in',
        ),
      front: '<path class="fx-s" d="M43 5q2.6 3.4 0 5.2-2.6-1.8 0-5.2z" fill="#6fc3ff"/>',
    }
  },
  patrol: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    const kAl = uid('gal')
    return {
      css:
        an('.r-body', 'gsc', '25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}', 1.6 * T) +
        `.r-lf{animation:${kSt} ${0.5 * T}s linear infinite}.r-rf{animation:${kSt} ${0.5 * T}s linear -${0.25 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}75%{transform:translate(0,-2.4px)}100%{transform:translate(3px,0)}',
        ) +
        `.r-la{animation:${kAl} ${0.5 * T}s ease-in-out infinite}.r-ra{animation:${kAl} ${0.5 * T}s ease-in-out infinite reverse}` +
        kf(kAl, '0%,100%{transform:rotate(-35deg)}50%{transform:rotate(25deg)}') +
        an('.fx-sir', 'gsr', '0%{fill:#ff453a}50%{fill:#0a84ff}', 0.5 * T, 'steps(1)'),
      held: '<rect x="17" y="-5" width="6" height="4" rx="2" class="fx-sir" fill="#ff453a"/>',
    }
  },
  spring: (f: Persona, T: number): RigActResult => ({
    css:
      an(
        '.r-root',
        'gb',
        '0%{transform:translateY(0);animation-timing-function:cubic-bezier(.2,.7,.4,1)}45%{transform:translateY(-6px);animation-timing-function:cubic-bezier(.6,0,.8,.4)}90%,100%{transform:translateY(0)}',
        0.45 * T,
        'linear',
      ) +
      an(
        '.r-body',
        'gsq',
        '0%,100%{transform:scale(1.1,.88)}20%{transform:scale(.94,1.08)}45%{transform:none}',
        0.45 * T,
      ) +
      '.r-lf{transform:translate(-1px,0)}.r-rf{transform:translate(1px,0)}.r-la{transform:rotate(40deg)}.r-ra{transform:rotate(-40deg)}' +
      an('.fx-k', 'gk', '0%,100%{transform:scaleY(.6)}45%{transform:scaleY(1.2)}', 0.45 * T) +
      '.fx-k{transform-origin:20px 50px}',
    back: `<path class="fx-k" d="M15 50l10-1.5-10-1.5 10-1.5-10-1.5" stroke="${f.from}" stroke-width="1.2" fill="none"/>`,
  }),
  weave: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an(
          '.r-root',
          'gwv',
          '25%{transform:translate(-2px,-1px)}50%{transform:translate(0,0)}75%{transform:translate(2px,-1px)}',
          1.2 * T,
        ) +
        an('.r-body', 'gsw', '25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}', 1.2 * T) +
        `.r-lf{animation:${kSt} ${0.6 * T}s linear infinite}.r-rf{animation:${kSt} ${0.6 * T}s linear -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(2.6px,0)}50%{transform:translate(-2.6px,0)}75%{transform:translate(0,-2px)}100%{transform:translate(2.6px,0)}',
        ) +
        an('.r-la', 'gal', '50%{transform:rotate(25deg)}', 0.6 * T) +
        an('.r-ra', 'gar', '50%{transform:rotate(-25deg)}', 0.6 * T),
      back: `<path d="M-12 48q8-3 16 0t16 0 16 0 16 0" fill="none" stroke="${f.from}" stroke-width=".7" stroke-dasharray="1.5 1.5" opacity=".6"/>`,
    }
  },
  jog: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        '.r-lean{transform:rotate(5deg)}' +
        an('.r-root', 'gb', 'to{transform:translateY(-2px)}', 0.25 * T, 'ease-in-out', 'alternate') +
        `.r-lf{animation:${kSt} ${0.5 * T}s linear infinite}.r-rf{animation:${kSt} ${0.5 * T}s linear -${0.25 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3.4px,0)}50%{transform:translate(-3.4px,0)}75%{transform:translate(0,-2.6px)}100%{transform:translate(3.4px,0)}',
        ) +
        an('.r-la', 'gal', '0%,100%{transform:rotate(-35deg)}50%{transform:rotate(28deg)}', 0.5 * T) +
        an(
          '.r-ra',
          'gwv',
          'from{transform:rotate(-45deg)}to{transform:rotate(-78deg)}',
          0.3 * T,
          'ease-in-out',
          'alternate',
        ) +
        riseCss('.fx-h', 1.2 * T, -9) +
        `.fx-h2{animation-delay:-${0.6 * T}s}`,
      front: `<g class="fx-h">${heart(46, 6, 0.8, '#ff6b8a')}</g><g class="fx-h fx-h2">${heart(-6, 10, 0.6, '#ff6b8a')}</g>`,
    }
  },
  glide: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        '.r-lean{transform:rotate(4deg)}' +
        an('.r-root', 'gb', 'to{transform:translateY(-1.4px)}', 0.35 * T, 'ease-in-out', 'alternate') +
        `.r-lf{animation:${kSt} ${0.7 * T}s linear infinite}.r-rf{animation:${kSt} ${0.7 * T}s linear -${0.35 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(4px,0)}50%{transform:translate(-4px,0)}75%{transform:translate(0,-2px)}100%{transform:translate(4px,0)}',
        ) +
        an('.r-la', 'gal', '0%,100%{transform:rotate(-38deg)}50%{transform:rotate(22deg)}', 0.7 * T) +
        an('.r-ra', 'gar', '0%,100%{transform:rotate(-22deg)}50%{transform:rotate(38deg)}', 0.7 * T) +
        '.spark{animation-duration:2.4s!important}' +
        riseCss('.fx-sp', 1.4 * T, -6),
      back: `<g class="fx-sp">${star(-6, 30, 2.4, f.from)}</g>`,
    }
  },
  terminal: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        `.r-lf{animation:${kSt} ${0.5 * T}s steps(3,jump-none) infinite}.r-rf{animation:${kSt} ${0.5 * T}s steps(3,jump-none) -${0.25 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}75%{transform:translate(0,-2px)}100%{transform:translate(3px,0)}',
        ) +
        an('.r-root', 'gb', 'to{transform:translateY(-1px)}', 0.25 * T, 'steps(1)', 'alternate') +
        ARMS.down +
        an('.fx-cur', 'gbl', '50%{opacity:0}', 0.8, 'steps(1)'),
      back: `${lbl('&gt;_', -7, 38, f.from, 6)}<rect class="fx-cur" x="-3" y="40" width="3" height="1.2" fill="${f.from}"/>`,
    }
  },
  drift: (f: Persona, T: number): RigActResult => {
    const kDg = uid('dg')
    return {
      css:
        an(
          '.r-root',
          'gfl',
          '0%,100%{transform:translate(0,-3px)}50%{transform:translate(0,-5px) rotate(-3deg)}',
          1.4 * T,
        ) +
        `.r-lf{animation:${kDg} ${1.4 * T}s ease-in-out infinite}.r-rf{animation:${kDg} ${1.4 * T}s ease-in-out -.35s infinite}` +
        kf(kDg, '50%{transform:translate(-1.6px,.8px) rotate(-12deg)}') +
        ARMS.out +
        an(
          '.r-shadow',
          'gsh',
          '0%,100%{transform:scale(.75);opacity:.6}50%{transform:scale(.6);opacity:.4}',
          1.4 * T,
        ) +
        an('.fx-orb', 'gob', 'to{transform:rotate(360deg)}', 1.8 * T, 'linear') +
        '.fx-orb{transform-origin:20px 20px}',
      front: `<g class="fx-orb">${star(20, -6, 2.6, '#fff')}${star(20, -6, 1.8, f.from)}</g>`,
    }
  },
  waddle: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an('.r-body', 'gwd', '0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}', 0.6 * T) +
        an('.r-root', 'gb', 'to{transform:translateY(-1.2px)}', 0.3 * T, 'ease-in-out', 'alternate') +
        `.r-lf{animation:${kSt} ${0.6 * T}s ease-in-out infinite}.r-rf{animation:${kSt} ${0.6 * T}s ease-in-out -${0.3 * T}s infinite}` +
        kf(kSt, '0%,100%{transform:translate(0,0)}25%{transform:translate(0,-2.4px)}') +
        an('.r-la', 'gal', '0%,100%{transform:rotate(30deg)}50%{transform:rotate(-20deg)}', 0.6 * T) +
        an('.r-ra', 'gar', '0%,100%{transform:rotate(20deg)}50%{transform:rotate(-30deg)}', 0.6 * T),
    }
  },
  dot: (f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an(
          '.r-root',
          'gb',
          'to{transform:translateY(-2px)}',
          0.3 * T,
          'cubic-bezier(.3,0,.5,1)',
          'alternate',
        ) +
        `.r-lf{animation:${kSt} ${0.6 * T}s linear infinite}.r-rf{animation:${kSt} ${0.6 * T}s linear -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(2.6px,0)}50%{transform:translate(-2.6px,0)}75%{transform:translate(0,-2.4px)}100%{transform:translate(2.6px,0)}',
        ) +
        ARMS.down +
        an(
          '.fx-d',
          'gdd',
          '0%,100%{transform:translate(0,0)}40%{transform:translate(10px,-6px)}60%{transform:translate(12px,0)}',
          1.2 * T,
        ),
      front: `<circle class="fx-d" cx="44" cy="40" r="2" fill="${f.to}" stroke="#fff" stroke-width=".8"/>`,
    }
  },
  swim: (f: Persona, T: number): RigActResult => {
    const kPd = uid('pd')
    return {
      css:
        an(
          '.r-root',
          'gsw',
          '0%,100%{transform:translateY(-2px) rotate(3deg)}50%{transform:translateY(-4px) rotate(-4deg)}',
          1.2 * T,
        ) +
        `.r-lf{animation:${kPd} ${0.4 * T}s ease-in-out infinite alternate}.r-rf{animation:${kPd} ${0.4 * T}s ease-in-out infinite alternate-reverse}` +
        kf(kPd, 'from{transform:rotate(-20deg)}to{transform:rotate(20deg)}') +
        an(
          '.r-la',
          'gfn',
          'from{transform:rotate(-18deg)}to{transform:rotate(24deg)}',
          0.6 * T,
          'ease-in-out',
          'alternate',
        ) +
        an(
          '.r-ra',
          'gfn2',
          'from{transform:rotate(18deg)}to{transform:rotate(-24deg)}',
          0.6 * T,
          'ease-in-out',
          'alternate',
        ) +
        '.r-shadow{transform:scale(.8);opacity:.5}' +
        riseCss('.fx-bb', 1.6 * T, -12) +
        `.fx-bb2{animation-delay:-${0.8 * T}s}`,
      front: `<circle class="fx-bb" cx="-4" cy="16" r="1.6" fill="none" stroke="${f.from}" stroke-width=".8"/><circle class="fx-bb fx-bb2" cx="-8" cy="22" r="1.1" fill="none" stroke="${f.from}" stroke-width=".8"/>`,
    }
  },
  hover: (f: Persona, T: number): RigActResult => ({
    css:
      '.r-lean{transform:rotate(10deg)}' +
      an('.r-root', 'ghv', '0%,100%{transform:translateY(-5px)}50%{transform:translateY(-7px)}', 1.6 * T) +
      '.r-lf{transform:translate(2px,-3px) rotate(-20deg)}.r-rf{transform:translate(-2px,-3px) rotate(-20deg)}.r-la{transform:rotate(-32deg)}.r-ra{transform:rotate(32deg)}' +
      '.r-shadow{transform:scale(.55);opacity:.4}' +
      an(
        '.fx-gl',
        'ggl',
        'from{opacity:.3;transform:scaleX(.8)}to{opacity:.8;transform:scaleX(1)}',
        0.4 * T,
        'ease-in-out',
        'alternate',
      ) +
      '.fx-gl{transform-origin:20px 44px}',
    back: `<ellipse class="fx-gl" cx="20" cy="44" rx="10" ry="2" fill="${f.from}"/>`,
  }),
  moonwalk: (_f: Persona, T: number): RigActResult => {
    const kMw = uid('mw')
    return {
      css:
        '.r-lean{transform:rotate(-6deg)}' +
        `.r-lf{animation:${kMw} ${0.8 * T}s linear infinite}.r-rf{animation:${kMw} ${0.8 * T}s linear -${0.4 * T}s infinite}` +
        kf(
          kMw,
          '0%{transform:translate(-3px,0) rotate(0)}45%{transform:translate(3px,0)}55%{transform:translate(3px,-1.6px) rotate(-18deg)}100%{transform:translate(-3px,0)}',
        ) +
        an('.r-root', 'gsl', '50%{transform:translateX(-1px)}', 0.8 * T) +
        ARMS.cool,
      back: '<path d="M48 6a6 6 0 1 1-6-7 4.6 4.6 0 0 0 6 7z" fill="#ffd84a" opacity=".9"/>',
    }
  },
  robot: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        `.r-lf{animation:${kSt} ${0.6 * T}s steps(2,jump-none) infinite}.r-rf{animation:${kSt} ${0.6 * T}s steps(2,jump-none) -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,-2px)}100%{transform:translate(3px,0)}',
        ) +
        an(
          '.r-body',
          'grb',
          '0%{transform:translateY(0)}50%{transform:translateY(-1.5px)}100%{transform:translateY(0)}',
          0.6 * T,
          'steps(2,jump-none)',
        ) +
        an(
          '.r-la',
          'gal',
          '0%{transform:rotate(-35deg)}100%{transform:rotate(25deg)}',
          0.6 * T,
          'steps(2,jump-none)',
        ) +
        an(
          '.r-ra',
          'gar',
          '0%{transform:rotate(35deg)}100%{transform:rotate(-25deg)}',
          0.6 * T,
          'steps(2,jump-none)',
        ),
    }
  },
  twirl: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an(
          '.r-spin',
          'gtw',
          '0%,70%{transform:scaleX(1)}78%{transform:scaleX(-1)}86%{transform:scaleX(1)}',
          2.4 * T,
        ) +
        an('.r-root', 'gb', 'to{transform:translateY(-1.6px)}', 0.3 * T, 'ease-in-out', 'alternate') +
        `.r-lf{animation:${kSt} ${0.6 * T}s linear infinite}.r-rf{animation:${kSt} ${0.6 * T}s linear -${0.3 * T}s infinite}` +
        kf(
          kSt,
          '0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}75%{transform:translate(0,-2px)}100%{transform:translate(3px,0)}',
        ) +
        ARMS.out,
    }
  },
  goose: (_f: Persona, T: number): RigActResult => {
    const kSt = uid('st')
    return {
      css:
        an('.r-body', 'gwd', '0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}', 0.5 * T) +
        `.r-lf{animation:${kSt} ${0.5 * T}s ease-in-out infinite}.r-rf{animation:${kSt} ${0.5 * T}s ease-in-out -${0.25 * T}s infinite}` +
        kf(kSt, '0%,100%{transform:translate(-2px,0)}25%{transform:translate(-2px,-2px)}') +
        an(
          '.r-la',
          'gfl',
          'from{transform:rotate(-10deg)}to{transform:rotate(58deg)}',
          0.25 * T,
          'ease-in-out',
          'alternate',
        ) +
        an(
          '.r-ra',
          'gfr',
          'from{transform:rotate(10deg)}to{transform:rotate(-58deg)}',
          0.25 * T,
          'ease-in-out',
          'alternate',
        ) +
        an(
          '.fx-hk',
          'ghk',
          '0%,60%{opacity:0;transform:scale(.6)}70%,90%{opacity:1;transform:scale(1)}100%{opacity:0}',
          2 * T,
        ) +
        '.fx-hk{transform-box:fill-box;transform-origin:center}',
      front: `<g class="fx-hk">${lbl('HONK', 44, -4, '#ff9f0a', 5.4)}</g>`,
    }
  },
  fly: (_f: Persona, T: number): RigActResult => ({
    css:
      an(
        '.r-root',
        'gbk',
        '0%,100%{transform:translateY(-6px) rotate(-6deg)}50%{transform:translateY(-8px) rotate(6deg)}',
        1.6 * T,
      ) +
      ARMS.wing +
      '.r-lf{transform:translate(3px,-3px)}.r-rf{transform:translate(-3px,-3px)}.r-shadow{transform:scale(.5);opacity:.4}' +
      an('.fx-ct', 'gct', 'from{stroke-dashoffset:0}to{stroke-dashoffset:-12}', 0.6 * T, 'linear'),
    back: '<path class="fx-ct" d="M-14 26h12M-14 30h10" stroke="#c9d1dd" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="4 2"/>',
  }),
} satisfies Record<string, GaitFn>

export type GaitKey = keyof typeof GAITS

export const IDLES = {
  sway: (T: number) =>
    an('.r-body', 'isw', '25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}', 2.4 * T),
  still: (T: number) => an('.r-body', 'ist', '50%{transform:translateY(-.5px)}', 3 * T),
  nod: (T: number) => an('.r-body', 'ind', '50%{transform:rotate(3deg) translateY(.6px)}', 0.5 * T),
  bounce: (T: number) =>
    an('.r-root', 'ibn', 'to{transform:translateY(-2px)}', 0.3 * T, 'cubic-bezier(.3,0,.5,1)', 'alternate'),
  breathe: (T: number) => an('.r-body', 'ibr', '50%{transform:scale(1.03,.98)}', 2.4 * T),
  tick: (T: number) =>
    an('.r-body', 'itk', 'from{transform:rotate(-1.5deg)}to{transform:rotate(1.5deg)}', 1 * T, 'steps(2)'),
  fidget: (T: number) =>
    an(
      '.r-root',
      'ifg',
      '25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}',
      0.3 * T,
      'linear',
    ),
  scan: (T: number) =>
    an('.r-body', 'isc', '25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}', 2.4 * T),
  float: (T: number) =>
    an('.r-root', 'ifl', '0%,100%{transform:translateY(-3px)}50%{transform:translateY(-5px)}', 2.4 * T) +
    '.r-shadow{transform:scale(.7);opacity:.5}',
  lean: (T: number) =>
    `.r-lean{transform:rotate(-6deg)}${an('.r-body', 'iln', '50%{transform:translateY(-.8px)}', 1 * T)}`,
} as const

export type IdleKey = keyof typeof IDLES

const SMALL_SYM: Partial<Record<MascotAction, string>> = {
  think: '…',
  ask: '?',
  raise: '!',
  type: '{ }',
  carry: '■',
  done: '✓',
  error: '!',
}

/** Degrades Chinese or long captions to crisp symbols when rendered at small sizes (e.g. 28px). */
export function compactWord(act: MascotAction | MascotMove, w: string) {
  if (!w) return ''
  if (w.length <= 2 && !/\p{Script=Han}/u.test(w)) return w
  return SMALL_SYM[act as MascotAction] || w
}

export const RIG_BASE =
  '.r-body{transform-origin:20px 40px}.r-spin{transform-origin:20px 20px}.r-lean{transform-origin:20px 46px}.r-root{transform-origin:20px 46px}' +
  '.r-la{transform-origin:7px 25px}.r-ra{transform-origin:33px 25px}' +
  '.r-lf{transform-origin:13px 43.6px}.r-rf{transform-origin:27px 43.6px}.r-shadow{transform-origin:20px 47px}.fx-c{}'
