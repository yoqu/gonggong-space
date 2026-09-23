import type { Ctx } from '../../context.js'
import type { groups } from '../../db/schema.js'
import type { activeBots } from '../groups/service.js'
import type { MessageRow } from '../messages/service.js'
import type { ParsedCommand } from './parse.js'

export interface CommandInput {
  group: typeof groups.$inferSelect
  user: { id: string; name: string }
  /** The stored command message. */
  message: MessageRow
  command: ParsedCommand
  /** Bots currently in the group, in join order. */
  bots: Awaited<ReturnType<typeof activeBots>>
}

/** Posts its feedback as group events; must not trigger runs. */
export type CommandHandler = (ctx: Ctx, input: CommandInput) => Promise<void>

const handlers = new Map<string, CommandHandler>()

/** System commands (spec §8.7): reserved names that take precedence over agent / skill commands. */
export const commands = {
  register: (name: string, handler: CommandHandler) => void handlers.set(name, handler),
  get: (name: string) => handlers.get(name),
}
