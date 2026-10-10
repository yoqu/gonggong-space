import {
  type ApprovalDto,
  PROTOCOL_VERSION,
  type RunDto,
  type ServerToDaemon,
  type WebEvent,
} from '@gonggong/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLogs, bots, groups, messages, notifications, runs } from '../src/db/schema.js'
import { expireApprovals, voidApprovals } from '../src/modules/approvals/service.js'
import { listRuns } from '../src/modules/runs/dto.js'
import { MASK } from '../src/modules/runs/redact.js'
import { triggerRuns } from '../src/modules/runs/trigger.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let clock: Date
beforeEach(async () => {
  clock = new Date('2026-09-23T10:00:00Z')
  t = await createTestApp({ now: () => clock })
})
afterEach(() => t.close())

async function daemon(token: string) {
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  const send = (m: unknown) => ws.send(JSON.stringify(m))
  send({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    token,
    daemonVersion: '0.1.0',
    machine: { name: 'mbp', os: 'macos', arch: 'aarch64' },
    agents: [],
  })
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { send, next: () => box.next<ServerToDaemon>() }
}

function watch(userId: string) {
  const seen: WebEvent[] = []
  const waiters: { pred: (e: WebEvent) => boolean; resolve: (e: WebEvent) => void }[] = []
  t.ctx.bus.attach(userId, (e) => {
    seen.push(e)
    for (const w of [...waiters])
      if (w.pred(e)) {
        waiters.splice(waiters.indexOf(w), 1)
        w.resolve(e)
      }
  })
  return {
    seen,
    run: (pred: (r: RunDto) => boolean) =>
      new Promise<RunDto>((resolve) => {
        const match = (e: WebEvent) => e.t === 'run.updated' && pred(e.run)
        const hit = seen.find(match)
        if (hit?.t === 'run.updated') return resolve(hit.run)
        waiters.push({ pred: match, resolve: (e) => e.t === 'run.updated' && resolve(e.run) })
      }),
  }
}

const OPTIONS = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'always', name: 'Always', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
]

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const viewer = await t.seed.user({ name: '陈晨' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: viewer.id, memberIds: [owner.id], botIds: [bot.id] })
  const d = await daemon(token)
  const ownerWeb = watch(owner.id)
  const viewerWeb = watch(viewer.id)
  /** Triggers a run and has the daemon ask for approval; resolves with the pending approval. */
  const request = async (requestId = 'req-1', options = OPTIONS, remember?: string[]) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: viewer.id,
        body: '@小王的 Claude 跑下构建',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const start = await d.next()
    if (start.t !== 'run.start') throw new Error(`unexpected ${start.t}`)
    d.send({
      t: 'approval.request',
      runId: start.runId,
      requestId,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'go build ./...',
      options,
      ...(remember && { remember }),
    })
    const run = await viewerWeb.run((r) => r.id === start.runId && r.status === 'awaiting_approval')
    return { runId: start.runId, approval: run.approvals[0]! }
  }
  const owners = client(t, await t.seed.cookie(owner.id))
  const viewers = client(t, await t.seed.cookie(viewer.id))
  const decide = (c: typeof owners, a: ApprovalDto, optionId: string) =>
    c.post<ApprovalDto & { error?: string }>(`/api/runs/${a.runId}/approvals/${a.id}`, { optionId })
  const audit = () => t.db.select().from(auditLogs).orderBy(asc(auditLogs.id))
  const run = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  return { owner, viewer, bot, group, d, ownerWeb, viewerWeb, request, owners, viewers, decide, audit, run }
}

describe('approvals', () => {
  it('stores a pending request, awaits approval and notifies the bot owner', async () => {
    const w = await world()
    const { runId, approval } = await w.request()
    expect(approval).toMatchObject({
      runId,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'go build ./...',
      options: OPTIONS,
      status: 'pending',
      decidedBy: null,
      expiresAt: new Date(clock.getTime() + 30 * 60_000).toISOString(),
    })
    const row = await w.run(runId)
    expect(row).toMatchObject({ status: 'awaiting_approval', step: '等待审批：Bash' })
    // The owner is notified right after the request is stored and the card is pushed.
    const n = await vi.waitFor(async () => {
      const [row] = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
      if (!row) throw new Error('not yet')
      return row
    })
    expect(n).toMatchObject({
      type: 'approval',
      payload: {
        groupId: w.group.id,
        runId,
        approvalId: approval.id,
        botName: '小王的 Claude',
        detail: 'go build ./...',
        // Lets the owner decide from the notification when the run is in a chat they are not in (a shared bot's DM).
        options: OPTIONS,
      },
    })
    expect(w.ownerWeb.seen.some((e) => e.t === 'notification.new')).toBe(true)
    expect(w.viewerWeb.seen.some((e) => e.t === 'notification.new')).toBe(false)
    const [listed] = await listRuns(t.ctx, w.group.id)
    expect(listed?.approvals.map((a) => a.id)).toEqual([approval.id])
  })

  it('lets only the bot owner decide, once, with an offered option', async () => {
    const w = await world()
    const { runId, approval } = await w.request()
    expect((await w.decide(w.viewers, approval, 'allow')).status).toBe(403)
    expect((await w.decide(w.owners, approval, 'nope')).status).toBe(400)

    const ok = await w.decide(w.owners, approval, 'allow')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: w.owner.id, decidedByName: '王磊' })
    expect(await w.d.next()).toEqual({ t: 'approval.decision', runId, requestId: 'req-1', optionId: 'allow' })
    const back = await w.viewerWeb.run((r) => r.id === runId && r.approvals[0]?.status === 'approved')
    expect(back.status).toBe('running')
    expect(back.approvals[0]).toMatchObject({ status: 'approved', decidedByName: '王磊' })

    expect((await w.decide(w.owners, approval, 'reject')).status).toBe(409)
    expect(await w.audit()).toMatchObject([
      {
        category: 'approval',
        action: 'approved',
        actorUserId: w.owner.id,
        groupId: w.group.id,
        detail: { runId, approvalId: approval.id, optionId: 'allow', detail: 'go build ./...' },
      },
    ])
  })

  it('records a reject decision and keeps awaiting while another request is pending', async () => {
    const w = await world()
    const { runId, approval } = await w.request()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: 'req-2',
      title: 'Fetch',
      toolKind: 'fetch',
      detail: 'https://wiki.corp',
      options: OPTIONS,
    })
    await w.viewerWeb.run((r) => r.id === runId && r.approvals.length === 2)
    const res = await w.decide(w.owners, approval, 'reject')
    expect(res.body).toMatchObject({ status: 'rejected' })
    await w.d.next()
    expect((await w.run(runId)).status).toBe('awaiting_approval')
    expect((await w.audit()).map((a) => a.action)).toEqual(['rejected'])
  })

  it('masks secrets in the requested command before storing or notifying', async () => {
    const w = await world()
    const { runId } = await w.request()
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: 'req-2',
      title: 'curl -H "Authorization: Bearer abcDEF0123456789xyz"',
      toolKind: 'execute',
      detail: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 gh pr list',
      options: OPTIONS,
    })
    const run = await w.viewerWeb.run((r) => r.id === runId && r.approvals.length === 2)
    expect(run.approvals[1]).toMatchObject({
      title: `curl -H "Authorization: Bearer ${MASK}"`,
      detail: `GITHUB_TOKEN=${MASK} gh pr list`,
    })
    await vi.waitFor(async () => {
      const rows = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
      expect(rows).toHaveLength(2)
      expect(JSON.stringify(rows)).not.toContain('ghp_')
    })
  })

  it('auto-rejects on timeout (group param overrides the default) and the run continues', async () => {
    const w = await world()
    await t.db
      .update(groups)
      .set({ params: { approvalTimeoutMin: 2 } })
      .where(eq(groups.id, w.group.id))
    const { runId, approval } = await w.request()
    expect(approval.expiresAt).toBe(new Date(clock.getTime() + 2 * 60_000).toISOString())

    clock = new Date(clock.getTime() + 60_000)
    await expireApprovals(t.ctx)
    expect((await w.run(runId)).status).toBe('awaiting_approval')

    clock = new Date(clock.getTime() + 61_000)
    await expireApprovals(t.ctx)
    expect(await w.d.next()).toEqual({
      t: 'approval.decision',
      runId,
      requestId: 'req-1',
      optionId: 'reject',
    })
    const back = await w.viewerWeb.run((r) => r.id === runId && r.approvals[0]?.status === 'expired')
    expect(back.status).toBe('running')
    expect(back.approvals[0]).toMatchObject({ status: 'expired', decidedBy: null })
    expect(await w.audit()).toMatchObject([
      { category: 'approval', action: 'expired', actorUserId: null, detail: { optionId: 'reject' } },
    ])
    expect((await w.decide(w.owners, approval, 'allow')).status).toBe(409)
  })

  it('uses the group default in force-sync groups too (F22) and cancels when no reject option exists', async () => {
    const w = await world()
    await t.db.update(groups).set({ mode: 'force' }).where(eq(groups.id, w.group.id))
    const { runId, approval } = await w.request('req-9', [OPTIONS[0]!])
    expect(approval.expiresAt).toBe(new Date(clock.getTime() + 30 * 60_000).toISOString())
    clock = new Date(clock.getTime() + 30 * 60_000)
    await expireApprovals(t.ctx)
    expect(await w.d.next()).toEqual({ t: 'approval.decision', runId, requestId: 'req-9', optionId: null })
  })

  it('voids pending requests when the run ends or is stopped', async () => {
    const w = await world()
    const { runId } = await w.request()
    w.d.send({
      t: 'run.done',
      runId,
      outcome: 'completed',
      reply: '',
      filesChanged: 0,
      usage: null,
      sessionId: null,
      newSessionReason: null,
      error: null,
      git: null,
      patch: null,
      appendsApplied: 0,
    })
    const ended = await w.viewerWeb.run((r) => r.id === runId && r.status === 'completed')
    expect(ended.approvals[0]).toMatchObject({ status: 'void', decidedBy: null })

    const second = await w.request('req-2')
    await voidApprovals(t.ctx, second.runId, 'stopped')
    const stopped = await w.viewerWeb.run((r) => r.id === second.runId && r.approvals[0]?.status === 'void')
    expect(stopped.status).toBe('running')
    expect((await w.decide(w.owners, second.approval, 'allow')).status).toBe(409)
    expect((await w.audit()).map((a) => [a.action, (a.detail as { reason: string }).reason])).toEqual([
      ['void', 'ended'],
      ['void', 'stopped'],
    ])
  })

  it('marks the approval notification handled once the request is decided, expired or voided', async () => {
    const w = await world()
    const noteOf = async (approvalId: string) =>
      vi.waitFor(async () => {
        const rows = await t.db.select().from(notifications).where(eq(notifications.userId, w.owner.id))
        const n = rows.find((r) => (r.payload as { approvalId: string }).approvalId === approvalId)
        if (!n) throw new Error('not yet')
        return n
      })
    const { runId, approval } = await w.request()
    const more = async (requestId: string, n: number) => {
      w.d.send({
        t: 'approval.request',
        runId,
        requestId,
        title: 'Bash',
        toolKind: 'execute',
        detail: 'ls',
        options: OPTIONS,
      })
      const run = await w.viewerWeb.run((r) => r.id === runId && r.approvals.length === n)
      return run.approvals[n - 1]!
    }
    await noteOf(approval.id)
    await w.decide(w.owners, approval, 'allow')
    expect(await noteOf(approval.id)).toMatchObject({ resolvedAt: clock, readAt: clock })
    expect(w.ownerWeb.seen.find((e) => e.t === 'notification.resolved')).toMatchObject({ unread: 0 })
    expect(w.viewerWeb.seen.some((e) => e.t === 'notification.resolved')).toBe(false)

    const expired = await more('req-2', 2)
    await noteOf(expired.id)
    clock = new Date(clock.getTime() + 31 * 60_000)
    await expireApprovals(t.ctx)
    expect((await noteOf(expired.id)).resolvedAt).toEqual(clock)

    const voided = await more('req-3', 3)
    await noteOf(voided.id)
    await voidApprovals(t.ctx, runId, 'stopped')
    expect((await noteOf(voided.id)).resolvedAt).toEqual(clock)
  })

  it('ignores requests for runs that are not live on the reporting machine', async () => {
    const w = await world()
    const { runId } = await w.request()
    await voidApprovals(t.ctx, runId, 'ended')
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, runId))
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: 'late',
      title: 'Bash',
      toolKind: 'execute',
      detail: 'ls',
      options: OPTIONS,
    })
    w.d.send({ t: 'heartbeat' })
    await new Promise((r) => setTimeout(r, 100))
    const [listed] = await listRuns(t.ctx, w.group.id)
    expect(listed?.approvals.map((a) => a.status)).toEqual(['void'])
  })
})

describe('始终允许 rules', () => {
  const alwaysAllow = async (botId: string) =>
    (await t.db.select({ v: bots.alwaysAllow }).from(bots).where(eq(bots.id, botId)))[0]!.v
  /** Another request on the same run; resolves with it once pushed. */
  const more = async (
    w: Awaited<ReturnType<typeof world>>,
    runId: string,
    n: number,
    remember?: string[],
  ) => {
    w.d.send({
      t: 'approval.request',
      runId,
      requestId: `req-${n}`,
      title: 'Bash',
      toolKind: 'execute',
      detail: 'ls',
      options: OPTIONS,
      ...(remember && { remember }),
    })
    const run = await w.viewerWeb.run((r) => r.id === runId && r.approvals.length === n)
    return run.approvals[n - 1]!
  }

  it('stores the remember rules and shows them on the card; old daemons send none', async () => {
    const w = await world()
    const { runId, approval } = await w.request('req-1', OPTIONS, ['npm run build', 'tail'])
    expect(approval.remember).toEqual(['npm run build', 'tail'])
    expect((await more(w, runId, 2)).remember).toEqual([])
    // A rule holding a secret would leak it into the bot settings; it is not offered.
    const secret = 'curl -H "Authorization: Bearer abcDEF0123456789xyz" x'
    expect((await more(w, runId, 3, [secret, 'tail', 'x'.repeat(201)])).remember).toEqual(['tail'])
  })

  it('allow_always merges remember into the bot alwaysAllow, deduped, broadcasts the bot and audits', async () => {
    const w = await world()
    await t.db
      .update(bots)
      .set({ alwaysAllow: ['npm test'] })
      .where(eq(bots.id, w.bot.id))
    const { approval } = await w.request('req-1', OPTIONS, ['npm test', 'npm  run build', 'npm run build'])
    const res = await w.decide(w.owners, approval, 'always')
    expect(res.body).toMatchObject({ status: 'approved', remember: ['npm test', 'npm run build'] })
    expect(await alwaysAllow(w.bot.id)).toEqual(['npm test', 'npm run build'])
    await vi.waitFor(() => {
      const ev = w.viewerWeb.seen.findLast((e) => e.t === 'bot.updated')
      if (ev?.t !== 'bot.updated') throw new Error('not yet')
      expect(ev.bot.alwaysAllow).toEqual(['npm test', 'npm run build'])
    })
    const rows = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'bot.always_allow'))
    expect(rows).toMatchObject([
      {
        category: 'admin',
        actorUserId: w.owner.id,
        detail: { botId: w.bot.id, name: '小王的 Claude', added: ['npm run build'], approvalId: approval.id },
      },
    ])
  })

  it('allow_once, reject and an empty remember leave alwaysAllow untouched', async () => {
    const w = await world()
    const { runId, approval } = await w.request('req-1', OPTIONS, ['go build'])
    const rejected = await more(w, runId, 2, ['go build'])
    const empty = await more(w, runId, 3)
    await w.decide(w.owners, approval, 'allow')
    await w.decide(w.owners, rejected, 'reject')
    expect((await w.decide(w.owners, empty, 'always')).body).toMatchObject({ status: 'approved' })
    expect(await alwaysAllow(w.bot.id)).toEqual([])
    expect((await w.audit()).map((a) => a.action)).not.toContain('bot.always_allow')
  })

  it('a rule already allowed is not re-added or re-audited', async () => {
    const w = await world()
    await t.db
      .update(bots)
      .set({ alwaysAllow: ['go build'] })
      .where(eq(bots.id, w.bot.id))
    const { approval } = await w.request('req-1', OPTIONS, ['go build'])
    await w.decide(w.owners, approval, 'always')
    expect(await alwaysAllow(w.bot.id)).toEqual(['go build'])
    expect((await w.audit()).map((a) => a.action)).not.toContain('bot.always_allow')
  })
})
