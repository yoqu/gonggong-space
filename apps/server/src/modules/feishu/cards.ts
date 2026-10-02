import type { Answer, PermissionOption, Question, RunStatus } from '@gonggong/protocol'
import { translator } from '../../i18n/index.js'
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

/** One card per run: status while it works, then the final reply. `url` (查看过程) is null without 对外地址. */
export function runCard(o: {
  bot: string
  status: RunStatus
  step: string
  reply: string | null
  url: string | null
}) {
  const s = STATUS[o.status]
  const body = o.reply ?? o.step
  return card(
    o.bot,
    s.template,
    [...(body ? [markdown(truncated(body))] : []), ...(o.url ? [linkButton(zt('查看过程'), o.url)] : [])],
    s.label,
  )
}

/** Element ids of the streaming run card: the reply streams into REPLY_ELEMENT, the current step sits below it. */
export const REPLY_ELEMENT = 'reply'
const STEP_ELEMENT = 'step'

/**
 * The run card while it works, as a CardKit entity in streaming mode: the agent's text so far, the step it is
 * on and 查看过程. `text` is cut like the final reply so streamed updates keep a common prefix.
 */
export function runStreamCard(o: {
  bot: string
  status: RunStatus
  step: string
  text: string
  url: string | null
}) {
  const s = STATUS[o.status]
  return {
    schema: '2.0',
    config: { update_multi: true, streaming_mode: true },
    header: { title: text(o.bot), subtitle: text(s.label), template: s.template },
    body: {
      elements: [
        { ...markdown(streamText(o.text)), element_id: REPLY_ELEMENT },
        ...(o.step ? [{ ...markdown(`▸ ${o.step}`), element_id: STEP_ELEMENT }] : []),
        ...(o.url ? [linkButton(zt('查看过程'), o.url)] : []),
      ],
    },
  }
}

/** What the reply element shows: the streamed text (cut like the final reply), or a placeholder before any. */
export const streamText = (s: string) => (s ? truncated(s) : zt('正在处理…'))

export type CardValue = { k: 'answer'; q: string } | { k: 'approve'; a: string; o: string }

const field = (i: number) => `q${i}`

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
  const inputs = o.questions.flatMap((q, i) => {
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
    return [markdown(lines[i] as string), control]
  })
  const value: CardValue = { k: 'answer', q: o.id }
  return card(zt('{bot} 的提问', { bot: o.bot }), 'orange', [
    {
      tag: 'form',
      name: 'answers',
      elements: [
        ...inputs,
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
  status: string
  by: string | null
}) {
  const head = [markdown(`**${o.title}**`), ...(o.detail ? [markdown(truncated(o.detail))] : [])]
  if (o.status !== 'pending')
    return card(zt('{bot} 请求审批', { bot: o.bot }), 'grey', [
      ...head,
      markdown(settledNote(o.status, o.by)),
    ])
  const buttons = o.options.map((opt) => {
    const value: CardValue = { k: 'approve', a: o.id, o: opt.optionId }
    return {
      tag: 'button',
      type: opt.kind.startsWith('allow') ? 'primary' : 'danger',
      text: text(opt.name),
      behaviors: [{ type: 'callback', value }],
    }
  })
  return card(zt('{bot} 请求审批', { bot: o.bot }), 'orange', [...head, ...buttons])
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

function settledNote(status: string, by: string | null) {
  if (status === 'expired') return zt('已超时')
  if (status === 'void') return zt('已作废')
  if (status === 'rejected') return zt('已由 {name} 拒绝', { name: by ?? '' })
  if (status === 'approved') return zt('已由 {name} 允许', { name: by ?? '' })
  return zt('已由 {name} 处理', { name: by ?? '' })
}

/** Why a Feishu @ did not start anything, with the way out when there is one. */
export function noticeCard(message: string, action?: { label: string; url: string }) {
  return card(zt('共工'), 'blue', [
    markdown(message),
    ...(action ? [linkButton(action.label, action.url, true)] : []),
  ])
}
