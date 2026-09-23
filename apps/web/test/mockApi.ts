import { vi } from 'vitest'

type Reply = unknown | Response | ((body: unknown) => unknown | Response)
export interface Call {
  method: string
  path: string
  body: unknown
}

/** Stubs `fetch` for `/api/*`; routes are keyed `METHOD /path` (without the /api prefix). */
export function mockApi(routes: Record<string, Reply>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const path = input.replace(/^\/api/, '')
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
      calls.push({ method, path, body })
      const key = `${method} ${path}`
      if (!(key in routes))
        return new Response(JSON.stringify({ error: 'not_found', message: key }), { status: 404 })
      const route = routes[key]
      const out = typeof route === 'function' ? route(body) : route
      if (out instanceof Response) return out
      return out === undefined ? new Response(null, { status: 204 }) : new Response(JSON.stringify(out))
    }),
  )
  return calls
}

export const apiError = (status: number, error: string, message = error) =>
  new Response(JSON.stringify({ error, message }), { status })
