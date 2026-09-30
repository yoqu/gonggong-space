<script setup lang="ts">
import { computed, ref } from 'vue'
import { PERSONAS, personaScene } from '../../../../apps/web/src/features/bots/personas'
import { useCopy } from './copy'
import { clamp, useClock, vReveal } from './motion'

/*
 * A scripted day in one group, replayed on a loop: three people and three Bots on three machines hand one feature
 * along a relay, with an approval stamped by the Bot's owner on the way. Everything on screen derives from the clock.
 */
type L = [zh: string, en: string]
type Who = 'wang' | 'li' | 'chen' | 'fe' | 'be' | 'qa'
interface Bot {
  persona: string
  owner: Who
  machine: string
  agent: string
}
const CAST: Record<Who, { name: L; tone?: string; bot?: Bot }> = {
  wang: { name: ['王磊', 'Wang Lei'], tone: '#c2394b' },
  li: { name: ['李娜', 'Li Na'], tone: '#b8612e' },
  chen: { name: ['陈晨', 'Chen Chen'], tone: '#d07a2a' },
  fe: {
    name: ['前端小助手', 'Frontend Helper'],
    bot: { persona: 'braces', owner: 'wang', machine: 'wanglei-mbp', agent: 'Claude Code' },
  },
  be: {
    name: ['后端助手', 'Backend Helper'],
    bot: { persona: 'steps', owner: 'li', machine: 'lina-linux', agent: 'Codex' },
  },
  qa: {
    name: ['测试助手', 'Test Helper'],
    bot: { persona: 'sentry', owner: 'chen', machine: 'chen-win', agent: 'Claude Code' },
  },
}
const PEOPLE: Who[] = ['wang', 'li', 'chen']
const BOTS: Who[] = ['fe', 'be', 'qa']
const ME: Who = 'wang'

interface Step {
  at: number
  verb: L
  target: string
}
type Ev =
  | { at: number; kind: 'msg'; from: Who; text: L; react?: { at: number; by: Who[] } }
  | {
      at: number
      kind: 'run'
      bot: Who
      by: Who
      steps: Step[]
      done: number
      files: number
      ask?: { at: number; ok: number; cmd: string }
    }
  | { at: number; kind: 'preview'; from: Who }

const READ: L = ['读取', 'Read']
const EDIT: L = ['编辑', 'Edit']
const RUN: L = ['运行', 'Run']
const SCRIPT: Ev[] = [
  {
    at: 0.6,
    kind: 'msg',
    from: 'li',
    text: [
      '周五上线「只看未完成」筛选。@前端小助手 先把按钮做了，状态记在 localStorage',
      'The “active only” filter ships Friday. @Frontend Helper build the toggle first, keep it in localStorage',
    ],
  },
  {
    at: 2.2,
    kind: 'run',
    bot: 'fe',
    by: 'li',
    steps: [
      { at: 3, verb: READ, target: 'public/app.js' },
      { at: 4.2, verb: EDIT, target: 'public/app.js  +18 −2' },
      { at: 5.2, verb: EDIT, target: 'README.md  +3' },
    ],
    done: 6.2,
    files: 2,
  },
  {
    at: 7.2,
    kind: 'msg',
    from: 'fe',
    text: [
      '按钮加好了。要多端同步还缺个接口，@后端助手 接力补 /api/prefs',
      'Toggle is in. Syncing across devices needs an API — @Backend Helper take over /api/prefs',
    ],
  },
  {
    at: 8.6,
    kind: 'run',
    bot: 'be',
    by: 'fe',
    steps: [
      { at: 9.4, verb: EDIT, target: 'server/routes/prefs.js  +42' },
      { at: 10.6, verb: RUN, target: 'npm test  ✓ 36' },
      { at: 11.6, verb: RUN, target: 'git push origin feat/only-active' },
    ],
    ask: { at: 11.8, ok: 14, cmd: 'git push origin feat/only-active' },
    done: 15,
    files: 3,
  },
  {
    at: 15.8,
    kind: 'msg',
    from: 'be',
    text: [
      '接口已推送。@测试助手 帮忙跑一遍回归',
      'API is pushed. @Test Helper please run the regression suite',
    ],
  },
  {
    at: 17.2,
    kind: 'run',
    bot: 'qa',
    by: 'be',
    steps: [
      { at: 18, verb: READ, target: 'e2e/todo.spec.ts' },
      { at: 19.2, verb: RUN, target: 'pnpm playwright test  ✓ 12' },
    ],
    done: 20.4,
    files: 0,
  },
  { at: 21, kind: 'preview', from: 'qa' },
  {
    at: 23,
    kind: 'msg',
    from: 'chen',
    text: ['预览点开看了，交互没问题', 'Opened the preview — the interaction works'],
    react: { at: 24.2, by: ['li', 'wang'] },
  },
  { at: 25.6, kind: 'msg', from: 'wang', text: ['合并，周五见', 'Merging. See you Friday'] },
]
const LOOP = 30

const root = ref<HTMLElement>()
const t = useClock(root, LOOP, 28)
const { isEn } = useCopy()
const l = (s: L) => s[isEn.value ? 1 : 0]
const name = (w: Who) => l(CAST[w].name)

const UI = {
  running: ['运行中', 'Running'],
  waiting: ['等待审批', 'Awaiting approval'],
  done: ['已完成', 'Done'],
  idle: ['空闲', 'Idle'],
  online: ['在线', 'Online'],
  typing: ['正在输入', 'is typing'],
  ask: ['请求权限', 'Permission request'],
  beyond: ['超出「工作区写入」档位', 'beyond the Workspace write tier'],
  approve: ['批准', 'Approve'],
  deny: ['拒绝', 'Deny'],
  approved: ['已批准', 'approved'],
  stamp: ['准', 'OK'],
  files: ['改动 {n} 个文件', '{n} files changed'],
  nofiles: ['未改动文件', 'no files changed'],
  by: ['{n} 触发', 'triggered by {n}'],
  relay: ['接力链', 'Relay'],
  members: ['群成员', 'Members'],
  owner: ['{n} 的机器', '{n}’s machine'],
  compose: ['输入消息，@ 触发 Bot', 'Message the group, @ a Bot'],
  open: ['打开预览', 'Open preview'],
  preview: ['todo-app：只看未完成筛选', 'todo-app: active-only filter'],
  group: ['todo-app 开发群', 'todo-app dev group'],
  meta: ['3 人 · 3 Bot · main', '3 people · 3 Bots · main'],
  kicker: ['一个群里的一轮接力', 'One relay in one group'],
  lead: [
    '谁提需求谁 @，Bot 在各自主人的机器上干活，干完把棒交给下一个 Bot；越权操作由主人盖章批准，结果大家一起看。',
    'Whoever needs something @s a Bot. Each Bot works on its owner’s machine and hands the baton to the next; anything beyond its tier waits for the owner’s stamp, and everyone sees the result.',
  ],
} satisfies Record<string, L>
const TITLE: [L, L] = [
  ['三个人、三个 Bot、三台机器，', 'Three people, three Bots, three machines —'],
  ['接力把活干完', 'one relay to done'],
]
const u = (k: keyof typeof UI, n = '') => l(UI[k]).replace('{n}', n)

const stamp = (s: number) => `16:${20 + Math.floor(s / 4)}`
const mmss = (s: number) => `00:${String(Math.floor(s)).padStart(2, '0')}`

/** The bot's avatar: its persona acting out what it is doing right now. */
const persona = (w: Who, act: 'idle' | 'type' | 'raise' | 'done' | 'wave') => {
  const ip = PERSONAS.find((p) => p.key === CAST[w].bot?.persona)
  return ip ? personaScene(ip, act, false) : ''
}

type RunEv = Extract<Ev, { kind: 'run' }>
const runOf = (w: Who) => SCRIPT.find((e): e is RunEv => e.kind === 'run' && e.bot === w)
const botState = (w: Who) => {
  const r = runOf(w)
  if (!r || t.value < r.at) return 'idle'
  if (t.value >= r.done) return 'done'
  if (r.ask && t.value >= r.ask.at && t.value < r.ask.ok) return 'waiting'
  return 'running'
}
const ACT = { idle: 'idle', running: 'type', waiting: 'raise', done: 'done' } as const

const feed = computed(() => SCRIPT.filter((e) => e.at <= t.value))
const typing = computed(() => {
  const next = SCRIPT.find((e) => e.at > t.value)
  if (!next || next.kind === 'run' || next.at - t.value > 1.3) return undefined
  return next.from
})
const fading = computed(() => t.value > LOOP - 1.2)

/** The baton's position along the relay: 0…2 while a Bot works, easing between Bots in the hand-offs. */
const baton = computed(() => {
  const runs = BOTS.map((b) => runOf(b) as RunEv)
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]
    if (t.value >= r.at) {
      const prev = runs[i - 1]
      if (!prev) return i
      return i - 1 + clamp((t.value - r.at + 1.4) / 1.4)
    }
  }
  return 0
})

const parts = (text: string) => {
  const names = BOTS.map(name).join('|')
  return text.split(new RegExp(`(@(?:${names}))`)).filter(Boolean)
}
</script>

<template>
  <section ref="root" class="live">
    <div v-reveal class="gg-wrap head">
      <p class="gg-kicker gg-rise">{{ u('kicker') }}</p>
      <h2 class="gg-h2 gg-rise" style="--i: 1">
        {{ l(TITLE[0]) }}<br />{{ l(TITLE[1]) }}
      </h2>
      <p class="gg-lead gg-rise" style="--i: 2">{{ u('lead') }}</p>
    </div>

    <div class="gg-wrap grid">
      <div class="app" :class="{ fading }">
        <header class="app__bar">
          <span class="group-avatar"><i v-for="p in PEOPLE" :key="p" :style="{ background: CAST[p].tone }" /></span>
          <div>
            <b>{{ u('group') }}</b>
            <small>{{ u('meta') }}</small>
          </div>
          <span class="app__chips">
            <span v-for="b in BOTS" :key="b" class="chip" :class="botState(b)">
              <i />{{ name(b) }}
            </span>
          </span>
        </header>

        <div class="feed">
          <TransitionGroup name="msg" tag="div" class="feed__list">
            <div
              v-for="e in feed"
              :key="e.at"
              class="row"
              :class="{ mine: 'from' in e && e.from === ME }"
            >
              <template v-if="e.kind === 'msg'">
                <span v-if="CAST[e.from].bot" class="avatar avatar--bot">
                  <img :src="persona(e.from, 'idle')" alt="" />
                </span>
                <span v-else class="avatar" :style="{ background: CAST[e.from].tone }">{{ name(e.from).slice(-2) }}</span>
                <div class="body">
                  <p class="who">
                    {{ name(e.from) }}<span v-if="CAST[e.from].bot" class="tag">Bot</span><time>{{ stamp(e.at) }}</time>
                  </p>
                  <p class="bubble">
                    <template v-for="(s, i) in parts(l(e.text))" :key="i">
                      <span v-if="s.startsWith('@')" class="at">{{ s }}</span>
                      <template v-else>{{ s }}</template>
                    </template>
                  </p>
                  <p v-if="e.react && t >= e.react.at" class="reacts">
                    <span class="react">👍 {{ e.react.by.map(name).join(isEn ? ', ' : '、') }}</span>
                  </p>
                </div>
              </template>

              <template v-else-if="e.kind === 'run'">
                <span class="avatar avatar--bot">
                  <img :src="persona(e.bot, ACT[botState(e.bot)])" alt="" />
                </span>
                <div class="body">
                  <p class="who">
                    {{ name(e.bot) }}<span class="tag">Bot</span><time>{{ stamp(e.at) }}</time>
                    <span class="sub">{{ CAST[e.bot].bot?.agent }} · {{ u('by', name(e.by)) }}</span>
                  </p>
                  <div class="run" :class="botState(e.bot)">
                    <p class="run__status">
                      <i class="dot" />{{ u(botState(e.bot)) }}
                      <span class="machine">{{ CAST[e.bot].bot?.machine }}</span>
                    </p>
                    <ol class="steps">
                      <li
                        v-for="s in e.steps"
                        :key="s.at"
                        :class="{ on: t >= s.at, cur: t >= s.at && t < e.done && s === e.steps.findLast((x) => t >= x.at) }"
                      >
                        <span class="verb">{{ l(s.verb) }}</span><code>{{ s.target }}</code>
                      </li>
                    </ol>
                    <div v-if="e.ask" class="ask" :class="{ on: t >= e.ask.at, ok: t >= e.ask.ok }">
                      <p>
                        <b>{{ u('ask') }}</b> <code>{{ e.ask.cmd }}</code>
                        <small>{{ u('beyond') }}</small>
                      </p>
                      <p class="ask__actions">
                        <span class="btn btn--ok" :class="{ press: t >= e.ask.ok - 0.35 }">{{ u('approve') }}</span>
                        <span class="btn">{{ u('deny') }}</span>
                        <span class="ask__who">{{ name(CAST[e.bot].bot!.owner) }} {{ u('approved') }}</span>
                      </p>
                      <span class="seal" aria-hidden="true">{{ u('stamp') }}</span>
                    </div>
                    <p class="run__meta">
                      <span>{{ e.files ? u('files', String(e.files)) : u('nofiles') }}</span>
                      <span>{{ mmss(clamp(t - e.at, 0, e.done - e.at) * 4.3) }}</span>
                      <span>{{ (clamp(t - e.at, 0, e.done - e.at) * 9.7).toFixed(1) }}k tokens</span>
                    </p>
                  </div>
                </div>
              </template>

              <template v-else>
                <span class="avatar avatar--bot"><img :src="persona(e.from, 'done')" alt="" /></span>
                <div class="body">
                  <p class="who">{{ name(e.from) }}<span class="tag">Bot</span><time>{{ stamp(e.at) }}</time></p>
                  <div class="preview">
                    <div class="preview__shot">
                      <b>{{ isEn ? 'To-do' : '待办清单' }}</b>
                      <span class="filter">{{ isEn ? 'Active only' : '只看未完成' }}</span>
                      <span v-for="n in 3" :key="n" class="todo" :style="{ '--w': `${50 + n * 12}%` }"><i />
                      </span>
                    </div>
                    <p class="preview__bar">
                      <i class="dot" />{{ u('preview') }} <code>:4380</code><span class="open">{{ u('open') }}</span>
                    </p>
                  </div>
                </div>
              </template>
            </div>
          </TransitionGroup>
          <p class="typing" :class="{ on: typing }">
            <span class="dots"><i /><i /><i /></span>{{ typing ? `${name(typing)} ${u('typing')}` : '' }}
          </p>
        </div>

        <footer class="composer">{{ u('compose') }}<span class="send">↑</span></footer>
      </div>

      <aside class="side">
        <div class="panel">
          <h4>{{ u('relay') }}</h4>
          <div class="chain" :style="{ '--b': baton }">
            <div v-for="b in BOTS" :key="b" class="link" :class="botState(b)">
              <img :src="persona(b, ACT[botState(b)])" alt="" />
              <span>{{ name(b) }}</span>
              <small>{{ u(botState(b)) }}</small>
            </div>
            <span class="baton" aria-hidden="true" />
          </div>
        </div>
        <div class="panel">
          <h4>{{ u('members') }}</h4>
          <ul class="roster">
            <li v-for="p in PEOPLE" :key="p">
              <span class="avatar avatar--sm" :style="{ background: CAST[p].tone }">{{ name(p).slice(-2) }}</span>
              <span class="roster__name">{{ name(p) }}</span>
              <small class="online">{{ u('online') }}</small>
            </li>
            <li v-for="b in BOTS" :key="b">
              <span class="avatar avatar--sm avatar--bot"><img :src="persona(b, 'idle')" alt="" /></span>
              <span class="roster__name">
                {{ name(b) }}
                <small>{{ u('owner', name(CAST[b].bot!.owner)) }} · {{ CAST[b].bot?.machine }}</small>
              </span>
              <small class="state" :class="botState(b)">{{ u(botState(b)) }}</small>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.live {
  padding: clamp(96px, 14vh, 150px) 0 clamp(80px, 12vh, 140px);
  background: var(--paper);
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr);
  gap: 28px;
  margin-top: 48px;
  align-items: start;
}

/* The chat window mirrors the product's own look: light, hairlines, capsule controls. */
.app {
  --bg: #fff;
  --soft: #f2f2f4;
  --line: rgb(0 0 0 / 0.08);
  --text: rgb(0 0 0 / 0.85);
  --muted: rgb(0 0 0 / 0.5);
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 600px;
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  box-shadow:
    0 0 0 1px var(--line),
    0 30px 70px -28px rgb(27 34 51 / 0.45);
  transition: opacity 0.8s;
}
.dark .app {
  --bg: #1b1d22;
  --soft: #2a2d34;
  --line: rgb(255 255 255 / 0.1);
  --text: rgb(255 255 255 / 0.88);
  --muted: rgb(255 255 255 / 0.5);
}
.app.fading {
  opacity: 0;
}
.app__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.app__bar b {
  display: block;
}
.app__bar small {
  color: var(--muted);
  font-size: 12px;
}
.group-avatar {
  display: grid;
  grid-template-columns: repeat(2, 13px);
  gap: 2px;
}
.group-avatar i {
  width: 13px;
  height: 13px;
  border-radius: 4px;
}
.app__chips {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--soft);
  font-size: 11.5px;
  color: var(--muted);
  transition: background-color 0.3s;
}
.chip i,
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #aeb3bd;
  transition: background-color 0.3s;
}
.chip.running,
.chip.waiting {
  color: var(--text);
}
.running i,
.running .dot {
  background: #0a84ff;
  animation: blink 1s ease-in-out infinite;
}
.waiting i,
.waiting .dot {
  background: #ff9f0a;
  animation: blink 0.6s ease-in-out infinite;
}
.done i,
.done .dot {
  background: #30d158;
}
@keyframes blink {
  50% {
    opacity: 0.35;
  }
}

.feed {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 0;
  padding: 0 16px 8px;
  overflow: hidden;
  mask: linear-gradient(transparent, #000 64px);
}
.feed__list {
  display: grid;
  gap: 14px;
}
.row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.row.mine {
  flex-direction: row-reverse;
}
.row.mine .body {
  align-items: flex-end;
}
.row.mine .bubble {
  background: #dbeaff;
  color: #102a4c;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  max-width: min(82%, calc(100% - 44px));
}
.avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  position: relative;
}
.avatar--bot {
  border-radius: 9px;
  background: transparent;
}
/* Frame the persona's own tile out of its roomier scene. */
.avatar--bot img {
  position: absolute;
  width: 170%;
  height: 170%;
  left: -35%;
  top: -40%;
  max-width: none;
}
.avatar--sm {
  width: 28px;
  height: 28px;
  font-size: 10px;
}
.who {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--muted);
}
.who time {
  font-variant-numeric: tabular-nums;
}
.who .sub {
  color: color-mix(in srgb, var(--muted) 70%, transparent);
}
.tag {
  padding: 0 6px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 17px;
  color: #0a6fdc;
  background: rgb(10 132 255 / 0.12);
}
.bubble {
  margin: 0;
  padding: 8px 12px;
  border-radius: 5px 14px 14px 14px;
  background: var(--soft);
  font-size: 14px;
  line-height: 1.6;
}
.row.mine .bubble {
  border-radius: 14px 5px 14px 14px;
}
.at {
  color: #0a6fdc;
  font-weight: 500;
}
.reacts {
  margin: 0;
}
.react {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--line);
  animation: pop 0.45s cubic-bezier(0.3, 1.8, 0.5, 1);
}
@keyframes pop {
  from {
    transform: scale(0.4);
    opacity: 0;
  }
}

.run {
  position: relative;
  width: min(420px, 100%);
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow 0.4s;
}
.run.waiting {
  box-shadow: inset 0 0 0 1.5px #ff9f0a;
}
.run__status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
}
.machine {
  margin-left: auto;
  font: 500 11.5px var(--mono);
  color: var(--muted);
}
.steps {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.steps li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 12.5px;
  opacity: 0;
  transform: translateX(-8px);
  transition:
    opacity 0.35s,
    transform 0.35s;
}
.steps li.on {
  opacity: 1;
  transform: none;
}
.verb {
  flex: none;
  width: 2.8em;
  color: var(--muted);
}
.steps code {
  font: 12px var(--mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: none;
  padding: 0;
  color: var(--text);
}
.steps li.cur code::after {
  content: '▍';
  margin-left: 2px;
  color: #0a84ff;
  animation: blink 0.8s steps(1) infinite;
}
.run__meta {
  display: flex;
  gap: 12px;
  margin: 10px 0 0;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.ask {
  position: relative;
  display: none;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(255 159 10 / 0.1);
  font-size: 12.5px;
}
.ask.on {
  display: block;
  animation: pop 0.4s cubic-bezier(0.3, 1.5, 0.5, 1);
}
.ask p {
  margin: 0;
}
.ask code {
  font: 11.5px var(--mono);
  background: none;
  padding: 0;
}
.ask small {
  display: block;
  color: var(--muted);
}
.ask__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px !important;
}
.btn {
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 12px;
  box-shadow: inset 0 0 0 1px var(--line);
  transition: transform 0.15s;
}
.btn--ok {
  background: #0a6fdc;
  color: #fff;
  box-shadow: none;
}
.btn--ok.press {
  transform: scale(0.92);
}
.ask__who {
  display: none;
  font-weight: 600;
  color: #1f8a3a;
}
.ask.ok .btn {
  display: none;
}
.ask.ok .ask__who {
  display: inline;
}
.seal {
  position: absolute;
  right: 14px;
  bottom: 8px;
  display: none;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 8px;
  font: 900 22px var(--serif);
  color: var(--seal);
  box-shadow: inset 0 0 0 2.5px var(--seal);
  transform: rotate(-12deg);
}
.ask.ok .seal {
  display: grid;
  animation: slam 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes slam {
  from {
    transform: rotate(-12deg) scale(2.4);
    opacity: 0;
  }
  60% {
    opacity: 1;
  }
}

.preview {
  width: min(360px, 100%);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px var(--line);
}
.preview__shot {
  display: grid;
  gap: 7px;
  padding: 14px 18px;
  background: linear-gradient(#f4f6fb, #eef1f8);
  color: #1b2233;
  font-size: 13px;
}
.filter {
  justify-self: start;
  padding: 2px 9px;
  border-radius: 6px;
  font-size: 11px;
  color: #2f6bff;
  background: rgb(47 107 255 / 0.12);
}
.todo {
  display: flex;
  align-items: center;
  gap: 8px;
}
.todo i {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  box-shadow: inset 0 0 0 1.5px #9aa3b5;
}
.todo::after {
  content: '';
  width: var(--w);
  height: 7px;
  border-radius: 4px;
  background: #d5dae5;
}
.preview__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 8px 12px;
  font-size: 12.5px;
  background: var(--bg);
}
.preview__bar .dot {
  background: #30d158;
}
.preview__bar code {
  font: 11.5px var(--mono);
  color: var(--muted);
  background: none;
  padding: 0;
}
.open {
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: #fff;
  background: #0a6fdc;
}

.typing {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 22px;
  margin: 8px 0 0 44px;
  font-size: 12px;
  color: var(--muted);
  opacity: 0;
  transition: opacity 0.2s;
}
.typing.on {
  opacity: 1;
}
.dots {
  display: inline-flex;
  gap: 3px;
}
.dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: hop 1s ease-in-out infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes hop {
  30% {
    transform: translateY(-4px);
  }
}
.composer {
  display: flex;
  align-items: center;
  margin: 0 12px 12px;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--line);
}
.send {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-left: auto;
  border-radius: 50%;
  background: var(--soft);
}

.msg-enter-active {
  transition:
    opacity 0.45s,
    transform 0.55s cubic-bezier(0.2, 1.2, 0.4, 1);
}
.msg-enter-from {
  opacity: 0;
  transform: translateY(18px) scale(0.97);
}
.msg-move {
  transition: transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.msg-leave-active {
  display: none;
}

/* Side panels in the page's own ink-on-paper voice. */
.side {
  display: grid;
  gap: 20px;
}
.panel {
  padding: 18px 20px;
  border-radius: 16px;
  background: var(--card);
  box-shadow:
    inset 0 0 0 1.5px var(--ink),
    5px 6px 0 var(--ink);
}
.panel h4 {
  margin: 0 0 14px;
  font-family: var(--serif);
  font-size: 17px;
  color: var(--ink);
}
.chain {
  --b: 0;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  text-align: center;
}
.chain::before {
  content: '';
  position: absolute;
  left: 16.6%;
  right: 16.6%;
  top: 40px;
  border-top: 2px dashed var(--rule);
}
.link {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  font-size: 12.5px;
  color: var(--ink);
}
.link img {
  width: 80px;
  height: 80px;
  transition: transform 0.4s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.link.running img,
.link.waiting img {
  transform: scale(1.15);
}
.link small {
  font-size: 11px;
  color: var(--ink-3);
}
.link.running small {
  color: var(--blue-ink);
}
.link.waiting small {
  color: #c77700;
}
.link.done small {
  color: #1f8a3a;
}
.baton {
  position: absolute;
  top: -6px;
  left: calc(16.6% + var(--b) * 33.3%);
  width: 14px;
  height: 14px;
  margin-left: -7px;
  background: var(--jade);
  transform: rotate(45deg);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--jade) 25%, transparent);
  animation: float 1.6s ease-in-out infinite;
}
@keyframes float {
  50% {
    translate: 0 -4px;
  }
}
.roster {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.roster li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  color: var(--ink);
}
.roster__name small {
  display: block;
  font: 11px var(--mono);
  color: var(--ink-3);
}
.roster li > small {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-3);
}
.roster .online {
  color: #1f8a3a;
}
.state.running {
  color: var(--blue-ink);
}
.state.waiting {
  color: #c77700;
}
.state.done {
  color: #1f8a3a;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .side {
    order: -1;
  }
  .side .panel:last-child {
    display: none;
  }
  .app {
    height: 560px;
  }
  .app__chips {
    display: none;
  }
  .body {
    max-width: calc(100% - 44px);
  }
}
</style>
