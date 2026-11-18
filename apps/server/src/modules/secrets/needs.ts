import {
  CreateSecretReq,
  type FillNewSecretReq,
  type SecretMode,
  type SecretNeedDto,
  type SecretRequirement,
} from '@gonggong/protocol'
import { and, eq, inArray } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import type { Db } from '../../db/client.js'
import { groups, personalSecrets } from '../../db/schema.js'
import { fail, HttpError } from '../../lib/errors.js'
import { isLayerAdmin } from '../agent-tools/layers.js'
import { requireMember } from '../groups/service.js'
import type { Layer } from '../mcp/service.js'
import { enabledSkills } from '../skills/service.js'
import { blocked, RANK, type SecretRow, type SecretState, visibleSecrets } from './resolve.js'
import { createSecret, setPersonal } from './service.js'

type Read = Pick<Db, 'select'>
export type EffectiveSkill = Awaited<ReturnType<typeof enabledSkills>>[number]

/** Personal installs only ever get a per-member definition (plan §8.1). */
const targetMode = (skill: Pick<EffectiveSkill, 'scope'>, spec: SecretRequirement): SecretMode =>
  skill.scope === 'user' ? 'personal' : spec.mode

/**
 * Where a missing definition of a skill's secret goes (plan Skill密钥声明 §5): per-member ones in the team, since
 * members' values are kept per team and one definition serves all its groups; shared ones in the layer the skill was
 * installed or written into (a repo's are its team's); null for shared ones of platform skills.
 */
export function targetLayer(
  skill: Pick<EffectiveSkill, 'scope'>,
  spec: SecretRequirement,
  teamId: string,
  groupId: string,
): Layer | null {
  if (targetMode(skill, spec) === 'personal') return { scope: 'team', teamId, groupId: null }
  if (skill.scope === 'group') return { scope: 'group', teamId, groupId }
  if (skill.scope === 'platform') return null
  return { scope: 'team', teamId, groupId: null }
}

/** The most specific definition of `name`, whatever its state. */
const nearest = (rows: SecretRow[], name: string) =>
  rows.filter((r) => r.name === name).sort((a, b) => (RANK[b.scope] ?? 0) - (RANK[a.scope] ?? 0))[0]

export type RunNeed = {
  skill: string
  /** From the originator's personal install: they fill it in the group's banner, which makes the definition. */
  personal: boolean
  name: string
  mode: SecretMode
  status: 'missing_def' | 'unfilled' | 'foreign' | 'blocked'
  reason?: string
}

/** Required secrets the run's skills declare and the run does not get, with why (plan §7). */
export function runNeeds(
  skills: EffectiveSkill[],
  resolved: { rows: SecretRow[]; states: SecretState[]; env: Record<string, string> },
  botId: string,
  now: Date,
): RunNeed[] {
  const out: RunNeed[] = []
  for (const skill of skills)
    for (const spec of skill.secretSpecs) {
      if (!spec.required || spec.name in resolved.env) continue
      const base = { skill: skill.name, personal: skill.scope === 'user', name: spec.name }
      const state = resolved.states.find((s) => s.def.name === spec.name)
      if (state) {
        const mode = state.def.mode as SecretMode
        out.push({ ...base, mode, status: state.mine && !state.mineUsable ? 'foreign' : 'unfilled' })
        continue
      }
      const any = nearest(resolved.rows, spec.name)
      if (!any) out.push({ ...base, mode: targetMode(skill, spec), status: 'missing_def' })
      else
        out.push({
          ...base,
          mode: any.mode as SecretMode,
          status: 'blocked',
          reason: blocked(any, botId, now)!,
        })
    }
  return out
}

/** The run-start note telling the agent what is missing before it hits it; null when nothing is. */
export function runNeedsNote(needs: RunNeed[]) {
  if (!needs.length) return null
  const line = (n: RunNeed) => {
    const what = `- ${n.skill} 需要 ${n.name}（${n.mode}）：`
    switch (n.status) {
      case 'missing_def':
        return n.personal
          ? `${what}来自发起人的个人 Skill，团队还没有这个密钥；不要发卡，请发起人在群输入框上方的密钥提示里填写`
          : `${what}本群还没有这个密钥定义；用到时调 secret_request，平台会请管理员按 Skill 声明创建`
      case 'unfilled':
        return `${what}还没填写；用到时调 secret_request 发填写卡片`
      case 'foreign':
        return `${what}发起人已填写，但没允许运行在他人电脑上的 Bot 使用；不要发卡，请发起人到设置 →「我的密钥」打开「允许在他人机器上的 Bot 使用」`
      case 'blocked':
        return `${what}密钥定义${n.reason}；不要发卡，请对应层的管理员在设置里处理`
    }
  }
  return ['本轮生效的 Skill 缺少以下必需密钥（不必先 secret_list）：', ...needs.map(line)].join('\n')
}

async function teamOfGroup(db: Read, groupId: string) {
  const [g] = await db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, groupId))
  return g?.teamId ?? null
}

/**
 * What the member's view of the group needs (plan §6): every secret its skills declare, with its state for them and
 * what they can do about it. Bot grants are left out: they only decide which bot gets a value.
 */
export async function memberNeeds(ctx: Ctx, groupId: string, userId: string): Promise<SecretNeedDto[]> {
  const now = ctx.now()
  const [skills, rows, teamId] = await Promise.all([
    enabledSkills(ctx.db, groupId, userId),
    visibleSecrets(ctx.db, groupId),
    teamOfGroup(ctx.db, groupId),
  ])
  if (!teamId) return []
  const names = [...new Set(skills.flatMap((s) => s.secretSpecs.map((x) => x.name)))]
  if (!names.length) return []
  const mine = await ctx.db
    .select()
    .from(personalSecrets)
    .where(
      and(
        eq(personalSecrets.userId, userId),
        eq(personalSecrets.teamId, teamId),
        inArray(personalSecrets.name, names),
      ),
    )
  const admin = new Map<string, Promise<boolean>>()
  const canAdmin = (l: Layer) => {
    const key = `${l.scope}:${l.teamId}:${l.groupId}`
    if (!admin.has(key)) admin.set(key, isLayerAdmin(ctx, userId, l))
    return admin.get(key)!
  }
  const live = rows.filter((r) => r.enabled && !(r.expiresAt && r.expiresAt <= now))
  const out: SecretNeedDto[] = []
  for (const skill of skills)
    for (const spec of skill.secretSpecs) {
      const own = mine.find((m) => m.name === spec.name)
      const value = own && {
        last4: own.last4,
        updatedBy: null,
        updatedAt: own.updatedAt.toISOString(),
        allowForeignMachines: own.allowForeignMachines,
      }
      const base = {
        skill: skill.name,
        skillVersionId: skill.versionId,
        personalSkill: skill.scope === 'user',
        spec,
        mine: value ?? null,
      }
      const def = nearest(live, spec.name)
      if (!def) {
        const any = nearest(rows, spec.name)
        if (any) {
          const reason = blocked(any, '', now)!
          out.push({ ...base, status: 'blocked', reason, def: defRef(any), action: null })
          continue
        }
        const target = targetLayer(skill, spec, teamId, groupId)
        const mode = targetMode(skill, spec)
        const action =
          skill.scope === 'user' ? 'fill_new' : target && (await canAdmin(target)) ? 'create' : null
        out.push({ ...base, status: 'missing_def', target: target && { ...target, mode }, def: null, action })
        continue
      }
      const ref = defRef(def)
      if (def.mode === 'shared') {
        const filled = !!def.value
        const action = !filled && (await canAdmin(layerOf(def))) ? 'fill_shared' : null
        out.push({ ...base, status: filled ? 'ok' : 'unfilled', def: ref, action })
      } else {
        const filled = !!own || (def.mode === 'shared_overridable' && !!def.value)
        out.push({
          ...base,
          status: filled ? 'ok' : 'unfilled',
          def: ref,
          action: filled ? null : 'fill_personal',
        })
      }
    }
  return out
}

const layerOf = (r: SecretRow): Layer => ({
  scope: r.scope as Layer['scope'],
  teamId: r.teamId,
  groupId: r.groupId,
})

const defRef = (r: SecretRow) => ({
  id: r.id,
  scope: r.scope as 'platform' | 'team' | 'group',
  mode: r.mode as SecretMode,
  description: r.description,
  hasValue: !!r.value,
})

/** A declared secret's definition description: what the author wrote, capped as definitions are. */
export const specDescription = (spec: SecretRequirement) =>
  [spec.title, spec.description].filter(Boolean).join('：').slice(0, 500)

/**
 * My own value of my personal skill's secret where the group's team has no definition of it yet (plan §8.1): the
 * team gets a per-member definition from the skill's declaration, made by me filling it.
 */
export async function fillNewPersonal(ctx: Ctx, groupId: string, userId: string, body: FillNewSecretReq) {
  await requireMember(ctx, groupId, userId)
  const need = (await memberNeeds(ctx, groupId, userId)).find(
    (n) => n.spec.name === body.name && n.action === 'fill_new',
  )
  if (!need?.target?.teamId)
    return fail('conflict', '密钥 {name} 不需要这样填写，请刷新后重试', { name: body.name })
  const teamId = need.target.teamId
  const def = { name: body.name, description: specDescription(need.spec), mode: 'personal' as const }
  // A concurrent fill may have made it first: then it is there to fill.
  await createSecret(ctx, { scope: 'team', teamId, groupId: null }, CreateSecretReq.parse(def), userId, {
    skill: need.skill,
  }).catch((e) => {
    if (!(e instanceof HttpError && e.code === 'conflict')) throw e
  })
  await setPersonal(ctx, { userId, teamId, name: body.name }, body.value, body.allowForeignMachines)
}
