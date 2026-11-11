import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installRequests, installs, messages, plugins, runs, teamMembers } from '../src/db/schema.js'
import { fetchGithubSkill } from '../src/modules/market/github.js'
import { createTestApp, type TestApp } from './support/app.js'

vi.mock('../src/modules/market/github.js', () => ({ fetchGithubSkill: vi.fn(), upstreamCommit: vi.fn() }))

let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-11-10T08:00:00Z') })
})
afterEach(() => t.close())

const md = (name: string, body = 'Do it.') =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`
const skill = (name: string, body?: string) => [{ path: 'SKILL.md', content: md(name, body) }]

/** Own owns the team, eve administers the group, ann authors, mia is a plain member. */
async function world() {
  const own = await t.seed.user({ name: '欧文' })
  const eve = await t.seed.user({ name: '伊芙' })
  const ann = await t.seed.user({ name: '安' })
  const mia = await t.seed.user({ name: '米娅' })
  const { machine, token } = await t.seed.machine(own.id)
  const bot = await t.seed.bot({ ownerId: own.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({
    createdBy: eve.id,
    memberIds: [own.id, ann.id, mia.id],
    botIds: [bot.id],
  })
  const as = async (user: { id: string }) => {
    const [m] = await t.db
      .insert(messages)
      .values({ groupId: group.id, kind: 'user', authorUserId: user.id, body: '@Claude 市场', meta: {} })
      .returning()
    const [r] = await t.db
      .insert(runs)
      .values({
        groupId: group.id,
        botId: bot.id,
        triggerMessageId: m!.id,
        originUserId: user.id,
        status: 'running',
      })
      .returning()
    return async (name: string, args: unknown = {}) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${r!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
      return res.json<ToolCallRes>()
    }
  }
  return { own, eve, ann, mia, group, as }
}

describe('market tools', () => {
  it('publishes, submits, reviews and lists a skill for the initiator', async () => {
    const w = await world()
    const ann = await w.as(w.ann)
    const draft = await ann('market_publish', { files: skill('deploy', 'Ship it.') })
    expect(draft.isError).toBe(false)
    expect(draft.text).toMatch(/^已上传「deploy」到市场（团队内可见）：v1 草稿 · id /)
    expect(draft.text).toContain('用 market_submit 提交审核，团队管理员审核通过后上架')

    expect((await ann('market_mine')).text).toContain(
      '- deploy（deploy）· Skill · 团队内可见 · 未上架 · 最新 v1 草稿 · 上架 无',
    )
    expect(await ann('market_submit', { listing: 'deploy', changelog: '第一版' })).toMatchObject({
      isError: false,
      text: '已提交「deploy」v1 审核',
    })
    expect((await ann('market_reviews')).text).toBe('没有等发起人审核的版本')
    expect((await ann('market_review', { listing: 'deploy', version: 1, approve: true })).isError).toBe(true)

    const own = await w.as(w.own)
    const queue = await own('market_reviews')
    expect(queue.text).toContain('- deploy（deploy）v1 · Skill · 团队内可见 · 团队「默认团队」· 安 提交于')
    expect(queue.text).toContain('  更新说明：第一版')
    const read = await own('market_get', { listing: 'deploy', version: 1 })
    expect(read.text).toContain('团队内可见 · 未上架\n')
    expect(read.text).toMatch(/- v1 · 待审核 · 安 · \d{4}-\d\d-\d\d \d\d:\d\d UTC/)
    expect(read.text).toContain('Ship it.')
    expect((await own('market_get', { listing: 'deploy', version: 1, path: 'SKILL.md' })).text).toBe(
      `=== SKILL.md ===\n${md('deploy', 'Ship it.')}`,
    )
    expect((await own('market_review', { listing: 'deploy', version: 1, approve: false })).text).toContain(
      '驳回时必须写 note',
    )
    expect(await own('market_review', { listing: 'deploy', version: 1, approve: true })).toMatchObject({
      isError: false,
      text: '已通过「deploy」v1，已上架',
    })

    const mia = await w.as(w.mia)
    const list = await mia('market_list', { q: 'dep' })
    expect(list.text).toContain('- deploy（deploy）· Skill · 团队「默认团队」 · v1 · 引入 0 次 · id ')

    const again = await ann('market_publish', {
      files: skill('deploy', 'Ship v2.'),
      submit: true,
      changelog: '改',
    })
    expect(again.text).toContain('v2 草稿')
    expect(again.text).toContain('已提交 v2 审核')
    expect(
      (await ann('market_publish', { files: skill('deploy', 'Ship v2.'), submit: true })).text,
    ).toContain('没有新建版本\nv2 当前是待审核状态，无需再提交')
    expect(
      await own('market_review', { listing: 'deploy', version: 2, approve: false, note: '写清楚' }),
    ).toMatchObject({
      text: '已驳回「deploy」v2：写清楚',
    })
    expect((await ann('market_mine')).text).toContain('  审核意见：写清楚')

    expect(await ann('market_update', { listing: 'deploy', status: 'unlisted' })).toMatchObject({
      text: '已更新「deploy」：团队内可见 · 已下架',
    })
    expect((await mia('market_update', { listing: 'deploy', status: 'listed' })).text).toContain(
      '没有找到条目「deploy」',
    )
  })

  it('publishes a skill in effect here and a GitHub folder', async () => {
    const w = await world()
    const eve = await w.as(w.eve)
    expect((await eve('skill_create', { files: skill('notes') })).isError).toBe(false)
    expect((await eve('market_publish', { skill: 'notes', visibility: 'public' })).text).toContain(
      '已上传「notes」到市场（公开）：v1 草稿',
    )
    expect((await eve('market_publish', { skill: 'nope' })).text).toContain('本群没有名为「nope」的 Skill')
    expect((await eve('market_publish', { skill: 'notes', files: skill('x') })).text).toContain(
      'files、skill、github 必须且只能给一个',
    )

    vi.mocked(fetchGithubSkill).mockResolvedValue({
      files: [{ ...skill('gh-skill')[0]!, encoding: 'utf8' }],
      source: { url: 'https://github.com/o/r', ref: null, path: '', commit: 'abcdef1234' },
    })
    expect((await eve('market_publish', { github: 'https://github.com/o/r' })).text).toContain(
      '已上传「gh-skill」到市场（团队内可见）：v1 草稿',
    )
    const [row] = await t.db.select().from(plugins).where(eq(plugins.name, 'gh-skill'))
    expect(row?.ghSource?.commit).toBe('abcdef1234')
  })

  it('installs for admins, requests for members, and installs personally', async () => {
    const w = await world()
    const ann = await w.as(w.ann)
    await ann('market_publish', { files: skill('lint'), submit: true })
    await (await w.as(w.own))('market_review', { listing: 'lint', version: 1, approve: true })
    await ann('market_publish', { files: skill('lint', 'v2'), submit: true })
    await (await w.as(w.own))('market_review', { listing: 'lint', version: 2, approve: true })

    const mia = await w.as(w.mia)
    expect(await mia('market_install', { listing: 'lint', note: '要用' })).toMatchObject({
      isError: false,
      text: '发起人不是本群的管理员，已向管理员发出引入申请，批准后生效',
    })
    const [req] = await t.db.select().from(installRequests)
    expect(req).toMatchObject({ scope: 'group', scopeId: w.group.id, note: '要用', status: 'pending' })
    expect(await mia('market_install', { listing: 'lint', layer: 'personal', version: 1 })).toMatchObject({
      text: '已引入发起人个人的「lint」：固定在 v1 · 启用，下一轮生效',
    })
    expect((await mia('market_uninstall', { listing: 'lint' })).text).toBe('发起人不是本群的管理员，不能移除')

    const eve = await w.as(w.eve)
    expect((await eve('market_install', { listing: 'lint' })).text).toBe(
      '已引入本群的「lint」：跟随最新（当前 v2） · 启用，下一轮生效',
    )
    expect((await eve('market_install', { listing: 'lint', version: 1 })).text).toBe(
      '已更新本群的「lint」：固定在 v1 · 启用，下一轮生效',
    )
    expect((await eve('market_install', { listing: 'lint', enabled: false })).text).toBe(
      '已更新本群的「lint」：固定在 v1 · 停用，下一轮生效',
    )
    expect((await eve('market_install', { listing: 'lint', layer: 'team' })).text).toContain(
      '发起人不是本团队的管理员，已向管理员发出引入申请',
    )
    const listed = await mia('market_installs')
    expect(listed.text).toContain('本群（1）：\n- lint（lint）· Skill · v1（固定版本） · 停用 · id ')
    expect(listed.text).toContain(
      '本团队（0）：\n发起人个人（1）：\n- lint（lint）· Skill · v1（固定版本） · 启用',
    )

    expect((await eve('market_uninstall', { listing: 'lint' })).text).toBe('已从本群移除「lint」，下一轮生效')
    expect((await eve('market_uninstall', { listing: 'lint' })).text).toContain('本群没有引入「lint」')
    expect(await t.db.select().from(installs).where(eq(installs.scope, 'group'))).toEqual([])

    await t.db.update(teamMembers).set({ role: 'admin' }).where(eq(teamMembers.userId, w.eve.id))
    expect((await eve('market_install', { listing: 'lint', layer: 'team', version: 'latest' })).text).toBe(
      '已引入本团队的「lint」：跟随最新（当前 v2） · 启用，下一轮生效',
    )
  })
})
