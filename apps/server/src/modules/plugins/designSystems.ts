import {
  type CreateGroupDesignSystemReq,
  designMdSwatches,
  designMdTitle,
  type GroupDesignSystemDto,
} from '@gonggong/protocol'
import { and, desc, eq } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { groupDesignSystems } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'

export type GroupDesignSystem = typeof groupDesignSystems.$inferSelect

export const designSystemDto = (r: GroupDesignSystem): GroupDesignSystemDto => ({
  id: r.id,
  groupId: r.groupId,
  title: r.title,
  swatches: r.designMd ? designMdSwatches(r.designMd) : [],
  designMd: r.designMd,
  url: r.url,
  repo: r.repo,
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
})

/** The DESIGN.md's name, else the site's host or the repository's last segment. */
function titleOf(req: CreateGroupDesignSystemReq) {
  const md = req.designMd && designMdTitle(req.designMd)
  if (md) return md
  if (req.url) return new URL(req.url).host
  const repo = req.repo
    ?.replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .split(/[/:]/)
    .pop()
  return repo || '我的设计'
}

export const listDesignSystems = (ctx: Ctx, groupId: string) =>
  ctx.db
    .select()
    .from(groupDesignSystems)
    .where(eq(groupDesignSystems.groupId, groupId))
    .orderBy(desc(groupDesignSystems.createdAt))

export async function createDesignSystem(
  ctx: Ctx,
  groupId: string,
  userId: string,
  req: CreateGroupDesignSystemReq,
) {
  const [row] = await ctx.db
    .insert(groupDesignSystems)
    .values({
      groupId,
      title: titleOf(req),
      designMd: req.designMd ?? null,
      url: req.url ?? null,
      repo: req.repo ?? null,
      createdBy: userId,
    })
    .returning()
  return row as GroupDesignSystem
}

export async function findDesignSystem(ctx: Ctx, groupId: string, id: string) {
  if (!isUuid(id)) return null
  const [row] = await ctx.db
    .select()
    .from(groupDesignSystems)
    .where(and(eq(groupDesignSystems.groupId, groupId), eq(groupDesignSystems.id, id)))
  return row ?? null
}

/** The importer or a group admin. */
export async function deleteDesignSystem(
  ctx: Ctx,
  groupId: string,
  id: string,
  me: { id: string; isAdmin: boolean },
) {
  const row = (await findDesignSystem(ctx, groupId, id)) ?? fail('not_found', '设计系统不存在')
  if (row.createdBy !== me.id && !me.isAdmin) fail('forbidden', '只有导入的人或群管理员可以删除')
  await ctx.db.delete(groupDesignSystems).where(eq(groupDesignSystems.id, row.id))
}
