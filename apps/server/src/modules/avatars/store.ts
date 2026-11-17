import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { AVATAR_MAX_BYTES, type AVATAR_TYPES } from '@gonggong/protocol'
import type { FastifyRequest } from 'fastify'
import type { Ctx } from '../../context.js'
import { fail } from '../../lib/errors.js'
import { sealStream } from '../../lib/seal.js'
import { assertNotDemo } from '../admin/params.js'
import { dataDir } from '../attachments/service.js'
import type { SessionUser } from '../auth/session.js'

export const EXT: Record<(typeof AVATAR_TYPES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
export const LOCAL = 'avatars/'

/** Stores the request's multipart `file` as `avatars/<uuid>.<ext>` and returns that key. */
export async function receiveAvatar(ctx: Ctx, req: FastifyRequest, user: SessionUser) {
  const part = await req.file({ limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } })
  if (!part) return fail('invalid', '请先选择要上传的文件')
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
  return key
}

/** Deletes a replaced avatar's file; glyphs, role keys and Feishu URLs have none. */
export async function dropAvatar(avatar: string | null | undefined) {
  if (avatar?.startsWith(LOCAL)) await unlink(join(dataDir(), avatar)).catch(() => {})
}
