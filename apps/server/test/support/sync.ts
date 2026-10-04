import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { SyncChange, SyncSubmit } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { groups, syncReplicas } from '../../src/db/schema.js'
import type { TestApp } from './app.js'

export const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

/** Two machines, three bots (a and c share machine A), a force group with all three replicas joined. */
export async function syncWorld(t: TestApp) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const A = await t.seed.machine(wang.id, { name: 'wang-mac' })
  const B = await t.seed.machine(li.id, { name: 'li-pc' })
  const a = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: A.machine.id })
  const c = await t.seed.bot({ ownerId: wang.id, name: '小王的 Codex', machineId: A.machine.id })
  const b = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: B.machine.id })
  const g = await t.seed.group({
    createdBy: wang.id,
    name: '支付服务',
    memberIds: [li.id],
    botIds: [a.id, b.id, c.id],
  })
  await t.db.update(groups).set({ mode: 'force' }).where(eq(groups.id, g.id))
  await t.db
    .insert(syncReplicas)
    .values([a, b, c].map((bot) => ({ groupId: g.id, botId: bot.id, joinedAt: new Date() })))
  const auth = (token = A.token) => ({ authorization: `Bearer ${token}` })

  const put = (content: string | Buffer, o: { hash?: string; token?: string; gzip?: boolean } = {}) =>
    t.app.inject({
      method: 'PUT',
      url: `/api/daemon/sync/${g.id}/blobs/${o.hash ?? sha(content)}`,
      headers: {
        ...auth(o.token),
        'content-type': 'application/octet-stream',
        ...(o.gzip && { 'content-encoding': 'gzip' }),
      },
      payload: o.gzip ? gzipSync(content) : Buffer.from(content),
    })

  const msg = (
    botId: string,
    changes: SyncChange[],
    o: Partial<Omit<SyncSubmit, 't' | 'groupId' | 'botId' | 'changes'>> = {},
  ): SyncSubmit => ({
    t: 'sync.submit',
    groupId: g.id,
    botId,
    submitId: randomUUID(),
    runId: null,
    baseVersion: 0,
    kind: 'run',
    merged: false,
    changes,
    ...o,
  })

  return { wang, li, outsider, A, B, a, b, c, g, auth, put, msg }
}

/** An add / modify of `path` to `content` (uploaded first) from `base` (null = new file). */
export async function change(
  w: Awaited<ReturnType<typeof syncWorld>>,
  path: string,
  content: string | null,
  base: string | null = null,
  exec = false,
): Promise<SyncChange> {
  if (content !== null) await w.put(content)
  return {
    path,
    hash: content === null ? null : sha(content),
    baseHash: base === null ? null : sha(base),
    exec,
  }
}
