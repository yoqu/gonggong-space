import type { GONGGONG_TOOLS } from '@gonggong/protocol'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import type { Scope } from '../mcp/service.js'
import { type Audience, postSecretCard } from '../secrets/requests.js'
import { blocked, RANK, resolveSecrets, type SecretState } from '../secrets/resolve.js'
import { logSecret } from '../secrets/service.js'
import { LAYER, type Run } from './layers.js'
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
 * the admins of each definition's layer.
 */
export async function secretRequest(ctx: Ctx, run: Run, a: Args<'secret_request'>): Promise<ToolOutput> {
  const now = ctx.now()
  const { rows, states } = await resolveSecrets(ctx.db, run, now)
  const names = [...new Set(a.names)]
  const by: Record<Audience, string[]> = { origin: [], admins: [] }
  for (const name of names) {
    const s = states.find((x) => x.def.name === name)
    if (!s) {
      const any = rows.find((r) => r.name === name)
      refuse(
        any
          ? `密钥 ${name} ${blocked(any, run.botId, now)}，请管理员在设置里处理`
          : `本群没有名为 ${name} 的密钥定义，请用 secret_list 查看；新定义只能由管理员在设置里添加`,
      )
      continue
    }
    by[s.def.mode === 'shared' ? 'admins' : 'origin'].push(name)
  }
  const force = a.forceNewSession ?? false
  const posted: string[] = []
  for (const audience of ['origin', 'admins'] as const) {
    if (!by[audience].length) continue
    const card = await postSecretCard(ctx, run, audience, by[audience], force)
    await logSecret(
      ctx,
      run.originUserId,
      'secret.request',
      { layer: 'group', teamId: null, groupId: run.groupId },
      { requestId: card.id, names: by[audience], audience, botId: run.botId, runId: run.id },
    )
    posted.push(`${audience === 'origin' ? '请发起人填写' : '请管理员填写'}：${by[audience].join('、')}`)
  }
  return {
    text:
      `已在群里发出填写密钥卡片（${posted.join('；')}）。填写后下一轮注入${force ? '，相关 Bot 开新会话' : ''}。` +
      '你看不到密钥，也不要在对话里索要；之后可用 secret_list 查看是否已填写。',
    groups: [],
  }
}
