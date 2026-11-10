import { randomBytes } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MessageDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine, ROOT } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'
// Started with GEMINI_CLI_HOME, the scripted agent acts like Gemini CLI; `mock:echo` reports how it was started.
const MOCK = `${process.execPath} ${join(ROOT, 'tools/mock-agent/agent.js')}`

interface Echo {
  mode: string
  gemini: {
    home: string
    apiKey: string | null
    baseUrl: string | null
    memory: string | null
    settings: { security?: { auth?: { selectedType?: string } }; mcpServers?: Record<string, unknown> } | null
  } | null
}

test('a Gemini CLI bot runs on a Google AI Studio provider added on the machine page', async ({ page }) => {
  test.setTimeout(4 * 60_000)
  const KEY = `AIza-e2e-${randomBytes(12).toString('hex')}`
  const home = mkdtempSync(join(tmpdir(), 'gonggong-e2e-home-'))
  const { m, api } = await memberWithMachine(page, 'gm1', { env: { HOME: home, GONGGONG_ADAPTER_CMD: MOCK } })
  const me = await api.me()
  const bot = await api.call<{ id: string }>('post', '/api/bots', {
    name: 'gm1 Gemini',
    ownerId: me.id,
    agentKind: 'gemini',
    machineId: await api.machineId(),
    systemPrompt: '只改 server/',
  })
  m.start()
  try {
    await test.step('the machine page offers Gemini providers and names the protocol they must speak', async () => {
      await page.goto('/machines')
      await page.getByRole('region', { name: '我的机器' }).locator('.sidebar__open').first().click()
      const dialog = page.getByRole('region', { name: '机器详情' })
      await expect(dialog.locator('.machine__status[data-online="true"]')).toBeVisible({ timeout: 30_000 })
      await dialog.getByRole('tab', { name: 'Agent 与供应商' }).click()
      const gemini = dialog.getByRole('region', { name: 'Gemini CLI 供应商' })
      await gemini.getByRole('button', { name: '新增…' }).click()
      const editor = page.getByRole('dialog', { name: '新增 Gemini CLI 供应商' })
      await editor.getByRole('button', { name: /^Google AI Studio/ }).click()
      await expect(editor).toContainText('Google Gemini')
      await editor.getByLabel('API Key').fill(KEY)
      await editor.getByText('设为该机器默认').click()
      await editor.getByRole('button', { name: '保存' }).click()
      await expect(gemini.getByRole('radio', { name: /Google AI Studio/ })).toBeChecked()
      await expect(gemini).toContainText(`Key ****${KEY.slice(-4)}`)
    })

    await test.step('a run gets its own Gemini home with the instructions, and the key only in its env', async () => {
      const group = await api.call<{ id: string }>('post', '/api/groups', {
        name: 'Gemini 群',
        kind: 'group',
        botIds: [bot.id],
        repo: null,
      })
      await bindManaged(page.request, group.id, [bot.id])
      await page.goto(`/g/${group.id}`)
      await page.getByPlaceholder(composer).fill('@gm1 Gemini mock:echo')
      await page.getByRole('button', { name: '发送' }).click()
      let reply: MessageDto | undefined
      await expect
        .poll(
          async () => {
            const t = await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)
            const run = t.runs.find((r) => r.endedAt)
            reply = run && t.messages.find((x) => x.kind === 'bot' && x.runId === run.id)
            return reply ? run?.status : undefined
          },
          { timeout: 60_000 },
        )
        .toBe('completed')
      const echo = JSON.parse(reply!.body) as Echo
      const g = echo.gemini!
      expect(realpathSync(g.home).startsWith(realpathSync(join(m.home, 'gemini')))).toBe(true)
      // The run's replies are scrubbed of provider keys: it was there, and never left the machine.
      expect(g.apiKey).toBeTruthy()
      expect(reply!.body).not.toContain(KEY)
      expect(g.baseUrl).toBe('https://generativelanguage.googleapis.com')
      expect(g.memory).toContain('gm1 Gemini')
      expect(g.memory).toContain('只改 server/')
      expect(g.settings?.security?.auth?.selectedType).toBe('gemini-api-key')
      expect(g.settings?.mcpServers).toHaveProperty('gonggong')
      expect(JSON.stringify(g.settings)).not.toContain(KEY)
    })
  } finally {
    m.stop()
  }
})
