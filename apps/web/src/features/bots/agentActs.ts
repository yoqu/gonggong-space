import {
  A,
  type ActFn,
  armKeys,
  arms,
  bang,
  bob,
  breathe,
  bub,
  carry,
  dizzy,
  fadeLoop,
  float,
  footTap,
  hops,
  laptop,
  look,
  lyingDown,
  M,
  pop,
  raiseFlag,
  raiseSign,
  rise,
  run,
  S,
  shake,
  steam,
  sway,
  swing,
  ticks,
  tilt,
  W,
  zzz,
} from './rigBuilders'
import { HOPS } from './rigHops'
import { ARMS, bubble, fitSize, IDLES, ink, lbl, type RigActResult, star } from './rigPrimitives'

const sparkle = (c: string, d = 1.6): RigActResult => ({
  css: `${A('.sk', '0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}', d)}.sk{transform-box:fill-box;transform-origin:center}`,
  front: `<g class="sk">${star(-6, 4, 2.4, c)}</g>`,
})

export const AGENT_SPEC: Record<string, Record<string, ActFn>> = {
  'agent-claude': {
    idle: (f) => M(breathe(2.4), arms(-42, 42), sparkle(f.from, 2.4)),
    wave: (f) =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%,100%{transform:rotate(42deg)}40%{transform:rotate(-76deg)}60%{transform:rotate(-56deg)}',
          2,
        ),
        sparkle(f.from),
      ),
    think: (f, _T, opts) =>
      M(arms(-42, -56), bub(f, W(f, 'think', opts)), '.spark{animation-duration:30s!important}', {
        own: true,
      }),
    ask: (f, _T, opts) => M(tilt(8, 2.4), arms(-42, -46), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) =>
      M(raiseSign(f, W(f, 'raise', opts), 1.1, { bg: '#fff5ef', fg: f.to }), sparkle(f.from)),
    wait: (f) => M(breathe(3), arms(-42, 42), sparkle(f.from, 3)),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.22, 'ease-in-out', { screenBg: '#fff5ef', screenFg: f.to }),
        '.spark{animation-duration:3s!important}',
        { own: true },
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.sparkspin(f), { face: 'happy' }),
    error: (f, _T, opts) =>
      M(
        arms(28, -28),
        A('.r-body', '50%{transform:translateY(1px) scale(1,.97)}', 1.2),
        A('.spark', '0%,100%{opacity:1}50%{opacity:.3}', 0.4, 'steps(1)'),
        bang(W(f, 'error', opts), '#ff453a', 1.4),
        { own: true, face: 'x' },
      ),
    sleep: (f) => M(arms(-44, 44), breathe(4), '.spark{opacity:.45}', zzz(f.to), { face: 'closed' }),
  },
  'agent-codex': {
    idle: () => M(ticks(1, 1.2), arms(-42, 42)),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%{transform:rotate(42deg)}25%{transform:rotate(-56deg)}50%{transform:rotate(-78deg)}75%{transform:rotate(-56deg)}100%{transform:rotate(42deg)}',
          1.6,
          'steps(1)',
        ),
      ),
    think: (f) =>
      M(arms(-42, 42), {
        front: `<g>${bubble(f.to, '')}${[0, 1, 2].map((i) => `<circle class="ld ld${i}" cx="${38 + i * 4}" cy="-7.6" r="1.2" fill="${f.to}"/>`).join('')}</g>`,
        css: [0, 1, 2]
          .map((i) =>
            A(`.ld${i}`, `0%,${i * 25}%{opacity:.2}${i * 25 + 1}%,100%{opacity:1}`, 1.2, 'steps(1)'),
          )
          .join(''),
      }),
    ask: (f, _T, opts) =>
      M(arms(-42, 42), bub(f, W(f, 'ask', opts)), A('.fx-c', '50%{opacity:0}', 0.6, 'steps(1)')),
    raise: (f, _T, opts) =>
      M(
        raiseSign(f, `> ${W(f, 'raise', opts)}`, 0.5, {
          bg: '#10203a',
          fg: '#30d158',
          bd: '#5c66ff',
          pole: '#5c66ff',
        }),
        '.sg,.r-ra{animation-timing-function:steps(1)!important}',
      ),
    wait: (f) =>
      M(arms(-42, 42), {
        front: `<rect x="-12" y="34" width="14" height="3" rx="1" fill="none" stroke="${ink(f)}" stroke-width=".6"/><rect class="pb" x="-11.5" y="34.5" width="13" height="2" fill="${f.from}"/>`,
        css: `.pb{transform-origin:-11.5px 35px}${A('.pb', 'from{transform:scaleX(0)}to{transform:scaleX(1)}', 3, 'steps(6)')}`,
      }),
    type: (f) =>
      M(laptop(f, '$_', 0.1, 'steps(1)', { screenBg: '#10203a', screenFg: '#30d158', screenBd: '#5c66ff' }), {
        back: `<g class="tl">${lbl('$ _', -8, 16, f.from, 5)}</g>`,
        css: A('.tl', '50%{opacity:.3}', 0.5, 'steps(1)'),
      }),
    carry: (f, T, opts) =>
      carry(f, T, W(f, 'carry', opts), 26, { bg: '#10203a', fg: '#30d158', bd: '#5c66ff' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.prompt(f), { face: 'happy' }),
    error: (_f, _T, opts) =>
      M(
        arms(-42, 42),
        A(
          '.r-root',
          '0%{transform:none}20%{transform:translateX(2px)}40%{transform:translateX(-2px)}60%{transform:translate(1px,-1px)}80%,100%{transform:none}',
          0.4,
          'steps(1)',
        ),
        bang(opts.compact ? '!' : 'ERR', '#ff453a', 0.8),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(arms(-44, 44), { css: '.cur{animation-duration:3s!important}' }, zzz(f.to, 'z'), {
        face: 'closed',
        own: true,
      }),
  },
  'agent-gemini': {
    idle: () => M(float(3, 5, 2.4), arms(18, -18)),
    wave: (f) => M(float(3, 5, 2.4), swing('la', 20, 68, 0.3), swing('ra', -20, -68, 0.3), sparkle(f.from)),
    think: (f, _T, opts) =>
      M(float(3, 4, 3), arms(18, -56), bub(f, W(f, 'think', opts)), {
        front: `<g class="ob">${star(42, -16, 1.6, f.from)}</g>`,
        css: `.ob{transform-origin:42px -8px}${A('.ob', 'to{transform:rotate(360deg)}', 2, 'linear')}`,
        own: true,
      }),
    ask: (f, _T, opts) =>
      M(
        float(3, 5, 2),
        A('.r-body', '0%,100%{transform:rotate(0)}50%{transform:rotate(12deg)}', 2),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f, _T, opts) =>
      M(float(3, 5, 2.4), raiseSign(f, W(f, 'raise', opts), 0.9, { la: 18 }), sparkle(f.from)),
    wait: () =>
      M(
        float(2, 5, 3.6),
        A('.r-body', '25%{transform:rotate(-6deg)}75%{transform:rotate(6deg)}', 3.6),
        arms(18, -18),
      ),
    type: (f, _T, opts) =>
      M(
        float(2, 3, 2.4),
        laptop(f, W(f, 'type', opts), 0.2, 'ease-in-out', {
          screenBg: '#f4f8ff',
          screenBd: '#7fb2ff',
          extraScreen: '<path d="M41 16.5l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z" fill="#3d5fe0"/>',
        }),
        sparkle(f.from),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26, { hover: true }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.twinkle(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-root',
          '0%,10%{transform:translateY(-5px)}35%{transform:translateY(0)}45%{transform:translateY(-3px)}55%,100%{transform:none}',
          2,
          'cubic-bezier(.5,0,1,.5)',
        ),
        arms(48, -48),
        bang('!'),
        {
          face: 'x',
        },
      ),
    sleep: (f) =>
      M(float(3, 4, 4), S('.r-lean', 'rotate(-16deg)'), arms(22, -22), zzz(f.to), {
        face: 'closed',
        front: `<g class="sk">${star(50, 20, 1.6, f.from)}</g>`,
        css: A('.sk', '50%{opacity:.2}', 2),
      }),
  },
  'agent-codebuddy': {
    idle: () => M(sway(5, 1.6), arms(-38, 38)),
    wave: () => M(sway(8, 0.8), arms(-38, 38), swing('ra', -38, -76, 0.4)),
    think: (f, _T, opts) =>
      M(A('.r-body', '50%{transform:rotate(-8deg)}', 3), arms(-38, -56), bub(f, W(f, 'think', opts)), {
        own: true,
      }),
    ask: (f, _T, opts) => M(tilt(14, 2), arms(-38, -40), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) => M(sway(4, 1.2), raiseSign(f, W(f, 'raise', opts), 0.7, { la: -38 })),
    wait: () =>
      M(A('.r-root', '0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}', 1.4), arms(-38, 38)),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.6, 'ease-in-out', {
          pause: true,
          screenBg: '#f5f3ff',
          screenBd: '#6c4dff',
          extraScreen:
            '<rect x="34" y="17.5" width="9" height="1.8" rx=".8" fill="#2ea99d"/><rect x="34" y="20.5" width="13" height="1.8" rx=".8" fill="#6c4dff"/><rect x="34" y="23.5" width="7" height="1.8" rx=".8" fill="#2ea99d"/>',
        }),
        A('.r-body', '50%{transform:rotate(4deg)}', 0.6),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.nod(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-lean',
          '0%,15%{transform:none}35%,80%{transform:translateY(4px) rotate(-12deg) scale(1.05,.9)}100%{transform:none}',
          2.4,
        ),
        arms(46, -46),
        bang('!'),
        { face: 'x' },
      ),
    sleep: (f) => M(S('.r-body', 'rotate(12deg)'), arms(-42, 42), breathe(4), zzz(f.to), { face: 'closed' }),
  },
  'agent-pi': {
    idle: () => M(arms(-42, 42), bob(0.6, 1.2)),
    wave: () => M(arms(-42, 42), swing('ra', -42, -76, 0.3), hops(1.6, 0.6)),
    think: (f, _T, opts) =>
      M(arms(-42, -56), bub(f, W(f, 'think', opts)), {
        css: `.dot{transform-origin:22px 10px}${A('.dot', 'to{transform:rotate(360deg)}', 1.6, 'linear', '!important')}`,
      }),
    ask: () =>
      M(arms(-42, 42), {
        front: `<g class="qm"><rect x="26" y="-14" width="12" height="12" rx="1.6" fill="#fff" stroke="#475569" stroke-width="1"/>${lbl('?', 32, -8, '#262b36', 8.5)}</g>`,
        css: `.dot{opacity:0}${pop('.qm', 1.6, 0, 90)}`,
      }),
    raise: (f, _T, opts) =>
      M(
        raiseSign(f, opts.compact ? 'π?' : W(f, 'raise', opts), 0.6, { bd: '#525e73', pole: ink(f) }),
        hops(1, 0.5),
      ),
    wait: () => M(arms(-42, 42), hops(1.4, 0.5), '.dot{animation-duration:.5s!important}'),
    type: (f) =>
      M(
        laptop(f, 'π', 0.18, 'ease-in-out', { screenBd: '#525e73' }),
        '.dot{animation-duration:.4s!important}',
        { own: true },
      ),
    carry: (f, T) => carry(f, T, '3.14', 24, { bd: '#525e73' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.pidots(f), { face: 'happy' }),
    error: () =>
      M(
        arms(-42, 42),
        {
          css: A(
            '.dot',
            '0%,20%{transform:none}50%{transform:translate(8px,30px)}100%{transform:translate(24px,30px) rotate(360deg)}',
            1.6,
            'cubic-bezier(.5,0,1,.5)',
            '!important',
          ),
        },
        bang('!', '#ff453a', 1.6),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(arms(-44, 44), '.dot{animation:none!important;transform:translate(14px,26px)}', zzz(ink(f), 'z'), {
        face: 'closed',
      }),
  },
  'agent-deepseek': {
    idle: (f) =>
      M(float(2, 4, 2.6), A('.r-body', '50%{transform:rotate(-3deg)}', 2.6), arms(-18, 18), {
        front: `<circle class="bb1" cx="-4" cy="16" r="1.4" fill="none" stroke="${f.from}" stroke-width=".8"/>`,
        css: rise('.bb1', 2.2, -14),
      }),
    wave: () => M(float(2, 4, 2.6), swing('ra', -32, -68, 0.4), swing('la', 10, 32, 0.4)),
    think: (f) =>
      M(float(2, 3, 3), arms(-18, 18), {
        front: [0, 1, 2]
          .map(
            (i) =>
              `<circle class="tb tb${i}" cx="${38 + i * 3}" cy="2" r="${1 + i * 0.8}" fill="none" stroke="${f.from}" stroke-width=".8"/>`,
          )
          .join(''),
        css: [0, 1, 2].map((i) => rise(`.tb${i}`, 2.4, -12, i * 0.8)).join(''),
      }),
    ask: (f, _T, opts) => M(float(2, 4, 2), tilt(10, 2), arms(-18, 18), bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) => M(float(2, 4, 2.4), raiseSign(f, W(f, 'raise', opts), 0.7, { la: -18 })),
    wait: () =>
      M(float(2, 4, 4), A('.r-root', '50%{transform:translate(-2px,-4px) rotate(-3deg)}', 4), arms(-18, 18)),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.2, 'ease-in-out', {
          screenBg: '#eef4ff',
          screenBd: '#3552e8',
          screenFg: '#2845d6',
        }),
        float(1, 2, 2),
        {
          front: `<circle class="bb1" cx="48" cy="12" r="1.3" fill="none" stroke="${f.from}" stroke-width=".8"/>`,
          css: rise('.bb1', 1.8, -10),
        },
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.breach(f), { face: 'happy' }),
    error: () =>
      M(arms(38, -38), shake(1, 0.6), {
        front:
          '<g class="sp"><path d="M20 -2q-4-8-9-6M20 -2q4-8 9-6M20 -2v-9" stroke="#6fc3ff" stroke-width="1.4" fill="none" stroke-linecap="round"/></g>',
        css: pop('.sp', 1, 0, 70),
        face: 'x',
      }),
    sleep: (f) =>
      M(
        float(1, 2, 5),
        arms(-18, 18),
        {
          front: `<circle class="bb1" cx="40" cy="8" r="1.2" fill="none" stroke="${f.from}" stroke-width=".8"/>`,
          css: rise('.bb1', 4, -10),
        },
        zzz(f.to, 'z', 4),
        {
          face: 'closed',
        },
      ),
  },
  'agent-antigravity': {
    idle: (f) =>
      M(float(5, 7, 2.4), arms(24, -24), {
        back: `<ellipse class="gl" cx="20" cy="45" rx="10" ry="2" fill="${f.from}"/>`,
        css: fadeLoop('.gl', 1.2),
      }),
    wave: () => M(float(5, 7, 2.4), swing('ra', -38, -76, 0.5), S('.r-la', 'rotate(24deg)')),
    think: () =>
      M(
        '.r-root{transform-origin:20px 20px}',
        A(
          '.r-root',
          '0%{transform:translateY(-6px) rotate(0)}100%{transform:translateY(-6px) rotate(360deg)}',
          8,
          'linear',
        ),
        arms(24, -24),
        { own: true },
        '.r-shadow{transform:scale(.6)}',
      ),
    ask: (f, _T, opts) =>
      M(
        float(5, 7, 2),
        A('.r-root', '50%{transform:translateY(-7px) rotate(16deg)}', 2.4),
        arms(24, -24),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f, _T, opts) =>
      M(float(5, 7, 2.4), arms(24, -48), A('.sg', '50%{transform:translateY(-3px)}', 1.4), {
        held: `<g class="sg"><rect x="31" y="-11" width="18" height="11" rx="2.4" fill="#fff" stroke="${f.to}" stroke-width="1"/>${lbl(W(f, 'raise', opts), 40, -5.3, f.to, fitSize(W(f, 'raise', opts)))}</g>`,
      }),
    wait: () => M(float(5, 9, 3.6), arms(24, -24)),
    type: (f, _T, opts) =>
      M(
        float(4, 6, 2.4),
        laptop(f, W(f, 'type', opts), 0.2, 'ease-in-out', {
          screenBg: '#eef5ff',
          screenBd: '#2a5bd7',
          extraScreen: '<path d="M41 16.8l-3.2 4h2.1v3.6h2.2v-3.6h2.1z" fill="#2a5bd7"/>',
        }),
        {
          back: `<ellipse class="gl" cx="20" cy="45" rx="10" ry="2" fill="${f.from}"/>`,
          css: fadeLoop('.gl', 1.2),
        },
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26, { hover: true }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.flip(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-root',
          '0%,10%{transform:translateY(-7px)}30%{transform:translateY(0) scale(1.1,.85)}40%{transform:translateY(-2px)}50%,100%{transform:none}',
          2,
          'cubic-bezier(.5,0,1,.5)',
        ),
        arms(54, -54),
        bang('!'),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(
        '.r-root{transform-origin:20px 20px}',
        A(
          '.r-root',
          '0%,100%{transform:translateY(-6px) rotate(180deg)}50%{transform:translateY(-8px) rotate(180deg)}',
          4,
        ),
        arms(24, -24),
        zzz(f.to),
        { face: 'closed' },
      ),
  },
  'agent-opencode': {
    idle: () => M(ticks(0.8, 1.4), arms(-42, 42)),
    wave: () =>
      M(
        arms(-42, 42),
        armKeys(
          'ra',
          '0%{transform:rotate(42deg)}33%{transform:rotate(-35deg)}66%{transform:rotate(-78deg)}100%{transform:rotate(42deg)}',
          1.2,
          'steps(1)',
        ),
      ),
    think: (f) => M(arms(-42, 42), bub(f, '...'), A('.fx-c', '0%{opacity:.3}50%{opacity:1}', 1, 'steps(2)')),
    ask: (f, _T, opts) =>
      M(
        arms(-42, 42),
        A('.r-body', '0%{transform:none}50%{transform:rotate(10deg)}', 1.6, 'steps(1)'),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f, _T, opts) =>
      M(
        raiseSign(f, `[${W(f, 'raise', opts)}]`, 0.6, {
          bg: '#0a0a0a',
          fg: '#7cf0c4',
          bd: '#6e7681',
          pole: '#7c8594',
        }),
        '.sg,.r-ra{animation-timing-function:steps(1)!important}',
      ),
    wait: () =>
      M(arms(-42, 42), {
        front: `<rect x="44" y="28" width="12" height="9" rx="1.2" fill="#0a0a0a" stroke="#6e7681" stroke-width=".9"/>${lbl('&gt;_', 50, 32.5, '#7cf0c4', 4.6)}`,
        css: A('.r-body', '50%{opacity:.85}', 1.2, 'steps(1)'),
      }),
    type: (f) =>
      M(
        laptop(f, '[ ]', 0.16, 'steps(1)', { screenBg: '#0a0a0a', screenFg: '#7cf0c4', screenBd: '#6e7681' }),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26, { bd: '#6e7681' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.blocky(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-body',
          '0%{transform:none;opacity:1}25%{transform:translateX(2px);opacity:.6}50%{transform:translateX(-2px)}75%{transform:skewX(8deg);opacity:1}100%{transform:none}',
          0.5,
          'steps(1)',
        ),
        arms(-42, 42),
        bang('!'),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(
        arms(-42, 42),
        '.r-body{opacity:.42}',
        {
          held: '<circle class="sl" cx="32" cy="8" r="2" fill="#30d158"/>',
          css: A('.sl', '0%,100%{opacity:.2}50%{opacity:1}', 2.4),
        },
        zzz(ink(f), 'z', 4),
        { face: 'closed' },
      ),
  },
  'agent-qwen': {
    idle: () => M(sway(4, 2.4), arms(18, -18)),
    wave: () =>
      M(
        A(
          '.r-spin',
          '0%,40%{transform:scaleX(1)}50%{transform:scaleX(-1)}60%,100%{transform:scaleX(1)}',
          2.4,
        ),
        swing('ra', -35, -75, 0.3),
        S('.r-la', 'rotate(18deg)'),
      ),
    think: (f, _T, opts) =>
      M(
        A('.r-spin', '0%,100%{transform:scaleX(1)}50%{transform:scaleX(-1)}', 4),
        arms(18, -56),
        bub(f, W(f, 'think', opts)),
      ),
    ask: (f, _T, opts) =>
      M(
        A('.r-body', '0%,100%{transform:rotate(0)}50%{transform:rotate(-12deg)}', 1.6),
        arms(18, -46),
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f, _T, opts) => M(raiseSign(f, W(f, 'raise', opts), 0.7, { la: 18 }), sway(3, 1.6)),
    wait: () => M(sway(6, 3), arms(18, -18)),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.2, 'ease-in-out', {
          screenBg: '#eff4ff',
          screenBd: '#082dff',
          screenFg: '#082dff',
        }),
        A('.r-spin', '0%,78%{transform:scaleX(1)}88%{transform:scaleX(-1)}100%{transform:scaleX(1)}', 3.2),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.spin(f), { face: 'happy' }),
    error: (f) =>
      M(
        A('.r-spin', '0%{transform:rotate(0)}100%{transform:rotate(360deg)}', 1.2, 'linear'),
        arms(46, -46),
        dizzy(f.from),
        { face: 'x' },
      ),
    sleep: (f) => M(S('.r-lean', 'rotate(-14deg)'), arms(-36, 36), breathe(4), zzz(f.to), { face: 'closed' }),
  },
  'agent-kimi': {
    idle: () => M(IDLES.lean(1), ARMS.cool),
    wave: () =>
      M(
        S('.r-lean', 'rotate(-6deg)'),
        S('.r-la', 'translate(2px,6px) rotate(-55deg)'),
        armKeys(
          'ra',
          '0%,50%{transform:rotate(-56deg)}65%,85%{transform:rotate(-76deg)}100%{transform:rotate(-56deg)}',
          2,
        ),
      ),
    think: (f) =>
      M(ARMS.cool, S('.r-lean', 'rotate(-6deg)'), {
        front: `<g>${bubble(f.to, '')}<path d="M46 -9a3.6 3.6 0 1 1-4-4.2 2.8 2.8 0 0 0 4 4.2z" fill="#ffd84a"/></g>`,
      }),
    ask: (f, _T, opts) => M(S('.r-lean', 'rotate(-10deg)'), ARMS.cool, bub(f, W(f, 'ask', opts))),
    raise: (f, _T, opts) =>
      M(
        S('.r-lean', 'rotate(-6deg)'),
        raiseSign(f, W(f, 'raise', opts), 1.2, { la: -55, bd: '#6e7681', pole: ink(f) }),
      ),
    wait: () =>
      M(S('.r-lean', 'rotate(-12deg) translateX(-2px)'), ARMS.cool, footTap('rf', 0.5), {
        back: '<rect x="-13" y="2" width="4" height="44" rx="1.4" fill="#d0d7e2" stroke="#8b949e" stroke-width=".7"/><path d="M-16 46h9" stroke="#8b949e" stroke-width=".9" stroke-linecap="round"/>',
      }),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.22, 'ease-in-out', {
          oneHand: true,
          screenBg: '#161622',
          screenFg: '#ffd84a',
          screenBd: '#74748a',
        }),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26, { bd: '#6e7681' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.moon(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-lean',
          '0%,15%{transform:rotate(-6deg)}35%{transform:rotate(-35deg) translate(-4px,2px)}60%,100%{transform:rotate(-70deg) translate(-5px,5px)}',
          2,
          'cubic-bezier(.5,0,1,.5)',
        ),
        arms(56, -56),
        bang('!'),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(
        lyingDown(-80),
        ARMS.cool,
        { back: '<path d="M50 -2a7 7 0 1 1-7-8 5.4 5.4 0 0 0 7 8z" fill="#ffd84a"/>' },
        zzz(ink(f)),
        { face: 'closed' },
      ),
  },
  'agent-goose': {
    idle: () => M(look(3), arms(-32, 32)),
    wave: () => M(swing('la', -10, 58, 0.2), swing('ra', 10, -58, 0.2), { face: 'happy' }),
    think: (f, _T, opts) => M(look(2.4), arms(-32, 32), bub(f, W(f, 'think', opts))),
    ask: () =>
      M(tilt(14, 1.6), arms(24, -24), {
        front: `<g class="hk">${lbl('HONK?', 45, -6, '#ff9f0a', 5)}</g>`,
        css: pop('.hk', 1.6),
      }),
    raise: (f) =>
      M(
        swing('la', -10, 38, 0.3),
        raiseSign(f, 'HONK?', 0.6, { bg: '#fff8eb', fg: '#d47b00', bd: '#ff9f0a', pole: '#e08b1a' }),
      ),
    wait: () =>
      M(
        arms(-32, 32),
        A(
          '.r-la',
          '0%,80%{transform:rotate(-32deg)}85%,95%{transform:rotate(48deg)}90%,100%{transform:rotate(-32deg)}',
          3,
        ),
        A(
          '.r-ra',
          '0%,80%{transform:rotate(32deg)}85%,95%{transform:rotate(-48deg)}90%,100%{transform:rotate(32deg)}',
          3,
        ),
      ),
    type: (f, _T, opts) =>
      M(
        laptop(f, W(f, 'type', opts), 0.35, 'ease-in-out', {
          peck: true,
          screenBg: '#fff8eb',
          screenBd: '#e08b1a',
          screenFg: '#b86300',
        }),
      ),
    carry: (f, T, opts) => carry(f, T, W(f, 'carry', opts), 26, { bd: '#e08b1a', fg: '#b86300' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.flap(f), { face: 'happy' }),
    error: () =>
      M(swing('la', 10, 66, 0.12), swing('ra', -10, -66, 0.12), shake(1.4, 0.4), steam(0.6), {
        front: `<g class="hk">${lbl('HONK!', 45, -6, '#ff453a', 5.4)}</g>`,
        css: pop('.hk', 0.8, 0, 90),
        face: 'x',
      }),
    sleep: (f) =>
      M(
        S('.r-lean', 'rotate(22deg) translateY(2px)'),
        S('.r-ra', 'rotate(-42deg)'),
        S('.r-la', 'rotate(16deg)'),
        breathe(4),
        zzz(ink(f)),
        { face: 'closed' },
      ),
  },
  'agent-copilot': {
    idle: () =>
      M(
        A(
          '.r-root',
          '0%,100%{transform:translateY(-5px) rotate(-3deg)}50%{transform:translateY(-7px) rotate(3deg)}',
          2.4,
        ),
        ARMS.wing,
        '.r-shadow{transform:scale(.6);opacity:.5}',
      ),
    wave: () =>
      M(
        A(
          '.r-root',
          '0%,100%{transform:translateY(-6px) rotate(-14deg)}50%{transform:translateY(-6px) rotate(14deg)}',
          0.8,
        ),
        ARMS.wing,
        '.r-shadow{transform:scale(.6)}',
      ),
    think: (f, _T, opts) =>
      M(
        '.r-root{transform-origin:20px 30px}',
        A(
          '.r-root',
          '0%{transform:translate(-4px,-6px) rotate(-8deg)}25%{transform:translate(0,-8px)}50%{transform:translate(4px,-6px) rotate(8deg)}75%{transform:translate(0,-4px)}100%{transform:translate(-4px,-6px) rotate(-8deg)}',
          3,
          'linear',
        ),
        ARMS.wing,
        bub(f, W(f, 'think', opts)),
        '.r-shadow{transform:scale(.6)}',
      ),
    ask: (f, _T, opts) =>
      M(
        A('.r-root', '50%{transform:translateY(-6px) rotate(10deg)}', 1.6),
        ARMS.wing,
        bub(f, W(f, 'ask', opts)),
      ),
    raise: (f) =>
      M(
        S('.r-root', 'translateY(-5px)'),
        S('.r-la', 'rotate(-8deg) translate(-1px,-4px)'),
        raiseFlag(f, '#ff9f0a', 0.6),
      ),
    wait: () =>
      M(
        '.r-root{transform-origin:20px 20px}',
        A(
          '.r-root',
          '0%{transform:rotate(0) translateX(4px) rotate(0) translateY(-6px)}100%{transform:rotate(360deg) translateX(4px) rotate(-360deg) translateY(-6px)}',
          3,
          'linear',
        ),
        ARMS.wing,
        '.r-shadow{transform:scale(.6)}',
      ),
    type: (f, _T, opts) =>
      M(
        S('.r-root', 'translateY(-3px)'),
        laptop(f, W(f, 'type', opts), 0.24, 'ease-in-out', {
          screenBg: '#0d1117',
          screenBd: '#58a6ff',
          screenFg: '#58a6ff',
          extraScreen:
            '<path d="M34.5 22l3-2.5 3.5 1.5 4-3" fill="none" stroke="#58a6ff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
        }),
      ),
    carry: (f, T, opts) =>
      carry(f, T, W(f, 'carry', opts), 26, { hover: true, bg: '#0d1117', fg: '#58a6ff', bd: '#58a6ff' }),
    run: (f, T) => run(f, T),
    done: (f) => M(HOPS.barrel(f), { face: 'happy' }),
    error: () =>
      M(
        A(
          '.r-root',
          '0%{transform:translateY(-6px)}25%{transform:translate(1.4px,-5px) rotate(5deg)}50%{transform:translate(-1.4px,-7px) rotate(-5deg)}75%{transform:translate(1px,-6px)}100%{transform:translateY(-6px)}',
          0.3,
          'linear',
        ),
        ARMS.wing,
        {
          back: '<g class="sm" fill="#b8c0cc"><circle cx="-4" cy="20" r="2.4"/><circle cx="-9" cy="16" r="1.8"/></g>',
          css: A(
            '.sm',
            'from{transform:translateX(0);opacity:.9}to{transform:translateX(-6px);opacity:0}',
            0.8,
          ),
        },
        bang('!'),
        { face: 'x' },
      ),
    sleep: (f) =>
      M(arms(-28, 28), '.r-lf,.r-rf{transform:translateY(-1px)}', breathe(4), zzz(ink(f)), {
        face: 'closed',
      }),
  },
}
