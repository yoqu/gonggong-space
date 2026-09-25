import type { Ctx } from '../../context.js'
import { cd } from './cd.js'
import { type CommandInput, commands } from './registry.js'
import { stop } from './stop.js'
import { forceSyncOnly, newSession } from './system.js'

commands.register('stop', stop, '停止运行（未 @ Bot 时停止本群全部）')
commands.register('hold', forceSyncOnly, '连续占用群锁')
commands.register('release', forceSyncOnly, '释放群锁')
commands.register('new', newSession, '开新会话')
commands.register('cd', cd, '绑定本机目录（仅分区）')

export { parseCommand } from './parse.js'
export { commands } from './registry.js'

export async function runCommand(ctx: Ctx, input: CommandInput) {
  await commands.get(input.command.name)?.(ctx, input)
}
