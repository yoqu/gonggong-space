import type { GONGGONG_TOOLS, SecretRequirement } from '@gonggong/protocol'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Layer, Scope } from '../mcp/service.js'
import { type EffectiveSkill, targetLayer } from '../secrets/needs.js'
import { askValues, postDefineCard } from '../secrets/requests.js'
import { blocked, RANK, resolveSecrets, type SecretState } from '../secrets/resolve.js'
import { logSecret } from '../secrets/service.js'
import { enabledSkills } from '../skills/service.js'
import { LAYER, type Run, teamOf } from './layers.js'
import { refuse, type ToolOutput } from './service.js'

type Args<N extends keyof typeof GONGGONG_TOOLS> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>

const SOURCE: Record<string, string> = { personal: '发起人的个人值', ...LAYER }

function filled(s: SecretState) {
  const shared = s.def.value ? '统一值已填写' : '统一值未填写'
  const mine = !s.mine
    ? '发起人未填写个人值'
    : s.mineUsable
      ? '发起人已填写个人值'
      : '发起人已填写个人值（未允许在他人机器上使用；可用 secret_request 重新发卡片，请发起人在卡片里勾选允许）'
  if (s.def.mode === 'shared') return shared
  if (s.def.mode === 'personal') return mine
  return `${shared} · ${mine}`
}

export async function secretList(ctx: Ctx, run: Run): Promise<ToolOutput> {
  const now = ctx.now()
  const { rows, states } = await resolveSecrets(ctx.db, run, now)
  if (!rows.length) return { text: '本群还没有密钥', groups: [] }
  const won = new Map(states.map((s) => [s.def.id, s]))
  const winner = new Map(states.map((s) => [s.def.name, s.def]))
  const injected = new Map(run.secrets.map((s) => [s.name, s.source]))
  const lines = rows
    .sort((a, b) => a.name.localeCompare(b.name) || (RANK[b.scope] ?? 0) - (RANK[a.scope] ?? 0))
    .map((r) => {
      const head = `- ${r.name} · ${LAYER[r.scope as Scope]} · ${r.mode}`
      const about = r.description ? ` · 用途：${r.description}` : ''
      const s = won.get(r.id)
      if (!s) {
        const over = winner.get(r.name)
        const why = blocked(r, run.botId, now) ?? `被${LAYER[over?.scope as Scope]}同名密钥覆盖`
        return `${head} · ${why}${about}`
      }
      const source = injected.get(r.name)
      const inj = source ? `本轮已注入（${SOURCE[source]}）` : '本轮未注入'
      return `${head} · ${filled(s)} · ${inj}${about}`
    })
  return {
    text: [
      `本群可见的密钥（${rows.length} 个，同名时群层覆盖团队层、团队层覆盖平台层；值不会显示，已注入的用 $名称 读取）：`,
      ...lines,
    ].join('\n'),
    groups: [],
  }
}

/**
 * One card per audience: personal and overridable names ask the originator for their own value, shared names ask
 * the admins of each definition's layer. A name a group skill declares without a definition asks that layer's admins
 * to make it from the declaration (plan Skill密钥声明 §7); the agent never makes one.
 */
export async function secretRequest(ctx: Ctx, run: Run, a: Args<'secret_request'>): Promise<ToolOutput> {
  const now = ctx.now()
  const { rows, states } = await resolveSecrets(ctx.db, run, now)
  const names = [...new Set(a.names)]
  const missing = names.filter((name) => !states.some((x) => x.def.name === name))
  const define = new Map<string, { skill: EffectiveSkill; specs: SecretRequirement[]; layer: Layer }>()
  if (missing.length) {
    const skills = await enabledSkills(ctx.db, run.groupId, run.originUserId)
    const teamId = await teamOf(ctx, run)
    for (const name of missing) {
      const any = rows.find((r) => r.name === name)
      if (any) refuse(`密钥 ${name} ${blocked(any, run.botId, now)}，请管理员在设置里处理`)
      const skill = skills.find((s) => s.secretSpecs.some((x) => x.name === name))
      if (!skill)
        refuse(`本群没有名为 ${name} 的密钥定义，请用 secret_list 查看；新定义只能由管理员在设置里添加`)
      const declared = skill!
      if (declared.scope === 'user')
        refuse(
          `${name} 由发起人的个人 Skill ${declared.name} 声明，本团队还没有这个定义；请发起人在群输入框上方的密钥提示里填写，填写时会一并创建`,
        )
      const spec = declared.secretSpecs.find((x) => x.name === name)!
      const layer = targetLayer(declared, spec, teamId, run.groupId)
      if (!layer)
        refuse(`${name} 由平台 Skill ${declared.name} 声明，本群还没有定义；请平台管理员在设置里添加`)
      const key = `${declared.name}/${layer!.scope}`
      const entry = define.get(key) ?? { skill: declared, specs: [], layer: layer! }
      entry.specs.push(spec)
      define.set(key, entry)
    }
  }
  const force = a.forceNewSession ?? false
  const lines: string[] = []
  for (const { skill, specs, layer } of define.values()) {
    const card = await postDefineCard(ctx, run, skill, specs, {
      scope: layer.scope as 'team' | 'group',
      teamId: layer.teamId!,
      groupId: layer.groupId,
    })
    await logSecret(
      ctx,
      run.originUserId,
      'secret.request',
      { layer: 'group', teamId: null, groupId: run.groupId },
      { requestId: card.id, names: card.names, audience: 'define', botId: run.botId, runId: run.id },
    )
    lines.push(
      `请管理员按 Skill ${skill.name} 的声明创建：${card.names.join('、')}（创建后会自动发填写卡片）`,
    )
  }
  for (const p of await askValues(
    ctx,
    run,
    names.filter((n) => !missing.includes(n)),
    force,
  )) {
    await logSecret(
      ctx,
      run.originUserId,
      'secret.request',
      { layer: 'group', teamId: null, groupId: run.groupId },
      { requestId: p.id, names: p.names, audience: p.audience, botId: run.botId, runId: run.id },
    )
    lines.push(`${p.audience === 'origin' ? '请发起人填写' : '请管理员填写'}：${p.names.join('、')}`)
  }
  return {
    text:
      `已在群里发出密钥卡片（${lines.join('；')}）。填写后下一轮注入${force ? '，相关 Bot 开新会话' : ''}。` +
      '你看不到密钥，也不要在对话里索要；之后可用 secret_list 查看是否已填写。',
    groups: [],
  }
}
