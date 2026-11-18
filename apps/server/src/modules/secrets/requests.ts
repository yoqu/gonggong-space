import {
  CreateSecretReq,
  type FillSecretReq,
  type SecretCard,
  type SecretRequestDto,
  type SecretRequirement,
} from '@gonggong/protocol'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import {
  bots,
  groupMembers,
  groups,
  machines,
  messages,
  runs,
  secretRequests,
  teamMembers,
  users,
} from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { mirrorSecretCard } from '../feishu/mirror.js'
import { requireMember } from '../groups/service.js'
import { forceNewSessions } from '../mcp/service.js'
import { authorName, type MessageMeta, memberIds, messageDto, postEvent } from '../messages/service.js'
import { rerunFor } from '../runs/trigger.js'
import { enabledSkills } from '../skills/service.js'
import { specDescription } from './needs.js'
import { resolveSecrets, type SecretRow, type SecretState, visibleSecrets } from './resolve.js'
import { createSecret, layerOfRow, setPersonal, setSharedValue } from './service.js'

type RequestRow = typeof secretRequests.$inferSelect
export type Audience = 'origin' | 'admins'
type RunRef = { id: string; groupId: string; botId: string; originUserId: string }

const card = (r: RequestRow, foreign?: boolean): SecretCard => ({
  id: r.id,
  names: r.names,
  audience: r.audience as SecretCard['audience'],
  userId: r.userId,
  filled: r.filledAt !== null,
  ...(foreign !== undefined && { foreign }),
})

/**
 * The definition each name of a fill card was asked for, still the one its run resolves to (plan Skill密钥声明 §7):
 * a definition deleted and made again, or a run now getting another layer's, means asking again.
 */
async function boundDefinitions(ctx: Ctx, req: RequestRow, posted: SecretCard | undefined) {
  const defs = posted?.defs
  if (!defs)
    return fail('conflict', '这张卡片发出时还没有绑定密钥定义，请让 Bot 重新申请，或到设置「我的密钥」里填写')
  const [run] = req.runId ? await ctx.db.select().from(runs).where(eq(runs.id, req.runId)) : []
  const now = ctx.now()
  const visible = await visibleSecrets(ctx.db, req.groupId)
  const states = run
    ? (
        await resolveSecrets(
          ctx.db,
          { groupId: run.groupId, botId: run.botId, originUserId: run.originUserId },
          now,
        )
      ).states
    : null
  return req.names.map((name) => {
    const def = visible.find((r) => r.id === defs[name])
    const current = states ? states.find((s) => s.def.name === name)?.def.id : def?.id
    if (!def?.enabled || current !== def.id)
      return fail('conflict', '密钥 {name} 的定义已变更，请让 Bot 重新申请', { name })
    return def
  })
}

/** Posts one 填写密钥 card; `origin` cards are for the run's originator, `admins` cards for the layers' admins. */
export async function postSecretCard(
  ctx: Ctx,
  run: RunRef,
  audience: Audience,
  names: string[],
  forceNewSession: boolean,
  defs: Record<string, string>,
) {
  const [req] = (await ctx.db
    .insert(secretRequests)
    .values({
      groupId: run.groupId,
      runId: run.id,
      audience,
      userId: audience === 'origin' ? run.originUserId : null,
      names,
      forceNewSession,
      createdAt: ctx.now(),
    })
    .returning()) as [RequestRow]
  const [bot] = await ctx.db
    .select({ name: bots.name, machineOwner: machines.ownerId })
    .from(bots)
    .leftJoin(machines, eq(machines.id, bots.machineId))
    .where(eq(bots.id, run.botId))
  const [user] = await ctx.db.select({ name: users.name }).from(users).where(eq(users.id, run.originUserId))
  const params = { bot: bot?.name ?? '', user: user?.name ?? '', names: names.join('、') }
  const posted = {
    ...card(req, audience === 'origin' ? bot?.machineOwner !== run.originUserId : undefined),
    defs,
  }
  const msg = await postEvent(
    ctx,
    run.groupId,
    audience === 'origin' ? '{bot} 请 {user} 填写自己的密钥：{names}' : '{bot} 请管理员填写密钥：{names}',
    params,
    { secretCard: posted },
  )
  await ctx.db.update(secretRequests).set({ messageId: msg.id }).where(eq(secretRequests.id, req.id))
  await mirrorSecretCard(ctx, run.groupId, req.id)
  return posted
}

/**
 * Fill cards for the names the run resolves, one per audience: personal and overridable names ask the originator
 * for their own value, shared names the admins of each definition's layer. Names it does not resolve are skipped.
 */
export async function askValues(ctx: Ctx, run: RunRef, names: string[], force: boolean) {
  const { states } = await resolveSecrets(ctx.db, run, ctx.now())
  const by: Record<Audience, SecretState[]> = { origin: [], admins: [] }
  for (const name of names) {
    const s = states.find((x) => x.def.name === name)
    if (s) by[s.def.mode === 'shared' ? 'admins' : 'origin'].push(s)
  }
  const posted: { audience: Audience; names: string[]; id: string }[] = []
  for (const audience of ['origin', 'admins'] as const) {
    if (!by[audience].length) continue
    const asked = by[audience].map((s) => s.def.name)
    const defs = Object.fromEntries(by[audience].map((s) => [s.def.name, s.def.id]))
    const c = await postSecretCard(ctx, run, audience, asked, force, defs)
    posted.push({ audience, names: asked, id: c.id })
  }
  return posted
}

async function adminNames(ctx: Ctx, l: DefineLayer) {
  const rows =
    l.scope === 'group'
      ? await ctx.db
          .select({ name: users.name })
          .from(groupMembers)
          .innerJoin(users, eq(users.id, groupMembers.userId))
          .where(and(eq(groupMembers.groupId, l.groupId!), eq(groupMembers.isAdmin, true)))
      : await ctx.db
          .select({ name: users.name })
          .from(teamMembers)
          .innerJoin(users, eq(users.id, teamMembers.userId))
          .where(and(eq(teamMembers.teamId, l.teamId), inArray(teamMembers.role, ['owner', 'admin'])))
  return rows.map((r) => r.name).sort()
}

type DefineLayer = NonNullable<SecretCard['define']>['layer']

/**
 * Asks the admins of `layer` to make the definitions `skill` declares (plan Skill密钥声明 §7); an unhandled card for
 * the same skill version, layer and names is reused rather than posted again.
 */
export async function postDefineCard(
  ctx: Ctx,
  run: RunRef,
  skill: { name: string; versionId: string },
  specs: SecretRequirement[],
  layer: DefineLayer,
) {
  const names = specs.map((s) => s.name).sort()
  const open = await ctx.db
    .select({ meta: messages.meta })
    .from(secretRequests)
    .innerJoin(messages, eq(messages.id, secretRequests.messageId))
    .where(
      and(
        eq(secretRequests.groupId, run.groupId),
        eq(secretRequests.audience, 'define'),
        isNull(secretRequests.filledAt),
      ),
    )
  const same = open
    .map((r) => (r.meta as MessageMeta).secretCard)
    .find(
      (c) =>
        c?.define?.skill === skill.name &&
        c.define.versionId === skill.versionId &&
        c.define.layer.scope === layer.scope &&
        c.names.join() === names.join(),
    )
  if (same) return same
  const [req] = (await ctx.db
    .insert(secretRequests)
    .values({
      groupId: run.groupId,
      runId: run.id,
      audience: 'define',
      userId: null,
      names,
      forceNewSession: false,
      createdAt: ctx.now(),
    })
    .returning()) as [RequestRow]
  const admins = await adminNames(ctx, layer)
  const [bot] = await ctx.db.select({ name: bots.name }).from(bots).where(eq(bots.id, run.botId))
  const posted: SecretCard = {
    ...card(req),
    define: { skill: skill.name, versionId: skill.versionId, layer, specs, admins },
  }
  const msg = await postEvent(
    ctx,
    run.groupId,
    '{bot} 请管理员按 Skill「{skill}」的声明创建密钥：{names}',
    { bot: bot?.name ?? '', skill: skill.name, names: names.join('、') },
    { secretCard: posted },
  )
  await ctx.db.update(secretRequests).set({ messageId: msg.id }).where(eq(secretRequests.id, req.id))
  await mirrorSecretCard(ctx, run.groupId, req.id)
  return posted
}

/**
 * A layer admin makes what a `define` card asks for, checked again now: the clicking user administers the layer, the
 * group still has that version of the skill, and no same-named definition appeared meanwhile. The run then asks for
 * the values.
 */
async function defineSecrets(ctx: Ctx, userId: string, req: RequestRow, posted: SecretCard | undefined) {
  const d = posted?.define
  if (!d) return fail('conflict', '卡片已失效，请让 Bot 重新申请')
  const layer = { ...d.layer, groupId: d.layer.scope === 'group' ? d.layer.groupId : null }
  if (!(await isLayerAdmin(ctx, userId, layer)))
    return fail('forbidden', '仅 {admins} 可以创建这些密钥', { admins: d.admins.join('、') || '管理员' })
  const skills = await enabledSkills(ctx.db, req.groupId)
  if (!skills.some((s) => s.name === d.skill && s.versionId === d.versionId))
    return fail('conflict', 'Skill {skill} 已升级或移除，卡片已失效，请让 Bot 重新申请', { skill: d.skill })
  const taken = (await visibleSecrets(ctx.db, req.groupId)).find((r) => req.names.includes(r.name))
  if (taken)
    return fail('conflict', '期间已出现同名密钥 {name}，卡片已失效，请让 Bot 重新申请', { name: taken.name })
  const claimed = await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx as unknown as Db }
    const [done] = await tx
      .update(secretRequests)
      .set({ filledAt: ctx.now() })
      .where(and(eq(secretRequests.id, req.id), isNull(secretRequests.filledAt)))
      .returning()
    if (!done) return fail('conflict', '密钥已创建')
    for (const spec of d.specs)
      await createSecret(
        c,
        layer,
        CreateSecretReq.parse({ name: spec.name, description: specDescription(spec), mode: spec.mode }),
        userId,
        { requestId: req.id, skill: d.skill },
      )
    return done
  })
  const done = (req.messageId ? await refreshCard(ctx, req.messageId) : undefined) ?? card(claimed)
  await mirrorSecretCard(ctx, req.groupId, req.id)
  const [run] = req.runId ? await ctx.db.select().from(runs).where(eq(runs.id, req.runId)) : []
  if (run) await askValues(ctx, run, req.names, false)
  return done
}

/** My unfilled `origin` cards of the group, as posted (so they keep `foreign`). */
export async function pendingSecretCards(ctx: Ctx, userId: string, groupId: string): Promise<SecretCard[]> {
  await requireMember(ctx, groupId, userId)
  const rows = await ctx.db
    .select({ meta: messages.meta })
    .from(secretRequests)
    .innerJoin(messages, eq(messages.id, secretRequests.messageId))
    .where(
      and(
        eq(secretRequests.groupId, groupId),
        eq(secretRequests.audience, 'origin'),
        eq(secretRequests.userId, userId),
        isNull(secretRequests.filledAt),
      ),
    )
    .orderBy(asc(secretRequests.createdAt))
  return rows.flatMap((r) => {
    const c = (r.meta as MessageMeta).secretCard
    return c ? [c] : []
  })
}

/** One card for its group's members, as posted (so it keeps `foreign`). */
export async function secretRequestOf(ctx: Ctx, userId: string, id: string): Promise<SecretRequestDto> {
  const [row] = await ctx.db
    .select({ req: secretRequests, meta: messages.meta, bot: bots.name })
    .from(secretRequests)
    .leftJoin(messages, eq(messages.id, secretRequests.messageId))
    .leftJoin(runs, eq(runs.id, secretRequests.runId))
    .leftJoin(bots, eq(bots.id, runs.botId))
    .where(eq(secretRequests.id, id))
  if (!row) return fail('not_found', '密钥请求不存在')
  await requireMember(ctx, row.req.groupId, userId)
  const posted = (row.meta as MessageMeta | null)?.secretCard ?? card(row.req)
  return { ...posted, filled: row.req.filledAt !== null, groupId: row.req.groupId, bot: row.bot ?? '' }
}

/**
 * Fills every name of the card: an `origin` card by its user as their own values in the group's team, an
 * `admins` card by an admin of each definition's layer as its shared value. The values go nowhere else. A `define`
 * card makes the definitions instead (no values).
 */
export async function fillSecretRequest(ctx: Ctx, userId: string, id: string, body: FillSecretReq) {
  const [row] = await ctx.db
    .select({ req: secretRequests, meta: messages.meta })
    .from(secretRequests)
    .leftJoin(messages, eq(messages.id, secretRequests.messageId))
    .where(eq(secretRequests.id, id))
  if (!row) return fail('not_found', '密钥请求不存在')
  const { req } = row
  await requireMember(ctx, req.groupId, userId)
  if (req.audience === 'origin' && req.userId !== userId) return fail('forbidden', '仅发起人可以填写')
  if (req.filledAt) return fail('conflict', '密钥已填写')
  const posted = (row.meta as MessageMeta | null)?.secretCard
  if (req.audience === 'define') return defineSecrets(ctx, userId, req, posted)
  const given = Object.keys(body.values)
  if (given.length !== req.names.length || !req.names.every((n) => body.values[n]))
    return fail('invalid', '请填写全部密钥')
  const [group] = await ctx.db
    .select({ teamId: groups.teamId })
    .from(groups)
    .where(eq(groups.id, req.groupId))
  if (!group) return fail('not_found', '群不存在')
  const extra = { requestId: req.id, forceNewSession: req.forceNewSession }
  const claimed = await ctx.db.transaction(async (tx) => {
    const c = { ...ctx, db: tx as unknown as Db }
    const defs = await boundDefinitions(c, req, posted)
    for (const def of defs) {
      const name = def.name
      if (req.audience === 'admins') {
        if (def.mode === 'personal') return fail('conflict', '密钥 {name} 已改为每人自填', { name })
        if (!(await isLayerAdmin(c, userId, layerOfRow(def))))
          return fail('forbidden', '仅密钥 {name} 所在层的管理员可以填写', { name })
      } else if (def.mode === 'shared') return fail('conflict', '密钥 {name} 已改为只用统一值', { name })
    }
    const [done] = await tx
      .update(secretRequests)
      .set({ filledAt: ctx.now() })
      .where(and(eq(secretRequests.id, id), isNull(secretRequests.filledAt)))
      .returning()
    if (!done) return fail('conflict', '密钥已填写')
    for (const def of defs) {
      const value = body.values[def.name] as string
      if (req.audience === 'admins') await setSharedValue(c, def, value, userId, extra)
      else
        await setPersonal(
          c,
          { userId, teamId: group.teamId, name: def.name },
          value,
          body.allowForeignMachines,
          'secret.fill',
          extra,
        )
    }
    return done
  })
  if (req.forceNewSession)
    await forceNewSessions(ctx, { scope: 'group', teamId: group.teamId, groupId: req.groupId })
  const done = (req.messageId ? await refreshCard(ctx, req.messageId) : undefined) ?? card(claimed)
  await mirrorSecretCard(ctx, req.groupId, req.id)
  await carryOn(ctx, req.runId)
  return done
}

/** The asking bot picks its turn up again with the values in place; relay hops can only be restarted from their source. */
async function carryOn(ctx: Ctx, runId: string | null) {
  if (!runId) return
  const [row] = await ctx.db
    .select({ run: runs, message: messages, bot: bots.name })
    .from(runs)
    .innerJoin(messages, eq(messages.id, runs.triggerMessageId))
    .innerJoin(bots, eq(bots.id, runs.botId))
    .where(eq(runs.id, runId))
  if (!row) return
  const { run, message } = row
  if (run.hop === 1 && message.authorUserId && !message.recalledAt) {
    await postEvent(ctx, run.groupId, '已填写密钥，{bot} 继续处理', { bot: row.bot })
    await rerunFor(ctx, message, [run.botId])
  } else await postEvent(ctx, run.groupId, '已填写密钥，重新 @{bot} 即可继续', { bot: row.bot })
}

async function refreshCard(ctx: Ctx, messageId: string) {
  const [m] = await ctx.db.select().from(messages).where(eq(messages.id, messageId))
  if (!m) return
  const meta = m.meta as MessageMeta
  if (!meta.secretCard) return
  const secretCard = { ...meta.secretCard, filled: true }
  const [row] = await ctx.db
    .update(messages)
    .set({ meta: { ...meta, secretCard } })
    .where(eq(messages.id, messageId))
    .returning()
  if (!row) return
  const dto = messageDto(row, await authorName(ctx, row))
  ctx.bus.publish(await memberIds(ctx, dto.groupId), { t: 'message.edited', message: dto })
  return secretCard
}
