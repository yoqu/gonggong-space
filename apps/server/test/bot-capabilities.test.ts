import type {
  BotCapabilitiesDto,
  ConnectorProbe,
  ListingSummary,
  MyListingDto,
  PublishRes,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, teamMembers } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { setProbes } from '../src/modules/connectors/state.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const pluginFiles = (
  name: string,
  manifestExtra: Record<string, unknown> = {},
  extraFiles: { path: string; content: string; encoding?: 'utf8' | 'base64' }[] = [],
) => {
  const entry = manifestExtra.entry === undefined ? name : manifestExtra.entry
  return [
    {
      path: 'gonggong-plugin.json',
      content: JSON.stringify({
        name,
        version: '1.0.0',
        title: `插件 ${name}`,
        description: `${name} 描述`,
        category: 'web',
        agents: ['claude'],
        minDaemon: '0.5.0',
        entry,
        ...manifestExtra,
      }),
      encoding: 'utf8',
    },
    ...(entry
      ? [
          {
            path: `skills/${entry}/SKILL.md`,
            content: `---\nname: ${entry}\ndescription: ${entry} skill\n---\nHelp.\n`,
            encoding: 'utf8',
          },
        ]
      : []),
    ...extraFiles,
  ]
}

const skillFiles = (name: string) => [
  {
    path: 'SKILL.md',
    content: `---\nname: ${name}\ndescription: ${name} helper\n---\nDo.\n`,
    encoding: 'utf8',
  },
]

describe('GET /api/bots/:id/capabilities', () => {
  it('splits assembled plugins into ready vs unavailable with plain-language Chinese reasons and actions', async () => {
    const owner = await t.seed.user({ name: '张磊' })
    const mia = await t.seed.user({ name: '米娅' })
    const outsider = await t.seed.user({ name: '外人', teamId: null })
    const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
    await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, owner.id))

    const groupA = await t.seed.group({ createdBy: owner.id, name: '产品讨论群', memberIds: [mia.id] })
    const groupB = await t.seed.group({ createdBy: owner.id, name: '研发群', memberIds: [mia.id] })
    const teamA = groupA.teamId

    const { machine: m } = await t.seed.machine(owner.id, { name: '张磊的 Mac mini', daemonVersion: '0.5.0' })
    t.ctx.hub.register(m.id, { send() {}, close() {} }, ['plugins', 'pluginMcp', 'connectors'])
    const bot = await t.seed.bot({
      teamId: teamA,
      ownerId: owner.id,
      machineId: m.id,
      name: 'Gemini 大师',
      agentKind: 'claude',
    })
    await t.db.insert(groupBots).values([
      { groupId: groupA.id, botId: bot.id },
      { groupId: groupB.id, botId: bot.id },
    ])

    const apiOwner = client(t, await t.seed.cookie(owner.id))
    const apiMia = client(t, await t.seed.cookie(mia.id))
    const apiOutsider = client(t, await t.seed.cookie(outsider.id))
    const apiRoot = client(t, await t.seed.cookie(root.id))

    // Disabled master switch → empty
    const offRes = await apiMia.get<BotCapabilitiesDto>(
      `/api/bots/${bot.id}/capabilities?groupId=${groupA.id}`,
    )
    expect(offRes.status).toBe(200)
    expect(offRes.body).toMatchObject({ pluginsEnabled: false, ready: [], unavailable: [] })

    await saveSysParams(t.ctx, { pluginsEnabled: true, pluginCodeEnabled: true }, root.id)

    // 1. Ready official creation plugin
    const proto = (
      await apiRoot.post<ListingSummary>('/api/admin/plugins', {
        files: pluginFiles('web-prototype', { title: '产品原型', category: 'web' }),
      })
    ).body
    await apiOwner.put(`/api/groups/${groupA.id}/installs/${proto.id}`, { enabled: true })

    // 2. Ready CLI connector (probe ready)
    await apiRoot.post<ListingSummary>('/api/admin/plugins', {
      files: pluginFiles('feishu', {
        title: '飞书',
        category: 'connector',
        entry: 'feishu',
        connector: { examples: ['查日程'], cli: { driver: 'lark-cli', npm: '@larksuite/cli' } },
      }),
    })
    const readyProbe: ConnectorProbe = {
      connector: 'feishu',
      driver: 'lark-cli',
      profile: 'default',
      state: 'ready',
      account: '张磊',
      feishuUserId: null,
      expiresAt: null,
      refreshExpiresAt: null,
      version: '1.0.0',
      detail: null,
    }
    setProbes(t.ctx, m.id, [readyProbe])

    // 3. Unconnected CLI connector
    await apiRoot.post<ListingSummary>('/api/admin/plugins', {
      files: pluginFiles('meegle', {
        title: '飞书项目',
        category: 'connector',
        entry: 'meegle',
        connector: { examples: ['查需求'], cli: { driver: 'meegle', npm: '@meegle/cli' } },
      }),
    })

    // 4. Missing personal secret plugin
    const dw = (
      await apiRoot.post<ListingSummary>('/api/admin/plugins', {
        files: pluginFiles('dw-query', {
          title: '数仓查询',
          category: 'connector',
          entry: 'dw-query',
          connector: { examples: ['查指标'] },
          secrets: [{ name: 'DW_KEY', title: 'Manager Key', mode: 'personal', required: true }],
        }),
      })
    ).body
    await apiOwner.put(`/api/groups/${groupA.id}/installs/${dw.id}`, { enabled: true })

    // 5. Untrusted exec plugin
    const oa = (
      await apiRoot.post<ListingSummary>('/api/admin/plugins', {
        files: pluginFiles(
          'oa-exec',
          {
            title: '内部审批助手',
            category: 'tool',
            entry: null,
            permissions: ['exec'],
            contributes: {
              mcp: [
                { transport: 'stdio', name: 'oa', command: ['{node}', '{pkg}/contrib/mcp/oa.js'], env: {} },
              ],
            },
          },
          [{ path: 'contrib/mcp/oa.js', content: 'console.log(1)', encoding: 'utf8' }],
        ),
      })
    ).body
    await apiOwner.put(`/api/groups/${groupB.id}/installs/${oa.id}`, {
      enabled: true,
      pinVersionId: oa.versionId,
    })

    // 6. Outdated daemon plugin (needs 0.9.0 while machine has 0.5.0)
    const video = (
      await apiRoot.post<ListingSummary>('/api/admin/plugins', {
        files: pluginFiles('video-cut', {
          title: '视频剪辑',
          category: 'video',
          minDaemon: '0.9.0',
        }),
      })
    ).body
    await apiOwner.put(`/api/groups/${groupA.id}/installs/${video.id}`, { enabled: true })

    // 7. Personal market skill installed by mia
    const made = await apiMia.post<PublishRes>('/api/market', {
      teamId: teamA,
      visibility: 'team',
      files: skillFiles('code-review'),
    })
    const sk = made.body.listing
    await apiMia.post<MyListingDto>(`/api/market/${sk.id}/versions/${sk.latest.id}/submit`, {
      changelog: 'v1',
    })
    await apiOwner.post(`/api/market/${sk.id}/versions/${sk.latest.id}/review`, { approve: true })
    await apiMia.put(`/api/me/installs/${sk.id}`, { enabled: true })

    // Group A view as mia
    const groupRes = await apiMia.get<BotCapabilitiesDto>(
      `/api/bots/${bot.id}/capabilities?groupId=${groupA.id}`,
    )
    expect(groupRes.status).toBe(200)
    const { ready, unavailable, groups } = groupRes.body
    expect(groups.map((g) => g.name).sort()).toEqual(['产品讨论群', '研发群'])

    expect(ready.map((r) => r.name).sort()).toEqual(['code-review', 'feishu', 'web-prototype'])
    expect(ready.find((r) => r.name === 'feishu')).toMatchObject({
      statusLabel: '已连接',
      sourceLabel: expect.stringContaining('张磊'),
    })
    expect(ready.find((r) => r.name === 'web-prototype')).toMatchObject({
      createsArtifacts: true,
      statusLabel: '开箱即用',
    })

    expect(unavailable.map((u) => [u.name, u.action]).sort()).toEqual([
      ['dw-query', 'fill-secret'],
      ['meegle', 'connect-account'],
      ['video-cut', 'upgrade-daemon'],
    ])
    expect(unavailable.find((u) => u.name === 'dw-query')).toMatchObject({
      blocker: 'secret',
      missingSecrets: ['DW_KEY'],
      reasonLabel: '缺少你的凭据',
    })
    expect(unavailable.find((u) => u.name === 'video-cut')).toMatchObject({
      blocker: 'daemon',
      minDaemon: '0.9.0',
      daemonVersion: '0.5.0',
    })

    // Ensure zero technical jargon in user-facing labels/reasons
    for (const item of [...ready, ...unavailable]) {
      const text = `${item.sourceLabel} ${item.statusLabel} ${item.reasonLabel ?? ''} ${item.reason ?? ''}`
      expect(text).not.toMatch(/\b(MCP|Skill|ACP|daemon)\b/i)
    }

    // All-groups view includes oa-exec (trust-machine) from groupB and aggregates personal skill across both groups
    const allRes = await apiMia.get<BotCapabilitiesDto>(`/api/bots/${bot.id}/capabilities`)
    expect(allRes.status).toBe(200)
    expect(allRes.body.groupId).toBeNull()
    expect(allRes.body.unavailable.find((u) => u.name === 'oa-exec')).toMatchObject({
      blocker: 'trust',
      action: 'trust-machine',
      ownMachine: false,
      machineOwnerName: '张磊',
    })
    expect(allRes.body.ready.find((r) => r.name === 'code-review')?.groups).toHaveLength(2)

    // Access control: outsider cannot read
    expect((await apiOutsider.get(`/api/bots/${bot.id}/capabilities`)).status).toBe(404)
  })
})
