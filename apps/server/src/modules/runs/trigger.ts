import type { Ctx } from '../../context.js'
import type { messages } from '../../db/schema.js'

/**
 * Called by the chat module right after a user message is stored. Creates one run per mentioned bot
 * (message.meta.mentions) and dispatches it. Owned by the run-engine slice.
 */
export async function triggerRuns(_ctx: Ctx, _message: typeof messages.$inferSelect): Promise<void> {}
