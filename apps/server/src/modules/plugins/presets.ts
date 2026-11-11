import type { ProviderPreset } from '@gonggong/protocol'
import { and, asc, eq, ne } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { plugins, pluginVersions } from '../../db/schema.js'

/**
 * Provider presets of the platform-layer plugins (plan 插件扩展点 §6), by name order; a later one with the same
 * (agent, id) replaces an earlier one.
 */
export async function platformPresets(db: Pick<Db, 'select'>): Promise<ProviderPreset[]> {
  const rows = await db
    .select({ manifest: pluginVersions.manifest })
    .from(plugins)
    .innerJoin(pluginVersions, eq(pluginVersions.id, plugins.versionId))
    .where(and(eq(plugins.scope, 'platform'), eq(plugins.type, 'plugin'), ne(plugins.status, 'banned')))
    .orderBy(asc(plugins.name))
  const out = new Map<string, ProviderPreset>()
  for (const r of rows)
    for (const p of r.manifest.contributes?.providers ?? []) out.set(`${p.agent}:${p.id}`, p)
  return [...out.values()]
}

async function sendTo(ctx: Ctx, machineIds: string[]) {
  const to = machineIds.filter((id) => ctx.hub.features(id).includes('presetSync'))
  if (!to.length) return
  const presets = await platformPresets(ctx.db)
  for (const id of to) ctx.hub.send(id, { t: 'presets.sync', presets })
}

/** After a platform plugin changed: every connected daemon gets the presets anew. */
export const broadcastPresets = (ctx: Ctx) => sendTo(ctx, ctx.hub.online())

/** Each daemon gets the presets when it connects. */
export function presetSync(ctx: Ctx) {
  ctx.hub.on('online', (machineId) => {
    void sendTo(ctx, [machineId]).catch((e) => console.warn('presets.sync failed:', e))
  })
}
