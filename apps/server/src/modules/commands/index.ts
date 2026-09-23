import type { Ctx } from '../../context.js'
import { cd } from './cd.js'
import { type CommandInput, commands } from './registry.js'
import { forceSyncOnly, newSession, stopIdle } from './system.js'

commands.register('new', newSession)
commands.register('cd', cd)
commands.register('hold', forceSyncOnly)
commands.register('release', forceSyncOnly)
commands.register('stop', stopIdle)

export { parseCommand } from './parse.js'
export { commands } from './registry.js'

export async function runCommand(ctx: Ctx, input: CommandInput) {
  await commands.get(input.command.name)?.(ctx, input)
}
