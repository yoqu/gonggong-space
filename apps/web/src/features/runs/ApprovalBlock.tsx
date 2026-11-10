import type { ApprovalDto, PermissionOption, ReviewRisk, RunDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { api } from '../../lib/api'
import { toastError } from '../../lib/errors'
import { useNow } from '../../lib/now'
import { countdown, hm } from '../../lib/time'
import { Button, Icon, Tag, type TagTone } from '../../ui'
import { CountdownRing } from '../chat/RunGraphics'
import './approval.css'
import { t } from '../../i18n'

/** ACP tool kinds as the prototype names them. */
export const VOID_TEXT = {
  stopped: t('运行已停止，请求作废'),
  chain_stopped: t('链已终止，请求作废'),
  ended: t('运行已结束，请求作废'),
}

const KIND: Record<string, string> = {
  execute: t('执行命令'),
  fetch: t('访问网络'),
  edit: t('写入文件'),
  delete: t('删除文件'),
  move: t('移动文件'),
  read: t('读取文件'),
  search: t('搜索'),
}

const DONE: Record<ApprovalDto['status'], [string, TagTone]> = {
  pending: [t('待审批'), 'orange'],
  approved: [t('已批准'), 'green'],
  rejected: [t('已拒绝'), 'red'],
  expired: [t('已超时'), 'gray'],
  void: [t('已作废'), 'gray'],
}

const REASON: Record<ApprovalDto['reason'], string> = {
  high_risk: t('高危命令，必须由主人确认'),
  protected_base: t('可能修改受保护的基准分支'),
  network: t('需要访问网络'),
  write: t('需要写入或修改文件'),
  unparsed: t('命令较复杂，无法确认是否只读'),
  not_allowed: t('未被只读规则或已保存的允许规则覆盖'),
  ai_denied: t('AI 预审认为有风险'),
  ai_timeout: t('AI 预审超时'),
  ai_unparsed: t('AI 预审没有给出结论'),
  ai_error: t('AI 预审未能运行'),
}

const RISK: Record<ReviewRisk, [string, TagTone]> = {
  low: [t('低风险'), 'green'],
  medium: [t('中风险'), 'orange'],
  high: [t('高风险'), 'red'],
  critical: [t('极高风险'), 'solid-red'],
}

const pick = (options: PermissionOption[], kinds: PermissionOption['kind'][]) =>
  kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean)

function outcome(a: ApprovalDto) {
  const at = a.decidedAt ? hm(a.decidedAt) : ''
  switch (a.status) {
    case 'approved':
      return t('{name} 已批准 · {at}', { name: a.decidedByName ?? '', at })
    case 'rejected':
      return t('{name} 已拒绝 · {at} · agent 将自行绕路', { name: a.decidedByName ?? '', at })
    case 'expired':
      return t('超时未处理，已自动拒绝 · {at} · agent 将自行绕路', { at })
    case 'void':
      return VOID_TEXT[a.voidReason ?? 'ended']
    default:
      return null
  }
}

/** The run's oldest pending permission request, else its latest (spec §3.4): only the bot owner may decide, others just watch.
 *  Agents may ask several in parallel; deciding a later one must not hide an earlier one still blocking the turn. */
export function ApprovalBlock({ run }: { run: RunDto }) {
  const pending = run.approvals.filter((x) => x.status === 'pending')
  const a = pending[0] ?? run.approvals.at(-1)
  return a ? <ApprovalCard key={a.id} run={run} approval={a} others={pending.slice(1)} /> : null
}

/** One permission request of the run, decidable while pending; `others` = the requests waiting behind it, listed on
 *  the same card and approvable together. */
export function ApprovalCard({
  run,
  approval: a,
  others = [],
}: {
  run: RunDto
  approval: ApprovalDto
  others?: ApprovalDto[]
}) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const me = useSession((s) => s.user)
  const pending = a.status === 'pending'
  const now = useNow(pending)
  /** The action in flight, so its own button spins. */
  const [busy, setBusy] = useState<string | null>(null)
  const mine = !!me && me.id === bot?.ownerId
  const demo = useSession((s) => s.tenancy?.demoMode)
  const allow = pick(a.options, ['allow_once', 'allow_always'])
  // Without rules to remember, 批准，不再询问 would silently behave like 批准 (plan A7).
  const always = a.remember.length
    ? a.options.find((o) => o.kind === 'allow_always' && o !== allow)
    : undefined
  const reject = pick(a.options, ['reject_once', 'reject_always'])
  const left = Date.parse(a.expiresAt) - now

  const send = async (path: string, body: unknown, action: string) => {
    setBusy(action)
    try {
      await api.post(path, body)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }
  const decide = (option: PermissionOption, session?: boolean) =>
    send(
      `/runs/${run.id}/approvals/${a.id}`,
      { optionId: option.optionId, ...(session && { session }) },
      session ? 'session' : option.optionId,
    )
  const approveAll = async () => {
    setBusy('all')
    try {
      for (const x of [a, ...others]) {
        const option = pick(x.options, ['allow_once', 'allow_always'])
        if (option) await api.post(`/runs/${run.id}/approvals/${x.id}`, { optionId: option.optionId })
      }
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="approval"
      data-pending-id={pending ? a.id : undefined}
      data-resolved={!pending || undefined}
    >
      <div className="approval__title">
        {pending ? (
          <CountdownRing
            left={left}
            total={Date.parse(a.expiresAt) - Date.parse(a.createdAt)}
            text={countdown(left)}
          >
            <Icon name="shield-warning" size={10} weight={1.8} />
          </CountdownRing>
        ) : (
          <Icon name="shield-warning" size={14} />
        )}
        {t('权限请求 · {kind}', { kind: KIND[a.toolKind] ?? t('其他操作') })}
      </div>
      <div className="approval__cmd">{a.detail}</div>
      <div className="approval__why">
        {pending
          ? t('{reason} · {time} 后自动拒绝，agent 自行绕路', {
              reason: REASON[a.reason],
              time: countdown(left),
            })
          : REASON[a.reason]}
      </div>
      {a.review ? (
        <div className="approval__review">
          <Tag tone={RISK[a.review.risk][1]}>{RISK[a.review.risk][0]}</Tag>
          <span>{t('AI 预审：{rationale}', { rationale: a.review.rationale })}</span>
        </div>
      ) : null}
      {pending && others.length > 0 && (
        <div className="approval__others">
          <div className="approval__why">{t('还有 {n} 个请求在等待：', { n: others.length })}</div>
          {others.map((x) => (
            <div key={x.id} className="approval__cmd">
              {x.detail}
            </div>
          ))}
        </div>
      )}
      {pending ? (
        <div className="approval__actions">
          <Button
            variant="primary"
            size="small"
            disabled={!mine || !!busy || !allow}
            loading={!!allow && busy === allow.optionId}
            onClick={() => allow && decide(allow)}
          >
            {t('批准')}
          </Button>
          {allow && a.rememberSession.length > 0 && (
            <Button
              size="small"
              disabled={!mine || !!busy}
              loading={busy === 'session'}
              title={t('本次会话不再问：{rules}', { rules: a.rememberSession.join(t('、')) })}
              onClick={() => decide(allow, true)}
            >
              {t('本次会话不再问')}
            </Button>
          )}
          {always && (
            <Button
              size="small"
              disabled={!mine || !!busy}
              loading={busy === always.optionId}
              onClick={() => decide(always)}
            >
              {t('批准，不再询问')}
            </Button>
          )}
          {!demo && (
            <Button
              size="small"
              disabled={!mine || !!busy}
              loading={busy === 'full-access'}
              title={t('本次运行改为「完全允许」，后续请求不再询问；下一轮恢复原审批方式')}
              onClick={() => send(`/runs/${run.id}/full-access`, {}, 'full-access')}
            >
              {t('本次运行免审批')}
            </Button>
          )}
          <Button
            size="small"
            disabled={!mine || !!busy || !reject}
            loading={!!reject && busy === reject.optionId}
            onClick={() => reject && decide(reject)}
          >
            {t('拒绝#reject')}
          </Button>
          {others.length > 0 && (
            <Button size="small" disabled={!mine || !!busy} loading={busy === 'all'} onClick={approveAll}>
              {t('全部批准（{n}）', { n: others.length + 1 })}
            </Button>
          )}
          {a.rememberSession.length > 0 && a.rememberSession.join() !== a.remember.join() && (
            <span className="approval__hint">
              {t('本次会话不再问：{rules}', { rules: a.rememberSession.join(t('、')) })}
            </span>
          )}
          {always && (
            <span className="approval__hint">
              {t('不再询问：{rules}', { rules: a.remember.join(t('、')) })}
            </span>
          )}
          <span className="approval__hint">
            {mine
              ? t('你是 Bot 主人')
              : t('仅 Bot 主人 {name} 可操作，你只能查看', { name: bot?.ownerName ?? '' })}
          </span>
        </div>
      ) : (
        <div className="approval__done">
          <Tag tone={DONE[a.status][1]}>{DONE[a.status][0]}</Tag>
          <span>{outcome(a)}</span>
        </div>
      )}
    </div>
  )
}
