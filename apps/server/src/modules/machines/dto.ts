import type { AgentInfo, MachineDto } from '@aiws/protocol'
import type { Ctx } from '../../context.js'
import type { machines } from '../../db/schema.js'

export const toMachineDto = (ctx: Ctx, m: typeof machines.$inferSelect): MachineDto => ({
  id: m.id,
  ownerId: m.ownerId,
  name: m.name,
  os: m.os as MachineDto['os'],
  arch: m.arch,
  online: ctx.hub.isOnline(m.id),
  agents: m.agents as AgentInfo[],
  daemonVersion: m.daemonVersion,
  lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
})
