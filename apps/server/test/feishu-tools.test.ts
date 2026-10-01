import type { RunStart, ServerToDaemon, ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { feishuApps, feishuChats, feishuIdentities, messages, runs } from '../src/db/schema.js'
import { seal } from '../src/lib/seal.js'
import { schedule } from '../src/modules/runs/scheduler.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

const MAIN = { appId: 'cli_main01', appSecret: 'main-secret' }
const at = (min: number) => new Date(Date.UTC(2026, 8, 23, 10, min))
const text = (s: string) => JSON.stringify({ text: s })

async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const { machine, token } = await t.seed.machine(wang.id)
  const claude = await t.seed.bot({ ownerId: wang.id, name: '小王的 Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: wang.id, name: '支付服务重构', botIds: [claude.id] })
  const [trigger] = await t.db
    .insert(messages)
    .values({ groupId: group.id, kind: 'user', authorUserId: wang.id, body: '@小王的 Claude 看看' })
    .returning()
  const [run] = await t.db
    .insert(runs)
    .values({
      groupId: group.id,
      botId: claude.id,
      triggerMessageId: trigger!.id,
      originUserId: wang.id,
      status: 'running',
    })
    .returning()
  const mainApp = () =>
    t.db
      .insert(feishuApps)
      .values({ kind: 'main', ...MAIN, appSecret: seal(MAIN.appSecret), updatedBy: wang.id })
  const bind = () =>
    t.db
      .insert(feishuChats)
      .values({ groupId: group.id, chatId: 'oc_pay', name: '支付重构', boundBy: wang.id })
  /** Links 王磊 to a Feishu identity holding a live main-app token. */
  const link = async (expiresAt = new Date(Date.now() + 3600_000)) => {
    const fu = t.feishu.user({ name: '王磊（飞书）' })
    const tokens = await t.feishu.api.exchangeCode(MAIN, t.feishu.authorize(fu), 'https://gg.example/cb')
    await t.db.insert(feishuIdentities).values({
      userId: wang.id,
      unionId: fu.unionId,
      openId: fu.openId,
      name: fu.name,
      accessToken: seal(tokens.accessToken),
      refreshToken: tokens.refreshToken ? seal(tokens.refreshToken) : null,
      expiresAt,
      refreshExpiresAt: tokens.refreshExpiresAt,
    })
    return fu
  }
  const call = async (args: unknown = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/daemon/runs/${run!.id}/tools/list_feishu_messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: { arguments: args },
    })
    return res.json<ToolCallRes>()
  }
  return { wang, machine, claude, group, run: run!, mainApp, bind, link, call }
}

describe('list_feishu_messages', () => {
  it('explains what is missing instead of reading', async () => {
    const w = await world()
    expect(await w.call()).toMatchObject({ isError: true, text: '当前群未绑定飞书群，无法读取飞书消息' })
    await w.bind()
    expect(await w.call()).toMatchObject({ isError: true, text: '系统未配置飞书主应用，无法读取飞书消息' })
    await w.mainApp()
    expect(await w.call()).toMatchObject({
      isError: true,
      text: '触发人「王磊」尚未绑定飞书账号（或授权已失效），无法以其身份读取飞书消息',
    })
  })

  it('reads the bound chat as the run initiator, oldest first, without storing anything', async () => {
    const w = await world()
    await w.mainApp()
    await w.bind()
    const me = await w.link()
    const bot = await t.db
      .insert(feishuApps)
      .values({
        kind: 'bot',
        botId: w.claude.id,
        teamId: w.group.teamId,
        appId: 'cli_bot01',
        appSecret: seal('s'),
        updatedBy: w.wang.id,
      })
      .returning()
    expect(bot).toHaveLength(1)
    t.feishu.history.set('oc_pay', [
      {
        messageId: 'om_1',
        msgType: 'text',
        content: text('退款要兼容旧签名'),
        senderId: me.openId,
        senderType: 'user',
        createdAt: at(1),
      },
      {
        messageId: 'om_2',
        msgType: 'post',
        content: JSON.stringify({
          title: '方案',
          content: [
            [
              { tag: 'text', text: '先灰度' },
              { tag: 'a', text: '文档', href: 'x' },
            ],
          ],
        }),
        senderId: 'ou_stranger',
        senderType: 'user',
        createdAt: at(2),
      },
      {
        messageId: 'om_3',
        msgType: 'image',
        content: '{"image_key":"k"}',
        senderId: 'cli_bot01',
        senderType: 'app',
        createdAt: at(3),
      },
      {
        messageId: 'om_4',
        msgType: 'file',
        content: '{"file_key":"f","file_name":"spec.pdf"}',
        senderId: 'cli_other',
        senderType: 'app',
        createdAt: at(4),
      },
    ])
    const before = await t.db.select().from(messages)

    const all = await w.call()
    expect(all.isError).toBeFalsy()
    expect(all.text).toBe(
      [
        '飞书群「支付重构」最近 4 条（实时读取，未保存）',
        '[2026-09-23 10:01] 王磊: 退款要兼容旧签名',
        '[2026-09-23 10:02] 飞书用户（ou_stranger）: 方案 先灰度文档',
        '[2026-09-23 10:03] 小王的 Claude: [图片]',
        '[2026-09-23 10:04] 飞书应用（cli_other）: [文件 spec.pdf]',
      ].join('\n'),
    )

    const page = await w.call({ limit: 2 })
    expect(page.text).toContain('[2026-09-23 10:03]')
    expect(page.text).not.toContain('[2026-09-23 10:02]')
    expect(page.text.split('\n').at(-1)).toBe(`更早：before=${at(3).toISOString()}`)
    const older = await w.call({ limit: 2, before: at(3).toISOString() })
    expect(older.text).toContain('退款要兼容旧签名')
    expect(older.text).toContain('先灰度')

    expect(await t.db.select().from(messages)).toEqual(before)
  })

  it('reports a revoked authorization and drops the dead token', async () => {
    const w = await world()
    await w.mainApp()
    await w.bind()
    await w.link(new Date(Date.now() - 1000))
    await t.db.update(feishuIdentities).set({ refreshToken: seal('ur_gone') })
    expect((await w.call()).text).toBe(
      '触发人「王磊」尚未绑定飞书账号（或授权已失效），无法以其身份读取飞书消息',
    )
    const [row] = await t.db.select().from(feishuIdentities)
    expect(row!.accessToken).toBeNull()
  })

  it('tells the agent about the tool only in groups bound to Feishu', async () => {
    const w = await world()
    const sent: ServerToDaemon[] = []
    t.ctx.hub.register(w.machine.id, { send: (m: ServerToDaemon) => void sent.push(m), close: () => {} })
    const startOf = async () => {
      await t.db.update(runs).set({ status: 'queued' }).where(eq(runs.id, w.run.id))
      await schedule(t.ctx, w.claude.id)
      return sent.filter((m): m is RunStart => m.t === 'run.start').at(-1)!
    }
    expect((await startOf()).bot.systemPrompt).not.toContain('list_feishu_messages')
    await w.bind()
    expect((await startOf()).bot.systemPrompt).toContain('list_feishu_messages')
  })
})
