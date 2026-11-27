import type {
  ConnectorProbe,
  InstallDto,
  InstallRequestDto,
  ListingSummary,
  MarketInstalledDto,
  MarketListingDetailDto,
  MarketListingDto,
  MarketReadinessActionRes,
  MarketReadinessDto,
  MyListingDto,
  PublishRes,
  SecretDto,
} from '@gonggong/protocol'
import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupBots, notifications, secrets, teamMembers } from '../src/db/schema.js'
import { saveSysParams } from '../src/modules/admin/params.js'
import { setProbes } from '../src/modules/connectors/state.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const skillFiles = (name: string, extraFrontmatter = '', body = 'Do it.') => [
  {
    path: 'SKILL.md',
    content: `---\nname: ${name}\ndescription: ${name} helper\n${extraFrontmatter}---\n${body}\n`,
    encoding: 'utf8',
  },
]

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
        description: `${name} description`,
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

async function world() {
  const own = await t.seed.user({ name: '欧文' })
  const bob = await t.seed.user({ name: '鲍勃' })
  const eve = await t.seed.user({ name: '伊芙' })
  const mia = await t.seed.user({ name: '米娅' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, bob.id))
  const groupA = await t.seed.group({ createdBy: eve.id, name: '产品讨论群', memberIds: [mia.id] })
  const groupB = await t.seed.group({ createdBy: eve.id, name: '增长分析群', memberIds: [mia.id] })
  const teamA = groupA.teamId
  const as = async (u: { id: string }) => client(t, await t.seed.cookie(u.id))
  return {
    own,
    bob,
    eve,
    mia,
    root,
    teamA,
    groupA,
    groupB,
    api: {
      own: await as(own),
      bob: await as(bob),
      eve: await as(eve),
      mia: await as(mia),
      root: await as(root),
    },
  }
}

type Api = Awaited<ReturnType<typeof world>>['api']['root']

async function publishAndApprove(
  api: Api,
  reviewer: Api,
  teamId: string,
  files: object[],
  visibility = 'team',
) {
  const made = await api.post<PublishRes>('/api/market', { teamId, visibility, files })
  expect(made.status).toBeLessThan(300)
  const listing = made.body.listing
  expect(
    (
      await api.post<MyListingDto>(`/api/market/${listing.id}/versions/${listing.latest.id}/submit`, {
        changelog: '首版',
      })
    ).status,
  ).toBe(200)
  expect(
    (await reviewer.post(`/api/market/${listing.id}/versions/${listing.latest.id}/review`, { approve: true }))
      .status,
  ).toBe(204)
  return listing
}

describe('market filtering, hiding system plugins, and derived metadata', () => {
  it('hides agent and provider plugins by default while preserving shelf/includeSystem compatibility', async () => {
    const w = await world()
    await w.api.root.post('/api/admin/plugins', {
      files: pluginFiles('web-prototype', { title: '产品原型', category: 'web' }),
    })
    await w.api.root.post('/api/admin/plugins', {
      files: pluginFiles('feishu', {
        title: '飞书',
        category: 'connector',
        entry: 'feishu',
        connector: { examples: ['查下午日程'], cli: { driver: 'lark-cli', npm: '@larksuite/cli' } },
      }),
    })
    await w.api.root.post('/api/admin/plugins', {
      files: pluginFiles('agent-gemini', {
        title: 'Gemini CLI',
        category: 'agent',
        entry: null,
        permissions: ['exec'],
        contributes: {
          agents: [
            {
              id: 'gemini',
              title: 'Gemini CLI',
              vendor: 'Google',
              install: { npm: '@google/gemini-cli', bin: 'gemini', minVersion: '0.1.0' },
              acp: { kind: 'native', args: [] },
              systemPrompt: { via: 'env', env: 'GEMINI_SYS' },
              skills: { via: 'link', dirs: ['.agents/skills'] },
              tiers: null,
              provider: null,
              home: { env: null, default: '.gemini', config: 'settings.json' },
              login: { checks: [], command: 'gemini', hint: 'login' },
            },
          ],
        },
      }),
    })
    await w.api.root.post('/api/admin/plugins', {
      files: pluginFiles('provider-presets', {
        title: '官方供应商预设',
        category: 'provider',
        entry: null,
      }),
    })
    await publishAndApprove(
      w.api.eve,
      w.api.bob,
      w.teamA,
      skillFiles('weekly-helper', 'scene: office\nexamples:\n  - "生成本周周报"\n', '写周报'),
    )

    // Non-admin member browses default market: agent & provider are hidden.
    const def = (await w.api.mia.get<MarketListingDto[]>('/api/market')).body
    expect(def.map((l) => l.name).sort()).toEqual(['feishu', 'web-prototype', 'weekly-helper'])
    const proto = def.find((l) => l.name === 'web-prototype')!
    expect(proto).toMatchObject({
      scene: 'create',
      capabilities: ['create'],
      readiness: 'ready',
      featured: true,
      teamGroupsCount: 0,
    })
    const feishu = def.find((l) => l.name === 'feishu')!
    expect(feishu).toMatchObject({
      scene: 'connect',
      capabilities: ['connect'],
      readiness: 'needs-account',
      featured: true,
      examples: ['查下午日程'],
    })
    const weekly = def.find((l) => l.name === 'weekly-helper')!
    expect(weekly).toMatchObject({
      scene: 'office',
      capabilities: ['do'],
      readiness: 'ready',
      examples: ['生成本周周报'],
    })

    // Filter by scene & capability
    expect(
      (await w.api.mia.get<MarketListingDto[]>('/api/market?scene=connect')).body.map((l) => l.name),
    ).toEqual(['feishu'])
    expect(
      (await w.api.mia.get<MarketListingDto[]>('/api/market?capability=create')).body.map((l) => l.name),
    ).toEqual(['web-prototype'])

    // Sort by team usage
    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${weekly.id}`, { enabled: true })
    await w.api.eve.put(`/api/groups/${w.groupB.id}/installs/${weekly.id}`, { enabled: true })
    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${proto.id}`, { enabled: true })
    const byTeam = (await w.api.mia.get<MarketListingDto[]>('/api/market?sort=team')).body
    expect(byTeam[0]!.name).toBe('weekly-helper')
    expect(byTeam[0]!.teamGroupsCount).toBe(2)
    expect(byTeam[1]!.name).toBe('web-prototype')
    expect(byTeam[1]!.teamGroupsCount).toBe(1)

    // Backwards compatibility for internal/settings callers
    expect(
      (await w.api.mia.get<MarketListingDto[]>('/api/market?shelf=agent')).body.map((l) => l.name),
    ).toEqual(['agent-gemini'])
    expect(
      (await w.api.mia.get<MarketListingDto[]>('/api/market?shelf=provider')).body.map((l) => l.name),
    ).toEqual(['provider-presets'])
    expect(
      (await w.api.mia.get<MarketListingDto[]>('/api/market?includeSystem=true')).body
        .map((l) => l.name)
        .sort(),
    ).toEqual(['agent-gemini', 'feishu', 'provider-presets', 'web-prototype', 'weekly-helper'])
  })
})

describe('secret auto-provisioning and silent conflict reuse', () => {
  it('auto-creates missing secret defs and silently reuses existing same-named defs without overwriting', async () => {
    const w = await world()
    const dw = await publishAndApprove(
      w.api.eve,
      w.api.bob,
      w.teamA,
      pluginFiles('dw-query', {
        title: '数仓查询',
        category: 'connector',
        entry: 'dw-query',
        connector: { examples: ['查昨日注册人数'] },
        secrets: [
          {
            name: 'DW_MANAGER_KEY',
            title: 'Manager Key',
            description: '个人查询密钥',
            mode: 'personal',
            required: true,
          },
          {
            name: 'DW_SHARED_ENDPOINT',
            title: '共享密钥',
            description: '插件默认说明',
            mode: 'shared',
            required: true,
          },
        ],
      }),
    )

    // Pre-create DW_SHARED_ENDPOINT in groupA with custom description & value before install!
    const preGroup = await w.api.eve.post<SecretDto>(`/api/groups/${w.groupA.id}/secrets`, {
      name: 'DW_SHARED_ENDPOINT',
      description: '原有群共享定义',
      mode: 'shared',
      value: 'existing-secret-1234',
    })
    expect(preGroup.status).toBe(201)

    // Install into groupA: DW_MANAGER_KEY auto-created in team scope, DW_SHARED_ENDPOINT silently reused!
    const installedA = await w.api.eve.put<InstallDto>(`/api/groups/${w.groupA.id}/installs/${dw.id}`, {
      enabled: true,
    })
    expect(installedA.status).toBe(200)
    expect(installedA.body.reusedSecrets).toEqual([
      {
        name: 'DW_SHARED_ENDPOINT',
        existingScope: 'group',
        existingScopeLabel: '产品讨论群',
        targetLabel: '产品讨论群',
      },
    ])

    // Verify existing secret was NOT overwritten
    const [kept] = await t.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.id, preGroup.body.id)))
    expect(kept?.description).toBe('原有群共享定义')
    expect(kept?.last4).toBe('1234')

    // Verify DW_MANAGER_KEY was auto-created in team scope as personal
    const [createdPersonal] = await t.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.teamId, w.teamA), eq(secrets.name, 'DW_MANAGER_KEY')))
    expect(createdPersonal).toMatchObject({ scope: 'team', mode: 'personal' })

    // Verify detail & readiness expose reusedSecrets for 开发者信息
    const detail = (await w.api.mia.get<MarketListingDetailDto>(`/api/market/${dw.id}`)).body
    expect(detail.reusedSecrets).toEqual([
      expect.objectContaining({ name: 'DW_SHARED_ENDPOINT', existingScope: 'group' }),
    ])
    const readiness = (
      await w.api.mia.get<MarketReadinessDto>(
        `/api/market/${dw.id}/readiness?scope=group&scopeId=${w.groupA.id}`,
      )
    ).body
    expect(readiness.reusedSecrets).toEqual([
      expect.objectContaining({ name: 'DW_SHARED_ENDPOINT', existingScope: 'group' }),
    ])
    expect(readiness.secrets.find((s) => s.name === 'DW_SHARED_ENDPOINT')).toMatchObject({
      status: 'ok',
      reused: true,
    })
    expect(readiness.secrets.find((s) => s.name === 'DW_MANAGER_KEY')).toMatchObject({
      status: 'unfilled',
      action: 'fill_personal',
      reused: false,
    })
    expect(readiness.ready).toBe(false)
    expect(readiness.pendingSteps).toBe(1)
    expect(readiness.tryPrompts).toEqual(['查昨日注册人数'])

    // Installing into groupB inherits team-level DW_MANAGER_KEY → silently reused without failing!
    const installedB = await w.api.eve.put<InstallDto>(`/api/groups/${w.groupB.id}/installs/${dw.id}`, {
      enabled: true,
    })
    expect(installedB.status).toBe(200)
    expect(installedB.body.reusedSecrets).toEqual([
      expect.objectContaining({ name: 'DW_MANAGER_KEY', existingScope: 'team' }),
    ])
  })
})

describe('aggregated installed view, readiness actions, and exec install requests', () => {
  it('returns live per-group health, todoCount, pendingUpdates, and handles in-place readiness actions', async () => {
    const w = await world()
    await saveSysParams(t.ctx, { pluginsEnabled: true, pluginCodeEnabled: true }, w.root.id)

    // Seed two machines & bots in groupA: eve owns machine1, bob owns machine2
    const { machine: m1 } = await t.seed.machine(w.eve.id, { name: '伊芙的 Mac', daemonVersion: '0.9.0' })
    const { machine: m2 } = await t.seed.machine(w.bob.id, {
      name: '鲍勃的 Mac mini',
      daemonVersion: '0.9.0',
    })
    t.ctx.hub.register(m1.id, { send() {}, close() {} }, ['plugins', 'pluginMcp', 'connectors'])
    t.ctx.hub.register(m2.id, { send() {}, close() {} }, ['plugins', 'pluginMcp', 'connectors'])
    const b1 = await t.seed.bot({ teamId: w.teamA, ownerId: w.eve.id, machineId: m1.id, name: 'Bot1' })
    const b2 = await t.seed.bot({ teamId: w.teamA, ownerId: w.bob.id, machineId: m2.id, name: 'Bot2' })
    await t.db.insert(groupBots).values([
      { groupId: w.groupA.id, botId: b1.id },
      { groupId: w.groupA.id, botId: b2.id },
    ])

    // Empty installed state for mia
    expect((await w.api.mia.get<MarketInstalledDto>('/api/market/installed')).body).toEqual({
      todoCount: 0,
      pendingUpdates: 0,
      mine: [],
      groups: [],
      team: [],
    })

    // 1. Exec plugin requiring machine trust
    const oa = await publishAndApprove(
      w.api.eve,
      w.api.bob,
      w.teamA,
      pluginFiles(
        'oa-helper',
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
    )

    // Non-admin member submits install request for exec plugin without pinVersionId → auto-pinned & approvable!
    const reqRes = await w.api.mia.post<InstallRequestDto>('/api/install-requests', {
      listingId: oa.id,
      scope: 'group',
      scopeId: w.groupA.id,
      note: '群里查报销用',
    })
    expect(reqRes.status).toBe(201)
    expect(reqRes.body.pinVersionId).toBe(oa.latest.id)
    expect(reqRes.body.permissions).toEqual(['exec'])
    expect(reqRes.body.readiness).toBe('needs-trust')
    const decided = await w.api.eve.post<InstallRequestDto>(
      `/api/install-requests/${reqRes.body.id}/decide`,
      {
        approve: true,
      },
    )
    expect(decided.status).toBe(200)

    // 2. CLI connector plugin
    const lark = (
      await w.api.root.post<ListingSummary>('/api/admin/plugins', {
        files: pluginFiles('feishu', {
          title: '飞书',
          category: 'connector',
          entry: 'feishu',
          connector: { examples: ['查今天日程'], cli: { driver: 'lark-cli', npm: '@larksuite/cli' } },
        }),
      })
    ).body
    await w.api.eve.put(`/api/groups/${w.groupA.id}/installs/${lark.id}`, { enabled: true })

    // 3. Pinned team skill with v2 update available
    const reviewV1 = await publishAndApprove(
      w.api.eve,
      w.api.bob,
      w.teamA,
      skillFiles('code-review', '', 'v1'),
    )
    await w.api.bob.put(`/api/teams/${w.teamA}/installs/${reviewV1.id}`, {
      enabled: true,
      pinVersionId: reviewV1.latest.id,
    })
    await publishAndApprove(w.api.eve, w.api.bob, w.teamA, skillFiles('code-review', '', 'v2'))

    // Check aggregated GET /api/market/installed as eve
    const inst = (await w.api.eve.get<MarketInstalledDto>('/api/market/installed')).body
    expect(inst.todoCount).toBe(2)
    expect(inst.pendingUpdates).toBe(1)
    expect(inst.groups.find((g) => g.listing.id === oa.id)).toMatchObject({
      health: 'needs-trust',
      groups: [expect.objectContaining({ groupId: w.groupA.id, canManage: true, health: 'needs-trust' })],
    })
    expect(inst.groups.find((g) => g.listing.id === lark.id)).toMatchObject({
      health: 'needs-account',
    })
    expect(inst.team[0]).toMatchObject({
      listing: expect.objectContaining({ id: reviewV1.id }),
      hasUpdate: true,
      canManage: false,
      health: 'update-available',
    })

    // Readiness for oa-helper: eve owns m1 (can allow_trust), bob owns m2 (can notify_trust)
    const oaReady1 = (
      await w.api.eve.get<MarketReadinessDto>(
        `/api/market/${oa.id}/readiness?scope=group&scopeId=${w.groupA.id}`,
      )
    ).body
    expect(oaReady1.ready).toBe(false)
    expect(oaReady1.trusts?.machines).toHaveLength(2)
    expect(oaReady1.trusts?.machines[0]).toMatchObject({ machineId: m1.id, own: true, status: 'unrequested' })
    expect(oaReady1.trusts?.machines[1]).toMatchObject({
      machineId: m2.id,
      own: false,
      status: 'unrequested',
    })

    // Eve cannot allow bob's machine directly (403), but can allow own machine and notify bob!
    expect(
      (
        await w.api.eve.post(`/api/market/${oa.id}/readiness/action`, {
          action: 'allow_trust',
          machineId: m2.id,
        })
      ).status,
    ).toBe(403)
    const allowM1 = await w.api.eve.post<MarketReadinessActionRes>(`/api/market/${oa.id}/readiness/action`, {
      action: 'allow_trust',
      machineId: m1.id,
    })
    expect(allowM1.status).toBe(200)
    expect(allowM1.body.ok).toBe(true)

    const notifyM2 = await w.api.eve.post<MarketReadinessActionRes>(`/api/market/${oa.id}/readiness/action`, {
      action: 'notify_trust',
      machineId: m2.id,
    })
    expect(notifyM2.status).toBe(200)
    expect(notifyM2.body.notified).toBe(true)
    const bobTrustNotices = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.bob.id), eq(notifications.type, 'plugin_trust')))
    expect(bobTrustNotices).toHaveLength(1)

    // Bob allows m2 → oa-helper becomes ready!
    expect(
      (
        await w.api.bob.post<MarketReadinessActionRes>(`/api/market/${oa.id}/readiness/action`, {
          action: 'allow_trust',
          machineId: m2.id,
        })
      ).status,
    ).toBe(200)
    const oaReady2 = (
      await w.api.eve.get<MarketReadinessDto>(
        `/api/market/${oa.id}/readiness?scope=group&scopeId=${w.groupA.id}`,
      )
    ).body
    expect(oaReady2.ready).toBe(true)
    expect(oaReady2.pendingSteps).toBe(0)

    // CLI connector readiness: notify bob, then simulate probe ready on m1
    const notifyConn = await w.api.eve.post<MarketReadinessActionRes>(
      `/api/market/${lark.id}/readiness/action`,
      {
        action: 'notify_connector',
        machineId: m2.id,
        scope: 'group',
        scopeId: w.groupA.id,
      },
    )
    expect(notifyConn.status).toBe(200)
    const bobReminders = await t.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.bob.id), eq(notifications.type, 'reminder')))
    expect(bobReminders).toHaveLength(1)

    const readyProbe: ConnectorProbe = {
      connector: 'feishu',
      driver: 'lark-cli',
      profile: 'default',
      state: 'ready',
      account: '伊芙',
      feishuUserId: null,
      expiresAt: null,
      refreshExpiresAt: null,
      version: '1.0.0',
      detail: null,
    }
    setProbes(t.ctx, m1.id, [readyProbe])
    const larkReady = (
      await w.api.eve.get<MarketReadinessDto>(
        `/api/market/${lark.id}/readiness?scope=group&scopeId=${w.groupA.id}`,
      )
    ).body
    expect(larkReady.ready).toBe(true)
    expect(larkReady.connector?.ready).toBe(true)

    // Re-check /api/market/installed: todoCount dropped to 0!
    const instAfter = (await w.api.eve.get<MarketInstalledDto>('/api/market/installed')).body
    expect(instAfter.todoCount).toBe(0)
  })
})
