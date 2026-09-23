import { hash } from '@node-rs/argon2'
import { count } from 'drizzle-orm'
import type { Ctx } from '../../context.js'
import { users } from '../../db/schema.js'

/** First start: creates the `admin` sysadmin from AIWS_ADMIN_PASSWORD; it must change the password on first login. */
export async function ensureBootstrapAdmin(ctx: Ctx, password: string | undefined) {
  if (!password) return
  const [row] = await ctx.db.select({ n: count() }).from(users)
  if (row?.n) return
  await ctx.db.insert(users).values({
    account: 'admin',
    name: '系统管理员',
    role: 'sysadmin',
    passwordHash: await hash(password),
    mustChangePassword: true,
  })
}
