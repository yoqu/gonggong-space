import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ArtifactChatDto,
  type GroupDto,
  type MessageDto,
  PROTOCOL_VERSION,
  type WorkDto,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { artifacts, groupBots, groupMembers, groups, messages, runs } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { BUILTIN_PLUGINS, syncBuiltinPlugins } from '../src/modules/plugins/builtin.js'
import { createTestApp, inbox, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeAll(() => {
  process.env.GONGGONG_DATA_DIR = mkdtempSync(join(tmpdir(), 'gonggong-data-'))
})
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

async function world() {
  const owner = await t.seed.user({ name: '姜维川' })
  const li = await t.seed.user({ name: '李建国' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await saveSysParams(t.ctx, { pluginsEnabled: true }, root.id)
  await syncBuiltinPlugins(t.ctx, BUILTIN_PLUGINS)
  const m = await t.seed.machine(owner.id, { name: 'owner-mac' })
  const gz = await t.seed.bot({
    ownerId: owner.id,
    name: '共字君',
    machineId: m.machine.id,
    triggerScope: 'all',
  })
  const ws = t.ws('/ws/daemon')
  const box = inbox(ws)
  await box.opened
  ws.send(
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL_VERSION,
      token: m.token,
      daemonVersion: '0.9.0',
      machine: { name: 'owner-mac', os: 'macos', arch: 'aarch64' },
      agents: [],
      features: ['plugins', 'artifacts'],
    }),
  )
  expect(await box.next()).toMatchObject({ t: 'welcome' })
  return { owner, li, gz, me: client(t, await t.seed.cookie(li.id)) }
}

describe('作品 新建 with an AI, no group', () => {
  it('opens an empty work of the picked AI that the creator talks to on its canvas, in no group of theirs', async () => {
    const w = await world()
    const res = await w.me.post<{ artifactId: string }>('/api/works', { botId: w.gz.id })
    expect(res.status).toBe(200)
    const [a] = await t.db.select().from(artifacts).where(eq(artifacts.id, res.body.artifactId))
    expect(a).toMatchObject({
      createdBy: w.li.id,
      botId: w.gz.id,
      visibility: 'private',
      kind: 'prototype',
      headVersionId: null,
    })
    expect(a!.pluginVersionId).not.toBeNull()
    // A hidden space of the creator's: no members, the AI only a guest there.
    const [space] = await t.db.select().from(groups).where(eq(groups.id, a!.groupId))
    expect(space).toMatchObject({ kind: 'works', createdBy: w.li.id })
    expect(await t.db.select().from(groupMembers).where(eq(groupMembers.groupId, space!.id))).toEqual([])
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.groupId, space!.id))
    expect(gb).toMatchObject({ botId: w.gz.id, guest: true })
    expect((await w.me.get<GroupDto[]>('/api/groups')).body.map((g) => g.id)).not.toContain(space!.id)
    expect((await w.me.get<WorkDto[]>('/api/works')).body.map((x) => [x.id, x.access, x.groupTitle])).toEqual(
      [[a!.id, 'edit', '']],
    )

    // Its AI 对话 opens with how to create it, then the first message says what to make and starts the AI.
    const chat = await w.me.post<ArtifactChatDto>(`/api/artifacts/${a!.id}/chat`)
    expect(chat.body.group?.kind).toBe('works')
    const [root] = await t.db.select().from(messages).where(eq(messages.id, chat.body.rootId))
    expect(root!.body).toContain('产品原型')
    expect(root!.body).toContain(a!.dir)
    const sent = await w.me.post<MessageDto>(`/api/groups/${space!.id}/messages`, {
      body: '做一个湖畔露营地预约小程序',
      clientId: 'first-message',
      threadRootId: chat.body.rootId,
      botId: w.gz.id,
    })
    expect(sent.status).toBe(200)
    const [run] = await t.db.select().from(runs).where(eq(runs.triggerMessageId, sent.body.id))
    expect(run).toMatchObject({ botId: w.gz.id, threadRootId: chat.body.rootId })

    // Later works go to the same space.
    const again = await w.me.post<{ artifactId: string }>('/api/works', { botId: w.gz.id })
    const [b] = await t.db.select().from(artifacts).where(eq(artifacts.id, again.body.artifactId))
    expect(b!.groupId).toBe(space!.id)
  })

  it('only takes the AIs open for works', async () => {
    const w = await world()
    const other = await t.seed.bot({ ownerId: w.owner.id, name: '姜维川的 Codex', triggerScope: 'all' })
    const res = await w.me.post<{ message: string }>('/api/works', { botId: other.id })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('这个 Bot 暂不支持创作作品，请从列表里选择可用的 Bot')
  })

  it('lets a standalone work creator run canvas commands, agent-send, and toggle public share', async () => {
    const w = await world()
    t.ctx.config.preview = { domain: 'preview.test', ports: [0, 0], publicUrl: null }
    const created = await w.me.post<{ artifactId: string }>('/api/works', { botId: w.gz.id })
    expect(created.status).toBe(200)
    const id = created.body.artifactId

    const agentRes = await w.me.post<{ status: string; messageId?: string }>(
      `/api/artifacts/${id}/agent-send`,
      {
        text: '帮我加一页介绍',
      },
    )
    expect(agentRes.status).toBe(200)
    expect(agentRes.body.status).toBe('delivered')

    const on = await w.me.post<{ enabled: boolean; url: string | null }>(`/api/artifacts/${id}/share`, {
      enabled: true,
    })
    expect(on.status).toBe(200)
    expect(on.body.enabled).toBe(true)
    expect(on.body.url).toBeTruthy()

    const off = await w.me.post<{ enabled: boolean; url: string | null }>(`/api/artifacts/${id}/share`, {
      enabled: false,
    })
    expect(off.status).toBe(200)
    expect(off.body.enabled).toBe(false)
  })
})
