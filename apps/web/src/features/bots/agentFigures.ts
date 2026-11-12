import type { AgentKind } from '@gonggong/protocol'
import { t } from '../../i18n'
import { AGENT_LABEL } from './model'
import type { Persona } from './personas'

/*
 * The figure of each agent: its official mark redrawn as a white body on the brand's colours, with the personas' face,
 * gloves and feet. The marks are trademarks of their owners (see NOTICE); they all live here so they can be swapped.
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

/** Official marks on a 24×24 grid (Lobe Icons, MIT); only the outlines, so the face has room. */
const MARK = {
  claude:
    'M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z',
  codex:
    'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457z',
  gemini:
    'M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z',
  codebuddy:
    'M18.777 1.647c.28-.02.536.114.972.51 1.018.926 2.437 2.828 3.318 4.452l.34.631.482.24.11.06v3.638a5.206 5.206 0 00-5.32-1.23c-.491.166-1.021.471-2.08 1.082l-6.09 3.516c-1.057.61-1.586.916-1.975 1.259a5.208 5.208 0 00-1.493 5.572c.165.49.471 1.02 1.082 2.08l.315.543h-3.26c-.685 0-1.34-.135-1.939-.377-.169-.956-.009-1.789.469-2.335.158-.18.164-.189.13-.493a11.846 11.846 0 01-.057-1.711l.02-.444-.667-1.18C2.1 15.622 1.445 14.078 1.192 12.9c-.133-.647-.125-.934.04-1.146.1-.128.427-.261.822-.334.994-.175 3.162-.017 5.575.41l.25.043.551-.487c.915-.81 1.522-1.264 2.641-1.962 1.167-.73 2.484-1.331 3.967-1.807l.476-.152.261-.688c.937-2.471 1.896-4.293 2.58-4.9.235-.21.25-.22.422-.23z',
  codebuddyEyes:
    'M12.139 18.2a1.203 1.203 0 011.642.44l1.296 2.243a1.204 1.204 0 01-2.083 1.203l-1.296-2.243a1.203 1.203 0 01.44-1.644zM18.629 14.452a1.203 1.203 0 011.642.44l1.295 2.244a1.203 1.203 0 11-2.083 1.203l-1.295-2.243a1.203 1.203 0 01.44-1.644z',
  pi: 'M1 1h16.5v11H12v5.5H6.5V23H1z',
  piDot: 'M17.5 12H23v11h-5.5z',
  deepseek:
    'M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588z',
}
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

type Figure = Omit<Persona, 'key' | 'name' | 'mix' | 'line' | 'acts'>

const FIGURES: Record<AgentKind, Figure> = {
  claude: {
    tempo: 1,
    from: '#eda789',
    to: '#c15f3c',
    E: [
      [17.7, 18.4],
      [22.3, 18.4],
    ],
    M: [20, 21.2],
    s: 0.7,
    open: (k) => eyes(k, FIGURES.claude.E, 1, 1.25) + smile(k, 20, 21, 2.4),
    glyph: (_k, f) =>
      `<g class="spark">${mark(MARK.claude, 7.4, 6.4, 1.05)}</g><circle cx="20" cy="19" r="6.2" fill="${W}"/>${f}` +
      cheeks([15.9, 20.6], [24.1, 20.6], 0.7),
    motion:
      '.spark{transform-origin:20px 19px;animation:spin calc(var(--t)*9s) linear infinite}@keyframes spin{to{transform:rotate(360deg)}}',
  },
  codex: {
    tempo: 0.9,
    from: '#b1a7ff',
    to: '#3941ff',
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
      `<g class="cloud">${mark(MARK.codex, 8, 7, 1)}${f}${cheeks([14.6, 21], [25.4, 21])}</g>`,
    motion:
      '.cur{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}' +
      '.cloud{transform-origin:20px 31px;animation:puff calc(var(--t)*2.4s) ease-in-out infinite}@keyframes puff{50%{transform:scale(1.04,.97)}}',
  },
  gemini: {
    tempo: 1,
    from: '#7fb2ff',
    to: '#3d5fe0',
    E: [
      [18, 18.4],
      [22, 18.4],
    ],
    M: [20, 21],
    s: 0.6,
    open: (k) => eyes(k, FIGURES.gemini.E, 0.85, 1.1) + smile(k, 20, 20.8, 2),
    glyph: (_k, f) =>
      `<g class="star">${mark(MARK.gemini, 5, 4, 1.25)}${f}</g>` +
      `<g class="twin">${mark(MARK.gemini, 28, 3, 0.3)}</g>`,
    motion:
      '.star{transform-origin:20px 19px;animation:tw calc(var(--t)*2.4s) ease-in-out infinite}@keyframes tw{50%{transform:scale(.93) rotate(6deg)}}' +
      '.twin{transform-origin:31.6px 6.6px;animation:pop calc(var(--t)*2.4s) ease-in-out infinite}@keyframes pop{0%,100%{transform:scale(.4);opacity:.4}50%{transform:scale(1);opacity:1}}',
  },
  codebuddy: {
    tempo: 0.9,
    from: '#2ea99d',
    to: '#6c4dff',
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
      `<g class="eyes">${mark(MARK.codebuddyEyes, -2, -3, 1.4)}</g><path transform="rotate(-29 23.4 26)" d="M22 25.6q1.4 1 2.8 0" ${stroke(W, 1.2)}/>`,
    glyph: (_k, f) => `<g class="hood">${mark(MARK.codebuddy, -2, -3, 1.4)}${f}</g>`,
    motion:
      '.hood{transform-origin:20px 34px;animation:nod calc(var(--t)*2.4s) ease-in-out infinite}@keyframes nod{50%{transform:rotate(-4deg)}}' +
      '.eyes{transform-box:fill-box;transform-origin:center;animation:blink calc(var(--t)*3s) infinite}@keyframes blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.2)}}',
  },
  pi: {
    tempo: 0.8,
    from: '#8a93a6',
    to: '#262b36',
    E: [
      [14.6, 14.4],
      [19.6, 14.4],
    ],
    M: [17.1, 17.4],
    s: 0.75,
    open: (k) =>
      `<rect x="13.6" y="13" width="2" height="2.6" fill="${k}"/><rect x="18.6" y="13" width="2" height="2.6" fill="${k}"/><path d="M15.8 17.6h2.6" ${stroke(k, 1.2)}/>`,
    glyph: (_k, f) => `${mark(MARK.pi, 8, 8, 1)}${f}<g class="dot">${mark(MARK.piDot, 8, 8, 1)}</g>`,
    motion:
      '.dot{animation:hop calc(var(--t)*1s) cubic-bezier(.3,0,.5,1) infinite}@keyframes hop{0%,50%,100%{transform:translateY(0)}25%{transform:translateY(-2.6px)}}',
  },
  deepseek: {
    tempo: 1.1,
    from: '#8aa0ff',
    to: '#3552e8',
    E: [
      [15.6, 18.6],
      [20, 18.6],
    ],
    M: [17.8, 21.6],
    s: 0.7,
    open: (k) => eyes(k, FIGURES.deepseek.E, 1, 1.25) + smile(k, 17.8, 21.4, 2.2),
    glyph: (_k, f) =>
      `<g class="bub" fill="${W}"><circle cx="10" cy="11" r="1"/><circle cx="12.4" cy="7.6" r="1.4"/></g>` +
      `<g class="whale">${mark(MARK.deepseek, 7, 6.5, 1.1)}${f}</g>`,
    motion:
      '.whale{animation:swim calc(var(--t)*2.4s) ease-in-out infinite}@keyframes swim{50%{transform:translateY(-1px) rotate(-2deg)}}' +
      '.bub circle{animation:rise calc(var(--t)*2.4s) ease-out infinite}.bub circle+circle{animation-delay:.6s}@keyframes rise{from{transform:translateY(3px);opacity:0}40%{opacity:1}to{transform:translateY(-3px);opacity:0}}',
  },
}

/** Each agent's figure, cast as a persona so it acts out every mascot state like the twelve personalities. */
export const AGENT_FIGURES = Object.fromEntries(
  Object.entries(FIGURES).map(([kind, f]) => [
    kind,
    {
      ...f,
      key: `agent-${kind}`,
      name: AGENT_LABEL[kind as AgentKind],
      mix: t('官方形象'),
      line: t('按 Bot 的 Agent 出图，一眼看出用的是哪家'),
      acts: ACTS,
    } satisfies Persona,
  ]),
) as Record<AgentKind, Persona>
