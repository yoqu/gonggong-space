import type { AgentCatalog, MachineDto, RunDto, TimelineDto } from '@gonggong/protocol'
import { expect, test } from '@playwright/test'
import { bindManaged, buildDaemon, memberWithMachine } from './helpers'

test.beforeAll(buildDaemon)

const composer = '输入消息，@ 触发 Bot 或引用文件，/ 查看命令'

test('the probed catalog reaches the server; bot default, group default and a one-shot pick drive each turn', async ({
  page,
}) => {
  test.setTimeout(10 * 60_000)
  const { m, api } = await memberWithMachine(page, 'mdl1')
  m.start()
  try {
    const me = await api.me()
    let catalog: AgentCatalog | null = null
    await expect
      .poll(
        async () => {
          const [machine] = await api.call<MachineDto[]>('get', '/api/machines')
          catalog = machine?.agents.find((a) => a.kind === 'claude')?.catalog ?? null
          return catalog?.models.length ?? 0
        },
        { timeout: 3 * 60_000 },
      )
      .toBeGreaterThan(1)
    const models = catalog!.models
    const find = (word: string) =>
      models.find((x) => x.value.includes(word) || x.name.toLowerCase().includes(word))
    const cheap = find('haiku') ?? models[0]!
    const other = find('sonnet') ?? models.find((x) => x !== cheap)!

    const bot = await api.call<{ id: string }>('post', '/api/bots', {
      name: 'mdl1 Claude',
      ownerId: me.id,
      agentKind: 'claude',
      avatar: 'role-no',
      machineId: await api.machineId(),
      systemPrompt: '',
      model: cheap.value,
    })
    const group = await api.call<{ id: string }>('post', '/api/groups', {
      name: 'mdl1',
      kind: 'group',
      botIds: [bot.id],
      repo: null,
    })
    await bindManaged(page.request, group.id, [bot.id])
    const put = await page.request.put(`/api/groups/${group.id}/bots/${bot.id}/config`, {
      data: { model: other.value, effort: null },
    })
    expect(put.status()).toBe(204)
    await page.goto(`/g/${group.id}`)
    await expect(page.getByRole('main').getByText(`在本群的模型设为 ${other.name}`)).toBeVisible()

    const runs = async () =>
      (await api.call<TimelineDto>('get', `/api/groups/${group.id}/timeline`)).runs as RunDto[]
    const finished = async (n: number) => {
      await expect
        .poll(async () => (await runs()).filter((r) => r.endedAt).length, { timeout: 4 * 60_000 })
        .toBe(n)
      return (await runs()).at(-1)!
    }

    // One-shot: pick the cheap model under the input for this message only.
    await page.getByPlaceholder(composer).fill('@mdl1 Claude 只回复 ok')
    const chip = page.getByRole('button', { name: 'mdl1 Claude 的模型与推理强度' })
    await expect(chip).toContainText(other.name)
    await chip.click()
    await page.getByRole('menuitemcheckbox', { name: cheap.name }).click()
    await expect(chip).toContainText('仅本条')
    await page.getByRole('button', { name: '发送' }).click()
    const first = await finished(1)
    expect([first.status, first.model]).toEqual(['completed', cheap.value])

    // The next message follows the group default again.
    await page.getByPlaceholder(composer).fill('@mdl1 Claude 只回复 ok')
    await expect(chip).toContainText(other.name)
    await expect(chip).not.toContainText('仅本条')
    await page.getByRole('button', { name: '发送' }).click()
    const second = await finished(2)
    expect([second.status, second.model]).toEqual(['completed', other.value])
  } finally {
    m.stop()
  }
})
