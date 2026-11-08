import { type SidebarSectionDto, SidebarSectionOrderReq, SidebarSectionReq } from '@gonggong/protocol'
import { and, asc, eq, max } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { sidebarSections } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { requireUser } from '../auth/session.js'
import { currentTeam } from '../teams/service.js'

type Params = { Params: { id: string } }

export async function mySections(ctx: Ctx, userId: string, teamId: string): Promise<SidebarSectionDto[]> {
  return ctx.db
    .select({ id: sidebarSections.id, name: sidebarSections.name })
    .from(sidebarSections)
    .where(and(eq(sidebarSections.userId, userId), eq(sidebarSections.teamId, teamId)))
    .orderBy(asc(sidebarSections.position), asc(sidebarSections.createdAt))
}

/** One of `userId`'s own sections in `teamId`. */
export async function requireSection(ctx: Ctx, userId: string, teamId: string, id: string) {
  const [row] = isUuid(id)
    ? await ctx.db
        .select()
        .from(sidebarSections)
        .where(
          and(
            eq(sidebarSections.id, id),
            eq(sidebarSections.userId, userId),
            eq(sidebarSections.teamId, teamId),
          ),
        )
    : []
  return row ?? fail('not_found', '分区不存在')
}

/** 侧栏自建分区: each user's own sections, per team. */
export function sidebarRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    app.get('/api/sidebar-sections', async (req) => {
      const me = await requireUser(ctx, req)
      return mySections(ctx, me.id, await currentTeam(ctx, req, me.id))
    })

    app.post('/api/sidebar-sections', async (req): Promise<SidebarSectionDto> => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      const { name } = SidebarSectionReq.parse(req.body)
      const [last] = await ctx.db
        .select({ position: max(sidebarSections.position) })
        .from(sidebarSections)
        .where(and(eq(sidebarSections.userId, me.id), eq(sidebarSections.teamId, teamId)))
      const [row] = await ctx.db
        .insert(sidebarSections)
        .values({ teamId, userId: me.id, name, position: (last?.position ?? -1) + 1 })
        .returning({ id: sidebarSections.id, name: sidebarSections.name })
      return row!
    })

    app.patch<Params>('/api/sidebar-sections/:id', async (req): Promise<SidebarSectionDto> => {
      const me = await requireUser(ctx, req)
      const sec = await requireSection(ctx, me.id, await currentTeam(ctx, req, me.id), req.params.id)
      const { name } = SidebarSectionReq.parse(req.body)
      await ctx.db.update(sidebarSections).set({ name }).where(eq(sidebarSections.id, sec.id))
      return { id: sec.id, name }
    })

    app.put('/api/sidebar-sections/order', async (req) => {
      const me = await requireUser(ctx, req)
      const teamId = await currentTeam(ctx, req, me.id)
      const { ids } = SidebarSectionOrderReq.parse(req.body)
      const mine = await mySections(ctx, me.id, teamId)
      if (ids.length !== mine.length || !mine.every((s) => ids.includes(s.id)))
        return fail('conflict', '分区已变化，请刷新后重试')
      await ctx.db.transaction(async (tx) => {
        for (const [position, id] of ids.entries())
          await tx.update(sidebarSections).set({ position }).where(eq(sidebarSections.id, id))
      })
      return mySections(ctx, me.id, teamId)
    })

    app.delete<Params>('/api/sidebar-sections/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const sec = await requireSection(ctx, me.id, await currentTeam(ctx, req, me.id), req.params.id)
      await ctx.db.delete(sidebarSections).where(eq(sidebarSections.id, sec.id))
      return reply.status(204).send()
    })
  }
}
