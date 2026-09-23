import { SendMessageReq, type TimelineDto, TimelineQuery } from '@aiws/protocol'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, messages, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { requireUser } from '../auth/session.js'
import { commands, parseCommand, runCommand } from '../commands/index.js'
import { activeBots, requireMember } from '../groups/service.js'
import { listRuns } from '../runs/dto.js'
import { triggerRuns } from '../runs/trigger.js'
import { parseMentions } from './mentions.js'
import { type MessageRow, messageDto, publishMessage } from './service.js'

export function messageRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/groups/:id/timeline', async (req): Promise<TimelineDto> => {
      const me = await requireUser(ctx, req)
      await requireMember(ctx, req.params.id, me.id)
      const { before, limit } = TimelineQuery.parse(req.query)
      const rows = await ctx.db
        .select({ m: messages, userName: users.name, botName: bots.name })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorUserId))
        .leftJoin(bots, eq(bots.id, messages.authorBotId))
        .where(and(eq(messages.groupId, req.params.id), before ? lt(messages.seq, before) : undefined))
        .orderBy(desc(messages.seq))
        .limit(limit)
      const page = rows.reverse().map((r) => messageDto(r.m, r.userName ?? r.botName ?? ''))
      return {
        messages: page,
        runs: await listRuns(
          ctx,
          req.params.id,
          page.map((m) => m.id),
        ),
      }
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/messages', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const { body, clientId } = SendMessageReq.parse(req.body)
      if (!body.trim()) return fail('invalid', '消息不能为空')
      const inGroup = await activeBots(ctx, group.id)
      const mentions = parseMentions(body, inGroup)
      const parsed = parseCommand(body, inGroup)
      const command = parsed && commands.get(parsed.name) ? parsed : null

      // The advisory lock serializes retries/double-clicks carrying the same clientId.
      const { row, created } = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${group.id}:${me.id}:${clientId}`}))`)
        const [existing] = await tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.groupId, group.id),
              eq(messages.authorUserId, me.id),
              sql`${messages.meta}->>'clientId' = ${clientId}`,
            ),
          )
        if (existing) return { row: existing, created: false }
        const [inserted] = (await tx
          .insert(messages)
          .values({
            groupId: group.id,
            kind: 'user',
            authorUserId: me.id,
            body,
            meta: { mentions, clientId, ...(command && { command: command.name }) },
          })
          .returning()) as [MessageRow]
        return { row: inserted, created: true }
      })

      const dto = messageDto(row, me.name)
      if (created) {
        await publishMessage(ctx, dto)
        if (command) await runCommand(ctx, { group, user: me, message: row, command, bots: inGroup })
        else if (mentions.length) await triggerRuns(ctx, row)
      }
      return dto
    })
  }
}
