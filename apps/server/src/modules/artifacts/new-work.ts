import { randomUUID } from 'node:crypto'
import {
  AUTO_DESIGN_SYSTEM,
  createsArtifacts,
  type NewWorkReq,
  NewWorkType,
  usesDesignSystem,
  type WorkStarterDto,
} from '@gonggong/protocol'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { artifacts, groups, messages } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { instructions, resolve } from '../plugins/creations.js'
import { groupPluginList, requirePluginsOn } from '../plugins/service.js'
import { artifactGuestBot } from './chat.js'
import { editorVersionFor } from './editors.js'
import { pluginKit } from './kit.js'
import { type Artifact, newArtifactDir } from './service.js'

/** The caller's hidden 作品空间 in `teamId` (group kind `works`, no members), made on first use. */
async function worksSpace(ctx: Ctx, userId: string, teamId: string) {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`works-space:${teamId}:${userId}`}))`)
    const mine = and(
      eq(groups.teamId, teamId),
      eq(groups.createdBy, userId),
      eq(groups.kind, 'works'),
      isNull(groups.archivedAt),
    )
    const [found] = await tx.select().from(groups).where(mine)
    if (found) return found
    const [made] = await tx
      .insert(groups)
      .values({ teamId, name: '作品空间', kind: 'works', visibility: 'private', createdBy: userId })
      .returning()
    return made as typeof groups.$inferSelect
  })
}

type PluginRow = Awaited<ReturnType<typeof groupPluginList>>[number]

const STARTERS: Record<
  NewWorkType,
  { plugin: string; fits: (m: PluginRow['version']['manifest']) => boolean }
> = {
  prototype: {
    plugin: 'web-prototype',
    fits: (m) => (m.artifact?.kind ?? 'prototype') === 'prototype' && m.category === 'web',
  },
  // Slides plugins made before kinds existed declare none (prototype): their category says what they make.
  slides: {
    plugin: 'slides',
    fits: (m) =>
      (m.artifact?.kind ?? 'prototype') === 'prototype'
        ? m.category === 'deck'
        : m.artifact?.kind === 'slides',
  },
}

/** The plugin 作品 新建 starts `type` from in the space: the official one when on, else the first that fits. */
function starterPlugin(list: PluginRow[], type: NewWorkType) {
  const { plugin, fits } = STARTERS[type]
  const on = list.filter(
    (r) => r.enabledInGroup && createsArtifacts(r.version.manifest) && fits(r.version.manifest),
  )
  return on.find((r) => r.plugin.name === plugin) ?? on[0] ?? null
}

/** GET /api/works/starters: the types 作品 新建 offers the caller, each with the templates it can start from. */
export async function workStarters(ctx: Ctx, me: { id: string }, teamId: string): Promise<WorkStarterDto[]> {
  await requirePluginsOn(ctx.db)
  const list = await groupPluginList(ctx.db, (await worksSpace(ctx, me.id, teamId)).id)
  return NewWorkType.options.flatMap((type) => {
    const found = starterPlugin(list, type)
    if (!found) return []
    const m = found.version.manifest
    return [
      {
        type,
        pluginId: found.plugin.id,
        pluginTitle: m.title,
        templates: m.templates.map((tp) => ({
          id: tp.id,
          title: tp.title,
          description: tp.description,
          group: tp.group,
          preview: tp.preview,
        })),
      },
    ]
  })
}

/**
 * POST /api/works: 作品 新建 with one of the AIs open for works, no group needed. An empty work of `type` in the
 * caller's 作品空间, the AI a guest there; its 画布 AI 对话 opens with how to create it, and the first message there says
 * what.
 */
export async function newWork(ctx: Ctx, me: { id: string }, teamId: string, req: NewWorkReq) {
  await requirePluginsOn(ctx.db)
  const space = await worksSpace(ctx, me.id, teamId)
  const bot =
    (await artifactGuestBot(ctx, space, req.botId)) ??
    fail('invalid', '这个 Bot 暂不支持创作作品，请从列表里选择可用的 Bot')
  const found =
    starterPlugin(await groupPluginList(ctx.db, space.id), req.type) ??
    fail('conflict', req.type === 'slides' ? '没有可用的幻灯片插件' : '没有可用的产品原型插件')
  const m = found.version.manifest
  const template = req.templateId
    ? (m.templates.find((tp) => tp.id === req.templateId) ?? fail('invalid', '模板不存在'))
    : (m.templates[0] ?? null)
  const kind = m.artifact?.kind ?? 'prototype'
  const { card, design, versionId } = await resolve(
    ctx,
    space.id,
    me.id,
    {
      pluginId: found.plugin.id,
      templateId: template?.id ?? null,
      designSystemId: usesDesignSystem(m, template) ? AUTO_DESIGN_SYSTEM : null,
      inputs: {},
      directions: false,
      botId: bot.id,
    },
    true,
  )
  const l1 = !!(await pluginKit(ctx.db, versionId))
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(artifacts)
      .values({
        groupId: space.id,
        pluginId: found.plugin.id,
        pluginVersionId: versionId,
        kind,
        editorVersion: editorVersionFor(kind),
        title: req.type === 'slides' ? '未命名幻灯片' : '未命名作品',
        dir: newArtifactDir(template?.id ?? m.name),
        botId: bot.id,
        visibility: 'private',
        createdBy: me.id,
      })
      .returning()
    const a = row as Artifact
    const id = randomUUID()
    await tx.insert(messages).values({
      id,
      groupId: space.id,
      kind: 'event',
      // Agent-facing: the start of its 画布 AI 对话 (artifactChatRoot finds it by `artifactChat`).
      body: [
        `画布 AI 对话：产物「${a.title}」`,
        instructions(m, card, design, { dir: a.dir }, l1),
        '要做什么以本对话里用户的消息为准；第一版做完后按对话继续修改。',
      ].join('\n'),
      meta: { mentions: [], artifactChat: a.id },
      threadRootId: id,
    })
    return { artifactId: a.id }
  })
}
