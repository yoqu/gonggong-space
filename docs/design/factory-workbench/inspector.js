// Right drawer = the system's run tab (apps/web RunTab + ProcessView): toolbar, facts, issue, tabs, plan, 过程, dock.
// Markup and class names follow the web components so the CSS in styles.css can mirror process.css / runs.css.

const ICON = {
  terminal: 'M3.5 4.8L7.7 9l-4.2 4.2 M9.5 13.5h5',
  'doc-text':
    'M5 2.5h5.2L14 6.3v8.1c0 .6-.5 1.1-1.1 1.1H5c-.6 0-1.1-.5-1.1-1.1V3.6c0-.6.5-1.1 1.1-1.1z M10 2.7v3.8h3.8 M6.5 9.5h5 M6.5 12.3h5',
  search: 'M8 13.2a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z M11.8 11.8l3.7 3.7',
  folder:
    'M2.5 5.2c0-.9.7-1.7 1.7-1.7h3l1.6 1.6h5c.9 0 1.7.8 1.7 1.7v6.1c0 .9-.8 1.6-1.7 1.6H4.2c-1 0-1.7-.7-1.7-1.6z M2.5 7.3h13',
  textformat:
    'M2.8 14.5L6.4 4.5h.8l3.6 10 M4.1 11h5.4 M12.2 9.3c.4-.6 1-.9 1.7-.9 1 0 1.6.6 1.6 1.6v4.5 M15.5 11.8h-1.8c-1 0-1.6.5-1.6 1.3s.6 1.4 1.4 1.4c.9 0 2-.6 2-1.8',
  globe:
    'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M2.5 9h13 M9 2.5c1.8 1.8 2.6 4 2.6 6.5s-.8 4.7-2.6 6.5 M9 2.5C7.2 4.3 6.4 6.5 6.4 9s.8 4.7 2.6 6.5',
  gear: 'M9 11.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z M9 2.3v1.9 M9 13.8v1.9 M2.3 9h1.9 M13.8 9h1.9 M4.3 4.3l1.3 1.3 M12.4 12.4l1.3 1.3 M4.3 13.7l1.3-1.3 M12.4 5.6l1.3-1.3',
  bot: 'M4.8 6.5h8.4c.9 0 1.6.7 1.6 1.6v5.3c0 .9-.7 1.6-1.6 1.6H4.8c-.9 0-1.6-.7-1.6-1.6V8.1c0-.9.7-1.6 1.6-1.6z M9 6.5V4.4 M9 4.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z M6.8 10v1.3 M11.2 10v1.3 M1.8 9.8v2.4 M16.2 9.8v2.4',
  clock: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 5.3V9l2.6 1.6',
  'chevron-right': 'M7 3.5L12.5 9 7 14.5',
  'chevron-up': 'M4.5 11L9 6.5 13.5 11',
  copy: 'M6.5 6.5h7.5c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1H6.5c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1z M3.5 11.5v-8c0-.6.4-1 1-1h7',
  info: 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 8.3v4.2 M9 5.7h.01',
  cpu: 'M6 4.5h6c.8 0 1.5.7 1.5 1.5v6c0 .8-.7 1.5-1.5 1.5H6c-.8 0-1.5-.7-1.5-1.5V6c0-.8.7-1.5 1.5-1.5z M7.3 7.3h3.4v3.4H7.3z M7 2.3v2.2 M11 2.3v2.2 M7 13.5v2.2 M11 13.5v2.2 M2.3 7h2.2 M2.3 11h2.2 M13.5 7h2.2 M13.5 11h2.2',
  calendar:
    'M3.5 4.5h11c.6 0 1 .4 1 1v9c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1v-9c0-.6.4-1 1-1z M2.5 8h13 M6 2.8v3.2 M12 2.8v3.2',
  'chart-bar': 'M3 3v12h12 M6.5 12V9 M9.5 12V5.5 M12.5 12V7.5',
  'shield-warning': 'M9 2.5l5.5 2.1v4.1c0 3.4-2.3 5.8-5.5 6.8-3.2-1-5.5-3.4-5.5-6.8V4.6z M9 6v3.8 M9 11.9h.01',
  'bubble-question':
    'M9 2.7c3.6 0 6.5 2.6 6.5 5.9s-2.9 5.9-6.5 5.9c-.9 0-1.7-.1-2.5-.4L3 15.3l.9-3.1c-.9-1-1.4-2.2-1.4-3.6 0-3.3 2.9-5.9 6.5-5.9z M7.3 7.2c.2-.9.9-1.4 1.8-1.4 1 0 1.8.7 1.8 1.6 0 1.4-1.9 1.4-1.9 2.8 M9 12h.01',
  'exclamation-circle': 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M9 5.5v4.2 M9 12.4h.01',
  checklist: 'M3 4.8l1.2 1.2 2.2-2.4 M3 10.3l1.2 1.2 2.2-2.4 M9 5h6 M9 10.5h6 M9 14h6',
  'checkmark-circle': 'M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M6.1 9.2l2 2 3.9-4.2',
  'arrow-clockwise': 'M15 9a6 6 0 1 1-1.8-4.3 M13.5 2.4v2.5H11',
  bolt: 'M10.2 2.5L4.5 10h4.3l-1 5.5L13.5 8H9.2z',
  person: 'M9 8.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3.5 15.5c.5-3 2.7-4.5 5.5-4.5s5 1.5 5.5 4.5',
  check: 'M3.8 9.4l3.3 3.3 7.1-7.4',
  xmark: 'M4.5 4.5l9 9 M13.5 4.5l-9 9',
  more: 'M4.2 9h.2 M8.9 9h.2 M13.6 9h.2',
  tray: 'M2.5 10.2l2-6.2c.2-.5.6-.8 1.1-.8h6.8c.5 0 .9.3 1.1.8l2 6.2v3.6c0 .9-.7 1.7-1.7 1.7H4.2c-.9 0-1.7-.8-1.7-1.7z M2.6 10.2h3.8l.9 1.9h3.4l.9-1.9h3.8',
}

const icon = (name, size = 14, cls = '') =>
  `<svg viewBox="0 0 18 18" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}><path d="${ICON[name]}"/></svg>`

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// RUN_STATUS (apps/web chat/TimelineItems + RunGraphics): label and Tag tone.
const RUN_STATUS = {
  running: ['运行中', 'blue'],
  awaiting_approval: ['等待审批', 'orange'],
  awaiting_answer: ['等待回答', 'orange'],
  completed: ['已完成', 'green'],
  interrupted: ['已中断', 'red'],
  forbidden: ['无权触发', 'red'],
}
const runStatusOf = (s) =>
  s === 'approval'
    ? 'awaiting_approval'
    : s === 'question' || s === 'workspace_confirm'
      ? 'awaiting_answer'
      : s === 'done'
        ? 'completed'
        : s === 'forbidden'
          ? 'forbidden'
          : ['auth_expired', 'rate_limit', 'force_conflict', 'error'].includes(s)
            ? 'interrupted'
            : 'running'

const REASON = {
  high_risk: '高危命令，必须由主人确认',
  protected_base: '可能修改受保护的基准分支',
  network: '需要访问网络',
  write: '需要写入或修改文件',
  unparsed: '命令较复杂，无法确认是否只读',
  not_allowed: '未被只读规则或已保存的允许规则覆盖',
}

const AGENT_NAME = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI', deepseek: 'DeepSeek', qwen: 'Qwen Code' }

// Per-drawer view state kept across renderUI calls (which rebuild the markup).
const ui = { open: {}, tab: 'process', more: false, filter: 'all', pick: {}, lastId: null }

const pad = (n) => String(n).padStart(2, '0')
const hms = (ms) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const fmtDuration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const mmss = `${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
  return h ? `${h}:${mmss}` : mmss
}
const fmtWorked = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
  return [h && `${h} 小时`, m && `${m} 分`, (sec || (!h && !m)) && `${sec} 秒`].filter(Boolean).slice(0, 2).join(' ')
}
const fmtTokens = (n) => (n >= 999_950 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

function hash(str) {
  let h = 2166136261
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** A stable start time per run so facts and step times read the same on every render. */
function startedAt(sel) {
  if (!sel._startedAt) {
    const sec = sel.durationSec > 0 ? sel.durationSec : 240 + (hash(sel.id) % 1500)
    sel._startedAt = Date.now() - sec * 1000
  }
  return sel._startedAt
}

const FILES = [
  'apps/web/src/features/runs/ProcessView.tsx',
  'apps/server/src/modules/runs/service.ts',
  'packages/protocol/src/run.ts',
  'crates/gonggong/src/sync.rs',
  'apps/web/src/ui/Dialog.tsx',
  'apps/server/src/db/schema.ts',
  'apps/web/src/features/chat/RunPlan.tsx',
]
const SEARCHES = ['runStatus', 'contextUsage', 'approval.reason', 'syncMode']
const COMMANDS = ['pnpm --filter @gonggong/web test', 'pnpm typecheck', 'git status --short', 'cargo test -p gonggong sync']

/** The step under way, from the card's `tool · target` text. */
function currentStep(sel) {
  const [tool, ...rest] = String(sel.step || '').split(' · ')
  const target = rest.join(' · ') || sel.taskTitle
  const k = tool.toLowerCase()
  const family = /edit|write|patch/.test(k)
    ? 'edit'
    : /read|query|grep|search/.test(k)
      ? /search|grep/.test(k)
        ? 'search'
        : 'file'
      : /think/.test(k)
        ? 'thought'
        : 'execute'
  return { family, target }
}

/** A believable 过程 for one instance: trigger, reading, a reply, edits, commands, subagents, then what it is on now. */
function buildSteps(sel, end) {
  const h = hash(sel.id)
  const t0 = startedAt(sel)
  const now = end
  const span = Math.max(60_000, now - t0)
  let i = 0
  const at = (f) => t0 + Math.round(span * f)
  const file = (n) => FILES[(h + n) % FILES.length]
  const steps = []
  const push = (s) => steps.push({ key: `s${i++}`, ...s })

  push({ family: 'prompt', label: `${sel.originUser} 的消息`, body: `${sel.taskTitle}`, at: at(0) })
  push({ family: 'thought', body: `先确认 ${sel.repo || '仓库'} 里相关模块的现状，再按计划逐项推进。`, at: at(0.02) })
  push({
    group: true,
    at: at(0.05),
    actions: [
      { family: 'file', verb: '已读取', target: file(0), at: at(0.05) },
      { family: 'file', verb: '已读取', target: file(1), at: at(0.07) },
      { family: 'search', verb: '已搜索', target: SEARCHES[h % SEARCHES.length], at: at(0.09), meta: `${3 + (h % 9)} 处` },
      { family: 'list', verb: '已列出', target: (file(2).split('/').slice(0, 3).join('/')), at: at(0.1) },
    ],
  })
  push({
    family: 'text',
    body: `已梳理现状：${sel.taskTitle}涉及 ${2 + (h % 3)} 个文件，先改数据层，再补界面与测试。`,
    at: at(0.14),
  })
  const add = 6 + (h % 40)
  const del = h % 12
  push({
    group: true,
    at: at(0.2),
    actions: [
      { family: 'edit', verb: '已编辑', target: file(3), at: at(0.2), diff: [add, del] },
      { family: 'edit', verb: '已编辑', target: file(4), at: at(0.3), diff: [3 + (h % 9), 1 + (h % 4)] },
      {
        family: 'execute',
        verb: '已运行',
        target: COMMANDS[h % COMMANDS.length],
        at: at(0.38),
        meta: '0.8 秒',
        out: '✓ 41 passed (3.2s)\nTest Files  6 passed (6)',
      },
    ],
  })
  for (const sa of sel.subagents || []) {
    const st = sa.status === 'completed' ? 'done' : sa.status === 'failed' ? 'failed' : 'running'
    push({
      family: 'subagent',
      verb: st === 'running' ? '子 Agent 运行中' : '派出子 Agent',
      name: sa.name,
      target: sa.task.replace(/^(Subagent|Task) · /, ''),
      state: st,
      calls: 2 + (hash(sa.name) % 7),
      at: at(0.45),
    })
  }
  const status = sel.status
  if (status === 'approval') {
    push({ family: 'approval', label: '权限请求 · 执行命令', mono: sel.approvalCmd || sel.step, body: '等待 Bot 主人审批', running: true, at: at(0.96) })
  } else if (status === 'question' || status === 'workspace_confirm') {
    push({ family: 'question', label: status === 'question' ? '向群成员提问 · 1 个问题' : '需要确认', mono: '', body: '等待回答', running: true, at: at(0.96) })
  } else if (['auth_expired', 'rate_limit', 'error', 'force_conflict', 'forbidden'].includes(status)) {
    const cur = currentStep(sel)
    push({ family: cur.family === 'thought' ? 'execute' : cur.family, verb: '运行失败', target: cur.target, failed: true, at: at(0.97), out: sel.authDetail || sel.rateLimitDetail || sel.step })
  } else if (status === 'done') {
    push({ family: 'text', body: `已完成：${sel.taskTitle}。改动 ${sel.filesChanged || 2} 个文件，测试全部通过。`, at: at(1) })
  } else if (status === 'thinking' || status === 'subagent_swarm') {
    // Between calls: the list ends with 正在处理.
  } else {
    const cur = currentStep(sel)
    const verb = { edit: '正在编辑', file: '正在读取', search: '正在搜索', execute: '正在运行', thought: '正在思考' }[cur.family]
    push({ family: cur.family, verb, target: cur.target, running: true, at: at(0.98) })
  }
  return steps
}

const ROW_ICON = { file: 'doc-text', search: 'search', list: 'folder', execute: 'terminal', edit: 'textformat', thought: 'more', fetch: 'globe' }
const GROUP_TITLE = { file: '读取了文件', search: '搜索了代码', list: '查看了目录', execute: '运行了命令', edit: '编辑了文件' }
const GROUP_ICON = { 读取了文件: 'doc-text', 搜索了代码: 'search', 查看了目录: 'folder', 运行了命令: 'terminal', 编辑了文件: 'textformat' }
const FILE_FAMILY = new Set(['file', 'edit'])

const when = (ms, to) =>
  `<time class="act-row__time" title="${to ? `${hms(ms)} – ${hms(to)}` : hms(ms)}">${to && to !== ms ? `${hms(ms)}–${hms(to)}` : hms(ms)}</time>`

function actionRow(sel, a, key) {
  const state = a.failed ? 'failed' : a.running ? 'running' : 'done'
  const target = a.target ? (FILE_FAMILY.has(a.family) ? a.target.split('/').at(-1) : a.target) : ''
  const targetCls = FILE_FAMILY.has(a.family) ? 'act-row__target act-row__target--file' : 'act-row__target act-row__target--mono'
  const expandable = !!a.out
  const open = ui.open[`${sel.id}:${key}`] ?? (a.failed && expandable)
  const head = `
    ${icon(ROW_ICON[a.family] || 'gear', 14, 'act-row__icon')}
    <span class="act-row__verb${state === 'running' ? ' ui-shimmer' : ''}">${esc(a.verb)}</span>
    ${target ? `<span class="${targetCls}" title="${esc(a.target)}">${esc(target)}</span>` : ''}
    ${a.diff ? `<span class="act-row__meta act-row__meta--diff"><span class="act-add">+${a.diff[0]}</span> <span class="act-del">−${a.diff[1]}</span></span>` : ''}
    ${a.meta && !a.diff && state === 'done' ? `<span class="act-row__meta">${esc(a.meta)}</span>` : ''}
    ${expandable ? icon('chevron-right', 12, 'act-row__chevron') : ''}
    ${when(a.at)}`
  const row = expandable
    ? `<button type="button" class="act-row act-row--head" aria-expanded="${open}" data-fold="${key}">${head}</button>`
    : `<div class="act-row">${head}</div>`
  const detail = open && a.out ? `<div class="act-detail act-detail--mono"><pre>${esc(a.out)}</pre></div>` : ''
  return `<li class="act-item" data-state="${state}" data-family="${a.family}">${row}${detail}</li>`
}

function itemRow(sel, s) {
  if (s.group) {
    const titles = [...new Set(s.actions.map((a) => GROUP_TITLE[a.family]))]
    const title = titles.join('、')
    const failed = s.actions.filter((a) => a.failed).length
    const running = s.actions.some((a) => a.running)
    const open = ui.open[`${sel.id}:${s.key}`] ?? (running || failed > 0)
    const last = s.actions.at(-1).at
    return `<li class="act-item act-item--group"${running ? ' data-state="running"' : ''}>
      <button type="button" class="act-row act-row--head" aria-expanded="${open}" data-fold="${s.key}">
        ${icon(GROUP_ICON[titles[0]] || 'gear', 14, 'act-row__icon')}
        <span class="act-row__verb">${title}</span>
        ${failed ? `<span class="act-row__fail">${failed} 个失败</span>` : ''}
        ${icon('chevron-right', 12, 'act-row__chevron')}
        ${when(s.actions[0].at, last)}
      </button>
      ${open ? `<ol class="act act--flat">${s.actions.map((a, j) => actionRow(sel, a, `${s.key}.${j}`)).join('')}</ol>` : ''}
    </li>`
  }
  if (s.family === 'prompt')
    return `<li class="act-item act-prompt">
      <div class="act-row">${icon('person', 14, 'act-row__icon')}<span class="act-row__verb">${esc(s.label)}</span>${when(s.at)}</div>
      <div class="act-prompt__body">${esc(s.body)}</div>
    </li>`
  if (s.family === 'text')
    return `<li class="act-item act-text">${when(s.at)}<p>${esc(s.body)}</p></li>`
  if (s.family === 'thought') {
    const open = !!ui.open[`${sel.id}:${s.key}`]
    return `<li class="act-item" data-state="done" data-family="thought">
      <button type="button" class="act-row act-row--head" aria-expanded="${open}" data-fold="${s.key}">
        ${icon('more', 14, 'act-row__icon')}<span class="act-row__verb">思考</span>
        <span class="act-row__target">${esc(s.body)}</span>
        ${icon('chevron-right', 12, 'act-row__chevron')}${when(s.at)}
      </button>
      ${open ? `<div class="act-detail act-detail--text">${esc(s.body)}</div>` : ''}
    </li>`
  }
  if (s.family === 'approval' || s.family === 'question')
    return `<li class="act-item act-approval" data-state="running">
      <div class="act-row">
        ${icon(s.family === 'question' ? 'bubble-question' : 'shield-warning', 14, 'act-row__icon')}
        <span class="act-row__verb">${esc(s.label)}</span>
        <span class="act-row__target act-row__target--mono">${esc(s.mono)}</span>
        ${when(s.at)}
      </div>
      <div class="act-approval__state">${esc(s.body)}</div>
    </li>`
  if (s.family === 'subagent') {
    const open = ui.open[`${sel.id}:${s.key}`] ?? (s.state === 'running' || s.state === 'failed')
    const lane = sel.tint || '#8e8e93'
    return `<li class="act-item act-lane" data-state="${s.state}" data-family="subagent" style="--lane:${lane}">
      <button type="button" class="act-row act-row--head" aria-expanded="${open}" data-fold="${s.key}">
        <span class="act-face" data-state="${s.state}" style="width:18px;height:18px">
          <span class="act-face__img" style="background:${lane}">${esc(s.name.slice(0, 1).toUpperCase())}</span>
          ${s.state === 'running' ? '' : `<span class="act-face__badge">${icon(s.state === 'failed' ? 'xmark' : 'check', 8)}</span>`}
        </span>
        <span class="act-row__verb${s.state === 'running' ? ' ui-shimmer' : ''}">${esc(s.name)}</span>
        <span class="act-row__target" title="${esc(s.target)}">${esc(s.target)}</span>
        <span class="act-row__state">${s.calls} 次调用 · ${s.state === 'running' ? '运行中' : s.state === 'failed' ? '失败' : '完成'}</span>
        ${icon('chevron-right', 12, 'act-row__chevron')}
        ${when(s.at)}
      </button>
      ${
        open
          ? `<ol class="act act--nested">
              <li class="act-item" data-state="done"><div class="act-row">${icon('doc-text', 14, 'act-row__icon')}<span class="act-row__verb">已读取</span><span class="act-row__target act-row__target--file">${esc(FILES[hash(s.name) % FILES.length].split('/').at(-1))}</span>${when(s.at + 4000)}</div></li>
              <li class="act-item" data-state="${s.state === 'running' ? 'running' : 'done'}"><div class="act-row">${icon('terminal', 14, 'act-row__icon')}<span class="act-row__verb${s.state === 'running' ? ' ui-shimmer' : ''}">${s.state === 'running' ? '正在运行' : '已运行'}</span><span class="act-row__target act-row__target--mono">${esc(COMMANDS[hash(s.name) % COMMANDS.length])}</span>${when(s.at + 9000)}</div></li>
            </ol>`
          : ''
      }
    </li>`
  }
  return actionRow(sel, s, s.key)
}

function processList(sel, live, end) {
  const steps = buildSteps(sel, end)
  const idle = live && !steps.some((s) => s.running || s.actions?.some((a) => a.running))
  const flat = steps.flatMap((s) => (s.group ? s.actions : [s]))
  const count = {
    failed: flat.filter((s) => s.failed).length,
    ask: flat.filter((s) => s.family === 'approval' || s.family === 'question').length,
    command: flat.filter((s) => s.family === 'execute').length,
  }
  const filters = [
    ['all', '全部'],
    ['failed', '失败'],
    ['ask', '需处理'],
    ['command', '命令'],
  ]
  const match = {
    failed: (s) => s.failed,
    ask: (s) => s.family === 'approval' || s.family === 'question',
    command: (s) => s.family === 'execute',
  }
  const shown =
    ui.filter === 'all'
      ? steps.map((s) => itemRow(sel, s))
      : flat.filter(match[ui.filter]).map((s, j) => (s.group ? '' : actionRow(sel, s, `f${j}`)))
  return `
    <fieldset class="act-filters" aria-label="筛选过程">
      ${filters
        .map(
          ([v, label]) =>
            `<button type="button" class="act-filter" data-filter="${v}" aria-pressed="${ui.filter === v}">${label}${count[v] ? `<span class="act-filter__n">${count[v]}</span>` : ''}</button>`,
        )
        .join('')}
    </fieldset>
    <ol class="act act-root"${live ? ' data-live' : ''} aria-label="运行过程">
      ${shown.join('')}
      ${ui.filter !== 'all' && !shown.length ? '<li class="act-empty">没有符合条件的步骤</li>' : ''}
      ${
        idle && ui.filter === 'all'
          ? `<li class="act-item act-working" aria-live="polite">
              <span class="act-working__dot" aria-hidden="true"></span>
              <span class="ui-shimmer">正在处理</span>
              <span class="act-row__meta" data-elapsed="${startedAt(sel)}" data-format="worked">${fmtWorked(Date.now() - startedAt(sel))}</span>
            </li>`
          : ''
      }
    </ol>`
}

function runPlan(sel, live) {
  const done = sel.todos.filter((x) => x.st === 2).length
  return `<div class="run-plan run-plan--panel">
    <div class="run-plan__head">
      ${icon('checklist', 12)}
      <span class="run-plan__title">计划</span>
      <span class="run-plan__count">${done}/${sel.todos.length}</span>
      <button type="button" class="run-plan__step" id="btn-insp-step" title="原型演示：推进一项">推进</button>
    </div>
    <ol class="run-plan__list">
      ${sel.todos
        .map((td) => {
          const status = td.st === 2 ? 'completed' : td.st === 1 ? 'in_progress' : 'pending'
          const mark =
            status === 'completed'
              ? icon('checkmark-circle', 13)
              : status === 'in_progress'
                ? icon('arrow-clockwise', 13, live ? 'run-plan__spin' : '')
                : '<span class="run-plan__dot" aria-hidden="true"></span>'
          return `<li class="run-plan__item" data-status="${status}">${mark}<span class="run-plan__text">${esc(td.text)}</span></li>`
        })
        .join('')}
    </ol>
  </div>`
}

/** IssueBanner: why the run stopped, its reason in full, then what to do. */
function issueOf(sel) {
  const agent = AGENT_NAME[sel.agentKind] || 'Agent'
  switch (sel.status) {
    case 'auth_expired':
      return {
        title: `${agent} 尚未登录`,
        detail: sel.authDetail || 'Authentication required ({"category":"auth"})',
        mono: true,
        hint: '请先登录官方账号或在供应商中配置 API Key，完成后重新运行。',
        retryId: 'btn-reauth',
      }
    case 'rate_limit':
    case 'error':
      return {
        title: '运行失败：Agent 异常',
        detail: sel.rateLimitDetail || sel.step || '未知错误',
        mono: true,
        hint: '看完错误信息后重新 @ Bot 再试；反复出现时检查 Bot 所在电脑上 Agent 的登录、额度与网络。',
        retryId: 'btn-reauth',
      }
    case 'force_conflict':
      return {
        title: '运行已中断',
        detail: `强制同步时三方合并冲突：\n${(sel.conflictFiles || ['crates/gonggong/src/sync.rs']).join('\n')}`,
        hint: '重新 @ Bot 再试一次；已改的文件见「改动」。',
        retryId: 'btn-resolve-conflict',
      }
    case 'forbidden':
      return { title: '没有运行权限', detail: sel.step || '触发人不在此 Bot 的可触发范围内', retryId: 'btn-reauth' }
    default:
      return null
  }
}

function issueBanner(sel) {
  const issue = issueOf(sel)
  if (!issue) return ''
  return `<div class="run-issue" data-tone="error" role="alert">
    <div class="run-issue__head">
      ${icon('exclamation-circle', 14)}
      <span class="run-issue__title">${esc(issue.title)}</span>
      <button type="button" class="run-tab__copy" title="复制错误信息" aria-label="复制错误信息" data-copy="${esc(issue.detail)}">${icon('copy', 12)}</button>
      <button type="button" class="ui-btn ui-btn--small" id="${issue.retryId}">${icon('arrow-clockwise', 14)}重新运行</button>
    </div>
    ${issue.mono ? `<pre class="run-issue__detail run-issue__detail--mono">${esc(issue.detail)}</pre>` : `<div class="run-issue__detail">${esc(issue.detail)}</div>`}
    ${issue.hint ? `<div class="run-issue__hint">${esc(issue.hint)}</div>` : ''}
  </div>`
}

function approvalCard(sel, owner) {
  const left = Math.max(0, 300_000 - ((Date.now() - startedAt(sel)) % 300_000))
  const reason = REASON[sel.approvalReason] || REASON.not_allowed
  return `<div class="approval" data-pending-id="${sel.id}">
    <div class="approval__title">
      ${icon('shield-warning', 14)}
      <span class="approval__title-text">权限请求 · 执行命令</span>
    </div>
    <div class="approval__cmd"><span class="approval__cmd-text">${esc(sel.approvalCmd || sel.step)}</span></div>
    <div class="approval__why">${reason} · <span data-countdown="${Date.now() + left}">${fmtDuration(left)}</span> 后自动拒绝，Bot 会换个方式继续</div>
    <div class="approval__actions">
      <button type="button" class="ui-btn ui-btn--primary ui-btn--small" id="btn-approve">批准</button>
      <button type="button" class="ui-btn ui-btn--small" id="btn-reject">拒绝</button>
      <span class="approval__hint">仅 Bot 主人 ${esc(owner.name)} 可操作</span>
    </div>
  </div>`
}

function questionCard(sel, owner) {
  const confirm = sel.status === 'workspace_confirm'
  const opts = confirm
    ? ['确认，在此工作区运行', '换一个工作区']
    : sel.questionOptions || ['按推荐方案执行', '保持现有实现']
  const picked = ui.pick[sel.id]
  const q = confirm ? `在本机工作区 ${sel.workspacePath || '~/workspace/gonggong'} 上运行？` : sel.questionText || '请确认该模块的实现方案：'
  return `<div class="question" data-pending-id="${sel.id}">
    <div class="question__head">
      <div class="question__title">${icon('bubble-question', 14)}<span>${confirm ? '需要确认' : '向群成员提问 · 1 个问题'}</span></div>
      <div class="question__meta">
        <span>${sel.originUser === owner.name ? `${esc(owner.name)}（触发人兼 Bot 主人）可回答` : `触发人 ${esc(sel.originUser)} 或 Bot 主人 ${esc(owner.name)} 可回答`}</span>
        <span class="question__timeout">10:00 后超时，按推荐项继续</span>
      </div>
    </div>
    <div class="question__item">
      <div class="question__q"><span class="question__type">单选</span><span>${esc(q)}</span></div>
      <div class="question__opts">
        ${opts
          .map(
            (o, i) => `<button type="button" class="question__opt${picked === i ? ' question__opt--on' : ''}" data-answer-opt="${i}">
              <span class="question__mark" aria-hidden="true">${picked === i ? icon('check', 10) : ''}</span>
              <span class="question__label">${esc(o)}</span>
              ${i === 0 ? '<span class="question__rec">推荐</span>' : ''}
            </button>`,
          )
          .join('')}
      </div>
    </div>
    <div class="question__actions">
      <button type="button" class="ui-btn ui-btn--primary ui-btn--small question__submit" id="${confirm ? 'btn-confirm-ws' : 'btn-answer'}"${picked === undefined ? ' disabled' : ''}>${confirm ? '确认' : '提交回答'}</button>
    </div>
  </div>`
}

function activityDock(sel) {
  const subs = sel.subagents || []
  if (!subs.length) return ''
  const running = subs.filter((s) => s.status === 'running' || !['completed', 'failed'].includes(s.status))
  if (!running.length) {
    const failed = subs.filter((s) => s.status === 'failed').length
    return `<div class="act-dock"><div class="act-dock__summary" role="status">${icon('checkmark-circle', 14)}${failed ? `已全部结束：${subs.length - failed} 个完成，${failed} 个失败` : `已全部结束：${subs.length} 个完成`}</div></div>`
  }
  return `<div class="act-dock">
    <div class="act-dock__bar">
      <span class="act-dock__count">${icon('bot', 14)}子 Agent ${running.length} 个运行中</span>
      <div class="act-dock__chips">
        ${running
          .slice(0, 3)
          .map(
            (s) => `<span class="act-chip" data-state="running">
              <span class="act-face" data-state="running" style="width:16px;height:16px;--lane:${sel.tint || '#8e8e93'}"><span class="act-face__img" style="background:${sel.tint || '#8e8e93'}">${esc(s.name.slice(0, 1).toUpperCase())}</span></span>
              <span class="act-chip__name">${esc(s.name)}</span>
              <span class="act-chip__when" data-elapsed="${startedAt(sel)}" data-format="duration">${fmtDuration(Date.now() - startedAt(sel))}</span>
            </span>`,
          )
          .join('')}
      </div>
    </div>
  </div>`
}

function otherViews(sel) {
  if (ui.tab === 'context') {
    const pct = sel.ctx
    return `<div class="run-ctx">
      <div class="run-ctx__head"><span>上下文窗口</span><span class="run-tab__mono">${pct}% · ${fmtTokens(sel.ctxUsed)} / ${fmtTokens(sel.ctxSize)}</span></div>
      <div class="run-ctx__meter"><div style="width:${pct}%" data-high="${pct > 75 || undefined}"></div></div>
      <div class="run-tab__empty">接近上限时 Agent 会自动压缩上下文，压缩记录会出现在过程里。</div>
    </div>`
  }
  if (ui.tab === 'diff') {
    const n = Math.max(1, sel.filesChanged || 2)
    const h = hash(sel.id)
    return `<ol class="run-diff">${Array.from({ length: Math.min(n, 6) }, (_, j) => {
      const f = FILES[(h + j) % FILES.length]
      return `<li class="run-diff__file">${icon('doc-text', 14)}<span class="run-diff__name" title="${f}">${f.split('/').at(-1)}</span><span class="run-diff__dir">${f.split('/').slice(0, -1).join('/')}</span><span class="act-row__meta"><span class="act-add">+${4 + ((h >> j) % 30)}</span> <span class="act-del">−${(h >> (j + 3)) % 9}</span></span></li>`
    }).join('')}</ol>`
  }
  return sel.status === 'approval'
    ? `<div class="run-audit"><span class="run-audit__time">${hms(Date.now() - 20_000)}</span><span class="run-audit__text">发起权限请求：${esc(sel.approvalCmd || sel.step)}</span></div>`
    : '<div class="run-tab__empty">这次运行没有审批记录</div>'
}

const VIEWS = [
  ['process', '过程'],
  ['diff', '改动'],
  ['context', '上下文'],
  ['audit', '审批记录'],
]

/** Renders the drawer for `sel`; `ctx` carries the app's owners, siblings and callbacks. */
export function renderInspector(root, sel, ctx) {
  if (ui.lastId !== sel.id) {
    ui.lastId = sel.id
    ui.tab = 'process'
    ui.filter = 'all'
  }
  const owner = ctx.owner
  const runStatus = runStatusOf(sel.status)
  const [label, tone] = RUN_STATUS[runStatus]
  const live = ['running', 'awaiting_approval', 'awaiting_answer'].includes(runStatus)
  const t0 = startedAt(sel)
  if (live) delete sel._endedAt
  const end = live ? Date.now() : (sel._endedAt ??= Date.now())
  const usage = Math.round(sel.ctxUsed * 1.6 + (hash(sel.id) % 9000))
  const body = root.querySelector('.run-tab__body')
  const scroll = body ? body.scrollTop : 0
  const pending = sel.status === 'approval' ? approvalCard(sel, owner) : sel.status === 'question' || sel.status === 'workspace_confirm' ? questionCard(sel, owner) : ''

  root.innerHTML = `
    <div class="ui-toolbar run-tab__bar">
      <span class="bot-avatar" style="background:${sel.tint || '#8e8e93'}" aria-hidden="true">${esc(sel.botName.slice(0, 1))}</span>
      <div class="ui-toolbar__titles">
        <h2 class="ui-toolbar__title">${esc(sel.botName)}</h2>
        <span class="ui-toolbar__subtitle">${esc(sel.originUser)} 触发</span>
      </div>
      <span class="ui-tag ui-tag--${tone}">${label}</span>
      <button type="button" class="ui-icon-btn" title="复制过程" aria-label="复制过程" data-copy="${esc(`${sel.botName} · ${sel.groupName} › ${sel.taskTitle}\n${sel.step}`)}">${icon('copy', 16)}</button>
      <button type="button" class="ui-icon-btn" title="电脑与会话" aria-label="电脑与会话" aria-pressed="${ui.more}" data-more>${icon('info', 16)}</button>
      <button type="button" class="ui-icon-btn" title="关闭" aria-label="关闭" id="insp-close">${icon('xmark', 16)}</button>
    </div>
    <div class="run-tab__head">
      <div class="run-tab__facts">
        <span class="run-tab__fact" title="模型">${icon('cpu', 14)}<span class="run-tab__val">${esc(sel.model || AGENT_NAME[sel.agentKind] || '默认')}</span></span>
        <span class="run-tab__fact" title="耗时">${icon('clock', 14)}<span class="run-tab__val"${live ? ` data-elapsed="${t0}" data-format="duration"` : ''}>${fmtDuration(end - t0)}</span></span>
        <span class="run-tab__fact" title="开始 – 结束">${icon('calendar', 14)}<span class="run-tab__val run-tab__mono">${hms(t0)} – ${live ? '进行中' : hms(end)}</span></span>
        <span class="run-tab__fact" title="用量">${icon('chart-bar', 14)}<span class="run-tab__val">${fmtTokens(usage)} tokens</span></span>
      </div>
      ${
        ui.more
          ? `<div class="ui-group">
              <div class="ui-group__row"><span>电脑</span><span class="run-tab__val run-tab__mono">${esc(owner.machine || '—')}</span></div>
              <div class="ui-group__row"><span>会话</span><span class="run-tab__val run-tab__mono">${esc(sel.runId || sel.id)}</span></div>
              <div class="ui-group__row"><span>群聊</span><span class="run-tab__val">${esc(sel.groupName)} › ${esc(sel.taskTitle)}</span></div>
              <div class="ui-group__row"><span>仓库</span><span class="run-tab__val run-tab__mono">${esc(sel.repo || '—')}</span></div>
              <div class="ui-group__row"><span>Agent</span><span class="run-tab__val run-tab__mono">${esc(sel.cli)}${sel.cliOutdated ? ' · 待升级' : ''}</span></div>
            </div>`
          : ''
      }
      ${
        ctx.siblings.length > 1
          ? `<div class="ui-group run-siblings" aria-label="同一 Bot 的其他运行">
              ${ctx.siblings
                .map(
                  (sib) => `<button type="button" class="ui-group__row ui-group__row--button" data-sib-id="${sib.id}" aria-current="${sib.id === sel.id}">
                    <span class="run-siblings__name">${esc(sib.groupName)} › ${esc(sib.taskTitle)}</span>
                    <span class="ui-tag ui-tag--${RUN_STATUS[runStatusOf(sib.status)][1]}">${RUN_STATUS[runStatusOf(sib.status)][0]}</span>
                  </button>`,
                )
                .join('')}
            </div>`
          : ''
      }
      ${issueBanner(sel)}
      <div class="ui-seg ui-seg--small" role="tablist">
        ${VIEWS.map(([v, l]) => `<button type="button" role="tab" class="ui-seg__item" data-view="${v}" aria-selected="${ui.tab === v}"${ui.tab === v ? ' data-selected' : ''}>${l}</button>`).join('')}
      </div>
    </div>
    ${ui.tab === 'process' ? runPlan(sel, live) : ''}
    <div class="run-tab__body">
      <div class="run-tab__column">
        ${ui.tab === 'process' ? `${pending ? `<section class="run-pending" aria-label="待处理">${pending}</section>` : ''}${processList(sel, live, end)}` : otherViews(sel)}
      </div>
    </div>
    ${activityDock(sel)}`

  const newBody = root.querySelector('.run-tab__body')
  if (newBody) newBody.scrollTop = scroll
  wire(root, sel, ctx)
}

function wire(root, sel, ctx) {
  const rerender = () => renderInspector(root, sel, ctx)
  const resume = (stepText) => {
    sel.status = 'typing'
    sel.step = stepText
    sel.celebrateUntil = performance.now() / 1000 + 1.4
    const active = sel.todos.find((x) => x.st === 1)
    if (active) {
      active.st = 2
      const next = sel.todos.find((x) => x.st === 0)
      if (next) next.st = 1
    }
    delete ui.pick[sel.id]
    ctx.onChange()
  }
  root.querySelector('#insp-close')?.addEventListener('click', ctx.onClose)
  root.querySelector('[data-more]')?.addEventListener('click', () => {
    ui.more = !ui.more
    rerender()
  })
  root.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => navigator.clipboard?.writeText(b.dataset.copy).catch(() => {})),
  )
  root.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.tab = b.dataset.view
      rerender()
    }),
  )
  root.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.filter = b.dataset.filter
      rerender()
    }),
  )
  root.querySelectorAll('[data-fold]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = `${sel.id}:${b.dataset.fold}`
      ui.open[k] = b.getAttribute('aria-expanded') !== 'true'
      rerender()
    }),
  )
  root.querySelector('#btn-approve')?.addEventListener('click', () => resume('bash · 审批通过，继续执行脚本…'))
  root.querySelector('#btn-reject')?.addEventListener('click', () => {
    sel.status = 'thinking'
    sel.step = 'think · 命令已拒绝，正在换个方式继续'
    ctx.onChange()
  })
  root.querySelectorAll('[data-answer-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.pick[sel.id] = Number(b.dataset.answerOpt)
      rerender()
    }),
  )
  root.querySelector('#btn-answer')?.addEventListener('click', () => {
    const opts = sel.questionOptions || ['按推荐方案执行', '保持现有实现']
    resume(`edit · 已采纳「${opts[ui.pick[sel.id]] ?? opts[0]}」`)
  })
  root.querySelector('#btn-confirm-ws')?.addEventListener('click', () => resume('read · 工作区已确认，开始读取代码'))
  root.querySelector('#btn-reauth')?.addEventListener('click', () => resume('bash · 已重新运行，继续执行…'))
  root.querySelector('#btn-resolve-conflict')?.addEventListener('click', () => resume('bash · 已重新运行，合并后运行测试'))
  root.querySelector('#btn-insp-step')?.addEventListener('click', () => {
    const cur = sel.todos.findIndex((x) => x.st === 1)
    if (cur >= 0) {
      sel.todos[cur].st = 2
      if (sel.todos[cur + 1]) sel.todos[cur + 1].st = 1
      else sel.celebrateUntil = performance.now() / 1000 + 1.6
    } else {
      const pend = sel.todos.find((x) => x.st === 0)
      if (pend) pend.st = 1
    }
    sel.ctx = Math.min(96, sel.ctx + 6)
    ctx.onChange()
  })
  root.querySelectorAll('[data-sib-id]').forEach((b) =>
    b.addEventListener('click', () => ctx.onFocusSibling(b.dataset.sibId)),
  )
}

// Live clocks (耗时, 正在处理, countdowns) tick without rebuilding the drawer.
setInterval(() => {
  const now = Date.now()
  document.querySelectorAll('#inspector [data-elapsed]').forEach((el) => {
    const ms = now - Number(el.dataset.elapsed)
    el.textContent = el.dataset.format === 'worked' ? fmtWorked(ms) : fmtDuration(ms)
  })
  document.querySelectorAll('#inspector [data-countdown]').forEach((el) => {
    el.textContent = fmtDuration(Math.max(0, Number(el.dataset.countdown) - now))
  })
}, 1000)
