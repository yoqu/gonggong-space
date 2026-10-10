import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT, remoteRepo } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Scripted agent: `mock:echo` replies with the plugins it was started with.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

test('a group admin adds a skill; Claude gets the plugin, Codex a git-excluded link, and / lists it', async ({
  page,
}) => {
  test.setTimeout(5 * 60_000)
  const home = mkdtempSync(join(tmpdir(), 'gonggong-e2e-home-'))
  mkdirSync(join(home, 'codex'))
  const env = { HOME: home, CODEX_HOME: join(home, 'codex'), GONGGONG_ADAPTER_CMD: MOCK }
  const repo = remoteRepo()
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `sk${tag}`, { env })
  const me = await api.me()
  const machineId = await api.machineId()
  const newBot = (name: string, agentKind: 'claude' | 'codex') =>
    api.call<{ id: string }>('post', '/api/bots', {
      name,
      ownerId: me.id,
      agentKind,
      machineId,
      systemPrompt: '',
    })
  const [claudeName, codexName] = [`${tag} Claude`, `${tag} Codex`]
  const claude = await newBot(claudeName, 'claude')
  const codex = await newBot(codexName, 'codex')
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: 'Skill 下发',
      kind: 'group',
      botIds: [claude.id, codex.id],
      repo: { url: repo.url, branch: 'main' },
    })
    await bindManaged(page.request, group.id, [claude.id, codex.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')

    await test.step('the group admin writes a skill in 群设置 · Skill', async () => {
      await main.getByRole('button', { name: '群设置' }).click()
      await page
        .getByRole('complementary', { name: '群设置' })
        .getByRole('button', { name: /同步模式/ })
        .click()
      const settings = page.getByRole('dialog', { name: /Skill 下发/ })
      await settings.getByRole('button', { name: 'Skill', exact: true }).click()
      await settings.getByRole('button', { name: '添加 Skill…' }).click()
      const editor = page.getByRole('dialog', { name: '添加 Skill' })
      await editor
        .getByLabel('SKILL.md')
        .fill('---\nname: review-pr\ndescription: 按团队规范审查 diff\n---\n先跑测试再审查。\n')
      await editor.getByRole('button', { name: '保存' }).click()
      await expect(editor).toBeHidden()
      await expect(settings.getByText('/gonggong-team:review-pr')).toBeVisible()
      await expect(settings.getByText('v1', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    })

    await test.step('/ lists the team skill', async () => {
      const box = page.getByPlaceholder(composer)
      await box.fill('/review')
      const skills = page.getByRole('listbox', { name: '/ 命令' }).getByRole('group', { name: '团队 Skill' })
      await expect(skills.getByRole('option', { name: /gonggong-team:review-pr/ })).toBeVisible()
      await box.fill('')
    })

    const timeline = () => api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
    const echo = async (bot: string) => {
      const before = (await timeline()).messages.filter((x) => x.kind === 'bot').length
      await page.getByPlaceholder(composer).fill(`@${bot} mock:echo`)
      await page.getByRole('button', { name: '发送' }).click()
      let reply: MessageDto | undefined
      await expect
        .poll(
          async () => {
            reply = (await timeline()).messages.filter((x) => x.kind === 'bot').at(before)
            return reply?.body
          },
          { timeout: 60_000 },
        )
        .toBeTruthy()
      return JSON.parse(reply!.body) as { plugins: { type: string; path: string }[] | null; cwd: string }
    }

    await test.step('Claude starts with the plugin folder holding the skill', async () => {
      const got = await echo(claudeName)
      expect(got.plugins).toHaveLength(1)
      const plugin = got.plugins![0]!.path
      expect(plugin).toBe(join(m.home, 'skill-sets', `${group.id}-${claude.id}`))
      expect(readFileSync(join(plugin, 'skills/review-pr/SKILL.md'), 'utf8')).toContain('先跑测试再审查')
      expect(JSON.parse(readFileSync(join(plugin, '.claude-plugin/plugin.json'), 'utf8')).name).toBe(
        'gonggong-team',
      )
    })

    await test.step('Codex gets a link in its workspace, and the tree stays clean', async () => {
      const got = await echo(codexName)
      const link = join(got.cwd, '.agents/skills/review-pr')
      expect(readlinkSync(link)).toBe(
        join(m.home, 'skill-sets', `${group.id}-${codex.id}`, 'skills/review-pr'),
      )
      expect(readFileSync(join(link, 'SKILL.md'), 'utf8')).toContain('先跑测试再审查')
      expect(execFileSync('git', ['status', '--porcelain'], { cwd: got.cwd, encoding: 'utf8' })).toBe('')
    })
  } finally {
    m.stop()
  }
})

test('a group admin has a bot create a skill through gonggong; settings and / list it, the next turn gets it', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000)
  const tag = Date.now().toString(36)
  const { m, api } = await memberWithMachine(page, `skt${tag}`, { env: { GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const botName = `${tag} Bot`
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: botName,
    ownerId: me.id,
    agentKind: 'claude',
    machineId: await api.machineId(),
    systemPrompt: '',
  })
  m.start()
  try {
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: 'Skill 自助',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    await page.goto(`/g/${group.id}`)
    const main = page.getByRole('main')
    const box = page.getByPlaceholder(composer)
    const runs = page.getByTestId('run-card')
    const turn = async (text: string, nth: number) => {
      await box.fill(text)
      await page.getByRole('button', { name: '发送' }).click()
      await expect(runs).toHaveCount(nth, { timeout: 60_000 })
      await expect(runs.nth(nth - 1)).toHaveAttribute('data-status', 'completed', { timeout: 60_000 })
    }

    const skill =
      '---\nname: release-notes\ndescription: 按团队格式整理发布说明\n---\n先列合并的 PR 再分类。\n'
    await turn(
      `@${botName} mock:tool skill_create ${JSON.stringify({ files: [{ path: 'SKILL.md', content: skill }] })}`,
      1,
    )

    await test.step('群设置 · Skill shows it at v1', async () => {
      await main.getByRole('button', { name: '群设置' }).click()
      await page
        .getByRole('complementary', { name: '群设置' })
        .getByRole('button', { name: /同步模式/ })
        .click()
      const settings = page.getByRole('dialog', { name: /Skill 自助/ })
      await settings.getByRole('button', { name: 'Skill', exact: true }).click()
      await expect(settings.getByText('/gonggong-team:release-notes')).toBeVisible()
      await expect(settings.getByText('v1', { exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    })

    await test.step('/ lists it', async () => {
      await box.fill('/release')
      const skills = page.getByRole('listbox', { name: '/ 命令' }).getByRole('group', { name: '团队 Skill' })
      await expect(skills.getByRole('option', { name: /gonggong-team:release-notes/ })).toBeVisible()
      await box.fill('')
    })

    await test.step('the next turn starts with the skill plugin', async () => {
      await turn(`@${botName} mock:echo`, 2)
      const plugin = join(m.home, 'skill-sets', `${group.id}-${bot.id}`)
      expect(readFileSync(join(plugin, 'skills/release-notes/SKILL.md'), 'utf8')).toContain('先列合并的 PR')
    })
  } finally {
    m.stop()
  }
})
