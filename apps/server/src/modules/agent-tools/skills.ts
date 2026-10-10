import type { GONGGONG_TOOLS, SkillFile } from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { groups, type runs, skills, skillVersions } from '../../db/schema.js'
import { HttpError } from '../../lib/errors.js'
import { requireAdmin } from '../groups/service.js'
import { type Layer, RANK, type Scope } from '../mcp/routes.js'
import {
  createSkill,
  deleteSkill,
  findSkill,
  type Listed,
  listed,
  mergeSkills,
  rollbackSkill,
  skillVersion,
  skillVersionList,
  snapshot,
  updateSkill,
  visibleIn,
} from '../skills/service.js'
import { requireTeam } from '../teams/service.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Run = typeof runs.$inferSelect
type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>
type Writable = 'group' | 'team'

const LAYER: Record<Scope, string> = { platform: '平台层', team: '团队层', group: '群层' }
const DENIED: Record<Writable, string> = {
  group: '发起人不是本群管理员，不能修改群层 Skill',
  team: '发起人不是本群所属团队的管理员，不能修改团队层 Skill',
}

const PLATFORM: Layer = { scope: 'platform', teamId: null, groupId: null }

const time = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')

async function teamOf(ctx: Ctx, run: Run) {
  const [g] = await ctx.db.select({ teamId: groups.teamId }).from(groups).where(eq(groups.id, run.groupId))
  return g!.teamId
}

async function layerOf(ctx: Ctx, run: Run, scope: Writable = 'group'): Promise<Layer> {
  const teamId = await teamOf(ctx, run)
  return { scope, teamId, groupId: scope === 'group' ? run.groupId : null }
}

/** Whether the run's originator may change the layer on the web (as `eachLayer`). */
async function canEdit(ctx: Ctx, run: Run, l: Layer) {
  try {
    if (l.scope === 'group') await requireAdmin(ctx, run.groupId, run.originUserId)
    else if (l.scope === 'team') await requireTeam(ctx, run.originUserId, l.teamId!, 'admin')
    else return false
    return true
  } catch (e) {
    if (e instanceof HttpError) return false
    throw e
  }
}

/** The originator's writable layer, refused with a correctable reason. */
async function writable(ctx: Ctx, run: Run, scope: Writable = 'group') {
  const l = await layerOf(ctx, run, scope)
  if (!(await canEdit(ctx, run, l))) refuse(DENIED[scope])
  return l
}

async function named(ctx: Ctx, l: Layer, name: string) {
  return (
    (await findSkill(ctx, l, eq(skills.name, name))) ??
    refuse(`本群没有名为「${name}」的${LAYER[l.scope]} Skill，请用 skill_list 查看`)
  )
}

const audited = (run: Run) => ({ botId: run.botId, runId: run.id })

export async function skillList(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const rows = await listed(ctx.db).where(visibleIn(ctx.db, run.groupId))
  if (!rows.length) return { text: '本群还没有 Skill', groups: [] }
  const winner = new Map(
    mergeSkills(rows.filter((r) => r.skill.enabled).map((r) => r.skill)).map((s) => [s.name, s]),
  )
  const team = await teamOf(ctx, run)
  const edit = {
    platform: false,
    team: await canEdit(ctx, run, { scope: 'team', teamId: team, groupId: null }),
    group: await canEdit(ctx, run, { scope: 'group', teamId: team, groupId: run.groupId }),
  }
  const lines = rows
    .sort(
      (a, b) =>
        a.skill.name.localeCompare(b.skill.name) ||
        RANK[b.skill.scope as Scope] - RANK[a.skill.scope as Scope],
    )
    .flatMap(({ skill, version }) => {
      const scope = skill.scope as Scope
      const over = winner.get(skill.name)!
      const state = !skill.enabled
        ? '已停用'
        : over === skill
          ? '生效'
          : `被${LAYER[over.scope as Scope]}同名 Skill 覆盖`
      const right = scope === 'platform' ? '只读' : edit[scope] ? '可修改' : '发起人无权修改'
      return [
        `- ${skill.name} · ${LAYER[scope]} · v${version.version} · ${state} · ${right}`,
        `  说明：${skill.description}`,
      ]
    })
  return {
    text: [`本群可见的 Skill（${rows.length} 个，同名时群层覆盖团队层、团队层覆盖平台层）：`, ...lines].join(
      '\n',
    ),
    groups: [],
  }
}

export async function skillGet(ctx: Ctx, run: Run, a: Args<'skill_get'>): Promise<ToolOutput> {
  let row: Listed
  if (a.layer) {
    const l = a.layer === 'platform' ? PLATFORM : await layerOf(ctx, run, a.layer)
    row = await named(ctx, l, a.name)
  } else {
    const rows = await listed(ctx.db).where(and(visibleIn(ctx.db, run.groupId), eq(skills.name, a.name)))
    const pick =
      mergeSkills(rows.filter((r) => r.skill.enabled).map((r) => r.skill))[0] ??
      mergeSkills(rows.map((r) => r.skill))[0]
    row =
      rows.find((r) => r.skill === pick) ?? refuse(`本群没有名为「${a.name}」的 Skill，请用 skill_list 查看`)
  }
  const { skill } = row
  let version = row.version
  if (a.version !== undefined && a.version !== version.version)
    version =
      (await skillVersion(ctx, skill.id, eq(skillVersions.version, a.version)))?.version ??
      refuse(`「${skill.name}」没有 v${a.version}，请用 skill_versions 查看`)
  const files = version.files as SkillFile[]
  const current = version.id === skill.versionId ? ' ' : `（当前 v${row.version.version}）`
  const out = [
    `「${skill.name}」· ${LAYER[skill.scope as Scope]} · v${version.version}${current}· ${skill.enabled ? '已启用' : '已停用'}`,
    `说明：${skill.description}`,
    `共 ${files.length} 个文件：`,
    ...files.flatMap((f) => [
      `=== ${f.path} ===`,
      f.encoding === 'base64'
        ? `（二进制文件，${Buffer.from(f.content, 'base64').length} 字节，内容省略）`
        : f.content,
    ]),
  ]
  return { text: out.join('\n'), groups: [] }
}

export async function skillCreate(ctx: Ctx, run: Run, a: Args<'skill_create'>): Promise<ToolOutput> {
  const l = await writable(ctx, run, a.layer)
  const row = await asTool(() => createSkill(ctx, l, snapshot(a.files), true, run.originUserId, audited(run)))
  return { text: `已新建${LAYER[l.scope]} Skill「${row.name}」（v1），下一轮生效`, groups: [] }
}

export async function skillUpdate(ctx: Ctx, run: Run, a: Args<'skill_update'>): Promise<ToolOutput> {
  const l = await writable(ctx, run, a.layer)
  const current = await named(ctx, l, a.name)
  if (!a.files?.length && !a.remove?.length) refuse('请提供要新增或覆盖的 files，或要删除的 remove')
  const files = new Map((current.version.files as SkillFile[]).map((f) => [f.path, f]))
  for (const path of a.remove ?? []) if (!files.delete(path)) refuse(`「${a.name}」没有文件 ${path}`)
  for (const f of a.files ?? []) files.set(f.path, f)
  return asTool(async () => {
    const s = snapshot([...files.values()])
    if (s.digest === current.version.digest) return { text: '内容没有变化，无需更新', groups: [] }
    const { skill, version } = await updateSkill(
      ctx,
      l,
      current,
      { snapshot: s },
      run.originUserId,
      audited(run),
    )
    const renamed = skill.name === a.name ? '' : `（原名「${a.name}」）`
    return {
      text: `已更新${LAYER[l.scope]} Skill「${skill.name}」${renamed}：v${version}，下一轮生效`,
      groups: [],
    }
  })
}

export async function skillDelete(ctx: Ctx, run: Run, a: Args<'skill_delete'>): Promise<ToolOutput> {
  const l = await writable(ctx, run, a.layer)
  const { skill } = await named(ctx, l, a.name)
  await deleteSkill(ctx, l, skill, run.originUserId, audited(run))
  return { text: `已删除${LAYER[l.scope]} Skill「${skill.name}」及其全部版本`, groups: [] }
}

export async function skillToggle(ctx: Ctx, run: Run, a: Args<'skill_toggle'>): Promise<ToolOutput> {
  const l = await writable(ctx, run, a.layer)
  const current = await named(ctx, l, a.name)
  const state = a.enabled ? '启用' : '停用'
  if (current.skill.enabled === a.enabled)
    return { text: `${LAYER[l.scope]} Skill「${a.name}」已是${state}状态`, groups: [] }
  await updateSkill(ctx, l, current, { enabled: a.enabled }, run.originUserId, audited(run))
  return { text: `已${state}${LAYER[l.scope]} Skill「${a.name}」，下一轮生效`, groups: [] }
}

export async function listSkillVersions(ctx: Ctx, run: Run, a: Args<'skill_versions'>): Promise<ToolOutput> {
  const l = await layerOf(ctx, run, a.layer)
  const { skill } = await named(ctx, l, a.name)
  const rows = await skillVersionList(ctx, skill.id)
  const lines = rows.map(({ version: v, createdBy }) => {
    const current = v.id === skill.versionId ? '（当前）' : ' '
    return `- v${v.version}${current}· ${v.size} 字节 · ${createdBy ?? '已删除用户'} · ${time(v.createdAt)}`
  })
  return { text: [`「${skill.name}」（${LAYER[l.scope]}）的版本：`, ...lines].join('\n'), groups: [] }
}

export async function skillRollback(ctx: Ctx, run: Run, a: Args<'skill_rollback'>): Promise<ToolOutput> {
  const l = await writable(ctx, run, a.layer)
  const { skill } = await named(ctx, l, a.name)
  const v =
    (await skillVersion(ctx, skill.id, eq(skillVersions.version, a.version)))?.version ??
    refuse(`「${skill.name}」没有 v${a.version}，请用 skill_versions 查看`)
  if (v.id === skill.versionId) return { text: `v${a.version} 已是当前版本`, groups: [] }
  const row = await asTool(() => rollbackSkill(ctx, l, skill, v, run.originUserId, audited(run)))
  return { text: `已把${LAYER[l.scope]} Skill「${row.name}」回滚到 v${v.version}，下一轮生效`, groups: [] }
}
