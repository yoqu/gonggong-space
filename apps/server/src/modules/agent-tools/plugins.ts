import {
  AUTO_DESIGN_SYSTEM,
  type GONGGONG_TOOLS,
  groupDesignSystemKey,
  type PluginBlocker,
  type PluginManifest,
  templateInputs,
  usesDesignSystem,
} from '@gonggong/protocol'
import type { z } from 'zod'
import type { Ctx } from '../../context.js'
import { proposeCreation } from '../plugins/creations.js'
import { type GroupDesignSystem, listDesignSystems } from '../plugins/designSystems.js'
import { botStates, groupPluginList, pluginBlocker, pluginsOn } from '../plugins/service.js'
import type { Run } from './layers.js'
import { asTool, refuse, type ToolOutput } from './service.js'

type Args<N extends 'plugin_catalog' | 'creation_propose'> = z.infer<(typeof GONGGONG_TOOLS)[N]['input']>

/** In the system prompt of a turn that got plugins (agent-facing: not translated). */
export const pluginHint = (names: string[]) =>
  `本群启用了创作插件：${names.join('、')}。群成员在对话里提出这类创作需求（不是「请用插件…创作」的正式创作请求）时，先用 gonggong 的 plugin_catalog 挑模板和设计系统，再用 creation_propose 发创作确认卡，等成员点「开始」后会收到正式的创作请求，再按插件的 skill 出稿；没有这两个工具时直接按 skill 出稿。`

const BLOCKER: Record<PluginBlocker, string> = {
  agent: '不支持本 Bot 的 agent',
  offline: '机器离线',
  daemon: '机器版本过低',
  secret: '缺少所需密钥',
}

/** The group's enabled plugins with why the run's bot cannot use each, or none with the reason. */
async function enabled(ctx: Ctx, run: Run) {
  if (!(await pluginsOn(ctx.db))) return refuse('插件功能未开启')
  const list = (await groupPluginList(ctx.db, run.groupId)).filter((r) => r.enabledInGroup)
  if (!list.length) return refuse('本群没有启用插件，请群管理员在群设置「插件」里打开')
  const [bot] = await botStates(ctx, run.groupId, run.originUserId, run.botId)
  return list.map((r) => ({
    id: r.plugin.id,
    m: r.version.manifest,
    blocker: bot ? pluginBlocker(r.version.manifest, bot.state) : ('agent' as const),
  }))
}

const named = async (ctx: Ctx, run: Run, name: string) =>
  (await enabled(ctx, run)).find((p) => p.m.name === name) ??
  refuse(`本群没有启用插件 ${name}，先用 plugin_catalog 查看`)

function detail(m: PluginManifest, imported: GroupDesignSystem[]) {
  const input = (i: PluginManifest['inputs'][number]) =>
    `- ${i.id}｜${i.label}｜${i.type}${i.required ? '｜必填' : ''}${i.options.length ? `｜可选：${i.options.join(' / ')}` : ''}${i.default === null ? '' : `｜默认：${i.default}`}`
  return [
    `${m.name}（${m.title} v${m.version}）：${m.description}`,
    `模板（${m.templates.length}）：id｜标题｜分组｜说明｜输入项`,
    ...m.templates.map(
      (tp) =>
        `- ${tp.id}｜${tp.title}｜${tp.group ?? '—'}｜${tp.description || '—'}｜${templateInputs(m, tp)
          .map((i) => i.id)
          .join(', ')}${usesDesignSystem(m, tp) ? '' : '｜自带视觉，不用设计系统'}`,
    ),
    ...(m.designSystems.length
      ? [
          `设计系统（${m.designSystems.length}）：id｜标题｜分类｜说明｜色板`,
          ...m.designSystems.map(
            (d) =>
              `- ${d.id}｜${d.title}｜${d.category ?? '—'}｜${d.description || '—'}｜${d.swatches.join(' ')}`,
          ),
        ]
      : ['没有设计系统。']),
    ...(m.composer && m.designSystems.length
      ? [
          '也可以用 auto（按需求自动挑预设）。',
          ...(imported.length
            ? [
                `本群导入的设计系统（${imported.length}）：id｜标题｜来源`,
                ...imported.map(
                  (d) =>
                    `- ${groupDesignSystemKey(d.id)}｜${d.title}｜${[d.designMd && 'DESIGN.md', d.url, d.repo].filter(Boolean).join(' / ')}`,
                ),
              ]
            : []),
        ]
      : []),
    '输入项：id｜名称｜类型',
    ...m.inputs.map(input),
  ].join('\n')
}

export async function pluginCatalog(ctx: Ctx, run: Run, a: Args<'plugin_catalog'>): Promise<ToolOutput> {
  if (a.plugin) {
    const { m } = await named(ctx, run, a.plugin)
    return { text: detail(m, await listDesignSystems(ctx, run.groupId)), groups: [] }
  }
  const lines = (await enabled(ctx, run)).map(
    ({ m, blocker }) =>
      `- ${m.name}（${m.title}）：${m.description} 模板 ${m.templates.length} 个，设计系统 ${m.designSystems.length} 套；${blocker ? `本 Bot 现在用不了：${BLOCKER[blocker]}` : '可用'}`,
  )
  return { text: ['本群启用的插件：', ...lines, '用 plugin 参数查看模板和设计系统。'].join('\n'), groups: [] }
}

export async function creationPropose(ctx: Ctx, run: Run, a: Args<'creation_propose'>): Promise<ToolOutput> {
  const p = await named(ctx, run, a.plugin)
  if (p.blocker) return refuse(`本 Bot 现在用不了插件 ${a.plugin}：${BLOCKER[p.blocker]}`)
  const tpl = a.template ? p.m.templates.find((x) => x.id === a.template) : undefined
  const ds =
    a.designSystem ??
    (usesDesignSystem(p.m, tpl) ? (p.m.composer ? AUTO_DESIGN_SYSTEM : p.m.designSystems[0]?.id) : undefined)
  const { id, missing } = await asTool(() =>
    proposeCreation(
      ctx,
      run,
      {
        pluginId: p.id,
        templateId: a.template ?? null,
        designSystemId: ds ?? null,
        inputs: a.inputs ?? {},
        directions: a.directions ?? false,
      },
      a.note ?? null,
    ),
  )
  return {
    text: [
      `已发出创作确认卡（id：${id}）。群成员点「开始」后你会收到正式的创作请求，在那之前不要出稿。`,
      ...(missing.length ? [`卡片会提示成员补充：${missing.join('、')}`] : []),
    ].join('\n'),
    groups: [],
  }
}
