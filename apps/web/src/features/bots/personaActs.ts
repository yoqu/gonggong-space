import type { MascotAction } from '../../ui'
import {
  A,
  type ActFn,
  armKeys,
  arms,
  bang,
  breathe,
  bub,
  carry,
  dizzy,
  fadeLoop,
  footTap,
  gait,
  hammockHooks,
  hearts,
  hops,
  hourglass,
  laptop,
  load,
  look,
  lyingDown,
  M,
  notes,
  pendulum,
  pop,
  raiseFlag,
  raiseSign,
  rise,
  run,
  S,
  shake,
  steam,
  sway,
  sweat,
  swing,
  ticks,
  tilt,
  W,
  zzz,
} from './rigBuilders'
import { HOPS } from './rigHops'
import { ARMS, bubble, ink, lbl } from './rigPrimitives'

export const PERSONA_SPEC: Record<string, Record<MascotAction, ActFn>> = {
  hammock: {
    idle: (f, T) => M(pendulum(5, 3 * T), ARMS.behind, { held: hammockHooks(f.from), face: 'closed' }),
    wave: (_f, T) =>
      M(
        pendulum(3, 3 * T),
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,30%{transform:rotate(42deg)}55%,70%{transform:rotate(-70deg)}100%{transform:rotate(42deg)}',
          3 * T,
        ),
        { face: 'happy' },
      ),
    think: (f, T, opts) =>
      M(tilt(-4, 4 * T), arms(-42, -58), bub(f, W(f, 'think', opts)), { face: 'closed', own: true }),
    ask: (f, T, opts) => M(tilt(10, 3 * T, '35%,80%'), arms(-42, -48), bub(f, W(f, 'ask', opts))),
    raise: (f, T, opts) => M(raiseSign(f, W(f, 'raise', opts), 1.2 * T), breathe(3 * T), { face: 'happy' }),
    wait: (f, T) =>
      M(
        pendulum(6, 3.6 * T),
        ARMS.behind,
        A('.r-lf', '0%,100%{transform:none}50%{transform:translateY(-2px) rotate(12deg)}', 1.8 * T),
        A(
          '.r-rf',
          '0%,100%{transform:none}50%{transform:translateY(-2px) rotate(-12deg)}',
          1.8 * T,
          'ease-in-out',
          `;animation-delay:-${0.9 * T}s`,
        ),
        {
          held: hammockHooks(f.from),
          front: `<circle class="fx-o" cx="44" cy="14" r="1.8" fill="none" stroke="${f.from}" stroke-width=".9"/>`,
          css: rise('.fx-o', 2.4 * T, -10),
          face: 'closed',
        },
      ),
    type: (f, T, opts) => M(laptop(f, W(f, 'type', opts), 2.4 * T, 'ease-in-out', { pause: true })),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 28),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.bulb(f), { face: 'happy' }),
    error: (f, T) =>
      M(
        '.r-root{transform-origin:20px 30px}',
        A(
          '.r-root',
          '0%,10%{transform:rotate(0)}30%,85%{transform:translate(-2px,6px) rotate(68deg)}100%{transform:rotate(0)}',
          2.4 * T,
        ),
        arms(30, -30),
        dizzy(f.from),
        { face: 'x' },
      ),
    sleep: (f, T) =>
      M(
        pendulum(4, 4 * T),
        ARMS.behind,
        {
          held: `${hammockHooks(f.from)}<rect x="13" y="18" width="14" height="5" rx="2.5" fill="#fff" opacity=".4"/>`,
        },
        zzz(f.to),
        { face: 'closed' },
      ),
  },
  braces: {
    idle: (_f, T) =>
      M(
        ARMS.cross,
        A('.r-body', '0%,88%{transform:none}92%{transform:scale(1.04,.95)}96%,100%{transform:none}', 3 * T),
      ),
    wave: (_f, T) =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,60%{transform:rotate(42deg)}66%{transform:rotate(-65deg)}72%{transform:rotate(-80deg)}80%,100%{transform:rotate(42deg)}',
          1.6 * T,
          'linear',
        ),
      ),
    think: (f, _T, opts) => M(ARMS.cross, bub(f, W(f, 'think', opts))),
    ask: (f, _T, opts) => M(ARMS.cross, S('.r-lean', 'rotate(7deg)'), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) =>
      M(
        raiseSign(f, W(f, 'raise', opts), 0.4, { bg: '#1e2430', fg: '#7cf0c4', bd: '#39424f' }),
        footTap('lf', 0.3),
      ),
    wait: () =>
      M(
        S('.r-la', 'translate(5px,6px) rotate(-35deg)'),
        swing('ra', 28, 52, 0.14),
        footTap('lf', 0.24),
        steam(1.2),
      ),
    type: (f, _T, opts) => M(laptop(f, W(f, 'type', opts), 0.09, 'linear'), steam(1.1)),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T * 0.8),
    done: (f) => M(HOPS.curt(f), { face: 'open' }),
    error: (f, _T, opts) =>
      M(arms(50, -50), shake(2, 0.5), steam(0.6), bang(W(f, 'error', opts), '#ff453a', 0.6), { face: 'x' }),
    sleep: (f) =>
      M(lyingDown(-14), S('.r-body', 'translateY(6px) scale(1.08,.76)'), arms(-25, 25), zzz(ink(f), 'Z', 4)),
  },
  focus: {
    idle: (f) =>
      M(ARMS.phones, A('.r-body', '50%{transform:rotate(3deg) translateY(.6px)}', 0.5), notes(f.from)),
    wave: (_f, T) =>
      M(
        ARMS.phones,
        A('.r-body', '50%{transform:rotate(3deg)}', 0.5),
        armKeys(
          'ra',
          '0%,30%{transform:translate(-4px,-8px)}45%,75%{transform:rotate(-75deg)}90%,100%{transform:translate(-4px,-8px)}',
          2 * T,
        ),
      ),
    think: (f, _T, opts) => M(ARMS.phones, bub(f, W(f, 'think', opts)), { face: 'closed', own: true }),
    ask: (f, _T, opts) =>
      M(
        S('.r-la', 'translate(4px,-8px)'),
        armKeys(
          'ra',
          '0%,20%{transform:translate(-4px,-8px)}35%,80%{transform:rotate(-45deg)}100%{transform:translate(-4px,-8px)}',
          2.4,
        ),
        tilt(8, 2.4),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f, _T, opts) =>
      M(raiseSign(f, W(f, 'raise', opts), 0.8, { bg: '#fff', fg: f.to }), S('.r-la', 'translate(4px,-8px)')),
    wait: (f) => M(ARMS.phones, notes(f.from, 2.4), { face: 'closed', noOwn: true }),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.11, 'linear', {
          extraScreen:
            '<rect x="36" y="17.5" width="6" height="1.8" fill="#ffd84a"/><rect x="34" y="20.2" width="11" height="1.8" fill="#ffa24a"/><rect x="33" y="23" width="14" height="1.8" fill="#ff6b5a"/>',
        }),
        A('.r-body', '50%{transform:rotate(2deg)}', 0.5),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) =>
      M(HOPS.fist(f), {
        front: `<g class="tp">${lbl('🏆', 20, -10, f.to, 11)}</g>`,
        css: pop('.tp', 1.4, 20, 80),
      }),
    error: (f, T, opts) =>
      M(
        A(
          '.r-la',
          '0%,20%{transform:translate(4px,-8px)}55%,100%{transform:rotate(-50deg) translateY(3px)}',
          1.6 * T,
        ),
        A(
          '.r-ra',
          '0%,20%{transform:translate(-4px,-8px)}55%,100%{transform:rotate(50deg) translateY(3px)}',
          1.6 * T,
        ),
        shake(1.4, 0.8),
        bang(W(f, 'error', opts), '#ff453a'),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(ARMS.phones, A('.r-body', '50%{transform:rotate(-4deg) translateY(1px)}', 3), notes(f.from, 3), {
        face: 'closed',
      }),
  },
  steps: {
    idle: () => M(hops(2.4, 0.35), arms(18, -18)),
    wave: () => M(hops(2, 0.3), swing('la', 35, 76, 0.16), swing('ra', -35, -76, 0.16), { face: 'happy' }),
    think: (f) =>
      M(hops(1.2, 0.5), arms(-38, -56), {
        front: `<g>${bubble(f.to, '')}<circle class="d1" cx="39" cy="-7.6" r="1.8" fill="#ff453a"/><circle class="d2" cx="45" cy="-7.6" r="1.8" fill="#ff453a"/></g>`,
        css:
          A('.d1', '0%,40%{fill:#ff453a}50%,100%{fill:#30d158}', 2) +
          A('.d2', '0%,60%{fill:#ff453a}70%,100%{fill:#30d158}', 2),
      }),
    ask: (f, _T, opts) =>
      M(
        A(
          '.r-root',
          '0%,40%,100%{transform:none}20%{transform:translateY(-6px)}',
          1.2,
          'cubic-bezier(.3,0,.5,1)',
        ),
        arms(32, -32),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f) => M(raiseFlag(f, '#30d158', 0.5), hops(1.6, 0.35)),
    wait: () =>
      M(
        A('.r-lf', '50%{transform:translateY(-2px)}', 0.3),
        A('.r-rf', '50%{transform:translateY(-2px)}', 0.3, 'ease-in-out', ';animation-delay:-.15s'),
        hops(1.4, 0.3),
        arms(20, -20),
      ),
    type: (f, _T, opts) =>
      M(laptop(f, W(f, 'type', opts), 0.18), {
        held: '<circle class="lt" cx="48" cy="17" r="1.8"/>',
        css: A('.lt', '0%,49%{fill:#ff453a}50%,100%{fill:#30d158}', 1, 'steps(1)'),
      }),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.triple(f), { face: 'happy' }),
    error: (f) =>
      M(
        S('.r-la', 'rotate(-42deg)'),
        A(
          '.r-ra',
          '0%,100%{transform:translate(-4px,-20px) rotate(-25deg)}50%{transform:translate(-6px,-22px) rotate(-10deg)}',
          0.35,
        ),
        A('.r-body', '50%{transform:rotate(-4deg)}', 1.2),
        { front: `<g class="bg">${lbl('😅', 46, -4, f.to, 10)}</g>`, css: pop('.bg', 1.6), face: 'wink' },
      ),
    sleep: (f) => M(hops(0.8, 2), arms(-42, 42), zzz(f.to), { face: 'happy' }),
  },
  blank: {
    idle: (f, T) =>
      M(breathe(3.2 * T), arms(-38, 38), {
        back: `<path class="gl" d="M-14 20h68M20 -16v64" stroke="${f.from}" stroke-width=".5" stroke-dasharray="2 2"/>`,
        css: fadeLoop('.gl', 4),
      }),
    wave: (_f, T) => M(arms(-38, 38), swing('ra', -42, -68, 0.8 * T), breathe(3 * T)),
    think: (f, _T, opts) => M(arms(-38, 38), bub(f, W(f, 'think', opts)), { face: 'closed', noOwn: true }),
    ask: (f, T, opts) => M(arms(-38, -42), tilt(6, 3 * T), bub(f, W(f, 'ask', opts))),
    raise: (f) =>
      M(
        S('.r-la', 'rotate(-38deg)'),
        A('.r-ra', '0%,100%{transform:rotate(-66deg)}50%{transform:rotate(-74deg)}', 1.4),
        A('.sg', 'to{transform:translateY(-1.4px)}', 1.4, 'ease-in-out', 'alternate'),
        {
          held: `<g class="sg"><path d="M39 2v14" stroke="#d8dde6" stroke-width="1.2"/><rect x="30" y="-9.5" width="18" height="11.5" rx="1.4" fill="#fff" stroke="#d8dde6"/><circle cx="39" cy="-3.8" r="1.3" fill="${f.to}"/></g>`,
        },
      ),
    wait: (f, T) =>
      M(breathe(3.2 * T), arms(-38, 38), {
        back: `<path class="gl" d="M-14 20h68M20 -16v64" stroke="${f.from}" stroke-width=".5" stroke-dasharray="2 2"/>`,
        css: fadeLoop('.gl', 3),
        face: 'closed',
      }),
    type: (f, T, opts) =>
      M(laptop(f, W(f, 'type', opts), 2.2 * T, 'ease-in-out', { pause: true }), {
        css: A('.cu', '0%,40%{transform:scaleX(1)}60%,100%{transform:scaleX(.3)}', 2.2),
      }),
    carry: (f, T, opts) =>
      M(
        gait(f, T, 1.3),
        load(f, W(f, 'carry', opts), 24, {
          inner: `<rect x="11" y="-11" width="18" height="6" rx="1" fill="${f.from}" opacity=".35"/>`,
        }),
      ),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.float(f), { face: 'happy' }),
    error: (f) =>
      M(
        S('.r-la', 'translate(6px,-1px) rotate(12deg)'),
        S('.r-ra', 'translate(-6px,-1px) rotate(-12deg)'),
        A('.r-body', '50%{transform:rotate(-3deg)}', 1.4),
        {
          back: `<path d="M-12 18l64 6M18 -16l4 64" stroke="${f.from}" stroke-width=".7" stroke-dasharray="2 2"/>`,
          face: 'closed',
        },
      ),
    sleep: (f) =>
      M(S('.r-body', 'rotate(-10deg)'), arms(-36, 36), breathe(4), zzz(f.to, 'z', 4), { face: 'closed' }),
  },
  no: {
    idle: () => M(arms(-48, 48), A('.r-body', '50%{transform:translateY(-.3px)}', 3)),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,40%{transform:rotate(42deg)}48%,80%{transform:rotate(-76deg)}86%,100%{transform:rotate(42deg)}',
          1.8,
          'cubic-bezier(.7,0,.3,1)',
        ),
      ),
    think: (f, _T, opts) => M(ARMS.cross, bub(f, W(f, 'think', opts))),
    ask: (f, _T, opts) => M(arms(-42, -50), S('.r-lean', 'rotate(4deg)'), bub(f, W(f, 'ask', opts))),
    raise: () =>
      M(
        S('.r-la', 'rotate(-42deg)'),
        A('.r-ra', '0%,100%{transform:rotate(-68deg)}50%{transform:rotate(-78deg)}', 1.4),
        A('.sg', '0%,100%{transform:none}50%{transform:rotate(-6deg)}', 1.4),
        '.sg{transform-origin:39px 16px}',
        {
          held: `<g class="sg"><path d="M39 2v14" stroke="#ec7300" stroke-width="1.4"/><rect x="32" y="-11" width="14" height="13" rx="2" fill="#ff453a"/>${lbl('✕', 39, -4.5, '#fff', 8)}</g>`,
        },
      ),
    wait: (f) =>
      M(arms(-42, -16), {
        held: `<g transform="translate(27 4)"><rect x="11" y="16" width="18" height="20" rx="1.6" fill="#fff" stroke="${f.to}"/><path d="M14 21h12M14 26h12M14 31h12" stroke="#c9d1dd"/><path class="x1" d="M13 21h14" stroke="#ff453a" stroke-width="1.2"/><path class="x2" d="M13 26h14" stroke="#ff453a" stroke-width="1.2"/></g>`,
        css:
          '.x1,.x2{stroke-dasharray:14;transform-box:fill-box}' +
          A('.x1', '0%{stroke-dashoffset:14}30%,100%{stroke-dashoffset:0}', 3) +
          A('.x2', '0%,40%{stroke-dashoffset:14}70%,100%{stroke-dashoffset:0}', 3),
      }),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.2, 'cubic-bezier(.7,0,.3,1)', {
          extraScreen:
            '<path d="M35 19h10M35 22h8" stroke="#ff453a" stroke-width="1.3" stroke-linecap="round"/>',
        }),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.stamp(f), { face: 'happy' }),
    error: (_f, _T, opts) =>
      M(
        S('.r-la', 'rotate(-42deg)'),
        A(
          '.r-ra',
          '0%,15%{transform:rotate(42deg)}25%,85%{transform:rotate(-58deg)}100%{transform:rotate(42deg)}',
          1.6,
          'cubic-bezier(.7,0,.3,1)',
        ),
        A('.r-root', '0%,18%{transform:none}22%{transform:translateY(1.5px)}26%,100%{transform:none}', 1.6),
        {
          held: `<g class="bg"><path d="M40 16l6-7" stroke="#ec7300" stroke-width="1.4"/><g transform="translate(38 -4)"><path d="M4 0h7l3 3v7l-3 3H4l-3-3V3z" fill="#ff453a" stroke="#fff" stroke-width=".8"/>${lbl(opts.compact ? '!' : 'STOP', 7.5, 6.6, '#fff', opts.compact ? 8 : 4.2)}</g></g>`,
          css: pop('.bg', 1.6, 12, 85),
        },
      ),
    sleep: (f) =>
      M(
        lyingDown(-85),
        arms(-35, 35),
        {
          held: `<rect x="11" y="4" width="18" height="15" rx="2" fill="#fff" stroke="${f.to}" stroke-width="1.1"/><path d="M14 9h12M14 13h9" stroke="#ff5f57" stroke-width="1.2" stroke-linecap="round"/>`,
        },
        zzz(f.to),
        { face: 'closed' },
      ),
  },
  abacus: {
    idle: () =>
      M(
        ticks(1, 1),
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,80%{transform:rotate(42deg)}86%,92%{transform:translate(-5px,-12px) rotate(-32deg)}100%{transform:rotate(42deg)}',
          3,
          'steps(1)',
        ),
      ),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%{transform:rotate(42deg)}15%{transform:rotate(-55deg)}30%{transform:rotate(-76deg)}45%{transform:rotate(-55deg)}60%{transform:rotate(-76deg)}75%,100%{transform:rotate(42deg)}',
          2,
          'steps(1)',
        ),
      ),
    think: (f, _T, opts) => M(arms(-42, -58), ticks(1, 1), bub(f, W(f, 'think', opts))),
    ask: (f, _T, opts) => M(arms(-42, -40), bub(f, W(f, 'ask', opts)), ticks(2, 1.2)),
    raise: (f, _T, opts) =>
      M(raiseSign(f, W(f, 'raise', opts), 0.6, { bg: '#fff', fg: f.to }), {
        held: `<g class="sg"><path d="M39 2v14" stroke="${f.to}" stroke-width="1.4"/><rect x="30" y="-9.5" width="18" height="11" rx="2.4" fill="#fff" stroke="${f.to}"/><rect x="33" y="-3" width="2.4" height="3" fill="${f.from}"/><rect x="37.5" y="-5.5" width="2.4" height="5.5" fill="${f.to}"/><rect x="42" y="-7.5" width="2.4" height="7.5" fill="#30d158"/></g>`,
      }),
    wait: (f) =>
      M(arms(-42, 42), {
        front: `<g><path d="M-12 32h12" stroke="#b8c0cc"/>${[0, 1, 2, 3].map((i) => `<circle class="bd bd${i}" cx="${-11 + i * 3}" cy="32" r="1.4" fill="${f.to}" stroke="#fff" stroke-width=".5"/>`).join('')}</g>`,
        css: [0, 1, 2, 3]
          .map((i) =>
            A(
              `.bd${i}`,
              `0%,${i * 20}%{transform:none}${i * 20 + 10}%,100%{transform:translateX(${4 - i}px)}`,
              3,
              'steps(1)',
            ),
          )
          .join(''),
      }),
    type: (f, _T, opts) => M(laptop(f, W(f, 'type', opts), 0.25, 'steps(1)')),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) =>
      M(HOPS.precise(f), {
        front:
          '<path class="ln" d="M-10 30l6-4 5 2 7-8" fill="none" stroke="#30d158" stroke-width="1.6" stroke-linecap="round"/>',
        css: `.ln{stroke-dasharray:24}${A('.ln', '0%,20%{stroke-dashoffset:24}60%,100%{stroke-dashoffset:0}', 1.4, 'linear')}`,
        face: 'happy',
      }),
    error: (_f, _T, opts) =>
      M(arms(48, -48), shake(1.2, 0.5), {
        front:
          [0, 1, 2, 3]
            .map(
              (i) =>
                `<circle class="sc sc${i}" cx="${10 + i * 7}" cy="8" r="1.8" fill="#ffd84a" stroke="#0a82a8" stroke-width=".7"/>`,
            )
            .join('') +
          `<g class="bg"><rect x="34" y="-11.5" width="19" height="10.5" rx="2.4" fill="#ff453a"/>${lbl(opts.compact ? '!' : '÷ 0', 43.5, -6.2, '#fff', 6.4)}</g>`,
        css:
          [0, 1, 2, 3]
            .map((i) =>
              A(
                `.sc${i}`,
                `0%,15%{transform:none;opacity:1}85%,100%{transform:translate(${(i - 1.5) * 9}px,22px);opacity:0}`,
                1.4,
                'cubic-bezier(.5,0,1,.5)',
              ),
            )
            .join('') + pop('.bg', 1.4, 5, 90),
        face: 'x',
      }),
    sleep: (f) =>
      M(
        arms(-42, 42),
        A('.r-body', '0%,100%{transform:none}50%{transform:rotate(6deg) translateY(1px)}', 4, 'steps(4)'),
        zzz(f.to),
        { face: 'closed' },
      ),
  },
  invert: {
    idle: (f) =>
      M(
        ARMS.hug,
        A('.r-root', '25%{transform:translateX(-.5px)}75%{transform:translateX(.5px)}', 0.3, 'linear'),
        hourglass(f.to, 4),
      ),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%{transform:rotate(42deg)}20%{transform:rotate(-48deg)}35%{transform:rotate(-15deg)}55%{transform:rotate(-70deg)}75%,100%{transform:rotate(42deg)}',
          2.4,
        ),
      ),
    think: (f, _T, opts) => M(ARMS.hug, shake(0.5, 0.4), bub(f, W(f, 'think', opts))),
    ask: (f, _T, opts) => M(ARMS.hug, S('.r-lean', 'rotate(-6deg)'), bub(f, W(f, 'ask', opts)), sweat()),
    raise: (f, _T, opts) =>
      M(
        raiseSign(f, W(f, 'raise', opts), 0.4, { bg: '#fff3cd', fg: '#b25e00', bd: '#f59f00' }),
        sweat(30, -2),
      ),
    wait: (f) =>
      M(
        ARMS.hug,
        A('.r-root', '25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}', 0.25, 'linear'),
        hourglass(f.to, 1.2),
      ),
    type: (f, _T, opts) => M(laptop(f, W(f, 'type', opts), 0.2), look(4)),
    carry: (f, T) =>
      M(gait(f, T, 1.2), S('.r-la', 'rotate(-42deg)'), S('.r-ra', 'rotate(-68deg)'), {
        held: `<g><path d="M39 0v18" stroke="#8d6e63" stroke-width="1.3"/><ellipse cx="39" cy="-4" rx="5.5" ry="4" fill="#fff" fill-opacity=".6" stroke="${f.to}" stroke-dasharray="1.4 1.2"/></g>`,
      }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.relief(f), { face: 'happy' }),
    error: (f, _T, opts) =>
      M(
        arms(28, -28),
        A(
          '.r-body',
          '0%,100%{transform:none}30%,45%{transform:rotate(4deg)}60%,75%{transform:rotate(-4deg)}',
          1.6,
        ),
        bang(opts.compact ? '!' : '早说!', f.to, 1.6),
        { face: 'open' },
      ),
    sleep: (f) => M(ARMS.hug, hourglass(f.to, 99), breathe(4), zzz(f.to), { face: 'closed' }),
  },
  sentry: {
    idle: () =>
      M(arms(-42, 42), sway(5, 3), {
        held: '<circle class="an" cx="20" cy="-3" r="1.6" fill="#ff453a"/>',
        css: A('.an', '50%{opacity:.2}', 1, 'steps(1)'),
      }),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,20%{transform:rotate(42deg)}35%,80%{transform:rotate(-68deg)}100%{transform:rotate(42deg)}',
          2,
        ),
      ),
    think: (f) =>
      M(arms(-42, 42), {
        front: `<g>${bubble(f.to, '')}<circle cx="42.25" cy="-7.6" r="4" fill="none" stroke="${f.to}" stroke-width=".6"/><path class="sw2" d="M42.25 -7.6l0 -4" stroke="${f.to}" stroke-width="1.2"/></g>`,
        css: `.sw2{transform-origin:42.25px -7.6px}${A('.sw2', 'to{transform:rotate(360deg)}', 1.6, 'linear')}`,
      }),
    ask: (f, _T, opts) => M(arms(-42, 42), look(1.2), bub(f, W(f, 'ask', opts))),
    raise: (f) =>
      M(
        S('.r-la', 'rotate(-42deg)'),
        A('.r-ra', '0%,100%{transform:rotate(-66deg)}50%{transform:rotate(-76deg)}', 0.8),
        {
          held: `<g class="sg"><path d="M39 2v14" stroke="${ink(f)}" stroke-width="1.4"/><path d="M39 -14l6.8 2.6v4.4c0 3.8-2.9 6.2-6.8 7.5-3.9-1.3-6.8-3.7-6.8-7.5v-4.4z" fill="#fff" stroke="${f.to}" stroke-width="1.1"/><path d="M39 -10.8v4.6M39 -4.2v.2" stroke="#ff9f0a" stroke-width="1.5" stroke-linecap="round"/></g>`,
        },
      ),
    wait: () =>
      M(arms(-45, 45), {
        held: '<circle class="an" cx="20" cy="-3" r="1.6" fill="#ff453a"/>',
        css: A('.an', '50%{opacity:.2}', 2, 'steps(1)'),
      }),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.22, 'ease-in-out', {
          screenBg: '#121a2a',
          screenFg: '#7cf0c4',
          screenBd: '#5c6f91',
        }),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.salute(f), { face: 'happy' }),
    error: () =>
      M(shake(1.2, 0.5), arms(36, -36), {
        held: '<g class="sr"><rect x="16" y="-8" width="8" height="6" rx="3" fill="#ff453a"/><path d="M20 -5l-14-6M20 -5l14-6" stroke="#ff453a" stroke-width="2" opacity=".5"/></g>',
        css: `.sr path{transform-origin:20px -5px}${A('.sr path', 'to{transform:rotate(360deg)}', 0.6, 'linear')}`,
        face: 'x',
      }),
    sleep: (f) => M(arms(-45, 45), breathe(4), zzz(ink(f), 'z'), { face: 'wink' }),
  },
  spring: {
    idle: (f) =>
      M(hops(2, 0.6), arms(24, -24), {
        back: `<path d="M15 50l10-1.5-10-1.5 10-1.5-10-1.5" stroke="${f.from}" stroke-width="1.2" fill="none"/>`,
      }),
    wave: () =>
      M(
        A('.r-root', '0%,100%{transform:none}20%{transform:translateY(-6px)}40%{transform:none}', 1.4),
        swing('ra', -35, -75, 0.25),
        S('.r-la', 'rotate(24deg)'),
      ),
    think: (f, _T, opts) => M(hops(1, 1.2), arms(24, -56), bub(f, W(f, 'think', opts))),
    ask: (f, _T, opts) => M(hops(1.6, 0.8), tilt(-8, 1.6), arms(24, -46), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) => M(raiseSign(f, W(f, 'raise', opts), 0.7, { la: 24 }), hops(1.2, 0.6)),
    wait: () => M(hops(2.4, 0.5), arms(24, -24)),
    type: (f, _T, opts) => M(laptop(f, W(f, 'type', opts), 0.15), hops(1, 0.5)),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 24),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.boing(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-body',
          '0%,10%{transform:none}25%,55%{transform:scale(1.32,.46)}70%{transform:scale(.9,1.15)}85%,100%{transform:none}',
          2,
        ),
        arms(48, -48),
        {
          front: `<g class="ba">${lbl('+HP', 44, -4, '#30d158', 6.5)}</g>`,
          css: pop('.ba', 2, 55, 95),
          face: 'x',
        },
      ),
    sleep: (f) =>
      M(
        S('.r-body', 'scale(1.08,.85)'),
        arms(-32, 32),
        A('.r-root', '50%{transform:translateY(.8px)}', 3),
        zzz(f.to),
        { face: 'closed' },
      ),
  },
  compass: {
    idle: () => M(sway(4, 2.4), arms(-42, 42)),
    wave: () => M(sway(2, 2.4), arms(-42, 42), swing('ra', -42, -74, 0.5)),
    think: (f, _T, opts) =>
      M(arms(-42, -56), bub(f, W(f, 'think', opts)), {
        css: `${A('.fx-c', '0%{transform:rotate(-30deg)}60%,100%{transform:rotate(0)}', 2)}.fx-c{transform-box:fill-box;transform-origin:center}`,
      }),
    ask: (f, _T, opts) =>
      M(
        arms(-42, -45),
        A('.r-ra', '0%,100%{transform:rotate(-45deg)}50%{transform:rotate(-65deg)}', 1.6),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f) => M(raiseFlag(f, f.from, 1.4)),
    wait: (_f, T) => M(sway(6, 2.8 * T), arms(-42, 42)),
    type: (f, _T, opts) =>
      M(laptop(f, W(f, 'type', opts), 0.22), {
        back: `<path class="rt" d="M-14 44q8-6 16-2t14-4" fill="none" stroke="${f.from}" stroke-width="1" stroke-dasharray="30"/>`,
        css: A('.rt', 'from{stroke-dashoffset:30}to{stroke-dashoffset:0}', 2.4, 'linear'),
      }),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.flag(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-root',
          '0%,100%{transform:none}30%{transform:translate(-3px,0)}65%{transform:translate(3px,-4px) rotate(-6deg)}',
          2.2,
        ),
        arms(-35, 35),
        {
          back: '<path d="M-10 46q14-14 30-14t28 10" fill="none" stroke="#30d158" stroke-width="1.2" stroke-dasharray="2.4 2"/>',
          front: `<g class="bg"><circle cx="49" cy="36" r="5" fill="#ff453a"/>${lbl('✕', 49, 36.2, '#fff', 6.5)}</g>`,
          css: pop('.bg', 2.2, 5, 90),
        },
      ),
    sleep: (f) => M(arms(-42, 42), breathe(4), zzz(f.to), { face: 'closed' }),
  },
  loop: {
    idle: (f) =>
      M(sway(2, 3), arms(-42, 38), {
        held: `<g transform="translate(36 22)"><rect x="0" y="0" width="9" height="12" rx="1.4" fill="#fff" stroke="${f.to}" stroke-width="1"/><path d="M2 4h5M2 7h4" stroke="#c9d1dd" stroke-width="1" stroke-linecap="round"/><rect x="6" y="0" width="1.6" height="4" fill="#ff453a"/></g>`,
      }),
    wave: () =>
      M(swing('ra', -42, -78, 0.2), S('.r-la', 'rotate(-42deg)'), hops(1.2, 0.4), hearts(), {
        face: 'happy',
      }),
    think: (f, _T, opts) =>
      M(arms(-42, -56), bub(f, W(f, 'think', opts)), {
        css: `.fx-c{transform-box:fill-box;transform-origin:center}${A('.fx-c', 'to{transform:rotate(-360deg)}', 2, 'linear')}`,
      }),
    ask: (f, _T, opts) => M(S('.r-lean', 'rotate(6deg)'), arms(-42, -48), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) => M(raiseSign(f, W(f, 'raise', opts), 0.7)),
    wait: (f) =>
      M(arms(-42, 32), {
        held: `<g transform="translate(35 20)"><rect x="0" y="0" width="11" height="14" rx="1.4" fill="#fff" stroke="${f.to}" stroke-width="1"/><path class="pn" d="M2 4h7M2 7h7M2 10h4" stroke="#d8342c" stroke-width="1" stroke-dasharray="8"/></g>`,
        css:
          A('.pn', 'from{stroke-dashoffset:8}to{stroke-dashoffset:0}', 2, 'linear') +
          A('.r-ra', '0%,100%{transform:rotate(32deg)}50%{transform:rotate(22deg)}', 0.35),
      }),
    type: (f, _T, opts) =>
      M(laptop(f, W(f, 'type', opts), 0.2), {
        front: `<g class="b1">${lbl('•', 52, 10, '#30d158', 8)}</g><g class="b2">${lbl('•', 52, 10, '#30d158', 8)}</g>`,
        css: rise('.b1', 1.4, -12) + rise('.b2', 1.4, -12, 0.7),
      }),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.hearts(f), { face: 'happy' }),
    error: (f) =>
      M(arms(-42, 24), {
        held: `<g transform="translate(35 20)"><rect x="0" y="0" width="11" height="14" rx="1.4" fill="#fff" stroke="${f.to}" stroke-width="1"/><path d="M2 4h7M2 7h5" stroke="#ff9f0a" stroke-width="1"/></g><g class="bg"><path d="M41 18l5-8" stroke="#ff9f0a" stroke-width="2" stroke-linecap="round"/></g>`,
        css:
          A('.r-ra', '0%,100%{transform:rotate(24deg)}50%{transform:rotate(8deg)}', 0.28) +
          A('.bg', '50%{transform:translate(-1px,2px)}', 0.28),
      }),
    sleep: (f) =>
      M(
        ARMS.hug,
        {
          held: `<rect x="13" y="27" width="14" height="10" rx="1.4" fill="#fff" stroke="${f.to}" stroke-width="1"/><path d="M16 31h8" stroke="#d8342c" stroke-width="1"/>`,
        },
        breathe(4),
        zzz(f.to),
        { face: 'closed' },
      ),
  },
}
