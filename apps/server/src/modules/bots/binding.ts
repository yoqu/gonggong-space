import type { Ctx } from '../../context.js'
import type { machines } from '../../db/schema.js'

/**
 * Called by the machines module after a daemon binds a new machine. Binds the owner's `pending_bind` bots
 * whose agent kind the machine reports. Owned by the bot-lifecycle slice.
 */
export async function onMachineBound(_ctx: Ctx, _machine: typeof machines.$inferSelect): Promise<void> {}
