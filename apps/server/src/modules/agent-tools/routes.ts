import { AIWS_TOOLS, type AiwsToolName, ToolCallReq, type ToolCallRes } from '@aiws/protocol'
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { requireMachine } from '../../daemon/auth.js'
import { bots, runs } from '../../db/schema.js'
import { audit } from '../../lib/audit.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { callTool, refuse, ToolError } from './service.js'

const LIVE = ['running', 'awaiting_approval', 'awaiting_answer']
const TEXT_MAX = 32_000

/** aiws MCP tools answered for the daemon during a live run (plan C5): the run decides the bot and its groups. */
export function agentToolRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { runId: string; name: string } }>(
      '/api/daemon/runs/:runId/tools/:name',
      async (req): Promise<ToolCallRes> => {
        const machine = await requireMachine(ctx, req)
        const runId = idParam(req.params.runId, '运行')
        const name = req.params.name
        if (!Object.hasOwn(AIWS_TOOLS, name)) return fail('not_found', `工具 ${name} 不存在`)
        const [row] = await ctx.db
          .select({ run: runs })
          .from(runs)
          .innerJoin(bots, eq(bots.id, runs.botId))
          .where(and(eq(runs.id, runId), eq(bots.machineId, machine.id)))
        if (!row) return fail('not_found', '运行不存在')
        const { run } = row
        try {
          if (!LIVE.includes(run.status)) refuse('当前不在运行中，无法查询')
          const out = await callTool(
            ctx,
            run,
            name as AiwsToolName,
            ToolCallReq.parse(req.body ?? {}).arguments,
          )
          const others = out.groups.filter((g) => g !== run.groupId)
          if (others.length)
            await audit(ctx, {
              category: 'run',
              action: 'tool.cross_group_read',
              groupId: run.groupId,
              detail: { runId: run.id, tool: name, groups: others },
            })
          const text =
            out.text.length > TEXT_MAX
              ? `${out.text.slice(0, TEXT_MAX)}\n…（结果过长已截断，请缩小范围）`
              : out.text
          return { text, isError: false, attachments: out.attachments ?? [] }
        } catch (e) {
          if (e instanceof ToolError) return { text: e.message, isError: true, attachments: [] }
          throw e
        }
      },
    )
  }
}
