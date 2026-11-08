import type { SavedMessageDto } from '@gonggong/protocol'
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, type SQL, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { bots, groupMembers, groups, messages, savedMessages, users } from '../../db/schema.js'
import { groupTitle } from '../groups/title.js'
import { notify } from '../notifications/notify.js'
import { loadMessages } from '../threads/routes.js'

type SavedRow = typeof savedMessages.$inferSelect

/** With the joins below: saved rows of live groups the user is still in. */
const stillMember = isNull(groups.archivedAt)

/** `userId`'s saved messages matching `where`, ordered by `order`, as list items. */
export async function savedItems(
  ctx: Ctx,
  userId: string,
  where: SQL | undefined,
  order: SQL,
  limit: number,
) {
  const rows = await ctx.db
    .select({ s: savedMessages, groupName: groupTitle })
    .from(savedMessages)
    .innerJoin(groups, eq(groups.id, savedMessages.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(savedMessages.userId, userId), stillMember, where))
    .orderBy(order)
    .limit(limit)
  if (!rows.length) return []
  const dtos = new Map(
    (
      await loadMessages(
        ctx,
        userId,
        inArray(
          messages.id,
          rows.map((r) => r.s.messageId),
        ),
        rows.length,
      )
    ).map((m) => [m.id, m]),
  )
  return rows.flatMap(({ s, groupName }): SavedMessageDto[] => {
    const message = dtos.get(s.messageId)
    return message ? [{ groupId: s.groupId, groupName, message, ...times(s) }] : []
  })
}

const iso = (d: Date | null) => d?.toISOString() ?? null
const times = (s: SavedRow) => ({
  remindAt: iso(s.remindAt),
  remindedAt: iso(s.remindedAt),
  doneAt: iso(s.doneAt),
  createdAt: s.createdAt.toISOString(),
})

export const openSaved = isNull(savedMessages.doneAt)
export const doneBefore = (before?: string) =>
  and(isNotNull(savedMessages.doneAt), before ? lt(savedMessages.doneAt, new Date(before)) : undefined)
export const openBefore = (before?: string) =>
  and(openSaved, before ? lt(savedMessages.createdAt, new Date(before)) : undefined)
export const byCreated = desc(savedMessages.createdAt)
export const byDone = desc(savedMessages.doneAt)

/** The open saved ids (newest first) and the fired reminders not yet done. */
export async function savedState(ctx: Ctx, userId: string) {
  const rows = await ctx.db
    .select({ id: savedMessages.messageId, remindedAt: savedMessages.remindedAt })
    .from(savedMessages)
    .innerJoin(groups, eq(groups.id, savedMessages.groupId))
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))
    .where(and(eq(savedMessages.userId, userId), stillMember, openSaved))
    .orderBy(byCreated)
  return { ids: rows.map((r) => r.id), due: rows.filter((r) => r.remindedAt).length }
}

export const publishSaved = (ctx: Ctx, userId: string) => ctx.bus.publish([userId], { t: 'saved.changed' })

/**
 * Sends the reminders that came due, each once: claiming a row and stamping `reminded_at` is one statement, so
 * overlapping ticks never both send it. Rows of groups the user has left are skipped and stay unclaimed.
 */
export async function fireDueReminders(ctx: Ctx) {
  const now = ctx.now()
  const due = await ctx.db
    .select({ s: savedMessages })
    .from(savedMessages)
    .innerJoin(groups, eq(groups.id, savedMessages.groupId))
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, savedMessages.userId)),
    )
    .where(
      and(
        stillMember,
        openSaved,
        isNull(savedMessages.remindedAt),
        isNotNull(savedMessages.remindAt),
        lte(savedMessages.remindAt, now),
      ),
    )
  let sent = 0
  for (const { s } of due) {
    const [claimed] = await ctx.db
      .update(savedMessages)
      .set({ remindedAt: now })
      .where(
        and(
          eq(savedMessages.userId, s.userId),
          eq(savedMessages.messageId, s.messageId),
          isNull(savedMessages.remindedAt),
          eq(savedMessages.remindAt, s.remindAt as Date),
        ),
      )
      .returning()
    if (!claimed) continue
    try {
      const [m] = await ctx.db
        .select({ m: messages, author: sql<string | null>`coalesce(${users.name}, ${bots.name})` })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.authorUserId))
        .leftJoin(bots, eq(bots.id, messages.authorBotId))
        .where(eq(messages.id, s.messageId))
      if (!m) continue
      await notify(ctx, s.userId, 'reminder', {
        groupId: s.groupId,
        messageId: s.messageId,
        ...(m.m.threadRootId && { threadRootId: m.m.threadRootId }),
        ...(m.author && { byName: m.author }),
        text: m.m.recalledAt ? '' : m.m.body.replace(/\s+/g, ' ').trim().slice(0, 80),
      })
      publishSaved(ctx, s.userId)
      sent++
    } catch (err) {
      console.error(`reminder ${s.userId}/${s.messageId}:`, err)
    }
  }
  return sent
}

/** Sends due reminders now and then every `everyMs`; the returned function stops and waits for a tick in flight. */
export function startReminderEngine(ctx: Ctx, everyMs = 30_000) {
  let pending = Promise.resolve()
  const tick = () => {
    pending = pending
      .then(() => fireDueReminders(ctx))
      .then(
        () => {},
        (err) => console.error('reminder engine:', err),
      )
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    await pending
  }
}
