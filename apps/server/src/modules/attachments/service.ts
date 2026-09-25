import { resolve } from 'node:path'
import type { Attachment } from '@gonggong/protocol'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { attachments } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { isUuid } from '../../lib/ids.js'
import { sysParams } from '../admin/params.js'
import { redact } from '../runs/redact.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type AttachmentRow = typeof attachments.$inferSelect
export type Upload = Omit<Attachment, 'messageId'>

export const dataDir = () => resolve(process.env.GONGGONG_DATA_DIR ?? '.gonggong-dev/data')

/** Base name only: the daemon writes it under `.gonggong/attachments/<messageId>/`. Names are shown to the group, so
 * secrets in them are masked like run output. */
export function safeName(raw: string) {
  const base = redact(raw.split(/[/\\]/).pop() ?? '')
    .replace(/[\p{Cc}]/gu, '')
    .trim()
  return (base === '.' || base === '..' ? '' : base).slice(0, 200) || 'file'
}

/** Content-Type to serve inline, or null → download. Nothing that a browser could run as a page is inline. */
export function inlineType(mime: string) {
  if (mime.startsWith('text/')) return mime === 'text/html' ? null : 'text/plain; charset=utf-8'
  if (mime.startsWith('video/') || (mime.startsWith('image/') && mime !== 'image/svg+xml')) return mime
  return null
}

export const uploadDto = (r: AttachmentRow): Upload => ({
  id: r.id,
  name: r.name,
  size: r.size,
  mime: r.mime,
})

/** Binds the uploader's still-unbound uploads in this group to `messageId`, in the given order. */
export async function claimAttachments(
  tx: Tx,
  ids: string[],
  o: { uploaderId: string; groupId: string; messageId: string },
): Promise<Attachment[]> {
  if (!ids.length) return []
  const max = (await sysParams(tx)).attachmentsPerMessage
  if (ids.length > max) return fail('invalid', `每条消息最多 ${max} 个附件`)
  if (new Set(ids).size !== ids.length || !ids.every(isUuid)) return fail('invalid', '附件无效')
  const rows = await tx
    .update(attachments)
    .set({ messageId: o.messageId })
    .where(
      and(
        inArray(attachments.id, ids),
        eq(attachments.uploaderId, o.uploaderId),
        eq(attachments.groupId, o.groupId),
        isNull(attachments.messageId),
      ),
    )
    .returning()
  if (rows.length !== ids.length) return fail('invalid', '附件无效或已发送过')
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => ({ ...uploadDto(byId.get(id) as AttachmentRow), messageId: o.messageId }))
}
