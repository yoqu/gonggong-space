import {
  type MessageDto,
  PROTOCOL_VERSION,
  type Question,
  type QuestionSetDto,
  type RunDto,
  type ServerToDaemon,
  type WebEvent,
} from '@aiws/protocol'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachments,
  auditLogs,
  groups,
  messages,
  notifications,
  questionSets,
  runs,
} from '../src/db/schema.js'
import { expireQuestions, voidQuestions } from '../src/modules/questions/service.js'
import { listRuns } from '../src/modules/runs/dto.js'
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

const QUESTIONS: Question[] = [
  { id: 'q1', type: 'single', title: '用哪种语言？', options: ['Python', 'Go'], recommended: 0 },
  {
    id: 'q2',
    type: 'multi',
    title: '覆盖哪些渠道？',
    options: ['微信', '支付宝', '银联'],
    recommended: null,
  },
  { id: 'q3', type: 'yesno', title: '允许改 fixture 吗？', options: ['是', '否'], recommended: 0 },
  { id: 'q4', type: 'text', title: '还有什么要注意？', options: [], recommended: null },
]
const ANSWERS = [
  { questionId: 'q1', choices: [1], text: null },
  { questionId: 'q2', choices: [0, 2], text: '云闪付' },
  { questionId: 'q3', choices: [1], text: null },
  { questionId: 'q4', choices: [], text: '注意幂等' },
]

const DONE = {
  t: 'run.done',
  outcome: 'completed',
  reply: '',
  filesChanged: 0,
  usage: null,
  sessionId: null,
  newSessionReason: null,
  error: null,
  git: null,
  patch: null,
}

async function world() {
  const owner = await t.seed.user({ name: '王磊' })
  const viewer = await t.seed.user({ name: '陈晨' })
  const trigger = await t.seed.user({ name: '赵敏' })
  const { machine, token } = await t.seed.machine(owner.id)
  const bot = await t.seed.bot({ ownerId: owner.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({
    createdBy: viewer.id,
    memberIds: [owner.id, trigger.id],
    botIds: [bot.id],
  })
  const d = await daemon(token)
  const viewerWeb = watch(viewer.id)
  /** Triggers a run by 赵敏; resolves once it is running. */
  const start = async () => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: trigger.id,
        body: '@小王的 Claude 写个脚本',
        meta: { mentions: [bot.id] },
      })
      .returning()
    await triggerRuns(t.ctx, m!)
    const msg = await d.next()
    if (msg.t !== 'run.start') throw new Error(`unexpected ${msg.t}`)
    return msg.runId
  }
  /** Has the daemon ask; resolves with the pending question card. */
  const ask = async (runId: string, requestId = 'r/q1', questions = QUESTIONS) => {
    const n = (await t.db.select().from(questionSets).where(eq(questionSets.runId, runId))).length + 1
    d.send({ t: 'question.ask', runId, requestId, questions })
    const run = await viewerWeb.run((r) => r.id === runId && r.questions.length === n)
    return run.questions.at(-1)!
  }
  const owners = client(t, await t.seed.cookie(owner.id))
  const viewers = client(t, await t.seed.cookie(viewer.id))
  const triggers = client(t, await t.seed.cookie(trigger.id))
  const answer = (
    c: typeof owners,
    q: QuestionSetDto,
    answers: unknown = ANSWERS,
    attachmentIds: string[] = [],
  ) =>
    c.post<QuestionSetDto & { error?: string }>(`/api/runs/${q.runId}/questions/${q.id}/answers`, {
      answers,
      attachmentIds,
    })
  const audit = () => t.db.select().from(auditLogs).orderBy(asc(auditLogs.id))
  const run = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]!
  return {
    owner,
    viewer,
    trigger,
    bot,
    group,
    d,
    viewerWeb,
    start,
    ask,
    owners,
    viewers,
    triggers,
    answer,
    audit,
    run,
  }
}

describe('questions', () => {
  it('stores the card, awaits the answer and notifies the trigger user and the bot owner', async () => {
    const w = await world()
    const runId = await w.start()
    const q = await w.ask(runId)
    expect(q).toMatchObject({
      runId,
      questions: QUESTIONS,
      status: 'pending',
      answers: null,
      answeredBy: null,
      expiresAt: new Date(clock.getTime() + 30 * 60_000).toISOString(),
    })
    expect(await w.run(runId)).toMatchObject({ status: 'awaiting_answer', step: '等待回答：4 个问题' })
    // Notified right after the card is stored and pushed.
    const notes = await vi.waitFor(async () => {
      const rows = await t.db.select().from(notifications).orderBy(asc(notifications.createdAt))
      if (rows.length < 2) throw new Error('not yet')
      return rows
    })
    expect(notes.map((n) => [n.userId, n.type]).sort()).toEqual(
      [
        [w.owner.id, 'question'],
        [w.trigger.id, 'question'],
      ].sort(),
    )
    expect(notes[0]?.payload).toMatchObject({
      groupId: w.group.id,
      runId,
      questionSetId: q.id,
      botName: '小王的 Claude',
      count: 4,
      title: '用哪种语言？',
    })
    const [listed] = await listRuns(t.ctx, w.group.id)
    expect(listed?.questions.map((x) => x.id)).toEqual([q.id])
  })

  it('lets only the trigger user or the bot owner answer, once, with valid answers', async () => {
    const w = await world()
    const runId = await w.start()
    const q = await w.ask(runId)
    expect((await w.answer(w.viewers, q)).status).toBe(403)
    // Invalid answers: unknown question, two choices for a single, out of range, missing, text on yes/no.
    const bad = [
      [...ANSWERS, { questionId: 'q9', choices: [0], text: null }],
      [{ ...ANSWERS[0], choices: [0, 1] }, ...ANSWERS.slice(1)],
      [{ ...ANSWERS[0], choices: [2] }, ...ANSWERS.slice(1)],
      ANSWERS.slice(1),
      [...ANSWERS.slice(0, 2), { ...ANSWERS[2], text: '都行' }, ANSWERS[3]],
    ]
    for (const answers of bad) expect((await w.answer(w.triggers, q, answers)).status).toBe(400)

    const ok = await w.answer(w.triggers, q)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({
      status: 'answered',
      answers: ANSWERS,
      answeredBy: w.trigger.id,
      answeredByName: '赵敏',
    })
    expect(await w.d.next()).toEqual({
      t: 'question.answer',
      runId,
      requestId: 'r/q1',
      answers: ANSWERS,
      attachments: [],
      answeredBy: '赵敏',
    })
    const back = await w.viewerWeb.run((r) => r.id === runId && r.questions[0]?.status === 'answered')
    expect(back.status).toBe('running')
    expect((await w.answer(w.owners, q)).status).toBe(409)

    // The bot owner may answer too.
    const second = await w.ask(runId, 'r/q2')
    expect((await w.answer(w.owners, second)).body).toMatchObject({ answeredByName: '王磊' })
    expect(await w.audit()).toMatchObject([
      {
        category: 'question',
        action: 'answered',
        actorUserId: w.trigger.id,
        groupId: w.group.id,
        detail: { runId, questionSetId: q.id, answers: ANSWERS },
      },
      { category: 'question', action: 'answered', actorUserId: w.owner.id },
    ])
  })

  it('lets the chain initiator answer a relay hop', async () => {
    const w = await world()
    const runId = await w.start()
    await t.db.update(runs).set({ triggerUserId: null, hop: 2 }).where(eq(runs.id, runId))
    const q = await w.ask(runId)
    expect((await w.answer(w.triggers, q)).status).toBe(200)
  })

  it("binds the answerer's own uploads to the answer and forwards them", async () => {
    const w = await world()
    const runId = await w.start()
    const q = await w.ask(runId)
    const upload = async (uploaderId: string, groupId = w.group.id) =>
      (
        await t.db
          .insert(attachments)
          .values({ uploaderId, groupId, name: 'shot.png', size: 3, mime: 'image/png', storageKey: 'k' })
          .returning()
      )[0]!
    const others = await upload(w.owner.id)
    expect((await w.answer(w.triggers, q, ANSWERS, [others.id])).status).toBe(400)
    const mine = await upload(w.trigger.id)
    const res = await w.answer(w.triggers, q, ANSWERS, [mine.id])
    expect(res.body.attachments).toEqual([
      { id: mine.id, name: 'shot.png', size: 3, mime: 'image/png', messageId: q.id },
    ])
    expect(await w.d.next()).toMatchObject({ t: 'question.answer', attachments: res.body.attachments })
    const [bound] = await t.db.select().from(attachments).where(eq(attachments.id, mine.id))
    expect(bound?.messageId).toBe(q.id)
  })

  it('times out after the group approval timeout and tells the agent to go on', async () => {
    const w = await world()
    await t.db
      .update(groups)
      .set({ params: { approvalTimeoutMin: 1 } })
      .where(eq(groups.id, w.group.id))
    const runId = await w.start()
    const q = await w.ask(runId)
    expect(q.expiresAt).toBe(new Date(clock.getTime() + 60_000).toISOString())
    clock = new Date(clock.getTime() + 30_000)
    await expireQuestions(t.ctx)
    expect((await w.run(runId)).status).toBe('awaiting_answer')

    clock = new Date(clock.getTime() + 31_000)
    await expireQuestions(t.ctx)
    expect(await w.d.next()).toEqual({
      t: 'question.answer',
      runId,
      requestId: 'r/q1',
      answers: null,
      attachments: [],
      answeredBy: null,
    })
    const back = await w.viewerWeb.run((r) => r.id === runId && r.questions[0]?.status === 'expired')
    expect(back.status).toBe('running')
    expect((await w.answer(w.triggers, q)).status).toBe(409)
    expect(await w.audit()).toMatchObject([{ category: 'question', action: 'expired', actorUserId: null }])
  })

  it('voids pending cards when the run ends or is stopped', async () => {
    const w = await world()
    const runId = await w.start()
    await w.ask(runId)
    w.d.send({ ...DONE, runId })
    const ended = await w.viewerWeb.run((r) => r.id === runId && r.status === 'completed')
    expect(ended.questions[0]).toMatchObject({ status: 'void' })

    const second = await w.start()
    const q = await w.ask(second, 'r/q2')
    await voidQuestions(t.ctx, second)
    const stopped = await w.viewerWeb.run((r) => r.id === second && r.questions[0]?.status === 'void')
    expect(stopped.status).toBe('running')
    expect((await w.answer(w.triggers, q)).status).toBe(409)
    expect((await w.audit()).map((a) => [a.category, a.action])).toEqual([
      ['question', 'void'],
      ['question', 'void'],
    ])
  })

  it('ignores asks for runs that are not live on the reporting machine', async () => {
    const w = await world()
    const runId = await w.start()
    await t.db.update(runs).set({ status: 'completed' }).where(eq(runs.id, runId))
    w.d.send({ t: 'question.ask', runId, requestId: 'late', questions: QUESTIONS })
    w.d.send({ t: 'heartbeat' })
    await new Promise((r) => setTimeout(r, 100))
    const [listed] = await listRuns(t.ctx, w.group.id)
    expect(listed?.questions).toEqual([])
  })
})

describe('interrupt and append', () => {
  const send = (c: ReturnType<typeof client>, groupId: string, body: string, appendTo: string | null) =>
    c.post<MessageDto & { error?: string }>(`/api/groups/${groupId}/messages`, {
      body,
      clientId: crypto.randomUUID(),
      appendTo,
    })

  it('sends the message into the running run instead of starting a new one', async () => {
    const w = await world()
    const runId = await w.start()
    await t.db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId))
    expect((await send(w.viewers, w.group.id, '别等了', runId)).status).toBe(403)

    const q = await w.ask(runId)
    const res = await send(w.triggers, w.group.id, '@小王的 Claude 不要等了，直接回复 appended', runId)
    expect(res.status).toBe(200)
    expect(res.body.body).toBe('@小王的 Claude 不要等了，直接回复 appended')
    expect(await w.d.next()).toEqual({
      t: 'run.append',
      runId,
      text: '@小王的 Claude 不要等了，直接回复 appended',
      from: '赵敏',
      attachments: [],
    })
    // Still one run; the question it was waiting on is withdrawn.
    const back = await w.viewerWeb.run((r) => r.id === runId && r.questions[0]?.status === 'void')
    expect(back.status).toBe('running')
    expect(await t.db.select().from(runs)).toHaveLength(1)
    expect((await w.answer(w.triggers, q)).status).toBe(409)

    // The owner may append as well; a finished run cannot be appended to.
    expect((await send(w.owners, w.group.id, '再补一句', runId)).status).toBe(200)
    w.d.send({ ...DONE, runId })
    await w.viewerWeb.run((r) => r.id === runId && r.status === 'completed')
    expect((await send(w.triggers, w.group.id, '太晚了', runId)).status).toBe(409)
    expect((await send(w.triggers, w.group.id, '不存在', crypto.randomUUID())).status).toBe(404)
  })
})
