import type { MessageDto, RunDto, RunStatus } from '@aiws/protocol'
import {
  Bot,
  CircleDot,
  Folder,
  GitBranch,
  Hourglass,
  Info,
  Link2,
  Loader,
  MessageCircleQuestion,
  RefreshCw,
  ShieldAlert,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, type BadgeVariant } from '../../ui'
import { Markdown } from './Markdown'

export const RUN_STATUS: Record<RunStatus, { label: string; variant: BadgeVariant }> = {
  queued: { label: '排队中', variant: 'secondary' },
  offline_wait: { label: '离线等待', variant: 'outline' },
  forbidden: { label: '无权触发', variant: 'outline' },
  running: { label: '运行中', variant: 'info' },
  awaiting_approval: { label: '等待审批', variant: 'warning' },
  awaiting_answer: { label: '等待回答', variant: 'warning' },
  completed: { label: '已完成', variant: 'success' },
  interrupted: { label: '已中断', variant: 'destructive' },
  expired: { label: '已作废', variant: 'outline' },
}

/** Daemon reason codes; the first session of a (group, bot) pair needs no note. */
const NEW_SESSION: Record<string, string | null> = {
  first: null,
  resume_failed: '会话恢复失败，已开新会话并补送最近 50 条群消息',
  requested: '已按要求开启新会话',
}
const newSessionNote = (reason: string | null) => (reason === null ? null : (NEW_SESSION[reason] ?? reason))

const LIVE: RunStatus[] = ['running', 'awaiting_approval', 'awaiting_answer']

const pad = (n: number) => String(n).padStart(2, '0')

export function fmtTime(iso: string) {
  const d = new Date(iso)
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function fmtUsage(u: RunDto['usage']) {
  const total = u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)
  if (!total) return '用量未上报'
  return total >= 1000 ? `${(total / 1000).toFixed(1)}k tokens` : `${total} tokens`
}

function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  return now
}

/** Splits text into plain and `@name` segments; the longest known name wins. */
export function splitMentions(text: string, names: string[]) {
  const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  const out: { text: string; mention: boolean }[] = []
  let plain = ''
  for (let i = 0; i < text.length; i++) {
    const name = text[i] === '@' ? sorted.find((n) => text.startsWith(n, i + 1)) : undefined
    if (!name) {
      plain += text[i]
      continue
    }
    if (plain) out.push({ text: plain, mention: false })
    out.push({ text: `@${name}`, mention: true })
    plain = ''
    i += name.length
  }
  if (plain) out.push({ text: plain, mention: false })
  return out
}

function eventIcon(body: string) {
  if (body.includes('创建了私聊')) return UserPlus
  if (body.includes('创建了群')) return Users
  if (body.startsWith('群绑定仓库')) return GitBranch
  if (body.startsWith('未绑定仓库')) return Folder
  if (body.includes('移出')) return UserMinus
  if (body.includes(' 加入')) return Bot
  return Info
}

export function EventRow({ m }: { m: MessageDto }) {
  const Icon = eventIcon(m.body)
  return (
    <div className="tl-event">
      <Icon size={12} />
      <span className="tl-event__text">{m.body}</span>
      <span className="tl-time">{fmtTime(m.createdAt)}</span>
    </div>
  )
}

export function UserMessage({ m, names }: { m: MessageDto; names: string[] }) {
  return (
    <div className="tl-msg">
      <div className="tl-avatar">{Array.from(m.authorName)[0]}</div>
      <div className="tl-msg__main">
        <div className="tl-msg__head">
          <span className="tl-msg__who">{m.authorName}</span>
          <span className="tl-time">{fmtTime(m.createdAt)}</span>
        </div>
        <div className="tl-msg__text">
          {splitMentions(m.body, names).map((s, i) =>
            s.mention ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
              <span key={i} className="tl-mention">
                {s.text}
              </span>
            ) : (
              s.text
            ),
          )}
        </div>
      </div>
    </div>
  )
}

export function BotReply({ m }: { m: MessageDto }) {
  return (
    <div className="tl-msg">
      <div className="tl-avatar tl-avatar--bot">{Array.from(m.authorName)[0]}</div>
      <div className="tl-msg__main">
        <div className="tl-msg__head">
          <span className="tl-msg__who">{m.authorName}</span>
          <span className="tl-reply-tag">最终回复</span>
          <span className="tl-time">{fmtTime(m.createdAt)}</span>
        </div>
        <Markdown text={m.body} />
      </div>
    </div>
  )
}

const STEP_ICON: Partial<Record<RunStatus, typeof CircleDot>> = {
  running: Loader,
  queued: Hourglass,
  offline_wait: Hourglass,
  awaiting_approval: ShieldAlert,
  awaiting_answer: MessageCircleQuestion,
}

export function RunCard({
  run,
  delta,
  botName,
  agent,
  trigger,
}: {
  run: RunDto
  delta?: string
  botName: string
  agent: string
  trigger: string
}) {
  const live = LIVE.includes(run.status)
  const now = useNow(live && !!run.startedAt)
  const status = RUN_STATUS[run.status]
  const streamed = run.status === 'running' ? delta?.trim().split('\n').at(-1) : undefined
  const step = streamed || run.step
  const StepIcon = STEP_ICON[run.status] ?? CircleDot
  const started = run.startedAt ? Date.parse(run.startedAt) : null
  const sessionNote = newSessionNote(run.newSessionReason)
  return (
    <div className="run-card" data-testid="run-card" data-status={run.status}>
      <div className="run-card__head">
        <div className="run-card__init">{Array.from(botName)[0]}</div>
        <span className="run-card__bot">{botName}</span>
        <span className="run-card__sub">
          {agent} · {trigger} 触发
        </span>
        {run.hop > 1 ? (
          <span className="run-card__hop">
            <Link2 size={10} />
            接力 {run.hop}
          </span>
        ) : null}
        <span className="spacer" />
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      {step ? (
        <div className="run-card__step">
          <StepIcon size={12} className={run.status === 'running' ? 'run-card__spin' : undefined} />
          <span>{step}</span>
        </div>
      ) : null}
      {started !== null ? (
        <div className="run-card__meta">
          <span>改动 {run.filesChanged} 个文件</span>
          <span>·</span>
          <span>{fmtDuration((run.endedAt ? Date.parse(run.endedAt) : now) - started)}</span>
          <span>·</span>
          <span>{fmtUsage(run.usage)}</span>
        </div>
      ) : null}
      {sessionNote ? (
        <div className="run-card__session">
          <RefreshCw size={11} />
          {sessionNote}
        </div>
      ) : null}
    </div>
  )
}
