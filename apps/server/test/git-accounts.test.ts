import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GitAccountDto, ProviderRepoDto } from '@gonggong/protocol'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitAccounts, users } from '../src/db/schema.js'
import { open } from '../src/lib/seal.js'
import { limits } from '../src/modules/git-accounts/providers.js'
import { createTestApp, type TestApp } from './support/app.js'
import { client } from './support/http.js'

type Route = (
  req: IncomingMessage,
  url: URL,
) => { status?: number; body?: unknown; hang?: boolean } | undefined

/** A fake GitHub Enterprise / GitLab instance on localhost. */
async function stub(route: Route) {
  const seen: string[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    seen.push(`${url.pathname}${url.search}`)
    const r = route(req, url)
    if (r?.hang) return
    res.writeHead(r?.status ?? (r ? 200 : 404), { 'content-type': 'application/json' })
    res.end(JSON.stringify(r?.body ?? { message: 'Not Found' }))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, seen, close: () => new Promise<void>((ok) => server.close(() => ok())) }
}

const ghRepo = (n: number, o: Record<string, unknown> = {}) => ({
  full_name: `team/repo-${n}`,
  clone_url: `https://git.corp/team/repo-${n}.git`,
  ssh_url: `git@git.corp:team/repo-${n}.git`,
  default_branch: 'main',
  private: n % 2 === 0,
  ...o,
})

const github: Route = (req, url) => {
  if (req.headers.authorization !== 'Bearer good')
    return { status: 401, body: { message: 'Bad credentials' } }
  const p = url.pathname
  if (p === '/api/v3/user') return { body: { login: 'alice' } }
  if (p === '/api/v3/user/repos') {
    const page = Number(url.searchParams.get('page'))
    const all = Array.from({ length: 150 }, (_, i) => ghRepo(i + 1))
    return { body: all.slice((page - 1) * 100, page * 100) }
  }
  if (p === '/api/v3/repos/team/repo-1/branches') {
    const page = Number(url.searchParams.get('page'))
    const all = Array.from({ length: 250 }, (_, i) => ({ name: `b${i}` }))
    return { body: all.slice((page - 1) * 100, page * 100) }
  }
}

const gitlab: Route = (req, url) => {
  if (req.headers['private-token'] !== 'good') return { status: 401, body: { message: '401 Unauthorized' } }
  const p = url.pathname
  if (p === '/api/v4/user') return { body: { username: 'bob' } }
  if (p === '/api/v4/projects')
    return {
      body: [
        {
          path_with_namespace: 'pay/core',
          http_url_to_repo: 'https://gl.corp/pay/core.git',
          ssh_url_to_repo: 'ssh://git@gl.corp:2222/pay/core.git',
          default_branch: 'develop',
          visibility: 'private',
        },
      ],
    }
  if (p === '/api/v4/projects/pay%2Fcore/repository/branches')
    return { body: [{ name: 'develop' }, { name: 'main' }] }
}

let t: TestApp
let fake: Awaited<ReturnType<typeof stub>>
beforeEach(async () => {
  t = await createTestApp()
})
afterEach(async () => {
  await fake?.close()
  await t.close()
})

async function alice() {
  const user = await t.seed.user({ name: '王磊' })
  return { user, api: client(t, await t.seed.cookie(user.id)) }
}

describe('git accounts', () => {
  it('verifies the token, stores it sealed and never returns it', async () => {
    fake = await stub(github)
    const { user, api } = await alice()
    const res = await api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: `${fake.base}/`,
      token: 'good',
    })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      provider: 'github',
      baseUrl: fake.base,
      login: 'alice',
      status: 'ok',
    })
    const [row] = await t.ctx.db.select().from(gitAccounts).where(eq(gitAccounts.userId, user.id))
    expect(row?.token).not.toBe('good')
    expect(open(row?.token ?? '')).toBe('good')
    const list = await api.get<GitAccountDto[]>('/api/me/git-accounts')
    expect(list.body).toEqual([res.body])
    expect(JSON.stringify(list.body)).not.toContain('good')
  })

  it('explains a rejected token or an unreachable instance', async () => {
    fake = await stub(github)
    const { api } = await alice()
    const bad = await api.post<{ message: string }>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: fake.base,
      token: 'nope',
    })
    expect(bad.status).toBe(400)
    expect(bad.body.message).toContain('Token 无效')
    const down = await api.post<{ message: string }>('/api/me/git-accounts', {
      provider: 'gitlab',
      baseUrl: 'http://127.0.0.1:1',
      token: 'good',
    })
    expect(down.status).toBe(400)
    expect(down.body.message).toContain('证书')
    const noBase = await api.post('/api/me/git-accounts', { provider: 'gitlab', token: 'good' })
    expect(noBase.status).toBe(400)
  })

  it('re-adding the same login replaces the token and revives the account', async () => {
    fake = await stub(github)
    const { api } = await alice()
    const first = await api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: fake.base,
      token: 'good',
    })
    await t.ctx.db.update(gitAccounts).set({ status: 'invalid' })
    const again = await api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: fake.base,
      token: 'good',
    })
    expect(again.body).toMatchObject({ id: first.body.id, status: 'ok' })
    expect((await api.get<GitAccountDto[]>('/api/me/git-accounts')).body).toHaveLength(1)
  })

  it('accounts are private to their owner', async () => {
    fake = await stub(github)
    const { api } = await alice()
    const { body: acc } = await api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: fake.base,
      token: 'good',
    })
    const bob = await t.seed.user({ name: '陈晨' })
    const asBob = client(t, await t.seed.cookie(bob.id))
    expect((await asBob.get<GitAccountDto[]>('/api/me/git-accounts')).body).toEqual([])
    expect((await asBob.get(`/api/git-accounts/${acc.id}/repos`)).status).toBe(404)
    expect((await asBob.get(`/api/git-accounts/${acc.id}/branches?repo=team/repo-1`)).status).toBe(404)
    expect((await asBob.del(`/api/me/git-accounts/${acc.id}`)).status).toBe(404)
    expect((await api.del(`/api/me/git-accounts/${acc.id}`)).status).toBe(204)
    expect((await api.get<GitAccountDto[]>('/api/me/git-accounts')).body).toEqual([])
  })
})

describe('github repos and branches', () => {
  async function connected() {
    fake = await stub(github)
    const a = await alice()
    const { body } = await a.api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'github',
      baseUrl: fake.base,
      token: 'good',
    })
    return { ...a, acc: body }
  }

  it('lists every page once, filters locally and caps at 30', async () => {
    const { api, acc } = await connected()
    const all = await api.get<ProviderRepoDto[]>(`/api/git-accounts/${acc.id}/repos`)
    expect(all.body).toHaveLength(30)
    expect(all.body[0]).toEqual({
      fullName: 'team/repo-1',
      url: 'git@git.corp:team/repo-1.git',
      defaultBranch: 'main',
      private: false,
    })
    const hit = await api.get<ProviderRepoDto[]>(`/api/git-accounts/${acc.id}/repos?q=REPO-14`)
    expect(hit.body.map((r) => r.fullName)).toEqual([
      'team/repo-14',
      ...Array.from({ length: 10 }, (_, i) => `team/repo-14${i}`),
    ])
    expect(fake.seen.filter((s) => s.startsWith('/api/v3/user/repos'))).toHaveLength(2)
  })

  it('stores https URLs for users who prefer https', async () => {
    const { user, api, acc } = await connected()
    await t.ctx.db.update(users).set({ gitProtocol: 'https' }).where(eq(users.id, user.id))
    const res = await api.get<ProviderRepoDto[]>(`/api/git-accounts/${acc.id}/repos?q=repo-1`)
    expect(res.body[0]?.url).toBe('https://git.corp/team/repo-1.git')
  })

  it('pages branches up to 200 and filters by q', async () => {
    const { api, acc } = await connected()
    const all = await api.get<string[]>(`/api/git-accounts/${acc.id}/branches?repo=team/repo-1`)
    expect(all.body).toHaveLength(200)
    const hit = await api.get<string[]>(`/api/git-accounts/${acc.id}/branches?repo=team/repo-1&q=b24`)
    expect(hit.body).toEqual(['b24'])
  })

  it('marks the account invalid when the token stops working', async () => {
    const { api, acc } = await connected()
    await t.ctx.db.update(gitAccounts).set({ token: 'revoked' })
    const res = await api.get<{ message: string }>(`/api/git-accounts/${acc.id}/repos`)
    expect(res.status).toBe(400)
    expect(res.body.message).toContain('重新连接')
    expect((await api.get<GitAccountDto[]>('/api/me/git-accounts')).body[0]?.status).toBe('invalid')
  })

  it('gives up on a hanging instance', async () => {
    const { api, acc } = await connected()
    await fake.close()
    fake = await stub(() => ({ hang: true }))
    await t.ctx.db.update(gitAccounts).set({ baseUrl: fake.base })
    limits.timeoutMs = 200
    try {
      const res = await api.get<{ message: string }>(`/api/git-accounts/${acc.id}/branches?repo=team/repo-1`)
      expect(res.status).toBe(400)
      expect(res.body.message).toContain('超时')
    } finally {
      limits.timeoutMs = 10_000
    }
  })
})

describe('gitlab repos and branches', () => {
  it('searches server-side among member projects', async () => {
    fake = await stub(gitlab)
    const { api } = await alice()
    const { body: acc } = await api.post<GitAccountDto>('/api/me/git-accounts', {
      provider: 'gitlab',
      baseUrl: fake.base,
      token: 'good',
    })
    expect(acc.login).toBe('bob')
    const repos = await api.get<ProviderRepoDto[]>(`/api/git-accounts/${acc.id}/repos?q=core`)
    expect(repos.body).toEqual([
      {
        fullName: 'pay/core',
        url: 'ssh://git@gl.corp:2222/pay/core.git',
        defaultBranch: 'develop',
        private: true,
      },
    ])
    const q = fake.seen.find((s) => s.startsWith('/api/v4/projects?')) ?? ''
    const params = new URLSearchParams(q.split('?')[1])
    expect(params.get('membership')).toBe('true')
    expect(params.get('search')).toBe('core')
    const branches = await api.get<string[]>(`/api/git-accounts/${acc.id}/branches?repo=pay/core`)
    expect(branches.body).toEqual(['develop', 'main'])
  })
})
