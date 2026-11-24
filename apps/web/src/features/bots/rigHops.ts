import type { Persona } from './personaModel'
import {
  ARMS,
  type ArmKey,
  an,
  type GaitKey,
  heart,
  type IdleKey,
  ink,
  lbl,
  note,
  type RigActResult,
  sign,
  star,
} from './rigPrimitives'

const hopRoot = (h: number, at = 30) =>
  an(
    '.r-root',
    'hhp',
    `0%,12%{transform:translateY(0);animation-timing-function:cubic-bezier(.2,.7,.4,1)}${at}%{transform:translateY(-${h}px);animation-timing-function:cubic-bezier(.6,0,.8,.4)}${at + 14}%,100%{transform:translateY(0)}`,
    1.4,
    'linear',
  )

const squash = (k = 1) =>
  an(
    '.r-body',
    'hsq',
    `0%{transform:none}12%{transform:scale(${1 + 0.1 * k},${1 - 0.15 * k})}22%{transform:scale(${1 - 0.06 * k},${1 + 0.08 * k})}36%{transform:none}44%{transform:scale(${1 + 0.12 * k},${1 - 0.18 * k})}54%{transform:scale(.97,1.03)}62%,100%{transform:none}`,
    1.4,
  )

const armsUp = (a = 72) =>
  an(
    '.r-la',
    'hal',
    `12%{transform:rotate(-20deg)}30%{transform:rotate(${a}deg)}48%{transform:rotate(25deg)}62%,100%{transform:rotate(-42deg)}`,
    1.4,
  ) +
  an(
    '.r-ra',
    'har',
    `12%{transform:rotate(20deg)}30%{transform:rotate(-${a}deg)}48%{transform:rotate(-25deg)}62%,100%{transform:rotate(42deg)}`,
    1.4,
  )

const shadowHop = () =>
  an('.r-shadow', 'hsh', '30%{transform:scale(.55);opacity:.45}44%,100%{transform:none}', 1.4)

const popAt = (sel: string, from = 25, to = 75) =>
  `${sel}{transform-box:fill-box;transform-origin:center}` +
  an(
    sel,
    'hpp',
    `0%,${from - 5}%{transform:scale(.2);opacity:0}${from + 8}%{transform:scale(1.15);opacity:1}${from + 15}%,${to}%{transform:scale(1);opacity:1}${to + 10}%,100%{opacity:0}`,
    1.4,
  )

type HopFn = (f: Persona) => RigActResult

export const HOPS = {
  bulb: (f: Persona): RigActResult => ({
    css: hopRoot(6, 34) + squash(0.6) + shadowHop() + ARMS.behind + popAt('.fx-x', 30, 80),
    front: `<g class="fx-x">${lbl('💡', 20, -10, f.to, 11)}</g>`,
  }),
  curt: (f: Persona): RigActResult => ({
    css:
      hopRoot(3, 22) +
      squash(0.4) +
      shadowHop() +
      '.r-la{transform:rotate(-42deg)}' +
      an(
        '.r-ra',
        'hth',
        '0%,15%{transform:rotate(42deg)}28%,80%{transform:rotate(-74deg)}100%{transform:rotate(42deg)}',
        1.4,
      ) +
      popAt('.fx-x', 22, 80),
    held: `<g class="fx-x">${sign(f.to, 'LGTM', 45, 2)}</g>`,
  }),
  fist: (f: Persona): RigActResult => ({
    css:
      hopRoot(5) +
      squash(0.7) +
      shadowHop() +
      ARMS.phones.split('.r-ra')[0] +
      an(
        '.r-ra',
        'hfp',
        '0%,10%{transform:rotate(20deg)}25%{transform:rotate(-78deg)}35%{transform:rotate(-52deg)}45%{transform:rotate(-78deg)}70%,100%{transform:rotate(20deg)}',
        1.4,
      ) +
      popAt('.fx-x'),
    front: `<g class="fx-x">${note(44, -2, f.from)}${note(-4, 2, f.from)}</g>`,
  }),
  triple: (_f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'htr',
        '0%{transform:translateY(0)}10%{transform:translateY(-6px)}20%{transform:translateY(0)}30%{transform:translateY(-6px)}40%{transform:translateY(0)}52%{transform:translateY(-9px)}64%,100%{transform:translateY(0)}',
        1.4,
      ) +
      an(
        '.r-body',
        'htq',
        '0%,20%,40%,64%{transform:scale(1.08,.9)}10%,30%,52%{transform:scale(.96,1.05)}72%,100%{transform:none}',
        1.4,
      ) +
      armsUp(76) +
      popAt('.fx-x', 50, 85),
    front: `<g class="fx-x">${lbl('✓✓✓', 20, -10, '#30d158', 7)}</g>`,
  }),
  float: (_f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hfo',
        '0%,10%{transform:translateY(0)}40%,55%{transform:translateY(-7px)}85%,100%{transform:translateY(0)}',
        1.4,
      ) +
      '.r-la{transform:rotate(32deg)}.r-ra{transform:rotate(-32deg)}' +
      shadowHop() +
      popAt('.fx-x', 35, 70),
    front: `<g class="fx-x">${star(46, 2, 4, '#ffd84a')}</g>`,
  }),
  stamp: (_f: Persona): RigActResult => ({
    css:
      hopRoot(8, 26) +
      an(
        '.r-body',
        'hsb',
        '0%,30%{transform:none}40%{transform:scale(1.15,.8)}50%,100%{transform:none}',
        1.4,
      ) +
      armsUp(68) +
      shadowHop() +
      an(
        '.fx-x',
        'hrg',
        '0%,38%{transform:scale(.2);opacity:0}42%{opacity:1}70%,100%{transform:scale(1.8);opacity:0}',
        1.4,
      ) +
      '.fx-x{transform-origin:20px 47px}' +
      popAt('.fx-y', 40, 85),
    back: '<ellipse class="fx-x" cx="20" cy="47" rx="12" ry="2.5" fill="none" stroke="#30d158" stroke-width="1.2"/>',
    front: `<g class="fx-y"><circle cx="45" cy="-5" r="6" fill="#30d158"/>${lbl('✓', 45, -5, '#fff', 8)}</g>`,
  }),
  precise: (f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hpr',
        '0%,10%{transform:translateY(0);animation-timing-function:linear}25%,35%{transform:translateY(-6px);animation-timing-function:linear}50%,100%{transform:translateY(0)}',
        1.4,
      ) +
      ARMS.down +
      popAt('.fx-x', 25, 80),
    front: `<g class="fx-x">${lbl('+1', 44, -4, f.to, 9)}</g>`,
  }),
  relief: (f: Persona): RigActResult => ({
    css:
      hopRoot(3, 24) +
      squash(0.4) +
      '.r-la{transform:rotate(-42deg)}' +
      an(
        '.r-ra',
        'hwp',
        '0%,25%{transform:rotate(42deg)}38%{transform:rotate(-58deg) translate(-2px,-4px)}50%{transform:rotate(-42deg) translate(2px,-4px)}62%{transform:rotate(-58deg) translate(-2px,-4px)}78%,100%{transform:rotate(42deg)}',
        1.4,
      ) +
      an(
        '.fx-x',
        'hdr',
        '0%,35%{opacity:0;transform:none}45%{opacity:1}75%,100%{opacity:0;transform:translateY(8px)}',
        1.4,
      ) +
      popAt('.fx-y', 50, 85),
    front: `<path class="fx-x" d="M43 5q2.6 3.4 0 5.2-2.6-1.8 0-5.2z" fill="#6fc3ff"/><g class="fx-y">${lbl('🛡', -6, -2, f.to, 9)}</g>`,
  }),
  salute: (f: Persona): RigActResult => ({
    css:
      hopRoot(4) +
      squash(0.5) +
      '.r-la{transform:rotate(-42deg)}' +
      an(
        '.r-ra',
        'hsl',
        '0%,20%{transform:rotate(42deg)}35%,80%{transform:rotate(-68deg)}100%{transform:rotate(42deg)}',
        1.4,
      ) +
      popAt('.fx-x', 35, 80),
    front: `<g class="fx-x">${lbl('🔒', 46, -4, f.to, 9)}</g>`,
  }),
  boing: (f: Persona): RigActResult => ({
    css:
      hopRoot(13, 32) +
      squash(1.5) +
      armsUp(78) +
      shadowHop() +
      an(
        '.fx-x',
        'hkk',
        '0%{transform:scaleY(.4)}12%{transform:scaleY(.3)}24%{transform:scaleY(1.6)}40%,100%{transform:scaleY(.6)}',
        1.4,
      ) +
      '.fx-x{transform-origin:20px 50px}' +
      popAt('.fx-y', 30, 70),
    back: `<path class="fx-x" d="M15 50l10-1.5-10-1.5 10-1.5-10-1.5" stroke="${f.from}" stroke-width="1.2" fill="none"/>`,
    front: `<g class="fx-y">${star(20, -13, 4, '#ffd84a')}</g>`,
  }),
  flag: (f: Persona): RigActResult => ({
    css:
      hopRoot(5) +
      squash(0.6) +
      shadowHop() +
      '.r-la{transform:rotate(-42deg)}' +
      an(
        '.r-ra',
        'hfg',
        '0%,18%{transform:rotate(42deg)}32%,84%{transform:rotate(-68deg)}100%{transform:rotate(42deg)}',
        1.4,
      ) +
      popAt('.fx-x', 32, 85),
    held: `<g class="fx-x"><path d="M39 14v-22" stroke="${f.to}" stroke-width="1.3" stroke-linecap="round"/><path d="M39 -8l9 3.2-9 3.2z" fill="${f.from}"/></g>`,
  }),
  hearts: (_f: Persona): RigActResult => ({
    css:
      hopRoot(6) +
      squash(0.8) +
      armsUp(72) +
      shadowHop() +
      ['a', 'b', 'c']
        .map((k, i) =>
          an(
            `.fx-${k}`,
            `hh${k}`,
            `0%,25%{opacity:0;transform:none}35%{opacity:1}75%,100%{opacity:0;transform:translate(${[-8, 0, 8][i]}px,-12px)}`,
            1.4,
          ),
        )
        .join(''),
    front: `<g class="fx-a">${heart(14, -2, 0.9, '#ff6b8a')}</g><g class="fx-b">${heart(20, -6, 1.1, '#ff6b8a')}</g><g class="fx-c">${heart(26, -2, 0.9, '#ff6b8a')}</g>`,
  }),
  sparkspin: (f: Persona): RigActResult => ({
    css:
      hopRoot(8, 36) +
      squash(0.5) +
      shadowHop() +
      an(
        '.r-spin',
        'hss',
        '0%,14%{transform:rotate(-8deg)}50%,100%{transform:rotate(360deg)}',
        1.4,
        'cubic-bezier(.4,0,.2,1)',
      ) +
      armsUp(68) +
      popAt('.fx-x', 32, 78),
    front: `<g class="fx-x">${star(-4, 4, 3.4, f.from)}${star(46, 0, 4, f.from)}${star(20, -13, 2.8, f.from)}</g>`,
  }),
  prompt: (_f: Persona): RigActResult => ({
    css: hopRoot(4) + squash(0.5) + shadowHop() + armsUp(58) + popAt('.fx-x', 30, 85),
    front: `<g class="fx-x"><rect x="30" y="-12" width="24" height="10" rx="2" fill="#10203a" stroke="#5c66ff" stroke-width=".8"/>${lbl('$ ✓ ok', 42, -7, '#30d158', 5)}</g>`,
  }),
  twinkle: (f: Persona): RigActResult => ({
    css:
      hopRoot(8) +
      shadowHop() +
      an(
        '.r-spin',
        'htk',
        '0%,12%{transform:none}30%{transform:scale(.92) rotate(-16deg)}44%{transform:scale(1.04) rotate(10deg)}60%,100%{transform:none}',
        1.4,
      ) +
      armsUp(66) +
      popAt('.fx-x', 28, 70),
    front: `<g class="fx-x">${star(-4, -2, 4, f.from)}${star(46, -6, 3, f.to)}</g>`,
  }),
  nod: (_f: Persona): RigActResult => ({
    css:
      hopRoot(5) +
      shadowHop() +
      an(
        '.r-body',
        'hnd',
        '0%,30%{transform:none}40%{transform:rotate(-10deg)}50%{transform:rotate(6deg)}60%,100%{transform:none}',
        1.4,
      ) +
      armsUp(62) +
      popAt('.fx-x', 35, 80),
    front: `<g class="fx-x">${lbl('✓', 45, -4, '#30d158', 10)}</g>`,
  }),
  pidots: (f: Persona): RigActResult => ({
    css:
      hopRoot(6) +
      squash(0.8) +
      shadowHop() +
      armsUp(60) +
      ['a', 'b', 'c', 'd']
        .map((k, i) =>
          an(
            `.fx-${k}`,
            `hp${k}`,
            `0%,${20 + i * 6}%{opacity:0;transform:translateY(4px)}${28 + i * 6}%,80%{opacity:1;transform:none}100%{opacity:0}`,
            1.4,
          ),
        )
        .join(''),
    front: ['3', '.', '1', '4']
      .map((d, i) => `<g class="fx-${'abcd'[i]}">${lbl(d, 11 + i * 6, -9, ink(f), 8)}</g>`)
      .join(''),
  }),
  breach: (f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hbr',
        '0%,10%{transform:none}25%{transform:translate(-3px,-10px) rotate(-25deg)}40%{transform:translate(3px,-8px) rotate(25deg)}55%,100%{transform:none}',
        1.4,
      ) +
      shadowHop() +
      ARMS.fin +
      an(
        '.fx-x',
        'hsp',
        '0%,50%{opacity:0;transform:none}58%{opacity:1}80%,100%{opacity:0;transform:translateY(-5px)}',
        1.4,
      ),
    back: `<g class="fx-x" fill="${f.from}"><circle cx="10" cy="44" r="1.4"/><circle cx="20" cy="42" r="1.8"/><circle cx="30" cy="44" r="1.4"/></g>`,
  }),
  flip: (_f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hfp',
        '0%,10%{transform:translateY(-6px)}40%{transform:translateY(-13px) rotate(180deg)}62%{transform:translateY(-8px) rotate(360deg)}100%{transform:translateY(-6px) rotate(360deg)}',
        1.4,
      ) +
      '.r-root{transform-origin:20px 22px}.r-lf{transform:translate(2px,-3px)}.r-rf{transform:translate(-2px,-3px)}.r-la{transform:rotate(25deg)}.r-ra{transform:rotate(-25deg)}.r-shadow{transform:scale(.55);opacity:.4}',
  }),
  blocky: (f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hbh',
        '0%{transform:none}15%{transform:translateY(-4px)}30%{transform:translateY(-8px)}45%{transform:translateY(-4px)}60%,100%{transform:none}',
        1.4,
        'steps(1)',
      ) +
      '.r-la{transform:rotate(68deg)}.r-ra{transform:rotate(-68deg)}' +
      popAt('.fx-x', 30, 80),
    front: `<g class="fx-x">${lbl('[✓]', 20, -10, f.to, 7)}</g>`,
  }),
  spin: (_f: Persona): RigActResult => ({
    css:
      hopRoot(7) +
      shadowHop() +
      an(
        '.r-spin',
        'hsp',
        '0%,12%{transform:scaleX(1)}22%{transform:scaleX(-1)}32%{transform:scaleX(1)}42%{transform:scaleX(-1)}52%,100%{transform:scaleX(1)}',
        1.4,
      ) +
      armsUp(56),
  }),
  moon: (_f: Persona): RigActResult => ({
    css:
      an(
        '.r-root',
        'hmn',
        '0%,10%{transform:none}30%{transform:translate(4px,-9px) rotate(10deg)}50%{transform:translate(8px,0)}60%{transform:translate(8px,0)}100%{transform:none}',
        1.4,
      ) +
      '.r-la{transform:rotate(58deg)}.r-ra{transform:rotate(-35deg)}' +
      popAt('.fx-x', 25, 75),
    front: '<g class="fx-x"><path d="M50 -6a7 7 0 1 1-7-8 5.4 5.4 0 0 0 7 8z" fill="#ffd84a"/></g>',
  }),
  flap: (_f: Persona): RigActResult => ({
    css:
      hopRoot(9) +
      squash(0.6) +
      shadowHop() +
      an(
        '.r-la',
        'hfa',
        '10%,30%,50%{transform:rotate(64deg)}20%,40%{transform:rotate(-10deg)}60%,100%{transform:rotate(-42deg)}',
        1.4,
      ) +
      an(
        '.r-ra',
        'hfb',
        '10%,30%,50%{transform:rotate(-64deg)}20%,40%{transform:rotate(10deg)}60%,100%{transform:rotate(42deg)}',
        1.4,
      ) +
      an(
        '.fx-x',
        'hft',
        '0%,30%{opacity:0;transform:none}40%{opacity:1}90%,100%{opacity:0;transform:translate(-6px,10px) rotate(-40deg)}',
        1.4,
      ),
    front: '<path class="fx-x" d="M-2 8q4-6 8-2-4 1-8 2z" fill="#fff" stroke="#c9d1dd" stroke-width=".5"/>',
  }),
  barrel: (_f: Persona): RigActResult => ({
    css:
      '.r-root{transform-origin:20px 22px}' +
      an(
        '.r-root',
        'hbl',
        '0%,10%{transform:translateY(-6px) rotate(0)}45%{transform:translateY(-10px) rotate(360deg)}100%{transform:translateY(-6px) rotate(360deg)}',
        1.4,
      ) +
      ARMS.wing +
      '.r-lf{transform:translate(3px,-3px)}.r-rf{transform:translate(-3px,-3px)}.r-shadow{transform:scale(.5);opacity:.4}',
  }),
} satisfies Record<string, HopFn>

export type HopKey = keyof typeof HOPS

export interface RigProfile {
  gait: GaitKey
  hop: HopKey
  arms: ArmKey
  idle: IdleKey
}

const DEFAULT_PROFILE: RigProfile = { gait: 'amble', hop: 'bulb', arms: 'behind', idle: 'sway' }

export const profileOf = (key: string): RigProfile => PROFILES[key] ?? DEFAULT_PROFILE

export const PROFILES: Record<string, RigProfile> = {
  hammock: { gait: 'amble', hop: 'bulb', arms: 'behind', idle: 'sway' },
  braces: { gait: 'sprint', hop: 'curt', arms: 'cross', idle: 'still' },
  focus: { gait: 'headdown', hop: 'fist', arms: 'phones', idle: 'nod' },
  steps: { gait: 'skip', hop: 'triple', arms: 'flap', idle: 'bounce' },
  blank: { gait: 'tiptoe', hop: 'float', arms: 'out', idle: 'breathe' },
  no: { gait: 'march', hop: 'stamp', arms: 'stiff', idle: 'still' },
  abacus: { gait: 'metronome', hop: 'precise', arms: 'down', idle: 'tick' },
  invert: { gait: 'lookback', hop: 'relief', arms: 'hug', idle: 'fidget' },
  sentry: { gait: 'patrol', hop: 'salute', arms: 'down', idle: 'scan' },
  spring: { gait: 'spring', hop: 'boing', arms: 'out', idle: 'bounce' },
  compass: { gait: 'weave', hop: 'flag', arms: 'down', idle: 'sway' },
  loop: { gait: 'jog', hop: 'hearts', arms: 'wave', idle: 'sway' },
  'agent-claude': { gait: 'glide', hop: 'sparkspin', arms: 'down', idle: 'breathe' },
  'agent-codex': { gait: 'terminal', hop: 'prompt', arms: 'down', idle: 'tick' },
  'agent-gemini': { gait: 'drift', hop: 'twinkle', arms: 'out', idle: 'float' },
  'agent-codebuddy': { gait: 'waddle', hop: 'nod', arms: 'down', idle: 'sway' },
  'agent-pi': { gait: 'dot', hop: 'pidots', arms: 'down', idle: 'bounce' },
  'agent-deepseek': { gait: 'swim', hop: 'breach', arms: 'fin', idle: 'float' },
  'agent-antigravity': { gait: 'hover', hop: 'flip', arms: 'out', idle: 'float' },
  'agent-opencode': { gait: 'robot', hop: 'blocky', arms: 'stiff', idle: 'tick' },
  'agent-qwen': { gait: 'twirl', hop: 'spin', arms: 'out', idle: 'sway' },
  'agent-kimi': { gait: 'moonwalk', hop: 'moon', arms: 'cool', idle: 'lean' },
  'agent-goose': { gait: 'goose', hop: 'flap', arms: 'flap', idle: 'sway' },
  'agent-copilot': { gait: 'fly', hop: 'barrel', arms: 'wing', idle: 'float' },
}
