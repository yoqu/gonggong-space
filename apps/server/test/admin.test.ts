import type {
  AdminGroupDto,
  AdminMachineDto,
  AuditDto,
  ServerToDaemon,
  SystemParams,
} from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  approvals,
  auditLogs,
  bots,
  groupBots,
  groupMembers,
  groupRepos,
  groups,
  machines,
  messages,
  runs,
  systemParams,
  webSessions,
} from '../src/db/schema.js'
import { summarize } from '../src/modules/admin/audit.js'
import { forgetSysParams, sysParams } from '../src/modules/admin/params.js'
import { timeoutMin } from '../src/modules/approvals/service.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

let t: TestApp
let admin: ReturnType<typeof client>
let adminId: string
beforeEach(async () => {
  t = await createTestApp()
  const a = await t.seed.user({ account: 'chenchen', name: '陈晨', role: 'sysadmin' })
  adminId = a.id
  admin = client(t, await t.seed.cookie(a.id))
})
afterEach(() => t.close())

const put = async (cookie: string, url: string, payload: object) => {
  const res = await t.app.inject({ method: 'PUT', url, headers: { cookie }, payload })
  return { status: res.statusCode, body: res.json() }
}

/** A connected daemon whose closes and sent messages are recorded. */
function connect(machineId: string) {
  const sent: ServerToDaemon[] = []
  const closed: number[] = []
  const conn = {
    send: (m: ServerToDaemon) => sent.push(m),
    close: (code: number) => {
      closed.push(code)
      t.ctx.hub.unregister(machineId, conn)
    },
  }
  t.ctx.hub.register(machineId, conn)
  return { sent, closed }
}

async function run(groupId: string, botId: string, userId: string, status: string) {
  const [m] = await t.db.insert(messages).values({ groupId, kind: 'user', authorUserId: userId }).returning()
  const [r] = await t.db
    .insert(runs)
    .values({ groupId, botId, triggerMessageId: m!.id, triggerUserId: userId, originUserId: userId, status })
    .returning()
  return r!
}

describe('disabling an account', () => {
  async function world() {
    const wang = await t.seed.user({ account: 'wanglei', name: '王磊' })
    const li = await t.seed.user({ account: 'lijg', name: '李建国' })
    const { machine } = await t.seed.machine(wang.id, { name: 'wanglei-mbp' })
    const { machine: other } = await t.seed.machine(li.id)
    const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
    const codex = await t.seed.bot({ ownerId: li.id, name: '老李的 Codex', machineId: other.id })
    const g = await t.seed.group({ createdBy: li.id, memberIds: [wang.id], botIds: [claude.id, codex.id] })
    const wangCookie = await t.seed.cookie(wang.id)
    return { wang, li, machine, other, claude, codex, g, wangCookie }
  }

  it('revokes sessions and daemons, removes bots from groups, stops their runs and audits it', async () => {
    const w = await world()
    const daemon = connect(w.machine.id)
    const bystander = connect(w.other.id)
    const running = await run(w.g.id, w.claude.id, w.li.id, 'running')
    const queued = await run(w.g.id, w.claude.id, w.li.id, 'queued')
    const others = await run(w.g.id, w.codex.id, w.li.id, 'running')
    await t.db.insert(approvals).values({
      runId: running.id,
      requestId: 'r1',
      title: 'go build ./...',
      toolKind: 'execute',
      detail: '',
      options: [],
      expiresAt: new Date(Date.now() + 60_000),
    })

    const res = await admin.post<{ disabled: boolean }>(`/api/admin/users/${w.wang.id}/disable`)
    expect(res.status).toBe(200)
    expect(res.body.disabled).toBe(true)

    // Web sessions and daemon tokens are revoked at once; the connected daemon is kicked with 4003.
    expect((await client(t, w.wangCookie).get('/api/me')).status).toBe(401)
    const sessions = await t.db.select().from(webSessions).where(eq(webSessions.userId, w.wang.id))
    expect(sessions.every((s) => s.revokedAt)).toBe(true)
    const [m] = await t.db.select().from(machines).where(eq(machines.id, w.machine.id))
    expect(m?.revokedAt).not.toBeNull()
    expect(daemon.closed).toEqual([4003])
    expect(daemon.sent).toContainEqual({ t: 'run.cancel', runId: running.id })
    expect(bystander.closed).toEqual([])

    // Bots leave every group and the team-wide list; membership rows stay.
    const [gb] = await t.db.select().from(groupBots).where(eq(groupBots.botId, w.claude.id))
    expect(gb?.removedAt).not.toBeNull()
    const list = await admin.get<{ id: string }[]>('/api/bots')
    expect(list.body.map((b) => b.id)).toEqual([w.codex.id])
    expect(await t.db.select().from(groupMembers).where(eq(groupMembers.userId, w.wang.id))).toHaveLength(1)

    // Its unfinished runs end as interrupted; other bots are untouched.
    const status = async (id: string) => (await t.db.select().from(runs).where(eq(runs.id, id)))[0]?.status
    expect(await status(running.id)).toBe('interrupted')
    expect(await status(queued.id)).toBe('interrupted')
    expect(await status(others.id)).toBe('running')
    const [a] = await t.db.select().from(approvals)
    expect(a?.status).toBe('void')

    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'user.disable'))
    expect(log).toMatchObject({ category: 'admin', actorUserId: adminId })
    expect(log?.detail).toMatchObject({ account: 'wanglei', machines: 1, bots: 1 })

    // Login is refused, pickers hide the account, the admin list shows it disabled.
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'wanglei', password: 'password123' },
    })
    expect(login.statusCode).toBe(403)
    const picker = await admin.get<{ account: string }[]>('/api/users')
    expect(picker.body.map((u) => u.account)).not.toContain('wanglei')
    const rows = await admin.get<{ account: string; disabled: boolean }[]>('/api/admin/users')
    expect(rows.body.find((u) => u.account === 'wanglei')?.disabled).toBe(true)
  })

  it('closes the member’s live browser sockets', async () => {
    const w = await world()
    let closed = false
    t.ctx.bus.attach(
      w.wang.id,
      () => {},
      () => {
        closed = true
      },
    )
    await admin.post(`/api/admin/users/${w.wang.id}/disable`)
    expect(closed).toBe(true)
  })

  it('refuses self, unknown and already disabled accounts, and non-admins', async () => {
    const w = await world()
    expect((await admin.post(`/api/admin/users/${adminId}/disable`)).status).toBe(400)
    expect((await admin.post('/api/admin/users/00000000-0000-0000-0000-000000000000/disable')).status).toBe(
      404,
    )
    expect((await client(t, w.wangCookie).post(`/api/admin/users/${w.li.id}/disable`)).status).toBe(403)
    await admin.post(`/api/admin/users/${w.wang.id}/disable`)
    expect((await admin.post(`/api/admin/users/${w.wang.id}/disable`)).status).toBe(409)
  })

  it('re-enables an account so it can log in again, and audits it', async () => {
    const w = await world()
    await admin.post(`/api/admin/users/${w.wang.id}/disable`)
    const res = await admin.post<{ disabled: boolean }>(`/api/admin/users/${w.wang.id}/enable`)
    expect(res.status).toBe(200)
    expect(res.body.disabled).toBe(false)
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { account: 'wanglei', password: 'password123' },
    })
    expect(login.statusCode).toBe(200)
    expect((await admin.post(`/api/admin/users/${w.wang.id}/enable`)).status).toBe(409)
    const logs = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'user.enable'))
    expect(logs).toHaveLength(1)
  })
})

describe('admin groups and machines', () => {
  it('lists every group, archived ones too, with mode, repo and counts', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const b1 = await t.seed.bot({ ownerId: wang.id })
    const b2 = await t.seed.bot({ ownerId: wang.id })
    const pay = await t.seed.group({ createdBy: wang.id, name: '支付服务重构', botIds: [b1.id, b2.id] })
    await t.db
      .insert(groupRepos)
      .values({ groupId: pay.id, url: 'git.corp/pay/pay-server', baseBranch: 'main' })
    await t.db.update(groupBots).set({ removedAt: new Date() }).where(eq(groupBots.botId, b2.id))
    const old = await t.seed.group({ createdBy: adminId, name: '旧版后台', memberIds: [wang.id] })
    await t.db.update(groups).set({ archivedAt: new Date() }).where(eq(groups.id, old.id))

    const res = await admin.get<AdminGroupDto[]>('/api/admin/groups')
    expect(res.status).toBe(200)
    expect(res.body.find((g) => g.id === pay.id)).toMatchObject({
      name: '支付服务重构',
      ownerName: '王磊',
      mode: 'partition',
      repo: 'git.corp/pay/pay-server',
      members: 1,
      bots: 1,
      archivedAt: null,
    })
    const archived = res.body.find((g) => g.id === old.id)
    expect(archived).toMatchObject({ repo: null, members: 2, bots: 0 })
    expect(archived?.archivedAt).not.toBeNull()
    const member = client(t, await t.seed.cookie(wang.id))
    expect((await member.get('/api/admin/groups')).status).toBe(403)
  })

  it('lists live machines of everyone with owner, daemon version, protocol and presence', async () => {
    const wang = await t.seed.user({ name: '王磊' })
    const { machine } = await t.seed.machine(wang.id, {
      name: 'wanglei-mbp',
      daemonVersion: '0.9.3',
      protocol: 1,
    })
    await t.seed.machine(wang.id, { revokedAt: new Date() })
    connect(machine.id)
    const res = await admin.get<AdminMachineDto[]>('/api/admin/machines')
    expect(res.body).toHaveLength(1)
    expect(res.body[0]).toMatchObject({
      name: 'wanglei-mbp',
      ownerName: '王磊',
      daemonVersion: '0.9.3',
      protocol: 1,
      online: true,
    })
  })
})

describe('audit query', () => {
  async function seedLogs() {
    const wang = await t.seed.user({ account: 'wanglei', name: '王磊' })
    const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude' })
    const g = await t.seed.group({ createdBy: wang.id, name: '支付服务重构', botIds: [claude.id] })
    const r = await run(g.id, claude.id, wang.id, 'completed')
    const at = (s: number) => new Date(Date.UTC(2026, 8, 23, 10, 0, s))
    await t.db.insert(auditLogs).values([
      {
        category: 'approval',
        actorUserId: wang.id,
        action: 'approved',
        groupId: g.id,
        detail: { runId: r.id, title: 'go build ./...' },
        createdAt: at(1),
      },
      {
        category: 'question',
        actorUserId: wang.id,
        action: 'answered',
        groupId: g.id,
        detail: { runId: r.id, questions: ['a', 'b', 'c'] },
        createdAt: at(2),
      },
      {
        category: 'admin',
        actorUserId: adminId,
        action: 'bot.create',
        detail: { botId: claude.id, name: '小王的 Codex', ownerId: wang.id },
        createdAt: at(3),
      },
      {
        category: 'admin',
        actorUserId: adminId,
        action: 'mcp.update',
        detail: { name: 'wiki-search', enabled: true, forceNewSession: false },
        createdAt: at(4),
      },
      {
        category: 'run',
        actorUserId: wang.id,
        action: 'command.stop',
        groupId: g.id,
        detail: { botIds: [claude.id], runIds: [r.id] },
        createdAt: at(5),
      },
      {
        category: 'admin',
        actorUserId: adminId,
        action: 'user.disable',
        detail: { account: 'wanglei' },
        createdAt: at(6),
      },
    ])
  }

  it('returns newest first with who, group and a Chinese summary', async () => {
    await seedLogs()
    const res = await admin.get<AuditDto[]>('/api/admin/audit')
    expect(res.status).toBe(200)
    expect(res.body.map((a) => a.summary)).toEqual([
      '停用账号 wanglei',
      '/stop 中断 小王的 Claude · 支付服务重构',
      '修改平台层 MCP：启用 wiki-search · 未勾选强制新会话',
      '为 王磊 新建 Bot 小王的 Codex',
      '回答 小王的 Claude 的 3 个问题 · 支付服务重构',
      '批准 小王的 Claude 执行 go build ./... · 支付服务重构',
    ])
    expect(res.body[0]).toMatchObject({ category: 'admin', actorName: '陈晨', groupName: null })
    expect(res.body[5]).toMatchObject({ actorName: '王磊', groupName: '支付服务重构' })
  })

  it('filters by category and pages with a before cursor', async () => {
    await seedLogs()
    const adminOnly = await admin.get<AuditDto[]>('/api/admin/audit?category=admin')
    expect(adminOnly.body.map((a) => a.action)).toEqual(['user.disable', 'mcp.update', 'bot.create'])
    const page1 = await admin.get<AuditDto[]>('/api/admin/audit?limit=2')
    const page2 = await admin.get<AuditDto[]>(`/api/admin/audit?limit=2&before=${page1.body[1]!.id}`)
    expect(page2.body.map((a) => a.action)).toEqual(['mcp.update', 'bot.create'])
    expect((await admin.get('/api/admin/audit?category=nope')).status).toBe(400)
  })

  it('summarizes group settings changes', () => {
    const none = { user: () => '', bot: () => '', runBot: () => '' }
    const s = (action: string, d: Record<string, unknown>) =>
      summarize({ category: 'admin', action }, d, none)
    expect(s('group.params', { approvalTimeoutMin: 20, chainMaxHops: 1, offlineWaitMin: 30 })).toBe(
      '修改群级参数：审批等待 20 分钟，接力链长上限 1 跳，离线等待 30 分钟',
    )
    expect(s('group.admin.grant', { userName: '李建国' })).toBe('设 李建国 为群管理员')
    expect(s('group.dissolve', {})).toBe('解散群')
    expect(s('group.member.remove', { name: '王磊' })).toBe('将 王磊 移出群')
    expect(s('group.bot.add', { name: '小王的 Claude' })).toBe('拉入 Bot 小王的 Claude')
    expect(s('group.repo.change', { url: 'git.corp/pay', branch: 'main', previous: null })).toBe(
      '绑定仓库 git.corp/pay · 基准分支 main',
    )
    expect(s('something.new', {})).toBe('something.new')
  })

  it('summarizes every emitted action in Chinese', () => {
    const n = {
      user: (id: unknown) => (id === 'u1' ? '王磊' : ''),
      bot: () => '',
      runBot: () => '小王的 Claude',
    }
    const s = (category: string, action: string, d: Record<string, unknown>) =>
      summarize({ category, action }, d, n)
    expect(s('admin', 'group.notice.remove', { notice: '周五发布' })).toBe('删除群公告')
    expect(s('admin', 'bot.approval', { name: '设计师' })).toBe('修改 Bot 设计师 的审批设置')
    expect(s('admin', 'bot.always_allow', { name: '设计师', added: ['npm test', 'tail'] })).toBe(
      'Bot 设计师 始终允许：npm test、tail',
    )
    expect(s('admin', 'machine.transfer', { name: 'mac-mini', fromOwnerId: 'u1' })).toBe(
      '将 王磊 的机器 mac-mini 转移到名下',
    )
    expect(s('run', 'run.task_stop', { runId: 'r1' })).toBe('中断 小王的 Claude 的后台任务')
    expect(s('run', 'tool.cross_group_read', { runId: 'r1', groups: ['g1', 'g2'] })).toBe(
      '小王的 Claude 跨群读取 2 个群的内容',
    )
  })

  it('is sysadmin only', async () => {
    const m = await t.seed.user()
    expect((await client(t, await t.seed.cookie(m.id)).get('/api/admin/audit')).status).toBe(403)
  })
})

describe('system params', () => {
  it('returns the spec defaults', async () => {
    const res = await admin.get<SystemParams>('/api/admin/params')
    expect(res.body).toEqual({
      approvalTimeoutMin: 30,
      chainMaxHops: 3,
      offlineWaitMin: 30,
      sessionReplayCount: 50,
      contextInlineMax: 20,
      runRetentionDays: 30,
      attachmentMaxMb: 50,
      attachmentsPerMessage: 10,
      questionsPerCard: 4,
      heartbeatSec: 15,
      offlineMisses: 3,
      botConcurrencyDefault: 2,
      backupRetentionDays: 7,
      archiveRetentionDays: 30,
      registrationOpen: false,
      previewIdleHours: 24,
      previewShareMaxDays: 30,
      singleTeamMode: true,
      teamCreation: 'sysadmin',
      feishuAutoSignup: true,
      publicUrl: '',
      demoMode: false,
    })
  })

  it('validates, saves, audits each change and applies it at once', async () => {
    const cookie = await t.seed.cookie(adminId)
    expect((await put(cookie, '/api/admin/params', { runRetentionDays: 0 })).status).toBe(400)
    expect((await put(cookie, '/api/admin/params', { attachmentsPerMessage: 11 })).status).toBe(400)
    const res = await put(cookie, '/api/admin/params', { runRetentionDays: 14, chainMaxHops: 5 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ runRetentionDays: 14, chainMaxHops: 5, offlineWaitMin: 30 })
    expect(await sysParams(t.db)).toMatchObject({ runRetentionDays: 14, chainMaxHops: 5 })
    expect((await admin.get<SystemParams>('/api/admin/params')).body.runRetentionDays).toBe(14)
    const [log] = await t.db.select().from(auditLogs).where(eq(auditLogs.action, 'params.update'))
    expect(log?.detail).toEqual({ changes: { runRetentionDays: [30, 14], chainMaxHops: [3, 5] } })
    const [a] = (await admin.get<AuditDto[]>('/api/admin/audit')).body
    expect(a?.summary).toBe('修改系统参数：完整运行过程保留 30 → 14 天；接力链长上限 · 群默认 3 → 5 跳')
    const member = await t.seed.user()
    expect((await put(await t.seed.cookie(member.id), '/api/admin/params', { chainMaxHops: 2 })).status).toBe(
      403,
    )
  })

  it('persists across restarts and ignores rows of retired params', async () => {
    const cookie = await t.seed.cookie(adminId)
    await t.db.insert(systemParams).values([
      { key: 'writerDisconnectReleaseSec', value: 60 },
      { key: 'forceSyncMaxLatencyMs', value: 120 },
    ])
    forgetSysParams(t.db)
    expect((await put(cookie, '/api/admin/params', { sessionReplayCount: 20 })).status).toBe(200)
    const params = await sysParams(t.db)
    expect(params.sessionReplayCount).toBe(20)
    expect(params).not.toHaveProperty('writerDisconnectReleaseSec')
    expect((await admin.get<SystemParams>('/api/admin/params')).body).not.toHaveProperty(
      'forceSyncMaxLatencyMs',
    )
  })

  it('the attachment limits bound uploads and message sends', async () => {
    const cookie = await t.seed.cookie(adminId)
    await put(cookie, '/api/admin/params', { attachmentMaxMb: 1, attachmentsPerMessage: 1 })
    const g = await t.seed.group({ createdBy: adminId })
    const upload = (size: number) => {
      const boundary = 'x-boundary'
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="groupId"\r\n\r\n${g.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        Buffer.alloc(size, 1),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      return t.app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: body,
      })
    }
    const big = await upload(1024 * 1024 + 1)
    expect(big.statusCode).toBe(400)
    expect(big.json().message).toBe('单个附件不能超过 1 MB')
    const a = (await upload(10)).json() as { id: string }
    const b = (await upload(10)).json() as { id: string }
    const send = await admin.post<{ message: string }>(`/api/groups/${g.id}/messages`, {
      body: 'x',
      clientId: 'client-0001',
      attachmentIds: [a.id, b.id],
    })
    expect(send.status).toBe(400)
    expect(send.body.message).toBe('每条消息最多 1 个附件')
  })

  it('groups without their own params follow the system defaults', async () => {
    const cookie = await t.seed.cookie(adminId)
    await put(cookie, '/api/admin/params', { chainMaxHops: 5, offlineWaitMin: 45, approvalTimeoutMin: 20 })
    const b = await t.seed.bot({ ownerId: adminId })
    const g = await t.seed.group({ createdBy: adminId, botIds: [b.id] })
    await run(g.id, b.id, adminId, 'queued')
    const tl = await admin.get<{ runs: { hopMax: number; offlineWaitMin: number }[] }>(
      `/api/groups/${g.id}/timeline`,
    )
    expect(tl.body.runs[0]).toMatchObject({ hopMax: 5, offlineWaitMin: 45 })
    const [row] = await t.db.select().from(groups).where(eq(groups.id, g.id))
    expect(await timeoutMin(t.ctx, row!)).toBe(20)
    expect(await timeoutMin(t.ctx, { ...row!, params: { approvalTimeoutMin: 7 } })).toBe(7)
  })

  it('new bots take the default concurrency', async () => {
    const cookie = await t.seed.cookie(adminId)
    await put(cookie, '/api/admin/params', { botConcurrencyDefault: 4 })
    const res = await admin.post<{ id: string; concurrency: number }>('/api/bots', {
      name: 'x',
      ownerId: adminId,
      agentKind: 'claude',
      avatar: 'role-no',
      machineId: null,
      systemPrompt: '',
    })
    expect(res.body.concurrency).toBe(4)
    const [row] = await t.db.select().from(bots).where(eq(bots.id, res.body.id))
    expect(row?.concurrency).toBe(4)
  })
})
