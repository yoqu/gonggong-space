import {
  type ActionAnswer,
  type ActionsBlock,
  type Answer,
  findUiBlocks,
  type HtmlRenderRef,
  type PermissionOption,
  type ProgressCard,
  type ProgressStageStatus,
  type Question,
  type RunStatus,
} from '@gonggong/protocol'
import { translator } from '../../i18n/index.js'
import { summarizeBlocks } from '../../lib/text.js'
import { answerText } from '../questions/dto.js'

/** Cards are read by everyone in the chat: always Chinese, whatever request led to them. */
const zt = translator('zh')

/** Longest markdown a card carries; the rest is behind 查看过程. */
const MAX_MARKDOWN = 3000

type Card = Record<string, unknown>

const text = (content: string) => ({ tag: 'plain_text', content })

const card = (title: string, template: string, elements: unknown[], subtitle?: string): Card => ({
  schema: '2.0',
  config: { update_multi: true },
  header: { title: text(title), ...(subtitle && { subtitle: text(subtitle) }), template },
  body: { elements },
})

const markdown = (content: string) => ({ tag: 'markdown', content })

const truncated = (s: string) =>
  s.length > MAX_MARKDOWN ? `${s.slice(0, MAX_MARKDOWN)}\n\n${zt('……（完整内容见共工）')}` : s

const linkButton = (label: string, url: string, primary = false) => ({
  tag: 'button',
  type: primary ? 'primary' : 'default',
  text: text(label),
  behaviors: [{ type: 'open_url', default_url: url }],
})

const STATUS: Record<RunStatus, { label: string; template: string }> = {
  queued: { label: zt('排队中'), template: 'grey' },
  offline_wait: { label: zt('离线等待'), template: 'grey' },
  forbidden: { label: zt('无权触发'), template: 'red' },
  running: { label: zt('运行中'), template: 'blue' },
  awaiting_approval: { label: zt('等待审批'), template: 'orange' },
  awaiting_answer: { label: zt('等待回答'), template: 'orange' },
  completed: { label: zt('已完成'), template: 'green' },
  interrupted: { label: zt('已中断'), template: 'red' },
  expired: { label: zt('已作废'), template: 'grey' },
}

/** An approval or question of the run, shown inside its card: a block while pending, one history line after. */
export type Interaction =
  | {
      k: 'approval'
      id: string
      title: string
      detail: string
      options: PermissionOption[]
      /** Rules 始终允许 adds; empty → its scope can't be shown, so it isn't offered (plan A7). */
      remember: string[]
      status: string
      by: string | null
      /** The bot owner, the only one who can decide. */
      owner: string
    }
  | {
      k: 'question'
      id: string
      questions: Question[]
      status: string
      by: string | null
      answers: Answer[] | null
    }

export const isPending = (i: Interaction) => i.status === 'pending'

/** Settled lines beyond this fold into a collapsed panel. */
const HISTORY_INLINE = 3

const grey = (s: string) => `<font color='grey'>${s}</font>`
const oneLine = (s: string, max = 60) => {
  const line = s.split('\n')[0] ?? ''
  return line.length > max || s.includes('\n') ? `${line.slice(0, max)}…` : line
}
const codeBlock = (s: string) => `\`\`\`\n${truncated(s).replaceAll('```', "'''")}\n\`\`\``

function historyLine(i: Interaction) {
  const by = i.by ?? ''
  if (i.k === 'approval') {
    const what = i.detail ? `${i.title} \`${oneLine(i.detail).replaceAll('`', "'")}\`` : i.title
    if (i.status === 'approved') return `✓ ${zt('{name} 已允许：{what}', { name: by, what })}`
    if (i.status === 'rejected') return `✕ ${zt('{name} 已拒绝：{what}', { name: by, what })}`
    return grey(`${settledNote(i.status, i.by)}：${what}`)
  }
  const qa = i.questions.map((q) => {
    const answer = answerText(q, i.answers)
    return answer === null ? `**${q.title}**` : `**${q.title}** → ${answer}`
  })
  if (i.status === 'answered') return [`✓ ${zt('{name} 已回答', { name: by })}`, ...qa].join('\n')
  return grey(`${settledNote(i.status, i.by)}：${i.questions.map((q) => q.title).join(zt('、'))}`)
}

const OPTION_ORDER = ['allow_once', 'allow_always', 'reject_once', 'reject_always']

function approvalBlock(i: Extract<Interaction, { k: 'approval' }>): unknown[] {
  const options = i.options
    .filter((opt) => opt.kind !== 'allow_always' || i.remember.length)
    .sort((a, b) => OPTION_ORDER.indexOf(a.kind) - OPTION_ORDER.indexOf(b.kind))
  const buttons: unknown[] = options.map((opt) => {
    const value: CardValue = { k: 'approve', a: i.id, o: opt.optionId }
    return {
      tag: 'column',
      width: 'auto',
      elements: [
        {
          tag: 'button',
          type: opt.kind === 'allow_once' ? 'primary' : opt.kind.startsWith('allow') ? 'default' : 'danger',
          text: text(opt.name),
          behaviors: [{ type: 'callback', value }],
        },
      ],
    }
  })
  return [
    markdown(`**${zt('待审批：{title}', { title: i.title })}**`),
    ...(i.detail ? [markdown(codeBlock(i.detail))] : []),
    ...(options.some((opt) => opt.kind === 'allow_always')
      ? [
          {
            tag: 'collapsible_panel',
            expanded: false,
            header: { title: markdown(grey(zt('「始终允许」将添加的规则'))) },
            elements: [markdown(truncated(i.remember.map((r) => `- \`${r}\``).join('\n')))],
          },
        ]
      : []),
    { tag: 'column_set', horizontal_spacing: 'small', columns: buttons },
    markdown(grey(zt('仅 Bot 主人 {name} 可以审批', { name: i.owner }))),
  ]
}

function questionBlock(i: Extract<Interaction, { k: 'question' }>): unknown[] {
  const value: CardValue = { k: 'answer', q: i.id }
  return [
    {
      tag: 'form',
      name: `answers_${i.id.slice(0, 8)}`,
      elements: [
        ...questionInputs(i.questions),
        {
          tag: 'button',
          type: 'primary',
          name: 'submit',
          text: text(zt('提交回答')),
          form_action_type: 'submit',
          behaviors: [{ type: 'callback', value }],
        },
      ],
    },
  ]
}

/** The run's approvals and questions: settled ones as history (folded when many), then the pending blocks. */
export function interactionElements(items: Interaction[]) {
  const lines = items.filter((i) => !isPending(i)).map((i) => markdown(historyLine(i)))
  const history =
    lines.length > HISTORY_INLINE
      ? [
          {
            tag: 'collapsible_panel',
            expanded: false,
            header: { title: markdown(grey(zt('已处理 {n} 项审批与提问', { n: lines.length }))) },
            elements: lines,
          },
        ]
      : lines
  const pending = items
    .filter(isPending)
    .flatMap((i) => (i.k === 'approval' ? approvalBlock(i) : questionBlock(i)))
  return [...history, ...pending]
}

/**
 * A bot reply as card markdown: its rich UI blocks and html_render `pages` as summaries (not clickable), plus a link
 * to the message in 共工.
 */
export function replyMarkdown(body: string, url: string | null, pages: HtmlRenderRef[] = []) {
  const text = summarizeBlocks(body, pages)
  return text === body || !url ? text : `${text}\n\n[${zt('在共工查看')}](${url})`
}

/** Stands in for an actions block while the rest of the reply is summarized; never part of chat text. */
const slot = (i: number) => `${i}`

/** A bot reply as card elements: its ```actions blocks as buttons in place, the rest as replyMarkdown. */
export function replyElements(o: {
  id: string
  body: string
  url: string | null
  pages?: HtmlRenderRef[]
  answers?: Record<string, ActionAnswer>
}) {
  const blocks: ActionsBlock[] = []
  let body = ''
  let at = 0
  for (const b of findUiBlocks(o.body)) {
    if (b.block.lang !== 'actions') continue
    body += o.body.slice(at, b.start) + slot(blocks.length)
    blocks.push(b.block.data)
    at = b.end
  }
  body += o.body.slice(at)
  return replyMarkdown(body, o.url, o.pages)
    .split(/(\d+)/)
    .flatMap((part, i) => {
      if (i % 2 === 0) return part.trim() ? [markdown(truncated(part.trim()))] : []
      const block = blocks[Number(part)] as ActionsBlock
      return actionsElements(o.id, block, o.answers?.[block.id])
    })
}

/** One actions block: buttons (a form for multiple), or once answered, disabled buttons and who chose what. */
function actionsElements(messageId: string, b: ActionsBlock, answer: ActionAnswer | undefined): unknown[] {
  const head = b.prompt ? [markdown(`**${b.prompt}**`)] : []
  const button = (opt: ActionsBlock['options'][number], i: number) => {
    const value: CardValue = { k: 'act', m: messageId, b: b.id, o: i }
    return {
      tag: 'button',
      type: opt.style ?? 'default',
      text: text(opt.label),
      ...(answer ? { disabled: true } : { behaviors: [{ type: 'callback', value }] }),
    }
  }
  const row = {
    tag: 'column_set',
    horizontal_spacing: 'small',
    columns: b.options.map((opt, i) => ({ tag: 'column', width: 'auto', elements: [button(opt, i)] })),
  }
  if (answer)
    return [
      ...head,
      row,
      markdown(
        grey(
          zt('已选择：{labels}（by {name}）', { labels: answer.labels.join(zt('、')), name: answer.name }),
        ),
      ),
    ]
  if (!b.multiple) return [...head, row]
  const value: CardValue = { k: 'act', m: messageId, b: b.id }
  return [
    ...head,
    {
      tag: 'form',
      name: `act_${b.id}`,
      elements: [
        {
          tag: 'multi_select_static',
          name: ACT_FIELD,
          required: true,
          placeholder: text(zt('请选择')),
          options: b.options.map((opt, i) => ({ text: text(opt.label), value: String(i) })),
        },
        {
          tag: 'button',
          type: 'primary',
          name: 'submit',
          text: text(zt('提交选择')),
          form_action_type: 'submit',
          behaviors: [{ type: 'callback', value }],
        },
      ],
    },
  ]
}

/** Form field of a multiple actions block's picks. */
export const ACT_FIELD = 'opts'

/** An html_render page's snapshot (a Feishu image_key), and where the reply shows the live page (null without 对外地址). */
export type PageShot = { title: string; image: string; url: string | null }

export const pageShot = (p: PageShot) => [
  { tag: 'img', img_key: p.image, alt: text(p.title), scale_type: 'fit_horizontal', preview: true },
  ...(p.url ? [linkButton(zt('在共工查看完整页面'), p.url)] : []),
]

/** One card per run: status while it works, then the final reply. `url` (查看过程) is null without 对外地址. */
export function runCard(o: {
  bot: string
  status: RunStatus
  step: string
  /** The final reply's elements (replyElements). */
  reply: unknown[] | null
  url: string | null
  items?: Interaction[]
}) {
  const s = STATUS[o.status]
  return card(
    o.bot,
    s.template,
    [
      ...(o.reply ?? (o.step ? [markdown(truncated(o.step))] : [])),
      ...interactionElements(o.items ?? []),
      ...(o.url ? [linkButton(zt('查看过程'), o.url)] : []),
    ],
    s.label,
  )
}

/** Element ids of the streaming run card: the reply streams into REPLY_ELEMENT, the current step sits below it. */
export const REPLY_ELEMENT = 'reply'
const STEP_ELEMENT = 'step'

/**
 * The run card while it works, as a CardKit entity: the agent's text so far, the step it is on, its approvals and
 * questions, and 查看过程. Streaming mode is off while something is pending (Feishu cards in streaming mode can't
 * take a callback). `text` is cut like the final reply so streamed updates keep a common prefix.
 */
export function runStreamCard(o: {
  bot: string
  status: RunStatus
  step: string
  text: string
  url: string | null
  items?: Interaction[]
}) {
  const s = STATUS[o.status]
  const items = o.items ?? []
  return {
    schema: '2.0',
    config: { update_multi: true, streaming_mode: !items.some(isPending) },
    header: { title: text(o.bot), subtitle: text(s.label), template: s.template },
    body: {
      elements: [
        { ...markdown(streamText(o.text)), element_id: REPLY_ELEMENT },
        ...(o.step ? [{ ...markdown(`▸ ${o.step}`), element_id: STEP_ELEMENT }] : []),
        ...interactionElements(items),
        ...(o.url ? [linkButton(zt('查看过程'), o.url)] : []),
      ],
    },
  }
}

/** What the reply element shows: the streamed text (cut like the final reply), or a placeholder before any. */
export const streamText = (s: string) => (s ? truncated(hideUiBlocks(s)) : zt('正在处理…'))

const BUILDING: Record<string, string> = {
  actions: zt('选项生成中…'),
  'html-page': zt('页面生成中…'),
  mermaid: zt('流程图生成中…'),
}
const UI_LANG = '(actions|html-page|mermaid)\\b[^\\n]*'
const CLOSED_UI_BLOCK = new RegExp(`^(\`{3,}|~{3,})[ \\t]*${UI_LANG}\\n[\\s\\S]*?\\n\\1[ \\t]*$`, 'gm')
/** After the closed ones are gone, an opening fence left runs to the end: the block still streaming in. */
const OPEN_UI_BLOCK = new RegExp(`^(?:\`{3,}|~{3,})[ \\t]*${UI_LANG}(?:\\n[\\s\\S]*)?$`, 'm')

/**
 * Rich UI blocks as one line while the reply streams (their source is noise until the final card renders them),
 * whether closed yet or not.
 */
const hideUiBlocks = (s: string) =>
  s
    .replace(CLOSED_UI_BLOCK, (_m, _fence, lang: string) => BUILDING[lang] ?? '')
    .replace(OPEN_UI_BLOCK, (_m, lang: string) => BUILDING[lang] ?? '')

export type CardValue =
  | { k: 'answer'; q: string }
  | { k: 'approve'; a: string; o: string }
  /** An actions block of reply `m`: option `o`, or the ACT_FIELD picks of a multiple one. */
  | { k: 'act'; m: string; b: string; o?: number }
  | { k: 'share'; r: string; ok: boolean }
  /** 入群申请 `r`: approve (ok) or reject. */
  | { k: 'join'; r: string; ok: boolean }
  /** 新手群 welcome card example: ask bot `b` question `q` in group `g` as the clicker. */
  | { k: 'ask'; g: string; b: string; q: string }

const field = (i: number) => `q${i}`

/** Each question's bold title and its control; field names are what formAnswers reads back. */
function questionInputs(questions: Question[]) {
  return questions.flatMap((q, i) => {
    const options = q.options.map((label, n) => ({ text: text(label), value: String(n) }))
    const control =
      q.type === 'text'
        ? { tag: 'input', name: field(i), required: true, placeholder: text(zt('输入回答')) }
        : {
            tag: q.type === 'multi' ? 'multi_select_static' : 'select_static',
            name: field(i),
            required: true,
            placeholder: text(zt('请选择')),
            options,
            ...(q.recommended !== null && q.type !== 'multi' && { initial_option: String(q.recommended) }),
          }
    return [markdown(`**${i + 1}. ${q.title}**`), control]
  })
}

/** The agent's questions as one form; settled cards show who handled them instead. */
export function questionCard(o: {
  bot: string
  id: string
  questions: Question[]
  status: string
  by: string | null
  answers: Answer[] | null
}) {
  const lines = o.questions.map((q, i) => `**${i + 1}. ${q.title}**`)
  if (o.status !== 'pending')
    return card(zt('{bot} 的提问', { bot: o.bot }), 'grey', [
      markdown(
        lines
          .map((line, i) => {
            const answer = answerText(o.questions[i] as Question, o.answers)
            return answer === null ? line : `${line}\n→ ${answer}`
          })
          .join('\n'),
      ),
      markdown(settledNote(o.status, o.by)),
    ])
  const value: CardValue = { k: 'answer', q: o.id }
  return card(zt('{bot} 的提问', { bot: o.bot }), 'orange', [
    {
      tag: 'form',
      name: 'answers',
      elements: [
        ...questionInputs(o.questions),
        {
          tag: 'button',
          type: 'primary',
          name: 'submit',
          text: text(zt('提交回答')),
          form_action_type: 'submit',
          behaviors: [{ type: 'callback', value }],
        },
      ],
    },
  ])
}

/** Form values back to the answers the card asked for (indexes for choices, text for text questions). */
export function formAnswers(questions: Question[], form: Record<string, unknown>) {
  return questions.map((q, i) => {
    const raw = form[field(i)]
    if (q.type === 'text') return { questionId: q.id, choices: [], text: typeof raw === 'string' ? raw : '' }
    const picked = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => Number(v))
    return { questionId: q.id, choices: picked, text: null }
  })
}

export function approvalCard(o: {
  bot: string
  id: string
  title: string
  detail: string
  options: PermissionOption[]
  /** Rules 始终允许 adds; empty → its scope can't be shown, so it isn't offered (plan A7). */
  remember: string[]
  status: string
  by: string | null
}) {
  const head = [markdown(`**${o.title}**`), ...(o.detail ? [markdown(truncated(o.detail))] : [])]
  if (o.status !== 'pending')
    return card(zt('{bot} 请求审批', { bot: o.bot }), 'grey', [
      ...head,
      markdown(settledNote(o.status, o.by)),
    ])
  const options = o.options.filter((opt) => opt.kind !== 'allow_always' || o.remember.length)
  const scope = options.some((opt) => opt.kind === 'allow_always')
    ? [markdown(truncated(zt('将始终允许：{rules}', { rules: o.remember.join(zt('、')) })))]
    : []
  const buttons = options.map((opt) => {
    const value: CardValue = { k: 'approve', a: o.id, o: opt.optionId }
    return {
      tag: 'button',
      type: opt.kind.startsWith('allow') ? 'primary' : 'danger',
      text: text(opt.name),
      behaviors: [{ type: 'callback', value }],
    }
  })
  return card(zt('{bot} 请求审批', { bot: o.bot }), 'orange', [...head, ...scope, ...buttons])
}

export type PreviewState = 'online' | 'offline' | 'login' | 'closed'

const PREVIEW_KIND: Record<string, string> = {
  http: zt('网页'),
  static: zt('网页'),
  gui: zt('桌面应用'),
  miniprogram: zt('小程序'),
}

const PREVIEW_STATE: Record<PreviewState, { label: string; template: string }> = {
  online: { label: zt('可打开'), template: 'green' },
  offline: { label: zt('机器离线'), template: 'grey' },
  login: { label: zt('等待开发者工具登录'), template: 'orange' },
  closed: { label: zt('已关闭'), template: 'grey' },
}

/** Feishu applink that opens `url` in the chat's sidebar (desktop client). */
const sidebarUrl = (url: string) =>
  `https://applink.feishu.cn/client/web_url/open?mode=sidebar-semi&url=${encodeURIComponent(url)}`

/** A bot's published preview: its snapshot and the ways to open it in 共工; `url` is null without 对外地址 or once closed. */
export function previewCard(o: {
  bot: string
  title: string
  kind: string
  state: PreviewState
  image: string | null
  url: string | null
}) {
  const s = PREVIEW_STATE[o.state]
  const elements = [
    ...(o.image
      ? [{ tag: 'img', img_key: o.image, alt: text(o.title), scale_type: 'fit_horizontal', preview: true }]
      : []),
    ...(o.url
      ? [linkButton(zt('打开预览'), o.url, true), linkButton(zt('在飞书侧边栏打开'), sidebarUrl(o.url))]
      : []),
  ]
  const note = o.state === 'closed' ? zt('预览已关闭') : zt('在共工群里打开此预览')
  return card(
    o.title,
    s.template,
    elements.length ? elements : [markdown(note)],
    `${o.bot} · ${PREVIEW_KIND[o.kind] ?? o.kind} · ${s.label}`,
  )
}

/**
 * A bot asking for secrets (secret_request): values are only typed on 共工's page, never into the card. `url` is null
 * without 对外地址.
 */
export function secretCard(o: { bot: string; text: string; filled: boolean; url: string | null }) {
  if (o.filled) return card(zt('填写密钥'), 'green', [markdown(o.text)], `${o.bot} · ${zt('已填写')}`)
  return card(
    zt('填写密钥'),
    'orange',
    [
      markdown(o.text),
      o.url
        ? linkButton(zt('去填写'), o.url, true)
        : markdown(grey(zt('请到共工群里填写；如需在飞书直接打开，请系统管理员设置对外地址'))),
    ],
    `${o.bot} · ${zt('等待填写')}`,
  )
}

const STAGE_MARK: Record<ProgressStageStatus, string> = {
  pending: '⚪',
  running: '🔵',
  done: '✅',
  failed: '❌',
  skipped: '⏭️',
}
const PROGRESS_TEMPLATE: Record<ProgressCard['status'], string> = {
  running: 'blue',
  done: 'green',
  failed: 'red',
}

/** A bot's progress card (progress_card): its stages in order, then percent, detail and link. */
export function progressCard(o: ProgressCard & { bot: string }) {
  const lines = [
    o.stages.map((s) => `${STAGE_MARK[s.status]} ${s.name}`).join('  →  '),
    ...(o.percent === null ? [] : [zt('进度 {n}%', { n: o.percent })]),
    ...(o.detail ? [o.detail] : []),
  ]
  return card(
    o.title,
    PROGRESS_TEMPLATE[o.status],
    [markdown(lines.join('\n')), ...(o.link ? [linkButton(o.link.label, o.link.url, true)] : [])],
    o.bot,
  )
}

function settledNote(status: string, by: string | null) {
  if (status === 'expired') return zt('已超时')
  if (status === 'void') return zt('已作废')
  if (status === 'rejected') return zt('已由 {name} 拒绝', { name: by ?? '' })
  if (status === 'approved') return zt('已由 {name} 允许', { name: by ?? '' })
  return zt('已由 {name} 处理', { name: by ?? '' })
}

/** 飞书通知: one notification in the user's DM, with 打开共工 when 对外地址 is set. */
export function notificationCard(o: { label: string; group: string; text: string; url: string | null }) {
  return card(
    o.label,
    'blue',
    [markdown(o.text), ...(o.url ? [linkButton(zt('打开共工'), o.url, true)] : [])],
    o.group || undefined,
  )
}

/** 飞书通知 of a share request: 同意 / 拒绝 while pending, then who decided. */
export function shareRequestCard(o: {
  label: string
  text: string
  url: string | null
  requestId: string
  /** Bot share request (default) or join request. */
  kind?: 'share' | 'join'
  decided?: { approved: boolean; by: string }
}) {
  const open = o.url ? [linkButton(zt('打开共工'), o.url)] : []
  if (o.decided)
    return card(o.label, 'grey', [
      markdown(o.text),
      markdown(
        o.decided.approved
          ? zt('已由 {name} 同意', { name: o.decided.by })
          : zt('已由 {name} 拒绝', { name: o.decided.by }),
      ),
      ...open,
    ])
  const button = (label: string, type: string, ok: boolean) => {
    const value: CardValue = { k: o.kind ?? 'share', r: o.requestId, ok }
    return {
      tag: 'column',
      width: 'auto',
      elements: [{ tag: 'button', type, text: text(label), behaviors: [{ type: 'callback', value }] }],
    }
  }
  return card(o.label, 'blue', [
    markdown(o.text),
    {
      tag: 'column_set',
      horizontal_spacing: 'small',
      columns: [button(zt('同意'), 'primary', true), button(zt('拒绝'), 'danger', false)],
    },
    ...open,
  ])
}

/** Why a Feishu @ did not start anything, with the way out when there is one. */
export function noticeCard(message: string, action?: { label: string; url: string }) {
  return card(zt('共工'), 'blue', [
    markdown(message),
    ...(action ? [linkButton(action.label, action.url, true)] : []),
  ])
}

/**
 * 新手群 welcome in a newcomer's DM. Examples are buttons only when the sending app takes card callbacks (a bot
 * app; the main app subscribes to none), otherwise lines to copy into the group.
 */
export function welcomeCard(o: {
  team: string
  bot: string
  groupId: string
  botId: string
  examples: string[]
  clickable: boolean
  chatUrl: string | null
}) {
  const ask = (q: string): CardValue => ({ k: 'ask', g: o.groupId, b: o.botId, q })
  return card(zt('欢迎加入 {team}', { team: o.team }), 'blue', [
    markdown(zt('有问题直接在群里 @{bot}', { bot: o.bot })),
    ...(o.clickable
      ? o.examples.map((q) => ({
          tag: 'button',
          type: 'default',
          width: 'fill',
          text: text(q),
          behaviors: [{ type: 'callback', value: ask(q) }],
        }))
      : [markdown(o.examples.map((q) => `- @${o.bot} ${q}`).join('\n'))]),
    ...(o.chatUrl ? [linkButton(zt('打开飞书群'), o.chatUrl, true)] : []),
  ])
}
