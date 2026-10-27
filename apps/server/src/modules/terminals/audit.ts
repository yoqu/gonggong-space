import type { TerminalDto } from '@gonggong/protocol'
import type { Ctx } from '../../context.js'
import { audit } from '../../lib/audit.js'

export type TerminalAuditEvent = {
  actorUserId: string | null
  machineId: string
  groupId: string
  botId: string
  sessionId: string
  action: 'create' | 'attach' | 'detach' | 'exit' | 'terminate' | 'revoke'
  workspace: { repo: string | null; cdPath: string | null }
  status: TerminalDto['status']
  reason: TerminalDto['reason']
}

/** Only session metadata crosses this boundary; PTY input and output have no audit representation. */
export async function auditTerminal(ctx: Ctx, event: TerminalAuditEvent) {
  await audit(ctx, {
    category: 'terminal',
    actorUserId: event.actorUserId,
    groupId: event.groupId,
    action: `session.${event.action}`,
    detail: {
      machineId: event.machineId,
      botId: event.botId,
      sessionId: event.sessionId,
      workspace: { repo: event.workspace.repo, cdPath: event.workspace.cdPath },
      lifecycle: { status: event.status, reason: event.reason },
    },
  })
}
