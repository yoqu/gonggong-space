import { randomUUID } from 'node:crypto'
import type { ArtifactFile } from '@gonggong/protocol'
import { artifacts, messages, runs } from '../../src/db/schema.js'
import type { TestApp } from './app.js'
import { sha } from './sync.js'

/** wang's bot on machine A in group g (li is a member); a second artifact and an outsider's group and machine. */
export async function artifactWorld(t: TestApp) {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const outsider = await t.seed.user({ name: '路人' })
  const A = await t.seed.machine(wang.id, { name: 'wang-mac' })
  const B = await t.seed.machine(outsider.id, { name: 'other-pc' })
  const bot = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: A.machine.id })
  const other = await t.seed.bot({ ownerId: outsider.id, name: '路人的 Claude', machineId: B.machine.id })
  const g = await t.seed.group({ createdBy: wang.id, name: '设计群', memberIds: [li.id], botIds: [bot.id] })
  const g2 = await t.seed.group({ createdBy: outsider.id, name: '别的群', botIds: [other.id] })

  const artifact = async (o: Partial<typeof artifacts.$inferInsert> = {}) =>
    (
      await t.db
        .insert(artifacts)
        .values({
          groupId: g.id,
          title: '活动报名',
          dir: `design/app-${randomUUID().slice(0, 6)}`,
          botId: bot.id,
          ...o,
        })
        .returning()
    )[0]!

  /** A run of `botId` in `groupId` that was sent `ids`. */
  const run = async (ids: string[], o: { botId?: string; groupId?: string; status?: string } = {}) => {
    const groupId = o.groupId ?? g.id
    const [m] = await t.db
      .insert(messages)
      .values({ groupId, kind: 'user', authorUserId: wang.id, body: '@bot go' })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId,
        botId: o.botId ?? bot.id,
        triggerMessageId: m!.id,
        triggerUserId: wang.id,
        originUserId: wang.id,
        status: o.status ?? 'running',
        artifacts: ids,
      })
      .returning()
    return r!
  }

  const auth = (token = A.token) => ({ authorization: `Bearer ${token}` })
  const base = (runId: string, artifactId: string) => `/api/daemon/runs/${runId}/artifacts/${artifactId}`

  const put = (runId: string, artifactId: string, content: string | Buffer, token?: string) =>
    t.app.inject({
      method: 'PUT',
      url: `${base(runId, artifactId)}/blobs/${sha(content)}`,
      headers: { ...auth(token), 'content-type': 'application/octet-stream' },
      payload: Buffer.from(content),
    })

  /** Uploads every file, then submits them as a version. */
  const submit = async (
    runId: string,
    artifactId: string,
    files: Record<string, string>,
    o: { parent?: string | null; key?: string; source?: 'run' | 'local'; token?: string } = {},
  ) => {
    for (const content of Object.values(files)) await put(runId, artifactId, content, o.token)
    return t.app.inject({
      method: 'POST',
      url: `${base(runId, artifactId)}/versions`,
      headers: auth(o.token),
      payload: {
        parentVersionId: o.parent ?? null,
        submitKey: o.key ?? randomUUID(),
        ...(o.source && { source: o.source }),
        files: fileList(files),
      },
    })
  }

  return { wang, li, outsider, A, B, bot, other, g, g2, artifact, run, auth, base, put, submit }
}

export const fileList = (files: Record<string, string>): ArtifactFile[] =>
  Object.entries(files).map(([path, content]) => ({
    path,
    hash: sha(content),
    size: Buffer.byteLength(content),
  }))

export const MANIFEST = JSON.stringify({
  title: '活动报名',
  device: 'miniprogram',
  entry: 'home',
  screens: [
    { id: 'home', title: '首页', file: 'screens/home.html' },
    { id: 'done', title: '报名成功', file: 'screens/done.html' },
  ],
})

/** A clean two-screen L1 artifact. */
export const L1 = {
  'gg-artifact.json': MANIFEST,
  'tokens.css': ':root { --color-primary: #155332; }\n',
  'screens/home.html':
    '<!doctype html><link rel="stylesheet" href="../tokens.css"><a data-gg-link="done" style="color: var(--color-primary)">报名</a>',
  'screens/done.html': '<!doctype html><h1>报名成功</h1><a data-gg-back>返回</a>',
}
