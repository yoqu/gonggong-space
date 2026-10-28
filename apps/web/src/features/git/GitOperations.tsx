import type { GitOperationDto } from '@gonggong/protocol'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkbench } from '../../app/workbench'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { ago } from '../../lib/time'
import { Icon, Tooltip } from '../../ui'
import { openTab } from '../workbench/open'
import { decideGitOperation } from './api'
import { ACTION_LABEL } from './notify'
import './git.css'

const NO_OPS: GitOperationDto[] = []

/** The bot's Git tab, where its requests wait for approval (a notification link). */
export const openGitPanel = (botId: string) => openTab({ kind: 'git', botId, view: 'commit' })

export const useGitOps = (groupId: string) => useWorkspace((s) => s.gitOps[groupId] ?? NO_OPS)

/** 待审批 N on a bot in the bar; opens its operation log. */
export function PendingBadge({ groupId, botId }: { groupId: string; botId: string }) {
  const ops = useGitOps(groupId)
  const n = ops.filter((o) => o.botId === botId && o.status === 'pending_approval').length
  if (!n) return null
  return (
    <button type="button" className="git-bar__pending" onClick={() => openGitPanel(botId)}>
      {t('待审批 {n}', { n })}
    </button>
  )
}

function Row({ op, owner }: { op: GitOperationDto; owner: boolean }) {
  const [busy, setBusy] = useState(false)
  const decide = async (approve: boolean) => {
    setBusy(true)
    await decideGitOperation(op.id, approve)
    setBusy(false)
  }
  const target = op.action === 'push' ? `${op.remote ?? 'origin'}/${op.branch ?? ''}` : op.branch
  const files = op.paths?.length ? t('{n} 个文件', { n: op.paths.length }) : null
  return (
    <li className="git-op" data-testid={`git-op-${op.id}`} data-base={op.pushesBase || undefined}>
      <Icon name={op.pushesBase ? 'warning' : 'clock'} size={13} />
      <span className="git-op__action">{ACTION_LABEL[op.action]}</span>
      {[op.repo, target].filter(Boolean).map((x) => (
        <span key={x} className="git-op__mono">
          {x}
        </span>
      ))}
      <span className="git-op__meta" title={[op.message, files].filter(Boolean).join('\n') || undefined}>
        {op.requestedBy.name} · {ago(op.createdAt)}
      </span>
      <span className="spacer" />
      {owner ? (
        <>
          <Tooltip content={t('拒绝')}>
            <button
              type="button"
              className="gc-tool"
              aria-label={t('拒绝')}
              disabled={busy}
              onClick={() => void decide(false)}
            >
              <Icon name="xmark" size={13} />
            </button>
          </Tooltip>
          <Tooltip content={op.pushesBase ? t('批准即确认推送基准分支') : t('批准')}>
            <button
              type="button"
              className="gc-tool git-op__approve"
              aria-label={t('批准')}
              disabled={busy}
              onClick={() => void decide(true)}
            >
              <Icon name="check" size={13} />
            </button>
          </Tooltip>
        </>
      ) : (
        <span className="git-op__wait">{t('待审批')}</span>
      )}
    </li>
  )
}

/** A bot's requests waiting for approval, atop its Git tab: the owner approves or rejects, others wait. */
export function PendingOps({ groupId, botId }: { groupId: string; botId: string }) {
  const ops = useGitOps(groupId)
  const owner = useWorkspace((s) => s.bots.find((b) => b.id === botId)?.ownerId)
  const me = useSession((s) => s.user?.id)
  const pending = ops.filter((o) => o.botId === botId && o.status === 'pending_approval')
  if (!pending.length) return null
  return (
    <ul className="git-ops" aria-label={t('待审批')}>
      {pending.map((o) => (
        <Row key={o.id} op={o} owner={!!me && owner === me} />
      ))}
    </ul>
  )
}

/** `?git=<operationId>` (a git request notification) opens that bot's Git tab once loaded, then leaves the URL. */
export function LinkedGitOperation({ groupId }: { groupId: string }) {
  const [params, setParams] = useSearchParams()
  const linked = params.get('git')
  const op = useWorkspace((s) => (linked ? s.gitOps[groupId]?.find((o) => o.id === linked) : undefined))
  const loaded = useWorkspace((s) => !!s.gitOps[groupId])
  // Tabs belong to the workbench's group: wait until it has switched to this one.
  const bench = useWorkbench((s) => s.groupId)
  useEffect(() => {
    if (!linked || !loaded || bench !== groupId) return
    if (op) openGitPanel(op.botId)
    setParams(
      (p) => {
        p.delete('git')
        return p
      },
      { replace: true },
    )
  }, [linked, loaded, op, groupId, bench, setParams])
  return null
}
