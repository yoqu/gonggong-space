import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupBots } from '../../db/schema.js'
import type { ParsedCommand } from './parse.js'

/** The `/bot名:命令` prefix of an agent command whose name a system command took. */
export const commandPrefix = (botName: string) => botName.replace(/\s+/g, '')

/**
 * An agent command (spec §8.7) for bots that all reported it over ACP: sent to them verbatim so the adapter runs it
 * (a composed prompt would only quote it). Null → a normal message, e.g. `/path/to/file @bot 看下`.
 */
export async function agentCommand(
  ctx: Ctx,
  groupId: string,
  command: ParsedCommand,
  mentions: string[],
  bots: { id: string; name: string }[],
): Promise<{ text: string; botIds: string[] } | null> {
  const rows = await ctx.db
    .select({ botId: groupBots.botId, commands: groupBots.agentCommands })
    .from(groupBots)
    .where(
      and(
        eq(groupBots.groupId, groupId),
        inArray(
          groupBots.botId,
          bots.map((b) => b.id),
        ),
      ),
    )
  const has = (botId: string, name: string) =>
    rows.some((r) => r.botId === botId && (r.commands as { name: string }[]).some((c) => c.name === name))
  const resolve = (): [string, string[]] | null => {
    if (mentions.length && mentions.every((id) => has(id, command.name))) return [command.name, mentions]
    const i = command.name.indexOf(':')
    const name = command.name.slice(i + 1)
    const owner = bots.find((b) => i > 0 && commandPrefix(b.name) === command.name.slice(0, i))
    return owner && has(owner.id, name) ? [name, [owner.id]] : null
  }
  const hit = resolve()
  return hit && { text: [`/${hit[0]}`, command.args].filter(Boolean).join(' '), botIds: hit[1] }
}
