import { hash } from '@node-rs/argon2'
import { count } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { users } from '../../db/schema.js'
import { createTeam } from '../teams/service.js'

/**
 * First start: creates the `admin` sysadmin from GONGGONG_ADMIN_PASSWORD, owning the default team; it must change the
 * password on first login.
 */
export async function ensureBootstrapAdmin(ctx: Ctx, password: string | undefined) {
  if (!password) return
  const [row] = await ctx.db.select({ n: count() }).from(users)
  if (row?.n) return
  const passwordHash = await hash(password)
  await ctx.db.transaction(async (tx) => {
    const [admin] = (await tx
      .insert(users)
      .values({
        account: 'admin',
        name: '系统管理员',
        role: 'sysadmin',
        passwordHash,
        mustChangePassword: true,
      })
      .returning()) as [typeof users.$inferSelect]
    await createTeam(tx, '默认团队', admin.id)
  })
}
