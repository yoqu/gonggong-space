import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type TerminalLinkTarget, terminalLinkRoutes } from '../src/modules/terminals/links.js'

const userId = '00000000-0000-4000-8000-000000000001'
const groupId = '00000000-0000-4000-8000-000000000002'
const botId = '00000000-0000-4000-8000-000000000003'

function requestHarness(o: { cookie?: boolean; authorized?: boolean } = {}) {
  const target = {
    userId,
    groupId,
    botId,
  } satisfies TerminalLinkTarget
  const authorize = vi.fn().mockResolvedValue(o.authorized === false ? null : target)
  const exists = vi.fn().mockResolvedValue(true)
  const app = Fastify()
  app.register(
    terminalLinkRoutes({
      user: async () => (o.cookie === false ? null : { id: userId }),
      authorize,
      exists,
    }),
  )
  return { app, authorize, exists }
}

afterEach(() => vi.restoreAllMocks())

describe('terminal link resolution', () => {
  it('requires a logged-in machine owner', async () => {
    const anonymous = requestHarness({ cookie: false })
    const denied = requestHarness({ authorized: false })
    const url = `/api/groups/${groupId}/bots/${botId}/terminal-links/resolve`

    expect(
      (await anonymous.app.inject({ method: 'POST', url, payload: { path: 'src/app.ts', line: 1 } }))
        .statusCode,
    ).toBe(401)
    expect(
      (await denied.app.inject({ method: 'POST', url, payload: { path: 'src/app.ts', line: 1 } })).statusCode,
    ).toBe(403)
    expect(denied.exists).not.toHaveBeenCalled()
    await anonymous.app.close()
    await denied.app.close()
  })

  it('returns only a relative path, line and daemon-reported existence', async () => {
    const h = requestHarness()
    const url = `/api/groups/${groupId}/bots/${botId}/terminal-links/resolve`
    const res = await h.app.inject({
      method: 'POST',
      url,
      payload: { path: './src/app.ts', line: 42 },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ path: 'src/app.ts', line: 42, exists: true })
    expect(h.authorize).toHaveBeenCalledWith(userId, groupId, botId)
    expect(h.exists).toHaveBeenCalledWith({ userId, groupId, botId }, { path: 'src/app.ts' })
    await h.app.close()
  })

  it.each([
    '/etc/passwd',
    '../secret.ts',
    'src/../../secret.ts',
    'file:///etc/passwd',
    'C:/Windows/system.ini',
    'src/%2e%2e/secret.ts',
  ])('rejects unsafe path %s before asking the daemon', async (path) => {
    const h = requestHarness()
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/bots/${botId}/terminal-links/resolve`,
      payload: { path, line: 1 },
    })

    expect(res.statusCode).toBe(400)
    expect(h.authorize).not.toHaveBeenCalled()
    expect(h.exists).not.toHaveBeenCalled()
    await h.app.close()
  })
})
