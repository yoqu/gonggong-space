import type { TimelineDto } from '@gonggong/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from './support/app.js'

let t: TestApp
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(() => t.close())

describe('i18n', () => {
  const login = (headers: Record<string, string>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers,
      payload: { account: 'nobody', password: 'wrong-password' },
    })

  it('answers errors in the language of Accept-Language, Chinese by default', async () => {
    expect((await login({ 'accept-language': 'en-US,en;q=0.9' })).json().message).toBe(
      'Wrong account or password',
    )
    expect((await login({})).json().message).toBe('账号或密码错误')
    const missing = await t.app.inject({
      url: '/api/groups/not-a-uuid',
      headers: { cookie: await t.seed.cookie((await t.seed.user()).id), 'accept-language': 'en' },
    })
    expect(missing.json().message).toBe("The group doesn't exist or you are no longer in it")
  })

  it('stores events in Chinese with their translatable source', async () => {
    const admin = await t.seed.user({ name: '王磊' })
    const zhao = await t.seed.user({ name: '赵敏' })
    const g = await t.seed.group({ createdBy: admin.id, name: '支付' })
    const cookie = await t.seed.cookie(admin.id)
    const headers = { cookie, 'accept-language': 'en' }
    await t.app.inject({
      method: 'POST',
      url: `/api/groups/${g.id}/members`,
      headers,
      payload: { userIds: [zhao.id] },
    })
    const timeline = (
      await t.app.inject({ url: `/api/groups/${g.id}/timeline`, headers })
    ).json<TimelineDto>()
    expect(timeline.messages.at(-1)).toMatchObject({
      kind: 'event',
      body: '王磊 邀请 赵敏 加入群',
      i18n: { key: '{user} 邀请 {member} 加入群', params: { user: '王磊', member: '赵敏' } },
    })
  })
})
