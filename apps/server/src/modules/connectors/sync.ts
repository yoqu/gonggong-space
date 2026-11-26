import type { ConnectorSpec, PluginManifest } from '@gonggong/protocol'
import { and, eq, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { bots, groupBots, groups } from '../../db/schema.js'
import { groupTitle, translateGroupTitle } from '../groups/title.js'
import { groupPluginLists, pluginsOn } from '../plugins/service.js'
import { syncChanged } from './state.js'

type Read = Pick<Db, 'select'>

/** A connector plugin's CLI spec, when the daemon drives its CLI (`manifest.connector.cli`). */
export const cliSpec = (name: string, m: PluginManifest): ConnectorSpec | null =>
  m.category === 'connector' && m.connector?.cli
    ? { connector: name, driver: m.connector.cli.driver, npm: m.connector.cli.npm }
    : null

/** The CLI connectors enabled in any group where the machine's bots run, with a title and one such group each. */
export async function machineConnectors(db: Read, machineId: string) {
  if (!(await pluginsOn(db))) return []
  const rows = await db
    .select({ groupId: groupBots.groupId, title: groupTitle })
    .from(groupBots)
    .innerJoin(bots, eq(bots.id, groupBots.botId))
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(and(eq(bots.machineId, machineId), isNull(bots.deletedAt)))
  const groupNames = new Map(rows.map((r) => [r.groupId, translateGroupTitle(r.title)]))
  const lists = await groupPluginLists(db, [...groupNames.keys()])
  const found = new Map<
    string,
    { spec: ConnectorSpec; title: string; pluginId: string; groupId: string; groupName: string }
  >()
  for (const [groupId, list] of lists)
    for (const r of list) {
      const spec = r.enabledInGroup ? cliSpec(r.plugin.name, r.version.manifest) : null
      if (spec && !found.has(spec.connector))
        found.set(spec.connector, {
          spec,
          title: r.version.manifest.title,
          pluginId: r.plugin.id,
          groupId,
          groupName: groupNames.get(groupId) ?? '',
        })
    }
  return [...found.values()].sort((a, b) => a.spec.connector.localeCompare(b.spec.connector))
}

/** connectors.sync to a daemon with `connectors`, when what it should watch changed since it was last told. */
export async function syncConnectors(ctx: Ctx, machineId: string) {
  if (!ctx.hub.features(machineId).includes('connectors')) return
  const connectors = (await machineConnectors(ctx.db, machineId)).map((c) => c.spec)
  if (syncChanged(ctx, machineId, JSON.stringify(connectors)))
    ctx.hub.send(machineId, { t: 'connectors.sync', connectors })
}

/** After plugins changed anywhere: every online daemon with `connectors` (each only told of a change). */
export async function resyncConnectors(ctx: Ctx) {
  for (const machineId of ctx.hub.online()) await syncConnectors(ctx, machineId)
}
