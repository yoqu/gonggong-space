import { AddGitAccountReq, type GitAccountDto, type ProviderRepoDto } from '@gonggong/protocol'
import { and, asc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { Ctx } from '../../context.js'
import { gitAccounts } from '../../db/schema.js'
import { fail } from '../../lib/errors.js'
import { idParam } from '../../lib/ids.js'
import { open, seal } from '../../lib/seal.js'
import { requireUser } from '../auth/session.js'
import { type Account, forgetAccount, ProviderError, providerApi } from './providers.js'

type Row = typeof gitAccounts.$inferSelect

const toDto = (r: Row): GitAccountDto => ({
  id: r.id,
  provider: r.provider as GitAccountDto['provider'],
  baseUrl: r.baseUrl,
  login: r.login,
  status: r.status as GitAccountDto['status'],
})

function baseUrlOf(provider: string, raw: string | undefined) {
  const url = (raw?.trim() || (provider === 'github' ? 'https://github.com' : '')).replace(/\/+$/, '')
  if (!url) return fail('invalid', '请填写实例地址')
  if (!/^https?:\/\/[^/\s]+/.test(url)) return fail('invalid', '实例地址需以 http:// 或 https:// 开头')
  return url
}

const account = (r: Row): Account => ({ ...toDto(r), token: open(r.token) })

export function gitAccountRoutes(ctx: Ctx) {
  async function own(userId: string, id: string) {
    const [row] = await ctx.db
      .select()
      .from(gitAccounts)
      .where(and(eq(gitAccounts.id, idParam(id, '账号')), eq(gitAccounts.userId, userId)))
    return row ?? fail('not_found', '账号不存在')
  }

  /** Runs a provider call; a 401 flags the account so settings can ask for a new token. */
  async function viaProvider<T>(row: Row, call: (api: ReturnType<typeof providerApi>) => Promise<T>) {
    try {
      return await call(providerApi(account(row)))
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e
      if (e.kind !== 'unauthorized') return fail('invalid', e.message)
      await ctx.db.update(gitAccounts).set({ status: 'invalid' }).where(eq(gitAccounts.id, row.id))
      forgetAccount(row.id)
      return fail('invalid', 'Token 已失效，请在设置中重新连接')
    }
  }

  return async (app: FastifyInstance) => {
    app.get('/api/me/git-accounts', async (req): Promise<GitAccountDto[]> => {
      const me = await requireUser(ctx, req)
      const rows = await ctx.db
        .select()
        .from(gitAccounts)
        .where(eq(gitAccounts.userId, me.id))
        .orderBy(asc(gitAccounts.createdAt))
      return rows.map(toDto)
    })

    app.post('/api/me/git-accounts', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const body = AddGitAccountReq.parse(req.body)
      const baseUrl = baseUrlOf(body.provider, body.baseUrl)
      const token = body.token.trim()
      let login: string
      try {
        login = await providerApi({ id: '', provider: body.provider, baseUrl, token }).me()
      } catch (e) {
        if (e instanceof ProviderError) return fail('invalid', e.message)
        throw e
      }
      const [row] = await ctx.db
        .insert(gitAccounts)
        .values({ userId: me.id, provider: body.provider, baseUrl, login, token: seal(token) })
        .onConflictDoUpdate({
          target: [gitAccounts.userId, gitAccounts.baseUrl, gitAccounts.login],
          set: { provider: body.provider, token: seal(token), status: 'ok' },
        })
        .returning()
      if (!row) return fail('conflict', '保存失败')
      forgetAccount(row.id)
      return reply.status(201).send(toDto(row))
    })

    app.delete<{ Params: { id: string } }>('/api/me/git-accounts/:id', async (req, reply) => {
      const me = await requireUser(ctx, req)
      const row = await own(me.id, req.params.id)
      await ctx.db.delete(gitAccounts).where(eq(gitAccounts.id, row.id))
      forgetAccount(row.id)
      return reply.status(204).send()
    })

    app.get<{ Params: { id: string }; Querystring: { q?: string } }>(
      '/api/git-accounts/:id/repos',
      async (req): Promise<ProviderRepoDto[]> => {
        const me = await requireUser(ctx, req)
        const row = await own(me.id, req.params.id)
        const repos = await viaProvider(row, (api) => api.repos(req.query.q ?? ''))
        return repos.map((r) => ({
          fullName: r.fullName,
          url: me.gitProtocol === 'https' ? r.httpsUrl : r.sshUrl,
          defaultBranch: r.defaultBranch,
          private: r.private,
        }))
      },
    )

    app.get<{ Params: { id: string }; Querystring: { repo?: string; q?: string } }>(
      '/api/git-accounts/:id/branches',
      async (req): Promise<string[]> => {
        const me = await requireUser(ctx, req)
        const row = await own(me.id, req.params.id)
        const repo = req.query.repo?.trim()
        if (!repo) return fail('invalid', '缺少仓库')
        return viaProvider(row, (api) => api.branches(repo, req.query.q ?? ''))
      },
    )
  }
}
