import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, setUnauthorizedHandler } from '../src/lib/api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

describe('api client', () => {
  it('sends JSON with credentials under /api and returns the parsed body', async () => {
    const fetchMock = vi.fn(async () => json(200, { id: 'g1' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.post<{ id: string }>('/groups', { name: 'x' })).resolves.toEqual({ id: 'g1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/groups', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
  })

  it('omits body and content-type for GET, resolves undefined on 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.del('/bots/b1')).resolves.toBeUndefined()
    await api.get('/me')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/me', { method: 'GET', credentials: 'include' })
  })

  it('maps error bodies to ApiError with code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(409, { error: 'conflict', message: '名称已存在' })),
    )
    const err = await api.patch('/bots/b1', { name: 'a' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: '名称已存在' })
  })

  it('maps non-JSON failures to http_error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Bad Gateway', { status: 502 })),
    )
    await expect(api.get('/me')).rejects.toMatchObject({ status: 502, code: 'http_error' })
  })

  it('invokes the unauthorized handler on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(401, { error: 'unauthorized', message: '请先登录' })),
    )
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    await expect(api.get('/me')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
