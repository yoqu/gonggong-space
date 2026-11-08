import { randomUUID } from 'node:crypto'
import { RunStatus, TERMINAL_RUN_STATUS } from '@gonggong/protocol'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  type SQLWrapper,
  sql,
} from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  bots,
  groupBots,
  groupMembers,
  groups,
  messages,
  notifications,
  runs,
  syncReplicas,
  teams,
  users,
} from '../src/db/schema.js'
import { likePattern } from '../src/lib/text.js'
import { mentionCount, unread } from '../src/modules/groups/service.js'
import { knownNotification } from '../src/modules/notifications/notify.js'
import { runMatches } from '../src/modules/runs/search-text.js'
import { createTestDb } from './support/db.js'

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const planOf = (query: SQLWrapper, { seqscan = false } = {}) =>
  t.db.transaction(async (tx) => {
    if (!seqscan) await tx.execute(sql`set local enable_seqscan = off`)
    return JSON.stringify(await tx.execute(sql`explain (format json) ${query.getSQL()}`))
  })

/** Indexes the planner scans for `query` once sequential scans are priced out, as they are on large tables. */
const indexesFor = async (query: SQLWrapper) =>
  [...(await planOf(query)).matchAll(/"Index Name":"([^"]+)"/g)].map((m) => m[1])

it('requeueing appends finds them by the run they were appended to, not through the group history', async () => {
  const query = t.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.groupId, randomUUID()), sql`${messages.meta}->>'appendTo' = ${randomUUID()}`))
    .orderBy(asc(messages.seq))
  expect(await indexesFor(query)).toContain('messages_append_to')
})

it('a relay chain is walked down by parent run', async () => {
  const query = t.db.select({ id: runs.id }).from(runs).where(eq(runs.parentRunId, randomUUID()))
  expect(await indexesFor(query)).toContain('runs_parent')
})

it('the interrupt note reads the latest started run of the bot in the group', async () => {
  const query = t.db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.groupId, randomUUID()),
        eq(runs.botId, randomUUID()),
        ne(runs.id, randomUUID()),
        isNotNull(runs.startedAt),
      ),
    )
    .orderBy(desc(runs.startedAt))
    .limit(1)
  expect(await indexesFor(query)).toContain('runs_group_bot_started')
})

it('a schedule’s fail streak reads only the messages it fired', async () => {
  const query = t.db
    .select({ status: runs.status })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .where(
      and(
        eq(messages.groupId, randomUUID()),
        sql`${messages.meta}->>'scheduleOf' = ${randomUUID()}`,
        inArray(runs.status, [...TERMINAL_RUN_STATUS]),
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(3)
  expect(await indexesFor(query)).toContain('messages_schedule_of')
})

it('a bot’s group memberships and sync replicas are found by bot', async () => {
  const bot = randomUUID()
  expect(await indexesFor(t.db.select().from(groupBots).where(eq(groupBots.botId, bot)))).toContain(
    'group_bots_bot',
  )
  expect(await indexesFor(t.db.select().from(syncReplicas).where(eq(syncReplicas.botId, bot)))).toContain(
    'sync_replicas_bot',
  )
})

const conversationList = (userId: string) =>
  t.db
    .select({ unread, mentionCount })
    .from(groups)
    .innerJoin(groupMembers, and(eq(groupMembers.groupId, groups.id), eq(groupMembers.userId, userId)))

it('the conversation list counts unread and finds @ of each group through its messages index', async () => {
  const indexes = await indexesFor(conversationList(randomUUID()))
  expect(indexes).toContain('messages_group_seq')
  expect(indexes).toContain('messages_user_mentions')
})

// Forcing index scans can't show the planner preferring a sequential scan it hopes to stop early: real statistics can.
it('the conversation list never scans all messages, however long a group has been left unread', async () => {
  const id = (kind: number, n: string) =>
    `('00000000-0000-4000-800${kind}-' || lpad((${n})::text, 12, '0'))::uuid`
  await t.db.execute(
    sql.raw(`
    insert into users (id, account, name) select ${id(0, 'n')}, 'u' || n, 'u' || n from generate_series(1, 10) n;
    insert into teams (id, name, created_by) values (${id(1, '1')}, 't', ${id(0, '1')});
    insert into groups (id, team_id, name, kind, created_by)
      select ${id(2, 'n')}, ${id(1, '1')}, 'g' || n, 'group', ${id(0, '1')} from generate_series(1, 2) n;
    insert into group_members (group_id, user_id) select g.id, u.id from groups g cross join users u;
    insert into messages (group_id, kind, author_user_id, meta)
      select ${id(2, '1 + i % 2')}, 'user', ${id(0, '1 + i % 10')},
        case when i % 500 = 0 then jsonb_build_object('userMentions', jsonb_build_array(${id(0, '2')})) else '{}' end
      from generate_series(1, 5000) i;
    analyze`),
  )
  const plan = await planOf(conversationList('00000000-0000-4000-8000-000000000001'), { seqscan: true })
  const seqScans = [...plan.matchAll(/"Node Type":"Seq Scan"[^{}]*?"Relation Name":"([^"]+)"/g)].map(
    (m) => m[1],
  )
  expect(seqScans).not.toContain('messages')
})

it('a bot’s activity reads its last run per group and its live runs by status', async () => {
  const bot = randomUUID()
  const lastRuns = t.db
    .select({
      lastRunAt: sql`(select max(r.started_at) from runs r where r.group_id = ${groupBots.groupId}
        and r.bot_id = ${groupBots.botId})`,
    })
    .from(groupBots)
    .innerJoin(groups, eq(groups.id, groupBots.groupId))
    .where(eq(groupBots.botId, bot))
  expect(await indexesFor(lastRuns)).toContain('runs_group_bot_started')
  const live = t.db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.botId, bot),
        inArray(
          runs.status,
          RunStatus.options.filter((s) => !TERMINAL_RUN_STATUS.includes(s)),
        ),
      ),
    )
  expect(await planOf(live)).toMatch(/"Index Name":"runs_bot_status"[^{}]*"Index Cond":"[^"]*status = ANY/)
})

// Only statistics show the planner that most of a user's notifications are long read.
it('a team’s unread notifications are counted from the unread ones alone', async () => {
  const [user] = await t.db.insert(users).values({ account: 'reader', name: 'reader' }).returning()
  const [team] = await t.db.insert(teams).values({ name: 't', createdBy: user!.id }).returning()
  await t.db.execute(sql`insert into notifications (user_id, team_id, type, payload, read_at)
    select ${user!.id}, ${team!.id}, 'mention', '{}', case when i % 20 = 0 then null else now() end
    from generate_series(1, 2000) i`)
  await t.db.execute(sql`analyze notifications`)
  const query = t.db
    .select({ teamId: notifications.teamId, n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user!.id),
        isNull(notifications.readAt),
        isNotNull(notifications.teamId),
        knownNotification,
      ),
    )
    .groupBy(notifications.teamId)
  expect(await indexesFor(query)).toContain('notifications_unread')
})

it('message search (and the agent tool) matches bodies through the trigram index, LIKE wildcards escaped', async () => {
  const query = t.db
    .select({ id: messages.id })
    .from(messages)
    .where(ilike(messages.body, likePattern('50%_off')))
  expect(await indexesFor(query)).toContain('messages_body_trgm')
})

it('run search reads the indexed search text, the runs of bots by name and only the runs not indexed yet', async () => {
  const [owner] = await t.db.insert(users).values({ account: 'vet', name: 'vet' }).returning()
  const [team] = await t.db.insert(teams).values({ name: 'vet', createdBy: owner!.id }).returning()
  await t.db.insert(bots).values({
    teamId: team!.id,
    name: 'go vet 助手',
    ownerId: owner!.id,
    agentKind: 'claude',
    binding: 'bound',
    createdBy: owner!.id,
  })
  const query = t.db
    .select({ id: runs.id })
    .from(runs)
    .where(await runMatches(t.db, likePattern('go vet')))
  const plan = await planOf(query)
  expect(plan).toMatch(/"Index Name":"runs_search_text"[^{}]*"Index Cond":"\(search_text ~~\*/)
  expect(plan).toMatch(/"Index Cond":"\(bot_id = /)
  expect(plan).toContain('"Index Name":"runs_search_pending"')
})
