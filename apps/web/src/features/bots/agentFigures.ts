import { AGENT_META, type AgentKind } from '@gonggong/protocol'
import { t } from '../../i18n'
import type { Persona } from './personas'

/*
 * The figure of each agent: its official mark redrawn as a white body on the brand's colours, with the personas' face,
 * gloves and feet. Marks and colours come from the agent registry (trademarks of their owners, see NOTICE).
 */

const W = '#fff'
const stroke = (c: string, w: number) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const eyes = (k: string, E: [number, number][], rx: number, ry: number) => {
  const [[x1, y1], [x2, y2]] = E as [[number, number], [number, number]]
  return `<ellipse cx="${x1}" cy="${y1}" rx="${rx}" ry="${ry}" fill="${k}"/><ellipse cx="${x2}" cy="${y2}" rx="${rx}" ry="${ry}" fill="${k}"/>`
}
const smile = (k: string, x: number, y: number, w: number) =>
  `<path d="M${x - w / 2} ${y}q${w / 2} ${w * 0.45} ${w} 0" ${stroke(k, 1.1)}/>`
const cheeks = (a: [number, number], b: [number, number], r = 0.8) =>
  `<circle cx="${a[0]}" cy="${a[1]}" r="${r}" fill="#ffb3c2"/><circle cx="${b[0]}" cy="${b[1]}" r="${r}" fill="#ffb3c2"/>`

const [MARK_CODEBUDDY, MARK_CODEBUDDY_EYES] = AGENT_META.codebuddy.mark
const [MARK_PI, MARK_PI_DOT] = AGENT_META.pi.mark
const mark = (d: string, x: number, y: number, s: number) =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="${d}" fill="${W}"/>`

/** One script for all of them: the marks differ, the work does not. */
const ACTS: Persona['acts'] = {
  idle: ['轻轻晃着，等你派活'],
  wave: ['挥手打招呼'],
  think: ['气泡里冒出省略号：在想', '…'],
  ask: ['歪头问一句', '?'],
  raise: ['举牌等你拍板', 'OK?'],
  wait: ['原地轻轻晃，等你回复', 'calm'],
  type: ['敲键盘，代码一行行冒出来', '{ }'],
  carry: ['扛着一个代码块', '代码'],
  run: ['小跑着去干活'],
  done: ['跳起来：搞定', '✓'],
  error: ['冒出感叹号，直冒汗', '!'],
  sleep: ['打个盹'],
}

type Figure = Omit<Persona, 'key' | 'name' | 'from' | 'to' | 'mix' | 'line' | 'acts'>

/** Agents without a figure of their own: the whole mark bobbing, a white disc in its middle carrying the face. */
const badge = (kind: AgentKind): Figure => {
  const E: [number, number][] = [
    [18.2, 19.6],
    [21.8, 19.6],
  ]
  return {
    tempo: 1,
    E,
    M: [20, 22.2],
    s: 0.6,
    open: (k) => eyes(k, E, 0.8, 1.05) + smile(k, 20, 22, 1.9),
    glyph: (_k, f) =>
      `<g class="badge">${AGENT_META[kind].mark.map((d) => mark(d, 8, 7, 1)).join('')}<circle cx="20" cy="20.6" r="4.8" fill="${W}"/>${f}</g>`,
    motion:
      '.badge{animation:bob calc(var(--t)*2.4s) ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1px)}}',
  }
}

const FIGURES: Record<AgentKind, Figure> = {
  claude: {
    tempo: 1,
    E: [
      [17.7, 18.4],
      [22.3, 18.4],
    ],
    M: [20, 21.2],
    s: 0.7,
    open: (k) => eyes(k, FIGURES.claude.E, 1, 1.25) + smile(k, 20, 21, 2.4),
    glyph: (_k, f) =>
      `<g class="spark">${mark(AGENT_META.claude.mark[0], 7.4, 6.4, 1.05)}</g><circle cx="20" cy="19" r="6.2" fill="${W}"/>${f}` +
      cheeks([15.9, 20.6], [24.1, 20.6], 0.7),
    motion:
      '.spark{transform-origin:20px 19px;animation:spin calc(var(--t)*9s) linear infinite}@keyframes spin{to{transform:rotate(360deg)}}',
  },
  codex: {
    tempo: 0.9,
    E: [
      [16.8, 18],
      [23.2, 18],
    ],
    M: [20, 22.4],
    s: 0.85,
    open: (k) =>
      eyes(k, FIGURES.codex.E, 1.2, 1.5) +
      `<rect class="cur" x="18" y="21.8" width="4" height="1.5" rx=".6" fill="${k}"/>`,
    glyph: (_k, f) =>
      `<g class="cloud">${mark(AGENT_META.codex.mark[0], 8, 7, 1)}${f}${cheeks([14.6, 21], [25.4, 21])}</g>`,
    motion:
      '.cur{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}' +
      '.cloud{transform-origin:20px 31px;animation:puff calc(var(--t)*2.4s) ease-in-out infinite}@keyframes puff{50%{transform:scale(1.04,.97)}}',
  },
  gemini: {
    tempo: 1,
    E: [
      [18, 18.4],
      [22, 18.4],
    ],
    M: [20, 21],
    s: 0.6,
    open: (k) => eyes(k, FIGURES.gemini.E, 0.85, 1.1) + smile(k, 20, 20.8, 2),
    glyph: (_k, f) =>
      `<g class="star">${mark(AGENT_META.gemini.mark[0], 5, 4, 1.25)}${f}</g>` +
      `<g class="twin">${mark(AGENT_META.gemini.mark[0], 28, 3, 0.3)}</g>`,
    motion:
      '.star{transform-origin:20px 19px;animation:tw calc(var(--t)*2.4s) ease-in-out infinite}@keyframes tw{50%{transform:scale(.93) rotate(6deg)}}' +
      '.twin{transform-origin:31.6px 6.6px;animation:pop calc(var(--t)*2.4s) ease-in-out infinite}@keyframes pop{0%,100%{transform:scale(.4);opacity:.4}50%{transform:scale(1);opacity:1}}',
  },
  codebuddy: {
    tempo: 0.9,
    // Its face is the coloured hollow under the white hood, the two bars its eyes.
    E: [
      [17, 25.1],
      [26.1, 20],
    ],
    M: [23.4, 26],
    s: 0.9,
    eyeInk: W,
    mouthInk: W,
    open: () =>
      `<g class="eyes">${mark(MARK_CODEBUDDY_EYES, -2, -3, 1.4)}</g><path transform="rotate(-29 23.4 26)" d="M22 25.6q1.4 1 2.8 0" ${stroke(W, 1.2)}/>`,
    glyph: (_k, f) => `<g class="hood">${mark(MARK_CODEBUDDY, -2, -3, 1.4)}${f}</g>`,
    motion:
      '.hood{transform-origin:20px 34px;animation:nod calc(var(--t)*2.4s) ease-in-out infinite}@keyframes nod{50%{transform:rotate(-4deg)}}' +
      '.eyes{transform-box:fill-box;transform-origin:center;animation:blink calc(var(--t)*3s) infinite}@keyframes blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.2)}}',
  },
  pi: {
    tempo: 0.8,
    E: [
      [14.6, 14.4],
      [19.6, 14.4],
    ],
    M: [17.1, 17.4],
    s: 0.75,
    open: (k) =>
      `<rect x="13.6" y="13" width="2" height="2.6" fill="${k}"/><rect x="18.6" y="13" width="2" height="2.6" fill="${k}"/><path d="M15.8 17.6h2.6" ${stroke(k, 1.2)}/>`,
    glyph: (_k, f) => `${mark(MARK_PI, 8, 8, 1)}${f}<g class="dot">${mark(MARK_PI_DOT, 8, 8, 1)}</g>`,
    motion:
      '.dot{animation:hop calc(var(--t)*1s) cubic-bezier(.3,0,.5,1) infinite}@keyframes hop{0%,50%,100%{transform:translateY(0)}25%{transform:translateY(-2.6px)}}',
  },
  deepseek: {
    tempo: 1.1,
    E: [
      [15.6, 18.6],
      [20, 18.6],
    ],
    M: [17.8, 21.6],
    s: 0.7,
    open: (k) => eyes(k, FIGURES.deepseek.E, 1, 1.25) + smile(k, 17.8, 21.4, 2.2),
    glyph: (_k, f) =>
      `<g class="bub" fill="${W}"><circle cx="10" cy="11" r="1"/><circle cx="12.4" cy="7.6" r="1.4"/></g>` +
      `<g class="whale">${mark(AGENT_META.deepseek.mark[0], 7, 6.5, 1.1)}${f}</g>`,
    motion:
      '.whale{animation:swim calc(var(--t)*2.4s) ease-in-out infinite}@keyframes swim{50%{transform:translateY(-1px) rotate(-2deg)}}' +
      '.bub circle{animation:rise calc(var(--t)*2.4s) ease-out infinite}.bub circle+circle{animation-delay:.6s}@keyframes rise{from{transform:translateY(3px);opacity:0}40%{opacity:1}to{transform:translateY(-3px);opacity:0}}',
  },
  antigravity: {
    tempo: 1,
    E: [
      [18.2, 21.6],
      [21.8, 21.6],
    ],
    M: [20, 24],
    s: 0.6,
    open: (k) => eyes(k, FIGURES.antigravity.E, 0.8, 1) + smile(k, 20, 23.7, 1.8),
    glyph: (_k, f) =>
      `<g class="arch">${mark(AGENT_META.antigravity.mark[0], 6, 5.5, 1.17)}<circle cx="20" cy="22.4" r="5" fill="${W}"/>${f}</g>`,
    motion:
      '.arch{animation:float calc(var(--t)*2.8s) ease-in-out infinite}@keyframes float{50%{transform:translateY(-1.4px)}}',
  },
  opencode: badge('opencode'),
  qwen: badge('qwen'),
  kimi: badge('kimi'),
  goose: badge('goose'),
  copilot: badge('copilot'),
}

/** Each agent's figure, cast as a persona so it acts out every mascot state like the twelve personalities. */
export const AGENT_FIGURES = Object.fromEntries(
  Object.entries(FIGURES).map(([kind, f]) => [
    kind,
    {
      ...f,
      ...AGENT_META[kind as AgentKind].color,
      key: `agent-${kind}`,
      name: AGENT_META[kind as AgentKind].name,
      mix: t('官方形象'),
      line: t('按 Bot 的 Agent 出图，一眼看出用的是哪家'),
      acts: ACTS,
    } satisfies Persona,
  ]),
) as Record<AgentKind, Persona>
