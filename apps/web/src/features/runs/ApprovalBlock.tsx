import type { ApprovalDto, PermissionOption, RunDto } from '@gonggong/protocol'
import { ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { ApiError, api } from '../../lib/api'
import { Button, toast } from '../../ui'
import { CountdownRing } from '../chat/RunGraphics'
import { TIER_LABEL } from './tier'
import './approval.css'

/** ACP tool kinds as the prototype names them. */
export const VOID_TEXT = {
  stopped: '运行已停止，请求作废',
  chain_stopped: '链已终止，请求作废',
  ended: '运行已结束，请求作废',
} as const

const KIND: Record<string, string> = {
  execute: '执行命令',
  fetch: '访问网络',
  edit: '写入文件',
  delete: '删除文件',
  move: '移动文件',
  read: '读取文件',
  search: '搜索',
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hm = (iso: string) => {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

const pick = (options: PermissionOption[], kinds: PermissionOption['kind'][]) =>
  kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean)

function outcome(a: ApprovalDto) {
  const at = a.decidedAt ? hm(a.decidedAt) : ''
  switch (a.status) {
    case 'approved':
      return `${a.decidedByName} 已批准 · ${at}`
    case 'rejected':
      return `${a.decidedByName} 已拒绝 · ${at} · agent 将自行绕路`
    case 'expired':
      return `超时未处理，已自动拒绝 · ${at} · agent 将自行绕路`
    case 'void':
      return VOID_TEXT[a.voidReason ?? 'ended']
    default:
      return null
  }
}

export function useNow(ticking: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ticking])
  return now
}

/** The run's latest permission request (spec §3.4): only the bot owner may decide, others just watch. */
export function ApprovalBlock({ run }: { run: RunDto }) {
  const a = run.approvals.at(-1)
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user)
  const pending = a?.status === 'pending'
  const now = useNow(pending)
  const [busy, setBusy] = useState(false)
  if (!a) return null
  const mine = !!me && me.id === bot?.ownerId
  const allow = pick(a.options, ['allow_once', 'allow_always'])
  const always = a.options.find((o) => o.kind === 'allow_always' && o !== allow)
  const reject = pick(a.options, ['reject_once', 'reject_always'])
  const tier = `超出「${TIER_LABEL[bot?.tier ?? 'workspace']}」档位`
  const left = Date.parse(a.expiresAt) - now

  const decide = async (option: PermissionOption) => {
    setBusy(true)
    try {
      await api.post(`/runs/${run.id}/approvals/${a.id}`, { optionId: option.optionId })
    } catch (e) {
      toast({ type: 'error', message: e instanceof ApiError ? e.message : '操作失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="approval" data-resolved={!pending || undefined}>
      <div className="approval__title">
        {pending ? (
          <CountdownRing
            left={left}
            total={Date.parse(a.expiresAt) - Date.parse(a.createdAt)}
            text={countdown(left)}
          >
            <ShieldAlert size={10} />
          </CountdownRing>
        ) : (
          <ShieldAlert size={13} />
        )}
        权限请求 · {KIND[a.toolKind] ?? '其他操作'}
      </div>
      <div className="approval__cmd">{a.detail}</div>
      <div className="approval__why">
        {pending ? `${tier} · ${countdown(left)} 后自动拒绝，agent 自行绕路` : tier}
      </div>
      {pending ? (
        <div className="approval__actions">
          <Button
            variant="primary"
            size="sm"
            disabled={!mine || busy || !allow}
            onClick={() => allow && decide(allow)}
          >
            批准
          </Button>
          {always && (
            <Button variant="outline" size="sm" disabled={!mine || busy} onClick={() => decide(always)}>
              始终允许
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!mine || busy || !reject}
            onClick={() => reject && decide(reject)}
          >
            拒绝
          </Button>
          <span className="approval__hint">
            {mine ? '你是 Bot 主人' : `仅 Bot 主人 ${bot?.ownerName ?? ''} 可操作，你只能查看`}
          </span>
        </div>
      ) : (
        <div className="approval__done">{outcome(a)}</div>
      )}
    </div>
  )
}
