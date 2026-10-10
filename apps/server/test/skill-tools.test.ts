import type { ToolCallRes } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { auditLogs, messages, runs, skills, skillVersions } from '../src/db/schema.js'
import { createSkill, enabledSkills, snapshot } from '../src/modules/skills/service.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp({ now: () => new Date('2026-10-05T00:30:00Z') })
})
afterEach(() => t.close())

const md = (name: string, body = 'Do the thing.') =>
  `---\nname: ${name}\ndescription: ${name} helper\n---\n${body}\n`
const skill = (name: string, body?: string) => [
  { path: 'SKILL.md', content: md(name, body), encoding: 'utf8' as const },
]

/** Wang owns the team, Li administers the group, Zhao is a plain member; root is a teamless sysadmin. */
async function world() {
  const wang = await t.seed.user({ name: '王磊' })
  const li = await t.seed.user({ name: '李建国' })
  const zhao = await t.seed.user({ name: '赵敏' })
  const root = await t.seed.user({ name: '根', role: 'sysadmin', teamId: null })
  const { machine, token } = await t.seed.machine(wang.id)
  const bot = await t.seed.bot({ ownerId: wang.id, name: 'Claude', machineId: machine.id })
  const group = await t.seed.group({ createdBy: li.id, memberIds: [wang.id, zhao.id], botIds: [bot.id] })
  const platform = (name: string, body?: string) =>
    createSkill(
      t.ctx,
      { scope: 'platform', teamId: null, groupId: null },
      snapshot(skill(name, body)),
      true,
      root.id,
    )
  const runOf = async (user: { id: string }) => {
    const [m] = await t.db
      .insert(messages)
      .values({
        groupId: group.id,
        kind: 'user',
        authorUserId: user.id,
        body: '@Claude 整理成 skill',
        meta: {},
      })
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
    const call = async (name: string, args: unknown = {}) => {
      const res = await t.app.inject({
        method: 'POST',
        url: `/api/daemon/runs/${r!.id}/tools/${name}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { arguments: args },
      })
      return res.json<ToolCallRes>()
    }
    return { run: r!, call }
  }
  return { wang, li, zhao, bot, group, platform, runOf }
}

describe('skill tools', () => {
  it('creates group skills for group admins and lists all layers with what is in effect', async () => {
    const w = await world()
    await w.platform('wiki', 'platform wiki')
    await w.platform('jira')
    const li = await w.runOf(w.li)
    const files = [
      ...skill('review', 'Review the diff.'),
      { path: 'scripts/run.sh', content: 'echo hi\n' },
      { path: 'assets/logo.png', content: Buffer.from([0, 1, 2]).toString('base64'), encoding: 'base64' },
    ]
    const made = await li.call('skill_create', { files })
    expect(made).toMatchObject({ isError: false, text: '已新建群层 Skill「review」（v1），下一轮生效' })
    const [row] = await t.db.select().from(skills).where(eq(skills.name, 'review'))
    expect(row).toMatchObject({ scope: 'group', groupId: w.group.id, updatedBy: w.li.id, enabled: true })

    const wang = await w.runOf(w.wang)
    expect(
      (await wang.call('skill_create', { layer: 'team', files: skill('wiki', 'team wiki') })).isError,
    ).toBe(false)

    const zhao = await w.runOf(w.zhao)
    const listed = await zhao.call('skill_list')
    expect(listed.text.split('\n')).toEqual([
      '本群可见的 Skill（4 个，同名时群层覆盖团队层、团队层覆盖平台层）：',
      '- jira · 平台层 · v1 · 生效 · 只读',
      '  说明：jira helper',
      '- review · 群层 · v1 · 生效 · 发起人无权修改',
      '  说明：review helper',
      '- wiki · 团队层 · v1 · 生效 · 发起人无权修改',
      '  说明：wiki helper',
      '- wiki · 平台层 · v1 · 被团队层同名 Skill 覆盖 · 只读',
      '  说明：wiki helper',
    ])
    expect((await li.call('skill_list')).text).toContain('- review · 群层 · v1 · 生效 · 可修改')

    const got = await zhao.call('skill_get', { name: 'review' })
    expect(got.text.split('\n')).toEqual([
      '「review」· 群层 · v1 · 已启用',
      '说明：review helper',
      '共 3 个文件：',
      '=== SKILL.md ===',
      ...md('review', 'Review the diff.').split('\n'),
      '=== assets/logo.png ===',
      '（二进制文件，3 字节，内容省略）',
      '=== scripts/run.sh ===',
      'echo hi',
      '',
    ])
    expect((await zhao.call('skill_get', { name: 'wiki' })).text).toContain('team wiki')
    expect((await zhao.call('skill_get', { name: 'wiki', layer: 'platform' })).text).toContain(
      'platform wiki',
    )
    expect(await zhao.call('skill_get', { name: 'nope' })).toMatchObject({
      isError: true,
      text: '本群没有名为「nope」的 Skill，请用 skill_list 查看',
    })
  })

  it('refuses writes the run’s originator could not make on the web', async () => {
    const w = await world()
    await w.platform('jira')
    const zhao = await w.runOf(w.zhao)
    expect(await zhao.call('skill_create', { files: skill('review') })).toMatchObject({
      isError: true,
      text: '发起人不是本群管理员，不能修改群层 Skill',
    })
    const li = await w.runOf(w.li)
    expect(await li.call('skill_create', { layer: 'team', files: skill('review') })).toMatchObject({
      isError: true,
      text: '发起人不是本群所属团队的管理员，不能修改团队层 Skill',
    })
    expect((await li.call('skill_toggle', { name: 'jira', layer: 'platform', enabled: false })).isError).toBe(
      true,
    )
    expect(await li.call('skill_toggle', { name: 'jira', enabled: false })).toMatchObject({
      isError: true,
      text: '本群没有名为「jira」的群层 Skill，请用 skill_list 查看',
    })
    const wang = await w.runOf(w.wang)
    expect((await wang.call('skill_create', { layer: 'team', files: skill('review') })).isError).toBe(false)
    expect(await zhao.call('skill_delete', { name: 'review', layer: 'team' })).toMatchObject({
      isError: true,
      text: '发起人不是本群所属团队的管理员，不能修改团队层 Skill',
    })
    expect(await t.db.select().from(skills)).toHaveLength(2)
  })

  it('updates files into new versions, renames, rolls back and audits as the originator via the bot', async () => {
    const w = await world()
    const li = await w.runOf(w.li)
    await li.call('skill_create', {
      files: [...skill('review', 'one'), { path: 'notes.md', content: 'old' }],
    })
    await li.call('skill_create', { files: skill('lint') })

    const updated = await li.call('skill_update', {
      name: 'review',
      files: [{ path: 'scripts/run.sh', content: 'echo\n' }],
      remove: ['notes.md'],
    })
    expect(updated.text).toBe('已更新群层 Skill「review」：v2，下一轮生效')
    const paths = async () => (await li.call('skill_get', { name: 'review' })).text.match(/^=== .+ ===$/gm)
    expect(await paths()).toEqual(['=== SKILL.md ===', '=== scripts/run.sh ==='])
    expect(await li.call('skill_update', { name: 'review', files: skill('review', 'one') })).toMatchObject({
      isError: false,
      text: '内容没有变化，无需更新',
    })
    expect(await li.call('skill_update', { name: 'review', remove: ['missing.md'] })).toMatchObject({
      isError: true,
      text: '「review」没有文件 missing.md',
    })
    expect(await li.call('skill_update', { name: 'review', files: skill('lint') })).toMatchObject({
      isError: true,
      text: 'Skill 名称已存在',
    })
    expect(await li.call('skill_update', { name: 'review', remove: ['SKILL.md'] })).toMatchObject({
      isError: true,
      text: '缺少 SKILL.md',
    })
    const renamed = await li.call('skill_update', { name: 'review', files: skill('code-review', 'two') })
    expect(renamed.text).toBe('已更新群层 Skill「code-review」（原名「review」）：v3，下一轮生效')

    const versions = await li.call('skill_versions', { name: 'code-review' })
    expect(versions.text.replace(/ · [\d-]+ [\d:]+$/gm, '').split('\n')).toEqual([
      '「code-review」（群层）的版本：',
      `- v3（当前）· ${md('code-review', 'two').length + 5} 字节 · 李建国`,
      `- v2 · ${md('review', 'one').length + 5} 字节 · 李建国`,
      `- v1 · ${md('review', 'one').length + 3} 字节 · 李建国`,
    ])
    expect((await li.call('skill_get', { name: 'code-review', version: 1 })).text).toContain(
      '「code-review」· 群层 · v1（当前 v3）· 已启用',
    )
    expect((await li.call('skill_rollback', { name: 'code-review', version: 1 })).text).toBe(
      '已把群层 Skill「review」回滚到 v1，下一轮生效',
    )
    expect(await li.call('skill_rollback', { name: 'review', version: 9 })).toMatchObject({
      isError: true,
      text: '「review」没有 v9，请用 skill_versions 查看',
    })
    expect(await t.db.select().from(skillVersions)).toHaveLength(4)

    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.actorUserId, w.li.id))
    expect(log.map((l) => l.action)).toEqual([
      'skill.create',
      'skill.create',
      'skill.update',
      'skill.update',
      'skill.rollback',
    ])
    expect(log[4]!.detail).toMatchObject({
      name: 'review',
      layer: 'group',
      botId: w.bot.id,
      runId: li.run.id,
    })
  })

  it('toggles and deletes, taking effect in enabledSkills', async () => {
    const w = await world()
    await w.platform('review', 'platform')
    const li = await w.runOf(w.li)
    await li.call('skill_create', { files: skill('review', 'group') })
    const [own] = await t.db.select().from(skills).where(eq(skills.scope, 'group'))
    const effective = async () => (await enabledSkills(t.db, w.group.id)).map((s) => s.versionId)
    expect(await effective()).toEqual([own!.versionId])
    expect((await li.call('skill_toggle', { name: 'review', enabled: false })).text).toBe(
      '已停用群层 Skill「review」，下一轮生效',
    )
    expect((await li.call('skill_list')).text).toContain('- review · 群层 · v1 · 已停用 · 可修改')
    expect(await effective()).not.toEqual([own!.versionId])
    expect((await li.call('skill_get', { name: 'review' })).text).toContain('platform')
    await li.call('skill_toggle', { name: 'review', enabled: true })
    expect(await effective()).toEqual([own!.versionId])
    expect((await li.call('skill_delete', { name: 'review' })).text).toBe(
      '已删除群层 Skill「review」及其全部版本',
    )
    expect((await li.call('skill_get', { name: 'review' })).text).toContain('平台层')
    expect(await t.db.select().from(skills)).toHaveLength(1)
  })

  it('turns validation failures into tool errors', async () => {
    const w = await world()
    const li = await w.runOf(w.li)
    const bad = (files: unknown) => li.call('skill_create', { files })
    expect(await bad([{ path: 'README.md', content: 'x' }])).toMatchObject({
      isError: true,
      text: '缺少 SKILL.md',
    })
    expect(await bad(skill('Bad Name'))).toMatchObject({
      isError: true,
      text: 'SKILL.md 的 name 只能用小写字母、数字和连字符，最长 64 个字符',
    })
    expect(await bad([...skill('ok'), { path: '../x', content: '' }])).toMatchObject({
      isError: true,
      text: '文件路径不合法：../x',
    })
    expect((await bad([])).isError).toBe(true)
    expect(await t.db.select().from(skills)).toEqual([])
  })
})
