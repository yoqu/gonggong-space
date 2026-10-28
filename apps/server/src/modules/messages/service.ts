import type {
  ActionAnswer,
  Attachment,
  HtmlRenderRef,
  I18nParams,
  I18nText,
  McpSecretCard,
  MessageCard,
  MessageDto,
  ProgressCard,
  ProtocolKey,
  ReactionDto,
  RunConfigPick,
  SecretCard,
  SyncDecision,
} from '@gonggong/protocol'
import { eq, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, messages, users } from '../../db/schema.js'
import { zh } from '../../i18n/index.js'

export type MessageRow = typeof messages.$inferSelect
/**
 * `command`: the system command this message invoked (never replayed to agents as context).
 * `appendTo`: the run it was 打断并追加 into (it triggers nothing itself).
 * `relayOf`: `<parent run id>:<hand-off index>` of the relay message that started a next hop.
 */
export type MessageMeta = {
  mentions?: string[]
  /** Came in from the bound Feishu chat; `name` is the sender's Feishu name when they have no 共工 author. */
  feishu?: { name?: string }
  /** Members it @s (被 @ notifications). */
  userMentions?: string[]
  clientId?: string
  command?: string
  /** An agent command sent verbatim to the mentioned bots (RunStart.command). */
  agentCommand?: string
  appendTo?: string
  relayOf?: string
  attachments?: Attachment[]
  quote?: MessageDto['quote']
  /** One-shot model / thought level by triggered bot id. */
  runOptions?: Record<string, RunConfigPick>
  /** Preview card (plan 结果预览): the preview id. */
  preview?: string
  /** Scheduled task card (plan 定时任务): the schedule id. */
  schedule?: string
  /** Posted by this scheduled task when it fired. */
  scheduleOf?: string
  i18n?: I18nText
  /** A force-sync conflict card (F11). */
  syncConflict?: { id: string; botId: string }
  /** The merge turn settling this held conflict with these decisions (交给 Bot 合并). */
  syncResolve?: { conflictId: string; decisions: SyncDecision[] }
  /** Legacy 填写密钥 card for an MCP server (read-only now). */
  mcpSecret?: McpSecretCard
  /** A bot's 填写密钥 card (secret_request). */
  secretCard?: SecretCard
  /** A bot's progress card (progress_card). */
  progress?: ProgressCard
  /** Generic card (plan 插件体系), e.g. a creation request. */
  card?: MessageCard
  /** A bot reply's answered ```actions blocks, by block id (plan 富交互消息). */
  actions?: Record<string, ActionAnswer>
  /** Legacy: a page published with html_render as its own message. */
  htmlRender?: HtmlRenderRef
  /** A final reply's pages its run published with html_render. */
  htmlRenders?: HtmlRenderRef[]
}

/** A user message's author name, a Feishu sender's when they have no 共工 account; needs `users` left-joined. */
export const userAuthorName = sql<string | null>`coalesce(${users.name}, ${messages.meta}->'feishu'->>'name')`

/** A recalled message keeps only its envelope (its body, attachments and quote are already erased). */
export const messageDto = (m: MessageRow, authorName: string, reactions: ReactionDto[] = []): MessageDto => {
  const recalled = m.recalledAt !== null
  return {
    id: m.id,
    seq: m.seq,
    groupId: m.groupId,
    kind: m.kind as MessageDto['kind'],
    authorId: m.authorUserId ?? m.authorBotId,
    authorName: authorName || ((m.meta as MessageMeta).feishu?.name ?? ''),
    body: m.body,
    mentions: recalled ? [] : ((m.meta as MessageMeta).mentions ?? []),
    userMentions: recalled ? [] : ((m.meta as MessageMeta).userMentions ?? []),
    runId: m.runId,
    createdAt: m.createdAt.toISOString(),
    attachments: (m.meta as MessageMeta).attachments ?? [],
    quote: (m.meta as MessageMeta).quote ?? null,
    reactions: recalled ? [] : reactions,
    recalled,
    editedAt: m.editedAt?.toISOString() ?? null,
    ...((m.meta as MessageMeta).feishu && { fromFeishu: true }),
    ...((m.meta as MessageMeta).preview && { previewId: (m.meta as MessageMeta).preview }),
    ...((m.meta as MessageMeta).schedule && { scheduleId: (m.meta as MessageMeta).schedule }),
    ...((m.meta as MessageMeta).scheduleOf && { scheduledBy: (m.meta as MessageMeta).scheduleOf }),
    ...((m.meta as MessageMeta).i18n && { i18n: (m.meta as MessageMeta).i18n }),
    ...((m.meta as MessageMeta).syncConflict && { syncConflict: (m.meta as MessageMeta).syncConflict }),
    ...((m.meta as MessageMeta).mcpSecret && { mcpSecret: (m.meta as MessageMeta).mcpSecret }),
    ...((m.meta as MessageMeta).secretCard && { secretCard: (m.meta as MessageMeta).secretCard }),
    ...((m.meta as MessageMeta).progress && { progress: (m.meta as MessageMeta).progress }),
    ...((m.meta as MessageMeta).card && { card: (m.meta as MessageMeta).card }),
    ...((m.meta as MessageMeta).actions && { actions: (m.meta as MessageMeta).actions }),
    ...((m.meta as MessageMeta).htmlRender && { htmlRender: (m.meta as MessageMeta).htmlRender }),
    ...((m.meta as MessageMeta).htmlRenders && { htmlRenders: (m.meta as MessageMeta).htmlRenders }),
  }
}

export async function authorName(ctx: Ctx, m: Pick<MessageRow, 'authorUserId' | 'authorBotId'>) {
  if (m.authorUserId) {
    const [u] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, m.authorUserId))
    return u?.name ?? ''
  }
  if (m.authorBotId) {
    const [b] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, m.authorBotId))
    return b?.name ?? ''
  }
  return ''
}

/**
 * Member ids by group, read on every publish (each streamed chunk included). The server is one process, so the
 * cache stays exact as long as every write adding or removing a member calls `forgetMembers` after it committed.
 */
const members = new Map<string, Promise<string[]>>()

export function memberIds(ctx: Ctx, groupId: string) {
  let ids = members.get(groupId)
  if (!ids) {
    ids = ctx.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .then((rows) => rows.map((r) => r.userId))
    members.set(groupId, ids)
    ids.catch(() => members.get(groupId) === ids && members.delete(groupId))
  }
  return ids
}

export function forgetMembers(groupId: string) {
  members.delete(groupId)
}

export async function publishMessage(ctx: Ctx, dto: MessageDto) {
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.new', message: dto })
}

/** Stores a message and pushes it to every member. Used for events and bot replies. */
export async function postMessage(ctx: Ctx, values: typeof messages.$inferInsert) {
  const row = (await ctx.db.insert(messages).values(values).returning())[0] as MessageRow
  const dto = messageDto(row, await authorName(ctx, row))
  await publishMessage(ctx, dto)
  return dto
}

/** Stored in Chinese for search and agent context; clients render `i18n` in their own language. */
export const postEvent = (
  ctx: Ctx,
  groupId: string,
  key: ProtocolKey,
  params?: I18nParams,
  meta: Omit<MessageMeta, 'i18n'> = {},
) =>
  postMessage(ctx, {
    groupId,
    kind: 'event',
    body: zh(key, params),
    meta: { ...meta, i18n: { key, params } },
  })
