import { randomUUID } from 'node:crypto'
import {
  AnswerActionsReq,
  type ArtifactContext,
  type BranchMessageRes,
  EditMessageReq,
  parseMentions,
  SendMessageReq,
  type TimelineDto,
  TimelineQuery,
} from '@gonggong/protocol'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, messages, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { artifactContextNote } from '../artifacts/commands.js'
import { requireArtifact } from '../artifacts/service.js'
import { claimAttachments } from '../attachments/service.js'
import { requireUser } from '../auth/session.js'
import { checkPicks } from '../bots/config.js'
import { agentCommand, commands, parseCommand, runCommand } from '../commands/index.js'
import { mirrorEdit, mirrorUserMessage } from '../feishu/mirror.js'
import { activeBots, requireMember, requireReader } from '../groups/service.js'
import { reactionsFor } from '../reactions/service.js'
import { listRuns } from '../runs/dto.js'
import { triggerRuns } from '../runs/trigger.js'
import { answerActions } from './actions.js'
import { appendTarget, sendAppend } from './append.js'
import { branchMessage } from './branch.js'
import { editMessage } from './edit.js'
import { memberMentions, notifyMentions } from './mentions.js'
import { resolveQuote } from './quote.js'
import { hideMessage, notHiddenBy, recallMessage } from './recall.js'
import { type MessageMeta, type MessageRow, messageDto, publishMessage } from './service.js'

/** The artifact a composer message is about, in this group, with the selection as the agent reads it. */
async function canvasContext(ctx: Ctx, groupId: string, userId: string, c: ArtifactContext) {
  const a = await requireArtifact(ctx, c.artifactId, userId)
  if (a.groupId !== groupId) return fail('not_found', '产物不存在')
  return { id: a.id, botId: a.botId, note: await artifactContextNote(ctx, a, c) }
}

export function messageRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get<{ Params: { id: string } }>('/api/groups/:id/timeline', async (req): Promise<TimelineDto> => {
      const me = await requireUser(ctx, req)
      await requireReader(ctx, req.params.id, me.id)
      const { before, limit } = TimelineQuery.parse(req.query)
      const rows = await ctx.db
        .select({ m: messages, userName: users.name, botName: bots.name })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorUserId))
        .leftJoin(bots, eq(bots.id, messages.authorBotId))
        .where(
          and(
            eq(messages.groupId, req.params.id),
            before ? lt(messages.seq, before) : undefined,
            notHiddenBy(ctx, me.id),
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(limit)
      const reactions = await reactionsFor(
        ctx,
        rows.map((r) => r.m.id),
        me.id,
      )
      const page = rows
        .reverse()
        .map((r) => messageDto(r.m, r.userName ?? r.botName ?? '', reactions.get(r.m.id)))
      return {
        messages: page,
        runs: await listRuns(
          ctx,
          req.params.id,
          page.map((m) => m.id),
          !before,
        ),
      }
    })

    app.post<{ Params: { id: string } }>('/api/groups/:id/messages', async (req) => {
      const me = await requireUser(ctx, req)
      const { group } = await requireMember(ctx, req.params.id, me.id)
      const { body, clientId, attachmentIds, quote, appendTo, runOptions, artifactContext } =
        SendMessageReq.parse(req.body)
      if (!body.trim() && !attachmentIds.length) return fail('invalid', '消息不能为空')
      const bots = activeBots(ctx, group.id).execute()
      const canvas = artifactContext ? await canvasContext(ctx, group.id, me.id, artifactContext) : null
      const [target, inGroup, quoted, userMentions] = await Promise.all([
        appendTo ? appendTarget(ctx, group.id, me.id, appendTo) : null,
        bots,
        quote ? resolveQuote(ctx, group.id, quote) : null,
        memberMentions(ctx, group.id, body, { bots }),
      ])
      const explicit = parseMentions(body, inGroup)
      // A dm with a single bot needs no @: plain messages and commands are addressed to it.
      const soleDmBot = group.kind === 'dm' && inGroup.length === 1 && !target ? inGroup[0] : undefined
      const parsed = parseCommand(body, inGroup)
      const addressed = parsed && (!parsed.mentions.length && soleDmBot ? [soleDmBot.id] : parsed.mentions)
      const command =
        parsed && addressed && commands.get(parsed.name) ? { ...parsed, mentions: addressed } : null
      const agent =
        parsed && addressed && !command && !target
          ? await agentCommand(ctx, group.id, parsed, addressed, inGroup)
          : null
      // A plain message sent with the canvas selected goes to the artifact's bot, as if it were @-ed.
      const canvasBot = canvas && !parsed && !target ? inGroup.find((b) => b.id === canvas.botId) : undefined
      const fallback = soleDmBot ?? canvasBot
      const mentions = agent?.botIds ?? (!explicit.length && fallback ? [fallback.id] : explicit)
      const picks = await checkPicks(ctx, me, group.id, runOptions, target || command ? [] : mentions)

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
        const id = randomUUID()
        const files = await claimAttachments(tx, attachmentIds, {
          uploaderId: me.id,
          groupId: group.id,
          messageId: id,
        })
        const meta: MessageMeta = {
          mentions,
          ...(userMentions.length > 0 && { userMentions }),
          clientId,
          ...(command && !target && { command: command.name }),
          // `command` also keeps it out of later group context.
          ...(agent && { command: parsed?.name, agentCommand: agent.text }),
          ...(target && { appendTo: target.runId }),
          ...(Object.keys(picks).length > 0 && { runOptions: picks }),
          ...(canvas && { artifactRefs: [canvas.id], artifactNote: canvas.note }),
        }
        if (files.length) meta.attachments = files
        if (quoted) meta.quote = quoted
        const [inserted] = (await tx
          .insert(messages)
          .values({ id, groupId: group.id, kind: 'user', authorUserId: me.id, body, meta })
          .returning()) as [MessageRow]
        return { row: inserted, created: true }
      })

      const dto = messageDto(row, me.name)
      if (created) {
        await publishMessage(ctx, dto)
        await notifyMentions(ctx, row, me.name)
        if (target) await sendAppend(ctx, target, dto)
        else if (command) await runCommand(ctx, { group, user: me, message: row, command, bots: inGroup })
        else if (mentions.length) {
          await mirrorUserMessage(ctx, row, me)
          await triggerRuns(ctx, row)
        } else if (userMentions.some((id) => id !== me.id)) await mirrorUserMessage(ctx, row, me)
      }
      return dto
    })

    app.post<{ Params: { id: string } }>(
      '/api/messages/:id/branch',
      async (req): Promise<BranchMessageRes> => ({
        groupId: await branchMessage(ctx, await requireUser(ctx, req), req.params.id),
      }),
    )

    app.post<{ Params: { id: string } }>('/api/messages/:id/actions', async (req) =>
      answerActions(ctx, await requireUser(ctx, req), req.params.id, AnswerActionsReq.parse(req.body)),
    )

    app.post<{ Params: { id: string } }>('/api/messages/:id/recall', async (req) =>
      recallMessage(ctx, await requireUser(ctx, req), req.params.id),
    )

    app.patch<{ Params: { id: string } }>('/api/messages/:id', async (req) => {
      const me = await requireUser(ctx, req)
      const dto = await editMessage(ctx, me, req.params.id, EditMessageReq.parse(req.body).body)
      await mirrorEdit(ctx, dto, me.name)
      return dto
    })

    app.post<{ Params: { id: string } }>('/api/messages/:id/hide', async (req, reply) => {
      await hideMessage(ctx, (await requireUser(ctx, req)).id, req.params.id)
      return reply.status(204).send()
    })
  }
}
