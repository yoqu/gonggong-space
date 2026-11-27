import { agentMeta, type RunDto } from '@gonggong/protocol'
import { useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router'
import { useSession } from '../../app/session'
import { useWorkspace } from '../../app/workspace'
import { t } from '../../i18n'
import { api } from '../../lib/api'
import { attempt } from '../../lib/errors'
import { Button, Icon, Presence, toast } from '../../ui'
import { webLoginDriver } from '../agents/webSource'
import { AgentLoginDialog } from '../machines/AgentLoginDialog'
import { isAuthRunError } from './issue'
import './runs.css'

/** True when a failed/interrupted run failed specifically due to missing or expired agent auth. */
export function isRunAuthError(run: RunDto): boolean {
  return (run.status === 'interrupted' || run.status === 'expired') && !run.stoppedBy && isAuthRunError(run)
}

function NavButton({
  to,
  label,
  variant = 'default',
}: {
  to: string
  label: string
  variant?: 'default' | 'primary'
}) {
  const inRouter = useInRouterContext()
  return inRouter ? (
    <RouterNavButton to={to} label={label} variant={variant} />
  ) : (
    <Button
      size="small"
      variant={variant}
      onClick={() => {
        window.location.assign(to)
      }}
    >
      {label}
    </Button>
  )
}

function RouterNavButton({
  to,
  label,
  variant,
}: {
  to: string
  label: string
  variant: 'default' | 'primary'
}) {
  const navigate = useNavigate()
  return (
    <Button size="small" variant={variant} onClick={() => navigate(to)}>
      {label}
    </Button>
  )
}

/**
 * Auth recovery controls shared by Chat RunCard and RunTab IssueBanner:
 * - Bot/machine owner: in-place login dialog, Configure API Key link, and one-click Rerun (highlighted right after login).
 * - Other group members: clear muted note naming the computer owner.
 */
export function AuthErrorActions({
  run,
  agentLabel,
  onRetry,
  hideDefaultRetry = false,
}: {
  run: RunDto
  agentLabel?: string
  onRetry?: () => Promise<boolean>
  /** IssueBanner already renders a header 重新运行 button; keep only 立即重新运行 after login succeeds. */
  hideDefaultRetry?: boolean
}) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const machine = useWorkspace((s) =>
    bot?.machineId ? s.machines.find((m) => m.id === bot.machineId) : undefined,
  )
  const me = useSession((s) => s.user?.id)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const agentKind = bot?.agentKind
  const agentName = agentKind ? agentMeta(agentKind).name : agentLabel || 'Agent'
  const isOwner = !!me && (me === bot?.ownerId || me === machine?.ownerId)
  const canRetry =
    !!onRetry ||
    (run.hop === 1 &&
      (run.status === 'interrupted' || run.status === 'expired') &&
      !!me &&
      (me === run.originUserId || me === bot?.ownerId))

  const doRetry = async () => {
    setRetrying(true)
    const ok = onRetry
      ? await onRetry()
      : await attempt(async () => {
          await api.post(`/runs/${run.id}/retry`)
          toast({ type: 'success', message: t('已重新运行，新的运行卡片会出现在群里') })
        })
    if (!ok) setRetrying(false)
  }

  if (!isOwner) {
    return (
      <div className="run-auth__hint">
        {t('请等待电脑主人 {owner} 登录 {agent} 后重试', {
          owner: bot?.ownerName ?? t('电脑主人'),
          agent: agentName,
        })}
      </div>
    )
  }

  const machineId = machine?.id ?? bot?.machineId
  const agentState = agentKind ? machine?.agents.find((a) => a.kind === agentKind) : undefined
  const providersUrl = machineId ? `/machine/${machineId}?tab=agents` : null
  const loginUrl = machineId && agentKind ? `/machine/${machineId}?tab=agents&login=${agentKind}` : null

  return (
    <>
      {loggedIn ? (
        <div className="run-auth__ready">
          <span className="run-auth__ready-text">
            <Icon name="checkmark-circle" size={14} className="ui-check-pop" />
            {t('{agent} 已登录', { agent: agentName })}
          </span>
          {canRetry ? (
            <Button
              size="small"
              variant="primary"
              icon="arrow-clockwise"
              loading={retrying}
              disabled={retrying}
              onClick={() => void doRetry()}
            >
              {t('立即重新运行')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="run-auth__actions">
          {machine && agentKind ? (
            <Button size="small" variant="primary" onClick={() => setLoginOpen(true)}>
              {t('去登录 {agent}', { agent: agentName })}
            </Button>
          ) : loginUrl ? (
            <NavButton to={loginUrl} label={t('去登录 {agent}', { agent: agentName })} variant="primary" />
          ) : null}
          {providersUrl ? <NavButton to={providersUrl} label={t('配置 API Key')} /> : null}
          {canRetry && !hideDefaultRetry ? (
            <Button
              size="small"
              icon="arrow-clockwise"
              loading={retrying}
              disabled={retrying}
              onClick={() => void doRetry()}
            >
              {t('重新运行')}
            </Button>
          ) : null}
        </div>
      )}
      <Presence>
        {loginOpen && machine && agentKind ? (
          <AgentLoginDialog
            machine={machine}
            agent={agentKind}
            agentState={agentState}
            loginDriver={webLoginDriver(machine)}
            onClose={() => setLoginOpen(false)}
            onLoggedIn={() => setLoggedIn(true)}
            onAddProvider={providersUrl ? () => window.location.assign(providersUrl) : undefined}
          />
        ) : null}
      </Presence>
    </>
  )
}

/** Friendly inline auth-error card section rendered on Chat RunCard in place of raw JSON auth errors. */
export function AuthErrorBlock({ run, agentLabel }: { run: RunDto; agentLabel?: string }) {
  const bot = useWorkspace((s) => s.bots.find((b) => b.id === run.botId))
  const agentName = bot?.agentKind ? agentMeta(bot.agentKind).name : agentLabel || 'Agent'
  return (
    <div className="run-auth" role="alert">
      <div className="run-auth__head">
        <Icon name="exclamation-circle" size={14} />
        <span>{t('{agent} 尚未登录或登录已过期', { agent: agentName })}</span>
      </div>
      <AuthErrorActions run={run} agentLabel={agentName} />
    </div>
  )
}
