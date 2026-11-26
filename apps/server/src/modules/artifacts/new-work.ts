import { randomUUID } from 'node:crypto'
import { AUTO_DESIGN_SYSTEM, createsArtifacts, usesDesignSystem } from '@gonggong/protocol'
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

/**
 * POST /api/works: 作品 新建 with one of the AIs open for works, no group needed. An empty prototype in the caller's
 * 作品空间, the AI a guest there; its 画布 AI 对话 opens with how to create it, and the first message there says what.
 */
export async function newWork(ctx: Ctx, me: { id: string }, teamId: string, botId: string) {
  await requirePluginsOn(ctx.db)
  const space = await worksSpace(ctx, me.id, teamId)
  const bot =
    (await artifactGuestBot(ctx, space, botId)) ??
    fail('invalid', '这个 Bot 暂不支持创作作品，请从列表里选择可用的 Bot')
  const prototypes = (await groupPluginList(ctx.db, space.id)).filter(
    (r) =>
      r.enabledInGroup &&
      createsArtifacts(r.version.manifest) &&
      (r.version.manifest.artifact?.kind ?? 'prototype') === 'prototype',
  )
  const found =
    prototypes.find((r) => r.plugin.name === 'web-prototype') ??
    prototypes[0] ??
    fail('conflict', '没有可用的产品原型插件')
  const m = found.version.manifest
  const template = m.templates[0] ?? null
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
        kind: 'prototype',
        editorVersion: editorVersionFor('prototype'),
        title: '未命名作品',
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
