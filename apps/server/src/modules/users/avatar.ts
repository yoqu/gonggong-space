import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import multipart from '@fastify/multipart'
import { AVATAR_MAX_BYTES, type AVATAR_TYPES } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { bots, feishuIdentities, groupMembers, users } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { openFile, sealStream } from '../../lib/seal.js'
import { assertNotDemo } from '../admin/params.js'
import { dataDir } from '../attachments/service.js'
import { requireUser } from '../auth/session.js'
import { publishBots } from '../bots/dto.js'
import { publishGroup } from '../groups/service.js'
import { meDto } from '../teams/dto.js'

const EXT: Record<(typeof AVATAR_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]))
const FILE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/
const LOCAL = 'avatars/'

/** Group members and bot owners see the caller's new name or avatar. */
export async function publishProfile(ctx: Ctx, userId: string) {
  const mine = await ctx.db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(eq(groupMembers.userId, userId))
  for (const g of mine) await publishGroup(ctx, g.id)
  await publishBots(ctx, eq(bots.ownerId, userId))
}

export function avatarRoutes(ctx: Ctx) {
  return async (app: FastifyInstance) => {
    await app.register(multipart)

    const setAvatar = async (user: typeof users.$inferSelect, avatar: string | null) => {
      const [row] = await ctx.db.update(users).set({ avatar }).where(eq(users.id, user.id)).returning()
      if (user.avatar?.startsWith(LOCAL)) await unlink(join(dataDir(), user.avatar)).catch(() => {})
      await publishProfile(ctx, user.id)
      return meDto(ctx, row ?? user)
    }

    app.put('/api/me/avatar', async (req) => {
      const user = await requireUser(ctx, req)
      const part = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } })
      if (!part) return fail('invalid', '缺少文件')
      const ext = EXT[part.mimetype as keyof typeof EXT]
      try {
        await assertNotDemo(ctx, user)
        if (!ext) fail('invalid', '头像仅支持 PNG、JPEG、WebP 或 GIF 图片')
      } catch (e) {
        part.file.resume()
        throw e
      }
      const key = `${LOCAL}${randomUUID()}.${ext}`
      const path = join(dataDir(), key)
      await mkdir(join(dataDir(), LOCAL), { recursive: true })
      try {
        await pipeline(part.file, sealStream(), createWriteStream(path))
        if (part.file.truncated) fail('invalid', '头像不能超过 {maxMb} MB', { maxMb: AVATAR_MAX_BYTES >> 20 })
      } catch (e) {
        await unlink(path).catch(() => {})
        throw e
      }
      return setAvatar(user, key)
    })

    app.post('/api/me/avatar/feishu', async (req) => {
      const user = await requireUser(ctx, req)
      await assertNotDemo(ctx, user)
      const [identity] = await ctx.db
        .select({ avatar: feishuIdentities.avatar })
        .from(feishuIdentities)
        .where(eq(feishuIdentities.userId, user.id))
      if (!identity?.avatar) return fail('invalid', '未绑定飞书或飞书账号没有头像')
      return setAvatar(user, identity.avatar)
    })

    app.delete('/api/me/avatar', async (req) => {
      const user = await requireUser(ctx, req)
      await assertNotDemo(ctx, user)
      return setAvatar(user, null)
    })

    app.get<{ Params: { file: string } }>('/api/avatars/:file', async (req, reply) => {
      await requireUser(ctx, req)
      const { file } = req.params
      if (!FILE.test(file)) return fail('not_found', '头像不存在')
      const stream = await openFile(join(dataDir(), LOCAL, file)).catch(() => fail('not_found', '头像不存在'))
      return reply
        .header('content-type', MIME[file.split('.')[1] as string])
        .header('cache-control', 'private, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(stream)
    })
  }
}
