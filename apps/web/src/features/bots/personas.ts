import type { MascotAction } from '../../ui'

/*
 * The twelve blended work personalities (docs/brand/roles). Each character is its own tile with floating gloves and
 * feet; every mascot action is one self-contained animated SVG, played at the persona's own tempo.
 */

type Face = 'open' | 'happy' | 'closed' | 'x' | 'wink'
interface ActExtra {
  face?: Face
  css?: string
  fx?: string
  z?: string
}
/** What the persona does for an action: a caption, the word or style its prop carries, and any twists. */
type Act = [caption: string, prop?: string, extra?: ActExtra]

export interface Persona {
  key: string
  name: string
  mix: string
  /** One line on how it works. */
  line: string
  /** Multiplies every loop: above 1 is slower. */
  tempo: number
  from: string
  to: string
  /** Eye centres, mouth centre and face scale for the drawn expressions. */
  E: [number, number][]
  M: [number, number]
  s: number
  eyeInk?: string
  open: (ink: string) => string
  glyph: (ink: string, face: string, state?: Face) => string
  motion: string
  acts: Record<MascotAction, Act>
}

const W = '#fff'
const stroke = (c: string, w: number) =>
  `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const WORKING = new Set<MascotAction>(['think', 'ask', 'raise', 'wait', 'type', 'carry', 'run'])
const FACE: Partial<Record<MascotAction, Face>> = {
  wave: 'happy',
  done: 'happy',
  error: 'x',
  sleep: 'closed',
}

export const PERSONAS: Persona[] = [
  {
    key: 'hammock',
    line: '看着在发呆，其实在想第二层。问题没说清楚，一行代码都不写。',
    name: '慢想',
    mix: '深思 × 逆向 × 守边界',
    tempo: 1.5,
    from: '#a3b5ff',
    to: '#4b5fd6',
    E: [
      [17.8, 18.9],
      [22.2, 18.9],
    ],
    M: [20, 22.6],
    s: 0.75,
    open: (k) =>
      `<path d="M16.3 18.6h3a1.5 1.5 0 0 1-3 0zM20.7 18.6h3a1.5 1.5 0 0 1-3 0z" fill="${k}"/><path d="M18.6 22.4q1.4.8 2.8 0" ${stroke(k, 1.1)}/>`,
    glyph: (k, f) =>
      `<g class="think"><circle class="ring" cx="30" cy="8" r="4" ${stroke(W, 1.2)}/><circle cx="30" cy="8" r="1.6" fill="${W}"/><circle cx="25.4" cy="12.6" r=".9" fill="${W}"/></g>` +
      `<g class="swing"><path d="M6 21 3.5 12.5M34 21l2.5-8.5" ${stroke(W, 1)} opacity=".7"/><circle cx="20" cy="19" r="7" fill="${W}"/>${f}` +
      `<path d="M6 21q14 13 28 0-14 8-28 0z" fill="${W}" stroke="${k}" stroke-width=".8"/>` +
      `<path d="M10 23.8q10 6 20 0" stroke="${k}" stroke-width=".7" stroke-dasharray="1.2 1.2" fill="none" opacity=".4"/></g>`,
    motion:
      '.swing{transform-origin:20px 6px;animation:swing calc(var(--t)*2s) ease-in-out infinite}@keyframes swing{25%{transform:rotate(4deg)}75%{transform:rotate(-4deg)}}' +
      '.ring{transform-origin:30px 8px;animation:ring 1.6s ease-out infinite}@keyframes ring{from{transform:scale(.5);opacity:1}to{transform:scale(1.4);opacity:0}}',
    acts: {
      idle: ['吊床里缓缓地摇'],
      wave: ['懒洋洋地抬一下手'],
      think: ['闭上眼，气泡里的同心圆一圈圈往外扩：在想第二层', '◎', { face: 'closed' }],
      ask: ['歪头问「为何？」，问题说不清就不动手', '为何?'],
      raise: ['举起「想清了」便签，等你拍板', '想清了'],
      wait: ['继续摇吊床，一点不急', 'calm'],
      type: ['敲得慢，每段话前都先停一下', '∞'],
      carry: ['扛着一卷蓝图慢慢走', '蓝图'],
      run: ['踱步式小跑，全员最慢的步频'],
      done: ['头顶亮起灯泡：想通了', '💡'],
      error: [
        '从吊床里翻下来，眼冒金星',
        '✦',
        {
          css: '.fig{animation:fall calc(var(--t)*1.6s) ease-in-out infinite}@keyframes fall{0%,15%{transform:rotate(0)}40%,80%{transform:rotate(16deg) translateY(2px)}100%{transform:rotate(0)}}',
        },
      ],
      sleep: ['在吊床里睡着，Z 跟着摆动'],
    },
  },
  {
    key: 'braces',
    line: '嘴毒是因为对代码有洁癖。空谈免谈，只认跑得起来的实现。',
    name: '铁码',
    mix: '毒舌 × 洁癖 × 实干',
    tempo: 0.8,
    from: '#a0a9b5',
    to: '#39424f',
    E: [
      [16.2, 19.8],
      [23.8, 19.8],
    ],
    M: [20, 24.4],
    s: 0.9,
    open: (k) =>
      `<path d="M14 15.4l4 1.2M26 15.4l-4 1.2" ${stroke(k, 1.6)}/><rect x="15" y="18.6" width="2.4" height="2.4" rx=".6" fill="${k}"/><rect x="22.6" y="18.6" width="2.4" height="2.4" rx=".6" fill="${k}"/><path d="M17.4 24h5.2" ${stroke(k, 1.5)}/>`,
    glyph: (_k, f) =>
      `<g class="bl" ${stroke(W, 2)}><path d="M9.5 10.5c-2 0-2.5 1-2.5 3V17c0 1.5-1 2.5-2.4 2.5 1.4 0 2.4 1 2.4 2.5v3.5c0 2 .5 3 2.5 3"/></g>` +
      `<g class="br" ${stroke(W, 2)}><path d="M30.5 10.5c2 0 2.5 1 2.5 3V17c0 1.5 1 2.5 2.4 2.5-1.4 0-2.4 1-2.4 2.5v3.5c0 2-.5 3-2.5 3"/></g>` +
      `<rect x="11.5" y="10" width="17" height="18" rx="3.5" fill="${W}"/>${f}` +
      `<g fill="${W}"><rect class="c1" x="11.5" y="31" width="17" height="1.8" rx=".9"/><rect class="c2" x="11.5" y="34.2" width="11" height="1.8" rx=".9"/></g>`,
    motion:
      '.bl{animation:bl 1.2s ease-in-out infinite}.br{animation:br 1.2s ease-in-out infinite}@keyframes bl{50%{transform:translateX(1.2px)}}@keyframes br{50%{transform:translateX(-1.2px)}}' +
      '.c1,.c2{transform-box:fill-box;transform-origin:0 50%;animation:del 2.4s ease-in-out infinite}.c2{animation-delay:.4s}@keyframes del{0%,20%{transform:scaleX(1)}60%,80%{transform:scaleX(.25)}100%{transform:scaleX(1)}}',
    acts: {
      idle: ['面无表情，眉头一直微皱'],
      wave: ['两指一挥，敷衍式致意', undefined, { css: '.hand{animation-duration:.25s}' }],
      think: ['花括号收紧，气泡里只有「{ }」', '{ }'],
      ask: ['冷冷一句「代码呢？」', 'code?'],
      raise: ['举牌「LGTM?」，等你批', 'LGTM?'],
      wait: ['手指敲桌，明显不耐烦', 'tap'],
      type: ['狂敲键盘，退格比输入多', '⌫'],
      carry: ['扛着一块删到最精简的代码块', '{ }'],
      run: ['直线冲刺，一步不绕'],
      done: ['只冒出四个字母', 'LGTM'],
      error: [
        '头顶冒烟，眉毛竖起来',
        '#!',
        {
          fx: `<g class="steam" ${stroke('#b8c0cc', 1.6)}><path d="M14 -1q-2-3 0-6"/><path d="M20 -2q2-3 0-6"/><path d="M26 -1q-2-3 0-6"/></g>`,
          css: '.steam path{animation:steam .9s ease-out infinite}.steam path:nth-child(2){animation-delay:.3s}.steam path:nth-child(3){animation-delay:.6s}@keyframes steam{from{transform:translateY(2px);opacity:0}50%{opacity:1}to{transform:translateY(-4px);opacity:0}}',
        },
      ],
      sleep: ['趴着睡，眉头还皱着'],
    },
  },
  {
    key: 'focus',
    line: '一进心流就戴上耳机屏蔽世界；先测量，只抠真正关键的 3%。',
    name: '闭关',
    mix: '沉默 × 狂热 × 精算',
    tempo: 1,
    from: '#7a6dff',
    to: '#23198a',
    E: [
      [16, 19.6],
      [24, 19.6],
    ],
    M: [20, 24],
    s: 0.9,
    open: (k) =>
      `<path d="M14 16.6h3.8M22.2 16.6H26" ${stroke(k, 1.3)}/><ellipse cx="16" cy="19.6" rx="1.7" ry="1.1" fill="${k}"/><ellipse cx="24" cy="19.6" rx="1.7" ry="1.1" fill="${k}"/><path d="M18.6 23.8h2.8" ${stroke(k, 1.3)}/>`,
    glyph: (_k, f) =>
      `<path d="M8.6 19a11.4 11.4 0 0 1 22.8 0" ${stroke(W, 2.2)}/><rect x="10.5" y="10" width="19" height="18" rx="8" fill="${W}"/>` +
      `<rect x="6" y="15" width="4.2" height="8" rx="2.1" fill="${W}"/><rect x="29.8" y="15" width="4.2" height="8" rx="2.1" fill="${W}"/>${f}` +
      `<rect class="f1" x="16" y="29.4" width="8" height="2" rx=".6" fill="#ffd84a"/><rect class="f2" x="13" y="31.8" width="14" height="2" rx=".6" fill="#ffa24a"/><rect class="f3" x="9" y="34.2" width="22" height="2" rx=".6" fill="#ff6b5a"/>`,
    motion:
      '.f1,.f2,.f3{transform-box:fill-box;transform-origin:0 50%;animation:opt 2.4s ease-in-out infinite}.f2{animation-delay:.3s}.f3{animation-delay:.6s}@keyframes opt{0%,15%{transform:scaleX(1)}55%,85%{transform:scaleX(.45)}100%{transform:scaleX(1)}}',
    acts: {
      idle: ['戴着耳机，轻轻点头打拍子'],
      wave: ['头也不抬，举手示意一下'],
      think: ['气泡里的火焰图一根根变短', '▤'],
      ask: ['摘下一边耳机：「？」', '?'],
      raise: ['举起一张性能报告', 'perf'],
      wait: ['闭眼听歌，纹丝不动', 'still'],
      type: ['专注猛敲，屏幕上火焰图跳动', '▤'],
      carry: ['搬一块芯片', 'CPU'],
      run: ['目不斜视地快走'],
      done: ['火焰图全绿，捧起小奖杯', '🏆'],
      error: ['火焰图爆红，耳机滑落', '🔥'],
      sleep: ['戴着耳机睡着，飘出音符', undefined, { z: '♪' }],
    },
  },
  {
    key: 'steps',
    line: '红了就修，绿了就走；对复杂度零容忍，笑着删功能。',
    name: '小步',
    mix: '乐天 × 务实 × 敢割舍',
    tempo: 0.7,
    from: '#8be07a',
    to: '#239a3c',
    E: [
      [16, 14],
      [24, 14],
    ],
    M: [20, 17.6],
    s: 0.9,
    open: (k) =>
      `<path d="M14.4 14.4q1.6-2 3.2 0M22.4 14.4q1.6-2 3.2 0" ${stroke(k, 1.5)}/><path d="M16.4 17.4h7.2a3.6 3.6 0 0 1-7.2 0z" fill="${k}"/>`,
    glyph: (_k, f) =>
      `<g class="hop"><rect x="10.5" y="6.5" width="19" height="17" rx="7" fill="${W}"/>${f}</g>` +
      `<path d="M5 36.5h9.5V33h9.5v-3.5h10" ${stroke(W, 1.6)}/>` +
      `<circle class="s s1" cx="9.8" cy="34.4" r="1.4" fill="#ff5f57"/><circle class="s s2" cx="19.3" cy="30.9" r="1.4" fill="#ff5f57"/><circle class="s s3" cx="29" cy="27.4" r="1.4" fill="#ff5f57"/>`,
    motion:
      '.hop{animation:hop .6s cubic-bezier(.3,0,.5,1) infinite alternate}@keyframes hop{to{transform:translateY(-2px)}}' +
      '.s{animation:green 2.4s steps(1) infinite}.s2{animation-delay:.6s}.s3{animation-delay:1.2s}@keyframes green{0%{fill:#ff5f57}25%,100%{fill:#30c85e}}',
    acts: {
      idle: ['原地小碎跳，停不下来'],
      wave: ['双手大力挥，热情过头'],
      think: ['气泡里红点一个个变绿', '●●'],
      ask: ['蹦一下：「？！」', '?!'],
      raise: ['举着绿旗等批', '▶'],
      wait: ['踮着脚原地小跳', 'hop'],
      type: ['敲一行就跑一遍测试，灯一红一绿', '✓'],
      carry: ['搬一级台阶积木往上走', '+1'],
      run: ['小碎步飞快地跑'],
      done: ['连跳三下，全绿', '✓✓'],
      error: ['红灯亮了，笑着挠头「问题不大」', '😅', { face: 'happy' }],
      sleep: ['打着呼还在笑'],
    },
  },
  {
    key: 'blank',
    line: '说话轻声细语，对粗糙零容忍；每个像素都要讲得出理由。',
    name: '留白',
    mix: '温柔 × 偏执 × 克制',
    tempo: 1.3,
    from: '#ffc3d6',
    to: '#d8578a',
    E: [
      [16.4, 19.2],
      [23.6, 19.2],
    ],
    M: [20, 23.6],
    s: 0.85,
    open: (k) =>
      `<circle cx="16.4" cy="19.2" r="1.2" fill="${k}"/><circle cx="23.6" cy="19.2" r="1.2" fill="${k}"/><path d="M18.4 23.4q1.6 1 3.2 0" ${stroke(k, 1.2)}/>`,
    glyph: (_k, f) =>
      `<g ${stroke(W, 1.3)}><path class="k k1" d="M5 10V5h5"/><path class="k k2" d="M30 5h5v5"/><path class="k k3" d="M35 30v5h-5"/><path class="k k4" d="M10 35H5v-5"/></g>` +
      `<g class="breath"><circle cx="20" cy="20" r="10" fill="${W}"/>${f}<circle cx="25.6" cy="23" r=".9" fill="#ff9fbf"/></g>`,
    motion:
      '.breath{transform-origin:20px 20px;animation:breath 3.6s ease-in-out infinite}@keyframes breath{50%{transform:scale(1.05)}}' +
      '.k{animation:fade 3.6s ease-in-out infinite}.k2{animation-delay:.3s}.k3{animation-delay:.6s}.k4{animation-delay:.9s}@keyframes fade{0%,10%{opacity:1}40%,80%{opacity:0}100%{opacity:1}}',
    acts: {
      idle: ['安静地呼吸'],
      wave: ['轻轻招一下手'],
      think: ['气泡里只剩一个点', '·'],
      ask: ['轻声问「…？」', '…?'],
      raise: ['举一张只有一个点的白卡', '·'],
      wait: ['闭目呼吸，参考线忽隐忽现', 'calm'],
      type: ['打几个字，删掉一半', 'Aa'],
      carry: ['捧着一个画框', '▢'],
      run: ['轻盈地小跑'],
      done: ['一颗星星轻轻闪一下', '✦'],
      error: ['参考线歪了，捂住脸', '⌗'],
      sleep: ['侧头安睡，参考线全部淡去'],
    },
  },
  {
    key: 'no',
    line: '对诱惑说不，对用户说是；发现方向错了，当场叫停。',
    name: '说不',
    mix: '果断 × 本分 × 聚焦',
    tempo: 0.9,
    from: '#ffcf40',
    to: '#ec7300',
    E: [
      [17, 12.8],
      [23, 12.8],
    ],
    M: [20, 16.2],
    s: 0.7,
    open: (k) =>
      `<path d="M15.6 10.2h3M21.4 10.2h3" ${stroke(k, 1.4)}/><ellipse cx="17" cy="12.8" rx="1.2" ry="1.4" fill="${k}"/><ellipse cx="23" cy="12.8" rx="1.2" ry="1.4" fill="${k}"/><path d="M18.2 16.4h3.6" ${stroke(k, 1.3)}/>`,
    glyph: (k, f) =>
      `<circle cx="20" cy="12.6" r="7.6" fill="${W}"/>${f}` +
      `<rect x="10.5" y="19.5" width="19" height="16" rx="2.4" fill="${W}" stroke="${k}" stroke-width="1.1"/>` +
      `<g fill="${k}" opacity=".35"><rect x="13.5" y="22.8" width="11" height="1.6" rx=".8"/><rect x="13.5" y="26.8" width="9" height="1.6" rx=".8"/><rect x="13.5" y="30.8" width="10" height="1.6" rx=".8"/></g>` +
      `<path class="x x1" d="M12.5 23.6h13" stroke="#ff5f57" stroke-width="1.3" stroke-linecap="round"/><path class="x x2" d="M12.5 31.6h12" stroke="#ff5f57" stroke-width="1.3" stroke-linecap="round"/>` +
      `<path class="ok" d="M24.4 27.4l1.4 1.4 2.4-2.8" ${stroke('#30c85e', 1.4)}/>`,
    motion:
      '.x{stroke-dasharray:14;animation:strike 2.8s ease-in-out infinite}.x2{animation-delay:.4s}@keyframes strike{0%,10%{stroke-dashoffset:14}40%,90%{stroke-dashoffset:0}100%{stroke-dashoffset:14}}' +
      '.ok{transform-box:fill-box;transform-origin:center;animation:ok 2.8s ease-in-out infinite}@keyframes ok{0%,45%{transform:scale(0)}60%{transform:scale(1.4)}70%,90%{transform:scale(1)}100%{transform:scale(0)}}',
    acts: {
      idle: ['站定，目光坚定'],
      wave: ['抬手即止，干脆利落'],
      think: ['气泡里一排叉，只留一个勾', '✕✕✓'],
      ask: ['直接问「要做吗？」', '要吗?'],
      raise: ['举起红牌，等你决定砍不砍', '✕'],
      wait: ['抱着清单一行行划掉', 'still'],
      type: ['边写边删行', '−'],
      carry: ['扛着只剩一项的清单', '1 项'],
      run: ['大步直走，不回头'],
      done: ['盖一个绿色对勾章', '✓'],
      error: ['当场叫停，举「STOP」', 'STOP'],
      sleep: ['清单盖在脸上睡'],
    },
  },
  {
    key: 'abacus',
    line: '不听故事只看账：用户价值 = 新体验 − 旧体验 − 替换成本。',
    name: '算盘',
    mix: '冷静 × 理性 × 算账',
    tempo: 1,
    from: '#5fdcf0',
    to: '#0a82a8',
    E: [
      [15.9, 22.4],
      [24.1, 22.4],
    ],
    M: [20, 28],
    s: 0.8,
    open: (k) =>
      `<circle cx="15.9" cy="22.4" r="1.2" fill="${k}"/><circle cx="24.1" cy="22.4" r="1.2" fill="${k}"/><path d="M18.4 28h3.2" ${stroke(k, 1.3)}/>`,
    glyph: (k, f) =>
      `<path d="M8 7.5h24" ${stroke(W, 1.2)}/><path d="M8 4.5v6M32 4.5v6" ${stroke(W, 1.6)}/>` +
      `<g fill="${W}"><ellipse class="b1" cx="12" cy="7.5" rx="1.7" ry="2"/><ellipse class="b2" cx="15.6" cy="7.5" rx="1.7" ry="2"/><ellipse class="b3" cx="24.4" cy="7.5" rx="1.7" ry="2"/><ellipse cx="28" cy="7.5" rx="1.7" ry="2"/></g>` +
      `<circle cx="20" cy="23" r="10" fill="${W}"/>${f}<g ${stroke(k, 1.3)}><circle cx="15.9" cy="22.4" r="3.1"/><circle cx="24.1" cy="22.4" r="3.1"/><path d="M19 22.4h2"/></g>`,
    motion:
      '.b1,.b2{animation:flick 1.6s ease-in-out infinite}.b2{animation-delay:.2s}.b3{animation:flickr 1.6s ease-in-out infinite .6s}' +
      '@keyframes flick{0%,20%{transform:translateX(0)}40%,70%{transform:translateX(5px)}90%,100%{transform:translateX(0)}}@keyframes flickr{0%,20%{transform:translateX(0)}40%,70%{transform:translateX(-5px)}90%,100%{transform:translateX(0)}}',
    acts: {
      idle: ['推推眼镜，面无波澜'],
      wave: ['规规矩矩地挥手'],
      think: ['气泡里一个求和符号', '∑'],
      ask: ['「数据呢？」', '数据?'],
      raise: ['举着一张柱状图等批', '▁▃▆'],
      wait: ['拨着算珠计时', 'still'],
      type: ['敲数字，屏幕上跳出公式', '='],
      carry: ['扛一根柱状图', '▆'],
      run: ['匀速跑，步频精确'],
      done: ['折线往右上走', '↗'],
      error: ['算珠散落一地', '÷0'],
      sleep: ['数算珠数着睡着'],
    },
  },
  {
    key: 'invert',
    line: '总在问「它会怎么坏」——就是为了让它永远不坏。',
    name: '反推',
    mix: '悲观 × 缜密 × 守护',
    tempo: 1.1,
    from: '#57d6b8',
    to: '#0b7d68',
    E: [
      [13.8, 19.8],
      [20.2, 19.8],
    ],
    M: [17, 25],
    s: 0.85,
    open: (k) =>
      `<path d="M10.8 16.6l3.6-1.4M23.2 16.6l-3.6-1.4" ${stroke(k, 1.3)}/><ellipse cx="13.8" cy="19.8" rx="1.5" ry="1.8" fill="${k}"/><ellipse cx="20.2" cy="19.8" rx="1.5" ry="1.8" fill="${k}"/><path d="M13.2 24.8q1.1-1 2.2 0t2.2 0 2.2 0" ${stroke(k, 1.1)}/>`,
    glyph: (k, f) =>
      `<rect x="6.5" y="10" width="21" height="20" rx="8.5" fill="${W}"/>${f}` +
      `<g class="glass"><path d="M27 18.5h9l-4.5 6 4.5 6h-9l4.5-6z" fill="${W}" stroke="${k}" stroke-width=".9" stroke-linejoin="round"/>` +
      `<path d="M29 19.8h5l-2.5 3.2z" fill="#ffd84a"/><path d="M29.6 29.4h3.8l-1.9-2.4z" fill="#ffd84a"/></g>`,
    motion:
      '.glass{transform-origin:31.5px 24.5px;animation:flip 2.4s ease-in-out infinite}@keyframes flip{0%,35%{transform:rotate(0)}55%,100%{transform:rotate(180deg)}}',
    acts: {
      idle: ['看着沙漏，眉头紧锁'],
      wave: ['犹犹豫豫地挥手'],
      think: ['气泡里一个警示三角', '⚠'],
      ask: ['「万一呢？」', '万一?'],
      raise: ['举「有风险」牌，等你确认', '风险'],
      wait: ['坐立不安，反复翻沙漏', 'fidget'],
      type: ['边写边补测试用例', '+case'],
      carry: ['扛着捕虫网巡逻', '🐞'],
      run: ['边跑边回头看'],
      done: ['松一口气，擦把汗', '🛡'],
      error: ['一点不意外：「我就说吧」', '!', { face: 'open' }],
      sleep: ['抱着沙漏睡，眉头没松'],
    },
  },
  {
    key: 'sentry',
    line: '默认已经被攻破，却从不制造恐慌；风险是连续的，不是非黑即白。',
    name: '哨兵',
    mix: '警觉 × 冷静 × 讲流程',
    tempo: 1,
    from: '#56688a',
    to: '#121a2a',
    E: [
      [16.4, 22.3],
      [23.6, 22.3],
    ],
    M: [20, 29],
    s: 0.75,
    eyeInk: '#7cf0c4',
    open: (k) => `<path d="M18 29h4" ${stroke(k, 1.3)}/>`,
    glyph: (k, f, st) =>
      `<path d="M20 11.4V7" ${stroke(W, 1.4)}/><circle class="tip" cx="20" cy="6" r="1.6" fill="#ff5f57"/>` +
      `<path d="M9 23a11 11 0 0 1 22 0v5a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="${W}"/>` +
      `<defs><clipPath id="v"><rect x="11" y="18.6" width="18" height="7.4" rx="3.7"/></clipPath></defs><rect x="11" y="18.6" width="18" height="7.4" rx="3.7" fill="${k}"/>` +
      (st === 'open'
        ? `<g clip-path="url(#v)"><path class="sweep" d="M20 22.3 20 12A10.3 10.3 0 0 1 28.9 17.2z" fill="#7cf0c4" opacity=".55"/><circle class="blip" cx="24.6" cy="21" r=".9" fill="#7cf0c4"/><circle cx="20" cy="22.3" r=".8" fill="#7cf0c4"/></g>`
        : '') +
      f,
    motion:
      '.sweep{transform-origin:20px 22.3px;animation:spin 2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}' +
      '.blip{animation:blip 2s steps(1) infinite}@keyframes blip{0%,10%{opacity:1}20%,100%{opacity:.15}}.tip{animation:tip 1s steps(1) infinite}@keyframes tip{50%{opacity:.3}}',
    acts: {
      idle: ['雷达慢慢扫'],
      wave: [
        '挥手改成敬礼',
        undefined,
        {
          css: '.hand{animation:salute calc(var(--t)*1.6s) ease-in-out infinite}@keyframes salute{0%,20%{transform:translate(0,0)}40%,80%{transform:translate(-4px,-2px) rotate(-30deg)}}',
        },
      ],
      think: ['气泡里雷达扫描', '◔'],
      ask: ['「谁？」', '谁?'],
      raise: ['举盾，等授权', '🛡'],
      wait: ['站岗，天线灯一闪一闪', 'still'],
      type: ['敲键盘，屏幕上一把锁', '🔒'],
      carry: ['扛着盾牌', '盾'],
      run: ['警灯闪着跑'],
      done: ['咔哒一声上锁', '🔒'],
      error: ['红色警报灯转起来', '🚨'],
      sleep: ['睁一只眼睡：从不真睡', undefined, { face: 'wink' }],
    },
  },
  {
    key: 'spring',
    line: '嘴上冷笑话，骨子里抗造；每次事故都让系统更强一点。',
    name: '抗摔',
    mix: '冷幽默 × 反脆弱 × 少即是多',
    tempo: 0.9,
    from: '#c08eff',
    to: '#6a2bd6',
    E: [
      [16, 16.4],
      [24.4, 16.4],
    ],
    M: [20, 21],
    s: 0.9,
    open: (k) =>
      `<path d="M13.8 13.2l3-.8M23.4 13.4h3" ${stroke(k, 1.3)}/><circle cx="16" cy="16.4" r="1.3" fill="${k}"/><circle cx="24.4" cy="16.4" r="1.3" fill="${k}"/><path d="M17.4 21q2.6 1 4.8-.8" ${stroke(k, 1.3)}/>`,
    glyph: (_k, f) =>
      `<path d="M11 36.5h18" ${stroke(W, 1.6)}/><path class="coil" d="M15 35.2l10-1.5-10-1.5 10-1.5-10-1.5 10-1.5" ${stroke(W, 1.4)}/>` +
      `<g class="cube"><rect x="11" y="8" width="18" height="18" rx="3.4" fill="${W}"/>${f}` +
      `<g transform="rotate(-35 24.6 10.4)"><rect x="21.4" y="9.1" width="6.4" height="2.6" rx="1.3" fill="#ffd9b0"/><rect x="23.8" y="9.1" width="1.6" height="2.6" fill="#f2b98a"/></g></g>`,
    motion:
      '.cube{transform-origin:20px 26px;animation:sq 1s ease-in-out infinite}@keyframes sq{0%,100%{transform:translateY(0)}35%{transform:translateY(2.4px) scale(1.08,.88)}65%{transform:translateY(-2.6px) scale(.97,1.04)}}' +
      '.coil{transform-box:fill-box;transform-origin:50% 100%;animation:coil 1s ease-in-out infinite}@keyframes coil{35%{transform:scaleY(.72)}65%{transform:scaleY(1.12)}}',
    acts: {
      idle: ['在弹簧上轻轻颠'],
      wave: ['弹一下再挥手'],
      think: ['气泡里一个空集：能删就删', '∅'],
      ask: ['「删掉？」', '删?'],
      raise: ['举着创可贴等批', '＋'],
      wait: ['在弹簧上一颠一颠', 'hop'],
      type: ['敲两下删三行', '−3'],
      carry: ['头顶一台服务器', '▤▤'],
      run: ['弹跳着前进'],
      done: ['弹得比之前更高', '★'],
      error: [
        '被压扁，贴上创可贴弹回来',
        '+1',
        {
          css: '.fig{animation:flat calc(var(--t)*1.4s) ease-in-out infinite}@keyframes flat{0%,15%{transform:scale(1)}30%,55%{transform:scale(1.2,.6)}75%{transform:scale(.95,1.1)}100%{transform:scale(1)}}',
        },
      ],
      sleep: ['压在弹簧上睡'],
    },
  },
  {
    key: 'compass',
    line: '方向寸步不让，路径随时可绕；可逆的决定当场拍板。',
    name: '灰度',
    mix: '外柔内刚 × 果断 × 放权',
    tempo: 1.1,
    from: '#e8c089',
    to: '#a26a2e',
    E: [
      [16, 19.8],
      [24, 19.8],
    ],
    M: [20, 24.2],
    s: 0.85,
    open: (k) =>
      `<path d="M14.2 16.6h3.4M22.4 16.6h3.4" ${stroke(k, 1.4)}/><ellipse cx="16" cy="19.8" rx="1.5" ry="1.8" fill="${k}"/><ellipse cx="24" cy="19.8" rx="1.5" ry="1.8" fill="${k}"/><path d="M17 23.8q3 2 6 0" ${stroke(k, 1.4)}/>`,
    glyph: (k, f) =>
      `<path class="road" d="M5 36c4-3 7 0 11-2s6-3 10-1.6 6 .6 9-1.4" ${stroke(W, 1.6)} stroke-dasharray="2.4 2"/>` +
      `<g class="sway"><rect x="10.5" y="11" width="19" height="18" rx="8" fill="${W}"/>${f}` +
      `<g class="needle"><path d="M20 2.4l1.9 5h-3.8z" fill="#ff6b5a"/><path d="M18.1 7.4h3.8L20 11.6z" fill="${W}"/><circle cx="20" cy="7.4" r="1" fill="${k}"/></g></g>`,
    motion:
      '.sway{transform-origin:20px 30px;animation:sw 2.4s ease-in-out infinite}@keyframes sw{25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}' +
      '.needle{transform-origin:20px 7.4px;animation:un 2.4s ease-in-out infinite}@keyframes un{25%{transform:rotate(8deg)}75%{transform:rotate(-8deg)}}.road{animation:road 1s linear infinite}@keyframes road{to{stroke-dashoffset:-8.8}}',
    acts: {
      idle: ['身体轻摆，指针不动'],
      wave: ['稳稳地挥手'],
      think: ['气泡里一枚指北针', 'N'],
      ask: ['「方向？」', '方向?'],
      raise: ['举小旗，等你拍板', '⚑'],
      wait: ['左右摇摆，等得住', 'sway'],
      type: ['打字，路线图一段段延伸', '→'],
      carry: ['扛着地图卷', '地图'],
      run: ['沿弯路跑，指针一直指北'],
      done: ['把旗插上', '⚑'],
      error: ['路断了，绕一下继续走', '↪'],
      sleep: ['睡着了，指针还指着北'],
    },
  },
  {
    key: 'loop',
    line: '把问题摊开讲，是为了让人成长；每个里程碑都要复盘。',
    name: '复盘',
    mix: '直率 × 暖心 × 透明',
    tempo: 1,
    from: '#ff9270',
    to: '#d8342c',
    E: [
      [16.6, 19.6],
      [23.4, 19.6],
    ],
    M: [20, 24.4],
    s: 0.8,
    open: (k) =>
      `<ellipse cx="16.6" cy="19.6" rx="1.4" ry="1.7" fill="${k}"/><ellipse cx="23.4" cy="19.6" rx="1.4" ry="1.7" fill="${k}"/><path d="M16.8 23.2h6.4a3.2 3.2 0 0 1-6.4 0z" fill="${k}"/>`,
    glyph: (_k, f) =>
      `<g class="arc"><path d="M31.3 14.5A13 13 0 1 1 26.5 9.7" ${stroke(W, 1.6)}/><path d="M28.2 10.7 25.7 11.1 27.3 8.4z" fill="${W}" stroke="${W}" stroke-width="1" stroke-linejoin="round"/></g>` +
      `<path class="heart" d="M8 10.8 5.3 8.1a1.7 1.7 0 0 1 2.7-2.1 1.7 1.7 0 0 1 2.7 2.1z" fill="${W}"/>` +
      `<circle cx="20" cy="21" r="8.6" fill="${W}"/>${f}<circle cx="14.6" cy="23" r="1" fill="#ffc2b0"/><circle cx="25.4" cy="23" r="1" fill="#ffc2b0"/>`,
    motion:
      '.arc{transform-origin:20px 21px;animation:spin 2.4s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}' +
      '.heart{transform-box:fill-box;transform-origin:center;animation:beat 2.4s ease-in-out infinite}@keyframes beat{0%,80%,100%{transform:scale(1)}88%{transform:scale(1.45)}}',
    acts: {
      idle: ['循环箭头慢慢转'],
      wave: ['热情挥手，冒出爱心'],
      think: ['气泡里一个回环箭头', '↺'],
      ask: ['「你怎么看？」', '怎么看'],
      raise: ['举起笔记本，等你过目', '📒'],
      wait: ['边等边记笔记', 'calm'],
      type: ['写复盘文档，要点一条条冒出来', '•'],
      carry: ['抱着一摞复盘笔记', '复盘'],
      run: ['小跑着去开会'],
      done: ['爱心炸开', '❤'],
      error: ['不慌，先记一笔', '✎', { face: 'open' }],
      sleep: ['抱着笔记本睡'],
    },
  },
]

function face(ip: Persona, st: Face) {
  if (st === 'open') return ip.open(ip.to)
  const k = ip.eyeInk || ip.to,
    s = ip.s,
    w = 1.8 * s,
    [mx, my] = ip.M
  const arc = (x: number, y: number, up?: number) =>
    `M${x - w} ${y + (up ? 0.6 : -0.2)}q${w} ${up ? -2.4 * s : 1.8 * s} ${2 * w} 0`
  const cross = (x: number, y: number) => {
    const d = 1.4 * s
    return `M${x - d} ${y - d}l${2 * d} ${2 * d}m0 ${-2 * d}l${-2 * d} ${2 * d}`
  }
  const [[x1, y1], [x2, y2]] = ip.E as [[number, number], [number, number]]
  let eyes: string
  let mouth: string
  if (st === 'happy') {
    eyes = `<path d="${arc(x1, y1, 1)}${arc(x2, y2, 1)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 2.6 * s} ${my - 0.8}h${5.2 * s}a${2.6 * s} ${2.6 * s} 0 0 1 ${-5.2 * s} 0z" fill="${ip.to}"/>`
  } else if (st === 'closed') {
    eyes = `<path d="${arc(x1, y1)}${arc(x2, y2)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 1.4} ${my}q1.4 1 2.8 0" ${stroke(ip.to, 1.2)}/>`
  } else if (st === 'x') {
    eyes = `<path d="${cross(x1, y1)}${cross(x2, y2)}" ${stroke(k, 1.3)}/>`
    mouth = `<path d="M${mx - 2.4} ${my}q.6-.9 1.2 0t1.2 0 1.2 0 1.2 0" ${stroke(ip.to, 1.1)}/>`
  } else {
    eyes = `<ellipse cx="${x1}" cy="${y1}" rx="${1.4 * s}" ry="${1.7 * s}" fill="${k}"/><path d="${arc(x2, y2)}" ${stroke(k, 1.4)}/>`
    mouth = `<path d="M${mx - 1.4} ${my}q1.4 .6 2.8 0" ${stroke(ip.to, 1.2)}/>`
  }
  return eyes + mouth
}

const LINE = '#cfd6e2'
const lbl = (t: string, x: number, y: number, c: string, size = 6.5) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" class="lbl" fill="${c}" font-size="${size}">${t}</text>`
const fitSize = (t: string) => (t.length > 3 ? 4.6 : t.length > 2 ? 5.4 : 7)
const bubble = (ip: Persona, t: string) =>
  `<g class="bub"><circle class="b1" cx="37.5" cy="3.5" r="1.3" fill="#fff" stroke="${LINE}" stroke-width=".6"/><circle class="b2" cx="40.5" cy="-.5" r="2" fill="#fff" stroke="${LINE}" stroke-width=".6"/>` +
  `<rect x="33" y="-13.5" width="18.5" height="11.5" rx="5.75" fill="#fff" stroke="${LINE}" stroke-width=".6"/><g class="c">${lbl(t, 42.25, -7.6, ip.to, fitSize(t))}</g></g>`
const hand = (ip: Persona, x: number, y: number, cls = 'hand') =>
  `<g class="${cls}"><circle cx="${x}" cy="${y}" r="3.6" fill="${ip.to}" stroke="#fff" stroke-width="1.3"/></g>`
const feet = (ip: Persona) =>
  `<ellipse class="fl" cx="13" cy="42.5" rx="4.4" ry="2.4" fill="${ip.to}" stroke="#fff" stroke-width="1.1"/><ellipse class="fr" cx="27" cy="42.5" rx="4.4" ry="2.4" fill="${ip.to}" stroke="#fff" stroke-width="1.1"/>`
const card = (ip: Persona, t: string, x: number, y: number) =>
  `<rect x="${x - 9}" y="${y - 5.5}" width="18" height="11" rx="2.4" fill="#fff" stroke="${ip.to}" stroke-width="1"/>${lbl(t, x, y + 0.2, ip.to, fitSize(t))}`
const sparks = (c: string) =>
  `<g class="spk" fill="${c}"><path d="M-6 6l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/><path d="M46 20l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/><circle cx="-4" cy="24" r="1"/></g>`

/** Small scenes can't fit words: short symbols stay, anything longer or in Chinese falls back. */
const fitsSmall = (t: string) => t.length <= 2 && !/\p{Script=Han}/u.test(t)
const FALLBACK: Partial<Record<MascotAction, string>> = {
  think: '…',
  ask: '?',
  raise: '!',
  done: '✓',
  error: '!',
}

const PROPS: Record<MascotAction, (ip: Persona, a: Act) => { back?: string; front?: string }> = {
  idle: () => ({}),
  wave: (ip) => ({ front: hand(ip, 46, 12) }),
  think: (ip, [, t = '']) => ({ front: bubble(ip, t) + hand(ip, 42, 32) }),
  ask: (ip, [, t = '']) => ({ front: bubble(ip, t) }),
  raise: (ip, [, t = '']) => ({
    front: `<g class="hand"><path d="M45 -1v9" ${stroke(ip.to, 1.4)}/>${card(ip, t, 45, -6)}<circle cx="45" cy="10" r="3.6" fill="${ip.to}" stroke="#fff" stroke-width="1.3"/></g>`,
  }),
  wait: (ip, [, style = '']) => ({
    back: `<g class="hg"><path d="M-9 26h7l-3.5 4.4 3.5 4.4h-7l3.5-4.4z" fill="#fff" stroke="${ip.to}" stroke-width="1" stroke-linejoin="round"/><path d="M-7.6 27h4.2l-2.1 2.6z" fill="#ffd84a"/></g>`,
    front: style === 'tap' ? hand(ip, 42, 36, 'hand tap') : '',
  }),
  type: (ip, [, t = '']) => ({
    front:
      `<rect x="3" y="27" width="34" height="16" rx="3" fill="#eef1f6" stroke="#c9d1dd" stroke-width=".8"/>${lbl(t, 20, 35, ip.to, fitSize(t))}` +
      `<rect x="-2" y="42.5" width="44" height="3" rx="1.5" fill="#c9d1dd"/>${hand(ip, 10, 42, 'hand h1')}${hand(ip, 30, 42, 'hand h2')}` +
      `<g fill="${ip.to}" class="code"><rect class="l1" x="42" y="6" width="9" height="1.8" rx=".9"/><rect class="l2" x="42" y="10" width="6" height="1.8" rx=".9"/><rect class="l3" x="42" y="14" width="8" height="1.8" rx=".9"/></g>`,
  }),
  carry: (ip, [, t = '']) => ({
    back: feet(ip),
    front:
      `<g class="load"><rect x="6" y="-13.5" width="28" height="10" rx="2.4" fill="#fff" stroke="${ip.to}" stroke-width="1.1"/>${lbl(t, 20, -8.3, ip.to, fitSize(t) - 0.4)}${hand(ip, 3, -3, '')}${hand(ip, 37, -3, '')}</g>` +
      `<path class="sweat" d="M43 5q2.6 3.4 0 5.2-2.6-1.8 0-5.2z" fill="#6fc3ff"/>`,
  }),
  run: (ip) => ({
    back:
      feet(ip) +
      `<g class="spd" ${stroke(ip.from, 1.6)}><path d="M-10 12h6"/><path d="M-11 20h7"/><path d="M-9 28h5"/></g>`,
  }),
  done: (ip, [, t = '']) => ({
    front: `${sparks(ip.from)}<g class="pop">${lbl(t, 44, -5, ip.to, t.length > 2 ? 6 : 10)}</g>`,
  }),
  error: (_ip, [, t = '']) => ({
    front: `<g class="bang">${lbl(t, 45, -5, '#ff453a', t.length > 2 ? 6 : 10)}</g><path class="sweat" d="M43 8q2.6 3.4 0 5.2-2.6-1.8 0-5.2z" fill="#6fc3ff"/>`,
  }),
  sleep: (ip, a) => {
    const z = a[2]?.z || 'Z'
    return {
      front: `<g class="zz" fill="${ip.to}">${lbl(z, 40, 2, ip.to, 7)}${lbl(z, 45, -4, ip.to, 8.5)}${lbl(z, 50, -11, ip.to, 10)}</g>`,
    }
  },
}

const D = (s: number) => `calc(var(--t)*${s}s)`
const ACT_CSS: Record<MascotAction, string> = {
  idle: `.fig{animation:bob ${D(2.4)} ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1.2px)}}`,
  wave: `.fig{animation:tilt ${D(1.2)} ease-in-out infinite}@keyframes tilt{50%{transform:rotate(-4deg)}}.hand{transform-box:view-box;transform-origin:44px 22px;animation:wave ${D(0.5)} ease-in-out infinite alternate}@keyframes wave{from{transform:rotate(-25deg)}to{transform:rotate(22deg)}}`,
  think: `.fig{animation:think ${D(3)} ease-in-out infinite}@keyframes think{50%{transform:rotate(-3deg)}}.c{animation:pulse ${D(1.6)} ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}.b1{animation:pulse ${D(1.6)} infinite}.b2{animation:pulse ${D(1.6)} infinite .2s}`,
  ask: `.fig{animation:askt ${D(2)} ease-in-out infinite}@keyframes askt{0%,100%{transform:rotate(0)}40%,70%{transform:rotate(6deg)}}.c{transform-box:fill-box;transform-origin:center;animation:qb ${D(0.8)} ease-in-out infinite alternate}@keyframes qb{to{transform:translateY(-1px) scale(1.08)}}`,
  raise: `.hand{animation:raise ${D(0.7)} ease-in-out infinite alternate}@keyframes raise{to{transform:translateY(-2.2px)}}.fig{animation:bob ${D(1.4)} ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1px)}}`,
  wait: `.hg{transform-origin:-5.5px 30.4px;animation:flip ${D(2.4)} ease-in-out infinite}@keyframes flip{0%,60%{transform:rotate(0)}80%,100%{transform:rotate(180deg)}}`,
  type:
    `.h1{animation:key ${D(0.24)} ease-in-out infinite alternate}.h2{animation:key ${D(0.24)} ease-in-out infinite alternate-reverse}@keyframes key{to{transform:translateY(-2px)}}` +
    `.code rect{transform-box:fill-box;transform-origin:0 50%;animation:ln ${D(1.8)} steps(1) infinite}.l2{animation-delay:${D(0.3)}!important}.l3{animation-delay:${D(0.6)}!important}@keyframes ln{0%{transform:scaleX(0)}30%,100%{transform:scaleX(1)}}`,
  carry: `.fig,.load{animation:heave ${D(0.8)} ease-in-out infinite}@keyframes heave{50%{transform:translateY(1.2px)}}.fl{animation:stepl ${D(0.8)} ease-in-out infinite}.fr{animation:stepl ${D(0.8)} ease-in-out infinite reverse}@keyframes stepl{50%{transform:translateY(-1.8px)}}.sweat{animation:drip ${D(1.2)} ease-in infinite}@keyframes drip{from{transform:translateY(0);opacity:1}to{transform:translateY(5px);opacity:0}}`,
  run:
    `.fig{animation:runb ${D(0.36)} ease-in-out infinite alternate}@keyframes runb{from{transform:rotate(6deg) translateY(0)}to{transform:rotate(6deg) translateY(-2px)}}.fl{animation:kick ${D(0.36)} ease-in-out infinite alternate}.fr{animation:kick ${D(0.36)} ease-in-out infinite alternate-reverse}@keyframes kick{from{transform:translateX(-3px)}to{transform:translate(3px,-1.5px)}}` +
    `.spd path{animation:dash ${D(0.5)} linear infinite}.spd path:nth-child(2){animation-delay:.15s}.spd path:nth-child(3){animation-delay:.3s}@keyframes dash{from{transform:translateX(4px);opacity:0}50%{opacity:1}to{transform:translateX(-4px);opacity:0}}`,
  done: `.fig{animation:jump ${D(1)} cubic-bezier(.3,0,.5,1) infinite}@keyframes jump{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}.pop{transform-box:fill-box;transform-origin:center;animation:pop ${D(1)} ease-out infinite}@keyframes pop{0%,20%{transform:scale(.4);opacity:0}40%,90%{transform:scale(1);opacity:1}100%{opacity:0}}.spk{animation:tw ${D(1)} ease-in-out infinite}@keyframes tw{50%{opacity:.2}}`,
  error: `.fig{animation:shake ${D(0.9)} ease-in-out infinite}@keyframes shake{0%,50%,100%{transform:translateX(0)}10%,30%{transform:translateX(-1.6px)}20%,40%{transform:translateX(1.6px)}}.bang{transform-box:fill-box;transform-origin:center;animation:pop ${D(0.9)} ease-out infinite}@keyframes pop{0%{transform:scale(.4)}30%,100%{transform:scale(1)}}.sweat{animation:drip ${D(1.2)} ease-in infinite}@keyframes drip{from{transform:translateY(0);opacity:1}to{transform:translateY(5px);opacity:0}}`,
  sleep: `.fig{animation:snore ${D(3)} ease-in-out infinite}@keyframes snore{50%{transform:rotate(-3deg) translateY(1px)}}.zz text{animation:zz ${D(3)} ease-in-out infinite}.zz text:nth-child(2){animation-delay:${D(1)}}.zz text:nth-child(3){animation-delay:${D(2)}}@keyframes zz{0%{opacity:0;transform:translateY(3px)}30%,70%{opacity:1}100%{opacity:0;transform:translateY(-3px)}}`,
}
const WAIT_CSS: Record<string, string> = {
  calm: `.fig{animation:bob ${D(3)} ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1px)}}`,
  tap: `.tap{animation:tap ${D(0.3)} ease-in-out infinite alternate}@keyframes tap{to{transform:translateY(-2.4px)}}`,
  hop: `.fig{animation:hopw ${D(0.5)} cubic-bezier(.3,0,.5,1) infinite alternate}@keyframes hopw{to{transform:translateY(-2.4px)}}`,
  still: '',
  sway: `.fig{animation:swayw ${D(2.4)} ease-in-out infinite}@keyframes swayw{25%{transform:rotate(-4deg)}75%{transform:rotate(4deg)}}`,
  fidget: `.fig{animation:fid ${D(0.3)} linear infinite}@keyframes fid{25%{transform:translateX(-.6px)}75%{transform:translateX(.6px)}}`,
}
const BASE =
  '.lbl{font-family:-apple-system,"PingFang SC",sans-serif;font-weight:700}.fig{transform-origin:20px 40px}.hand,.tap,.h1,.h2{transform-box:fill-box}.hand{transform-origin:center}'

const scenes = new Map<string, string>()

/** The persona acting out a mascot action, as an SVG data URI; `words` lets its props spell things out. */
export function personaScene(ip: Persona, act: MascotAction, words = true) {
  const id = ip.key + act + (words ? '+' : '')
  let src = scenes.get(id)
  if (!src) {
    const full = ip.acts[act]
    const t = full[1]
    const a: Act =
      words || act === 'wait' || !t || fitsSmall(t) ? full : [full[0], FALLBACK[act] ?? '', full[2]]
    const ex = a[2] ?? {}
    const st = ex.face ?? FACE[act] ?? 'open'
    const { back = '', front = '' } = PROPS[act](ip, a)
    const style =
      BASE +
      ACT_CSS[act] +
      (act === 'wait' ? (WAIT_CSS[a[1] ?? ''] ?? '') : '') +
      (WORKING.has(act) || act === 'idle' ? ip.motion : '') +
      (ex.css ?? '')
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 -16 68 68" style="--t:${ip.tempo}"><style>${style}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ip.from}"/><stop offset="1" stop-color="${ip.to}"/></linearGradient><clipPath id="t"><rect width="40" height="40" rx="9"/></clipPath></defs>` +
      `<ellipse cx="20" cy="46.5" rx="14" ry="1.8" fill="#000" opacity=".1"/>${back}` +
      `<g class="fig"><rect width="40" height="40" rx="9" fill="url(#g)"/><g clip-path="url(#t)">${ip.glyph(ip.to, face(ip, st), st)}</g></g>${ex.fx ?? ''}${front}</svg>`
    src = `data:image/svg+xml,${encodeURIComponent(svg)}`
    scenes.set(id, src)
  }
  return src
}
