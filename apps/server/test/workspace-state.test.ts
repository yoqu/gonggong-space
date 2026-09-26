import type { WebEvent } from '@gonggong/protocol'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { listBotStates, updateBotState } from '../src/modules/workspaces/state.js'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

it('updates a workspace state and pushes it to group members only', async () => {
  const alice = await t.seed.user()
  const outsider = await t.seed.user()
  const bot = await t.seed.bot({ ownerId: alice.id })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
  const seen: Record<string, WebEvent[]> = { a: [], o: [] }
  t.ctx.bus.attach(alice.id, (e) => seen.a!.push(e))
  t.ctx.bus.attach(outsider.id, (e) => seen.o!.push(e))

  expect(await listBotStates(t.ctx, group.id)).toEqual([
    {
      botId: bot.id,
      workspace: 'managed',
      state: 'pending',
      path: null,
      git: null,
      error: null,
      tier: null,
      model: null,
      effort: null,
    },
  ])
  const git = { branch: 'main', ahead: 0, behind: 0, dirty: false, workspace: 'managed' as const }
  await updateBotState(t.ctx, group.id, bot.id, { workspaceState: 'ready', gitStatus: git })
  expect(seen.a).toEqual([
    {
      t: 'group.botState',
      groupId: group.id,
      state: {
        botId: bot.id,
        workspace: 'managed',
        state: 'ready',
        path: null,
        git,
        error: null,
        tier: null,
        model: null,
        effort: null,
      },
    },
  ])
  expect(seen.o).toEqual([])
  expect(
    await updateBotState(t.ctx, group.id, 'b0000000-0000-0000-0000-000000000000', {
      workspaceState: 'failed',
    }),
  ).toBeNull()
})

it('serves the bot states of a group to its members only', async () => {
  const alice = await t.seed.user()
  const outsider = await t.seed.user()
  const bot = await t.seed.bot({ ownerId: alice.id })
  const group = await t.seed.group({ createdBy: alice.id, botIds: [bot.id] })
  const get = async (userId: string) =>
    t.app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}/bot-states`,
      headers: { cookie: await t.seed.cookie(userId) },
    })
  const res = await get(alice.id)
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual(await listBotStates(t.ctx, group.id))
  expect((await get(outsider.id)).statusCode).toBe(404)
})
